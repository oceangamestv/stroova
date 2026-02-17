/**
 * Импорт коллекции из JSON (экспортированного export-collection.mjs).
 * Использование: node server/import-collection.mjs <file.json> [--dry-run]
 * На проде задать DATABASE_URL продовой БД (или .env.production).
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
    `
    SELECT s.id
    FROM dictionary_senses s
    JOIN dictionary_lemmas l ON l.id = s.lemma_id
    WHERE l.language_id = $1 AND l.lemma_key = $2 AND s.sense_no = $3
    LIMIT 1
    `,
    [languageId, String(lemmaKey), Number(senseNo) || 1]
  );
  return res.rows[0]?.id ? Number(res.rows[0].id) : null;
}

async function importCollection(filePath, dryRun) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const { langCode, collection: col, items } = data;
  if (!col || !Array.isArray(items)) {
    throw new Error("Invalid export JSON: expected collection and items");
  }

  const languageId = await getLanguageId(langCode);
  if (!languageId) {
    throw new Error(`Language not found: ${langCode}`);
  }

  const client = await pool.connect();
  const notFound = [];
  const resolved = [];

  try {
    if (dryRun) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const senseId = await resolveSenseId(client, languageId, it.lemmaKey, it.senseNo);
        if (senseId) resolved.push({ ...it, senseId });
        else notFound.push(it.lemmaKey);
      }
      console.log(`Dry run: would import collection "${col.collectionKey}" with ${resolved.length} items.`);
      if (notFound.length) {
        console.warn(`Not found on target DB (${notFound.length}): ${notFound.slice(0, 20).join(", ")}${notFound.length > 20 ? "..." : ""}`);
      }
      return;
    }

    const colRes = await client.query(
      `
      INSERT INTO dictionary_collections (
        language_id, collection_key, title, description,
        level_from, level_to, is_public, sort_order, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (language_id, collection_key) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        level_from = EXCLUDED.level_from,
        level_to = EXCLUDED.level_to,
        is_public = EXCLUDED.is_public,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
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
      console.warn(`Skipped (not found on target): ${notFound.slice(0, 30).join(", ")}${notFound.length > 30 ? "..." : ""}`);
    }
    console.log(`Imported collection "${col.collectionKey}": ${inserted} items.`);
  } finally {
    client.release();
  }
}

async function main() {
  const { filePath, dryRun } = parseArgs();
  if (!filePath) {
    console.error("Usage: node server/import-collection.mjs <file.json> [--dry-run]");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  await importCollection(filePath, dryRun);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
