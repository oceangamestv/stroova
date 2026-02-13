/**
 * Словари из БД: получение слов по языку.
 */

import crypto from "crypto";
import { pool } from "./db.js";

/**
 * @param {string} langCode — код языка (например 'en')
 * @param {{ accent?: string, level?: string }} [filters] — опционально: фильтр по акценту и/или уровню
 * @returns {Promise<Array<{ id: number, en: string, ru: string, accent: string, level: string, ipaUk: string, ipaUs: string, example: string, exampleRu: string }>>}
 */
export async function getWordsByLanguage(langCode, filters = {}) {
  const { accent, level } = filters;
  const langResult = await pool.query(
    "SELECT id FROM languages WHERE code = $1",
    [langCode]
  );
  if (langResult.rows.length === 0) return [];
  const languageId = langResult.rows[0].id;

  let sql = `
    SELECT id, en, ru, accent, level,
           frequency_rank AS "frequencyRank", rarity, register,
           ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu"
    FROM dictionary_entries
    WHERE language_id = $1
  `;
  const params = [languageId];
  let n = 2;
  if (level) {
    sql += ` AND level = $${n}`;
    params.push(level);
    n++;
  }
  if (accent && accent !== "both") {
    sql += ` AND (accent = $${n} OR accent = 'both')`;
    params.push(accent);
  }
  sql += " ORDER BY id";

  const res = await pool.query(sql, params);
  return res.rows;
}

/**
 * Список доступных языков.
 * @returns {Promise<Array<{ id: number, code: string, name: string }>>}
 */
export async function getLanguages() {
  const res = await pool.query("SELECT id, code, name FROM languages ORDER BY id");
  return res.rows;
}

/**
 * Id слов по языку и уровню (для личного словаря по умолчанию, например A0).
 * @param {string} langCode — код языка ('en')
 * @param {string} level — уровень ('A0', 'A1', …)
 * @returns {Promise<number[]>}
 */
export async function getWordIdsByLevel(langCode, level) {
  const langResult = await pool.query(
    "SELECT id FROM languages WHERE code = $1",
    [langCode]
  );
  if (langResult.rows.length === 0) return [];
  const languageId = langResult.rows[0].id;
  const res = await pool.query(
    "SELECT id FROM dictionary_entries WHERE language_id = $1 AND level = $2 ORDER BY id",
    [languageId, level]
  );
  return res.rows.map((r) => r.id);
}

/**
 * Получить версию словаря для проверки изменений.
 * Версия хранится в таблице languages и обновляется при изменении словаря.
 * @param {string} langCode — код языка (например 'en')
 * @returns {Promise<string>} — версия словаря
 */
export async function getDictionaryVersion(langCode) {
  const langResult = await pool.query(
    "SELECT version FROM languages WHERE code = $1",
    [langCode]
  );
  if (langResult.rows.length === 0) return "";
  return langResult.rows[0].version || "";
}

function normalizeAccent(accent) {
  const v = String(accent || "").trim();
  if (!v) return "both";
  if (v === "both") return "both";
  if (v.toUpperCase() === "UK") return "UK";
  if (v.toUpperCase() === "US") return "US";
  return "both";
}

function normalizeLevel(level) {
  const v = String(level || "").trim().toUpperCase();
  const allowed = new Set(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
  return allowed.has(v) ? v : "A0";
}

function normalizeRarity(rarity) {
  const v = String(rarity || "").trim();
  if (["не редкое", "редкое", "очень редкое"].includes(v)) return v;
  return "не редкое";
}

function normalizeRegister(register) {
  const v = String(register || "").trim();
  if (["официальная", "разговорная"].includes(v)) return v;
  return "разговорная";
}

async function ensureLemmaSenseLink(languageId, entry, db = pool) {
  const en = String(entry?.en || "").trim();
  if (!en) return null;
  const lemmaKey = en.toLowerCase();

  // upsert lemma
  const lemmaRes = await db.query(
    `
      INSERT INTO dictionary_lemmas (language_id, lemma_key, lemma, frequency_rank, rarity, accent, ipa_uk, ipa_us, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (language_id, lemma_key) DO UPDATE SET
        lemma = EXCLUDED.lemma,
        frequency_rank = EXCLUDED.frequency_rank,
        rarity = EXCLUDED.rarity,
        accent = EXCLUDED.accent,
        ipa_uk = EXCLUDED.ipa_uk,
        ipa_us = EXCLUDED.ipa_us,
        updated_at = NOW()
      RETURNING id
    `,
    [
      languageId,
      lemmaKey,
      en,
      entry.frequencyRank ?? 15000,
      normalizeRarity(entry.rarity),
      normalizeAccent(entry.accent),
      String(entry.ipaUk || "").trim(),
      String(entry.ipaUs || "").trim(),
    ]
  );
  const lemmaId = lemmaRes.rows[0]?.id;
  if (!lemmaId) return null;

  // upsert sense #1
  const senseRes = await db.query(
    `
      INSERT INTO dictionary_senses (lemma_id, sense_no, level, register, gloss_ru, updated_at)
      VALUES ($1, 1, $2, $3, $4, NOW())
      ON CONFLICT (lemma_id, sense_no) DO UPDATE SET
        level = EXCLUDED.level,
        register = EXCLUDED.register,
        gloss_ru = EXCLUDED.gloss_ru,
        updated_at = NOW()
      RETURNING id
    `,
    [
      lemmaId,
      normalizeLevel(entry.level),
      normalizeRegister(entry.register),
      String(entry.ru || "").trim(),
    ]
  );
  const senseId = senseRes.rows[0]?.id;
  if (!senseId) return null;

  // main example: keep in sync (simple policy: replace main example)
  const exEn = String(entry.example || "").trim();
  const exRu = String(entry.exampleRu || "").trim();
  await db.query(`DELETE FROM dictionary_examples WHERE sense_id = $1 AND is_main = TRUE`, [senseId]);
  if (exEn) {
    await db.query(
      `INSERT INTO dictionary_examples (sense_id, en, ru, is_main, sort_order)
       VALUES ($1, $2, $3, TRUE, 0)
       ON CONFLICT (sense_id, en, ru) DO NOTHING`,
      [senseId, exEn, exRu]
    );
  }

  // link entry -> lemma/sense
  if (entry.id != null) {
    await db.query(
      `
        INSERT INTO dictionary_entry_links (entry_id, lemma_id, sense_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (entry_id) DO UPDATE SET
          lemma_id = EXCLUDED.lemma_id,
          sense_id = EXCLUDED.sense_id
      `,
      [Number(entry.id), lemmaId, senseId]
    );
  }

  return { lemmaId, senseId };
}

export async function syncDictionaryV2FromEntries(langCode) {
  const langResult = await pool.query("SELECT id FROM languages WHERE code = $1", [langCode]);
  if (langResult.rows.length === 0) return { ok: false, inserted: 0 };
  const languageId = langResult.rows[0].id;

  // Bulk upsert lemmas
  await pool.query(
    `
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
      WHERE e.language_id = $1
      ON CONFLICT (language_id, lemma_key) DO UPDATE SET
        lemma = EXCLUDED.lemma,
        frequency_rank = EXCLUDED.frequency_rank,
        rarity = EXCLUDED.rarity,
        accent = EXCLUDED.accent,
        ipa_uk = EXCLUDED.ipa_uk,
        ipa_us = EXCLUDED.ipa_us,
        updated_at = NOW()
    `,
    [languageId]
  );

  // Bulk upsert sense #1
  await pool.query(
    `
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
      WHERE e.language_id = $1
      ON CONFLICT (lemma_id, sense_no) DO UPDATE SET
        level = EXCLUDED.level,
        register = EXCLUDED.register,
        gloss_ru = EXCLUDED.gloss_ru,
        updated_at = NOW()
    `,
    [languageId]
  );

  // Refresh links
  await pool.query(
    `
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
      WHERE e.language_id = $1
      ON CONFLICT (entry_id) DO UPDATE SET
        lemma_id = EXCLUDED.lemma_id,
        sense_id = EXCLUDED.sense_id
    `,
    [languageId]
  );

  // Main examples: simple approach — clear + insert from entries where example exists
  await pool.query(
    `
      DELETE FROM dictionary_examples ex
      USING dictionary_senses s, dictionary_lemmas l
      WHERE ex.sense_id = s.id
        AND s.lemma_id = l.id
        AND l.language_id = $1
        AND ex.is_main = TRUE
    `,
    [languageId]
  );
  await pool.query(
    `
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
      WHERE e.language_id = $1
        AND (e.example IS NOT NULL AND TRIM(e.example) <> '')
      ON CONFLICT (sense_id, en, ru) DO NOTHING
    `,
    [languageId]
  );

  return { ok: true, inserted: 0 };
}

export async function searchDictionaryEntries(langCode, query, limit = 50) {
  const q = String(query || "").trim();
  if (!q) return [];
  const langResult = await pool.query("SELECT id FROM languages WHERE code = $1", [langCode]);
  if (langResult.rows.length === 0) return [];
  const languageId = langResult.rows[0].id;

  const res = await pool.query(
    `
      SELECT id, en, ru, accent, level,
             frequency_rank AS "frequencyRank", rarity, register,
             ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu"
      FROM dictionary_entries
      WHERE language_id = $1
        AND (en ILIKE $2 OR ru ILIKE $2)
      ORDER BY frequency_rank ASC, id ASC
      LIMIT $3
    `,
    [languageId, `%${q}%`, Math.max(1, Math.min(200, Number(limit) || 50))]
  );
  return res.rows;
}

export async function getDictionaryEntryById(langCode, id) {
  const langResult = await pool.query("SELECT id FROM languages WHERE code = $1", [langCode]);
  if (langResult.rows.length === 0) return null;
  const languageId = langResult.rows[0].id;
  const res = await pool.query(
    `
      SELECT id, en, ru, accent, level,
             frequency_rank AS "frequencyRank", rarity, register,
             ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu"
      FROM dictionary_entries
      WHERE language_id = $1 AND id = $2
      LIMIT 1
    `,
    [languageId, Number(id)]
  );
  return res.rows[0] || null;
}

/**
 * Частичное обновление записи словаря (dictionary_entries).
 * Разрешённые поля: en, ru, accent, level, frequencyRank, rarity, register, ipaUk, ipaUs, example, exampleRu
 */
export async function patchDictionaryEntry(langCode, id, patch, actorUsername, db = pool) {
  const langResult = await db.query("SELECT id FROM languages WHERE code = $1", [langCode]);
  if (langResult.rows.length === 0) return null;
  const languageId = langResult.rows[0].id;

  const allowed = new Map([
    ["en", "en"],
    ["ru", "ru"],
    ["accent", "accent"],
    ["level", "level"],
    ["frequencyRank", "frequency_rank"],
    ["rarity", "rarity"],
    ["register", "register"],
    ["ipaUk", "ipa_uk"],
    ["ipaUs", "ipa_us"],
    ["example", "example"],
    ["exampleRu", "example_ru"],
  ]);

  const set = [];
  const params = [];
  let n = 1;

  for (const [key, col] of allowed) {
    if (!patch || patch[key] === undefined) continue;
    let value = patch[key];
    if (key === "accent") value = normalizeAccent(value);
    if (key === "level") value = normalizeLevel(value);
    if (key === "rarity") value = normalizeRarity(value);
    if (key === "register") value = normalizeRegister(value);
    if (key === "frequencyRank") {
      const parsed = parseInt(String(value), 10);
      value = Number.isFinite(parsed) ? parsed : 15000;
    }
    if (key === "en" || key === "ru") value = String(value || "").trim();
    if (key === "ipaUk" || key === "ipaUs") value = String(value || "").trim();
    if (key === "example" || key === "exampleRu") value = String(value || "");

    set.push(`${col} = $${n}`);
    params.push(value);
    n++;
  }

  if (set.length === 0) {
    return await getDictionaryEntryById(langCode, id);
  }

  params.push(languageId);
  params.push(Number(id));

  const res = await db.query(
    `
      UPDATE dictionary_entries
      SET ${set.join(", ")}
      WHERE language_id = $${n} AND id = $${n + 1}
      RETURNING id, en, ru, accent, level,
                frequency_rank AS "frequencyRank", rarity, register,
                ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu"
    `,
    params
  );
  const updated = res.rows[0] || null;
  if (updated) {
    // Синхронизируем нормализованную структуру (v2) для этой записи
    try {
      await ensureLemmaSenseLink(languageId, updated, db);
    } catch (e) {
      console.warn("dictionary v2 sync failed:", e);
    }
    await insertAudit(actorUsername, "update", "entry", updated.id, {}, updated, { langCode }, db);
  }
  return updated;
}

export async function listDictionaryEntriesAdmin(langCode, filters = {}) {
  const langResult = await pool.query("SELECT id FROM languages WHERE code = $1", [langCode]);
  if (langResult.rows.length === 0) return { items: [], total: 0 };
  const languageId = langResult.rows[0].id;

  const {
    q,
    level,
    register,
    rarity,
    reviewed, // 'all' | 'yes' | 'no'
    missingExample,
    missingIpa,
    missingRu,
    offset = 0,
    limit = 100,
    order = "frequency", // frequency | id | reviewed_at
  } = filters || {};

  const where = ["e.language_id = $1"];
  const params = [languageId];
  let n = 2;

  if (q && String(q).trim()) {
    where.push(`(e.en ILIKE $${n} OR e.ru ILIKE $${n})`);
    params.push(`%${String(q).trim()}%`);
    n++;
  }
  if (level && String(level).trim() && String(level) !== "all") {
    where.push(`COALESCE(s.level, e.level) = $${n}`);
    params.push(String(level).trim());
    n++;
  }
  if (register && String(register).trim() && String(register) !== "all") {
    where.push(`COALESCE(s.register, e.register) = $${n}`);
    params.push(String(register).trim());
    n++;
  }
  if (rarity && String(rarity).trim() && String(rarity) !== "all") {
    where.push(`COALESCE(l.rarity, e.rarity) = $${n}`);
    params.push(String(rarity).trim());
    n++;
  }
  if (reviewed === "yes") {
    where.push(`s.reviewed_at IS NOT NULL`);
  } else if (reviewed === "no") {
    where.push(`s.reviewed_at IS NULL`);
  }

  if (missingRu) {
    where.push(`(e.ru IS NULL OR TRIM(e.ru) = '')`);
  }
  if (missingIpa) {
    where.push(`(
      (COALESCE(l.ipa_uk, '') = '' AND COALESCE(l.ipa_us, '') = '' AND COALESCE(e.ipa_uk, '') = '' AND COALESCE(e.ipa_us, '') = '')
    )`);
  }
  if (missingExample) {
    where.push(`(
      (COALESCE(e.example, '') = '' AND NOT EXISTS (SELECT 1 FROM dictionary_examples ex WHERE ex.sense_id = s.id))
    )`);
  }

  let orderBy = `COALESCE(l.frequency_rank, e.frequency_rank) ASC, e.id ASC`;
  if (order === "id") orderBy = `e.id ASC`;
  if (order === "reviewed_at") orderBy = `s.reviewed_at DESC NULLS LAST, e.id ASC`;

  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);

  const totalRes = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM dictionary_entries e
      LEFT JOIN dictionary_entry_links el ON el.entry_id = e.id
      LEFT JOIN dictionary_lemmas l ON l.id = el.lemma_id
      LEFT JOIN dictionary_senses s ON s.id = el.sense_id
      WHERE ${where.join(" AND ")}
    `,
    params
  );

  const res = await pool.query(
    `
      SELECT
        e.id,
        e.en,
        e.ru,
        COALESCE(l.frequency_rank, e.frequency_rank) AS "frequencyRank",
        COALESCE(l.rarity, e.rarity) AS rarity,
        COALESCE(s.register, e.register) AS register,
        COALESCE(s.level, e.level) AS level,
        s.reviewed_at AS "reviewedAt",
        s.reviewed_by AS "reviewedBy",
        s.updated_at AS "senseUpdatedAt",
        (COALESCE(l.ipa_uk, '') <> '' OR COALESCE(l.ipa_us, '') <> '' OR COALESCE(e.ipa_uk, '') <> '' OR COALESCE(e.ipa_us, '') <> '') AS "hasIpa",
        (COALESCE(e.example, '') <> '' OR EXISTS (SELECT 1 FROM dictionary_examples ex WHERE ex.sense_id = s.id)) AS "hasExample"
      FROM dictionary_entries e
      LEFT JOIN dictionary_entry_links el ON el.entry_id = e.id
      LEFT JOIN dictionary_lemmas l ON l.id = el.lemma_id
      LEFT JOIN dictionary_senses s ON s.id = el.sense_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $${n} OFFSET $${n + 1}
    `,
    [...params, lim, off]
  );

  return { items: res.rows, total: totalRes.rows[0]?.total ?? 0 };
}

export async function getEntryV2Admin(langCode, entryId) {
  const langResult = await pool.query("SELECT id FROM languages WHERE code = $1", [langCode]);
  if (langResult.rows.length === 0) return null;
  const languageId = langResult.rows[0].id;

  const entryRes = await pool.query(
    `
      SELECT id, en, ru, accent, level,
             frequency_rank AS "frequencyRank", rarity, register,
             ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu"
      FROM dictionary_entries
      WHERE language_id = $1 AND id = $2
      LIMIT 1
    `,
    [languageId, Number(entryId)]
  );
  const entry = entryRes.rows[0] || null;
  if (!entry) return null;

  const linkRes = await pool.query(
    `SELECT lemma_id AS "lemmaId", sense_id AS "senseId" FROM dictionary_entry_links WHERE entry_id = $1 LIMIT 1`,
    [Number(entryId)]
  );
  const lemmaId = linkRes.rows[0]?.lemmaId ?? null;
  const senseId = linkRes.rows[0]?.senseId ?? null;
  if (!lemmaId) return { entry, lemma: null, senses: [], linkedSenseId: senseId };

  const lemmaRes = await pool.query(
    `
      SELECT id, lemma_key AS "lemmaKey", lemma, pos,
             frequency_rank AS "frequencyRank", rarity, accent,
             ipa_uk AS "ipaUk", ipa_us AS "ipaUs",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM dictionary_lemmas
      WHERE id = $1 AND language_id = $2
      LIMIT 1
    `,
    [lemmaId, languageId]
  );
  const lemma = lemmaRes.rows[0] || null;

  const sensesRes = await pool.query(
    `
      SELECT id, lemma_id AS "lemmaId", sense_no AS "senseNo",
             level, register, gloss_ru AS "glossRu",
             definition_ru AS "definitionRu", usage_note AS "usageNote",
             reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM dictionary_senses
      WHERE lemma_id = $1
      ORDER BY sense_no ASC
    `,
    [lemmaId]
  );

  const senses = sensesRes.rows || [];
  const senseIds = senses.map((s) => s.id);

  // examples for senses
  let examplesBySenseId = {};
  if (senseIds.length > 0) {
    const exRes = await pool.query(
      `
        SELECT id, sense_id AS "senseId", en, ru, is_main AS "isMain", sort_order AS "sortOrder"
        FROM dictionary_examples
        WHERE sense_id = ANY($1::int[])
        ORDER BY sense_id ASC, is_main DESC, sort_order ASC, id ASC
      `,
      [senseIds]
    );
    for (const ex of exRes.rows) {
      const sid = ex.senseId;
      if (!examplesBySenseId[sid]) examplesBySenseId[sid] = [];
      examplesBySenseId[sid].push(ex);
    }
  }

  // forms for lemma
  const formsRes = await pool.query(
    `
      SELECT id, lemma_id AS "lemmaId", form, form_type AS "formType", is_irregular AS "isIrregular", notes
      FROM dictionary_forms
      WHERE lemma_id = $1
      ORDER BY form_type ASC, form ASC, id ASC
    `,
    [lemmaId]
  );
  const forms = formsRes.rows || [];

  const sensesWithExamples = senses.map((s) => ({
    ...s,
    examples: examplesBySenseId[s.id] || [],
  }));

  return { entry, lemma, senses: sensesWithExamples, forms, linkedSenseId: senseId };
}

export async function setSenseReviewedAdmin(langCode, entryId, username, reviewed) {
  const langResult = await pool.query("SELECT id FROM languages WHERE code = $1", [langCode]);
  if (langResult.rows.length === 0) return null;
  const languageId = langResult.rows[0].id;

  const linkRes = await pool.query(
    `
      SELECT el.sense_id AS "senseId"
      FROM dictionary_entry_links el
      JOIN dictionary_lemmas l ON l.id = el.lemma_id
      WHERE el.entry_id = $1 AND l.language_id = $2
      LIMIT 1
    `,
    [Number(entryId), languageId]
  );
  const senseId = linkRes.rows[0]?.senseId;
  if (!senseId) return null;

  if (reviewed) {
    const res = await pool.query(
      `
        UPDATE dictionary_senses
        SET reviewed_at = NOW(), reviewed_by = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy"
      `,
      [username, senseId]
    );
    if (res.rows[0]) await insertAudit(username, "review", "sense", senseId, {}, res.rows[0], { entryId, reviewed: true, langCode });
    return res.rows[0] || null;
  }

  const res = await pool.query(
    `
      UPDATE dictionary_senses
      SET reviewed_at = NULL, reviewed_by = NULL, updated_at = NOW()
      WHERE id = $1
      RETURNING id, reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy"
    `,
    [senseId]
  );
  if (res.rows[0]) await insertAudit(username, "review", "sense", senseId, {}, res.rows[0], { entryId, reviewed: false, langCode });
  return res.rows[0] || null;
}

export async function createSenseAdmin(langCode, entryId, data, actorUsername) {
  const v2 = await getEntryV2Admin(langCode, entryId);
  if (!v2 || !v2.lemma?.id) return null;
  const lemmaId = v2.lemma.id;

  const maxRes = await pool.query(
    `SELECT COALESCE(MAX(sense_no), 0)::int AS n FROM dictionary_senses WHERE lemma_id = $1`,
    [lemmaId]
  );
  const nextNo = (maxRes.rows[0]?.n ?? 0) + 1;

  const level = normalizeLevel(data?.level);
  const register = normalizeRegister(data?.register);
  const glossRu = String(data?.glossRu || "").trim();
  const definitionRu = String(data?.definitionRu || "");
  const usageNote = String(data?.usageNote || "");

  const res = await pool.query(
    `
      INSERT INTO dictionary_senses (lemma_id, sense_no, level, register, gloss_ru, definition_ru, usage_note, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id
    `,
    [lemmaId, nextNo, level, register, glossRu, definitionRu, usageNote]
  );
  const senseId = res.rows[0]?.id;
  if (!senseId) return null;
  await insertAudit(actorUsername, "create", "sense", senseId, {}, { lemmaId, senseNo: nextNo }, { entryId, langCode });
  return await getEntryV2Admin(langCode, entryId);
}

export async function patchSenseAdmin(langCode, senseId, patch, actorUsername) {
  // Guard: sense #1 fields, которые дублируют legacy dictionary_entries, нельзя менять через v2.
  const infoRes = await pool.query(
    `SELECT id, lemma_id AS "lemmaId", sense_no AS "senseNo" FROM dictionary_senses WHERE id = $1 LIMIT 1`,
    [Number(senseId)]
  );
  const info = infoRes.rows[0];
  if (!info) return null;
  const isPrimary = Number(info.senseNo) === 1;

  const allowedPairs = isPrimary
    ? [
        // для sense#1 разрешаем только дополнительные поля (не влияющие на legacy)
        ["definitionRu", "definition_ru"],
        ["usageNote", "usage_note"],
      ]
    : [
        ["level", "level"],
        ["register", "register"],
        ["glossRu", "gloss_ru"],
        ["definitionRu", "definition_ru"],
        ["usageNote", "usage_note"],
      ];

  const allowed = new Map(allowedPairs);

  const set = [];
  const params = [];
  let n = 1;

  for (const [key, col] of allowed) {
    if (!patch || patch[key] === undefined) continue;
    let value = patch[key];
    if (key === "level") value = normalizeLevel(value);
    if (key === "register") value = normalizeRegister(value);
    if (key === "glossRu") value = String(value || "").trim();
    if (key === "definitionRu" || key === "usageNote") value = String(value || "");
    set.push(`${col} = $${n}`);
    params.push(value);
    n++;
  }
  if (set.length === 0) return null;
  set.push(`updated_at = NOW()`);

  const res = await pool.query(
    `
      UPDATE dictionary_senses
      SET ${set.join(", ")}
      WHERE id = $${n}
      RETURNING id, lemma_id AS "lemmaId"
    `,
    [...params, Number(senseId)]
  );
  const out = res.rows[0] || null;
  if (out) await insertAudit(actorUsername, "update", "sense", senseId, {}, patch || {}, { langCode });
  return out;
}

async function insertAudit(username, action, entityType, entityId, beforeJson, afterJson, meta = {}, db = pool) {
  try {
    await db.query(
      `INSERT INTO dictionary_audit_log (username, action, entity_type, entity_id, meta, before_json, after_json)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        username || null,
        action,
        entityType,
        String(entityId ?? ""),
        JSON.stringify(meta || {}),
        JSON.stringify(beforeJson || {}),
        JSON.stringify(afterJson || {}),
      ]
    );
  } catch (e) {
    console.warn("audit log insert failed:", e);
  }
}

export async function addExampleAdmin(langCode, senseId, data, actorUsername) {
  const en = String(data?.en || "").trim();
  const ru = String(data?.ru || "").trim();
  const isMain = !!data?.isMain;
  const sortOrder = Number.isFinite(Number(data?.sortOrder)) ? Number(data.sortOrder) : 0;
  if (!en) return null;

  if (isMain) {
    await pool.query(`UPDATE dictionary_examples SET is_main = FALSE WHERE sense_id = $1`, [Number(senseId)]);
  }
  const res = await pool.query(
    `
      INSERT INTO dictionary_examples (sense_id, en, ru, is_main, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, sense_id AS "senseId", en, ru, is_main AS "isMain", sort_order AS "sortOrder"
    `,
    [Number(senseId), en, ru, isMain, sortOrder]
  );
  const ex = res.rows[0] || null;
  if (ex) {
    await insertAudit(actorUsername, "create", "example", ex.id, {}, ex, { senseId });
  }
  return ex;
}

export async function deleteExampleAdmin(langCode, exampleId, actorUsername) {
  const before = await pool.query(
    `SELECT id, sense_id AS "senseId", en, ru, is_main AS "isMain", sort_order AS "sortOrder" FROM dictionary_examples WHERE id = $1`,
    [Number(exampleId)]
  );
  if (!before.rows[0]) return null;
  await pool.query(`DELETE FROM dictionary_examples WHERE id = $1`, [Number(exampleId)]);
  await insertAudit(actorUsername, "delete", "example", exampleId, before.rows[0], {}, { senseId: before.rows[0].senseId });
  return { ok: true };
}

export async function setMainExampleAdmin(langCode, exampleId, actorUsername) {
  const rowRes = await pool.query(
    `SELECT id, sense_id AS "senseId", en, ru, is_main AS "isMain" FROM dictionary_examples WHERE id = $1`,
    [Number(exampleId)]
  );
  const ex = rowRes.rows[0];
  if (!ex) return null;

  await pool.query(`UPDATE dictionary_examples SET is_main = FALSE WHERE sense_id = $1`, [ex.senseId]);
  const updatedRes = await pool.query(
    `
      UPDATE dictionary_examples
      SET is_main = TRUE, sort_order = 0
      WHERE id = $1
      RETURNING id, sense_id AS "senseId", en, ru, is_main AS "isMain", sort_order AS "sortOrder"
    `,
    [Number(exampleId)]
  );
  const updated = updatedRes.rows[0] || null;
  if (updated) {
    await insertAudit(actorUsername, "update", "example", exampleId, ex, updated, { setMain: true });
  }

  // If this sense is linked to a legacy entry, keep legacy example in sync
  if (updated) {
    try {
      const link = await pool.query(
        `SELECT entry_id AS "entryId" FROM dictionary_entry_links WHERE sense_id = $1 LIMIT 1`,
        [updated.senseId]
      );
      const entryId = link.rows[0]?.entryId;
      if (entryId) {
        await pool.query(
          `UPDATE dictionary_entries SET example = $1, example_ru = $2 WHERE id = $3`,
          [updated.en, updated.ru || "", Number(entryId)]
        );
        await insertAudit(actorUsername, "update", "entry", entryId, {}, { example: updated.en, exampleRu: updated.ru }, { syncFrom: "main_example" });
      }
    } catch (e) {
      console.warn("sync legacy example failed:", e);
    }
  }
  return updated;
}

export async function addFormAdmin(langCode, lemmaId, data, actorUsername) {
  const form = String(data?.form || "").trim();
  const formType = String(data?.formType || "").trim();
  const isIrregular = !!data?.isIrregular;
  const notes = String(data?.notes || "");
  if (!form) return null;
  const res = await pool.query(
    `
      INSERT INTO dictionary_forms (lemma_id, form, form_type, is_irregular, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, lemma_id AS "lemmaId", form, form_type AS "formType", is_irregular AS "isIrregular", notes
    `,
    [Number(lemmaId), form, formType, isIrregular, notes]
  );
  const out = res.rows[0] || null;
  if (out) await insertAudit(actorUsername, "create", "form", out.id, {}, out, { lemmaId });
  return out;
}

export async function deleteFormAdmin(langCode, formId, actorUsername) {
  const before = await pool.query(
    `SELECT id, lemma_id AS "lemmaId", form, form_type AS "formType", is_irregular AS "isIrregular", notes FROM dictionary_forms WHERE id = $1`,
    [Number(formId)]
  );
  if (!before.rows[0]) return null;
  await pool.query(`DELETE FROM dictionary_forms WHERE id = $1`, [Number(formId)]);
  await insertAudit(actorUsername, "delete", "form", formId, before.rows[0], {}, { lemmaId: before.rows[0].lemmaId });
  return { ok: true };
}

export async function patchExampleAdmin(langCode, exampleId, patch, actorUsername) {
  const beforeRes = await pool.query(
    `SELECT id, sense_id AS "senseId", en, ru, is_main AS "isMain", sort_order AS "sortOrder" FROM dictionary_examples WHERE id = $1`,
    [Number(exampleId)]
  );
  const before = beforeRes.rows[0];
  if (!before) return null;

  const set = [];
  const params = [];
  let n = 1;

  if (patch?.en !== undefined) {
    set.push(`en = $${n++}`);
    params.push(String(patch.en || "").trim());
  }
  if (patch?.ru !== undefined) {
    set.push(`ru = $${n++}`);
    params.push(String(patch.ru || "").trim());
  }
  if (patch?.sortOrder !== undefined) {
    set.push(`sort_order = $${n++}`);
    params.push(Number.isFinite(Number(patch.sortOrder)) ? Number(patch.sortOrder) : 0);
  }
  if (patch?.isMain === true) {
    // set main: clear others in sense
    await pool.query(`UPDATE dictionary_examples SET is_main = FALSE WHERE sense_id = $1`, [before.senseId]);
    set.push(`is_main = TRUE`);
  } else if (patch?.isMain === false) {
    set.push(`is_main = FALSE`);
  }

  if (set.length === 0) return before;

  const res = await pool.query(
    `
      UPDATE dictionary_examples
      SET ${set.join(", ")}
      WHERE id = $${n}
      RETURNING id, sense_id AS "senseId", en, ru, is_main AS "isMain", sort_order AS "sortOrder"
    `,
    [...params, Number(exampleId)]
  );
  const after = res.rows[0] || null;
  if (after) await insertAudit(actorUsername, "update", "example", exampleId, before, after, { langCode });
  return after;
}

export async function patchFormAdmin(langCode, formId, patch, actorUsername) {
  const beforeRes = await pool.query(
    `SELECT id, lemma_id AS "lemmaId", form, form_type AS "formType", is_irregular AS "isIrregular", notes FROM dictionary_forms WHERE id = $1`,
    [Number(formId)]
  );
  const before = beforeRes.rows[0];
  if (!before) return null;

  const set = [];
  const params = [];
  let n = 1;

  if (patch?.form !== undefined) {
    set.push(`form = $${n++}`);
    params.push(String(patch.form || "").trim());
  }
  if (patch?.formType !== undefined) {
    set.push(`form_type = $${n++}`);
    params.push(String(patch.formType || "").trim());
  }
  if (patch?.isIrregular !== undefined) {
    set.push(`is_irregular = $${n++}`);
    params.push(!!patch.isIrregular);
  }
  if (patch?.notes !== undefined) {
    set.push(`notes = $${n++}`);
    params.push(String(patch.notes || ""));
  }
  if (set.length === 0) return before;

  const res = await pool.query(
    `
      UPDATE dictionary_forms
      SET ${set.join(", ")}
      WHERE id = $${n}
      RETURNING id, lemma_id AS "lemmaId", form, form_type AS "formType", is_irregular AS "isIrregular", notes
    `,
    [...params, Number(formId)]
  );
  const after = res.rows[0] || null;
  if (after) await insertAudit(actorUsername, "update", "form", formId, before, after, { langCode });
  return after;
}

export async function deleteSenseAdmin(langCode, senseId, actorUsername) {
  const infoRes = await pool.query(
    `SELECT id, lemma_id AS "lemmaId", sense_no AS "senseNo" FROM dictionary_senses WHERE id = $1`,
    [Number(senseId)]
  );
  const info = infoRes.rows[0];
  if (!info) return null;
  if (Number(info.senseNo) === 1) {
    return { error: "Нельзя удалить основное значение (sense #1). Оно связано с legacy словарём." };
  }
  const before = { ...info };
  await pool.query(`DELETE FROM dictionary_senses WHERE id = $1`, [Number(senseId)]);
  await insertAudit(actorUsername, "delete", "sense", senseId, before, {}, { langCode });
  return { ok: true };
}

/**
 * Обновить версию словаря для данного языка.
 * Версия вычисляется как MAX(id) + COUNT(*) для быстрого определения изменений.
 * @param {string} langCode — код языка (например 'en')
 * @returns {Promise<string>} — новая версия словаря
 */
export async function updateDictionaryVersion(langCode) {
  const langResult = await pool.query(
    "SELECT id FROM languages WHERE code = $1",
    [langCode]
  );
  if (langResult.rows.length === 0) return "";
  const languageId = langResult.rows[0].id;
  
  // Быстрое вычисление версии: MAX(id) + COUNT(*)
  const res = await pool.query(
    `SELECT 
       COALESCE(MAX(id), 0) as max_id,
       COUNT(*) as count
     FROM dictionary_entries
     WHERE language_id = $1`,
    [languageId]
  );
  
  const maxId = res.rows[0].max_id || 0;
  const count = res.rows[0].count || 0;
  const version = `${maxId}_${count}`;
  
  // Сохраняем версию в таблице languages
  await pool.query(
    "UPDATE languages SET version = $1 WHERE code = $2",
    [version, langCode]
  );
  
  return version;
}
