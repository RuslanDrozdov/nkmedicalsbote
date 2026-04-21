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

function reminderTimeKeyboard() {
  return new InlineKeyboard()
    .text("Вкл/выкл", "rem:toggle")
    .text("Время", "rem:set_time")
    .row()
    .text("Часовой пояс", "rem:set_tz")
    .text("Тест сейчас", "rem:test");
}

function reminderOpenKeyboard() {
  return new InlineKeyboard().text("Напоминания ⏰", "rem:open");
}

const REMINDER_TIME_RE = /^(?<hh>[01]\d|2[0-3]):(?<mm>[0-5]\d)$/;

/**
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 */
async function ensureReminderRow(db, userId) {
  if (!db) return null;
  await db
    .prepare(
      `INSERT OR IGNORE INTO reminder_settings (user_id, timezone, time_hhmm, enabled)
       VALUES (?, 'UTC', '09:00', 0)`,
    )
    .bind(userId)
    .run();
  return await db
    .prepare(
      `SELECT user_id, timezone, time_hhmm, enabled, last_sent_local_date
       FROM reminder_settings WHERE user_id = ?`,
    )
    .bind(userId)
    .first();
}

/**
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 * @param {Partial<{timezone:string,time_hhmm:string,enabled:number,last_sent_local_date:string|null}>} patch
 */
async function updateReminderRow(db, userId, patch) {
  if (!db) return;
  const fields = [];
  const values = [];
  if (typeof patch.timezone === "string") {
    fields.push("timezone = ?");
    values.push(patch.timezone);
  }
  if (typeof patch.time_hhmm === "string") {
    fields.push("time_hhmm = ?");
    values.push(patch.time_hhmm);
  }
  if (typeof patch.enabled === "number") {
    fields.push("enabled = ?");
    values.push(patch.enabled);
  }
  if ("last_sent_local_date" in patch) {
    fields.push("last_sent_local_date = ?");
    values.push(patch.last_sent_local_date);
  }
  if (fields.length === 0) return;
  values.push(userId);
  await db
    .prepare(`UPDATE reminder_settings SET ${fields.join(", ")} WHERE user_id = ?`)
    .bind(...values)
    .run();
}

function fmtReminderRow(row) {
  const enabled = Number(row?.enabled ?? 0) === 1;
  const time = String(row?.time_hhmm ?? "09:00");
  const tz = String(row?.timezone ?? "UTC");
  return (
    `Напоминание: ${enabled ? "включено" : "выключено"}\n` +
    `Время: ${time}\n` +
    `Часовой пояс: ${tz}\n\n` +
    `Нажмите кнопки ниже или отправьте время в формате HH:MM после выбора «Время».`
  );
}

function safeLocalParts(date, timeZone) {
  const tz = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    /** @type {Record<string,string>} */
    const m = {};
    for (const p of parts) {
      if (p.type !== "literal") m[p.type] = p.value;
    }
    return { ymd: `${m.year}-${m.month}-${m.day}`, hm: `${m.hour}:${m.minute}`, tz };
  } catch {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    /** @type {Record<string,string>} */
    const m = {};
    for (const p of parts) {
      if (p.type !== "literal") m[p.type] = p.value;
    }
    return { ymd: `${m.year}-${m.month}-${m.day}`, hm: `${m.hour}:${m.minute}`, tz: "UTC" };
  }
}

function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Минимальный вызов Bot API без инициализации grammY (для cron).
 * @param {{BOT_TOKEN:string}} env
 * @param {number} chatId
 * @param {string} text
 */
async function sendTelegramMessage(env, chatId, text) {
  const token = env?.BOT_TOKEN ? String(env.BOT_TOKEN).trim() : "";
  if (!token) return false;
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  return resp.ok;
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
    ctx.db = env.DB;
    await next();
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
    await ctx.reply("Настройки:", { reply_markup: reminderOpenKeyboard() });
  });

  bot.command("cancel", async (ctx) => {
    ctx.session = defaultSession();
    await ctx.reply("Опрос отменён. Отправьте /start чтобы начать снова.");
  });

  bot.command("reminder", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.reply("D1 не подключена (binding DB). Напоминания недоступны.");
      return;
    }
    const row = await ensureReminderRow(ctx.db, uid);
    ctx.session = ctx.session ?? defaultSession();
    delete ctx.session.reminderAwaitingTime;
    delete ctx.session.reminderAwaitingTz;
    await ctx.reply(fmtReminderRow(row), { reply_markup: reminderTimeKeyboard() });
  });

  bot.callbackQuery(/^rem:open$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: "D1 не подключена" });
      return;
    }
    const row = await ensureReminderRow(ctx.db, uid);
    ctx.session = ctx.session ?? defaultSession();
    delete ctx.session.reminderAwaitingTime;
    delete ctx.session.reminderAwaitingTz;
    await ctx.answerCallbackQuery();
    await ctx.reply(fmtReminderRow(row), { reply_markup: reminderTimeKeyboard() });
  });

  bot.callbackQuery(/^rem:(toggle|set_time|set_tz|test)$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: "D1 не подключена" });
      return;
    }
    const action = ctx.callbackQuery.data.slice("rem:".length);
    const row = await ensureReminderRow(ctx.db, uid);
    ctx.session = ctx.session ?? defaultSession();

    if (action === "toggle") {
      const enabled = Number(row?.enabled ?? 0) === 1 ? 0 : 1;
      await updateReminderRow(ctx.db, uid, { enabled });
      const updated = await ensureReminderRow(ctx.db, uid);
      await ctx.answerCallbackQuery({ text: enabled ? "Включено" : "Выключено" });
      await ctx.editMessageText(fmtReminderRow(updated), { reply_markup: reminderTimeKeyboard() });
      return;
    }

    if (action === "set_time") {
      ctx.session.reminderAwaitingTime = true;
      ctx.session.reminderAwaitingTz = false;
      await ctx.answerCallbackQuery();
      await ctx.reply("Отправьте время в формате HH:MM (например 09:30).");
      return;
    }

    if (action === "set_tz") {
      ctx.session.reminderAwaitingTz = true;
      ctx.session.reminderAwaitingTime = false;
      const kb = new InlineKeyboard()
        .text("Europe/Moscow (UTC+3)", "tz:Europe/Moscow")
        .row()
        .text("Europe/Kaliningrad (UTC+2)", "tz:Europe/Kaliningrad")
        .row()
        .text("Asia/Yekaterinburg (UTC+5)", "tz:Asia/Yekaterinburg")
        .row()
        .text("Asia/Novosibirsk (UTC+7)", "tz:Asia/Novosibirsk")
        .row()
        .text("Asia/Irkutsk (UTC+8)", "tz:Asia/Irkutsk")
        .row()
        .text("Asia/Yakutsk (UTC+9)", "tz:Asia/Yakutsk")
        .row()
        .text("Asia/Vladivostok (UTC+10)", "tz:Asia/Vladivostok")
        .row()
        .text("Asia/Magadan (UTC+11)", "tz:Asia/Magadan")
        .row()
        .text("Asia/Kamchatka (UTC+12)", "tz:Asia/Kamchatka")
        .row()
        .text("UTC", "tz:UTC");
      await ctx.answerCallbackQuery();
      await ctx.reply("Выберите часовой пояс.", { reply_markup: kb });
      return;
    }

    if (action === "test") {
      const ok = await sendTelegramMessage(
        env,
        uid,
        "Тестовое напоминание. Если вы это видите — отправка работает.",
      );
      await ctx.answerCallbackQuery({ text: ok ? "Отправлено" : "Не удалось отправить" });
      return;
    }
  });

  bot.callbackQuery(/^tz:(.+)$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: "D1 не подключена" });
      return;
    }
    const tz = ctx.callbackQuery.data.slice("tz:".length).trim();
    if (!isValidTimeZone(tz)) {
      await ctx.answerCallbackQuery({ text: "Некорректный часовой пояс" });
      return;
    }
    await ensureReminderRow(ctx.db, uid);
    await updateReminderRow(ctx.db, uid, { timezone: tz, last_sent_local_date: null });
    const updated = await ensureReminderRow(ctx.db, uid);
    ctx.session = ctx.session ?? defaultSession();
    ctx.session.reminderAwaitingTz = false;
    await ctx.answerCallbackQuery({ text: "Сохранено" });
    await ctx.reply(fmtReminderRow(updated), { reply_markup: reminderTimeKeyboard() });
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

    if (s.reminderAwaitingTime && s.phase !== "followup") {
      if (!ctx.db) {
        await ctx.reply("D1 не подключена (binding DB).");
        s.reminderAwaitingTime = false;
        return;
      }
      const trimmed = text.trim();
      const m = REMINDER_TIME_RE.exec(trimmed);
      if (!m) {
        await ctx.reply("Не похоже на время. Пример: 09:30");
        return;
      }
      await ensureReminderRow(ctx.db, ctx.from.id);
      await updateReminderRow(ctx.db, ctx.from.id, { time_hhmm: trimmed, last_sent_local_date: null });
      const updated = await ensureReminderRow(ctx.db, ctx.from.id);
      s.reminderAwaitingTime = false;
      await ctx.reply("Сохранено.");
      await ctx.reply(fmtReminderRow(updated), { reply_markup: reminderTimeKeyboard() });
      return;
    }

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
      const answersSnapshot = [...s.answers];
      const screeningSnapshot = s.screening ? [...s.screening] : null;
      const uid = ctx.from?.id;

      if (ctx.db && uid !== undefined) {
        try {
          const now = Math.floor(Date.now() / 1000);
          await ctx.db
            .prepare(
              `INSERT INTO survey_responses (user_id, completed_at, answers_json, screening_json)
               VALUES (?, ?, ?, ?)`,
            )
            .bind(
              uid,
              now,
              JSON.stringify(answersSnapshot),
              screeningSnapshot ? JSON.stringify(screeningSnapshot) : null,
            )
            .run();
        } catch (e) {
          console.error("survey_responses INSERT:", e);
        }
      }

      s.phase = "done";
      delete s.followUpIndex;
      delete s.answers;
      delete s.screening;

      await ctx.reply(
        "Спасибо! Вы ответили на все вопросы.\n\n" +
          "Ваши ответы на блок из 9 вопросов:\n\n" +
          answersSnapshot.map((a, i) => `${i + 1}. ${a}`).join("\n"),
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

    if (path === "/webhook" && request.method === "GET") {
      return new Response(
        "Этот адрес для Telegram: сюда должен приходить только POST с update.\n" +
          "В браузере откройте /health (должно быть ok) или корень / для подсказки.\n" +
          "Webhook в Bot API: setWebhook с URL …/webhook — браузером проверять не нужно.",
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
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

    const rawBody = await request.text();
    let updateId;
    try {
      const parsed = JSON.parse(rawBody);
      if (typeof parsed?.update_id === "number") updateId = parsed.update_id;
    } catch {
      /* не JSON — отдадим в grammY как есть */
    }

    if (env.DB && updateId !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      try {
        const ins = await env.DB.prepare(
          `INSERT OR IGNORE INTO processed_updates (update_id, created_at) VALUES (?, ?)`,
        )
          .bind(updateId, now)
          .run();
        if (ins.meta.changes === 0) {
          return new Response("ok", { status: 200 });
        }
        if (Math.random() < 0.02) {
          await env.DB.prepare(`DELETE FROM processed_updates WHERE created_at < ?`).bind(now - 604800).run();
        }
      } catch (e) {
        console.error("processed_updates:", e);
      }
    }

    const replay = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: rawBody,
    });

    try {
      return await webhookCallback(cachedBot, "std/http", {
        timeoutMilliseconds: 55_000,
      })(replay);
    } catch (e) {
      console.error("webhook handler:", e);
      return new Response("Internal error", { status: 500 });
    }
  },

  /**
   * Cron-trigger: отправка напоминаний.
   * @param {ScheduledEvent} _event
   * @param {{ BOT_TOKEN: string, DB: import("@cloudflare/workers-types").D1Database }} env
   */
  async scheduled(_event, env) {
    if (!env?.DB) return;
    const token = env?.BOT_TOKEN ? String(env.BOT_TOKEN).trim() : "";
    if (!token) return;

    let rows;
    try {
      const res = await env.DB.prepare(
        `SELECT user_id, timezone, time_hhmm, enabled, last_sent_local_date
         FROM reminder_settings WHERE enabled = 1`,
      ).all();
      rows = res?.results ?? [];
    } catch (e) {
      console.error("reminder_settings SELECT:", e);
      return;
    }

    const now = new Date();
    for (const row of rows) {
      const uid = Number(row.user_id);
      if (!uid) continue;
      const desired = String(row.time_hhmm ?? "09:00");
      const tz = String(row.timezone ?? "UTC");
      const { ymd, hm } = safeLocalParts(now, tz);
      if (hm !== desired) continue;
      if (row.last_sent_local_date && String(row.last_sent_local_date) === ymd) continue;

      const ok = await sendTelegramMessage(
        env,
        uid,
        `Напоминание по расписанию (${desired} ${tz}). Если хотите изменить — /reminder`,
      );
      if (!ok) continue;

      try {
        await updateReminderRow(env.DB, uid, { last_sent_local_date: ymd });
      } catch (e) {
        console.error("reminder_settings UPDATE:", e);
      }
    }
  },
};
