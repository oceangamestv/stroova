/**
 * Одноразовая миграция: перенос данных из users.personal_dictionary в user_saved_senses,
 * затем удаление колонки personal_dictionary. Запуск: node server/migrate-drop-personal-dictionary.mjs
 */
import "dotenv/config";
import { pool, initDb } from "./db.js";
import { ensureUserDictionaryBackfilled } from "./userDictionaryRepo.js";

async function run() {
  await initDb();
  const res = await pool.query("SELECT username FROM users");
  const usernames = res.rows.map((r) => r.username);
  console.log(`Backfilling user_saved_senses for ${usernames.length} user(s)...`);
  for (const username of usernames) {
    await ensureUserDictionaryBackfilled(username, "en");
  }
  console.log("Dropping column users.personal_dictionary...");
  await pool.query("ALTER TABLE users DROP COLUMN IF EXISTS personal_dictionary");
  console.log("Done.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
