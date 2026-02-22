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
        slugs.add(name.slice(0, -4));
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
  const words = wordsRes.rows;
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

  const missing = words.filter((w) => {
    const slug = wordToSlug(w.en);
    const hasF = femaleSlugs.has(slug);
    const hasM = maleSlugs.has(slug);
    return !hasF || !hasM;
  });

  return {
    updated,
    missingCount: missing.length,
    missing: missing.map((w) => ({
      id: w.id,
      en: w.en,
      slug: wordToSlug(w.en),
    })),
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
  const words = wordsRes.rows;
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

  const missing = words.filter((w) => {
    const slug = wordToSlug(w.en);
    return !femaleSlugs.has(slug) || !maleSlugs.has(slug);
  });

  return {
    updated,
    missingCount: missing.length,
    missing: missing.map((w) => ({
      id: w.id,
      en: w.en,
      slug: wordToSlug(w.en),
    })),
  };
}

/**
 * Список слов без озвучки (по текущим флагам в БД): хотя бы одна проверка выполнена и нет женского или нет мужского.
 * До первой проверки (все NULL) возвращаем пустой список.
 * @param {string} langCode
 * @returns {Promise<{ missing: Array<{ id: number, en: string, slug: string, hasFemale: boolean, hasMale: boolean }>, total: number }>}
 */
export async function getMissing(langCode) {
  const languageId = await getLanguageId(langCode);
  if (!languageId) return { missing: [], total: 0 };

  const r = await pool.query(
    `SELECT id, en,
            COALESCE(audio_has_female, false) AS "hasFemale",
            COALESCE(audio_has_male, false) AS "hasMale"
     FROM dictionary_entries
     WHERE language_id = $1
       AND (audio_has_female IS NOT NULL OR audio_has_male IS NOT NULL)
       AND (audio_has_female IS DISTINCT FROM true OR audio_has_male IS DISTINCT FROM true)
     ORDER BY id`,
    [languageId]
  );

  const missing = r.rows.map((row) => ({
    id: row.id,
    en: row.en,
    slug: wordToSlug(row.en),
    hasFemale: row.hasFemale,
    hasMale: row.hasMale,
  }));

  return { missing, total: missing.length };
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
