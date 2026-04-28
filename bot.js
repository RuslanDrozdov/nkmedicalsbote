import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import {
  FOLLOW_UP_QUESTIONS,
} from "./constants.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Задайте BOT_TOKEN в файле .env (см. .env.example)");
  process.exit(1);
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

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

/** @type {Map<number, any>} */
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { phase: "idle" });
  }
  return sessions.get(userId);
}

function resetSession(userId) {
  sessions.set(userId, { phase: "idle" });
}

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

function isSameLocalDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

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
    if (recentUpdateIds.has(updateId)) return;
    recentUpdateIds.set(updateId, Date.now());
    if (recentUpdateIds.size > RECENT_UPDATE_IDS_MAX) {
      const oldestKey = recentUpdateIds.keys().next().value;
      if (oldestKey !== undefined) recentUpdateIds.delete(oldestKey);
    }
  }
  return next();
});

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  resetSession(userId);
  const s = getSession(userId);
  s.phase = "onboarding";
  s.onboardingStep = "lang";
  s.profile = null; // {lang, gender, birthYear}
  await ctx.reply(uiText("ru", "onboardingLang"), onboardingLangKeyboard());
});

bot.command("cancel", async (ctx) => {
  resetSession(ctx.from.id);
  await ctx.reply("Опрос отменён. Отправьте /start чтобы начать снова.");
});

bot.on("callback_query", async (ctx) => {
  const userId = ctx.from.id;
  const s = getSession(userId);
  const data = ctx.callbackQuery.data;

  if (typeof data !== "string") {
    await ctx.answerCbQuery();
    return;
  }

  if (data.startsWith("onb:lang:")) {
    if (s.phase !== "onboarding") {
      await ctx.answerCbQuery("Сначала отправьте /start");
      return;
    }
    const lang = data.slice("onb:lang:".length) === "en" ? "en" : "ru";
    s.profile = s.profile ?? { lang: "ru", gender: null, birthYear: null };
    s.profile.lang = lang;
    s.onboardingStep = "gender";
    await ctx.answerCbQuery();
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
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(uiText(s.profile.lang, "onboardingBirthYear"));
    return;
  }

  await ctx.answerCbQuery();
});

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;

  const userId = ctx.from.id;
  const s = getSession(userId);

  if (s.phase === "onboarding" && s.onboardingStep === "birth_year") {
    const text = ctx.message.text.trim();
    const lang = s.profile?.lang ?? "ru";
    if (!text) {
      await ctx.reply(uiText(lang, "emptyAnswer"));
      return;
    }
    s.profile = s.profile ?? { lang: "ru", gender: null, birthYear: null };
    s.profile.birthYear = text;
    s.onboardingStep = null;
    // локально: считаем профиль заполненным и запускаем опрос, если сегодня ещё не проходили
    if (s.lastSurveyCompletedAt && isSameLocalDay(new Date(s.lastSurveyCompletedAt), new Date())) {
      s.phase = "idle";
      await ctx.reply(uiText(lang, "alreadyToday"));
      return;
    }
    await startFollowUpSurvey(ctx, s);
    return;
  }

  if (s.phase !== "followup" || s.followUpIndex === undefined || !s.answers) {
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

  s.answers.push(text);
  const next = s.followUpIndex + 1;

  if (next >= FOLLOW_UP_QUESTIONS.length) {
    s.phase = "done";
    s.lastSurveyCompletedAt = Date.now();
    await ctx.reply(
      "Спасибо! Вы ответили на все вопросы.\n\n" +
        "Ваши ответы на блок из 9 вопросов:\n\n" +
        s.answers.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    );
    return;
  }

  s.followUpIndex = next;
  await ctx.reply(FOLLOW_UP_QUESTIONS[next]);
});

console.log("Запуск бота (Telegraf, long polling)…");

try {
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
  // В Telegraf `launch()` может не резолвиться (polling работает бесконечно),
  // поэтому не ждём завершения, а логируем сразу.
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
