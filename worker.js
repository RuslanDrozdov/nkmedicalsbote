import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import {
  SCREENING_QUESTIONS,
  FOLLOW_UP_QUESTIONS,
  REQUIRE_BOTH_YES,
} from "./constants.js";

function defaultSession() {
  return { phase: "idle" };
}

function yesNoKeyboard() {
  return new InlineKeyboard().text("Да", "ans:yes").text("Нет", "ans:no");
}

/**
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 */
async function loadSession(db, userId) {
  const row = await db
    .prepare("SELECT state FROM sessions WHERE user_id = ?")
    .bind(userId)
    .first();
  if (!row?.state) return defaultSession();
  try {
    return JSON.parse(String(row.state));
  } catch {
    return defaultSession();
  }
}

/**
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 * @param {object} state
 */
async function saveSession(db, userId, state) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO sessions (user_id, state, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(state), now)
    .run();
}

/**
 * @param {{ BOT_TOKEN: string, DB: import("@cloudflare/workers-types").D1Database }} env
 */
function createBot(env) {
  const bot = new Bot(env.BOT_TOKEN);

  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return next();
    const session = await loadSession(env.DB, uid);
    ctx.session = session;
    await next();
    await saveSession(env.DB, uid, ctx.session);
  });

  bot.command("start", async (ctx) => {
    ctx.session = {
      phase: "screening",
      screening: [null, null],
    };
    await ctx.reply(SCREENING_QUESTIONS[0], { reply_markup: yesNoKeyboard() });
  });

  bot.command("cancel", async (ctx) => {
    ctx.session = defaultSession();
    await ctx.reply("Опрос отменён. Отправьте /start чтобы начать снова.");
  });

  bot.callbackQuery(/^(ans:yes|ans:no)$/, async (ctx) => {
    const s = ctx.session;
    const data = ctx.callbackQuery.data;
    const yes = data === "ans:yes";

    if (s.phase !== "screening" || !s.screening) {
      await ctx.answerCallbackQuery({ text: "Сначала отправьте /start" });
      return;
    }

    await ctx.answerCallbackQuery();

    if (s.screening[0] === null) {
      s.screening[0] = yes;
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      await ctx.reply(SCREENING_QUESTIONS[1], { reply_markup: yesNoKeyboard() });
      return;
    }

    if (s.screening[1] === null) {
      s.screening[1] = yes;
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });

      const first = s.screening[0];
      const second = s.screening[1];
      const proceed = REQUIRE_BOTH_YES
        ? first === true && second === true
        : first === true || second === true;

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
    }
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const s = ctx.session;

    if (s.phase !== "followup" || s.followUpIndex === undefined || !s.answers) {
      await ctx.reply("Чтобы начать опрос, отправьте /start");
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      await ctx.reply("Пожалуйста, отправьте непустой ответ.");
      return;
    }

    s.answers.push(trimmed);
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

  return bot;
}

let cachedBot = null;
let cachedToken = "";

export default {
  /**
   * @param {Request} request
   * @param {{ BOT_TOKEN: string, DB: import("@cloudflare/workers-types").D1Database, WEBHOOK_SECRET?: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname !== "/webhook" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    if (env.WEBHOOK_SECRET) {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    if (!cachedBot || cachedToken !== env.BOT_TOKEN) {
      cachedBot = createBot(env);
      cachedToken = env.BOT_TOKEN;
    }

    return webhookCallback(cachedBot, "std/http")(request);
  },
};
