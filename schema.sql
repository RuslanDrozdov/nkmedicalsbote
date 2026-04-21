-- Применить: wrangler d1 execute DB --file=./schema.sql
-- или при первом деплое через migrations (см. wrangler.toml)

CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions (updated_at);

-- Идемпотентность webhook: Telegram может повторно POSTить тот же update_id
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_updates_created ON processed_updates (created_at);

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
