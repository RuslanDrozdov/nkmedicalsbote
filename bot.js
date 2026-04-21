import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import {
  SCREENING_QUESTIONS,
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

const yesNoKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Да", "ans:yes"), Markup.button.callback("Нет", "ans:no")],
  ]);

/** @type {Map<number, { phase: string, screening?: boolean|null, followUpIndex?: number, answers?: string[] }>} */
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
  s.phase = "screening";
  // screening: первый вопрос — yes/no, второй — текст
  s.screening = null;
  s.awaitingScreeningText2 = false;
  await ctx.reply(SCREENING_QUESTIONS[0], yesNoKeyboard());
});

bot.command("cancel", async (ctx) => {
  resetSession(ctx.from.id);
  await ctx.reply("Опрос отменён. Отправьте /start чтобы начать снова.");
});

bot.on("callback_query", async (ctx) => {
  const userId = ctx.from.id;
  const s = getSession(userId);
  const data = ctx.callbackQuery.data;

  if (data !== "ans:yes" && data !== "ans:no") {
    await ctx.answerCbQuery();
    return;
  }

  const yes = data === "ans:yes";

  if (s.phase !== "screening") {
    await ctx.answerCbQuery("Сначала отправьте /start");
    return;
  }

  await ctx.answerCbQuery();

  if (s.screening === null || s.screening === undefined) {
    s.screening = yes;
    await ctx.editMessageReplyMarkup(undefined);

    if (!yes) {
      await ctx.reply(
        "Спасибо Елена Петровна за ответы. Опрос окончен. При необходимости снова нажмите /start.",
      );
      s.phase = "done";
      return;
    }

    // второй скрининговый вопрос теперь текстом
    s.awaitingScreeningText2 = true;
    await ctx.reply(SCREENING_QUESTIONS[1]);
    return;
  }
});

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;

  const userId = ctx.from.id;
  const s = getSession(userId);

  if (s.phase === "screening" && s.screening === true && s.awaitingScreeningText2) {
    const text = ctx.message.text.trim();
    if (!text) {
      await ctx.reply("Пожалуйста, отправьте непустой ответ.");
      return;
    }
    s.awaitingScreeningText2 = false;

    s.phase = "followup";
    s.followUpIndex = 0;
    s.answers = [];
    // Сохраняем текстовый ответ как “нулевой” скрининг-мета, если нужно будет выводить/логировать позже.
    s.screeningText2 = text;
    await ctx.reply(FOLLOW_UP_QUESTIONS[0]);
    return;
  }

  if (s.phase !== "followup" || s.followUpIndex === undefined || !s.answers) {
    await ctx.reply("Чтобы начать опрос, отправьте /start");
    return;
  }

  const text = ctx.message.text.trim();
  if (!text) {
    await ctx.reply("Пожалуйста, отправьте непустой ответ.");
    return;
  }

  s.answers.push(text);
  const next = s.followUpIndex + 1;

  if (next >= FOLLOW_UP_QUESTIONS.length) {
    s.phase = "done";
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
