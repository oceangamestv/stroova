/**
 * Админка озвучки: проверка каталогов, обновление флагов в dictionary_entries, выборка слов без озвучки.
 */

import fs from "fs";
import path from "path";
import { pool } from "./db.js";
import { wordToSlug } from "./audioSlug.js";

const AUDIO_BASE =
  process.env.AUDIO_DIR || path.join(process.cwd(), "public", "audio");
const FEMALE_DIR = path.join(AUDIO_BASE, "female");
const MALE_DIR = path.join(AUDIO_BASE, "male");

/**
 * Читает имена файлов .wav из каталога, возвращает множество slug (без .wav).
 * Имена файлов нормализуются через wordToSlug, чтобы совпадать с slug слов из БД
 * (регистр, пробелы → _, лишние символы — иначе "Hello.wav" не совпадал бы с словом "hello").
 * @param {string} dirPath
 * @returns {Set<string>}
 */
function readSlugsFromDir(dirPath) {
  const slugs = new Set();
  if (!fs.existsSync(dirPath)) return slugs;
  try {
    const names = fs.readdirSync(dirPath);
    for (const name of names) {
      if (name.endsWith(".wav")) {
        const raw = name.slice(0, -4);
        slugs.add(wordToSlug(raw));
      }
    }
  } catch (err) {
    console.warn("audioAdminRepo: readDir", dirPath, err.message);
  }
  return slugs;
}

/**
 * @returns {{ female: Set<string>, male: Set<string> }}
 */
function readSlugsFromDisk() {
  return {
    female: readSlugsFromDir(FEMALE_DIR),
    male: readSlugsFromDir(MALE_DIR),
  };
}

/**
 * @param {string} langCode
 * @returns {Promise<number>} language id
 */
async function getLanguageId(langCode) {
  const r = await pool.query("SELECT id FROM languages WHERE code = $1", [
    langCode,
  ]);
  return r.rows.length ? r.rows[0].id : 0;
}

/**
 * Все уникальные строки en, для которых может запрашиваться озвучка: из dictionary_entries и из dictionary_form_cards.
 * @param {number} languageId
 * @returns {Promise<Array<{ en: string, source: 'entry'|'form' }>>}
 */
async function getAllEnForAudio(languageId) {
  const entriesRes = await pool.query(
    "SELECT en FROM dictionary_entries WHERE language_id = $1",
    [languageId]
  );
  const bySlug = new Map();
  for (const row of entriesRes.rows) {
    const en = String(row.en != null ? row.en : "").trim();
    if (!en) continue;
    const slug = wordToSlug(en);
    if (!bySlug.has(slug)) bySlug.set(slug, { en, source: "entry" });
  }
  try {
    const formsRes = await pool.query(
      `SELECT DISTINCT fc.en
       FROM dictionary_form_cards fc
       JOIN dictionary_entries e ON e.id = fc.entry_id
       WHERE e.language_id = $1 AND fc.en IS NOT NULL AND LENGTH(TRIM(COALESCE(fc.en, ''))) > 0`,
      [languageId]
    );
    for (const row of formsRes.rows) {
      const en = String(row.en != null ? row.en : "").trim();
      if (!en) continue;
      const slug = wordToSlug(en);
      if (!bySlug.has(slug)) bySlug.set(slug, { en, source: "form" });
    }
  } catch (err) {
    console.warn("audioAdminRepo: getAllEnForAudio forms query failed, using entries only:", err.message);
  }
  return Array.from(bySlug.values());
}

/**
 * Полная проверка: обновить флаги у всех слов по языку.
 * @param {string} langCode
 * @returns {Promise<{ updated: number, missingCount: number, missing: Array<{ id: number, en: string, slug: string }> }>}
 */
export async function runFullCheck(langCode) {
  const languageId = await getLanguageId(langCode);
  if (!languageId) return { updated: 0, missingCount: 0, missing: [] };

  const wordsRes = await pool.query(
    "SELECT id, en FROM dictionary_entries WHERE language_id = $1 ORDER BY id",
    [languageId]
  );
  const words = wordsRes.rows || [];
  const { female: femaleSlugs, male: maleSlugs } = readSlugsFromDisk();

  let updated = 0;
  const BATCH = 200;
  for (let i = 0; i < words.length; i += BATCH) {
    const batch = words.slice(i, i + BATCH);
    for (const w of batch) {
      const slug = wordToSlug(w.en);
      const hasFemale = femaleSlugs.has(slug);
      const hasMale = maleSlugs.has(slug);
      await pool.query(
        "UPDATE dictionary_entries SET audio_has_female = $1, audio_has_male = $2 WHERE id = $3",
        [hasFemale, hasMale, w.id]
      );
      updated++;
    }
  }

  const allEn = await getAllEnForAudio(languageId);
  const missing = allEn.filter(({ en }) => {
    const slug = wordToSlug(en);
    const hasF = femaleSlugs.has(slug);
    const hasM = maleSlugs.has(slug);
    return !hasF || !hasM;
  });

  const debug = {
    wordsTotal: words.length,
    formsEnTotal: allEn.length,
    fileCountFemale: femaleSlugs.size,
    fileCountMale: maleSlugs.size,
  };
  if (process.env.NODE_ENV !== "production") {
    console.log("[audio check-full]", debug);
  }

  const entryIdBySlug = new Map(words.map((w) => [wordToSlug(w.en != null ? w.en : ""), w.id]));
  return {
    updated,
    missingCount: missing.length,
    missing: missing.map(({ en, source }) => ({
      id: entryIdBySlug.get(wordToSlug(en)) ?? null,
      en,
      slug: wordToSlug(en),
      source,
    })),
    debug,
  };
}

/**
 * Проверка только слов без проставленных флагов (оба NULL).
 * @param {string} langCode
 * @returns {Promise<{ updated: number, missingCount: number, missing: Array<{ id: number, en: string, slug: string }> }>}
 */
export async function runNewWordsCheck(langCode) {
  const languageId = await getLanguageId(langCode);
  if (!languageId) return { updated: 0, missingCount: 0, missing: [] };

  const wordsRes = await pool.query(
    `SELECT id, en FROM dictionary_entries
     WHERE language_id = $1 AND audio_has_female IS NULL AND audio_has_male IS NULL
     ORDER BY id`,
    [languageId]
  );
  const words = wordsRes.rows || [];
  const { female: femaleSlugs, male: maleSlugs } = readSlugsFromDisk();

  let updated = 0;
  for (const w of words) {
    const slug = wordToSlug(w.en);
    const hasFemale = femaleSlugs.has(slug);
    const hasMale = maleSlugs.has(slug);
    await pool.query(
      "UPDATE dictionary_entries SET audio_has_female = $1, audio_has_male = $2 WHERE id = $3",
      [hasFemale, hasMale, w.id]
    );
    updated++;
  }

  const allEn = await getAllEnForAudio(languageId);
  const missing = allEn.filter(({ en }) => {
    const slug = wordToSlug(en);
    return !femaleSlugs.has(slug) || !maleSlugs.has(slug);
  });

  const debug = {
    wordsChecked: words.length,
    formsEnTotal: allEn.length,
    fileCountFemale: femaleSlugs.size,
    fileCountMale: maleSlugs.size,
  };
  if (process.env.NODE_ENV !== "production") {
    console.log("[audio check-new]", debug);
  }

  const entryWords = await pool.query(
    "SELECT id, en FROM dictionary_entries WHERE language_id = $1",
    [languageId]
  );
  const entryBySlug = new Map((entryWords.rows || []).map((w) => [wordToSlug(w.en != null ? w.en : ""), w]));

  return {
    updated,
    missingCount: missing.length,
    missing: missing.map(({ en, source }) => ({
      id: entryBySlug.get(wordToSlug(en))?.id ?? null,
      en,
      slug: wordToSlug(en),
      source,
    })),
    debug,
  };
}

/**
 * Список всех en без озвучки: слова (entries) + формы (form_cards). Проверка по диску.
 * @param {string} langCode
 * @returns {Promise<{ missing: Array<{ id: number|null, en: string, slug: string, hasFemale: boolean, hasMale: boolean }>, total: number }>}
 */
export async function getMissing(langCode) {
  try {
    const languageId = await getLanguageId(langCode);
    if (!languageId) return { missing: [], total: 0 };

    const allEn = await getAllEnForAudio(languageId);
    const { female: femaleSlugs, male: maleSlugs } = readSlugsFromDisk();

    const entriesRes = await pool.query(
      "SELECT id, en FROM dictionary_entries WHERE language_id = $1",
      [languageId]
    );
    const entryIdBySlug = new Map(
      (entriesRes.rows || []).map((w) => [wordToSlug(w.en != null ? w.en : ""), w.id])
    );

    const missing = [];
    for (const { en, source } of allEn) {
      const slug = wordToSlug(en);
      const hasFemale = femaleSlugs.has(slug);
      const hasMale = maleSlugs.has(slug);
      if (hasFemale && hasMale) continue;
      missing.push({
        id: entryIdBySlug.get(slug) ?? null,
        en,
        slug,
        hasFemale,
        hasMale,
        source,
      });
    }
    missing.sort((a, b) => String(a.en).localeCompare(String(b.en)));

    return { missing, total: missing.length };
  } catch (err) {
    console.error("audioAdminRepo: getMissing failed:", err);
    return { missing: [], total: 0 };
  }
}

/**
 * Данные для экспорта в JSON (формат для generate-audio.mjs).
 * @param {string} langCode
 * @returns {Promise<{ words: Array<{ en: string, slug: string }> }>}
 */
export async function getMissingExport(langCode) {
  const { missing } = await getMissing(langCode);
  return {
    words: missing.map((m) => ({ en: m.en, slug: m.slug })),
  };
}
