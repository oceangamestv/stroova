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
