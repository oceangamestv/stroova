-- Миграция: флаг/дата проверки админом + подготовка админки под v2 (senses)
-- Применение: psql -U stroova -d stroova -f server/migrations/006_dictionary_review_and_admin_v2.sql

-- 1) Поля проверки админом на уровне значения (dictionary_senses)
ALTER TABLE dictionary_senses
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255) DEFAULT NULL;

-- FK на пользователя (если есть)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_dictionary_senses_reviewed_by'
  ) THEN
    ALTER TABLE dictionary_senses
      ADD CONSTRAINT fk_dictionary_senses_reviewed_by
      FOREIGN KEY (reviewed_by) REFERENCES users(username) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dictionary_senses_reviewed_at
  ON dictionary_senses (reviewed_at DESC);

-- Быстрый фильтр "не проверено"
CREATE INDEX IF NOT EXISTS idx_dictionary_senses_unreviewed
  ON dictionary_senses (id)
  WHERE reviewed_at IS NULL;

