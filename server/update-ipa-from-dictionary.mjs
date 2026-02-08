/**
 * Обновляет поля ipa_uk и ipa_us в dictionary_entries по полю en,
 * генерируя IPA через phonemizer (en-gb / en-us).
 * Запуск: node server/update-ipa-from-dictionary.mjs
 * Требует: DATABASE_URL в .env
 */
import "dotenv/config";
import { pool, initDb } from "./db.js";
import { getIpaBoth } from "./lib/ipaGenerator.js";

async function updateIpaFromDictionary() {
  await initDb();
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, en FROM dictionary_entries WHERE language_id = 1 ORDER BY id`
    );
    const rows = res.rows;
    console.log(`Найдено слов: ${rows.length}`);

    let updated = 0;
    for (const row of rows) {
      const { ipaUk, ipaUs } = await getIpaBoth(row.en);
      await client.query(
        `UPDATE dictionary_entries SET ipa_uk = $1, ipa_us = $2 WHERE id = $3 AND language_id = 1`,
        [ipaUk, ipaUs, row.id]
      );
      updated++;
      if (updated % 100 === 0) console.log(`  обновлено ${updated}/${rows.length}`);
    }
    console.log(`Готово. Обновлено записей: ${updated}`);
  } finally {
    client.release();
    await pool.end();
  }
}

updateIpaFromDictionary().catch((err) => {
  console.error(err);
  process.exit(1);
});
