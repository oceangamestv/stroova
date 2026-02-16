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

  // если уже есть сохранённые смыслы — считаем, что миграция уже была
  const existing = await db.query(`SELECT 1 FROM user_saved_senses WHERE username = $1 LIMIT 1`, [u]);
  if (existing.rows.length > 0) return { ok: true, migrated: false };

  // колонка personal_dictionary могла быть удалена runPersonalDictionaryMigration — тогда не читаем legacy
  const colCheck = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'personal_dictionary'`
  );
  if (colCheck.rows.length === 0) return { ok: true, migrated: false };

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

  const wordProgress = patch?.wordProgress;

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

  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return { items: [], total: 0 };

  const q = String(params.q || "").trim().toLowerCase();
  const rawStatus = String(params.status || "all").trim().toLowerCase();
  const status = rawStatus === "all" ? "all" : normalizeStatus(rawStatus);
  const offset = clampInt(params.offset, 0, 1_000_000, 0);
  const limit = clampInt(params.limit, 1, 200, 50);

  const values = [u, languageId];
  let paramIdx = 3;
  const senseWhere = ["us.username = $1", "m.language_id = $2"];
  const formCardWhere = ["p.username = $1", "e.language_id = $2"];
  if (status !== "all") {
    senseWhere.push(`us.status = $${paramIdx}`);
    formCardWhere.push(`p.status = $${paramIdx}`);
    values.push(status);
    paramIdx++;
  }
  if (q) {
    senseWhere.push(`(LOWER(m.lemma) LIKE $${paramIdx} OR LOWER(s.gloss_ru) LIKE $${paramIdx} OR LOWER(COALESCE(e.en, '')) LIKE $${paramIdx})`);
    formCardWhere.push(`(LOWER(fc.en) LIKE $${paramIdx} OR LOWER(COALESCE(fc.ru, '')) LIKE $${paramIdx} OR LOWER(COALESCE(fc.example, '')) LIKE $${paramIdx})`);
    values.push(`%${q}%`);
    paramIdx++;
  }
  const senseWhereSql = senseWhere.join(" AND ");
  const formCardWhereSql = formCardWhere.join(" AND ");
  const limitParam = paramIdx;
  const offsetParam = paramIdx + 1;

  const combinedCte = `
    WITH combined AS (
      SELECT
        'sense'::text AS "itemType",
        s.id::int AS "itemId",
        s.id::int AS "senseId",
        m.lemma::text AS "en",
        s.gloss_ru::text AS "ru",
        COALESCE(s.level, '')::text AS "level",
        COALESCE(s.register, '')::text AS "register",
        COALESCE(e.en, '')::text AS "example",
        COALESCE(e.ru, '')::text AS "exampleRu",
        us.status::text AS "status",
        us.updated_at AS "updatedAt"
      FROM user_saved_senses us
      JOIN dictionary_senses s ON s.id = us.sense_id
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      LEFT JOIN dictionary_examples e ON e.sense_id = s.id AND e.is_main = TRUE
      WHERE ${senseWhereSql}

      UNION ALL

      SELECT
        'form_card'::text AS "itemType",
        fc.id::int AS "itemId",
        NULL::int AS "senseId",
        fc.en::text AS "en",
        COALESCE(fc.ru, '')::text AS "ru",
        COALESCE(fc.level, '')::text AS "level",
        COALESCE(fc.register, '')::text AS "register",
        COALESCE(fc.example, '')::text AS "example",
        COALESCE(fc.example_ru, '')::text AS "exampleRu",
        p.status::text AS "status",
        p.updated_at AS "updatedAt"
      FROM user_phrase_progress p
      JOIN dictionary_form_cards fc ON p.item_type = 'form_card' AND p.item_id = fc.id
      JOIN dictionary_entries e ON e.id = fc.entry_id AND e.language_id = $2
      WHERE ${formCardWhereSql}
    )
  `;

  const totalRes = await db.query(
    `${combinedCte} SELECT COUNT(*)::int AS total FROM combined`,
    values
  );

  const res = await db.query(
    `${combinedCte}
    SELECT * FROM combined
    ORDER BY "updatedAt" DESC
    OFFSET $${limitParam} LIMIT $${offsetParam}`,
    [...values, offset, limit]
  );

  const rows = (res.rows || []).map((r) => ({
    itemType: String(r.itemType || "sense"),
    itemId: Number(r.itemId) || 0,
    senseId: r.senseId != null ? Number(r.senseId) : null,
    en: String(r.en ?? ""),
    ru: String(r.ru ?? ""),
    level: String(r.level ?? ""),
    register: String(r.register ?? ""),
    example: String(r.example ?? ""),
    exampleRu: String(r.exampleRu ?? ""),
    status: String(r.status ?? ""),
    updatedAt: r.updatedAt,
  }));

  return { items: rows, total: totalRes.rows[0]?.total || 0 };
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
  let forms = formsRes.rows || [];

  if (entryId != null && forms.length > 0) {
    const formIds = forms.map((f) => Number(f.id)).filter((n) => Number.isFinite(n) && n > 0);
    const formTextsLower = forms.map((f) => String((f.form || "").trim()).toLowerCase()).filter((s) => s.length > 0);

    const formCardByFormId = new Map();
    if (formIds.length > 0) {
      const fcByIdRes = await db.query(
        `
          SELECT source_form_id AS "sourceFormId", id AS "cardId",
                 level, ipa_uk AS "ipaUk", ipa_us AS "ipaUs",
                 example, example_ru AS "exampleRu", register
          FROM dictionary_form_cards
          WHERE entry_id = $1 AND source_form_id = ANY($2::int[])
        `,
        [entryId, formIds]
      );
      for (const row of fcByIdRes.rows) {
        const fid = Number(row.sourceFormId);
        if (!Number.isFinite(fid)) continue;
        formCardByFormId.set(fid, {
          cardId: Number(row.cardId),
          level: String(row.level || ""),
          ipaUk: String(row.ipaUk || ""),
          ipaUs: String(row.ipaUs || ""),
          example: String(row.example || ""),
          exampleRu: String(row.exampleRu || ""),
          register: String(row.register || ""),
        });
      }
    }

    const formCardByEn = new Map();
    if (formTextsLower.length > 0) {
      const fcByEnRes = await db.query(
        `
          SELECT LOWER(TRIM(en)) AS "enKey", id AS "cardId",
                 level, ipa_uk AS "ipaUk", ipa_us AS "ipaUs",
                 example, example_ru AS "exampleRu", register
          FROM dictionary_form_cards
          WHERE entry_id = $1 AND LOWER(TRIM(en)) = ANY($2::text[])
        `,
        [entryId, formTextsLower]
      );
      for (const row of fcByEnRes.rows) {
        const key = String(row.enKey || "").toLowerCase();
        if (!key) continue;
        formCardByEn.set(key, {
          cardId: Number(row.cardId),
          level: String(row.level || ""),
          ipaUk: String(row.ipaUk || ""),
          ipaUs: String(row.ipaUs || ""),
          example: String(row.example || ""),
          exampleRu: String(row.exampleRu || ""),
          register: String(row.register || ""),
        });
      }
    }

    forms = forms.map((f) => {
      const card = formCardByFormId.get(Number(f.id)) || formCardByEn.get(String((f.form || "").trim()).toLowerCase());
      if (!card) return f;
      return { ...f, ...card };
    });
  }

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

export async function getFormCardBySenseAndForm(langCode, senseId, form, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return null;
  const sid = Number(senseId);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  const term = String(form || "").trim().toLowerCase();
  if (!term) return null;

  const termAscii = term.replace(/[’`]/g, "'");
  const termCurly = term.replace(/'/g, "’");
  const termVariants = Array.from(new Set([term, termAscii, termCurly].filter(Boolean)));

  const senseInfoRes = await db.query(
    `
      SELECT s.id AS "senseId", s.lemma_id AS "lemmaId", l.language_id AS "languageId"
      FROM dictionary_senses s
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [sid]
  );
  const senseInfo = senseInfoRes.rows[0] || null;
  if (!senseInfo || Number(senseInfo.languageId) !== Number(languageId)) return null;

  const entryLinkRes = await db.query(
    `
      SELECT entry_id AS "entryId"
      FROM dictionary_entry_links
      WHERE sense_id = $1
      LIMIT 1
    `,
    [sid]
  );
  const entryId = Number(entryLinkRes.rows[0]?.entryId || 0) || null;

  const mapCardRow = (row) => ({
    id: Number(row.id),
    entryId: Number(row.entryId),
    sourceSenseId: row.sourceSenseId != null ? Number(row.sourceSenseId) : null,
    lemmaId: row.lemmaId != null ? Number(row.lemmaId) : null,
    sourceFormId: row.sourceFormId != null ? Number(row.sourceFormId) : null,
    en: String(row.en || ""),
    ru: String(row.ru || ""),
    level: String(row.level || ""),
    accent: String(row.accent || ""),
    frequencyRank: Number(row.frequencyRank || 0) || 0,
    rarity: String(row.rarity || ""),
    register: String(row.register || ""),
    ipaUk: String(row.ipaUk || ""),
    ipaUs: String(row.ipaUs || ""),
    example: String(row.example || ""),
    exampleRu: String(row.exampleRu || ""),
    pos: String(row.pos || ""),
    sortOrder: Number(row.sortOrder || 0) || 0,
    sourceForm: row.sourceFormId
      ? {
          id: Number(row.sourceFormId),
          form: String(row.sourceForm || ""),
          formType: String(row.sourceFormType || ""),
          isIrregular: Boolean(row.sourceFormIsIrregular),
          notes: String(row.sourceFormNotes || ""),
        }
      : null,
  });

  if (entryId) {
    const exactEntryRes = await db.query(
      `
        SELECT
          fc.id,
          fc.entry_id AS "entryId",
          lnk.sense_id AS "sourceSenseId",
          fc.lemma_id AS "lemmaId",
          fc.source_form_id AS "sourceFormId",
          fc.en,
          fc.ru,
          fc.level,
          fc.accent,
          fc.frequency_rank AS "frequencyRank",
          fc.rarity,
          fc.register,
          fc.ipa_uk AS "ipaUk",
          fc.ipa_us AS "ipaUs",
          fc.example,
          fc.example_ru AS "exampleRu",
          fc.pos,
          fc.sort_order AS "sortOrder",
          f.form AS "sourceForm",
          f.form_type AS "sourceFormType",
          f.is_irregular AS "sourceFormIsIrregular",
          f.notes AS "sourceFormNotes"
        FROM dictionary_form_cards fc
        LEFT JOIN dictionary_entry_links lnk ON lnk.entry_id = fc.entry_id
        LEFT JOIN dictionary_forms f ON f.id = fc.source_form_id
        WHERE fc.entry_id = $1
          AND LOWER(fc.en) = ANY($2::text[])
        ORDER BY fc.sort_order ASC, fc.id ASC
        LIMIT 1
      `,
      [entryId, termVariants]
    );
    if (exactEntryRes.rows[0]) return mapCardRow(exactEntryRes.rows[0]);
  }

  const lemmaRes = await db.query(
    `
      SELECT
        fc.id,
        fc.entry_id AS "entryId",
        lnk.sense_id AS "sourceSenseId",
        fc.lemma_id AS "lemmaId",
        fc.source_form_id AS "sourceFormId",
        fc.en,
        fc.ru,
        fc.level,
        fc.accent,
        fc.frequency_rank AS "frequencyRank",
        fc.rarity,
        fc.register,
        fc.ipa_uk AS "ipaUk",
        fc.ipa_us AS "ipaUs",
        fc.example,
        fc.example_ru AS "exampleRu",
        fc.pos,
        fc.sort_order AS "sortOrder",
        f.form AS "sourceForm",
        f.form_type AS "sourceFormType",
        f.is_irregular AS "sourceFormIsIrregular",
        f.notes AS "sourceFormNotes"
      FROM dictionary_form_cards fc
      LEFT JOIN dictionary_entry_links lnk ON lnk.entry_id = fc.entry_id
      LEFT JOIN dictionary_forms f ON f.id = fc.source_form_id
      WHERE fc.lemma_id = $1
        AND LOWER(fc.en) = ANY($2::text[])
      ORDER BY fc.sort_order ASC, fc.id ASC
      LIMIT 1
    `,
    [Number(senseInfo.lemmaId), termVariants]
  );
  if (!lemmaRes.rows[0]) return null;
  return mapCardRow(lemmaRes.rows[0]);
}

export async function getFormCardById(langCode, cardId, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return null;
  const id = Number(cardId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const res = await db.query(
    `
      SELECT
        fc.id,
        fc.entry_id AS "entryId",
        lnk.sense_id AS "sourceSenseId",
        fc.lemma_id AS "lemmaId",
        fc.source_form_id AS "sourceFormId",
        fc.en,
        fc.ru,
        fc.level,
        fc.accent,
        fc.frequency_rank AS "frequencyRank",
        fc.rarity,
        fc.register,
        fc.ipa_uk AS "ipaUk",
        fc.ipa_us AS "ipaUs",
        fc.example,
        fc.example_ru AS "exampleRu",
        fc.pos,
        fc.sort_order AS "sortOrder",
        f.form AS "sourceForm",
        f.form_type AS "sourceFormType",
        f.is_irregular AS "sourceFormIsIrregular",
        f.notes AS "sourceFormNotes"
      FROM dictionary_form_cards fc
      JOIN dictionary_entries e ON e.id = fc.entry_id
      LEFT JOIN dictionary_entry_links lnk ON lnk.entry_id = fc.entry_id
      LEFT JOIN dictionary_forms f ON f.id = fc.source_form_id
      WHERE fc.id = $1
        AND e.language_id = $2
      LIMIT 1
    `,
    [id, languageId]
  );

  const row = res.rows[0] || null;
  if (!row) return null;

  let sourceForm = null;
  if (row.sourceFormId != null) {
    sourceForm = {
      id: Number(row.sourceFormId),
      form: String(row.sourceForm || ""),
      formType: String(row.sourceFormType || ""),
      isIrregular: Boolean(row.sourceFormIsIrregular),
      notes: String(row.sourceFormNotes || ""),
    };
  } else if (row.lemmaId != null && String(row.en || "").trim()) {
    const formText = String(row.en || "").trim();
    const formRow = await db.query(
      `
        SELECT id, form, form_type AS "formType", is_irregular AS "isIrregular", notes
        FROM dictionary_forms
        WHERE lemma_id = $1 AND LOWER(TRIM(form)) = LOWER(TRIM($2))
        LIMIT 1
      `,
      [Number(row.lemmaId), formText]
    );
    if (formRow.rows[0]) {
      const fr = formRow.rows[0];
      sourceForm = {
        id: Number(fr.id),
        form: String(fr.form || ""),
        formType: String(fr.formType || ""),
        isIrregular: Boolean(fr.isIrregular),
        notes: String(fr.notes || ""),
      };
    }
  }

  return {
    id: Number(row.id),
    entryId: Number(row.entryId),
    sourceSenseId: row.sourceSenseId != null ? Number(row.sourceSenseId) : null,
    lemmaId: row.lemmaId != null ? Number(row.lemmaId) : null,
    sourceFormId: sourceForm ? sourceForm.id : null,
    en: String(row.en || ""),
    ru: String(row.ru || ""),
    level: String(row.level || ""),
    accent: String(row.accent || ""),
    frequencyRank: Number(row.frequencyRank || 0) || 0,
    rarity: String(row.rarity || ""),
    register: String(row.register || ""),
    ipaUk: String(row.ipaUk || ""),
    ipaUs: String(row.ipaUs || ""),
    example: String(row.example || ""),
    exampleRu: String(row.exampleRu || ""),
    pos: String(row.pos || ""),
    sortOrder: Number(row.sortOrder || 0) || 0,
    sourceForm,
  };
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

/** Добавить в user_saved_senses слова по entry_id (например стартовый набор A0 при регистрации). */
export async function addSavedByEntryIds(username, langCode, entryIds, source = "registration", db = pool) {
  const ids = Array.from(new Set((entryIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return { ok: true, inserted: 0 };
  const entryMap = await getSenseIdsByEntryIds(langCode, ids, db);
  const senseIds = Array.from(entryMap.values()).map((x) => x.senseId);
  return addManySavedSenses(username, senseIds, source, db);
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

function normalizePhraseItemType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "collocation" || s === "pattern" || s === "form_card") return s;
  return null;
}

export async function addPhraseProgress(username, itemType, itemId, source = "manual", db = pool) {
  const u = String(username || "").trim();
  const t = normalizePhraseItemType(itemType);
  const id = Number(itemId);
  if (!u || !t || !Number.isFinite(id) || id <= 0) return { ok: false };
  await db.query(
    `
      INSERT INTO user_phrase_progress (username, item_type, item_id, status, source, added_at, updated_at)
      VALUES ($1, $2, $3, 'queue', $4, NOW(), NOW())
      ON CONFLICT (username, item_type, item_id) DO UPDATE SET updated_at = NOW()
    `,
    [u, t, id, String(source || "manual")]
  );
  return { ok: true };
}

export async function removePhraseProgress(username, itemType, itemId, db = pool) {
  const u = String(username || "").trim();
  const t = normalizePhraseItemType(itemType);
  const id = Number(itemId);
  if (!u || !t || !Number.isFinite(id) || id <= 0) return { ok: false };
  await db.query(`DELETE FROM user_phrase_progress WHERE username = $1 AND item_type = $2 AND item_id = $3`, [u, t, id]);
  return { ok: true };
}

export async function setPhraseStatus(username, itemType, itemId, status, db = pool) {
  const u = String(username || "").trim();
  const t = normalizePhraseItemType(itemType);
  const id = Number(itemId);
  const st = normalizeStatus(status);
  if (!u || !t || !Number.isFinite(id) || id <= 0) return null;
  const res = await db.query(
    `
      UPDATE user_phrase_progress
      SET status = $4, updated_at = NOW()
      WHERE username = $1 AND item_type = $2 AND item_id = $3
      RETURNING status
    `,
    [u, t, id, st]
  );
  return res.rows[0] || null;
}

export async function getUserPhraseState(username, itemType, itemId, db = pool) {
  const u = String(username || "").trim();
  const t = normalizePhraseItemType(itemType);
  const id = Number(itemId);
  if (!u || !t || !Number.isFinite(id) || id <= 0) return null;
  const res = await db.query(
    `
      SELECT status, added_at AS "addedAt", updated_at AS "updatedAt"
      FROM user_phrase_progress
      WHERE username = $1 AND item_type = $2 AND item_id = $3
      LIMIT 1
    `,
    [u, t, id]
  );
  if (!res.rows[0]) return { isSaved: false, status: null };
  return { isSaved: true, ...res.rows[0] };
}

export async function listMyPhrases(username, langCode, params = {}, db = pool) {
  const u = String(username || "").trim();
  if (!u) return { items: [], total: 0 };
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return { items: [], total: 0 };

  const q = String(params.q || "").trim().toLowerCase();
  const rawStatus = String(params.status || "all").trim().toLowerCase();
  const status = rawStatus === "all" ? "all" : normalizeStatus(rawStatus);
  const offset = clampInt(params.offset, 0, 1_000_000, 0);
  const limit = clampInt(params.limit, 1, 200, 50);

  const cond = [];
  const values = [u, languageId];
  let n = 3;
  if (status !== "all") {
    cond.push(`x.status = $${n++}`);
    values.push(status);
  }
  if (q) {
    cond.push(`(LOWER(x.en) LIKE $${n} OR LOWER(x.ru) LIKE $${n} OR LOWER(x.example) LIKE $${n})`);
    values.push(`%${q}%`);
    n++;
  }
  const whereSql = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const baseSql = `
    WITH x AS (
      SELECT
        p.item_type AS "itemType",
        p.item_id AS "itemId",
        c.phrase_en AS "en",
        c.gloss_ru AS "ru",
        c.level AS "level",
        c.register AS "register",
        COALESCE(c.example_en, '') AS "example",
        COALESCE(c.example_ru, '') AS "exampleRu",
        COALESCE(s.id, 0) AS "senseId",
        p.status AS "status",
        p.updated_at AS "updatedAt"
      FROM user_phrase_progress p
      JOIN dictionary_collocations c ON p.item_type = 'collocation' AND p.item_id = c.id
      JOIN dictionary_lemmas l ON l.id = c.lemma_id
      LEFT JOIN dictionary_senses s ON s.lemma_id = l.id AND s.sense_no = 1
      WHERE p.username = $1 AND l.language_id = $2

      UNION ALL

      SELECT
        p.item_type AS "itemType",
        p.item_id AS "itemId",
        up.en AS "en",
        up.ru AS "ru",
        s.level AS "level",
        s.register AS "register",
        '' AS "example",
        '' AS "exampleRu",
        s.id AS "senseId",
        p.status AS "status",
        p.updated_at AS "updatedAt"
      FROM user_phrase_progress p
      JOIN dictionary_usage_patterns up ON p.item_type = 'pattern' AND p.item_id = up.id
      JOIN dictionary_senses s ON s.id = up.sense_id
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      WHERE p.username = $1 AND l.language_id = $2
    )
  `;

  const totalRes = await db.query(
    `
      ${baseSql}
      SELECT COUNT(*)::int AS total
      FROM x
      ${whereSql}
    `,
    values
  );

  const res = await db.query(
    `
      ${baseSql}
      SELECT *
      FROM x
      ${whereSql}
      ORDER BY "updatedAt" DESC
      OFFSET $${n} LIMIT $${n + 1}
    `,
    [...values, offset, limit]
  );

  return { items: res.rows || [], total: totalRes.rows[0]?.total || 0 };
}

export async function getTodayPhrasePack(username, langCode, db = pool) {
  const u = String(username || "").trim();
  const languageId = await getLanguageId(langCode, db);
  if (!u || !languageId) return { due: [], new: [] };

  const dueRes = await db.query(
    `
      WITH x AS (
        SELECT
          p.item_type AS "itemType",
          p.item_id AS "itemId",
          c.phrase_en AS "en",
          c.gloss_ru AS "ru",
          c.level AS "level",
          c.register AS "register",
          COALESCE(c.example_en, '') AS "example",
          COALESCE(c.example_ru, '') AS "exampleRu",
          COALESCE(s.id, 0) AS "senseId",
          p.status AS "status",
          p.updated_at AS "updatedAt"
        FROM user_phrase_progress p
        JOIN dictionary_collocations c ON p.item_type = 'collocation' AND p.item_id = c.id
        JOIN dictionary_lemmas l ON l.id = c.lemma_id
        LEFT JOIN dictionary_senses s ON s.lemma_id = l.id AND s.sense_no = 1
        WHERE p.username = $1 AND l.language_id = $2 AND p.status <> 'known'

        UNION ALL

        SELECT
          p.item_type AS "itemType",
          p.item_id AS "itemId",
          up.en AS "en",
          up.ru AS "ru",
          s.level AS "level",
          s.register AS "register",
          '' AS "example",
          '' AS "exampleRu",
          s.id AS "senseId",
          p.status AS "status",
          p.updated_at AS "updatedAt"
        FROM user_phrase_progress p
        JOIN dictionary_usage_patterns up ON p.item_type = 'pattern' AND p.item_id = up.id
        JOIN dictionary_senses s ON s.id = up.sense_id
        JOIN dictionary_lemmas l ON l.id = s.lemma_id
        WHERE p.username = $1 AND l.language_id = $2 AND p.status <> 'known'
      )
      SELECT * FROM x
      ORDER BY "updatedAt" DESC
      LIMIT 7
    `,
    [u, languageId]
  );

  const newRes = await db.query(
    `
      WITH candidates AS (
        SELECT
          'collocation'::text AS "itemType",
          c.id AS "itemId",
          c.phrase_en AS "en",
          c.gloss_ru AS "ru",
          c.level AS "level",
          c.register AS "register",
          COALESCE(c.example_en, '') AS "example",
          COALESCE(c.example_ru, '') AS "exampleRu",
          COALESCE(s.id, 0) AS "senseId",
          l.frequency_rank AS "frequencyRank"
        FROM dictionary_collocations c
        JOIN dictionary_lemmas l ON l.id = c.lemma_id
        LEFT JOIN dictionary_senses s ON s.lemma_id = l.id AND s.sense_no = 1
        WHERE l.language_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM user_phrase_progress p
            WHERE p.username = $1 AND p.item_type = 'collocation' AND p.item_id = c.id
          )

        UNION ALL

        SELECT
          'pattern'::text AS "itemType",
          up.id AS "itemId",
          up.en AS "en",
          up.ru AS "ru",
          s.level AS "level",
          s.register AS "register",
          '' AS "example",
          '' AS "exampleRu",
          s.id AS "senseId",
          l.frequency_rank AS "frequencyRank"
        FROM dictionary_usage_patterns up
        JOIN dictionary_senses s ON s.id = up.sense_id
        JOIN dictionary_lemmas l ON l.id = s.lemma_id
        WHERE l.language_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM user_phrase_progress p
            WHERE p.username = $1 AND p.item_type = 'pattern' AND p.item_id = up.id
          )
      )
      SELECT
        "itemType",
        "itemId",
        "en",
        "ru",
        "level",
        "register",
        "example",
        "exampleRu",
        "senseId"
      FROM candidates
      ORDER BY "frequencyRank" ASC, "itemId" ASC
      LIMIT 7
    `,
    [u, languageId]
  );

  return { due: dueRes.rows || [], new: newRes.rows || [] };
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
  const phrases = await getTodayPhrasePack(u, langCode, db);

  return {
    due: dueRes.rows,
    new: newRes.rows,
    phraseDue: phrases.due || [],
    phraseNew: phrases.new || [],
    hardOfDay,
  };
}

/**
 * Унифицированная лента «Все слова»:
 * - слова (entry),
 * - формы (form),
 * - карточки форм (form_card),
 * - фразы (collocation),
 * - паттерны (pattern).
 *
 * @param {string} username
 * @param {string} langCode
 * @param {{ offset?: number, limit?: number, q?: string }} opts
 * @returns {Promise<{ items: Array<{ id: number, itemType: string, itemId: number, entryId: number | null, senseId: number | null, en: string, ru: string, level: string, example: string, exampleRu: string, isSaved: boolean }>, total: number }>}
 */
export async function listAllWords(username, langCode, opts = {}, db = pool) {
  // #region agent log
  const languageId = await getLanguageId(langCode, db);
  if (typeof globalThis.fetch === "function") { globalThis.fetch("http://127.0.0.1:7242/ingest/039ed3c9-0fe6-43d1-a385-bc2c487e240a", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "userDictionaryRepo.js:listAllWords-entry", message: "listAllWords entry", data: { languageId, username: String(username).slice(0, 20), langCode, opts }, timestamp: Date.now(), hypothesisId: "H2" }) }).catch(() => {}); }
  if (!languageId) return { items: [], total: 0 };
  const u = String(username || "").trim();
  const offset = clampInt(opts.offset, 0, 100000, 0);
  const limit = clampInt(opts.limit, 1, 100, 50);
  const q = String(opts.q || "").trim();
  const hasSearch = q.length > 0;

  const baseParams = [languageId, u];
  const searchParams = hasSearch ? [q] : [];
  // #endregion

  const filterSql = hasSearch
    ? `
      WHERE (
        i.en ILIKE ('%' || $3 || '%')
        OR i.ru ILIKE ('%' || $3 || '%')
        OR i.example ILIKE ('%' || $3 || '%')
        OR i."exampleRu" ILIKE ('%' || $3 || '%')
      )
    `
    : "";

  const commonCte = `
    WITH items AS (
      -- 1) Основные карточки слов (legacy entries)
      SELECT
        'entry'::text AS "itemType",
        e.id::int AS "itemId",
        e.id::int AS "entryId",
        l.sense_id::int AS "senseId",
        e.en::text AS en,
        COALESCE(e.ru, '')::text AS ru,
        COALESCE(e.level, '')::text AS level,
        COALESCE(e.example, '')::text AS example,
        COALESCE(e.example_ru, '')::text AS "exampleRu",
        COALESCE(e.frequency_rank, 999999)::int AS "frequencyRank",
        CASE WHEN uss.sense_id IS NULL THEN FALSE ELSE TRUE END AS "isSaved"
      FROM dictionary_entries e
      JOIN dictionary_entry_links l ON l.entry_id = e.id
      LEFT JOIN user_saved_senses uss ON uss.username = $2 AND uss.sense_id = l.sense_id
      WHERE e.language_id = $1

      UNION ALL

      -- 1b) Смыслы без карточки entry (только v2: lemma/sense), чтобы «Все слова» не была пустой
      SELECT
        'entry'::text AS "itemType",
        s.id::int AS "itemId",
        NULL::int AS "entryId",
        s.id::int AS "senseId",
        m.lemma::text AS en,
        COALESCE(s.gloss_ru, '')::text AS ru,
        COALESCE(s.level, '')::text AS level,
        COALESCE(ex.en, '')::text AS example,
        COALESCE(ex.ru, '')::text AS "exampleRu",
        COALESCE(m.frequency_rank, 999999)::int AS "frequencyRank",
        CASE WHEN uss.sense_id IS NULL THEN FALSE ELSE TRUE END AS "isSaved"
      FROM dictionary_senses s
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      LEFT JOIN dictionary_examples ex ON ex.sense_id = s.id AND ex.is_main = TRUE
      LEFT JOIN user_saved_senses uss ON uss.username = $2 AND uss.sense_id = s.id
      WHERE m.language_id = $1
        AND NOT EXISTS (SELECT 1 FROM dictionary_entry_links el WHERE el.sense_id = s.id)

      UNION ALL

      -- 2) Формы слова
      SELECT
        'form'::text AS "itemType",
        f.id::int AS "itemId",
        link.entry_id::int AS "entryId",
        s.id::int AS "senseId",
        f.form::text AS en,
        COALESCE(s.gloss_ru, '')::text AS ru,
        COALESCE(s.level, '')::text AS level,
        COALESCE(ex.en, '')::text AS example,
        COALESCE(ex.ru, '')::text AS "exampleRu",
        COALESCE(m.frequency_rank, 999999)::int AS "frequencyRank",
        CASE WHEN uss.sense_id IS NULL THEN FALSE ELSE TRUE END AS "isSaved"
      FROM dictionary_forms f
      JOIN dictionary_lemmas m ON m.id = f.lemma_id
      JOIN dictionary_senses s ON s.lemma_id = m.id AND s.sense_no = 1
      LEFT JOIN dictionary_examples ex ON ex.sense_id = s.id AND ex.is_main = TRUE
      LEFT JOIN LATERAL (
        SELECT el.entry_id
        FROM dictionary_entry_links el
        WHERE el.lemma_id = m.id
        ORDER BY el.entry_id ASC
        LIMIT 1
      ) link ON TRUE
      LEFT JOIN user_saved_senses uss ON uss.username = $2 AND uss.sense_id = s.id
      WHERE m.language_id = $1

      UNION ALL

      -- 3) Карточки форм: каждая форма — отдельная единица в словаре (user_phrase_progress form_card)
      SELECT
        'form_card'::text AS "itemType",
        fc.id::int AS "itemId",
        fc.entry_id::int AS "entryId",
        link.sense_id::int AS "senseId",
        fc.en::text AS en,
        COALESCE(fc.ru, '')::text AS ru,
        COALESCE(fc.level, '')::text AS level,
        COALESCE(fc.example, '')::text AS example,
        COALESCE(fc.example_ru, '')::text AS "exampleRu",
        COALESCE(fc.frequency_rank, 999999)::int AS "frequencyRank",
        CASE WHEN upp.item_id IS NULL THEN FALSE ELSE TRUE END AS "isSaved"
      FROM dictionary_form_cards fc
      JOIN dictionary_entries e ON e.id = fc.entry_id
      LEFT JOIN dictionary_entry_links link ON link.entry_id = fc.entry_id
      LEFT JOIN user_phrase_progress upp ON upp.username = $2 AND upp.item_type = 'form_card' AND upp.item_id = fc.id
      WHERE e.language_id = $1

      UNION ALL

      -- 4) Фразовые сочетания
      SELECT
        'collocation'::text AS "itemType",
        c.id::int AS "itemId",
        link.entry_id::int AS "entryId",
        COALESCE(s.id, link.sense_id)::int AS "senseId",
        c.phrase_en::text AS en,
        COALESCE(c.gloss_ru, '')::text AS ru,
        COALESCE(c.level, '')::text AS level,
        COALESCE(c.example_en, '')::text AS example,
        COALESCE(c.example_ru, '')::text AS "exampleRu",
        COALESCE(m.frequency_rank, 999999)::int AS "frequencyRank",
        CASE WHEN upp.item_id IS NULL THEN FALSE ELSE TRUE END AS "isSaved"
      FROM dictionary_collocations c
      JOIN dictionary_lemmas m ON m.id = c.lemma_id
      LEFT JOIN dictionary_senses s ON s.lemma_id = m.id AND s.sense_no = 1
      LEFT JOIN LATERAL (
        SELECT el.entry_id, el.sense_id
        FROM dictionary_entry_links el
        WHERE el.lemma_id = m.id
        ORDER BY el.entry_id ASC
        LIMIT 1
      ) link ON TRUE
      LEFT JOIN user_phrase_progress upp ON upp.username = $2 AND upp.item_type = 'collocation' AND upp.item_id = c.id
      WHERE m.language_id = $1

      UNION ALL

      -- 5) Паттерны употребления
      SELECT
        'pattern'::text AS "itemType",
        p.id::int AS "itemId",
        link.entry_id::int AS "entryId",
        p.sense_id::int AS "senseId",
        p.en::text AS en,
        COALESCE(p.ru, '')::text AS ru,
        COALESCE(s.level, '')::text AS level,
        ''::text AS example,
        ''::text AS "exampleRu",
        COALESCE(m.frequency_rank, 999999)::int AS "frequencyRank",
        CASE WHEN upp.item_id IS NULL THEN FALSE ELSE TRUE END AS "isSaved"
      FROM dictionary_usage_patterns p
      JOIN dictionary_senses s ON s.id = p.sense_id
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      LEFT JOIN LATERAL (
        SELECT el.entry_id
        FROM dictionary_entry_links el
        WHERE el.sense_id = p.sense_id
        ORDER BY el.entry_id ASC
        LIMIT 1
      ) link ON TRUE
      LEFT JOIN user_phrase_progress upp ON upp.username = $2 AND upp.item_type = 'pattern' AND upp.item_id = p.id
      WHERE m.language_id = $1
    )
  `;

  // #region agent log
  const countParams = [...baseParams, ...searchParams];
  if (typeof globalThis.fetch === "function") { globalThis.fetch("http://127.0.0.1:7242/ingest/039ed3c9-0fe6-43d1-a385-bc2c487e240a", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "userDictionaryRepo.js:before-count", message: "before count query", data: { countParamsLength: countParams.length, hasSearch }, timestamp: Date.now(), hypothesisId: "H3" }) }).catch(() => {}); }
  // #endregion
  const countRes = await db.query(
    `
      ${commonCte}
      SELECT COUNT(*)::int AS c
      FROM items i
      ${filterSql}
    `,
    countParams
  );
  const total = Number(countRes.rows[0]?.c || 0);
  // #region agent log
  if (typeof globalThis.fetch === "function") { globalThis.fetch("http://127.0.0.1:7242/ingest/039ed3c9-0fe6-43d1-a385-bc2c487e240a", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "userDictionaryRepo.js:after-count", message: "after count query", data: { total }, timestamp: Date.now(), hypothesisId: "H3" }) }).catch(() => {}); }
  // #endregion

  const listParams = [...baseParams, ...searchParams, limit, offset];
  // #region agent log
  if (typeof globalThis.fetch === "function") { globalThis.fetch("http://127.0.0.1:7242/ingest/039ed3c9-0fe6-43d1-a385-bc2c487e240a", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "userDictionaryRepo.js:before-list", message: "before list query", data: { listParamsLength: listParams.length }, timestamp: Date.now(), hypothesisId: "H4" }) }).catch(() => {}); }
  // #endregion
  const listRes = await db.query(
    `
      ${commonCte}
      SELECT
        i."itemType",
        i."itemId",
        i."entryId",
        i."senseId",
        i.en,
        i.ru,
        i.level,
        i.example,
        i."exampleRu",
        i."isSaved",
        i."frequencyRank"
      FROM items i
      ${filterSql}
      ORDER BY
        i."frequencyRank" ASC,
        CASE i."itemType"
          WHEN 'entry' THEN 1
          WHEN 'form' THEN 2
          WHEN 'form_card' THEN 3
          WHEN 'collocation' THEN 4
          WHEN 'pattern' THEN 5
          ELSE 99
        END ASC,
        i."itemId" ASC
      LIMIT $${hasSearch ? 4 : 3} OFFSET $${hasSearch ? 5 : 4}
    `,
    listParams
  );

  const items = (listRes.rows || []).map((r) => {
    const itemId = Number(r.itemId || 0);
    return {
      id: itemId, // backward compatibility for old client shape
      itemType: String(r.itemType || ""),
      itemId,
      entryId: Number.isFinite(Number(r.entryId)) ? Number(r.entryId) : null,
      senseId: Number.isFinite(Number(r.senseId)) ? Number(r.senseId) : null,
      en: String(r.en ?? ""),
      ru: String(r.ru ?? ""),
      level: String(r.level ?? ""),
      example: String(r.example ?? ""),
      exampleRu: String(r.exampleRu ?? ""),
      isSaved: Boolean(r.isSaved),
    };
  });

  return { items, total };
}

export async function lookupDictionaryTerm(langCode, term, limit = 5, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return [];
  const t = String(term || "").trim().toLowerCase();
  if (!t) return [];
  const tAscii = t.replace(/[’`]/g, "'");
  const tCurly = t.replace(/'/g, "’");
  const lim = clampInt(limit, 1, 20, 5);
  // Match by lemma and by word forms.
  const res = await db.query(
    `
      WITH lemma_matches AS (
        SELECT
          s.id AS "senseId",
          l.id AS "lemmaId",
          l.lemma AS "lemma",
          s.gloss_ru AS "glossRu",
          s.level AS "level",
          s.register AS "register",
          l.frequency_rank AS "frequencyRank",
          'lemma'::text AS "matchedBy",
          NULL::text AS "matchedForm",
          CASE
            WHEN l.lemma_key = $2 OR l.lemma_key = $4 OR l.lemma_key = $5 THEN 0
            WHEN l.lemma_key LIKE ($2 || '%') OR l.lemma_key LIKE ($4 || '%') OR l.lemma_key LIKE ($5 || '%') THEN 1
            ELSE 2
          END AS "matchRank"
        FROM dictionary_lemmas l
        JOIN dictionary_senses s ON s.lemma_id = l.id AND s.sense_no = 1
        WHERE l.language_id = $1
          AND (
            l.lemma_key = $2 OR l.lemma_key = $4 OR l.lemma_key = $5
            OR l.lemma_key LIKE ($2 || '%') OR l.lemma_key LIKE ($4 || '%') OR l.lemma_key LIKE ($5 || '%')
            OR l.lemma_key LIKE ('%' || $2 || '%') OR l.lemma_key LIKE ('%' || $4 || '%') OR l.lemma_key LIKE ('%' || $5 || '%')
          )
      ),
      form_matches AS (
        SELECT
          s.id AS "senseId",
          l.id AS "lemmaId",
          l.lemma AS "lemma",
          s.gloss_ru AS "glossRu",
          s.level AS "level",
          s.register AS "register",
          l.frequency_rank AS "frequencyRank",
          'form'::text AS "matchedBy",
          f.form AS "matchedForm",
          CASE
            WHEN LOWER(f.form) = $2 OR LOWER(f.form) = $4 OR LOWER(f.form) = $5 THEN 0
            WHEN LOWER(f.form) LIKE ($2 || '%') OR LOWER(f.form) LIKE ($4 || '%') OR LOWER(f.form) LIKE ($5 || '%') THEN 1
            ELSE 2
          END AS "matchRank"
        FROM dictionary_forms f
        JOIN dictionary_lemmas l ON l.id = f.lemma_id
        JOIN dictionary_senses s ON s.lemma_id = l.id AND s.sense_no = 1
        WHERE l.language_id = $1
          AND (
            LOWER(f.form) = $2 OR LOWER(f.form) = $4 OR LOWER(f.form) = $5
            OR LOWER(f.form) LIKE ($2 || '%') OR LOWER(f.form) LIKE ($4 || '%') OR LOWER(f.form) LIKE ($5 || '%')
            OR LOWER(f.form) LIKE ('%' || $2 || '%') OR LOWER(f.form) LIKE ('%' || $4 || '%') OR LOWER(f.form) LIKE ('%' || $5 || '%')
          )
      ),
      merged AS (
        SELECT * FROM lemma_matches
        UNION ALL
        SELECT * FROM form_matches
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY "senseId"
            ORDER BY
              "matchRank" ASC,
              CASE WHEN "matchedBy" = 'lemma' THEN 0 ELSE 1 END ASC
          ) AS rn
        FROM merged
      )
      SELECT
        "senseId",
        "lemmaId",
        "lemma",
        "glossRu",
        "level",
        "register",
        "frequencyRank",
        "matchedBy",
        "matchedForm",
        "matchRank"
      FROM ranked
      WHERE rn = 1
      ORDER BY "matchRank" ASC, "frequencyRank" ASC, "senseId" ASC
      LIMIT $3
    `,
    [languageId, t, lim, tAscii, tCurly]
  );
  const rows = res.rows || [];
  const isAmbiguous = rows.length > 1;
  return rows.map((r) => ({ ...r, isAmbiguous }));
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

function normalizeCollectionItemType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (["entry", "form", "form_card", "collocation", "pattern"].includes(s)) return s;
  return null;
}

async function resolveSenseIdByEntity(langCode, itemType, itemId, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return null;
  const t = normalizeCollectionItemType(itemType);
  const id = Number(itemId);
  if (!t || !Number.isFinite(id) || id <= 0) return null;

  if (t === "entry") {
    const r = await db.query(
      `
        SELECT l.sense_id AS "senseId"
        FROM dictionary_entries e
        JOIN dictionary_entry_links l ON l.entry_id = e.id
        WHERE e.language_id = $1 AND e.id = $2
        LIMIT 1
      `,
      [languageId, id]
    );
    return r.rows[0]?.senseId ? Number(r.rows[0].senseId) : null;
  }

  if (t === "form") {
    const r = await db.query(
      `
        SELECT s.id AS "senseId"
        FROM dictionary_forms f
        JOIN dictionary_lemmas m ON m.id = f.lemma_id
        JOIN dictionary_senses s ON s.lemma_id = m.id AND s.sense_no = 1
        WHERE m.language_id = $1 AND f.id = $2
        LIMIT 1
      `,
      [languageId, id]
    );
    return r.rows[0]?.senseId ? Number(r.rows[0].senseId) : null;
  }

  if (t === "form_card") {
    const r = await db.query(
      `
        SELECT l.sense_id AS "senseId"
        FROM dictionary_form_cards fc
        JOIN dictionary_entries e ON e.id = fc.entry_id
        LEFT JOIN dictionary_entry_links l ON l.entry_id = fc.entry_id
        WHERE e.language_id = $1 AND fc.id = $2
        LIMIT 1
      `,
      [languageId, id]
    );
    return r.rows[0]?.senseId ? Number(r.rows[0].senseId) : null;
  }

  if (t === "collocation") {
    const r = await db.query(
      `
        SELECT COALESCE(s.id, l.sense_id) AS "senseId"
        FROM dictionary_collocations c
        JOIN dictionary_lemmas m ON m.id = c.lemma_id
        LEFT JOIN dictionary_senses s ON s.lemma_id = m.id AND s.sense_no = 1
        LEFT JOIN LATERAL (
          SELECT sense_id
          FROM dictionary_entry_links
          WHERE lemma_id = m.id
          ORDER BY entry_id ASC
          LIMIT 1
        ) l ON TRUE
        WHERE m.language_id = $1 AND c.id = $2
        LIMIT 1
      `,
      [languageId, id]
    );
    return r.rows[0]?.senseId ? Number(r.rows[0].senseId) : null;
  }

  if (t === "pattern") {
    const r = await db.query(
      `
        SELECT p.sense_id AS "senseId"
        FROM dictionary_usage_patterns p
        JOIN dictionary_senses s ON s.id = p.sense_id
        JOIN dictionary_lemmas m ON m.id = s.lemma_id
        WHERE m.language_id = $1 AND p.id = $2
        LIMIT 1
      `,
      [languageId, id]
    );
    return r.rows[0]?.senseId ? Number(r.rows[0].senseId) : null;
  }

  return null;
}

export async function listCollectionsAdmin(langCode, opts = {}, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return { items: [], total: 0 };
  const q = String(opts.q || "").trim();
  const offset = clampInt(opts.offset, 0, 100000, 0);
  const limit = clampInt(opts.limit, 1, 200, 50);
  const hasSearch = q.length > 0;

  const whereSql = hasSearch ? `AND (c.title ILIKE $2 OR c.description ILIKE $2 OR c.collection_key ILIKE $2)` : "";
  const baseParams = hasSearch ? [languageId, `%${q}%`] : [languageId];

  const countRes = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM dictionary_collections c
      WHERE c.language_id = $1
      ${whereSql}
    `,
    baseParams
  );

  const n = baseParams.length + 1;
  const rows = await db.query(
    `
      SELECT
        c.id,
        c.collection_key AS "collectionKey",
        c.title,
        c.description,
        c.level_from AS "levelFrom",
        c.level_to AS "levelTo",
        c.is_public AS "isPublic",
        c.sort_order AS "sortOrder",
        COUNT(i.sense_id)::int AS total
      FROM dictionary_collections c
      LEFT JOIN dictionary_collection_items i ON i.collection_id = c.id
      WHERE c.language_id = $1
      ${whereSql}
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC
      LIMIT $${n} OFFSET $${n + 1}
    `,
    [...baseParams, limit, offset]
  );

  return { items: rows.rows || [], total: Number(countRes.rows[0]?.total || 0) };
}

export async function createCollectionAdmin(langCode, payload = {}, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return null;
  const title = String(payload.title || "").trim();
  const collectionKeyRaw = String(payload.collectionKey || "").trim().toLowerCase();
  const collectionKey = collectionKeyRaw || title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!title) return null;
  if (!collectionKey) return null;

  const levelFrom = String(payload.levelFrom || "A0").trim().toUpperCase();
  const levelTo = String(payload.levelTo || "C2").trim().toUpperCase();
  const isPublic = payload.isPublic !== false;
  const sortOrder = clampInt(payload.sortOrder, -100000, 100000, 0);
  const description = String(payload.description || "");

  const res = await db.query(
    `
      INSERT INTO dictionary_collections (
        language_id, collection_key, title, description, level_from, level_to, is_public, sort_order, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING
        id,
        collection_key AS "collectionKey",
        title,
        description,
        level_from AS "levelFrom",
        level_to AS "levelTo",
        is_public AS "isPublic",
        sort_order AS "sortOrder"
    `,
    [languageId, collectionKey, title, description, levelFrom, levelTo, isPublic, sortOrder]
  );
  return res.rows[0] || null;
}

export async function patchCollectionAdmin(langCode, collectionId, patch = {}, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  const cid = Number(collectionId);
  if (!languageId || !Number.isFinite(cid) || cid <= 0) return null;

  const set = [];
  const params = [];
  let n = 1;
  const setIf = (col, val) => {
    if (val === undefined) return;
    set.push(`${col} = $${n++}`);
    params.push(val);
  };

  if (patch.collectionKey !== undefined) {
    const key = String(patch.collectionKey || "").trim().toLowerCase();
    setIf("collection_key", key);
  }
  if (patch.title !== undefined) setIf("title", String(patch.title || "").trim());
  if (patch.description !== undefined) setIf("description", String(patch.description || ""));
  if (patch.levelFrom !== undefined) setIf("level_from", String(patch.levelFrom || "A0").trim().toUpperCase());
  if (patch.levelTo !== undefined) setIf("level_to", String(patch.levelTo || "C2").trim().toUpperCase());
  if (patch.isPublic !== undefined) setIf("is_public", !!patch.isPublic);
  if (patch.sortOrder !== undefined) setIf("sort_order", clampInt(patch.sortOrder, -100000, 100000, 0));

  if (set.length === 0) {
    const same = await db.query(
      `
        SELECT
          id,
          collection_key AS "collectionKey",
          title,
          description,
          level_from AS "levelFrom",
          level_to AS "levelTo",
          is_public AS "isPublic",
          sort_order AS "sortOrder"
        FROM dictionary_collections
        WHERE id = $1 AND language_id = $2
        LIMIT 1
      `,
      [cid, languageId]
    );
    return same.rows[0] || null;
  }

  params.push(cid, languageId);
  const out = await db.query(
    `
      UPDATE dictionary_collections
      SET ${set.join(", ")}, updated_at = NOW()
      WHERE id = $${n} AND language_id = $${n + 1}
      RETURNING
        id,
        collection_key AS "collectionKey",
        title,
        description,
        level_from AS "levelFrom",
        level_to AS "levelTo",
        is_public AS "isPublic",
        sort_order AS "sortOrder"
    `,
    params
  );
  return out.rows[0] || null;
}

export async function deleteCollectionAdmin(langCode, collectionId, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  const cid = Number(collectionId);
  if (!languageId || !Number.isFinite(cid) || cid <= 0) return { ok: false };
  const res = await db.query(
    `DELETE FROM dictionary_collections WHERE id = $1 AND language_id = $2`,
    [cid, languageId]
  );
  return { ok: true, deleted: Number(res.rowCount || 0) };
}

export async function listCollectionItemsAdmin(langCode, collectionId, opts = {}, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  const cid = Number(collectionId);
  if (!languageId || !Number.isFinite(cid) || cid <= 0) return { collection: null, items: [], total: 0 };
  const q = String(opts.q || "").trim();
  const offset = clampInt(opts.offset, 0, 100000, 0);
  const limit = clampInt(opts.limit, 1, 500, 100);

  const colRes = await db.query(
    `
      SELECT
        id,
        collection_key AS "collectionKey",
        title,
        description,
        level_from AS "levelFrom",
        level_to AS "levelTo",
        is_public AS "isPublic",
        sort_order AS "sortOrder"
      FROM dictionary_collections
      WHERE id = $1 AND language_id = $2
      LIMIT 1
    `,
    [cid, languageId]
  );
  const collection = colRes.rows[0] || null;
  if (!collection) return { collection: null, items: [], total: 0 };

  const whereQ = q ? `AND (m.lemma ILIKE $3 OR s.gloss_ru ILIKE $3 OR COALESCE(ex.en, '') ILIKE $3)` : "";
  const params = q ? [cid, languageId, `%${q}%`] : [cid, languageId];

  const totalRes = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM dictionary_collection_items i
      JOIN dictionary_senses s ON s.id = i.sense_id
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      LEFT JOIN dictionary_examples ex ON ex.sense_id = s.id AND ex.is_main = TRUE
      WHERE i.collection_id = $1 AND m.language_id = $2
      ${whereQ}
    `,
    params
  );

  const n = params.length + 1;
  const rows = await db.query(
    `
      SELECT
        i.id,
        i.collection_id AS "collectionId",
        i.sense_id AS "senseId",
        i.sort_order AS "sortOrder",
        m.lemma AS en,
        s.gloss_ru AS ru,
        s.level AS level,
        COALESCE(ex.en, '') AS example,
        COALESCE(ex.ru, '') AS "exampleRu"
      FROM dictionary_collection_items i
      JOIN dictionary_senses s ON s.id = i.sense_id
      JOIN dictionary_lemmas m ON m.id = s.lemma_id
      LEFT JOIN dictionary_examples ex ON ex.sense_id = s.id AND ex.is_main = TRUE
      WHERE i.collection_id = $1 AND m.language_id = $2
      ${whereQ}
      ORDER BY i.sort_order ASC, i.id ASC
      LIMIT $${n} OFFSET $${n + 1}
    `,
    [...params, limit, offset]
  );

  return {
    collection,
    items: rows.rows || [],
    total: Number(totalRes.rows[0]?.total || 0),
  };
}

export async function searchCollectionCandidatesAdmin(langCode, opts = {}, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return { items: [], total: 0 };
  const q = String(opts.q || "").trim();
  const offset = clampInt(opts.offset, 0, 100000, 0);
  const limit = clampInt(opts.limit, 1, 200, 60);

  const out = await listAllWords("", langCode, { q, offset, limit }, db);
  return out;
}

export async function addCollectionItemAdmin(langCode, collectionId, payload = {}, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  const cid = Number(collectionId);
  if (!languageId || !Number.isFinite(cid) || cid <= 0) return { ok: false, reason: "bad_collection_id" };

  const col = await db.query(
    `SELECT id FROM dictionary_collections WHERE id = $1 AND language_id = $2 LIMIT 1`,
    [cid, languageId]
  );
  if (!col.rows[0]) return { ok: false, reason: "collection_not_found" };

  let senseId = Number(payload.senseId || 0);
  if (!Number.isFinite(senseId) || senseId <= 0) {
    senseId = await resolveSenseIdByEntity(langCode, payload.itemType, payload.itemId, db);
  }
  if (!senseId) return { ok: false, reason: "sense_not_found" };

  const sortOrder = payload.sortOrder !== undefined
    ? clampInt(payload.sortOrder, -100000, 100000, 0)
    : null;

  const row = await db.query(
    `
      INSERT INTO dictionary_collection_items (collection_id, sense_id, sort_order)
      VALUES (
        $1,
        $2,
        COALESCE(
          $3,
          (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM dictionary_collection_items WHERE collection_id = $1)
        )
      )
      ON CONFLICT (collection_id, sense_id) DO UPDATE SET
        sort_order = COALESCE(EXCLUDED.sort_order, dictionary_collection_items.sort_order)
      RETURNING id, collection_id AS "collectionId", sense_id AS "senseId", sort_order AS "sortOrder"
    `,
    [cid, senseId, sortOrder]
  );
  return { ok: true, item: row.rows[0] || null };
}

export async function removeCollectionItemAdmin(langCode, collectionId, payload = {}, db = pool) {
  const languageId = await getLanguageId(langCode, db);
  const cid = Number(collectionId);
  if (!languageId || !Number.isFinite(cid) || cid <= 0) return { ok: false };

  let senseId = Number(payload.senseId || 0);
  if (!Number.isFinite(senseId) || senseId <= 0) {
    senseId = await resolveSenseIdByEntity(langCode, payload.itemType, payload.itemId, db);
  }
  if (!senseId) return { ok: false, reason: "sense_not_found" };

  const out = await db.query(
    `DELETE FROM dictionary_collection_items WHERE collection_id = $1 AND sense_id = $2`,
    [cid, senseId]
  );
  return { ok: true, deleted: Number(out.rowCount || 0) };
}

export async function reorderCollectionItemsAdmin(langCode, collectionId, senseIds = [], db = pool) {
  const languageId = await getLanguageId(langCode, db);
  const cid = Number(collectionId);
  if (!languageId || !Number.isFinite(cid) || cid <= 0) return { ok: false };
  const ids = Array.from(new Set((senseIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return { ok: true, updated: 0 };

  await db.query(
    `
      UPDATE dictionary_collection_items i
      SET sort_order = t.ord - 1
      FROM UNNEST($2::int[]) WITH ORDINALITY AS t(sense_id, ord)
      WHERE i.collection_id = $1
        AND i.sense_id = t.sense_id
    `,
    [cid, ids]
  );
  return { ok: true, updated: ids.length };
}

/**
 * Возвращает массив entry_id для «Мой словарь» из user_saved_senses (актуальный источник).
 * Используется в GET /me, чтобы клиент и игры видели правильный список слов.
 */
export async function getPersonalEntryIdsFromSavedSenses(username, langCode = "en", db = pool) {
  const u = String(username || "").trim();
  if (!u) return [];
  const languageId = await getLanguageId(langCode, db);
  if (!languageId) return [];
  const res = await db.query(
    `
      SELECT DISTINCT e.id AS "entryId"
      FROM user_saved_senses us
      JOIN dictionary_entry_links l ON l.sense_id = us.sense_id
      JOIN dictionary_entries e ON e.id = l.entry_id AND e.language_id = $2
      WHERE us.username = $1
      ORDER BY e.id
    `,
    [u, languageId]
  );
  return (res.rows || []).map((r) => Number(r.entryId)).filter((n) => Number.isFinite(n) && n > 0);
}

