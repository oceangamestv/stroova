/**
 * Бэкфилл dictionary_entries и dictionary_entry_links из существующих v2 данных (lemmas, senses).
 * Для лемм, у которых есть sense_no = 1, но ещё нет записи в entry_links.
 * Использование: node server/backfill-entries-from-v2.mjs [--lang=en] [--dry-run]
 */
import "dotenv/config";
import { pool } from "./db.js";

function parseArgs() {
  const args = process.argv.slice(2);
  let lang = "en";
  let dryRun = false;
  for (const a of args) {
    if (a.startsWith("--lang=")) lang = a.slice("--lang=".length).trim();
    else if (a === "--dry-run") dryRun = true;
  }
  return { lang, dryRun };
}

async function getLanguageId(langCode) {
  const res = await pool.query("SELECT id FROM languages WHERE code = $1", [String(langCode || "en")]);
  return res.rows[0]?.id ?? null;
}

async function backfill(lang, dryRun) {
  const languageId = await getLanguageId(lang);
  if (!languageId) throw new Error(`Language not found: ${lang}`);

  const client = await pool.connect();
  try {
    const missingRes = await client.query(
      `
      SELECT s.id AS "senseId", s.lemma_id AS "lemmaId"
      FROM dictionary_senses s
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      WHERE l.language_id = $1 AND s.sense_no = 1
        AND NOT EXISTS (SELECT 1 FROM dictionary_entry_links el WHERE el.sense_id = s.id)
      ORDER BY l.frequency_rank ASC, s.id ASC
      `,
      [languageId]
    );
    const missing = missingRes.rows || [];
    if (missing.length === 0) {
      console.log("No senses without entry_links found. Nothing to backfill.");
      return;
    }

    if (dryRun) {
      console.log(`Dry run: would create ${missing.length} dictionary_entries + entry_links for senses without a link.`);
      return;
    }

    const senseIds = missing.map((r) => Number(r.senseId));
    const lemmaRes = await client.query(
      `SELECT id, lemma, frequency_rank AS "frequencyRank", rarity, accent, ipa_uk AS "ipaUk", ipa_us AS "ipaUs"
       FROM dictionary_lemmas WHERE id = ANY($1::int[])`,
      [missing.map((r) => Number(r.lemmaId))]
    );
    const lemmaById = new Map(lemmaRes.rows.map((r) => [Number(r.id), r]));
    const senseRes = await client.query(
      `SELECT id, lemma_id AS "lemmaId", level, register, gloss_ru AS "glossRu"
       FROM dictionary_senses WHERE id = ANY($1::int[])`,
      [senseIds]
    );
    const senseById = new Map(senseRes.rows.map((r) => [Number(r.id), r]));
    const exRes = await client.query(
      `SELECT DISTINCT ON (sense_id) sense_id AS "senseId", en, ru
       FROM dictionary_examples WHERE sense_id = ANY($1::int[])
       ORDER BY sense_id, is_main DESC, sort_order ASC`,
      [senseIds]
    );
    const exampleBySenseId = new Map(exRes.rows.map((r) => [Number(r.senseId), { en: r.en ?? "", ru: r.ru ?? "" }]));

    let created = 0;
    for (const row of missing) {
      const senseId = Number(row.senseId);
      const lemmaId = Number(row.lemmaId);
      const lem = lemmaById.get(lemmaId);
      const sen = senseById.get(senseId);
      if (!lem || !sen) continue;
      const ex = exampleBySenseId.get(senseId) || { en: "", ru: "" };
      const enVal = String(lem.lemma ?? "").trim().slice(0, 255);
      if (!enVal) continue;

      const entryRes = await client.query(
        `
        INSERT INTO dictionary_entries (language_id, en, ru, accent, level, frequency_rank, rarity, register, ipa_uk, ipa_us, example, example_ru)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (language_id, en) DO UPDATE SET
          ru = EXCLUDED.ru, level = EXCLUDED.level, register = EXCLUDED.register,
          frequency_rank = EXCLUDED.frequency_rank, rarity = EXCLUDED.rarity, accent = EXCLUDED.accent,
          ipa_uk = EXCLUDED.ipa_uk, ipa_us = EXCLUDED.ipa_us, example = EXCLUDED.example, example_ru = EXCLUDED.example_ru
        RETURNING id
        `,
        [
          languageId,
          enVal,
          String(sen.glossRu ?? "").slice(0, 255),
          String(lem.accent ?? "both"),
          String(sen.level ?? "A0"),
          Number(lem.frequencyRank) ?? 15000,
          String(lem.rarity ?? "не редкое"),
          String(sen.register ?? "разговорная"),
          String(lem.ipaUk ?? ""),
          String(lem.ipaUs ?? ""),
          String(ex.en ?? ""),
          String(ex.ru ?? ""),
        ]
      );
      const entryId = entryRes.rows[0]?.id;
      if (!entryId) continue;
      await client.query(
        `
        INSERT INTO dictionary_entry_links (entry_id, lemma_id, sense_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (entry_id) DO UPDATE SET lemma_id = EXCLUDED.lemma_id, sense_id = EXCLUDED.sense_id
        `,
        [entryId, lemmaId, senseId]
      );
      created++;
    }
    console.log(`Backfill complete: ${created} dictionary_entries + entry_links created.`);
  } finally {
    client.release();
  }
}

async function main() {
  const { lang, dryRun } = parseArgs();
  await backfill(lang, dryRun);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
