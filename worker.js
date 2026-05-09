/**
 * ============================================================================
 * Cloudflare Worker: Telegram-бот ежедневного опроса (grammY + D1 + Cron)
 * ============================================================================
 *
 * Назначение:
 * - Принимать апдейты Telegram по HTTPS webhook (`POST /webhook`).
 * - Вести короткий onboarding (язык → пол → год рождения) и блок из 9 вопросов
 *   (`FOLLOW_UP_QUESTIONS` из `constants.js`).
 * - Сохранять ответы и профиль в D1; сессию диалога — в JSON в таблице `sessions`.
 * - Показывать статистику по дням/неделям и выгрузку CSV.
 * - По расписанию Worker (Cron) отправлять напоминание «пройти опрос», если у
 *   пользователя включено напоминание и локальное время совпало с настройкой.
 *
 * Важные детали окружения:
 * - `env.BOT_TOKEN` — секрет; без него webhook отвечает 503.
 * - `env.DB` — binding D1; если отсутствует, часть функций сообщает об этом в чат.
 * - `env.MINI_APP_URL` — секрет: HTTPS URL мини-приложения (`…/app/`) для кнопки Web App в `/start`.
 * - `env.ASSETS` — раздача статики React (`mini-app/dist`), см. `[assets]` в `wrangler.toml`.
 * - `env.WEBHOOK_SECRET` — опционально: тогда Telegram должен слать заголовок
 *   `X-Telegram-Bot-Api-Secret-Token` с тем же значением, что задано в `setWebhook`.
 *
 * Идемпотентность (защита от повторной доставки одного и того же update):
 * - LRU в памяти изолята по `update_id` (быстрый фильтр до тяжёлой логики).
 * - Таблица `processed_updates` в D1 — если INSERT не вставил строку, update уже
 *   обрабатывали в другом запросе/изоляте — сразу отвечаем 200 «ok».
 * - В сессии пользователя: `lastUpdateId`, дубли `message_id`, дубли `callback_query.id`.
 *
 * ============================================================================
 */

import { Bot, webhookCallback, InlineKeyboard, InputFile } from "grammy";
import {
  FOLLOW_UP_QUESTIONS,
} from "./constants.js";

/**
 * HMAC-SHA-256 с сырым ключом (Uint8Array) и данными (Uint8Array), результат — Uint8Array.
 *
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} dataBytes
 */
async function hmacSha256Raw(keyBytes, dataBytes) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
  return new Uint8Array(sig);
}

/**
 * Сравнение байтовых массивов в стиле timing-safe (длины должны совпадать).
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
function timingSafeEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i];
  return x === 0;
}

/**
 * Парсит hex-строку длиной 64 (32 байта) в Uint8Array.
 *
 * @param {string} hex
 */
function hexToBytes32(hex) {
  const s = String(hex).trim();
  if (s.length !== 64) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 64; i += 2) {
    const n = Number.parseInt(s.slice(i, i + 2), 16);
    if (Number.isNaN(n)) return null;
    out[i / 2] = n;
  }
  return out;
}

/**
 * Валидация `Telegram.WebApp.initData` по схеме из документации Mini Apps.
 *
 * @param {string} initData — сырая строка query-string из заголовка
 * @param {string} botToken
 * @param {number} [maxAgeSec=86400]
 * @returns {Promise<{ ok: true, userId: number, user: object } | { ok: false, error: string }>}
 */
async function validateTelegramWebAppInitData(initData, botToken, maxAgeSec = 86400) {
  const init = typeof initData === "string" ? initData.trim() : "";
  const token = typeof botToken === "string" ? botToken.trim() : "";
  if (!init || !token) return { ok: false, error: "missing_init_or_token" };
  let params;
  try {
    params = new URLSearchParams(init);
  } catch {
    return { ok: false, error: "bad_init_data" };
  }
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "missing_hash" };
  /** @type {Array<[string, string]>} */
  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const te = new TextEncoder();
  const secretKey = await hmacSha256Raw(te.encode("WebAppData"), te.encode(token));
  const computed = await hmacSha256Raw(secretKey, te.encode(dataCheckString));
  const hashBytes = hexToBytes32(hash);
  if (!hashBytes || !timingSafeEqualBytes(computed, hashBytes)) {
    return { ok: false, error: "bad_hash" };
  }
  const authDate = Number(params.get("auth_date") ?? "0");
  if (!authDate || Number.isNaN(authDate)) return { ok: false, error: "missing_auth_date" };
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSec) return { ok: false, error: "auth_expired" };
  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, error: "missing_user" };
  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { ok: false, error: "bad_user_json" };
  }
  if (typeof user?.id !== "number") return { ok: false, error: "bad_user_id" };
  return { ok: true, userId: user.id, user };
}

/**
 * JSON-ответ для Mini App API.
 *
 * @param {unknown} body
 * @param {number} [status=200]
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Vite для мини-приложения задаёт `base: "/app/"`, поэтому в браузере открывают `…/app/`,
 * а `mini-app/dist` содержит файлы в корне каталога: `index.html`, `assets/…`.
 * У биндинга `ASSETS` путь URL сопоставляется с путём внутри `dist` без префикса `/app`,
 * из‑за чего запросы вида `/app/` и `/app/assets/…` иначе дают 404. Переписываем их в `/` и `/assets/…`.
 *
 * @param {Request} request
 * @param {string} path — `url.pathname` без завершающего `/` (как в этом `fetch`)
 */
function requestForStaticAssets(request, path) {
  if (path !== "/app" && !path.startsWith("/app/")) {
    return request;
  }
  const u = new URL(request.url);
  const inner = path === "/app" ? "/" : path.slice("/app".length);
  u.pathname = inner.length ? inner : "/";
  return new Request(u.toString(), request);
}

/**
 * Извлекает и валидирует `user_id` из заголовка `X-Telegram-Init-Data`.
 *
 * @param {Request} request
 * @param {{ BOT_TOKEN?: string }} env
 */
async function requireTelegramMiniAppUser(request, env) {
  const init = request.headers.get("X-Telegram-Init-Data") ?? "";
  const token = env.BOT_TOKEN ? String(env.BOT_TOKEN).trim() : "";
  return validateTelegramWebAppInitData(init, token);
}

/**
 * Начальное состояние «машины» диалога в `ctx.session`.
 * `phase: "idle"` — пользователь не в onboarding и не в опросе; остальные поля
 * подмешиваются по мере сценария (см. middleware загрузки/сохранения сессии).
 */
function defaultSession() {
  return { phase: "idle" };
}

/**
 * Inline-клавиатура экрана настроек напоминания (команда /reminder и колбэки `rem:*`).
 * Кнопки не несут динамических данных — только действия: вкл/выкл, ввод времени,
 * выбор часового пояса из пресетов, тестовая отправка сообщения.
 */
function reminderTimeKeyboard() {
  return new InlineKeyboard()
    .text("Вкл/выкл", "rem:toggle")
    .text("Время", "rem:set_time")
    .row()
    .text("Часовой пояс", "rem:set_tz")
    .text("Тест сейчас", "rem:test");
}

/**
 * Клавиатура «Настройки»: напоминания и статистика.
 * Callback-префиксы: `rem:open` — открыть экран напоминаний; `st:o` — статистика.
 *
 * @param {'ru'|'en'} lang — язык подписей кнопок (из профиля или дефолт).
 */
function settingsKeyboard(lang) {
  return new InlineKeyboard()
    .text(uiText(lang, "remindersBtn"), "rem:open")
    .text(uiText(lang, "statisticsBtn"), "st:o");
}

/**
 * Строгий формат времени для напоминаний: `HH:MM`, 24-часовой вид.
 * Именованные группы в regex не обязательны для логики — достаточно полного совпадения строки.
 */
const REMINDER_TIME_RE = /^(?<hh>[01]\d|2[0-3]):(?<mm>[0-5]\d)$/;

/**
 * Гарантирует наличие строки `reminder_settings` для пользователя.
 * Если записи не было — вставляет дефолты (UTC, 09:00, выключено), затем возвращает строку SELECT.
 * Используется перед любым показом UI напоминаний и перед UPDATE.
 *
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId — Telegram `from.id`
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
 * Частичный UPDATE строки напоминаний: в массив `fields` попадают только те колонки,
 * для которых в `patch` передан ожидаемый тип (строка для timezone/time, число для enabled).
 * `last_sent_local_date` можно явно сбросить в `null` при смене TZ, чтобы снова можно было
 * отправить напоминание «в тот же календарный день» по новой зоне.
 *
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

/**
 * Человекочитаемое текстовое резюме настроек напоминания для сообщения в чат.
 * Не локализовано под en — экран напоминаний в основном на русском продуктовом тексте.
 *
 * @param {any} row — строка из D1 `reminder_settings` или null
 */
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

/**
 * Разбивает момент `date` на локальную календарную дату `ymd` и локальное время `hm`
 * в IANA-таймзоне `timeZone`, используя `Intl.DateTimeFormat` (в Workers доступен).
 * При невалидной/неподдерживаемой зоне молча откатывается на UTC — чтобы не ронять cron/UI.
 *
 * @param {Date} date
 * @param {string} timeZone — IANA, например `Europe/Moscow`
 * @returns {{ ymd: string, hm: string, tz: string }} `ymd` как `YYYY-MM-DD`, `hm` как `HH:MM`
 */
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

/**
 * Проверка строки как IANA timezone: `Intl` бросает при невалидном идентификаторе.
 *
 * @param {string} tz
 */
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
 * Минимальный вызов `sendMessage` через HTTP к api.telegram.org без grammY.
 * Нужен в Cron (`scheduled`): там нет контекста бота и нельзя тянуть тяжёлый стек.
 * Возвращает boolean успеха; тело ошибки логируется в консоль Worker.
 *
 * @param {{BOT_TOKEN:string}} env
 * @param {number} chatId — обычно совпадает с `user_id` в D1 для личных чатов
 * @param {string} text — plain text, без parse_mode
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
 * Читает одну строку `user_profile` или null при отсутствии/ошибке.
 *
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
 * INSERT с ON CONFLICT по `user_id`: создаёт профиль или обновляет поля и `updated_at`.
 * `created_at` выставляется только при первой вставке (через INSERT VALUES).
 *
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

/**
 * Одна завершённая попытка опроса в `survey_responses` (как в обработчике текста бота).
 *
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 * @param {string[]} answersSnapshot
 * @param {unknown} [screeningJson] — опционально сериализуется в JSON; `null` как в чат-ветке
 */
async function insertSurveyResponse(db, userId, answersSnapshot, screeningJson = null) {
  if (!db) return false;
  try {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO survey_responses (user_id, completed_at, answers_json, screening_json)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(
        userId,
        now,
        JSON.stringify(answersSnapshot),
        screeningJson === null || screeningJson === undefined ? null : JSON.stringify(screeningJson),
      )
      .run();
    return true;
  } catch (e) {
    console.error("insertSurveyResponse:", e);
    return false;
  }
}

/**
 * Централизованные строки UI для ru/en. Ключи — внутренние константы (`needStart` и т.д.).
 * Неизвестный ключ даёт запасной текст «сначала /start», чтобы не показывать `undefined`.
 *
 * @param {'ru'|'en'} lang
 * @param {string} key
 */
function uiText(lang, key) {
  const l = lang === "en" ? "en" : "ru";
  /** @type {Record<string, {ru:string,en:string}>} */
  const m = {
    onboardingLang: { ru: "Выберите язык:", en: "Choose a language:" },
    onboardingGender: { ru: "Выберите пол:", en: "Select gender:" },
    onboardingBirthYear: { ru: "Введите год рождения:", en: "Enter birth year:" },
    onboardingReminder: {
      ru: "Хотите получать напоминания об опросе? Откройте настройки:",
      en: "Want reminders about the survey? Open settings:",
    },
    emptyAnswer: { ru: "Пожалуйста, отправьте непустой ответ.", en: "Please send a non-empty answer." },
    alreadyToday: { ru: "Сегодня вы уже проходили опрос. Приходите завтра.", en: "You have already completed the survey today. Please come back tomorrow." },
    startSurveyHint: { ru: "Чтобы пройти опрос, отправьте /survey", en: "To take the survey, send /survey" },
    cancelled: { ru: "Опрос отменён. Отправьте /start чтобы начать снова.", en: "Cancelled. Send /start to begin again." },
    needStart: { ru: "Сначала отправьте /start", en: "Please send /start first" },
    doneThanks: { ru: "Спасибо! Вы ответили на все вопросы.", en: "Thanks! You answered all questions." },
    remindersBtn: { ru: "Напоминания ⏰", en: "Reminders ⏰" },
    statisticsBtn: { ru: "Статистика", en: "Statistics" },
    settingsHeader: { ru: "Настройки:", en: "Settings:" },
    statsTitle: { ru: "Статистика опросов", en: "Survey statistics" },
    statsModeHint: {
      ru: "Выберите просмотр: по дням (календарь) или по неделям.",
      en: "Choose view: by day (calendar) or by week.",
    },
    statsByDays: { ru: "По дням", en: "By day" },
    statsByWeeks: { ru: "По неделям", en: "By week" },
    statsBackSettings: { ru: "Назад к настройкам", en: "Back to settings" },
    statsBackModes: { ru: "К режимам", en: "Back to modes" },
    statsBackCalendar: { ru: "К календарю", en: "Back to calendar" },
    statsBackWeek: { ru: "К неделе", en: "Back to week" },
    statsEmpty: { ru: "Пока нет завершённых опросов.", en: "No completed surveys yet." },
    statsNoDb: { ru: "База данных недоступна.", en: "Database unavailable." },
    statsDayHeader: { ru: "Ответы за", en: "Answers for" },
    statsWeekHeader: { ru: "Неделя", en: "Week" },
    statsWeekCount: { ru: "Завершений за неделю:", en: "Completions this week:" },
    statsPassAt: { ru: "Прохождение", en: "Completion" },
    statsCalendarHint: { ru: "Точка — есть ответы в этот день. Выберите день.", en: "Dot = answers that day. Pick a day." },
    statsWeekPickDay: {
      ru: "Нажмите день недели для подробностей.",
      en: "Tap a day below for details.",
    },
    statsNoDayEntries: { ru: "Нет записей", en: "No entries" },
    statsExportBtn: { ru: "Скачать таблицу", en: "Download spreadsheet" },
    statsExportCaption: {
      ru: "Файл CSV — откройте в Excel (UTF-8).",
      en: "CSV file — open in Excel (UTF-8).",
    },
    statsExportColTime: { ru: "Дата и время", en: "Date and time" },
    miniAppWelcome: {
      ru: "Здравствуйте! Пройдите короткий опрос в мини-приложении — язык, пол, год рождения и несколько вопросов. Данные сохраняются в защищённом хранилище.",
      en: "Hello! Please take a short survey in the mini app — language, gender, birth year, and a few questions. Your answers are stored securely.",
    },
    openMiniAppBtn: { ru: "Открыть приложение", en: "Open app" },
    miniAppUrlMissing: {
      ru: "Адрес мини-приложения не настроен (секрет MINI_APP_URL). Обратитесь к администратору.",
      en: "Mini App URL is not configured (MINI_APP_URL secret). Please contact the administrator.",
    },
  };
  return (m[key] ?? m.needStart)[l];
}

/** Inline-кнопки выбора языка на первом шаге onboarding; callback: `onb:lang:ru|en`. */
function onboardingLangKeyboard() {
  return new InlineKeyboard().text("Русский", "onb:lang:ru").text("English", "onb:lang:en");
}

/**
 * Кнопки пола; подписи зависят от уже выбранного языка.
 * Callback: `onb:gender:m|f`.
 */
function onboardingGenderKeyboard(lang) {
  if (lang === "en") {
    return new InlineKeyboard().text("Male", "onb:gender:m").text("Female", "onb:gender:f");
  }
  return new InlineKeyboard().text("Мужской", "onb:gender:m").text("Женский", "onb:gender:f");
}

/**
 * Десериализация JSON из `sessions.state`. При пустой строке/битом JSON/bез строки —
 * возвращает `defaultSession()`. Ошибки D1 логируются и также дают дефолт.
 *
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
 * UPSERT сессии: полный объект `state` сериализуется в JSON (включая служебные поля дедупа).
 * Вызывается после `next()` в middleware, чтобы записать изменения, сделанные хендлерами.
 *
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 * @param {object} state — произвольный объект сессии grammY
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
 * Таймзона для статистики и «один раз в день»: берётся из `reminder_settings.timezone`,
 * иначе UTC. Пустая строка после trim считается отсутствием значения.
 *
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
 * true, если последняя запись в `survey_responses` приходится на тот же локальный
 * календарный день, что и `now`, в таймзоне пользователя из напоминаний/профиля.
 * Используется и в боте («уже проходили сегодня»), и в cron (не слать напоминание).
 *
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 * @param {Date} now — обычно `new Date()` в момент проверки
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

/**
 * Возвращает UTC-миллисекунды такого момента, что в таймзоне `tz` локальная дата
 * ровно `y-mo-d`. Алгоритм: старт с полудня UTC по григорианскому календарю и
 * итеративная подгонка ±1 час (до 48 шагов), сравнивая `safeLocalParts(...).ymd`
 * с целевой строкой — нужно для DST и смещений, где «полдень UTC» не попадает в нужный локальный день.
 *
 * @param {number} y
 * @param {number} mo1to12
 * @param {number} d
 * @param {string} tz
 */
function instantForLocalDate(y, mo1to12, d, tz) {
  const target = `${y}-${String(mo1to12).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let guess = Date.UTC(y, mo1to12 - 1, d, 12, 0, 0);
  for (let i = 0; i < 48; i++) {
    const { ymd } = safeLocalParts(new Date(guess), tz);
    if (ymd === target) return guess;
    guess += ymd < target ? 3600000 : -3600000;
  }
  return guess;
}

/**
 * День недели в выбранной таймзоне: понедельник = 0 … воскресенье = 6.
 * Реализовано через короткое английское имя дня недели от `Intl` и таблицу соответствий.
 *
 * @param {number} utcMs
 * @param {string} tz
 */
function localWeekdayMon0FromUtcMs(utcMs, tz) {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(utcMs));
  /** @type {Record<string, number>} */
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[short] ?? 0;
}

/**
 * Число дней в месяце `mo1to12` для года `y` (григорианский календарь), через Date.
 *
 * @param {number} y
 * @param {number} mo1to12
 */
function daysInGregorianMonth(y, mo1to12) {
  return new Date(y, mo1to12, 0).getDate();
}

/**
 * Сдвиг локальной даты `ymd` на `delta` календарных дней внутри таймзоны `tz`.
 * Учитывает переходы DST за счёт перевода через UTC-ms и `safeLocalParts`.
 *
 * @param {string} ymd `YYYY-MM-DD`
 * @param {number} delta — может быть отрицательным
 * @param {string} tz
 */
function addLocalDays(ymd, delta, tz) {
  const [y, m, d] = ymd.split("-").map(Number);
  const ms = instantForLocalDate(y, m, d, tz) + delta * 86400000;
  return safeLocalParts(new Date(ms), tz).ymd;
}

/**
 * Локальный понедельник недели, содержащей дату `ymd` (неделя понедельник–воскресенье).
 *
 * @param {string} ymd
 * @param {string} tz
 */
function mondayYmdOfWeekContaining(ymd, tz) {
  const [y, m, d] = ymd.split("-").map(Number);
  const ms = instantForLocalDate(y, m, d, tz);
  const w = localWeekdayMon0FromUtcMs(ms, tz);
  return addLocalDays(ymd, -w, tz);
}

/**
 * `YYYY-MM-DD` → `YYYYMMDD` для коротких `callback_data` Telegram (лимит 64 байта на кнопку).
 * @param {string} ymd
 */
function ymdToCompact8(ymd) {
  return ymd.replace(/-/g, "");
}

/**
 * Обратное к `ymdToCompact8`; при неверной длине возвращает null (некорректный callback).
 * @param {string} compact8 `YYYYMMDD`
 */
function compact8ToYmd(compact8) {
  const s = String(compact8);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Кодирует год и месяц в число `YYYYMM` для callback календаря (`st:mo:202405`).
 * @param {string} ymd
 */
function ymdToYmm(ymd) {
  return parseInt(ymd.slice(0, 4) + ymd.slice(5, 7), 10);
}

/**
 * Арифметика по календарным месяцам для навигации ‹/› в статистике.
 * @param {number} yyyymm
 * @param {number} delta — обычно ±1
 */
function shiftMonthYmm(yyyymm, delta) {
  let y = Math.floor(yyyymm / 100);
  let mo = yyyymm % 100;
  mo += delta;
  while (mo < 1) {
    mo += 12;
    y -= 1;
  }
  while (mo > 12) {
    mo -= 12;
    y += 1;
  }
  return y * 100 + mo;
}

/**
 * Все завершённые опросы пользователя по возрастанию `completed_at` (unix seconds).
 * Нужен для календаря, недельной сводки и экспорта CSV.
 *
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 */
async function listSurveyResponsesForUser(db, userId) {
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT completed_at, answers_json FROM survey_responses WHERE user_id = ? ORDER BY completed_at ASC`,
      )
      .bind(userId)
      .all();
    return res?.results ?? [];
  } catch (e) {
    console.error("listSurveyResponsesForUser:", e);
    return [];
  }
}

/**
 * Достаёт из D1 JSON-массив ответов; не-массив и parse error → пустой массив строк.
 * @param {unknown} json
 */
function parseAnswersJson(json) {
  try {
    const a = JSON.parse(String(json ?? "[]"));
    return Array.isArray(a) ? a.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/**
 * RFC-стиль экранирования ячейки CSV: кавычки, запятая, CR/LF → оборачивание в `"` и удвоение `"`.
 * @param {string} s
 */
function csvEscapeCell(s) {
  const str = String(s ?? "");
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * UTF-8 CSV с BOM (`EF BB BF`) для корректного открытия в Excel; строка = одно завершение опроса.
 * Первая колонка — локальные дата+время в `tz`; далее по одной колонке на каждый вопрос из константы.
 *
 * @param {any[]} rows D1: completed_at, answers_json
 * @param {string} tz IANA
 * @param {'ru'|'en'} lang — язык заголовка колонки времени
 */
function buildSurveyExportCsvBytes(rows, tz, lang) {
  const l = lang === "en" ? "en" : "ru";
  const n = FOLLOW_UP_QUESTIONS.length;
  const headerCells = [uiText(l, "statsExportColTime"), ...FOLLOW_UP_QUESTIONS.map((q) => String(q))];
  const lines = [headerCells.map(csvEscapeCell).join(",")];
  const sorted = [...rows].sort((a, b) => Number(a.completed_at) - Number(b.completed_at));
  for (const row of sorted) {
    const sec = Number(row.completed_at);
    const { ymd, hm } = safeLocalParts(new Date(sec * 1000), tz);
    const answers = parseAnswersJson(row.answers_json);
    const cells = [`${ymd} ${hm}`];
    for (let i = 0; i < n; i++) cells.push(answers[i] ?? "");
    lines.push(cells.map(csvEscapeCell).join(","));
  }
  const body = lines.join("\r\n");
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const enc = new TextEncoder().encode(body);
  const out = new Uint8Array(bom.length + enc.length);
  out.set(bom, 0);
  out.set(enc, bom.length);
  return out;
}

/**
 * Группировка ответов по локальной дате `YYYY-MM-DD` в таймзоне `tz`.
 * Значение — массив прохождений в этот день (несколько опросов в один день возможны).
 *
 * @param {any[]} rows D1 rows completed_at, answers_json
 * @param {string} tz
 * @returns {Map<string, { completedAtSec: number, answers: string[] }[]>}
 */
function bucketResponsesByLocalYmd(rows, tz) {
  /** @type {Map<string, { completedAtSec: number, answers: string[] }[]>} */
  const map = new Map();
  for (const row of rows) {
    const sec = Number(row.completed_at);
    const ymd = safeLocalParts(new Date(sec * 1000), tz).ymd;
    const arr = map.get(ymd) ?? [];
    arr.push({ completedAtSec: sec, answers: parseAnswersJson(row.answers_json) });
    map.set(ymd, arr);
  }
  return map;
}

/**
 * Дробит длинный текст на части ≤ maxLen для лимита Telegram (~4096; здесь 3800 с запасом).
 * Предпочитает резать по `\n\n`, затем по одиночному `\n`, чтобы не рвать абзацы посередине.
 *
 * @param {string} text
 * @param {number} maxLen
 */
function splitTextChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + maxLen);
    if (end < text.length) {
      const cut = text.lastIndexOf("\n\n", end);
      if (cut > i + Math.floor(maxLen * 0.5)) end = cut + 2;
      else {
        const cut2 = text.lastIndexOf("\n", end);
        if (cut2 > i + Math.floor(maxLen * 0.5)) end = cut2 + 1;
      }
    }
    const chunk = text.slice(i, end).trimEnd();
    if (chunk) parts.push(chunk);
    i = end;
  }
  return parts.length ? parts : [text.slice(0, maxLen)];
}

/**
 * Текст детального просмотра дня: заголовок, для каждого прохождения — время и нумерованные ответы.
 *
 * @param {'ru'|'en'} lang
 * @param {string} ymd
 * @param {{ completedAtSec: number, answers: string[] }[]} items
 * @param {string} tz
 */
function formatDayDetailText(lang, ymd, items, tz) {
  const l = lang === "en" ? "en" : "ru";
  const lines = [];
  lines.push(`${uiText(l, "statsDayHeader")} ${ymd}`);
  const sorted = [...items].sort((a, b) => a.completedAtSec - b.completedAtSec);
  let p = 1;
  for (const it of sorted) {
    const { hm } = safeLocalParts(new Date(it.completedAtSec * 1000), tz);
    lines.push(`\n${uiText(l, "statsPassAt")} ${p}/${sorted.length} — ${hm}\n`);
    p++;
    lines.push(it.answers.map((a, i) => `${i + 1}. ${a}`).join("\n"));
  }
  return lines.join("\n");
}

/**
 * Первый уровень статистики: режим «по дням» / «по неделям», экспорт, назад в настройки.
 * Callback: `st:md`, `st:mw`, `st:ex`, `st:sb`.
 *
 * @param {'ru'|'en'} lang
 */
function statsModeKeyboard(lang) {
  const l = lang === "en" ? "en" : "ru";
  return new InlineKeyboard()
    .text(uiText(l, "statsByDays"), "st:md")
    .text(uiText(l, "statsByWeeks"), "st:mw")
    .row()
    .text(uiText(l, "statsExportBtn"), "st:ex")
    .row()
    .text(uiText(l, "statsBackSettings"), "st:sb");
}

/**
 * Inline-календарь месяца: стрелки `st:mp`/`st:mn` (пред/след месяц), заголовок `st:mo` (тот же месяц),
 * дни `st:dy:YYYYMMDD` с точкой, если в этот день есть ответы. Первая строка дней недели — заглушки `st:h`.
 *
 * @param {'ru'|'en'} lang
 * @param {number} yyyymm
 * @param {string} tz
 * @param {Map<string, { completedAtSec: number, answers: string[] }[]>} byYmd
 */
function statsCalendarKeyboard(lang, yyyymm, tz, byYmd) {
  const l = lang === "en" ? "en" : "ru";
  const y = Math.floor(yyyymm / 100);
  const mo = yyyymm % 100;
  const kb = new InlineKeyboard();
  const monthTitle = new Intl.DateTimeFormat(l === "en" ? "en" : "ru", { month: "long", year: "numeric" }).format(
    new Date(y, mo - 1, 1),
  );
  kb.text("‹", `st:mp:${yyyymm}`)
    .text(monthTitle, `st:mo:${yyyymm}`)
    .text("›", `st:mn:${yyyymm}`)
    .row();
  const wk = l === "en" ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  for (const lab of wk) kb.text(lab, "st:h");
  kb.row();
  const firstDow = localWeekdayMon0FromUtcMs(instantForLocalDate(y, mo, 1, tz), tz);
  let col = 0;
  for (let i = 0; i < firstDow; i++) {
    kb.text("·", "st:h");
    col++;
  }
  const dim = daysInGregorianMonth(y, mo);
  for (let day = 1; day <= dim; day++) {
    const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const n = (byYmd.get(ymd) ?? []).length;
    const tag = ymdToCompact8(ymd);
    const label = n > 0 ? `${day}·` : `${day}`;
    kb.text(label, `st:dy:${tag}`);
    col++;
    if (col % 7 === 0) kb.row();
  }
  if (col % 7 !== 0) kb.row();
  kb.text(uiText(l, "statsBackModes"), "st:rm");
  return kb;
}

/**
 * Недельная полоса: понедельник `mondayYmd` + 6 дней, навигация `st:wp`/`st:wn` на ±7 локальных дней.
 * Центральная кнопка `st:wk` — заглушка под заголовок (точка), чтобы не раздувать callback.
 *
 * @param {'ru'|'en'} lang
 * @param {string} mondayYmd
 * @param {string} tz
 * @param {Map<string, { completedAtSec: number, answers: string[] }[]>} byYmd
 */
function statsWeekKeyboard(lang, mondayYmd, tz, byYmd) {
  const l = lang === "en" ? "en" : "ru";
  const mon = ymdToCompact8(mondayYmd);
  const kb = new InlineKeyboard()
    .text("‹", `st:wp:${mon}`)
    .text("·", `st:wk:${mon}`)
    .text("›", `st:wn:${mon}`)
    .row();
  for (let i = 0; i < 7; i++) {
    const ymd = addLocalDays(mondayYmd, i, tz);
    const n = (byYmd.get(ymd) ?? []).length;
    const dom = Number(ymd.slice(-2));
    const label = n > 0 ? `${dom}·` : `${dom}`;
    kb.text(label, `st:dy:${ymdToCompact8(ymd)}`);
  }
  kb.row().text(uiText(l, "statsBackModes"), "st:rm");
  return kb;
}

/**
 * Текст над недельной клавиатурой: диапазон дат недели и суммарное число завершённых опросов за 7 дней.
 *
 * @param {'ru'|'en'} lang
 * @param {string} mondayYmd
 * @param {string} tz
 * @param {Map<string, { completedAtSec: number, answers: string[] }[]>} byYmd
 */
function formatWeekSummaryText(lang, mondayYmd, tz, byYmd) {
  const l = lang === "en" ? "en" : "ru";
  const sun = addLocalDays(mondayYmd, 6, tz);
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const ymd = addLocalDays(mondayYmd, i, tz);
    total += (byYmd.get(ymd) ?? []).length;
  }
  return (
    `${uiText(l, "statsWeekHeader")}: ${mondayYmd} — ${sun}\n` +
    `${uiText(l, "statsWeekCount")} ${total}\n\n` +
    `${uiText(l, "statsWeekPickDay")}`
  );
}

/**
 * Нижняя панель после просмотра дня: назад в календарь нужного месяца (`st:mo:YYYYMM`),
 * назад в неделю (`st:wk:понедельник`), к режимам и к настройкам.
 *
 * @param {'ru'|'en'} lang
 * @param {string} ymd
 * @param {string} tz
 */
function statsDayFooterKeyboard(lang, ymd, tz) {
  const l = lang === "en" ? "en" : "ru";
  const ymm = ymdToYmm(ymd);
  const mon = ymdToCompact8(mondayYmdOfWeekContaining(ymd, tz));
  return new InlineKeyboard()
    .text(uiText(l, "statsBackCalendar"), `st:mo:${ymm}`)
    .text(uiText(l, "statsBackWeek"), `st:wk:${mon}`)
    .row()
    .text(uiText(l, "statsBackModes"), "st:rm")
    .text(uiText(l, "statsBackSettings"), "st:sb");
}

/**
 * Пытается отредактировать сообщение, из которого пришёл callback; если не вышло (старое сообщение,
 * тот же текст и т.д.) — шлёт новое `reply` с тем же текстом и клавиатурой.
 *
 * @param {import('grammy').Context} ctx
 * @param {string} text
 * @param {import('grammy').InlineKeyboard} kb
 */
async function editOrReplyMarkup(ctx, text, kb) {
  const extra = { reply_markup: kb, disable_web_page_preview: true };
  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, extra);
      return;
    }
  } catch (_) {
    /* fallback */
  }
  await ctx.reply(text, extra);
}

/**
 * Единая загрузка данных для экранов статистики: язык из профиля, TZ из напоминаний, сырые строки и карта по дням.
 *
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number} userId
 */
async function loadStatsBundle(db, userId) {
  const profile = await getUserProfile(db, userId);
  const lang = profile?.language === "en" ? "en" : "ru";
  const tz = await getUserTimezone(db, userId);
  const rows = await listSurveyResponsesForUser(db, userId);
  const byYmd = bucketResponsesByLocalYmd(rows, tz);
  return { lang, tz, byYmd, rows };
}

/**
 * Переводит сессию в фазу `followup`, сбрасывает индекс и массив ответов, шлёт первый вопрос из константы.
 * @param {import('grammy').Context} ctx
 */
function startFollowUpSurvey(ctx) {
  const s = ctx.session ?? defaultSession();
  s.phase = "followup";
  s.followUpIndex = 0;
  s.answers = [];
  ctx.session = s;
  return ctx.reply(FOLLOW_UP_QUESTIONS[0]);
}

/**
 * Собирает экземпляр grammY с полной регистрацией middleware и хендлеров.
 * Не вызывает `bot.start()` — в Worker используется только `webhookCallback` в `fetch`.
 *
 * Порядок middleware существенен: сначала try/catch, затем `ctx.db`, загрузка сессии,
 * дедуп по update_id и сущностям, потом команды/callback/text.
 *
 * @param {{ BOT_TOKEN: string, DB: import("@cloudflare/workers-types").D1Database, MINI_APP_URL?: string }} env
 */
function createBot(env) {
  const bot = new Bot(env.BOT_TOKEN);

  // grammY при webhook не навешивает глобальный catch так же предсказуемо, как в long polling — оборачиваем next().
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

  // Прокидываем D1 в контекст — хендлеры обращаются к `ctx.db`, не замыкаясь на `env` в каждом месте.
  bot.use(async (ctx, next) => {
    ctx.db = env.DB;
    await next();
  });

  // Сессия из D1 на входе в апдейт и запись на выходе (после всех вложенных хендлеров).
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

  // --- Команды BotFather: /start, /survey, /cancel, /stats, /reminder (setMyCommands в fetch) ---
  bot.command("start", async (ctx) => {
    const prev = ctx.session ?? defaultSession();
    const uid = ctx.from?.id;
    const miniUrl =
      typeof lastWebhookEnv?.MINI_APP_URL === "string" ? lastWebhookEnv.MINI_APP_URL.trim() : "";

    ctx.session = {
      ...defaultSession(),
      lastUpdateId: ctx.update?.update_id ?? prev.lastUpdateId ?? undefined,
      lastMessageId: prev.lastMessageId,
      lastCallbackQueryId: prev.lastCallbackQueryId,
    };

    const profile = uid !== undefined ? await getUserProfile(ctx.db, uid) : null;
    const lang = profile?.language === "en" ? "en" : "ru";
    const welcome = uiText(lang, "miniAppWelcome");
    if (miniUrl.length > 0) {
      const kb = new InlineKeyboard().webApp(uiText(lang, "openMiniAppBtn"), miniUrl);
      await ctx.reply(welcome, { reply_markup: kb });
      return;
    }
    await ctx.reply(`${welcome}\n\n${uiText(lang, "miniAppUrlMissing")}`);
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

  bot.command("stats", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.reply(uiText("ru", "statsNoDb"));
      return;
    }
    const profile = await getUserProfile(ctx.db, uid);
    const lang = profile?.language === "en" ? "en" : "ru";
    const { rows } = await loadStatsBundle(ctx.db, uid);
    if (rows.length === 0) {
      await ctx.reply(uiText(lang, "statsEmpty"), {
        reply_markup: new InlineKeyboard().text(uiText(lang, "statsBackSettings"), "st:sb"),
      });
      return;
    }
    await ctx.reply(`${uiText(lang, "statsTitle")}\n\n${uiText(lang, "statsModeHint")}`, {
      reply_markup: statsModeKeyboard(lang),
    });
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

  // --- Inline: напоминания (`rem:*`, `tz:*`), onboarding (`onb:*`), статистика (`st:*`) ---
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

  bot.callbackQuery(/^st:h$/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^st:ex$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const profile = await getUserProfile(ctx.db, uid);
    const lang = profile?.language === "en" ? "en" : "ru";
    const tz = await getUserTimezone(ctx.db, uid);
    const rows = await listSurveyResponsesForUser(ctx.db, uid);
    if (rows.length === 0) {
      await ctx.answerCallbackQuery({ text: uiText(lang, "statsEmpty") });
      return;
    }
    const bytes = buildSurveyExportCsvBytes(rows, tz, lang);
    const ymdCompact = safeLocalParts(new Date(), tz).ymd.replace(/-/g, "");
    const filename = `survey_export_${ymdCompact}.csv`;
    await ctx.answerCallbackQuery();
    await ctx.replyWithDocument(new InputFile(bytes, filename), {
      caption: uiText(lang, "statsExportCaption"),
    });
  });

  bot.callbackQuery(/^st:o$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const { lang, rows } = await loadStatsBundle(ctx.db, uid);
    await ctx.answerCallbackQuery();
    if (rows.length === 0) {
      const kb = new InlineKeyboard().text(uiText(lang, "statsBackSettings"), "st:sb");
      await editOrReplyMarkup(ctx, uiText(lang, "statsEmpty"), kb);
      return;
    }
    await editOrReplyMarkup(
      ctx,
      `${uiText(lang, "statsTitle")}\n\n${uiText(lang, "statsModeHint")}`,
      statsModeKeyboard(lang),
    );
  });

  bot.callbackQuery(/^st:sb$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const profile = ctx.db ? await getUserProfile(ctx.db, uid) : null;
    const lang = profile?.language === "en" ? "en" : "ru";
    await ctx.answerCallbackQuery();
    await editOrReplyMarkup(ctx, uiText(lang, "settingsHeader"), settingsKeyboard(lang));
  });

  bot.callbackQuery(/^st:rm$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const { lang, rows } = await loadStatsBundle(ctx.db, uid);
    await ctx.answerCallbackQuery();
    if (rows.length === 0) {
      const kb = new InlineKeyboard().text(uiText(lang, "statsBackSettings"), "st:sb");
      await editOrReplyMarkup(ctx, uiText(lang, "statsEmpty"), kb);
      return;
    }
    await editOrReplyMarkup(
      ctx,
      `${uiText(lang, "statsTitle")}\n\n${uiText(lang, "statsModeHint")}`,
      statsModeKeyboard(lang),
    );
  });

  bot.callbackQuery(/^st:md$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    await ctx.answerCallbackQuery();
    const nowYmd = safeLocalParts(new Date(), tz).ymd;
    const yyyymm = ymdToYmm(nowYmd);
    const text = `${uiText(lang, "statsByDays")}\n\n${uiText(lang, "statsCalendarHint")}`;
    await editOrReplyMarkup(ctx, text, statsCalendarKeyboard(lang, yyyymm, tz, byYmd));
  });

  bot.callbackQuery(/^st:mw$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    await ctx.answerCallbackQuery();
    const nowYmd = safeLocalParts(new Date(), tz).ymd;
    const mon = mondayYmdOfWeekContaining(nowYmd, tz);
    const text = formatWeekSummaryText(lang, mon, tz, byYmd);
    await editOrReplyMarkup(ctx, text, statsWeekKeyboard(lang, mon, tz, byYmd));
  });

  bot.callbackQuery(/^st:mo:(\d{6})$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const yyyymm = parseInt(ctx.match[1], 10);
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    await ctx.answerCallbackQuery();
    const text = `${uiText(lang, "statsByDays")}\n\n${uiText(lang, "statsCalendarHint")}`;
    await editOrReplyMarkup(ctx, text, statsCalendarKeyboard(lang, yyyymm, tz, byYmd));
  });

  bot.callbackQuery(/^st:mp:(\d{6})$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const cur = parseInt(ctx.match[1], 10);
    const yyyymm = shiftMonthYmm(cur, -1);
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    await ctx.answerCallbackQuery();
    const text = `${uiText(lang, "statsByDays")}\n\n${uiText(lang, "statsCalendarHint")}`;
    await editOrReplyMarkup(ctx, text, statsCalendarKeyboard(lang, yyyymm, tz, byYmd));
  });

  bot.callbackQuery(/^st:mn:(\d{6})$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const cur = parseInt(ctx.match[1], 10);
    const yyyymm = shiftMonthYmm(cur, 1);
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    await ctx.answerCallbackQuery();
    const text = `${uiText(lang, "statsByDays")}\n\n${uiText(lang, "statsCalendarHint")}`;
    await editOrReplyMarkup(ctx, text, statsCalendarKeyboard(lang, yyyymm, tz, byYmd));
  });

  bot.callbackQuery(/^st:wk:(\d{8})$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const monYmd = compact8ToYmd(ctx.match[1]);
    if (!monYmd) {
      await ctx.answerCallbackQuery();
      return;
    }
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    await ctx.answerCallbackQuery();
    const text = formatWeekSummaryText(lang, monYmd, tz, byYmd);
    await editOrReplyMarkup(ctx, text, statsWeekKeyboard(lang, monYmd, tz, byYmd));
  });

  bot.callbackQuery(/^st:wp:(\d{8})$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const monYmd = compact8ToYmd(ctx.match[1]);
    if (!monYmd) {
      await ctx.answerCallbackQuery();
      return;
    }
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    const prevMon = addLocalDays(monYmd, -7, tz);
    await ctx.answerCallbackQuery();
    const text = formatWeekSummaryText(lang, prevMon, tz, byYmd);
    await editOrReplyMarkup(ctx, text, statsWeekKeyboard(lang, prevMon, tz, byYmd));
  });

  bot.callbackQuery(/^st:wn:(\d{8})$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const monYmd = compact8ToYmd(ctx.match[1]);
    if (!monYmd) {
      await ctx.answerCallbackQuery();
      return;
    }
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    const nextMon = addLocalDays(monYmd, 7, tz);
    await ctx.answerCallbackQuery();
    const text = formatWeekSummaryText(lang, nextMon, tz, byYmd);
    await editOrReplyMarkup(ctx, text, statsWeekKeyboard(lang, nextMon, tz, byYmd));
  });

  bot.callbackQuery(/^st:dy:(\d{8})$/, async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (!ctx.db) {
      await ctx.answerCallbackQuery({ text: uiText("ru", "statsNoDb") });
      return;
    }
    const ymd = compact8ToYmd(ctx.match[1]);
    if (!ymd) {
      await ctx.answerCallbackQuery();
      return;
    }
    const { lang, tz, byYmd } = await loadStatsBundle(ctx.db, uid);
    const items = byYmd.get(ymd) ?? [];
    if (items.length === 0) {
      await ctx.answerCallbackQuery({ text: uiText(lang, "statsNoDayEntries") });
      return;
    }
    const body = formatDayDetailText(lang, ymd, items, tz);
    const kb = statsDayFooterKeyboard(lang, ymd, tz);
    const chunks = splitTextChunks(body, 3800);
    await ctx.answerCallbackQuery();
    try {
      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(chunks[0], { reply_markup: kb, disable_web_page_preview: true });
      } else {
        await ctx.reply(chunks[0], { reply_markup: kb, disable_web_page_preview: true });
      }
    } catch (_) {
      await ctx.reply(chunks[0], { reply_markup: kb, disable_web_page_preview: true });
    }
    for (let i = 1; i < chunks.length; i++) {
      await ctx.reply(chunks[i], { disable_web_page_preview: true });
    }
  });

  /**
   * Свободный текст (не команды): три основных ветки —
   * 1) ввод года рождения в конце onboarding → upsert профиля и старт опроса;
   * 2) ожидание времени HH:MM после кнопки «Время» в напоминаниях;
   * 3) пошаговые ответы на FOLLOW_UP_QUESTIONS с INSERT в survey_responses при завершении.
   */
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
        await insertSurveyResponse(ctx.db, uid, answersSnapshot, null);
      }

      s.phase = "done";
      delete s.followUpIndex;
      delete s.answers;

      await ctx.reply(uiText(profile?.language ?? lang, "doneThanks"));
      return;
    }

    s.followUpIndex = next;
    await ctx.reply(FOLLOW_UP_QUESTIONS[next]);
  });

  return bot;
}

/** Кэш одного экземпляра бота на изолят — пересоздаём только при смене `BOT_TOKEN`. */
let cachedBot = null;
let cachedToken = "";
/** Флаг однократной регистрации slash-команд в Bot API после успешного init. */
let commandsConfigured = false;

/**
 * Последний `env` на входе в webhook (бот кэшируется, секрет `MINI_APP_URL` читаем отсюда, а не из замыкания `createBot`).
 *
 * @type {{ MINI_APP_URL?: string } | null}
 */
let lastWebhookEnv = null;

/**
 * Fallback-идемпотентность, когда D1 недоступна или до INSERT в `processed_updates`:
 * LRU по `update_id` в памяти изолята. Не даёт 100% гарантию между разными изолятами,
 * но снимает типичные дубли при быстрых ретраях Telegram.
 */
const RECENT_UPDATE_IDS_MAX = 5000;
/** @type {Map<number, number>} */
const recentUpdateIds = new Map();

/**
 * HTTP Mini App API: `GET /api/me`, `POST /api/profile`, `POST /api/survey/complete`.
 *
 * @param {Request} request
 * @param {{ BOT_TOKEN?: string, DB?: import("@cloudflare/workers-types").D1Database }} env
 * @param {string} path
 */
async function handleMiniAppApi(request, env, path) {
  if (!env.DB) {
    return jsonResponse({ error: "D1 not configured" }, 503);
  }
  const v = await requireTelegramMiniAppUser(request, env);
  if (!v.ok) {
    return jsonResponse({ error: v.error }, 401);
  }
  const userId = v.userId;

  if (path === "/api/me" && request.method === "GET") {
    const profile = await getUserProfile(env.DB, userId);
    const alreadyToday = await hasCompletedSurveyToday(env.DB, userId, new Date());
    return jsonResponse({
      ok: true,
      profile: profile
        ? {
            language: profile.language,
            gender: profile.gender,
            birth_year: profile.birth_year,
          }
        : null,
      alreadyToday,
    });
  }

  if (path === "/api/profile" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    const language = body?.language === "en" ? "en" : "ru";
    const gender = body?.gender === "f" ? "f" : "m";
    const birth_year = typeof body?.birth_year === "string" ? body.birth_year.trim() : "";
    if (!birth_year) {
      return jsonResponse({ error: "birth_year_required" }, 400);
    }
    const ok = await upsertUserProfile(env.DB, userId, { language, gender, birth_year });
    if (!ok) return jsonResponse({ error: "save_failed" }, 500);
    return jsonResponse({ ok: true });
  }

  if (path === "/api/survey/complete" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    const answers = body?.answers;
    if (!Array.isArray(answers) || answers.length !== FOLLOW_UP_QUESTIONS.length) {
      return jsonResponse({ error: "answers_length" }, 400);
    }
    const trimmed = answers.map((a) => (typeof a === "string" ? a.trim() : ""));
    if (trimmed.some((a) => !a)) {
      return jsonResponse({ error: "empty_answer" }, 400);
    }
    const profile = await getUserProfile(env.DB, userId);
    if (!profile) {
      return jsonResponse({ error: "profile_required" }, 400);
    }
    const alreadyToday = await hasCompletedSurveyToday(env.DB, userId, new Date());
    if (alreadyToday) {
      return jsonResponse({ error: "already_today" }, 409);
    }
    const inserted = await insertSurveyResponse(env.DB, userId, trimmed, null);
    if (!inserted) return jsonResponse({ error: "save_failed" }, 500);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "not_found" }, 404);
}

export default {
  /**
   * HTTP-вход Worker: health, JSON-статус, приём webhook Telegram.
   * Ветка `/webhook` POST: валидация секрета, ранний дедуп по телу, опционально D1-идемпотентность,
   * ленивая инициализация бота, `setMyCommands`, делегирование в grammY `webhookCallback`.
   *
   * @param {Request} request
   * @param {{ BOT_TOKEN: string, DB: import("@cloudflare/workers-types").D1Database, WEBHOOK_SECRET?: string, ASSETS?: { fetch: typeof fetch }, MINI_APP_URL?: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const path =
      url.pathname.length > 1 && url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname;

    // Минимальная проверка «воркер жив» для балансировщиков и ручного curl.
    if (path === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Корень — машиночитаемая подсказка по эндпоинтам (удобно после деплоя).
    if (path === "/" || path === "") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "telegram-survey-bot",
          mini_app: "/app/",
          endpoints: {
            status: "/status",
            health: "/health",
            webhook_post: "/webhook",
            mini_app: "/app/",
            api: "/api/me",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    // Диагностика конфигурации без утечки секретов (только флаги «задано / не задано»).
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

    // GET на URL webhook часто открывают в браузере — возвращаем подсказку вместо 405.
    if (path === "/webhook" && request.method === "GET") {
      return new Response(
        "Этот адрес для Telegram: сюда должен приходить только POST с update.\n" +
          "В браузере откройте /health (должно быть ok) или корень / для подсказки.\n" +
          "Webhook в Bot API: setWebhook с URL …/webhook — браузером проверять не нужно.",
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    if (path.startsWith("/api/")) {
      if (!env.BOT_TOKEN || !String(env.BOT_TOKEN).trim()) {
        return jsonResponse({ error: "BOT_TOKEN missing" }, 503);
      }
      return handleMiniAppApi(request, env, path);
    }

    const method = request.method;
    if ((method === "GET" || method === "HEAD") && env.ASSETS && path !== "/webhook") {
      try {
        return await env.ASSETS.fetch(requestForStaticAssets(request, path));
      } catch (e) {
        console.error("ASSETS.fetch:", e);
      }
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

    // Тело читаем один раз в строку: нужно и для раннего JSON-parse (дедуп), и для replay в grammY
    // (Request можно прочитать только один раз). Пока идёт `bot.init()` на cold start, Telegram может
    // повторить тот же update — ранний дедуп снижает двойные ответы пользователю.
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
        // Периодически чистим журнал идемпотентности (7 дней) — без этого таблица росла бы бесконечно.
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
          { command: "stats", description: "Статистика ответов" },
          { command: "reminder", description: "Напоминания" },
          { command: "cancel", description: "Отмена" },
        ]);
        commandsConfigured = true;
      } catch (e) {
        console.error("setMyCommands:", e);
      }
    }

    // Новый Request с тем же raw телом: `webhookCallback` ожидает ReadableStream/тело заново.
    const replay = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: rawBody,
    });

    try {
      lastWebhookEnv = env;
      // Таймаут чуть ниже лимита платформы, чтобы успеть ответить до обрыва со стороны CF/Telegram.
      return await webhookCallback(cachedBot, "std/http", {
        timeoutMilliseconds: 55_000,
      })(replay);
    } catch (e) {
      console.error("webhook handler:", e);
      return new Response("Internal error", { status: 500 });
    }
  },

  /**
   * Cron-триггер Cloudflare: обход всех пользователей с `enabled = 1` в `reminder_settings`.
   * Для каждого сравниваем локальное `HH:MM` с настройкой; если совпало и сегодня ещё не слали
   * (`last_sent_local_date` ≠ сегодняшний локальный день) и опрос сегодня не завершён — шлём текст
   * через `sendTelegramMessage` и фиксируем дату отправки в БД.
   *
   * @param {ScheduledEvent} _event — cron-расписание задаётся в wrangler.toml (здесь не используется)
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

      // Не беспокоим пользователя напоминанием, если опрос за сегодня (по его TZ) уже есть в D1.
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
