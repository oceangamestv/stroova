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
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
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

-- ===== Нормализованный словарь (v2) =====
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_lemmas_lang_key ON dictionary_lemmas(language_id, lemma_key);
CREATE INDEX IF NOT EXISTS idx_dictionary_lemmas_frequency_rank ON dictionary_lemmas(frequency_rank);

CREATE TABLE IF NOT EXISTS dictionary_senses (
  id SERIAL PRIMARY KEY,
  lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  sense_no INT NOT NULL DEFAULT 1,
  level VARCHAR(10) NOT NULL DEFAULT 'A0',
  register VARCHAR(20) NOT NULL DEFAULT 'разговорная',
  gloss_ru VARCHAR(255) NOT NULL DEFAULT '',
  definition_ru TEXT NOT NULL DEFAULT '',
  usage_note TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  reviewed_by VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_dictionary_senses_register CHECK (register IN ('официальная', 'разговорная'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_senses_lemma_no ON dictionary_senses(lemma_id, sense_no);
CREATE INDEX IF NOT EXISTS idx_dictionary_senses_level ON dictionary_senses(level);
CREATE INDEX IF NOT EXISTS idx_dictionary_senses_register ON dictionary_senses(register);

CREATE TABLE IF NOT EXISTS dictionary_examples (
  id SERIAL PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  en TEXT NOT NULL DEFAULT '',
  ru TEXT NOT NULL DEFAULT '',
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_examples_unique ON dictionary_examples(sense_id, en, ru);
CREATE INDEX IF NOT EXISTS idx_dictionary_examples_sense ON dictionary_examples(sense_id);

CREATE TABLE IF NOT EXISTS dictionary_forms (
  id SERIAL PRIMARY KEY,
  lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  form TEXT NOT NULL,
  form_type VARCHAR(40) NOT NULL DEFAULT '',
  is_irregular BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_forms_unique ON dictionary_forms(lemma_id, form, form_type);

CREATE TABLE IF NOT EXISTS dictionary_entry_links (
  entry_id INTEGER PRIMARY KEY REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  sense_id INTEGER NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dictionary_entry_links_lemma ON dictionary_entry_links(lemma_id);

-- ===== Связи/фразы/шаблоны (для пользовательской карточки слова) =====
CREATE TABLE IF NOT EXISTS dictionary_links (
  id SERIAL PRIMARY KEY,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  from_lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  to_lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  link_type VARCHAR(40) NOT NULL DEFAULT 'related',
  note_ru TEXT NOT NULL DEFAULT '',
  rank INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dictionary_links_from ON dictionary_links(from_lemma_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_links_to ON dictionary_links(to_lemma_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_links_type ON dictionary_links(link_type);

CREATE TABLE IF NOT EXISTS dictionary_collocations (
  id SERIAL PRIMARY KEY,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  lemma_id INTEGER NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
  phrase_en TEXT NOT NULL,
  gloss_ru TEXT NOT NULL DEFAULT '',
  level VARCHAR(10) NOT NULL DEFAULT 'A0',
  register VARCHAR(20) NOT NULL DEFAULT 'разговорная',
  example_en TEXT NOT NULL DEFAULT '',
  example_ru TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_dictionary_collocations_register CHECK (register IN ('официальная', 'разговорная'))
);
CREATE INDEX IF NOT EXISTS idx_dictionary_collocations_lemma ON dictionary_collocations(lemma_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_collocations_level ON dictionary_collocations(level);

CREATE TABLE IF NOT EXISTS dictionary_usage_patterns (
  id SERIAL PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  tag VARCHAR(40) NOT NULL DEFAULT '',
  en TEXT NOT NULL,
  ru TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dictionary_usage_patterns_sense ON dictionary_usage_patterns(sense_id);

-- ===== Коллекции (путь/темы) =====
CREATE TABLE IF NOT EXISTS dictionary_collections (
  id SERIAL PRIMARY KEY,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  collection_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level_from VARCHAR(10) NOT NULL DEFAULT 'A0',
  level_to VARCHAR(10) NOT NULL DEFAULT 'C2',
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_collections_lang_key ON dictionary_collections(language_id, collection_key);
CREATE INDEX IF NOT EXISTS idx_dictionary_collections_lang ON dictionary_collections(language_id);

CREATE TABLE IF NOT EXISTS dictionary_collection_items (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES dictionary_collections(id) ON DELETE CASCADE,
  sense_id INTEGER NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_collection_items_unique ON dictionary_collection_items(collection_id, sense_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_collection_items_collection ON dictionary_collection_items(collection_id);

-- ===== Персональный словарь (нормализованный, совместим с legacy users.personal_dictionary) =====
CREATE TABLE IF NOT EXISTS user_saved_senses (
  username VARCHAR(255) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  sense_id INTEGER NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queue',
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(20) NOT NULL DEFAULT 'manual',
  PRIMARY KEY (username, sense_id)
);
CREATE INDEX IF NOT EXISTS idx_user_saved_senses_username ON user_saved_senses(username);
CREATE INDEX IF NOT EXISTS idx_user_saved_senses_status ON user_saved_senses(status);

CREATE TABLE IF NOT EXISTS user_sense_progress (
  username VARCHAR(255) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  sense_id INTEGER NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
  beginner INT NOT NULL DEFAULT 0,
  experienced INT NOT NULL DEFAULT 0,
  expert INT NOT NULL DEFAULT 0,
  mistakes INT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ DEFAULT NULL,
  next_review_at TIMESTAMPTZ DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, sense_id)
);
CREATE INDEX IF NOT EXISTS idx_user_sense_progress_username ON user_sense_progress(username);
CREATE INDEX IF NOT EXISTS idx_user_sense_progress_next_review ON user_sense_progress(next_review_at);

CREATE TABLE IF NOT EXISTS user_collection_state (
  username VARCHAR(255) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  collection_id INTEGER NOT NULL REFERENCES dictionary_collections(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NULL,
  completed_at TIMESTAMPTZ DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, collection_id)
);
CREATE INDEX IF NOT EXISTS idx_user_collection_state_username ON user_collection_state(username);

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

-- Аудит изменений словаря (админка)
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
CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_created_at ON dictionary_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_entity ON dictionary_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_username ON dictionary_audit_log (username);

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
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE");
    await client.query("ALTER TABLE user_active_days ADD COLUMN IF NOT EXISTS max_streak INT NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE languages ADD COLUMN IF NOT EXISTS version VARCHAR(32) DEFAULT NULL");
    await client.query(SEED_LANGUAGE_SQL);

    // Дефолтные коллекции (чтобы "путь" работал сразу)
    await client.query(
      `
        INSERT INTO dictionary_collections (language_id, collection_key, title, description, level_from, level_to, is_public, sort_order)
        VALUES
          (1, 'a0_basics', 'A0: База', 'Самые нужные слова для старта (частотные и простые).', 'A0', 'A0', TRUE, 10),
          (1, 'a1_basics', 'A1: Следующий шаг', 'База для общения: хочу/могу/буду и т.п.', 'A1', 'A1', TRUE, 20)
        ON CONFLICT (language_id, collection_key) DO NOTHING;
      `
    );

    // Автонаполнение коллекций, если они пустые и словарь уже засинчен в v2
    // A0
    try {
      const a0 = await client.query(`SELECT id FROM dictionary_collections WHERE language_id = 1 AND collection_key = 'a0_basics' LIMIT 1`);
      const a0Id = a0.rows[0]?.id;
      if (a0Id) {
        const has = await client.query(`SELECT 1 FROM dictionary_collection_items WHERE collection_id = $1 LIMIT 1`, [a0Id]);
        if (has.rows.length === 0) {
          await client.query(
            `
              INSERT INTO dictionary_collection_items (collection_id, sense_id, sort_order)
              SELECT
                $1,
                s.id,
                ROW_NUMBER() OVER (ORDER BY l.frequency_rank ASC, s.id ASC) - 1
              FROM dictionary_senses s
              JOIN dictionary_lemmas l ON l.id = s.lemma_id
              WHERE l.language_id = 1 AND s.sense_no = 1 AND s.level = 'A0'
              ORDER BY l.frequency_rank ASC, s.id ASC
              LIMIT 80
              ON CONFLICT (collection_id, sense_id) DO NOTHING
            `,
            [a0Id]
          );
        }
      }
    } catch (e) {
      console.warn("A0 collection auto-fill failed:", e);
    }

    // A1
    try {
      const a1 = await client.query(`SELECT id FROM dictionary_collections WHERE language_id = 1 AND collection_key = 'a1_basics' LIMIT 1`);
      const a1Id = a1.rows[0]?.id;
      if (a1Id) {
        const has = await client.query(`SELECT 1 FROM dictionary_collection_items WHERE collection_id = $1 LIMIT 1`, [a1Id]);
        if (has.rows.length === 0) {
          await client.query(
            `
              INSERT INTO dictionary_collection_items (collection_id, sense_id, sort_order)
              SELECT
                $1,
                s.id,
                ROW_NUMBER() OVER (ORDER BY l.frequency_rank ASC, s.id ASC) - 1
              FROM dictionary_senses s
              JOIN dictionary_lemmas l ON l.id = s.lemma_id
              WHERE l.language_id = 1 AND s.sense_no = 1 AND s.level = 'A1'
              ORDER BY l.frequency_rank ASC, s.id ASC
              LIMIT 80
              ON CONFLICT (collection_id, sense_id) DO NOTHING
            `,
            [a1Id]
          );
        }
      }
    } catch (e) {
      console.warn("A1 collection auto-fill failed:", e);
    }

    // dictionary_senses: админ-проверка
    await client.query("ALTER TABLE dictionary_senses ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL");
    await client.query("ALTER TABLE dictionary_senses ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255) DEFAULT NULL");
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dictionary_senses_reviewed_by') THEN
          ALTER TABLE dictionary_senses
            ADD CONSTRAINT fk_dictionary_senses_reviewed_by
            FOREIGN KEY (reviewed_by) REFERENCES users(username) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_dictionary_senses_reviewed_at ON dictionary_senses (reviewed_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_dictionary_senses_unreviewed ON dictionary_senses (id) WHERE reviewed_at IS NULL");

    // Логи AI-подсказок для админки словаря
    await client.query(`
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
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_dictionary_ai_suggestions_created_at ON dictionary_ai_suggestions (created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_dictionary_ai_suggestions_username ON dictionary_ai_suggestions (username)");

    // Аудит изменений словаря
    await client.query(`
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
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_created_at ON dictionary_audit_log (created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_entity ON dictionary_audit_log (entity_type, entity_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_dictionary_audit_log_username ON dictionary_audit_log (username)");
  } finally {
    client.release();
  }
}
