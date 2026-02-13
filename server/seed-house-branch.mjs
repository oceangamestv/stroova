/**
 * Заполняет ветку слова House: связи (home, flat, apartment, building),
 * коллокации, формы (plural), шаблоны употребления.
 * Запуск: node server/seed-house-branch.mjs (после seed словаря).
 * Требует: DATABASE_URL, таблицы dictionary_lemmas/senses/links/collocations/forms/usage_patterns.
 */
import "dotenv/config";
import { pool } from "./db.js";

const LANG_ID = 1; // en

async function getLemmaId(client, lemmaKey) {
  const r = await client.query(
    "SELECT id FROM dictionary_lemmas WHERE language_id = $1 AND lemma_key = $2 LIMIT 1",
    [LANG_ID, String(lemmaKey).trim().toLowerCase()]
  );
  return r.rows[0]?.id ?? null;
}

async function getSenseId(client, lemmaId, senseNo = 1) {
  const r = await client.query(
    "SELECT id FROM dictionary_senses WHERE lemma_id = $1 AND sense_no = $2 LIMIT 1",
    [lemmaId, senseNo]
  );
  return r.rows[0]?.id ?? null;
}

async function run() {
  const client = await pool.connect();
  try {
    const houseId = await getLemmaId(client, "house");
    if (!houseId) {
      console.log("Лемма 'house' не найдена. Сначала выполните seed словаря (npm run seed).");
      process.exit(1);
    }

    const homeId = await getLemmaId(client, "home");
    const flatId = await getLemmaId(client, "flat");
    const apartmentId = await getLemmaId(client, "apartment");
    const buildingId = await getLemmaId(client, "building");

    // ——— Формы ———
    await client.query(
      `INSERT INTO dictionary_forms (lemma_id, form, form_type, is_irregular, notes)
       VALUES ($1, 'houses', 'plural', false, '')
       ON CONFLICT (lemma_id, form, form_type) DO NOTHING`,
      [houseId]
    );
    console.log("  Формы: houses (plural)");

    // ——— Связи (навигатор): только если ещё нет — в схеме нет UNIQUE ———
    const links = [
      [homeId, "related", "дом, место где живёшь", 10],
      [flatId, "related", "квартира (брит.)", 9],
      [apartmentId, "related", "квартира (амер.)", 9],
      [buildingId, "related", "здание, постройка", 8],
    ];
    const existingLinks = await client.query(
      "SELECT to_lemma_id FROM dictionary_links WHERE from_lemma_id = $1",
      [houseId]
    );
    const existingTo = new Set((existingLinks.rows || []).map((r) => r.to_lemma_id));
    for (const [toId, linkType, noteRu, rank] of links) {
      if (!toId || existingTo.has(toId)) continue;
      await client.query(
        `INSERT INTO dictionary_links (language_id, from_lemma_id, to_lemma_id, link_type, note_ru, rank)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [LANG_ID, houseId, toId, linkType, noteRu, rank]
      );
      existingTo.add(toId);
    }
    console.log("  Связи: home, flat, apartment, building");

    // ——— Коллокации (идемпотентно: удаляем старые по lemma, затем вставляем) ———
    await client.query("DELETE FROM dictionary_collocations WHERE lemma_id = $1", [houseId]);
    const collocations = [
      ["house party", "вечеринка на дому", "A1", "разговорная", "We had a house party.", "Мы устроили вечеринку дома.", 1],
      ["clean the house", "убраться в доме", "A0", "разговорная", "I clean the house on Saturdays.", "Я убираюсь по субботам.", 2],
      ["house and garden", "дом и сад", "A1", "разговорная", "They have a house and garden.", "У них дом с садом.", 3],
      ["move house", "переехать", "A1", "разговорная", "We moved house last year.", "Мы переехали в прошлом году.", 4],
      ["house arrest", "домашний арест", "B2", "официальная", "He was under house arrest.", "Он был под домашним арестом.", 5],
      ["full house", "аншлаг; полный дом", "B1", "разговорная", "The theatre was full house.", "В театре был аншлаг.", 6],
    ];
    for (const [phraseEn, glossRu, level, register, exampleEn, exampleRu, sortOrder] of collocations) {
      await client.query(
        `INSERT INTO dictionary_collocations (language_id, lemma_id, phrase_en, gloss_ru, level, register, example_en, example_ru, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [LANG_ID, houseId, phraseEn, glossRu, level, register, exampleEn, exampleRu, sortOrder]
      );
    }
    console.log("  Коллокации: 6 фраз");
    // ——— Шаблоны употребления (usage patterns) для sense #1 ———
    const sense1Id = await getSenseId(client, houseId, 1);
    if (sense1Id) {
      await client.query("DELETE FROM dictionary_usage_patterns WHERE sense_id = $1", [sense1Id]);
      const patterns = [
        ["present", "This is my house.", "Это мой дом."],
        ["location", "I live in a small house.", "Я живу в маленьком доме."],
        ["plural", "There are many houses in the street.", "На улице много домов."],
      ];
      for (let i = 0; i < patterns.length; i++) {
        const [tag, en, ru] = patterns[i];
        await client.query(
          `INSERT INTO dictionary_usage_patterns (sense_id, tag, en, ru, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [sense1Id, tag, en, ru, i]
        );
      }
      console.log("  Шаблоны: 3 примера употребления");
    }

    // Второй смысл house (театр / палата) — чтобы в Advanced было «ещё значения»
    const senseCount = await client.query(
      "SELECT COUNT(*)::int AS c FROM dictionary_senses WHERE lemma_id = $1",
      [houseId]
    );
    if (senseCount.rows[0]?.c === 1) {
      await client.query(
        `INSERT INTO dictionary_senses (lemma_id, sense_no, level, register, gloss_ru, definition_ru, usage_note)
         VALUES ($1, 2, 'B1', 'официальная', 'здание; палата (парламент); театр (полный зал)', 'Второе значение: здание учреждения, палата парламента или аншлаг в театре.', 'Часто в сочетаниях: the House of Commons, full house.')
         ON CONFLICT (lemma_id, sense_no) DO NOTHING`,
        [houseId]
      );
      console.log("  Добавлен смысл #2: здание / палата / театр");
    }

    console.log("Ветка House заполнена.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
