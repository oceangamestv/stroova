/**
 * Подключение к PostgreSQL и создание таблиц при первом запуске.
 */

import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("Не задана переменная окружения DATABASE_URL");
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
});

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stats JSONB NOT NULL DEFAULT '{}',
  word_progress JSONB NOT NULL DEFAULT '{}',
  personal_dictionary JSONB NOT NULL DEFAULT '[]',
  game_settings JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  login_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Защита от подбора пароля: после 3 неверных попыток — блокировка на 60 секунд
CREATE TABLE IF NOT EXISTS login_lockouts (
  username VARCHAR(255) PRIMARY KEY,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);

-- Языки для словарей (английский, в будущем — другие)
CREATE TABLE IF NOT EXISTS languages (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  version VARCHAR(32) DEFAULT NULL
);

-- Словарь: слова по языкам (например «словарь английского» = language_id = 1)
CREATE TABLE IF NOT EXISTS dictionary_entries (
  id SERIAL PRIMARY KEY,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  en VARCHAR(255) NOT NULL,
  ru VARCHAR(255) NOT NULL,
  accent VARCHAR(10) NOT NULL DEFAULT 'both',
  level VARCHAR(10) NOT NULL DEFAULT 'A0',
  frequency_rank INT NOT NULL DEFAULT 15000,
  rarity VARCHAR(20) NOT NULL DEFAULT 'редкое',
  register VARCHAR(20) NOT NULL DEFAULT 'разговорная',
  ipa_uk VARCHAR(100) NOT NULL DEFAULT '',
  ipa_us VARCHAR(100) NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  example_ru TEXT NOT NULL DEFAULT '',
  CONSTRAINT chk_dictionary_entries_rarity CHECK (rarity IN ('не редкое', 'редкое', 'очень редкое')),
  CONSTRAINT chk_dictionary_entries_register CHECK (register IN ('официальная', 'разговорная'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_entries_lang_en ON dictionary_entries(language_id, en);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_language ON dictionary_entries(language_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_level ON dictionary_entries(language_id, level);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_frequency_rank ON dictionary_entries(frequency_rank);

-- Активные дни и награды (механика «активных дней»)
CREATE TABLE IF NOT EXISTS rewards (
  id SERIAL PRIMARY KEY,
  reward_key VARCHAR(100) UNIQUE NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS user_active_days (
  username VARCHAR(255) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
  last_active_date DATE,
  streak_days INT NOT NULL DEFAULT 0,
  max_streak INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rating_participants (
  username VARCHAR(255) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
  opted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO rewards (reward_key, config, description)
VALUES ('active_day', '{"xp": 10}', '10 XP за активный день')
ON CONFLICT (reward_key) DO NOTHING;
`;

const SEED_LANGUAGE_SQL = `
INSERT INTO languages (id, code, name) VALUES (1, 'en', 'English')
ON CONFLICT (code) DO NOTHING;
`;

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(INIT_SQL);
    await client.query("ALTER TABLE user_active_days ADD COLUMN IF NOT EXISTS max_streak INT NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE languages ADD COLUMN IF NOT EXISTS version VARCHAR(32) DEFAULT NULL");
    await client.query(SEED_LANGUAGE_SQL);
  } finally {
    client.release();
  }
}
