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
