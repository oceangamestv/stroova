-- Воссоздание таблицы словаря и связей после DROP
-- Запуск: psql -U stroova -d stroova -f server/migrations/002_recreate_dictionary_entries.sql

-- 1) Таблица языков (если удалена)
CREATE TABLE IF NOT EXISTS languages (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL
);

-- 2) Заполнить язык English, если ещё нет
INSERT INTO languages (id, code, name)
VALUES (1, 'en', 'English')
ON CONFLICT (code) DO NOTHING;

-- 3) Таблица словарных статей (связь с languages по language_id)
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

-- 4) Индексы
CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_entries_lang_en ON dictionary_entries(language_id, en);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_language ON dictionary_entries(language_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_level ON dictionary_entries(language_id, level);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_frequency_rank ON dictionary_entries(frequency_rank);

-- Связь: dictionary_entries.language_id -> languages.id (ON DELETE CASCADE уже в определении таблицы)
