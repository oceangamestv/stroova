/**
 * После полного сброса словаря (npm run dictionary:reset) загружает 80 базовых слов A0,
 * синхронизирует v2 и заполняет коллекцию «A0: База».
 * Запуск: npm run seed:a0
 */
import "dotenv/config";
import { pool, initDb } from "./db.js";
import { updateDictionaryVersion, syncDictionaryV2FromEntries } from "./dictionaryRepo.js";

const LANGUAGE_ID = 1;

/** 80 самых актуальных слов A0: [en, ru] */
const A0_WORDS = [
  ["hello", "привет"],
  ["hi", "привет"],
  ["goodbye", "до свидания"],
  ["bye", "пока"],
  ["please", "пожалуйста"],
  ["thank you", "спасибо"],
  ["sorry", "извините"],
  ["okay", "хорошо"],
  ["I", "я"],
  ["you", "ты"],
  ["he", "он"],
  ["she", "она"],
  ["it", "оно"],
  ["we", "мы"],
  ["they", "они"],
  ["me", "мне"],
  ["my", "мой"],
  ["your", "твой"],
  ["his", "его"],
  ["her", "её"],
  ["our", "наш"],
  ["their", "их"],
  ["this", "это"],
  ["that", "то"],
  ["here", "здесь"],
  ["there", "там"],
  ["what", "что"],
  ["who", "кто"],
  ["where", "где"],
  ["when", "когда"],
  ["how", "как"],
  ["be", "быть"],
  ["have", "иметь"],
  ["do", "делать"],
  ["go", "идти"],
  ["come", "приходить"],
  ["like", "нравиться"],
  ["want", "хотеть"],
  ["need", "нуждаться"],
  ["see", "видеть"],
  ["hear", "слышать"],
  ["say", "говорить"],
  ["know", "знать"],
  ["understand", "понимать"],
  ["help", "помогать"],
  ["make", "делать"],
  ["one", "один"],
  ["two", "два"],
  ["three", "три"],
  ["four", "четыре"],
  ["five", "пять"],
  ["six", "шесть"],
  ["seven", "семь"],
  ["eight", "восемь"],
  ["nine", "девять"],
  ["ten", "десять"],
  ["day", "день"],
  ["night", "ночь"],
  ["morning", "утро"],
  ["evening", "вечер"],
  ["today", "сегодня"],
  ["tomorrow", "завтра"],
  ["name", "имя"],
  ["friend", "друг"],
  ["family", "семья"],
  ["mother", "мама"],
  ["father", "папа"],
  ["child", "ребёнок"],
  ["man", "мужчина"],
  ["woman", "женщина"],
  ["home", "дом"],
  ["school", "школа"],
  ["work", "работа"],
  ["city", "город"],
  ["water", "вода"],
  ["book", "книга"],
  ["good", "хороший"],
  ["bad", "плохой"],
  ["big", "большой"],
  ["small", "маленький"],
];

async function rebuildA0Collection(client) {
  const colRes = await client.query(
    `SELECT id FROM dictionary_collections WHERE language_id = $1 AND collection_key = 'a0_basics' LIMIT 1`,
    [LANGUAGE_ID]
  );
  const collectionId = colRes.rows[0]?.id;
  if (!collectionId) return;

  await client.query(`DELETE FROM dictionary_collection_items WHERE collection_id = $1`, [
    collectionId,
  ]);
  await client.query(
    `
      INSERT INTO dictionary_collection_items (collection_id, sense_id, sort_order)
      SELECT
        $1,
        s.id,
        ROW_NUMBER() OVER (ORDER BY l.frequency_rank ASC, s.id ASC) - 1
      FROM dictionary_senses s
      JOIN dictionary_lemmas l ON l.id = s.lemma_id
      WHERE l.language_id = $2 AND s.sense_no = 1 AND s.level = 'A0'
      ORDER BY l.frequency_rank ASC, s.id ASC
      LIMIT 80
    `,
    [collectionId, LANGUAGE_ID]
  );
}

async function main() {
  await initDb();
  const client = await pool.connect();
  try {
    let rank = 1;
    for (const [en, ru] of A0_WORDS) {
      await client.query(
        `INSERT INTO dictionary_entries (language_id, en, ru, accent, level, frequency_rank, rarity, register, ipa_uk, ipa_us, example, example_ru)
         VALUES ($1, $2, $3, 'both', 'A0', $4, 'не редкое', 'разговорная', '', '', '', '')`,
        [LANGUAGE_ID, en.trim(), ru.trim(), rank++]
      );
    }
    console.log(`Вставлено слов A0: ${A0_WORDS.length}`);

    await client.query(
      "SELECT setval(pg_get_serial_sequence('dictionary_entries', 'id'), COALESCE((SELECT MAX(id) FROM dictionary_entries), 1))"
    );

    await syncDictionaryV2FromEntries("en");
    console.log("Словарь v2 синхронизирован");

    await rebuildA0Collection(client);
    console.log("Коллекция A0: База заполнена");

    const version = await updateDictionaryVersion("en");
    console.log(`Версия словаря: ${version}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed A0 failed:", err);
  process.exit(1);
});
