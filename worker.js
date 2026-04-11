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
  if (!db) return defaultSession();
  try {
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
  } catch (e) {
    console.error("loadSession:", e);
    return defaultSession();
  }
}

/**
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 * @param {object} state
 */
async function saveSession(db, userId, state) {
  if (!db) return;
  const now = Math.floor(Date.now() / 1000);
  try {
    await db
      .prepare(
        `INSERT INTO sessions (user_id, state, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      )
      .bind(userId, JSON.stringify(state), now)
      .run();
  } catch (e) {
    console.error("saveSession:", e);
  }
}

/**
 * @param {{ BOT_TOKEN: string, DB: import("@cloudflare/workers-types").D1Database }} env
 */
function createBot(env) {
  const bot = new Bot(env.BOT_TOKEN);

  // bot.catch() при webhook не используется grammY — ловим ошибки здесь
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error("update error:", err);
      try {
        await ctx.reply("Произошла ошибка. Попробуйте снова: /start");
      } catch (_) {
        /* ignore */
      }
    }
  });

  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return next();
    ctx.session = await loadSession(env.DB, uid);
    await next();
    if (ctx.session) await saveSession(env.DB, uid, ctx.session);
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
    const s = ctx.session ?? defaultSession();
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

    const s = ctx.session ?? defaultSession();

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
    const path =
      url.pathname.length > 1 && url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname;

    if (path === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (path === "/" || path === "") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "telegram-survey-bot",
          endpoints: {
            status: "/status",
            health: "/health",
            webhook_post: "/webhook",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    if (path === "/status") {
      const configured = Boolean(env.BOT_TOKEN && String(env.BOT_TOKEN).trim());
      const secretTrim = typeof env.WEBHOOK_SECRET === "string" ? env.WEBHOOK_SECRET.trim() : "";
      const body = JSON.stringify({
        ok: true,
        bot_token_configured: configured,
        d1_bound: Boolean(env.DB),
        webhook_secret_enforced: secretTrim.length > 0,
        hint: !configured
          ? "Добавьте BOT_TOKEN: wrangler secret put BOT_TOKEN"
          : secretTrim.length > 0
            ? "При setWebhook нужен тот же secret_token, что в WEBHOOK_SECRET"
            : "webhook URL должен заканчиваться на /webhook",
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (path !== "/webhook" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    if (!env.BOT_TOKEN || !String(env.BOT_TOKEN).trim()) {
      console.error("BOT_TOKEN не задан в секретах Worker");
      return new Response("BOT_TOKEN missing", { status: 503 });
    }

    const secretExpected =
      typeof env.WEBHOOK_SECRET === "string" ? env.WEBHOOK_SECRET.trim() : "";
    if (secretExpected.length > 0) {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== secretExpected) {
        console.error(
          "WEBHOOK_SECRET: заголовок от Telegram не совпал. Уберите секрет или задайте тот же secret_token в setWebhook.",
        );
        return new Response("Unauthorized", { status: 401 });
      }
    }

    if (!cachedBot || cachedToken !== env.BOT_TOKEN) {
      cachedBot = createBot(env);
      cachedToken = env.BOT_TOKEN;
      try {
        await cachedBot.init();
      } catch (e) {
        console.error("bot.init (проверьте BOT_TOKEN и доступ к api.telegram.org):", e);
        return new Response("Bot init failed", { status: 503 });
      }
    }

    try {
      return await webhookCallback(cachedBot, "std/http", {
        timeoutMilliseconds: 55_000,
      })(request);
    } catch (e) {
      console.error("webhook handler:", e);
      return new Response("Internal error", { status: 500 });
    }
  },
};
