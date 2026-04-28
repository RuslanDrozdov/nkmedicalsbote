import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import {
  FOLLOW_UP_QUESTIONS,
} from "./constants.js";

function defaultSession() {
  return { phase: "idle" };
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
    `Приглашение на опрос: ${enabled ? "включено" : "выключено"}\n` +
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
  if (resp.ok) return true;
  try {
    const body = await resp.text();
    console.error("sendMessage failed:", resp.status, body);
  } catch (e) {
    console.error("sendMessage failed:", resp.status, e);
  }
  return false;
}

/**
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 */
async function getUserProfile(db, userId) {
  if (!db) return null;
  try {
    return await db
      .prepare(
        `SELECT user_id, language, gender, birth_year, created_at, updated_at
         FROM user_profile WHERE user_id = ?`,
      )
      .bind(userId)
      .first();
  } catch (e) {
    console.error("getUserProfile:", e);
    return null;
  }
}

/**
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 * @param {{language:'ru'|'en', gender:'m'|'f', birth_year:string}} profile
 */
async function upsertUserProfile(db, userId, profile) {
  if (!db) return false;
  const now = Math.floor(Date.now() / 1000);
  try {
    await db
      .prepare(
        `INSERT INTO user_profile (user_id, language, gender, birth_year, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           language = excluded.language,
           gender = excluded.gender,
           birth_year = excluded.birth_year,
           updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        String(profile.language),
        String(profile.gender),
        String(profile.birth_year),
        now,
        now,
      )
      .run();
    return true;
  } catch (e) {
    console.error("upsertUserProfile:", e);
    return false;
  }
}

function uiText(lang, key) {
  const l = lang === "en" ? "en" : "ru";
  /** @type {Record<string, {ru:string,en:string}>} */
  const m = {
    onboardingLang: { ru: "Выберите язык:", en: "Choose a language:" },
    onboardingGender: { ru: "Выберите пол:", en: "Select gender:" },
    onboardingBirthYear: { ru: "Введите год рождения:", en: "Enter birth year:" },
    emptyAnswer: { ru: "Пожалуйста, отправьте непустой ответ.", en: "Please send a non-empty answer." },
    alreadyToday: { ru: "Сегодня вы уже проходили опрос. Приходите завтра.", en: "You have already completed the survey today. Please come back tomorrow." },
    startSurveyHint: { ru: "Чтобы пройти опрос, отправьте /survey", en: "To take the survey, send /survey" },
    cancelled: { ru: "Опрос отменён. Отправьте /start чтобы начать снова.", en: "Cancelled. Send /start to begin again." },
    needStart: { ru: "Сначала отправьте /start", en: "Please send /start first" },
    doneThanks: { ru: "Спасибо! Вы ответили на все вопросы.", en: "Thanks! You answered all questions." },
    answersHeader: { ru: "Ваши ответы на блок из 9 вопросов:", en: "Your answers (9 questions):" },
  };
  return (m[key] ?? m.needStart)[l];
}

function onboardingLangKeyboard() {
  return new InlineKeyboard().text("Русский", "onb:lang:ru").text("English", "onb:lang:en");
}

function onboardingGenderKeyboard(lang) {
  if (lang === "en") {
    return new InlineKeyboard().text("Male", "onb:gender:m").text("Female", "onb:gender:f");
  }
  return new InlineKeyboard().text("Мужской", "onb:gender:m").text("Женский", "onb:gender:f");
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
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 */
async function getUserTimezone(db, userId) {
  if (!db) return "UTC";
  try {
    const row = await db
      .prepare(`SELECT timezone FROM reminder_settings WHERE user_id = ?`)
      .bind(userId)
      .first();
    const tz = typeof row?.timezone === "string" ? row.timezone.trim() : "";
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 * @param {Date} now
 */
async function hasCompletedSurveyToday(db, userId, now) {
  if (!db) return false;
  try {
    const row = await db
      .prepare(`SELECT completed_at FROM survey_responses WHERE user_id = ? ORDER BY completed_at DESC LIMIT 1`)
      .bind(userId)
      .first();
    if (!row?.completed_at) return false;
    const tz = await getUserTimezone(db, userId);
    const last = new Date(Number(row.completed_at) * 1000);
    const lastYmd = safeLocalParts(last, tz).ymd;
    const nowYmd = safeLocalParts(now, tz).ymd;
    return lastYmd === nowYmd;
  } catch (e) {
    console.error("hasCompletedSurveyToday:", e);
    return false;
  }
}

function startFollowUpSurvey(ctx) {
  const s = ctx.session ?? defaultSession();
  s.phase = "followup";
  s.followUpIndex = 0;
  s.answers = [];
  ctx.session = s;
  return ctx.reply(FOLLOW_UP_QUESTIONS[0]);
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

  // Дополнительная идемпотентность на уровне пользователя (переживает рестарты изолята):
  // Telegram может повторно доставить update (обычно тот же update_id). Игнорируем апдейты
  // с update_id <= lastUpdateId для конкретного пользователя.
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    const updateId = ctx.update?.update_id;
    if (uid === undefined || typeof updateId !== "number") return next();
    ctx.session = ctx.session ?? defaultSession();
    const last = Number(ctx.session.lastUpdateId ?? 0);
    if (last && updateId <= last) return;
    ctx.session.lastUpdateId = updateId;
    return next();
  });

  // Дедуп по сущностям Telegram, если update_id отличается, но событие то же:
  // - message_id для текстовых сообщений
  // - callback_query.id для нажатий кнопок
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return next();
    ctx.session = ctx.session ?? defaultSession();

    const msgId = ctx.message?.message_id;
    if (typeof msgId === "number") {
      const lastMsgId = Number(ctx.session.lastMessageId ?? 0);
      if (lastMsgId === msgId) {
        console.log("ignored duplicate message_id:", { uid, msgId, updateId: ctx.update?.update_id });
        return;
      }
      ctx.session.lastMessageId = msgId;
    }

    const cbqId = ctx.callbackQuery?.id;
    if (typeof cbqId === "string" && cbqId) {
      const lastCbqId = String(ctx.session.lastCallbackQueryId ?? "");
      if (lastCbqId === cbqId) {
        console.log("ignored duplicate callback_query.id:", {
          uid,
          cbqId,
          data: ctx.callbackQuery?.data,
          updateId: ctx.update?.update_id,
        });
        return;
      }
      ctx.session.lastCallbackQueryId = cbqId;
    }

    return next();
  });

  bot.command("start", async (ctx) => {
    // Важно: не затирать поля дедупликации, иначе при ретраях Telegram получим дубль.
    const prev = ctx.session ?? defaultSession();
    const uid = ctx.from?.id;
    const profile = uid !== undefined ? await getUserProfile(ctx.db, uid) : null;

    ctx.session = {
      ...defaultSession(),
      phase: profile ? "idle" : "onboarding",
      onboardingStep: profile ? undefined : "lang",
      onboarding: profile
        ? undefined
        : {
            lang: "ru",
            gender: null,
            birthYear: null,
          },
      lastUpdateId: ctx.update?.update_id ?? prev.lastUpdateId ?? undefined,
      lastMessageId: prev.lastMessageId,
      lastCallbackQueryId: prev.lastCallbackQueryId,
    };

    if (!profile) {
      await ctx.reply(uiText("ru", "onboardingLang"), { reply_markup: onboardingLangKeyboard() });
      await ctx.reply("Настройки:", { reply_markup: reminderOpenKeyboard() });
      return;
    }

    // Профиль уже есть — запускаем/предлагаем опрос (не чаще 1 раза в сутки)
    if (uid !== undefined && ctx.db) {
      const already = await hasCompletedSurveyToday(ctx.db, uid, new Date());
      if (already) {
        await ctx.reply(uiText(profile.language, "alreadyToday") + "\n\n" + uiText(profile.language, "startSurveyHint"));
        await ctx.reply("Настройки:", { reply_markup: reminderOpenKeyboard() });
        return;
      }
    }

    await ctx.reply("Настройки:", { reply_markup: reminderOpenKeyboard() });
    await startFollowUpSurvey(ctx);
  });

  bot.command("survey", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const profile = await getUserProfile(ctx.db, uid);
    if (!profile) {
      // Профиля нет — запускаем анкету
      const prev = ctx.session ?? defaultSession();
      ctx.session = {
        ...defaultSession(),
        phase: "onboarding",
        onboardingStep: "lang",
        onboarding: { lang: "ru", gender: null, birthYear: null },
        lastUpdateId: ctx.update?.update_id ?? prev.lastUpdateId ?? undefined,
        lastMessageId: prev.lastMessageId,
        lastCallbackQueryId: prev.lastCallbackQueryId,
      };
      await ctx.reply(uiText("ru", "onboardingLang"), { reply_markup: onboardingLangKeyboard() });
      return;
    }
    if (ctx.db) {
      const already = await hasCompletedSurveyToday(ctx.db, uid, new Date());
      if (already) {
        await ctx.reply(uiText(profile.language, "alreadyToday"));
        return;
      }
    }
    await startFollowUpSurvey(ctx);
  });

  bot.command("cancel", async (ctx) => {
    // Сохраняем дедуп-поля при сбросе.
    const prev = ctx.session ?? defaultSession();
    ctx.session = {
      ...defaultSession(),
      lastUpdateId: prev.lastUpdateId,
      lastMessageId: prev.lastMessageId,
      lastCallbackQueryId: prev.lastCallbackQueryId,
    };
    const uid = ctx.from?.id;
    const profile = uid ? await getUserProfile(ctx.db, uid) : null;
    const lang = profile?.language ?? ctx.session?.onboarding?.lang ?? "ru";
    await ctx.reply(uiText(lang, "cancelled"));
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
        "Тестовое приглашение на опрос.\n\nПожалуйста, пройдите опрос — отправьте /start",
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

  bot.callbackQuery(/^onb:lang:(ru|en)$/, async (ctx) => {
    const s = ctx.session ?? defaultSession();
    if (s.phase !== "onboarding") {
      await ctx.answerCallbackQuery({ text: uiText("ru", "needStart") });
      return;
    }
    const lang = ctx.callbackQuery.data.slice("onb:lang:".length);
    s.onboarding = s.onboarding ?? { lang: "ru", gender: null, birthYear: null };
    s.onboarding.lang = lang === "en" ? "en" : "ru";
    s.onboardingStep = "gender";
    ctx.session = s;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply(uiText(s.onboarding.lang, "onboardingGender"), {
      reply_markup: onboardingGenderKeyboard(s.onboarding.lang),
    });
  });

  bot.callbackQuery(/^onb:gender:(m|f)$/, async (ctx) => {
    const s = ctx.session ?? defaultSession();
    if (s.phase !== "onboarding") {
      await ctx.answerCallbackQuery({ text: uiText("ru", "needStart") });
      return;
    }
    s.onboarding = s.onboarding ?? { lang: "ru", gender: null, birthYear: null };
    const g = ctx.callbackQuery.data.slice("onb:gender:".length);
    s.onboarding.gender = g === "f" ? "f" : "m";
    s.onboardingStep = "birth_year";
    ctx.session = s;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply(uiText(s.onboarding.lang, "onboardingBirthYear"));
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const s = ctx.session ?? defaultSession();
    const uid = ctx.from?.id;
    const lang = s?.onboarding?.lang ?? "ru";

    if (s.phase === "onboarding" && s.onboardingStep === "birth_year") {
      const trimmed = text.trim();
      if (!trimmed) {
        await ctx.reply(uiText(lang, "emptyAnswer"));
        return;
      }
      if (!ctx.db || !uid) {
        await ctx.reply("D1 не подключена (binding DB).");
        return;
      }
      s.onboarding = s.onboarding ?? { lang: "ru", gender: null, birthYear: null };
      s.onboarding.birthYear = trimmed;
      if (!s.onboarding.gender) {
        await ctx.reply(uiText(lang, "needStart"));
        return;
      }
      await upsertUserProfile(ctx.db, uid, {
        language: s.onboarding.lang === "en" ? "en" : "ru",
        gender: s.onboarding.gender === "f" ? "f" : "m",
        birth_year: String(s.onboarding.birthYear ?? ""),
      });
      // После сохранения профиля переходим к опросу (с учётом ограничения “1 раз в день”)
      s.phase = "idle";
      delete s.onboardingStep;
      delete s.onboarding;
      ctx.session = s;

      const already = await hasCompletedSurveyToday(ctx.db, uid, new Date());
      if (already) {
        const profile = await getUserProfile(ctx.db, uid);
        await ctx.reply(uiText(profile?.language ?? "ru", "alreadyToday"));
        return;
      }
      await startFollowUpSurvey(ctx);
      return;
    }

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
      const profile = uid ? await getUserProfile(ctx.db, uid) : null;
      const l = profile?.language ?? lang;
      await ctx.reply(uiText(l, "startSurveyHint"));
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      const profile = uid ? await getUserProfile(ctx.db, uid) : null;
      const l = profile?.language ?? lang;
      await ctx.reply(uiText(l, "emptyAnswer"));
      return;
    }

    s.answers.push(trimmed);
    const next = s.followUpIndex + 1;

    if (next >= FOLLOW_UP_QUESTIONS.length) {
      const answersSnapshot = [...s.answers];
      const profile = uid ? await getUserProfile(ctx.db, uid) : null;

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
              null,
            )
            .run();
        } catch (e) {
          console.error("survey_responses INSERT:", e);
        }
      }

      s.phase = "done";
      delete s.followUpIndex;
      delete s.answers;

      await ctx.reply(
        uiText(profile?.language ?? lang, "doneThanks") +
          "\n\n" +
          uiText(profile?.language ?? lang, "answersHeader") +
          "\n\n" +
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
let commandsConfigured = false;

// Fallback идемпотентность без D1: небольшой LRU по update_id в памяти изолята.
// Не даёт 100% гарантию (изолят может пересоздаваться), но убирает типичные дубли при ретраях.
const RECENT_UPDATE_IDS_MAX = 5000;
/** @type {Map<number, number>} */
const recentUpdateIds = new Map();

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

    // Читаем body и делаем идемпотентность как можно раньше:
    // на cold start `bot.init()` может занять время, и Telegram успевает ретраить тот же update_id.
    const rawBody = await request.text();
    let updateId;
    try {
      const parsed = JSON.parse(rawBody);
      if (typeof parsed?.update_id === "number") updateId = parsed.update_id;
    } catch {
      /* не JSON — отдадим в grammY как есть */
    }

    if (updateId !== undefined) {
      if (recentUpdateIds.has(updateId)) {
        return new Response("ok", { status: 200 });
      }
      recentUpdateIds.set(updateId, Date.now());
      if (recentUpdateIds.size > RECENT_UPDATE_IDS_MAX) {
        const oldestKey = recentUpdateIds.keys().next().value;
        if (oldestKey !== undefined) recentUpdateIds.delete(oldestKey);
      }
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

    if (!cachedBot || cachedToken !== env.BOT_TOKEN) {
      cachedBot = createBot(env);
      cachedToken = env.BOT_TOKEN;
      commandsConfigured = false;
      try {
        await cachedBot.init();
      } catch (e) {
        console.error("bot.init (проверьте BOT_TOKEN и доступ к api.telegram.org):", e);
        return new Response("Bot init failed", { status: 503 });
      }
    }

    if (!commandsConfigured) {
      try {
        await cachedBot.api.setMyCommands([
          { command: "start", description: "Начать" },
          { command: "survey", description: "Пройти опрос (9 вопросов)" },
          { command: "reminder", description: "Напоминания" },
          { command: "cancel", description: "Отмена" },
        ]);
        commandsConfigured = true;
      } catch (e) {
        console.error("setMyCommands:", e);
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

      // Если уже проходил опрос сегодня — не отправляем повторное приглашение
      const already = await hasCompletedSurveyToday(env.DB, uid, now);
      if (already) continue;

      const ok = await sendTelegramMessage(
        env,
        uid,
        `Пора пройти опрос (${desired} ${tz}).\n\nПожалуйста, начните опрос — отправьте /survey\n\nНастройки времени: /reminder`,
      );
      console.log("scheduled invite:", { uid, tz, desired, ok });
      if (!ok) continue;

      try {
        await updateReminderRow(env.DB, uid, { last_sent_local_date: ymd });
      } catch (e) {
        console.error("reminder_settings UPDATE:", e);
      }
    }
  },
};
