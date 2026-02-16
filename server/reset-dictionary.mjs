/**
 * Полный сброс словарных данных без удаления пользователей.
 * Очищает только dictionary/user-dictionary таблицы и legacy словарные поля у users.
 */
import "dotenv/config";
import { pool, initDb } from "./db.js";
import { updateDictionaryVersion } from "./dictionaryRepo.js";

async function resetDictionaryData() {
  await initDb();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
        TRUNCATE TABLE
          user_daily_highlights,
          dictionary_ai_suggestions,
          dictionary_audit_log,
          dictionary_collection_items,
          dictionary_usage_patterns,
          dictionary_collocations,
          dictionary_links,
          user_collection_state,
          user_sense_progress,
          user_saved_senses,
          dictionary_examples,
          dictionary_forms,
          dictionary_entry_links,
          dictionary_senses,
          dictionary_lemmas,
          dictionary_collections,
          dictionary_entries
        RESTART IDENTITY CASCADE
      `
    );

    await client.query("UPDATE users SET word_progress = '{}'::jsonb");
    await client.query("UPDATE languages SET version = NULL WHERE code = 'en'");
    await client.query("COMMIT");

    const version = await updateDictionaryVersion("en");
    console.log("Словарные данные очищены (пользователи сохранены).");
    console.log(`Текущая версия словаря: ${version || "<empty>"}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

resetDictionaryData().catch((err) => {
  console.error("Dictionary reset failed:", err);
  process.exit(1);
});
