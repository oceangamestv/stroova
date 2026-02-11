-- Миграция: аудит изменений словаря (админка)
-- Применение: psql -U stroova -d stroova -f server/migrations/007_dictionary_audit_log.sql

CREATE TABLE IF NOT EXISTS dictionary_audit_log (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  username VARCHAR(255) NULL REFERENCES users(username) ON DELETE SET NULL,
  action VARCHAR(30) NOT NULL,
  entity_type VARCHAR(30) NOT NULL,
  entity_id VARCHAR(64) NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_created_at
  ON dictionary_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_entity
  ON dictionary_audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_username
  ON dictionary_audit_log (username);

