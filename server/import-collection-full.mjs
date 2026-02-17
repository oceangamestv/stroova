/**
 * Импорт полного экспорта коллекции (словарь + коллекция).
 * Сначала вставляет леммы, senses, примеры, формы; затем коллекцию и items.
 * Использование: node server/import-collection-full.mjs <file.json> [--dry-run]
 */
import "dotenv/config";
import fs from "fs";
import { pool } from "./db.js";

function parseArgs() {
  const args = process.argv.slice(2);
  let filePath = null;
  let dryRun = false;
  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (!a.startsWith("-")) filePath = a;
  }
  return { filePath, dryRun };
}

async function getLanguageId(langCode) {
  const res = await pool.query("SELECT id FROM languages WHERE code = $1", [String(langCode || "en")]);
  return res.rows[0]?.id ?? null;
}

async function resolveSenseId(client, languageId, lemmaKey, senseNo) {
  const res = await client.query(
    `SELECT s.id FROM dictionary_senses s
     JOIN dictionary_lemmas l ON l.id = s.lemma_id
     WHERE l.language_id = $1 AND l.lemma_key = $2 AND s.sense_no = $3 LIMIT 1`,
    [languageId, String(lemmaKey), Number(senseNo) || 1]
  );
  return res.rows[0]?.id ? Number(res.rows[0].id) : null;
}

async function importFull(filePath, dryRun) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const { langCode, collection: col, items, dictionary } = data;
  if (!col || !Array.isArray(items)) {
    throw new Error("Invalid export JSON: expected collection and items");
  }

  const languageId = await getLanguageId(langCode);
  if (!languageId) throw new Error(`Language not found: ${langCode}`);

  const dict = dictionary && typeof dictionary === "object" ? dictionary : { lemmas: [], senses: [], examples: [], forms: [] };
  const client = await pool.connect();

  try {
    if (dryRun) {
      const lemmaCount = (dict.lemmas || []).length;
      const senseCount = (dict.senses || []).length;
      console.log(
        `Dry run: would import ${lemmaCount} lemmas, ${senseCount} senses, ${(dict.examples || []).length} examples, ${(dict.forms || []).length} forms, then collection "${col.collectionKey}" with ${items.length} items.`
      );
      return;
    }

    const lemmaIdByKey = new Map();

    for (const lem of dict.lemmas || []) {
      const key = String(lem.lemmaKey ?? "").trim();
      if (!key) continue;
      const r = await client.query(
        `
        INSERT INTO dictionary_lemmas (language_id, lemma_key, lemma, pos, frequency_rank, rarity, accent, ipa_uk, ipa_us, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (language_id, lemma_key) DO UPDATE SET
          lemma = EXCLUDED.lemma, pos = EXCLUDED.pos, frequency_rank = EXCLUDED.frequency_rank,
          rarity = EXCLUDED.rarity, accent = EXCLUDED.accent, ipa_uk = EXCLUDED.ipa_uk, ipa_us = EXCLUDED.ipa_us,
          updated_at = NOW()
        RETURNING id, lemma_key
        `,
        [
          languageId,
          key,
          String(lem.lemma ?? key),
          String(lem.pos ?? ""),
          Number(lem.frequencyRank) ?? 15000,
          String(lem.rarity ?? "не редкое"),
          String(lem.accent ?? "both"),
          String(lem.ipaUk ?? ""),
          String(lem.ipaUs ?? ""),
        ]
      );
      if (r.rows[0]) lemmaIdByKey.set(r.rows[0].lemma_key, r.rows[0].id);
    }

    for (const s of dict.senses || []) {
      const lemmaKey = String(s.lemmaKey ?? "").trim();
      const lemmaId = lemmaIdByKey.get(lemmaKey);
      if (!lemmaId) continue;
      const senseNo = Number(s.senseNo) || 1;
      await client.query(
        `
        INSERT INTO dictionary_senses (lemma_id, sense_no, level, register, gloss_ru, definition_ru, usage_note, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (lemma_id, sense_no) DO UPDATE SET
          level = EXCLUDED.level, register = EXCLUDED.register, gloss_ru = EXCLUDED.gloss_ru,
          definition_ru = EXCLUDED.definition_ru, usage_note = EXCLUDED.usage_note, updated_at = NOW()
        `,
        [
          lemmaId,
          senseNo,
          String(s.level ?? "A0"),
          String(s.register ?? "разговорная"),
          String(s.glossRu ?? ""),
          String(s.definitionRu ?? ""),
          String(s.usageNote ?? ""),
        ]
      );
    }

    for (const ex of dict.examples || []) {
      const senseId = await resolveSenseId(client, languageId, ex.lemmaKey, ex.senseNo);
      if (!senseId) continue;
      await client.query(
        `
        INSERT INTO dictionary_examples (sense_id, en, ru, is_main, sort_order)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (sense_id, en, ru) DO UPDATE SET is_main = EXCLUDED.is_main, sort_order = EXCLUDED.sort_order
        `,
        [senseId, String(ex.en ?? ""), String(ex.ru ?? ""), Boolean(ex.isMain), Number(ex.sortOrder) ?? 0]
      );
    }

    for (const f of dict.forms || []) {
      const lemmaId = lemmaIdByKey.get(String(f.lemmaKey ?? "").trim());
      if (!lemmaId) continue;
      await client.query(
        `
        INSERT INTO dictionary_forms (lemma_id, form, form_type, is_irregular, notes)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (lemma_id, form, form_type) DO UPDATE SET is_irregular = EXCLUDED.is_irregular, notes = EXCLUDED.notes
        `,
        [lemmaId, String(f.form ?? ""), String(f.formType ?? ""), Boolean(f.isIrregular), String(f.notes ?? "")]
      );
    }

    const colRes = await client.query(
      `
      INSERT INTO dictionary_collections (language_id, collection_key, title, description, level_from, level_to, is_public, sort_order, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (language_id, collection_key) DO UPDATE SET
        title = EXCLUDED.title, description = EXCLUDED.description, level_from = EXCLUDED.level_from,
        level_to = EXCLUDED.level_to, is_public = EXCLUDED.is_public, sort_order = EXCLUDED.sort_order, updated_at = NOW()
      RETURNING id
      `,
      [
        languageId,
        col.collectionKey,
        col.title,
        col.description ?? "",
        col.levelFrom ?? "A0",
        col.levelTo ?? "A0",
        col.isPublic !== false,
        Number(col.sortOrder) ?? 0,
      ]
    );
    const collectionId = colRes.rows[0]?.id;
    if (!collectionId) throw new Error("Failed to upsert collection");

    await client.query("DELETE FROM dictionary_collection_items WHERE collection_id = $1", [collectionId]);

    let inserted = 0;
    const notFound = [];
    for (const it of items) {
      const senseId = await resolveSenseId(client, languageId, it.lemmaKey, it.senseNo);
      if (!senseId) {
        notFound.push(it.lemmaKey);
        continue;
      }
      await client.query(
        `
        INSERT INTO dictionary_collection_items (collection_id, sense_id, sort_order)
        VALUES ($1, $2, $3)
        ON CONFLICT (collection_id, sense_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
        `,
        [collectionId, senseId, Number(it.sortOrder) ?? inserted]
      );
      inserted++;
    }

    if (notFound.length) {
      console.warn(`Skipped collection items (sense not found): ${notFound.slice(0, 20).join(", ")}${notFound.length > 20 ? "..." : ""}`);
    }
    console.log(`Imported collection "${col.collectionKey}": ${inserted} items.`);
  } finally {
    client.release();
  }
}

async function main() {
  const { filePath, dryRun } = parseArgs();
  if (!filePath) {
    console.error("Usage: node server/import-collection-full.mjs <file.json> [--dry-run]");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  await importFull(filePath, dryRun);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
