/**
 * Полный экспорт коллекции: словарь (леммы, senses, примеры, формы) + состав коллекции.
 * Для переноса на прод, где этих слов ещё нет.
 * Использование: node server/export-collection-full.mjs [--collection-key=a0_basics] [--lang=en] [-o file.json]
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
    else if (a === "-o" && args[i + 1]) {
      outFile = args[i + 1];
      i++;
    } else if (a.startsWith("-o=")) outFile = a.slice(3);
  }
  return { collectionKey, lang, outFile };
}

async function getLanguageId(langCode) {
  const res = await pool.query("SELECT id FROM languages WHERE code = $1", [String(langCode || "en")]);
  return res.rows[0]?.id ?? null;
}

async function exportFull(collectionKey, lang) {
  const languageId = await getLanguageId(lang);
  if (!languageId) throw new Error(`Language not found: ${lang}`);

  const colRes = await pool.query(
    `
    SELECT collection_key AS "collectionKey", title, description,
           level_from AS "levelFrom", level_to AS "levelTo", is_public AS "isPublic", sort_order AS "sortOrder"
    FROM dictionary_collections
    WHERE language_id = $1 AND collection_key = $2 LIMIT 1
    `,
    [languageId, collectionKey]
  );
  const collection = colRes.rows[0] ?? null;
  if (!collection) throw new Error(`Collection not found: ${collectionKey}`);

  const itemsRes = await pool.query(
    `
    SELECT m.lemma_key AS "lemmaKey", s.sense_no AS "senseNo", i.sort_order AS "sortOrder"
    FROM dictionary_collection_items i
    JOIN dictionary_senses s ON s.id = i.sense_id
    JOIN dictionary_lemmas m ON m.id = s.lemma_id
    WHERE i.collection_id = (SELECT id FROM dictionary_collections WHERE language_id = $1 AND collection_key = $2 LIMIT 1)
      AND m.language_id = $1
    ORDER BY i.sort_order ASC, i.id ASC
    `,
    [languageId, collectionKey]
  );
  const items = (itemsRes.rows || []).map((r) => ({
    lemmaKey: r.lemmaKey,
    senseNo: Number(r.senseNo) || 1,
    sortOrder: Number(r.sortOrder) ?? 0,
  }));

  const lemmaKeys = [...new Set(items.map((it) => it.lemmaKey))];
  if (lemmaKeys.length === 0) {
    return {
      langCode: lang,
      collection: { ...collection, levelFrom: collection.levelFrom ?? "A0", levelTo: collection.levelTo ?? "A0", isPublic: Boolean(collection.isPublic), sortOrder: Number(collection.sortOrder) ?? 0 },
      items,
      dictionary: { lemmas: [], senses: [], examples: [], forms: [] },
    };
  }

  const lemmasRes = await pool.query(
    `
    SELECT lemma_key AS "lemmaKey", lemma, pos, frequency_rank AS "frequencyRank", rarity, accent, ipa_uk AS "ipaUk", ipa_us AS "ipaUs"
    FROM dictionary_lemmas
    WHERE language_id = $1 AND lemma_key = ANY($2::text[])
    `,
    [languageId, lemmaKeys]
  );
  const lemmas = (lemmasRes.rows || []).map((r) => ({
    lemmaKey: r.lemmaKey,
    lemma: r.lemma,
    pos: r.pos ?? "",
    frequencyRank: Number(r.frequencyRank) ?? 15000,
    rarity: r.rarity ?? "не редкое",
    accent: r.accent ?? "both",
    ipaUk: r.ipaUk ?? "",
    ipaUs: r.ipaUs ?? "",
  }));

  const sensesRes = await pool.query(
    `
    SELECT l.lemma_key AS "lemmaKey", s.sense_no AS "senseNo", s.level, s.register,
           s.gloss_ru AS "glossRu", s.definition_ru AS "definitionRu", s.usage_note AS "usageNote"
    FROM dictionary_senses s
    JOIN dictionary_lemmas l ON l.id = s.lemma_id
    WHERE l.language_id = $1 AND l.lemma_key = ANY($2::text[])
    `,
    [languageId, lemmaKeys]
  );
  const senses = (sensesRes.rows || []).map((r) => ({
    lemmaKey: r.lemmaKey,
    senseNo: Number(r.senseNo) || 1,
    level: r.level ?? "A0",
    register: r.register ?? "разговорная",
    glossRu: r.glossRu ?? "",
    definitionRu: r.definitionRu ?? "",
    usageNote: r.usageNote ?? "",
  }));

  const examplesRes = await pool.query(
    `
    SELECT l.lemma_key AS "lemmaKey", s.sense_no AS "senseNo", e.en, e.ru, e.is_main AS "isMain", e.sort_order AS "sortOrder"
    FROM dictionary_examples e
    JOIN dictionary_senses s ON s.id = e.sense_id
    JOIN dictionary_lemmas l ON l.id = s.lemma_id
    WHERE l.language_id = $1 AND l.lemma_key = ANY($2::text[])
    `,
    [languageId, lemmaKeys]
  );
  const examples = (examplesRes.rows || []).map((r) => ({
    lemmaKey: r.lemmaKey,
    senseNo: Number(r.senseNo) || 1,
    en: r.en ?? "",
    ru: r.ru ?? "",
    isMain: Boolean(r.isMain),
    sortOrder: Number(r.sortOrder) ?? 0,
  }));

  const formsRes = await pool.query(
    `
    SELECT l.lemma_key AS "lemmaKey", f.form, f.form_type AS "formType", f.is_irregular AS "isIrregular", f.notes
    FROM dictionary_forms f
    JOIN dictionary_lemmas l ON l.id = f.lemma_id
    WHERE l.language_id = $1 AND l.lemma_key = ANY($2::text[])
    `,
    [languageId, lemmaKeys]
  );
  const forms = (formsRes.rows || []).map((r) => ({
    lemmaKey: r.lemmaKey,
    form: r.form,
    formType: r.formType ?? "",
    isIrregular: Boolean(r.isIrregular),
    notes: r.notes ?? "",
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
    dictionary: { lemmas, senses, examples, forms },
  };
}

async function main() {
  const { collectionKey, lang, outFile } = parseArgs();
  const data = await exportFull(collectionKey, lang);
  const json = JSON.stringify(data, null, 2);
  if (outFile) {
    fs.writeFileSync(outFile, json, "utf8");
    console.error(
      `Exported ${data.dictionary.lemmas.length} lemmas, ${data.dictionary.senses.length} senses, ${data.items.length} collection items to ${outFile}`
    );
  } else {
    console.log(json);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
