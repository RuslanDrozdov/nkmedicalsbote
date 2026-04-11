import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import {
  SCREENING_QUESTIONS,
  FOLLOW_UP_QUESTIONS,
  REQUIRE_BOTH_YES,
} from "./src/constants.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Задайте BOT_TOKEN в файле .env (см. .env.example)");
  process.exit(1);
}

const yesNoKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Да", "ans:yes"), Markup.button.callback("Нет", "ans:no")],
  ]);

/** @type {Map<number, { phase: string, screening?: [boolean|null, boolean|null], followUpIndex?: number, answers?: string[] }>} */
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

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  resetSession(userId);
  const s = getSession(userId);
  s.phase = "screening";
  s.screening = [null, null];
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

  if (s.phase !== "screening" || !s.screening) {
    await ctx.answerCbQuery("Сначала отправьте /start");
    return;
  }

  await ctx.answerCbQuery();

  if (s.screening[0] === null) {
    s.screening[0] = yes;
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(SCREENING_QUESTIONS[1], yesNoKeyboard());
    return;
  }

  if (s.screening[1] === null) {
    s.screening[1] = yes;
    await ctx.editMessageReplyMarkup(undefined);

    const first = s.screening[0];
    const second = s.screening[1];
    const proceed =
      REQUIRE_BOTH_YES ? first === true && second === true : first === true || second === true;

    if (!proceed) {
      await ctx.reply(
        "Спасибо за ответы. Дальнейшие вопросы не требуются. При необходимости снова нажмите /start.",
      );
      s.phase = "done";
      return;
    }

    s.phase = "followup";
    s.followUpIndex = 0;
    s.answers = [];
    await ctx.reply(FOLLOW_UP_QUESTIONS[0]);
    return;
  }
});

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;

  const userId = ctx.from.id;
  const s = getSession(userId);

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

bot.launch().then(() => {
  console.log("Бот запущен (long polling). Остановка: Ctrl+C");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
