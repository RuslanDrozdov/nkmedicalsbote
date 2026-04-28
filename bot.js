import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import {
  FOLLOW_UP_QUESTIONS,
} from "./constants.js";

/**
 * Telegram survey bot (Telegraf, long polling).
 *
 * Основной сценарий:
 * - Пользователь запускает `/start`
 * - Проходит короткий onboarding (язык → пол → год рождения)
 * - Затем отвечает на блок из 9 вопросов (`FOLLOW_UP_QUESTIONS`)
 * - В конце получает сводку ответов
 *
 * Важно про хранение данных:
 * - Состояние диалога хранится ТОЛЬКО в памяти процесса (`sessions`).
 *   При рестарте процесса сессии и незавершённые ответы теряются.
 * - Файл `schema.sql` содержит заготовку под постоянное хранение (D1/Worker),
 *   но текущий `bot.js` с базой не работает.
 */

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Задайте BOT_TOKEN в файле .env (см. .env.example)");
  process.exit(1);
}

/**
 * Обёртка “промис + таймаут”.
 *
 * Зачем: сетевые вызовы (например, `telegram.getMe()`) могут зависнуть из‑за
 * проблем сети/доступа к API. На старте это выглядит как “бот не запускается”,
 * поэтому ограничиваем ожидание временем и даём понятную ошибку.
 */
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/**
 * Inline-клавиатуры для onboarding.
 *
 * Мы используем `callback_data` вида:
 * - `onb:lang:ru` / `onb:lang:en`
 * - `onb:gender:m` / `onb:gender:f`
 *
 * Далее в обработчике `callback_query` по префиксу понимаем, какой шаг пройден.
 */
const onboardingLangKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Русский", "onb:lang:ru"), Markup.button.callback("English", "onb:lang:en")],
  ]);

const onboardingGenderKeyboard = (lang) =>
  lang === "en"
    ? Markup.inlineKeyboard([
        [Markup.button.callback("Male", "onb:gender:m"), Markup.button.callback("Female", "onb:gender:f")],
      ])
    : Markup.inlineKeyboard([
        [Markup.button.callback("Мужской", "onb:gender:m"), Markup.button.callback("Женский", "onb:gender:f")],
      ]);

/**
 * In-memory “сессии” пользователей.
 *
 * Ключ: `userId` (Telegram `from.id`).
 * Значение: объект состояния диалога (минимальная FSM/машина состояний).
 *
 * Основные поля (по мере прохождения сценария):
 * - `phase`:
 *   - `idle`: пользователь ничего не проходит (дефолт)
 *   - `onboarding`: сбор профиля (язык/пол/год рождения)
 *   - `followup`: ответы на блок из 9 вопросов
 *   - `done`: завершили блок вопросов (для текущего процесса)
 * - `onboardingStep`: `lang` | `gender` | `birth_year` | null
 * - `profile`: { lang: 'ru'|'en', gender: 'm'|'f'|null, birthYear: string|null }
 * - `followUpIndex`: индекс текущего вопроса в `FOLLOW_UP_QUESTIONS`
 * - `answers`: массив текстовых ответов пользователя (по порядку вопросов)
 * - `lastSurveyCompletedAt`: timestamp (ms) последнего завершения — используется
 *   для ограничения “не чаще 1 раза в день” (локально, без базы).
 *
 * Ограничение: сессии живут пока живёт процесс. При рестарте всё обнуляется.
 */
/** @type {Map<number, any>} */
const sessions = new Map();

/**
 * Получить (или лениво создать) сессию пользователя.
 *
 * Ленивая инициализация упрощает обработчики: дальше по коду мы всегда работаем
 * с объектом сессии, даже если пользователь пишет боту впервые.
 */
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { phase: "idle" });
  }
  return sessions.get(userId);
}

/**
 * Полный сброс сессии в дефолт.
 *
 * Используется на `/start` и `/cancel`, чтобы начать сценарий “с чистого листа”.
 */
function resetSession(userId) {
  sessions.set(userId, { phase: "idle" });
}

/**
 * Тексты UI в двух языках.
 *
 * Это простой словарь без внешней i18n-системы: нам важнее читабельность.
 * Если ключ неизвестен — возвращаем подсказку по умолчанию.
 */
function uiText(lang, key) {
  const l = lang === "en" ? "en" : "ru";
  const m = {
    onboardingLang: { ru: "Выберите язык:", en: "Choose a language:" },
    onboardingGender: { ru: "Выберите пол:", en: "Select gender:" },
    onboardingBirthYear: { ru: "Введите год рождения:", en: "Enter birth year:" },
    emptyAnswer: { ru: "Пожалуйста, отправьте непустой ответ.", en: "Please send a non-empty answer." },
    alreadyToday: { ru: "Сегодня вы уже проходили опрос. Приходите завтра.", en: "You have already completed the survey today. Please come back tomorrow." },
    startSurveyHint: { ru: "Чтобы пройти опрос, отправьте /start", en: "To take the survey, send /start" },
  };
  return (m[key] ?? m.startSurveyHint)[l];
}

/**
 * Проверка “в один и тот же локальный календарный день”.
 *
 * Мы сравниваем год/месяц/число в локальной таймзоне процесса Node.js.
 * Это упрощённый подход: если нужен контроль по таймзоне пользователя,
 * лучше хранить timezone и сравнивать по ней (см. `schema.sql`).
 */
function isSameLocalDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Перевод пользователя в фазу follow-up опроса и показ первого вопроса.
 *
 * Мы обнуляем индекс и массив ответов: так проще гарантировать согласованность
 * “индекс вопроса ↔ соответствующий ответ”.
 */
function startFollowUpSurvey(ctx, s) {
  s.phase = "followup";
  s.followUpIndex = 0;
  s.answers = [];
  return ctx.reply(FOLLOW_UP_QUESTIONS[0]);
}

const bot = new Telegraf(BOT_TOKEN);
bot.catch((err, ctx) => {
  console.error("Bot error:", err);
  try {
    if (ctx?.chat?.id) {
      // Важно: если ошибка случилась внутри апдейта, пользователю полезно
      // получить “дружелюбное” сообщение и инструкцию как восстановиться.
      // Ошибка ответа не должна валить процесс, поэтому ниже — .catch(() => {})
      ctx.reply("Произошла ошибка. Попробуйте снова: /start").catch(() => {});
    }
  } catch {
    // ignore
  }
});

// Защита от дублей: Telegram/сеть могут повторно доставить update_id.
// Для long polling это бывает при рестартах/таймаутах. Храним небольшой LRU в памяти процесса.
const RECENT_UPDATE_IDS_MAX = 2000;
/** @type {Map<number, number>} */
const recentUpdateIds = new Map();
bot.use(async (ctx, next) => {
  const updateId = ctx?.update?.update_id;
  if (typeof updateId === "number") {
    // Если этот update_id уже видели — просто игнорируем, чтобы не задублировать
    // обработку (иначе пользователь может получить повторные сообщения).
    if (recentUpdateIds.has(updateId)) return;
    recentUpdateIds.set(updateId, Date.now());
    if (recentUpdateIds.size > RECENT_UPDATE_IDS_MAX) {
      // Map в JS итерируется в порядке вставки, поэтому `keys().next()` даёт
      // “самый старый” ключ. Это простой LRU-подобный механизм.
      const oldestKey = recentUpdateIds.keys().next().value;
      if (oldestKey !== undefined) recentUpdateIds.delete(oldestKey);
    }
  }
  return next();
});

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  // `/start` всегда начинает сценарий заново: обнуляем старую сессию и профиль.
  resetSession(userId);
  const s = getSession(userId);
  s.phase = "onboarding";
  s.onboardingStep = "lang";
  s.profile = null; // {lang, gender, birthYear}
  await ctx.reply(uiText("ru", "onboardingLang"), onboardingLangKeyboard());
});

bot.command("cancel", async (ctx) => {
  // Команда отмены: возвращаем пользователя в “ничего не происходит”.
  resetSession(ctx.from.id);
  await ctx.reply("Опрос отменён. Отправьте /start чтобы начать снова.");
});

bot.on("callback_query", async (ctx) => {
  const userId = ctx.from.id;
  const s = getSession(userId);
  const data = ctx.callbackQuery.data;

  if (typeof data !== "string") {
    // На всякий случай: Telegraf даёт разные типы, нам нужен только string.
    await ctx.answerCbQuery();
    return;
  }

  if (data.startsWith("onb:lang:")) {
    if (s.phase !== "onboarding") {
      // Пользователь мог нажать кнопку из старого сообщения (после /cancel,
      // после рестарта, или если сообщение “долго лежало”). Не продолжаем,
      // чтобы не запутать состояние — просим начать заново.
      await ctx.answerCbQuery("Сначала отправьте /start");
      return;
    }
    const lang = data.slice("onb:lang:".length) === "en" ? "en" : "ru";
    s.profile = s.profile ?? { lang: "ru", gender: null, birthYear: null };
    s.profile.lang = lang;
    s.onboardingStep = "gender";
    await ctx.answerCbQuery();
    // Убираем inline-клавиатуру у сообщения “Выберите язык”, чтобы нельзя было
    // повторно нажать и “сломать” ожидания пользователя.
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(uiText(lang, "onboardingGender"), onboardingGenderKeyboard(lang));
    return;
  }

  if (data.startsWith("onb:gender:")) {
    if (s.phase !== "onboarding") {
      await ctx.answerCbQuery("Сначала отправьте /start");
      return;
    }
    const gender = data.slice("onb:gender:".length) === "f" ? "f" : "m";
    s.profile = s.profile ?? { lang: "ru", gender: null, birthYear: null };
    s.profile.gender = gender;
    s.onboardingStep = "birth_year";
    await ctx.answerCbQuery();
    // Аналогично: после выбора пола выключаем кнопки, чтобы не было повторов.
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(uiText(s.profile.lang, "onboardingBirthYear"));
    return;
  }

  await ctx.answerCbQuery();
});

bot.on("text", async (ctx) => {
  // Все команды (`/start`, `/cancel`, ...) обрабатываются отдельно.
  // Здесь — только “обычный текст”, который пользователь вводит как ответ.
  if (ctx.message.text.startsWith("/")) return;

  const userId = ctx.from.id;
  const s = getSession(userId);

  if (s.phase === "onboarding" && s.onboardingStep === "birth_year") {
    // Мы ждём год рождения обычным текстом (без клавиатуры).
    // Валидация минимальная: важно не сломать UX, а не идеально проверить год.
    const text = ctx.message.text.trim();
    const lang = s.profile?.lang ?? "ru";
    if (!text) {
      await ctx.reply(uiText(lang, "emptyAnswer"));
      return;
    }
    s.profile = s.profile ?? { lang: "ru", gender: null, birthYear: null };
    s.profile.birthYear = text;
    s.onboardingStep = null;
    // Локально ограничиваем опрос “не чаще 1 раза в день”.
    // Это работает только в рамках жизни процесса (без базы и без таймзон пользователя).
    if (s.lastSurveyCompletedAt && isSameLocalDay(new Date(s.lastSurveyCompletedAt), new Date())) {
      s.phase = "idle";
      await ctx.reply(uiText(lang, "alreadyToday"));
      return;
    }
    await startFollowUpSurvey(ctx, s);
    return;
  }

  if (s.phase !== "followup" || s.followUpIndex === undefined || !s.answers) {
    // Если пользователь пишет “вне сценария” (например, не нажал /start, или
    // сессия сбросилась рестартом), мы не знаем, что считать ответом.
    const lang = s.profile?.lang ?? "ru";
    await ctx.reply(uiText(lang, "startSurveyHint"));
    return;
  }

  const text = ctx.message.text.trim();
  if (!text) {
    const lang = s.profile?.lang ?? "ru";
    await ctx.reply(uiText(lang, "emptyAnswer"));
    return;
  }

  // Сохраняем ответ в массив. Порядок критичен: i-й ответ относится к i-му вопросу.
  s.answers.push(text);
  const next = s.followUpIndex + 1;

  if (next >= FOLLOW_UP_QUESTIONS.length) {
    // Достигли конца списка вопросов — завершаем блок и показываем сводку.
    s.phase = "done";
    s.lastSurveyCompletedAt = Date.now();
    await ctx.reply(
      "Спасибо! Вы ответили на все вопросы.\n\n" +
        "Ваши ответы на блок из 9 вопросов:\n\n" +
        s.answers.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    );
    return;
  }

  // Иначе задаём следующий вопрос и обновляем индекс.
  s.followUpIndex = next;
  await ctx.reply(FOLLOW_UP_QUESTIONS[next]);
});

console.log("Запуск бота (Telegraf, long polling)…");

try {
  // Быстрая проверка на старте: токен валиден и Telegram API доступен.
  // Таймаут нужен, чтобы не “висеть молча” при сетевых проблемах.
  const me = await withTimeout(bot.telegram.getMe(), 10_000, "telegram.getMe()");
  console.log(`Токен валиден. Bot: @${me.username} (${me.id})`);
} catch (e) {
  console.error(
    "Не удалось обратиться к Telegram API. Проверьте доступ к api.telegram.org и BOT_TOKEN. Ошибка:",
    e,
  );
  process.exit(1);
}

try {
  console.log("Запускаю long polling…");
  // `dropPendingUpdates: true` — Telegram “забывает” накопившиеся апдейты.
  // Это удобно, чтобы не разбирать старые сообщения после простоя/деплоя,
  // но ценой того, что пользовательские апдейты, пришедшие пока бот был оффлайн,
  // не будут обработаны.
  //
  // В Telegraf `launch()` может не резолвиться (polling работает бесконечно),
  // поэтому не `await`'им — просто запускаем и логируем успех.
  bot.launch({ dropPendingUpdates: true }).catch((e) => {
    console.error(
      "Ошибка при запуске/работе long polling. Возможные причины: webhook включён, второй экземпляр бота уже запущен, либо сеть. Ошибка:",
      e,
    );
    process.exit(1);
  });
  console.log("Бот запущен (long polling). Остановка: Ctrl+C");
} catch (e) {
  console.error(
    "Не удалось запустить long polling. Возможные причины: webhook включён, второй экземпляр бота уже запущен, либо сеть. Ошибка:",
    e,
  );
  process.exit(1);
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
