import "dotenv/config";
import { pool } from "./db.js";

async function getCount(sql) {
  const res = await pool.query(sql);
  return Number(res.rows[0]?.c || 0);
}

async function main() {
  const out = {
    entries: await getCount("SELECT COUNT(*)::int AS c FROM dictionary_entries"),
    links: await getCount("SELECT COUNT(*)::int AS c FROM dictionary_entry_links"),
    lemmas: await getCount("SELECT COUNT(*)::int AS c FROM dictionary_lemmas"),
    senses: await getCount("SELECT COUNT(*)::int AS c FROM dictionary_senses"),
    saved: await getCount("SELECT COUNT(*)::int AS c FROM user_saved_senses"),
    a0Items: await getCount(
      "SELECT COUNT(*)::int AS c FROM dictionary_collection_items i JOIN dictionary_collections c ON c.id = i.collection_id WHERE c.collection_key = 'a0_basics'"
    ),
    a1Items: await getCount(
      "SELECT COUNT(*)::int AS c FROM dictionary_collection_items i JOIN dictionary_collections c ON c.id = i.collection_id WHERE c.collection_key = 'a1_basics'"
    ),
    a2Items: await getCount(
      "SELECT COUNT(*)::int AS c FROM dictionary_collection_items i JOIN dictionary_collections c ON c.id = i.collection_id WHERE c.collection_key = 'a2_basics'"
    ),
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error("Dictionary health check failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
