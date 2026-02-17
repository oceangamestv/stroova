/**
 * Экспорт коллекции в переносимый JSON (без внутренних id).
 * Использование: node server/export-collection.mjs [--collection-key=a0_basics] [--lang=en] [-o file.json]
 * Без -o выводит в stdout.
 */
import "dotenv/config";
import fs from "fs";
import { pool } from "./db.js";

function parseArgs() {
  const args = process.argv.slice(2);
  let collectionKey = "a0_basics";
  let lang = "en";
  let outFile = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--collection-key=")) collectionKey = a.slice("--collection-key=".length).trim();
    else if (a.startsWith("--lang=")) lang = a.slice("--lang=".length).trim();
    else if (a === "-o") {
      if (args[i + 1]) {
        outFile = args[i + 1];
        i++;
      }
    } else if (a.startsWith("-o=")) outFile = a.slice(3);
  }
  return { collectionKey, lang, outFile };
}

async function getLanguageId(langCode) {
  const res = await pool.query("SELECT id FROM languages WHERE code = $1", [String(langCode || "en")]);
  return res.rows[0]?.id ?? null;
}

async function exportCollection(collectionKey, lang) {
  const languageId = await getLanguageId(lang);
  if (!languageId) {
    throw new Error(`Language not found: ${lang}`);
  }

  const colRes = await pool.query(
    `
    SELECT
      collection_key AS "collectionKey",
      title,
      description,
      level_from AS "levelFrom",
      level_to AS "levelTo",
      is_public AS "isPublic",
      sort_order AS "sortOrder"
    FROM dictionary_collections
    WHERE language_id = $1 AND collection_key = $2
    LIMIT 1
    `,
    [languageId, collectionKey]
  );
  const collection = colRes.rows[0] ?? null;
  if (!collection) {
    throw new Error(`Collection not found: language_id=${languageId}, collection_key=${collectionKey}`);
  }

  const itemsRes = await pool.query(
    `
    SELECT
      m.lemma_key AS "lemmaKey",
      s.sense_no AS "senseNo",
      i.sort_order AS "sortOrder"
    FROM dictionary_collection_items i
    JOIN dictionary_senses s ON s.id = i.sense_id
    JOIN dictionary_lemmas m ON m.id = s.lemma_id
    WHERE i.collection_id = (
      SELECT id FROM dictionary_collections
      WHERE language_id = $1 AND collection_key = $2
      LIMIT 1
    ) AND m.language_id = $1
    ORDER BY i.sort_order ASC, i.id ASC
    `,
    [languageId, collectionKey]
  );
  const items = (itemsRes.rows || []).map((r) => ({
    lemmaKey: r.lemmaKey,
    senseNo: Number(r.senseNo) || 1,
    sortOrder: Number(r.sortOrder) ?? 0,
  }));

  return {
    langCode: lang,
    collection: {
      collectionKey: collection.collectionKey,
      title: collection.title,
      description: collection.description ?? "",
      levelFrom: collection.levelFrom ?? "A0",
      levelTo: collection.levelTo ?? "A0",
      isPublic: Boolean(collection.isPublic),
      sortOrder: Number(collection.sortOrder) ?? 0,
    },
    items,
  };
}

async function main() {
  const { collectionKey, lang, outFile } = parseArgs();
  const data = await exportCollection(collectionKey, lang);
  const json = JSON.stringify(data, null, 2);
  if (outFile) {
    fs.writeFileSync(outFile, json, "utf8");
    console.error(`Exported ${data.items.length} items to ${outFile}`);
  } else {
    console.log(json);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
