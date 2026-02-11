-- Миграция: нормализованная структура словаря (леммы/значения/примеры/формы)
-- Важно: текущая таблица dictionary_entries НЕ трогаем, чтобы не ломать прогресс и личные словари.
-- Применение: psql -U stroova -d stroova -f server/migrations/005_dictionary_normalized_v2.sql

-- 1) Леммы (основная словарная единица)
CREATE TABLE IF NOT EXISTS dictionary_lemmas (
  id SERIAL PRIMARY KEY,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  lemma_key TEXT NOT NULL,
  lemma TEXT NOT NULL,
  pos VARCHAR(30) NOT NULL DEFAULT '',
  frequency_rank INT NOT NULL DEFAULT 15000,
  rarity VARCHAR(20) NOT NULL DEFAULT 'не редкое',
  accent VARCHAR(10) NOT NULL DEFAULT 'both',
  ipa_uk VARCHAR(100) NOT NULL DEFAULT '',
  ipa_us VARCHAR(100) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_dictionary_lemmas_rarity CHECK (rarity IN ('не редкое', 'редкое', 'очень редкое'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_lemmas_lang_key
  ON dictionary_lemmas(language_id, lemma_key);
CREATE INDEX IF NOT EXISTS idx_dictionary_lemmas_frequency_rank
  ON dictionary_lemmas(frequency_rank);

-- 2) Значения (senses) леммы
CREATE TABLE IF NOT EXISTS dictionary_senses (
  id SERIAL PRIMARY KEY,
  lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  sense_no INT NOT NULL DEFAULT 1,
  level VARCHAR(10) NOT NULL DEFAULT 'A0',
  register VARCHAR(20) NOT NULL DEFAULT 'разговорная',
  gloss_ru VARCHAR(255) NOT NULL DEFAULT '',
  definition_ru TEXT NOT NULL DEFAULT '',
  usage_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_dictionary_senses_register CHECK (register IN ('официальная', 'разговорная'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_senses_lemma_no
  ON dictionary_senses(lemma_id, sense_no);
CREATE INDEX IF NOT EXISTS idx_dictionary_senses_level
  ON dictionary_senses(level);
CREATE INDEX IF NOT EXISTS idx_dictionary_senses_register
  ON dictionary_senses(register);

-- 3) Примеры употребления
CREATE TABLE IF NOT EXISTS dictionary_examples (
  id SERIAL PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  en TEXT NOT NULL DEFAULT '',
  ru TEXT NOT NULL DEFAULT '',
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_examples_unique
  ON dictionary_examples(sense_id, en, ru);
CREATE INDEX IF NOT EXISTS idx_dictionary_examples_sense
  ON dictionary_examples(sense_id);

-- 4) Формы (морфология) леммы: went, running, better, children и т.д.
CREATE TABLE IF NOT EXISTS dictionary_forms (
  id SERIAL PRIMARY KEY,
  lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  form TEXT NOT NULL,
  form_type VARCHAR(40) NOT NULL DEFAULT '',
  is_irregular BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_forms_unique
  ON dictionary_forms(lemma_id, form, form_type);

-- 5) Связка: существующая запись dictionary_entries -> (lemma, sense)
-- Нужна, чтобы сохранить старые ID (прогресс/личный словарь) и при этом иметь нормализованную структуру.
CREATE TABLE IF NOT EXISTS dictionary_entry_links (
  entry_id INTEGER PRIMARY KEY REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  sense_id INTEGER NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dictionary_entry_links_lemma
  ON dictionary_entry_links(lemma_id);

-- 6) Первичная миграция существующих данных из dictionary_entries (идемпотентно)
-- 6.1 Леммы
INSERT INTO dictionary_lemmas (language_id, lemma_key, lemma, frequency_rank, rarity, accent, ipa_uk, ipa_us, updated_at)
SELECT
  e.language_id,
  LOWER(TRIM(e.en)) AS lemma_key,
  TRIM(e.en) AS lemma,
  e.frequency_rank,
  e.rarity,
  e.accent,
  e.ipa_uk,
  e.ipa_us,
  NOW()
FROM dictionary_entries e
ON CONFLICT (language_id, lemma_key) DO UPDATE SET
  lemma = EXCLUDED.lemma,
  frequency_rank = EXCLUDED.frequency_rank,
  rarity = EXCLUDED.rarity,
  accent = EXCLUDED.accent,
  ipa_uk = EXCLUDED.ipa_uk,
  ipa_us = EXCLUDED.ipa_us,
  updated_at = NOW();

-- 6.2 Значения (пока создаём sense #1 на каждую лемму из текущей записи)
INSERT INTO dictionary_senses (lemma_id, sense_no, level, register, gloss_ru, updated_at)
SELECT
  l.id AS lemma_id,
  1 AS sense_no,
  e.level,
  e.register,
  e.ru AS gloss_ru,
  NOW()
FROM dictionary_entries e
JOIN dictionary_lemmas l
  ON l.language_id = e.language_id AND l.lemma_key = LOWER(TRIM(e.en))
ON CONFLICT (lemma_id, sense_no) DO UPDATE SET
  level = EXCLUDED.level,
  register = EXCLUDED.register,
  gloss_ru = EXCLUDED.gloss_ru,
  updated_at = NOW();

-- 6.3 Примеры (главный пример, если задан)
INSERT INTO dictionary_examples (sense_id, en, ru, is_main, sort_order)
SELECT
  s.id AS sense_id,
  e.example AS en,
  e.example_ru AS ru,
  TRUE AS is_main,
  0 AS sort_order
FROM dictionary_entries e
JOIN dictionary_lemmas l
  ON l.language_id = e.language_id AND l.lemma_key = LOWER(TRIM(e.en))
JOIN dictionary_senses s
  ON s.lemma_id = l.id AND s.sense_no = 1
WHERE (e.example IS NOT NULL AND TRIM(e.example) <> '')
ON CONFLICT (sense_id, en, ru) DO NOTHING;

-- 6.4 Связка entry -> lemma/sense
INSERT INTO dictionary_entry_links (entry_id, lemma_id, sense_id)
SELECT
  e.id AS entry_id,
  l.id AS lemma_id,
  s.id AS sense_id
FROM dictionary_entries e
JOIN dictionary_lemmas l
  ON l.language_id = e.language_id AND l.lemma_key = LOWER(TRIM(e.en))
JOIN dictionary_senses s
  ON s.lemma_id = l.id AND s.sense_no = 1
ON CONFLICT (entry_id) DO UPDATE SET
  lemma_id = EXCLUDED.lemma_id,
  sense_id = EXCLUDED.sense_id;

