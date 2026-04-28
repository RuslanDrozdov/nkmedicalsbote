-- Схема БД для варианта деплоя через Cloudflare Workers + D1.
--
-- ВАЖНО: текущий `bot.js` (long polling) не использует эту БД и хранит состояние
-- в памяти процесса. Эти таблицы — задел для версии, где:
-- - сессии/идемпотентность/ответы сохраняются в D1
-- - бот работает в webhook-режиме (Worker), а не как локальный polling-процесс
--
-- Как применить:
-- - локально:  wrangler d1 execute <DB> --local  --file=./schema.sql
-- - удалённо:  wrangler d1 execute <DB> --remote --file=./schema.sql
-- - или через migrations при первом деплое (см. `wrangler.toml`)

-- -----------------------------------------------------------------------------
-- sessions
-- -----------------------------------------------------------------------------
-- Сессии диалога (FSM), если вы хотите хранить состояние устойчиво.
--
-- Идея:
-- - `user_id` — Telegram `from.id` (однозначно идентифицирует пользователя)
-- - `state` — сериализованное состояние (обычно JSON строкой)
-- - `updated_at` — timestamp (ms) для TTL/очистки “забытых” сессий
--
-- В отличие от in-memory Map в `bot.js`, хранение в D1 переживает рестарты
-- и позволяет масштабировать обработку (несколько инстансов/запросов).
CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions (updated_at);

-- -----------------------------------------------------------------------------
-- processed_updates
-- -----------------------------------------------------------------------------
-- Идемпотентность webhook: Telegram может повторно POSTить тот же update_id.
--
-- Сценарии повторов:
-- - сетевые ретраи со стороны Telegram
-- - таймауты ответа сервера
-- - временные сбои
--
-- В webhook-режиме (Worker) правильнее фиксировать обработанные update_id в БД,
-- чем держать LRU в памяти (память Worker не гарантирована между запросами).
-- Идемпотентность webhook: Telegram может повторно POSTить тот же update_id
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_updates_created ON processed_updates (created_at);

-- -----------------------------------------------------------------------------
-- survey_responses
-- -----------------------------------------------------------------------------
-- Завершённые опросы (фактические данные).
--
-- Что хранится:
-- - `answers_json` — ответы пользователя на follow-up блок (обычно JSON массив)
-- - `screening_json` — профиль/скрининг (язык/пол/год рождения), опционально
-- - `completed_at` — когда пользователь завершил опрос (ms)
--
-- Это позволяет:
-- - не держать большие массивы ответов в сессии
-- - строить выгрузки/аналитику
-- Завершённые опросы: ответы только здесь (сессию после отправки можно не держать с массивом ответов)
CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  screening_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_user ON survey_responses (user_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_completed ON survey_responses (completed_at);

-- -----------------------------------------------------------------------------
-- reminder_settings
-- -----------------------------------------------------------------------------
-- Настройки напоминаний (обычно используется cron-триггер в Worker).
--
-- Поля:
-- - `timezone`: IANA TZ (например, 'Europe/Moscow') — чтобы отправлять по локальному времени
-- - `time_hhmm`: локальное время отправки (например, '09:00')
-- - `enabled`: 0/1, включены ли напоминания
-- - `last_sent_local_date`: строка даты (например '2026-04-28') чтобы не слать чаще 1 раза в день
--
-- Это более “правильный” путь, чем сравнение local day на сервере, если у
-- пользователей разные таймзоны.
-- Настройки напоминаний (cron в Worker)
-- timezone: IANA TZ (например, Europe/Moscow)
-- time_hhmm: локальное время, например "09:00"
CREATE TABLE IF NOT EXISTS reminder_settings (
  user_id INTEGER PRIMARY KEY NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  time_hhmm TEXT NOT NULL DEFAULT '09:00',
  enabled INTEGER NOT NULL DEFAULT 0,
  last_sent_local_date TEXT
);

CREATE INDEX IF NOT EXISTS idx_reminder_settings_enabled ON reminder_settings (enabled);

-- -----------------------------------------------------------------------------
-- user_profile
-- -----------------------------------------------------------------------------
-- Профиль пользователя (одноразовая анкета при первом старте).
--
-- В `bot.js` профиль держится в сессии и не переживает рестарт.
-- В D1-версии его можно сохранять здесь и использовать при последующих входах.
--
-- Поля:
-- - `language`: 'ru' | 'en'
-- - `gender`: 'm' | 'f'
-- - `birth_year`: свободный ввод (в `bot.js` это строка, не число)
-- - `created_at` / `updated_at`: timestamps (ms)
-- Профиль пользователя (одноразовая анкета при первом старте)
-- language: 'ru' | 'en'
-- gender: 'm' | 'f'
-- birth_year: свободный ввод (как строка)
CREATE TABLE IF NOT EXISTS user_profile (
  user_id INTEGER PRIMARY KEY NOT NULL,
  language TEXT NOT NULL,
  gender TEXT NOT NULL,
  birth_year TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
