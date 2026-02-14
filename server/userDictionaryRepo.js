import { pool } from "./db.js";

function clampInt(v, min, max, fallback) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeStatus(v) {
  const s = String(v || "").trim().toLowerCase();
  if (["queue", "learning", "known", "hard"].includes(s)) return s;
  return "queue";
}

async function getLanguageId(langCode, db = pool) {
  const res = await db.query("SELECT id FROM languages WHERE code = $1", [String(langCode || "en")]);
  return res.rows[0]?.id || null;
}

async function getSenseIdsByEntryIds(langCode, entryIds, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return new Map();
  const ids = Array.from(new Set((entryIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return new Map();
  const res = await db.query(
    `
      SELECT e.id AS "entryId", l.sense_id AS "senseId", l.lemma_id AS "lemmaId"
      FROM dictionary_entries e
      JOIN dictionary_entry_links l ON l.entry_id = e.id
      JOIN dictionary_senses s ON s.id = l.sense_id
      JOIN dictionary_lemmas m ON m.id = l.lemma_id
      WHERE e.language_id = $1 AND e.id = ANY($2::int[])
    `,
    [languageId, ids]
  );
  const map = new Map();
  for (const row of res.rows) {
    map.set(Number(row.entryId), { senseId: Number(row.senseId), lemmaId: Number(row.lemmaId) });
  }
  return map;
}

/**
 * Р›РµРЅРёРІРѕ РїРµСЂРµРЅРѕСЃРёС‚ legacy users.personal_dictionary/word_progress в†’ РЅРѕСЂРјР°Р»РёР·РѕРІР°РЅРЅС‹Рµ С‚Р°Р±Р»РёС†С‹.
 * Р‘РµР·РѕРїР°СЃРЅРѕ РІС‹Р·С‹РІР°С‚СЊ РјРЅРѕРіРѕРєСЂР°С‚РЅРѕ.
 */
export async function ensureUserDictionaryBackfilled(username, langCode = "en", db = pool) {
  const u = String(username || "").trim();
  if (!u) return { ok: false, reason: "no-username" };

  // РµСЃР»Рё СѓР¶Рµ РµСЃС‚СЊ СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ СЃРјС‹СЃР»С‹ вЂ” СЃС‡РёС‚Р°РµРј, С‡С‚Рѕ РјРёРіСЂР°С†РёСЏ СѓР¶Рµ Р±С‹Р»Р°
  const existing = await db.query(`SELECT 1 FROM user_saved_senses WHERE username = $1 LIMIT 1`, [u]);
  if (existing.rows.length > 0) return { ok: true, migrated: false };

  const userRes = await db.query(
    `SELECT personal_dictionary AS "personalDictionary", word_progress AS "wordProgress" FROM users WHERE username = $1`,
    [u]
  );
  const row = userRes.rows[0];
  const personalDictionary = Array.isArray(row?.personalDictionary) ? row.personalDictionary : [];
  const wordProgress = row?.wordProgress && typeof row.wordProgress === "object" ? row.wordProgress : {};

  const entryMap = await getSenseIdsByEntryIds(langCode, personalDictionary, db);
  const senseIdsToSave = Array.from(entryMap.values()).map((x) => x.senseId);

  if (senseIdsToSave.length > 0) {
    await db.query(
      `
        INSERT INTO user_saved_senses (username, sense_id, status, source)
        SELECT $1, s.id, 'queue', 'legacy'
        FROM UNNEST($2::int[]) AS t(sense_id)
        JOIN dictionary_senses s ON s.id = t.sense_id
        ON CONFLICT (username, sense_id) DO NOTHING
      `,
      [u, senseIdsToSave]
    );
  }

  // word_progress: РєР»СЋС‡Рё вЂ” entryId в†’ { beginner/experienced/expert }
  const progressEntries = Object.entries(wordProgress || {});
  if (progressEntries.length > 0) {
    const entryIds = progressEntries.map(([id]) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
    const progressMap = await getSenseIdsByEntryIds(langCode, entryIds, db);

    const rows = [];
    for (const [entryIdStr, byType] of progressEntries) {
      const entryId = Number(entryIdStr);
      const link = progressMap.get(entryId);
      if (!link) continue;
      const b = clampInt(byType?.beginner, 0, 100, 0);
      const e = clampInt(byType?.experienced, 0, 100, 0);
      const x = clampInt(byType?.expert, 0, 100, 0);
      rows.push({ senseId: link.senseId, beginner: b, experienced: e, expert: x });
    }

    if (rows.length > 0) {
      // bulk upsert
      const senseIds = rows.map((r) => r.senseId);
      const beginner = rows.map((r) => r.beginner);
      const experienced = rows.map((r) => r.experienced);
      const expert = rows.map((r) => r.expert);
      await db.query(
        `
          INSERT INTO user_sense_progress (username, sense_id, beginner, experienced, expert, updated_at)
          SELECT
            $1,
            t.sense_id,
            t.beginner,
            t.experienced,
            t.expert,
            NOW()
          FROM UNNEST($2::int[], $3::int[], $4::int[], $5::int[]) AS t(sense_id, beginner, experienced, expert)
          ON CONFLICT (username, sense_id) DO UPDATE SET
            beginner = EXCLUDED.beginner,
            experienced = EXCLUDED.experienced,
            expert = EXCLUDED.expert,
            updated_at = NOW()
        `,
        [u, senseIds, beginner, experienced, expert]
      );
    }
  }

  return { ok: true, migrated: true, savedSenses: senseIdsToSave.length };
}

/**
 * РЎРёРЅС…СЂРѕРЅРёР·РёСЂСѓРµС‚ РЅРѕСЂРјР°Р»РёР·РѕРІР°РЅРЅС‹Рµ С‚Р°Р±Р»РёС†С‹ СЃ PATCH /me (legacy JSON-РїРѕР»СЏ).
 * Р§С‚РѕР±С‹ РЅРµ Р»РѕРјР°С‚СЊ С‚РµРєСѓС‰РёРµ РёРіСЂС‹/РєР»РёРµРЅС‚, РєРѕС‚РѕСЂС‹Рµ РїСЂРѕРґРѕР»Р¶Р°СЋС‚ СЃР»Р°С‚СЊ personalDictionary/wordProgress РєР°Рє JSON.
 */
export async function syncUserDictionaryFromMePatch(username, langCode, patch, db = pool) {
  const u = String(username || "").trim();
  if (!u) return { ok: false, reason: "no-username" };

  const personalDictionary = patch?.personalDictionary;
  const wordProgress = patch?.wordProgress;

  if (personalDictionary !== undefined) {
    const list = Array.isArray(personalDictionary) ? personalDictionary : [];
    const entryMap = await getSenseIdsByEntryIds(langCode, list, db);
    const senseIds = Array.from(entryMap.values()).map((x) => x.senseId);

    // РІСЃС‚Р°РІРёРј РЅРµРґРѕСЃС‚Р°СЋС‰РёРµ
    if (senseIds.length > 0) {
      await db.query(
        `
          INSERT INTO user_saved_senses (username, sense_id, status, source, added_at, updated_at)
          SELECT $1, s.id, 'queue', 'legacy', NOW(), NOW()
          FROM UNNEST($2::int[]) AS t(sense_id)
          JOIN dictionary_senses s ON s.id = t.sense_id
          ON CONFLICT (username, sense_id) DO NOTHING
        `,
        [u, senseIds]
      );
    }
    // Р’Р°Р¶РЅРѕ: РЅРµ СѓРґР°Р»СЏРµРј РёР· user_saved_senses Р·Р°РїРёСЃРё, РѕС‚СЃСѓС‚СЃС‚РІСѓСЋС‰РёРµ РІ legacy personalDictionary.
    // Legacy-РґР°РЅРЅС‹Рµ РјРѕРіСѓС‚ Р±С‹С‚СЊ СѓСЃС‚Р°СЂРµРІС€РёРјРё Рё РёРЅР°С‡Рµ "Р·Р°С‚РёСЂР°СЋС‚" РЅРѕРІС‹Рµ РґРѕР±Р°РІР»РµРЅРёСЏ РёР· user-dictionary API.
  }

  if (wordProgress && typeof wordProgress === "object") {
    const entries = Object.entries(wordProgress);
    const entryIds = entries.map(([id]) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
    const progressMap = await getSenseIdsByEntryIds(langCode, entryIds, db);
    const rows = [];
    for (const [entryIdStr, byType] of entries) {
      const entryId = Number(entryIdStr);
      const link = progressMap.get(entryId);
      if (!link) continue;
      rows.push({
        senseId: link.senseId,
        beginner: clampInt(byType?.beginner, 0, 100, 0),
        experienced: clampInt(byType?.experienced, 0, 100, 0),
        expert: clampInt(byType?.expert, 0, 100, 0),
      });
    }
    if (rows.length > 0) {
      const senseIds = rows.map((r) => r.senseId);
      const beginner = rows.map((r) => r.beginner);
      const experienced = rows.map((r) => r.experienced);
      const expert = rows.map((r) => r.expert);
      await db.query(
        `
          INSERT INTO user_sense_progress (username, sense_id, beginner, experienced, expert, updated_at)
          SELECT
            $1,
            t.sense_id,
            t.beginner,
            t.experienced,
            t.expert,
            NOW()
          FROM UNNEST($2::int[], $3::int[], $4::int[], $5::int[]) AS t(sense_id, beginner, experienced, expert)
          ON CONFLICT (username, sense_id) DO UPDATE SET
            beginner = EXCLUDED.beginner,
            experienced = EXCLUDED.experienced,
            expert = EXCLUDED.expert,
            updated_at = NOW()
        `,
        [u, senseIds, beginner, experienced, expert]
      );
    }
  }

  return { ok: true };
}

export async function listMyWords(username, langCode, params = {}, db = pool) {
  const u = String(username || "").trim();
  if (!u) return { items: [], total: 0 };

  const q = String(params.q || "").trim().toLowerCase();
  const rawStatus = String(params.status || "all").trim().toLowerCase();
  const status = rawStatus === "all" ? "all" : normalizeStatus(rawStatus);
  const offset = clampInt(params.offset, 0, 1_000_000, 0);
  const limit = clampInt(params.limit, 1, 200, 50);

  const where = ["us.username = $1"];
  const values = [u];
  let n = values.length + 1;

  if (status !== "all") {
    where.push(`us.status = $${n++}`);
    values.push(status);
  }
  if (q) {
    where.push(`(LOWER(m.lemma) LIKE $${n} OR LOWER(s.gloss_ru) LIKE $${n} OR LOWER(e.example) LIKE $${n})`);
    values.push(`%${q}%`);
    n++;
  }

  const whereSql = where.join(" AND ");

  const totalRes = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM user_saved_senses us
      JOIN dictionary_senses s ON s.id = us.sense_id
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      LEFT JOIN dictionary_examples e ON e.sense_id = s.id AND e.is_main = TRUE
      WHERE ${whereSql}
    `,
    values
  );

  const res = await db.query(
    `
      SELECT
        s.id AS "senseId",
        m.id AS "lemmaId",
        m.lemma AS "en",
        s.gloss_ru AS "ru",
        s.level AS "level",
        s.register AS "register",
        m.accent AS "accent",
        m.ipa_uk AS "ipaUk",
        m.ipa_us AS "ipaUs",
        COALESCE(e.en, '') AS "example",
        COALESCE(e.ru, '') AS "exampleRu",
        us.status AS "status",
        us.is_favorite AS "isFavorite",
        us.added_at AS "addedAt",
        p.beginner AS "beginner",
        p.experienced AS "experienced"
      FROM user_saved_senses us
      JOIN dictionary_senses s ON s.id = us.sense_id
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      LEFT JOIN dictionary_examples e ON e.sense_id = s.id AND e.is_main = TRUE
      LEFT JOIN user_sense_progress p ON p.username = us.username AND p.sense_id = us.sense_id
      WHERE ${whereSql}
      ORDER BY us.updated_at DESC, us.added_at DESC
      OFFSET $${n} LIMIT $${n + 1}
    `,
    [...values, offset, limit]
  );

  return { items: res.rows, total: totalRes.rows[0]?.total || 0 };
}

/**
 * РЎРІРѕРґРєР° РїРѕ СЃР»РѕРІР°СЂСЋ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ: РІСЃРµРіРѕ СЃР»РѕРІ Рё СЂР°Р·Р±РёРІРєР° РїРѕ СЃС‚Р°С‚СѓСЃР°Рј (РґР»СЏ Р±Р»РѕРєР° В«РњРѕР№ РїСЂРѕРіСЂРµСЃСЃВ»).
 * РЈС‡РёС‚С‹РІР°СЋС‚СЃСЏ РІСЃРµ СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ СЃРјС‹СЃР»С‹ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (Р±РµР· С„РёР»СЊС‚СЂР° РїРѕ СЏР·С‹РєСѓ), С‡С‚РѕР±С‹ СЃС‡С‘С‚С‡РёРєРё СЃРѕРІРїР°РґР°Р»Рё СЃ В«РњРѕРё СЃР»РѕРІР°В» Рё РєРѕР»Р»РµРєС†РёСЏРјРё.
 */
export async function getMyWordsSummary(username, langCode, db = pool) {
  const u = String(username || "").trim();
  if (!u) return { total: 0, queue: 0, learning: 0, known: 0, hard: 0 };

  const res = await db.query(
    `
      SELECT us.status, COUNT(*)::int AS cnt
      FROM user_saved_senses us
      JOIN dictionary_senses s ON s.id = us.sense_id
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      WHERE us.username = $1
      GROUP BY us.status
    `,
    [u]
  );

  const out = { total: 0, queue: 0, learning: 0, known: 0, hard: 0 };
  for (const row of res.rows) {
    const status = String(row.status || "").trim().toLowerCase();
    const cnt = Number(row.cnt) || 0;
    if (["queue", "learning", "known", "hard"].includes(status)) {
      out[status] = cnt;
      out.total += cnt;
    }
  }
  return out;
}

export async function getWordCardByEntryId(langCode, entryId, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return null;
  const id = Number(entryId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const entryRes = await db.query(
    `
      SELECT id, en, ru, accent, level,
             frequency_rank AS "frequencyRank", rarity, register,
             ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu"
      FROM dictionary_entries
      WHERE language_id = $1 AND id = $2
    `,
    [languageId, id]
  );
  const entry = entryRes.rows[0] || null;
  if (!entry) return null;

  const linkRes = await db.query(
    `SELECT lemma_id AS "lemmaId", sense_id AS "senseId" FROM dictionary_entry_links WHERE entry_id = $1`,
    [id]
  );
  const lemmaId = linkRes.rows[0]?.lemmaId || null;
  const linkedSenseId = linkRes.rows[0]?.senseId || null;

  let lemma = null;
  let senses = [];
  let forms = [];
  if (lemmaId) {
    const lemmaRes = await db.query(
      `
        SELECT id, lemma_key AS "lemmaKey", lemma, pos,
               frequency_rank AS "frequencyRank", rarity, accent,
               ipa_uk AS "ipaUk", ipa_us AS "ipaUs",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM dictionary_lemmas
        WHERE id = $1
      `,
      [lemmaId]
    );
    lemma = lemmaRes.rows[0] || null;

    const sensesRes = await db.query(
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
    senses = sensesRes.rows || [];

    const senseIds = senses.map((s) => s.id);
    if (senseIds.length > 0) {
      const examplesRes = await db.query(
        `
          SELECT id, sense_id AS "senseId", en, ru, is_main AS "isMain", sort_order AS "sortOrder"
          FROM dictionary_examples
          WHERE sense_id = ANY($1::int[])
          ORDER BY is_main DESC, sort_order ASC, id ASC
        `,
        [senseIds]
      );
      const bySense = new Map();
      for (const ex of examplesRes.rows) {
        const sid = Number(ex.senseId);
        const arr = bySense.get(sid) || [];
        arr.push(ex);
        bySense.set(sid, arr);
      }
      senses = senses.map((s) => ({ ...s, examples: bySense.get(Number(s.id)) || [] }));
    } else {
      senses = senses.map((s) => ({ ...s, examples: [] }));
    }

    const formsRes = await db.query(
      `
        SELECT id, lemma_id AS "lemmaId", form, form_type AS "formType",
               is_irregular AS "isIrregular", notes
        FROM dictionary_forms
        WHERE lemma_id = $1
        ORDER BY form_type ASC, form ASC
      `,
      [lemmaId]
    );
    forms = formsRes.rows || [];
  }

  const links = lemmaId
    ? (
        await db.query(
          `
            SELECT
              dl.id,
              dl.link_type AS "type",
              dl.note_ru AS "noteRu",
              dl.rank,
              dl.to_lemma_id AS "toLemmaId",
              m.lemma AS "toLemma",
              s.gloss_ru AS "toGlossRu",
              s.level AS "toLevel",
              s.register AS "toRegister"
            FROM dictionary_links dl
            JOIN dictionary_lemmas m ON m.id = dl.to_lemma_id
            LEFT JOIN dictionary_senses s ON s.lemma_id = m.id AND s.sense_no = 1
            WHERE dl.from_lemma_id = $1
            ORDER BY dl.link_type ASC, dl.rank DESC, dl.id DESC
            LIMIT 50
          `,
          [lemmaId]
        )
      ).rows
    : [];

  const collocations = lemmaId
    ? (
        await db.query(
          `
            SELECT id, phrase_en AS "phraseEn", gloss_ru AS "glossRu", level, register,
                   example_en AS "exampleEn", example_ru AS "exampleRu"
            FROM dictionary_collocations
            WHERE lemma_id = $1
            ORDER BY sort_order ASC, id ASC
            LIMIT 50
          `,
          [lemmaId]
        )
      ).rows
    : [];

  const patterns = linkedSenseId
    ? (
        await db.query(
          `
            SELECT id, tag, en, ru, sort_order AS "sortOrder"
            FROM dictionary_usage_patterns
            WHERE sense_id = $1
            ORDER BY sort_order ASC, id ASC
            LIMIT 50
          `,
          [linkedSenseId]
        )
      ).rows
    : [];

  return { entry, lemma, senses, forms, linkedSenseId, links, collocations, patterns };
}

export async function getWordCardBySenseId(langCode, senseId, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return null;
  const sid = Number(senseId);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  const senseRes = await db.query(
    `
      SELECT
        s.id AS "senseId",
        s.lemma_id AS "lemmaId",
        s.sense_no AS "senseNo",
        s.level AS "level",
        s.register AS "register",
        s.gloss_ru AS "glossRu",
        s.definition_ru AS "definitionRu",
        s.usage_note AS "usageNote",
        l.lemma AS "lemma",
        l.lemma_key AS "lemmaKey",
        l.pos AS "pos",
        l.frequency_rank AS "frequencyRank",
        l.rarity AS "rarity",
        l.accent AS "accent",
        l.ipa_uk AS "ipaUk",
        l.ipa_us AS "ipaUs",
        l.language_id AS "languageId"
      FROM dictionary_senses s
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      WHERE s.id = $1 AND l.language_id = $2
    `,
    [sid, languageId]
  );
  const info = senseRes.rows[0] || null;
  if (!info) return null;

  // РџРѕРїСЂРѕР±СѓРµРј РЅР°Р№С‚Рё legacy entry_id РґР»СЏ СЌС‚РѕРіРѕ sense (РѕР±С‹С‡РЅРѕ РµСЃС‚СЊ С‚РѕР»СЊРєРѕ РґР»СЏ sense #1)
  const entryLink = await db.query(
    `SELECT entry_id AS "entryId" FROM dictionary_entry_links WHERE sense_id = $1 LIMIT 1`,
    [sid]
  );
  const entryId = entryLink.rows[0]?.entryId ? Number(entryLink.rows[0].entryId) : null;

  // main example (РµСЃР»Рё РµСЃС‚СЊ)
  const mainEx = await db.query(
    `SELECT en, ru FROM dictionary_examples WHERE sense_id = $1 AND is_main = TRUE ORDER BY id ASC LIMIT 1`,
    [sid]
  );
  const ex = mainEx.rows[0] || { en: "", ru: "" };

  // РЎРѕР±РµСЂС‘Рј entry-like РѕР±СЉРµРєС‚ РґР»СЏ UI (РєР°Р·СѓР°Р»СЊРЅР°СЏ РєР°СЂС‚РѕС‡РєР°)
  const entry = {
    id: entryId || 0,
    en: info.lemma,
    ru: info.glossRu || "",
    accent: info.accent,
    level: info.level,
    frequencyRank: info.frequencyRank,
    rarity: info.rarity,
    register: info.register,
    ipaUk: info.ipaUk || "",
    ipaUs: info.ipaUs || "",
    example: ex.en || "",
    exampleRu: ex.ru || "",
  };

  const lemma = {
    id: info.lemmaId,
    lemmaKey: info.lemmaKey,
    lemma: info.lemma,
    pos: info.pos,
    frequencyRank: info.frequencyRank,
    rarity: info.rarity,
    accent: info.accent,
    ipaUk: info.ipaUk || "",
    ipaUs: info.ipaUs || "",
    createdAt: null,
    updatedAt: null,
  };

  const sensesRes = await db.query(
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
    [info.lemmaId]
  );
  let senses = sensesRes.rows || [];

  const senseIds = senses.map((s) => s.id);
  if (senseIds.length > 0) {
    const examplesRes = await db.query(
      `
        SELECT id, sense_id AS "senseId", en, ru, is_main AS "isMain", sort_order AS "sortOrder"
        FROM dictionary_examples
        WHERE sense_id = ANY($1::int[])
        ORDER BY is_main DESC, sort_order ASC, id ASC
      `,
      [senseIds]
    );
    const bySense = new Map();
    for (const eRow of examplesRes.rows) {
      const k = Number(eRow.senseId);
      const arr = bySense.get(k) || [];
      arr.push(eRow);
      bySense.set(k, arr);
    }
    senses = senses.map((s) => ({ ...s, examples: bySense.get(Number(s.id)) || [] }));
  } else {
    senses = senses.map((s) => ({ ...s, examples: [] }));
  }

  const formsRes = await db.query(
    `
      SELECT id, lemma_id AS "lemmaId", form, form_type AS "formType",
             is_irregular AS "isIrregular", notes
      FROM dictionary_forms
      WHERE lemma_id = $1
      ORDER BY form_type ASC, form ASC
    `,
    [info.lemmaId]
  );
  const forms = formsRes.rows || [];

  const links = (
    await db.query(
      `
        SELECT
          dl.id,
          dl.link_type AS "type",
          dl.note_ru AS "noteRu",
          dl.rank,
          dl.to_lemma_id AS "toLemmaId",
          m.lemma AS "toLemma",
          s.id AS "toSenseId",
          s.gloss_ru AS "toGlossRu",
          s.level AS "toLevel",
          s.register AS "toRegister"
        FROM dictionary_links dl
        JOIN dictionary_lemmas m ON m.id = dl.to_lemma_id
        LEFT JOIN dictionary_senses s ON s.lemma_id = m.id AND s.sense_no = 1
        WHERE dl.from_lemma_id = $1
        ORDER BY dl.link_type ASC, dl.rank DESC, dl.id DESC
        LIMIT 50
      `,
      [info.lemmaId]
    )
  ).rows;

  const collocations = (
    await db.query(
      `
        SELECT id, phrase_en AS "phraseEn", gloss_ru AS "glossRu", level, register,
               example_en AS "exampleEn", example_ru AS "exampleRu"
        FROM dictionary_collocations
        WHERE lemma_id = $1
        ORDER BY sort_order ASC, id ASC
        LIMIT 50
      `,
      [info.lemmaId]
    )
  ).rows;

  const patterns = (
    await db.query(
      `
        SELECT id, tag, en, ru, sort_order AS "sortOrder"
        FROM dictionary_usage_patterns
        WHERE sense_id = $1
        ORDER BY sort_order ASC, id ASC
        LIMIT 50
      `,
      [sid]
    )
  ).rows;

  return { entry, lemma, senses, forms, linkedSenseId: sid, links, collocations, patterns };
}

export async function addSavedByEntryId(username, langCode, entryId, source = "manual", db = pool) {
  const u = String(username || "").trim();
  const id = Number(entryId);
  if (!u || !Number.isFinite(id) || id <= 0) return null;
  const map = await getSenseIdsByEntryIds(langCode, [id], db);
  const link = map.get(id);
  if (!link) return null;
  await db.query(
    `
      INSERT INTO user_saved_senses (username, sense_id, status, source, added_at, updated_at)
      VALUES ($1, $2, 'queue', $3, NOW(), NOW())
      ON CONFLICT (username, sense_id) DO UPDATE SET updated_at = NOW()
    `,
    [u, link.senseId, String(source || "manual")]
  );
  return { senseId: link.senseId, lemmaId: link.lemmaId };
}

export async function removeSavedByEntryId(username, langCode, entryId, db = pool) {
  const u = String(username || "").trim();
  const id = Number(entryId);
  if (!u || !Number.isFinite(id) || id <= 0) return { ok: false };
  const map = await getSenseIdsByEntryIds(langCode, [id], db);
  const link = map.get(id);
  if (!link) return { ok: false };
  await db.query(`DELETE FROM user_saved_senses WHERE username = $1 AND sense_id = $2`, [u, link.senseId]);
  return { ok: true };
}

export async function addSavedBySenseId(username, senseId, source = "manual", db = pool) {
  const u = String(username || "").trim();
  const sid = Number(senseId);
  if (!u || !Number.isFinite(sid) || sid <= 0) return null;
  await db.query(
    `
      INSERT INTO user_saved_senses (username, sense_id, status, source, added_at, updated_at)
      VALUES ($1, $2, 'queue', $3, NOW(), NOW())
      ON CONFLICT (username, sense_id) DO UPDATE SET updated_at = NOW()
    `,
    [u, sid, String(source || "manual")]
  );
  return { senseId: sid };
}

export async function removeSavedBySenseId(username, senseId, db = pool) {
  const u = String(username || "").trim();
  const sid = Number(senseId);
  if (!u || !Number.isFinite(sid) || sid <= 0) return { ok: false };
  await db.query(`DELETE FROM user_saved_senses WHERE username = $1 AND sense_id = $2`, [u, sid]);
  return { ok: true };
}

export async function addManySavedSenses(username, senseIds, source = "collection", db = pool) {
  const u = String(username || "").trim();
  if (!u) return { ok: false };
  const ids = Array.from(new Set((senseIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return { ok: true, inserted: 0 };
  const res = await db.query(
    `
      INSERT INTO user_saved_senses (username, sense_id, status, source, added_at, updated_at)
      SELECT $1, s.id, 'queue', $2, NOW(), NOW()
      FROM UNNEST($3::int[]) AS t(sense_id)
      JOIN dictionary_senses s ON s.id = t.sense_id
      ON CONFLICT (username, sense_id) DO NOTHING
    `,
    [u, String(source || "collection"), ids]
  );
  return { ok: true, inserted: res.rowCount || 0 };
}

export async function setSavedStatus(username, senseId, status, db = pool) {
  const u = String(username || "").trim();
  const sid = Number(senseId);
  if (!u || !Number.isFinite(sid) || sid <= 0) return null;
  const st = normalizeStatus(status);
  const res = await db.query(
    `
      UPDATE user_saved_senses
      SET status = $3, updated_at = NOW()
      WHERE username = $1 AND sense_id = $2
      RETURNING status
    `,
    [u, sid, st]
  );
  return res.rows[0] || null;
}

export async function listCollections(langCode, username = null, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return [];
  const u = username ? String(username).trim() : null;
  if (!u) {
    const res = await db.query(
      `
        SELECT c.id, c.collection_key AS "key", c.title, c.description,
               c.level_from AS "levelFrom", c.level_to AS "levelTo",
               c.sort_order AS "sortOrder",
               (SELECT COUNT(*)::int FROM dictionary_collection_items i
                JOIN dictionary_senses s ON s.id = i.sense_id
                JOIN dictionary_lemmas l ON l.id = s.lemma_id
                WHERE i.collection_id = c.id AND l.language_id = c.language_id) AS total
        FROM dictionary_collections c
        WHERE c.language_id = $1 AND c.is_public = TRUE
        ORDER BY c.sort_order ASC, c.id ASC
      `,
      [languageId]
    );
    return res.rows.map((r) => ({ ...r, saved: null }));
  }
  const res = await db.query(
    `
      SELECT c.id, c.collection_key AS "key", c.title, c.description,
             c.level_from AS "levelFrom", c.level_to AS "levelTo",
             c.sort_order AS "sortOrder",
             (SELECT COUNT(*)::int FROM dictionary_collection_items i
              JOIN dictionary_senses s ON s.id = i.sense_id
              JOIN dictionary_lemmas l ON l.id = s.lemma_id
              WHERE i.collection_id = c.id AND l.language_id = c.language_id) AS total,
             (SELECT COUNT(*)::int FROM dictionary_collection_items i
              JOIN dictionary_senses s ON s.id = i.sense_id
              JOIN dictionary_lemmas l ON l.id = s.lemma_id
              LEFT JOIN user_saved_senses us ON us.username = $2 AND us.sense_id = i.sense_id
              WHERE i.collection_id = c.id AND l.language_id = c.language_id AND us.sense_id IS NOT NULL) AS saved
      FROM dictionary_collections c
      WHERE c.language_id = $1 AND c.is_public = TRUE
      ORDER BY c.sort_order ASC, c.id ASC
    `,
    [languageId, u]
  );
  return res.rows;
}

export async function getCollection(username, langCode, collectionId, db = pool) {
  const u = String(username || "").trim();
  const languageId = await getLanguageId(langCode, db);
  const cid = Number(collectionId);
  if (!u || !languageId || !Number.isFinite(cid) || cid <= 0) return null;

  const colRes = await db.query(
    `
      SELECT id, collection_key AS "key", title, description,
             level_from AS "levelFrom", level_to AS "levelTo",
             sort_order AS "sortOrder"
      FROM dictionary_collections
      WHERE id = $1 AND language_id = $2 AND is_public = TRUE
    `,
    [cid, languageId]
  );
  const collection = colRes.rows[0] || null;
  if (!collection) return null;

  const itemsRes = await db.query(
    `
      SELECT
        i.sense_id AS "senseId",
        l.lemma AS "en",
        s.gloss_ru AS "ru",
        s.level AS "level",
        s.register AS "register",
        l.accent AS "accent",
        l.ipa_uk AS "ipaUk",
        l.ipa_us AS "ipaUs",
        COALESCE(ex.en, '') AS "example",
        COALESCE(ex.ru, '') AS "exampleRu",
        us.status AS "status",
        (us.sense_id IS NOT NULL) AS "isSaved"
      FROM dictionary_collection_items i
      JOIN dictionary_senses s ON s.id = i.sense_id
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      LEFT JOIN dictionary_examples ex ON ex.sense_id = s.id AND ex.is_main = TRUE
      LEFT JOIN user_saved_senses us ON us.username = $1 AND us.sense_id = i.sense_id
      WHERE i.collection_id = $2 AND l.language_id = $3
      ORDER BY i.sort_order ASC, i.id ASC
      LIMIT 500
    `,
    [u, cid, languageId]
  );

  return { collection, items: itemsRes.rows };
}

export async function getUserSenseState(username, senseId, db = pool) {
  const u = String(username || "").trim();
  const sid = Number(senseId);
  if (!u || !Number.isFinite(sid) || sid <= 0) return null;
  const res = await db.query(
    `
      SELECT status, is_favorite AS "isFavorite", added_at AS "addedAt", updated_at AS "updatedAt"
      FROM user_saved_senses
      WHERE username = $1 AND sense_id = $2
      LIMIT 1
    `,
    [u, sid]
  );
  if (!res.rows[0]) return { isSaved: false, status: null };
  return { isSaved: true, ...res.rows[0] };
}

function stableStringHash(text) {
  const s = String(text || "");
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function buildHardHint(row) {
  const hasPron = !!row?.hardPronunciation;
  const hasGrammar = !!row?.hardGrammar;
  if (hasPron && hasGrammar) return "РЎР»РѕР¶РЅРѕРµ РїСЂРѕРёР·РЅРѕС€РµРЅРёРµ Рё РіСЂР°РјРјР°С‚РёРєР°";
  if (hasPron) return "РЎР»РѕР¶РЅРѕРµ РїСЂРѕРёР·РЅРѕС€РµРЅРёРµ";
  if (hasGrammar) return "РЎР»РѕР¶РЅР°СЏ РіСЂР°РјРјР°С‚РёРєР°";
  return "РЎР»РѕР¶РЅРѕРµ СЃР»РѕРІРѕ";
}

async function getServerDayKey(db = pool) {
  const r = await db.query(`SELECT CURRENT_DATE::text AS "dayKey"`);
  return String(r.rows[0]?.dayKey || "");
}

async function getHardWordOfDay(username, langCode, db = pool) {
  const u = String(username || "").trim();
  const languageId = await getLanguageId(langCode, db);
  if (!u || !languageId) return null;
  const dayKey = await getServerDayKey(db);
  if (!dayKey) return null;

  // 1) Р•СЃР»Рё СѓР¶Рµ РІС‹Р±РёСЂР°Р»Рё СЃР»РѕРІРѕ РЅР° СЃРµРіРѕРґРЅСЏ вЂ” РІРѕР·РІСЂР°С‰Р°РµРј РµРіРѕ.
  const saved = await db.query(
    `
      SELECT
        h.sense_id AS "senseId",
        s.lemma_id AS "lemmaId",
        l.lemma AS "en",
        s.gloss_ru AS "ru",
        s.level AS "level",
        s.register AS "register",
        l.frequency_rank AS "frequencyRank",
        l.ipa_uk AS "ipaUk",
        l.ipa_us AS "ipaUs",
        COALESCE(ex.en, '') AS "example",
        COALESCE(ex.ru, '') AS "exampleRu",
        h.meta AS "meta"
      FROM user_daily_highlights h
      JOIN dictionary_senses s ON s.id = h.sense_id
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      LEFT JOIN dictionary_examples ex ON ex.sense_id = s.id AND ex.is_main = TRUE
      WHERE h.username = $1
        AND h.lang_code = $2
        AND h.day_key = $3::date
        AND h.kind = 'hard_word'
      LIMIT 1
    `,
    [u, String(langCode || "en"), dayKey]
  );
  if (saved.rows[0]) {
    const row = saved.rows[0];
    const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
    return {
      senseId: Number(row.senseId),
      lemmaId: Number(row.lemmaId),
      en: row.en,
      ru: row.ru,
      level: row.level,
      register: row.register,
      frequencyRank: Number(row.frequencyRank) || null,
      ipaUk: row.ipaUk || "",
      ipaUs: row.ipaUs || "",
      example: row.example || "",
      exampleRu: row.exampleRu || "",
      difficultyHint: String(meta.difficultyHint || "РЎР»РѕР¶РЅРѕРµ СЃР»РѕРІРѕ"),
      difficultyType: String(meta.difficultyType || "mixed"),
    };
  }

  // 2) РџРѕРґР±РёСЂР°РµРј РєР°РЅРґРёРґР°С‚РѕРІ: top-2000 + СЃР»РѕР¶РЅС‹Рµ РїРѕ РїСЂРѕРёР·РЅРѕС€РµРЅРёСЋ/РіСЂР°РјРјР°С‚РёРєРµ, РёСЃРєР»СЋС‡Р°СЏ "known".
  const candidates = await db.query(
    `
      SELECT
        s.id AS "senseId",
        s.lemma_id AS "lemmaId",
        l.lemma AS "en",
        s.gloss_ru AS "ru",
        s.level AS "level",
        s.register AS "register",
        l.frequency_rank AS "frequencyRank",
        l.ipa_uk AS "ipaUk",
        l.ipa_us AS "ipaUs",
        COALESCE(ex.en, '') AS "example",
        COALESCE(ex.ru, '') AS "exampleRu",
        (
          COALESCE(l.ipa_uk, '') ~ '(Оё|Г°|К’|tКѓ|dК’|Е‹|Й™Лђ|ЙњЛђ)'
          OR COALESCE(l.ipa_us, '') ~ '(Оё|Г°|К’|tКѓ|dК’|Е‹|Йќ|Йљ)'
        ) AS "hardPronunciation",
        (
          s.level IN ('A2', 'B1', 'B2', 'C1', 'C2')
          OR s.register = 'РѕС„РёС†РёР°Р»СЊРЅР°СЏ'
          OR EXISTS (
            SELECT 1
            FROM dictionary_forms f
            WHERE f.lemma_id = s.lemma_id
              AND f.is_irregular = TRUE
          )
        ) AS "hardGrammar",
        (
          CASE s.level
            WHEN 'A2' THEN 1
            WHEN 'B1' THEN 2
            WHEN 'B2' THEN 3
            WHEN 'C1' THEN 4
            WHEN 'C2' THEN 5
            ELSE 0
          END
          + CASE WHEN s.register = 'РѕС„РёС†РёР°Р»СЊРЅР°СЏ' THEN 1 ELSE 0 END
          + CASE
              WHEN (
                COALESCE(l.ipa_uk, '') ~ '(Оё|Г°|К’|tКѓ|dК’|Е‹|Й™Лђ|ЙњЛђ)'
                OR COALESCE(l.ipa_us, '') ~ '(Оё|Г°|К’|tКѓ|dК’|Е‹|Йќ|Йљ)'
              ) THEN 3 ELSE 0
            END
          + CASE WHEN EXISTS (
              SELECT 1 FROM dictionary_forms f WHERE f.lemma_id = s.lemma_id AND f.is_irregular = TRUE
            ) THEN 2 ELSE 0 END
        ) AS "difficultyScore"
      FROM dictionary_senses s
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      LEFT JOIN dictionary_examples ex ON ex.sense_id = s.id AND ex.is_main = TRUE
      WHERE l.language_id = $1
        AND s.sense_no = 1
        AND l.frequency_rank <= 2000
        AND (
          (
            COALESCE(l.ipa_uk, '') ~ '(Оё|Г°|К’|tКѓ|dК’|Е‹|Й™Лђ|ЙњЛђ)'
            OR COALESCE(l.ipa_us, '') ~ '(Оё|Г°|К’|tКѓ|dК’|Е‹|Йќ|Йљ)'
          )
          OR s.level IN ('A2', 'B1', 'B2', 'C1', 'C2')
          OR s.register = 'РѕС„РёС†РёР°Р»СЊРЅР°СЏ'
          OR EXISTS (
            SELECT 1
            FROM dictionary_forms f
            WHERE f.lemma_id = s.lemma_id
              AND f.is_irregular = TRUE
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM user_saved_senses us
          WHERE us.username = $2
            AND us.sense_id = s.id
            AND us.status = 'known'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM user_daily_highlights h
          WHERE h.username = $2
            AND h.lang_code = $3
            AND h.kind = 'hard_word'
            AND h.sense_id = s.id
            AND h.day_key >= (CURRENT_DATE - INTERVAL '14 days')
        )
      ORDER BY "difficultyScore" DESC, l.frequency_rank ASC, s.id ASC
      LIMIT 400
    `,
    [languageId, u, String(langCode || "en")]
  );
  if (!candidates.rows.length) return null;

  // 3) Р”РµС‚РµСЂРјРёРЅРёСЂРѕРІР°РЅРЅС‹Р№ РІС‹Р±РѕСЂ РїРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ Рё РґРЅСЋ.
  const seed = stableStringHash(`${u}|${String(langCode || "en")}|${dayKey}|hard_word`);
  const idx = seed % candidates.rows.length;
  const picked = candidates.rows[idx];

  const difficultyType = picked.hardPronunciation && picked.hardGrammar
    ? "pronunciation_and_grammar"
    : picked.hardPronunciation
      ? "pronunciation"
      : "grammar";
  const difficultyHint = buildHardHint(picked);

  // 4) Р¤РёРєСЃРёСЂСѓРµРј РІС‹Р±РѕСЂ РЅР° РґРµРЅСЊ.
  await db.query(
    `
      INSERT INTO user_daily_highlights (username, lang_code, day_key, kind, sense_id, meta)
      VALUES ($1, $2, $3::date, 'hard_word', $4, $5::jsonb)
      ON CONFLICT (username, lang_code, day_key, kind)
      DO UPDATE SET
        sense_id = EXCLUDED.sense_id,
        meta = EXCLUDED.meta
    `,
    [
      u,
      String(langCode || "en"),
      dayKey,
      Number(picked.senseId),
      JSON.stringify({ difficultyType, difficultyHint }),
    ]
  );

  return {
    senseId: Number(picked.senseId),
    lemmaId: Number(picked.lemmaId),
    en: picked.en,
    ru: picked.ru,
    level: picked.level,
    register: picked.register,
    frequencyRank: Number(picked.frequencyRank) || null,
    ipaUk: picked.ipaUk || "",
    ipaUs: picked.ipaUs || "",
    example: picked.example || "",
    exampleRu: picked.exampleRu || "",
    difficultyHint,
    difficultyType,
  };
}

export async function getTodayPack(username, langCode, db = pool) {
  const u = String(username || "").trim();
  const languageId = await getLanguageId(langCode, db);
  if (!u || !languageId) return { due: [], new: [], hardOfDay: null };

  // 1) due: СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ СЃР»РѕРІР° СЃ РЅРёР·РєРёРј РїСЂРѕРіСЂРµСЃСЃРѕРј (РїСЂРѕСЃС‚Р°СЏ СЌРІСЂРёСЃС‚РёРєР°)
  const dueRes = await db.query(
    `
      SELECT
        s.id AS "senseId",
        m.lemma AS "en",
        s.gloss_ru AS "ru",
        s.level AS "level",
        s.register AS "register",
        m.accent AS "accent",
        m.ipa_uk AS "ipaUk",
        m.ipa_us AS "ipaUs",
        COALESCE(ex.en, '') AS "example",
        COALESCE(ex.ru, '') AS "exampleRu",
        us.status AS "status",
        COALESCE(p.beginner, 0) AS "beginner",
        COALESCE(p.experienced, 0) AS "experienced"
      FROM user_saved_senses us
      JOIN dictionary_senses s ON s.id = us.sense_id
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      LEFT JOIN dictionary_examples ex ON ex.sense_id = s.id AND ex.is_main = TRUE
      LEFT JOIN user_sense_progress p ON p.username = us.username AND p.sense_id = us.sense_id
      WHERE us.username = $1 AND m.language_id = $2
        AND us.status <> 'known'
      ORDER BY (COALESCE(p.beginner, 0) + COALESCE(p.experienced, 0)) ASC, us.updated_at DESC
      LIMIT 7
    `,
    [u, languageId]
  );

  // 2) new: С‡Р°СЃС‚РѕС‚РЅС‹Рµ A0/A1 РёР· РѕР±С‰РµРіРѕ СЃР»РѕРІР°СЂСЏ, РєРѕС‚РѕСЂС‹С… РµС‰С‘ РЅРµС‚ РІ СЃРѕС…СЂР°РЅС‘РЅРЅС‹С…
  const newRes = await db.query(
    `
      WITH saved AS (
        SELECT us.sense_id
        FROM user_saved_senses us
        JOIN dictionary_senses s ON s.id = us.sense_id
        JOIN dictionary_lemmas m ON m.id = s.lemma_id
        WHERE us.username = $1 AND m.language_id = $2
      )
      SELECT
        e.id AS "entryId",
        e.en AS "en",
        e.ru AS "ru",
        e.level AS "level",
        e.register AS "register",
        e.accent AS "accent",
        e.ipa_uk AS "ipaUk",
        e.ipa_us AS "ipaUs",
        e.example AS "example",
        e.example_ru AS "exampleRu",
        l.sense_id AS "senseId"
      FROM dictionary_entries e
      JOIN dictionary_entry_links l ON l.entry_id = e.id
      WHERE e.language_id = $2
        AND e.level IN ('A0', 'A1')
        AND NOT EXISTS (SELECT 1 FROM saved WHERE saved.sense_id = l.sense_id)
      ORDER BY e.frequency_rank ASC, e.id ASC
      LIMIT 7
    `,
    [u, languageId]
  );

  const hardOfDay = await getHardWordOfDay(u, langCode, db);

  return { due: dueRes.rows, new: newRes.rows, hardOfDay };
}

export async function lookupDictionaryTerm(langCode, term, limit = 5, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return [];
  const t = String(term || "").trim().toLowerCase();
  if (!t) return [];
  const lim = clampInt(limit, 1, 20, 5);

  // Exact lemma_key match first, then startswith, then contains (simple + fast enough for MVP)
  const res = await db.query(
    `
      SELECT
        s.id AS "senseId",
        l.id AS "lemmaId",
        l.lemma AS "lemma",
        s.gloss_ru AS "glossRu",
        s.level AS "level",
        s.register AS "register",
        l.frequency_rank AS "frequencyRank",
        CASE
          WHEN l.lemma_key = $2 THEN 0
          WHEN l.lemma_key LIKE ($2 || '%') THEN 1
          ELSE 2
        END AS "matchRank"
      FROM dictionary_lemmas l
      JOIN dictionary_senses s ON s.lemma_id = l.id AND s.sense_no = 1
      WHERE l.language_id = $1
        AND (l.lemma_key = $2 OR l.lemma_key LIKE ($2 || '%') OR l.lemma_key LIKE ('%' || $2 || '%'))
      ORDER BY "matchRank" ASC, l.frequency_rank ASC, s.id ASC
      LIMIT $3
    `,
    [languageId, t, lim]
  );
  return res.rows || [];
}

async function getCollectionIdByKey(langCode, key, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return null;
  const k = String(key || "").trim();
  if (!k) return null;
  const res = await db.query(
    `SELECT id FROM dictionary_collections WHERE language_id = $1 AND collection_key = $2 LIMIT 1`,
    [languageId, k]
  );
  return res.rows[0]?.id ? Number(res.rows[0].id) : null;
}

export async function ensureDefaultCollectionEnrolled(username, langCode, collectionKey = "a0_basics", db = pool) {
  const u = String(username || "").trim();
  if (!u) return { ok: false };
  const collectionId = await getCollectionIdByKey(langCode, collectionKey, db);
  if (!collectionId) return { ok: false, reason: "no-collection" };

  // already started?
  const started = await db.query(
    `SELECT started_at FROM user_collection_state WHERE username = $1 AND collection_id = $2 LIMIT 1`,
    [u, collectionId]
  );
  if (started.rows.length > 0 && started.rows[0]?.started_at) {
    return { ok: true, enrolled: false, collectionId };
  }

  // mark started
  await db.query(
    `
      INSERT INTO user_collection_state (username, collection_id, started_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (username, collection_id) DO UPDATE SET
        started_at = COALESCE(user_collection_state.started_at, EXCLUDED.started_at),
        updated_at = NOW()
    `,
    [u, collectionId]
  );

  // add all senses from collection as queue
  const sensesRes = await db.query(
    `SELECT sense_id AS "senseId" FROM dictionary_collection_items WHERE collection_id = $1 ORDER BY sort_order ASC, id ASC`,
    [collectionId]
  );
  const senseIds = (sensesRes.rows || []).map((r) => Number(r.senseId)).filter((n) => Number.isFinite(n) && n > 0);
  if (senseIds.length > 0) {
    await addManySavedSenses(u, senseIds, "collection", db);
  }
  return { ok: true, enrolled: true, collectionId, added: senseIds.length };
}

export async function getCollectionProgress(username, langCode, collectionKey = "a0_basics", db = pool) {
  const u = String(username || "").trim();
  const languageId = await getLanguageId(langCode, db);
  if (!u || !languageId) return null;
  const collectionId = await getCollectionIdByKey(langCode, collectionKey, db);
  if (!collectionId) return null;

  const colRes = await db.query(
    `
      SELECT id, title, description, collection_key AS "key", sort_order AS "sortOrder"
      FROM dictionary_collections
      WHERE id = $1 AND language_id = $2 AND is_public = TRUE
    `,
    [collectionId, languageId]
  );
  const collection = colRes.rows[0] || null;
  if (!collection) return null;

  const totals = await db.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(us.sense_id)::int AS saved,
        COUNT(CASE WHEN us.status = 'known' THEN 1 END)::int AS known
      FROM dictionary_collection_items i
      JOIN dictionary_senses s ON s.id = i.sense_id
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      LEFT JOIN user_saved_senses us ON us.username = $1 AND us.sense_id = i.sense_id
      WHERE i.collection_id = $2 AND l.language_id = $3
    `,
    [u, collectionId, languageId]
  );
  const st = totals.rows[0] || { total: 0, saved: 0, known: 0 };

  const stateRes = await db.query(
    `SELECT started_at AS "startedAt", completed_at AS "completedAt" FROM user_collection_state WHERE username = $1 AND collection_id = $2 LIMIT 1`,
    [u, collectionId]
  );
  const state = stateRes.rows[0] || { startedAt: null, completedAt: null };

  return {
    collection: { ...collection, id: collectionId },
    progress: {
      total: Number(st.total) || 0,
      saved: Number(st.saved) || 0,
      known: Number(st.known) || 0,
      startedAt: state.startedAt || null,
      completedAt: state.completedAt || null,
    },
  };
}


