/**
 * Заполняет таблицу dictionary_entries словами английского.
 * Режимы:
 *   1) Из CSV: npm run seed (если есть server/data/dictionary_A0_A2_2000_unique_freq_register.csv)
 *      или: npm run seed -- <путь к CSV> / SEED_CSV_PATH=<путь> npm run seed
 *      CSV: id,language_id,en,ru,accent,level,frequency_rank,rarity,register,ipa_uk,ipa_us,example,example_ru
 *   2) Из TS-словарей: npm run seed (если CSV по умолчанию не найден)
 * Требует: DATABASE_URL в .env, таблицы уже созданы.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, initDb } from "./db.js";
import { updateDictionaryVersion, syncDictionaryV2FromEntries } from "./dictionaryRepo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.resolve(__dirname, "data", "dictionary_A0_A2_2000_unique_freq_register.csv");

const CSV_PATH =
  process.env.SEED_CSV_PATH ||
  process.argv[2] ||
  (fs.existsSync(DEFAULT_CSV) ? DEFAULT_CSV : null);

/** Парсит одну строку CSV с учётом полей в кавычках. */
function parseCsvLine(line) {
  const out = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === "," && !inQuotes) || (c === "\r" && !inQuotes)) {
      out.push(field.trim());
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  out.push(field.trim());
  return out;
}

/** Убирает BOM и нормализует заголовки CSV. */
function normalizeHeader(header) {
  return header.map((h) => String(h).replace(/^\uFEFF/, "").trim());
}

/** Читает CSV и возвращает массив объектов с ключами из заголовка. */
function loadCsv(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  let text = fs.readFileSync(abs, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = normalizeHeader(parseCsvLine(lines[0]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < header.length) continue;
    const row = {};
    header.forEach((h, j) => {
      row[h] = values[j] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

const DEFAULT_RARITY = "не редкое";
const DEFAULT_REGISTER = "разговорная";
const EN_LANGUAGE_ID = 1;

function normRarity(v) {
  const s = (v || "").trim();
  if (["не редкое", "редкое", "очень редкое"].includes(s)) return s;
  return DEFAULT_RARITY;
}

function normRegister(v) {
  const s = (v || "").trim();
  if (["официальная", "разговорная"].includes(s)) return s;
  return DEFAULT_REGISTER;
}

/** Проверяет, что строка похожа на настоящую IPA (есть символы вроде ə, ɔ, ɪ, ˈ). */
function hasRealIpa(str) {
  if (!str || !str.trim()) return false;
  return /[əɔɪʊɜːˈˌθðŋɑɒæʃʒʔɛʌ]/.test(str);
}

async function rebuildDefaultCollections(client) {
  await client.query(
    `
      INSERT INTO dictionary_collections (language_id, collection_key, title, description, level_from, level_to, is_public, sort_order)
      VALUES
        ($1, 'a0_basics', 'A0: База', 'Самые нужные слова для старта (частотные и простые).', 'A0', 'A0', TRUE, 10),
        ($1, 'a1_basics', 'A1: Следующий шаг', 'База для общения: хочу/могу/буду и т.п.', 'A1', 'A1', TRUE, 20),
        ($1, 'a2_basics', 'A2: Повседневное общение', 'Слова и фразы для уверенного общения на бытовые темы.', 'A2', 'A2', TRUE, 30)
      ON CONFLICT (language_id, collection_key) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        level_from = EXCLUDED.level_from,
        level_to = EXCLUDED.level_to,
        is_public = EXCLUDED.is_public,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `,
    [EN_LANGUAGE_ID]
  );

  const presets = [
    { key: "a0_basics", level: "A0", limit: 80 },
    { key: "a1_basics", level: "A1", limit: 80 },
    { key: "a2_basics", level: "A2", limit: 80 },
  ];

  for (const preset of presets) {
    const colRes = await client.query(
      `SELECT id FROM dictionary_collections WHERE language_id = $1 AND collection_key = $2 LIMIT 1`,
      [EN_LANGUAGE_ID, preset.key]
    );
    const collectionId = colRes.rows[0]?.id;
    if (!collectionId) continue;

    await client.query(`DELETE FROM dictionary_collection_items WHERE collection_id = $1`, [collectionId]);
    await client.query(
      `
        INSERT INTO dictionary_collection_items (collection_id, sense_id, sort_order)
        SELECT
          $1 AS collection_id,
          s.id AS sense_id,
          ROW_NUMBER() OVER (ORDER BY l.frequency_rank ASC, s.id ASC) - 1 AS sort_order
        FROM dictionary_senses s
        JOIN dictionary_lemmas l ON l.id = s.lemma_id
        WHERE l.language_id = $2
          AND s.sense_no = 1
          AND s.level = $3
        ORDER BY l.frequency_rank ASC, s.id ASC
        LIMIT $4
      `,
      [collectionId, EN_LANGUAGE_ID, preset.level, preset.limit]
    );
  }
}

async function finalizeSeed(client) {
  const version = await updateDictionaryVersion("en");
  console.log(`Версия словаря обновлена: ${version}`);

  try {
    await syncDictionaryV2FromEntries("en");
    console.log("Словарь v2 синхронизирован");
  } catch (e) {
    console.warn("Не удалось синхронизировать словарь v2:", e);
  }

  try {
    await rebuildDefaultCollections(client);
    console.log("Коллекции A0/A1/A2 пересобраны");
  } catch (e) {
    console.warn("Не удалось пересобрать коллекции A0/A1/A2:", e);
  }
}

async function seedFromCsv(client, filePath) {
  const { getIpaBoth } = await import("./lib/ipaGenerator.js");
  const rows = loadCsv(filePath);
  console.log(`  Загружено из CSV: ${rows.length} строк`);
  await client.query("DELETE FROM dictionary_entries WHERE language_id = 1");
  let inserted = 0;
  for (const r of rows) {
    const id = parseInt(r.id, 10);
    if (!Number.isFinite(id) || !r.en) continue;
    const rarity = normRarity(r.rarity);
    const register = normRegister(r.register);
    let ipaUk = (r.ipa_uk || "").trim();
    let ipaUs = (r.ipa_us || "").trim();
    if (!hasRealIpa(ipaUk) || !hasRealIpa(ipaUs)) {
      const generated = await getIpaBoth((r.en || "").trim());
      if (!hasRealIpa(ipaUk)) ipaUk = generated.ipaUk;
      if (!hasRealIpa(ipaUs)) ipaUs = generated.ipaUs;
    }
    await client.query(
      `INSERT INTO dictionary_entries (id, language_id, en, ru, accent, level, frequency_rank, rarity, register, ipa_uk, ipa_us, example, example_ru)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        (r.en || "").trim(),
        (r.ru || "").trim(),
        (r.accent || "both").trim(),
        (r.level || "A0").trim(),
        Number.isFinite(parseInt(r.frequency_rank, 10)) ? parseInt(r.frequency_rank, 10) : 15000,
        rarity,
        register,
        ipaUk,
        ipaUs,
        (r.example || "").trim(),
        (r.example_ru || "").trim(),
      ]
    );
    inserted++;
    if (inserted % 200 === 0) console.log(`  вставлено ${inserted}/${rows.length}`);
  }
  await client.query(
    "SELECT setval(pg_get_serial_sequence('dictionary_entries', 'id'), COALESCE((SELECT MAX(id) FROM dictionary_entries), 1))"
  );
  console.log(`  Вставлено: ${inserted} слов.`);
  
  await finalizeSeed(client);
  
  return inserted;
}

async function seedFromTs(client) {
  const { A0_DICTIONARY } = await import("../src/data/dictionary.ts");
  const { A1_DICTIONARY } = await import("../src/data/dictionary-a1.ts");
  const { A2_DICTIONARY } = await import("../src/data/dictionary-a2.ts");

  async function insertWords(words, levelLabel) {
    for (const w of words) {
      const rarity = w.rarity && ["не редкое", "редкое", "очень редкое"].includes(w.rarity) ? w.rarity : DEFAULT_RARITY;
      const register = w.register && ["официальная", "разговорная"].includes(w.register) ? w.register : DEFAULT_REGISTER;
      await client.query(
        `INSERT INTO dictionary_entries (id, language_id, en, ru, accent, level, frequency_rank, rarity, register, ipa_uk, ipa_us, example, example_ru)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (language_id, en) DO UPDATE SET
           ru = EXCLUDED.ru, accent = EXCLUDED.accent, level = EXCLUDED.level,
           frequency_rank = EXCLUDED.frequency_rank, rarity = EXCLUDED.rarity, register = EXCLUDED.register,
           ipa_uk = EXCLUDED.ipa_uk, ipa_us = EXCLUDED.ipa_us,
           example = EXCLUDED.example, example_ru = EXCLUDED.example_ru`,
        [
          w.id,
          w.en,
          w.ru,
          w.accent || "both",
          w.level || "A0",
          w.frequencyRank ?? 15000,
          rarity,
          register,
          w.ipaUk || "",
          w.ipaUs || "",
          w.example || "",
          w.exampleRu || "",
        ]
      );
    }
    console.log(`  ${levelLabel}: ${words.length} слов`);
  }

  console.log("Словарь (английский) из TS:");
  await client.query("DELETE FROM dictionary_entries WHERE language_id = 1");
  await insertWords(A0_DICTIONARY, "A0");
  await insertWords(A1_DICTIONARY, "A1");
  await insertWords(A2_DICTIONARY, "A2");
  await client.query(
    "SELECT setval(pg_get_serial_sequence('dictionary_entries', 'id'), COALESCE((SELECT MAX(id) FROM dictionary_entries), 1))"
  );
  const total = A0_DICTIONARY.length + A1_DICTIONARY.length + A2_DICTIONARY.length;
  console.log(`Итого: ${total} слов.`);
  
  await finalizeSeed(client);
}

async function seed() {
  await initDb();
  const client = await pool.connect();
  try {
    if (CSV_PATH) {
      console.log("Словарь (английский) из CSV:", CSV_PATH);
      await seedFromCsv(client, CSV_PATH);
    } else {
      await seedFromTs(client);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
