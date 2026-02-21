-- Миграция: очередь внутренней синхронизации словаря (RF API <- DE worker)
-- Применение: psql -U stroova -d stroova -f server/migrations/008_internal_dictionary_sync_queue.sql

CREATE TABLE IF NOT EXISTS internal_dictionary_sync_jobs (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(100) NOT NULL UNIQUE,
  source VARCHAR(80) NOT NULL DEFAULT 'de',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NOT NULL DEFAULT '',
  attempt_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_internal_dictionary_sync_jobs_status
    CHECK (status IN ('pending', 'processing', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_internal_dictionary_sync_jobs_status_created
  ON internal_dictionary_sync_jobs (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_internal_dictionary_sync_jobs_source_created
  ON internal_dictionary_sync_jobs (source, created_at DESC);
