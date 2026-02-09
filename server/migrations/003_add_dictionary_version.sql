-- Миграция: добавить колонку version в таблицу languages для кэширования версии словаря
-- Применение: psql -U stroova -d stroova -f server/migrations/003_add_dictionary_version.sql
-- Или выполнить блок ниже в DBVisualizer / DBeaver / pgAdmin.

ALTER TABLE languages ADD COLUMN IF NOT EXISTS version VARCHAR(32) DEFAULT NULL;

-- Комментарий к колонке
COMMENT ON COLUMN languages.version IS 'Версия словаря для данного языка (обновляется при изменении словаря)';
