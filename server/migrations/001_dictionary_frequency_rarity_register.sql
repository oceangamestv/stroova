-- Миграция: добавить в dictionary_entries поля frequency_rank, rarity, register
-- Применение: psql -U stroova -d stroova -f server/migrations/001_dictionary_frequency_rarity_register.sql
-- Или выполнить блок ниже в DBVisualizer / DBeaver / pgAdmin.

-- 1) Новые колонки с DEFAULT (существующие строки и CSV без этих колонок получат значения по умолчанию)
ALTER TABLE dictionary_entries
  ADD COLUMN IF NOT EXISTS frequency_rank INT NOT NULL DEFAULT 15000,
  ADD COLUMN IF NOT EXISTS rarity VARCHAR(20) NOT NULL DEFAULT 'редкое',
  ADD COLUMN IF NOT EXISTS register VARCHAR(20) NOT NULL DEFAULT 'разговорная';

-- 2) CHECK-ограничения (допустимые значения)
ALTER TABLE dictionary_entries
  DROP CONSTRAINT IF EXISTS chk_dictionary_entries_rarity;
ALTER TABLE dictionary_entries
  ADD CONSTRAINT chk_dictionary_entries_rarity
  CHECK (rarity IN ('не редкое', 'редкое', 'очень редкое'));

ALTER TABLE dictionary_entries
  DROP CONSTRAINT IF EXISTS chk_dictionary_entries_register;
ALTER TABLE dictionary_entries
  ADD CONSTRAINT chk_dictionary_entries_register
  CHECK (register IN ('официальная', 'разговорная'));

-- 3) Индекс для сортировки и фильтрации по частотности
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_frequency_rank
  ON dictionary_entries (frequency_rank);

-- Комментарии к колонкам (опционально)
COMMENT ON COLUMN dictionary_entries.frequency_rank IS 'Чем меньше значение, тем чаще слово в языке (1 = самое частотное)';
COMMENT ON COLUMN dictionary_entries.rarity IS 'не редкое | редкое | очень редкое';
COMMENT ON COLUMN dictionary_entries.register IS 'официальная | разговорная';
