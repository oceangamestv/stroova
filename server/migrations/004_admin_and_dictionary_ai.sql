-- Миграция: флаг админа + логирование AI-подсказок для словаря
-- Применение: psql -U stroova -d stroova -f server/migrations/004_admin_and_dictionary_ai.sql

-- 1) Флаг администратора (назначается вручную через прямое подключение к БД)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.is_admin IS 'Админ-флаг. Назначается вручную в БД. Используется для доступа к админ-инструментам.';

-- 2) Логи запросов к AI для админки словаря (черновики/подсказки)
CREATE TABLE IF NOT EXISTS dictionary_ai_suggestions (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  username VARCHAR(255) NULL REFERENCES users(username) ON DELETE SET NULL,
  lang_code VARCHAR(10) NOT NULL DEFAULT 'en',
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  model VARCHAR(100) NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_dictionary_ai_suggestions_created_at
  ON dictionary_ai_suggestions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dictionary_ai_suggestions_username
  ON dictionary_ai_suggestions (username);

