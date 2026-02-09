/**
 * Словари из БД: получение слов по языку.
 */

import crypto from "crypto";
import { pool } from "./db.js";

/**
 * @param {string} langCode — код языка (например 'en')
 * @param {{ accent?: string, level?: string }} [filters] — опционально: фильтр по акценту и/или уровню
 * @returns {Promise<Array<{ id: number, en: string, ru: string, accent: string, level: string, ipaUk: string, ipaUs: string, example: string, exampleRu: string }>>}
 */
export async function getWordsByLanguage(langCode, filters = {}) {
  const { accent, level } = filters;
  const langResult = await pool.query(
    "SELECT id FROM languages WHERE code = $1",
    [langCode]
  );
  if (langResult.rows.length === 0) return [];
  const languageId = langResult.rows[0].id;

  let sql = `
    SELECT id, en, ru, accent, level,
           frequency_rank AS "frequencyRank", rarity, register,
           ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu"
    FROM dictionary_entries
    WHERE language_id = $1
  `;
  const params = [languageId];
  let n = 2;
  if (level) {
    sql += ` AND level = $${n}`;
    params.push(level);
    n++;
  }
  if (accent && accent !== "both") {
    sql += ` AND (accent = $${n} OR accent = 'both')`;
    params.push(accent);
  }
  sql += " ORDER BY id";

  const res = await pool.query(sql, params);
  return res.rows;
}

/**
 * Список доступных языков.
 * @returns {Promise<Array<{ id: number, code: string, name: string }>>}
 */
export async function getLanguages() {
  const res = await pool.query("SELECT id, code, name FROM languages ORDER BY id");
  return res.rows;
}

/**
 * Id слов по языку и уровню (для личного словаря по умолчанию, например A0).
 * @param {string} langCode — код языка ('en')
 * @param {string} level — уровень ('A0', 'A1', …)
 * @returns {Promise<number[]>}
 */
export async function getWordIdsByLevel(langCode, level) {
  const langResult = await pool.query(
    "SELECT id FROM languages WHERE code = $1",
    [langCode]
  );
  if (langResult.rows.length === 0) return [];
  const languageId = langResult.rows[0].id;
  const res = await pool.query(
    "SELECT id FROM dictionary_entries WHERE language_id = $1 AND level = $2 ORDER BY id",
    [languageId, level]
  );
  return res.rows.map((r) => r.id);
}

/**
 * Получить версию словаря для проверки изменений.
 * Версия хранится в таблице languages и обновляется при изменении словаря.
 * @param {string} langCode — код языка (например 'en')
 * @returns {Promise<string>} — версия словаря
 */
export async function getDictionaryVersion(langCode) {
  const langResult = await pool.query(
    "SELECT version FROM languages WHERE code = $1",
    [langCode]
  );
  if (langResult.rows.length === 0) return "";
  return langResult.rows[0].version || "";
}

/**
 * Обновить версию словаря для данного языка.
 * Версия вычисляется как MAX(id) + COUNT(*) для быстрого определения изменений.
 * @param {string} langCode — код языка (например 'en')
 * @returns {Promise<string>} — новая версия словаря
 */
export async function updateDictionaryVersion(langCode) {
  const langResult = await pool.query(
    "SELECT id FROM languages WHERE code = $1",
    [langCode]
  );
  if (langResult.rows.length === 0) return "";
  const languageId = langResult.rows[0].id;
  
  // Быстрое вычисление версии: MAX(id) + COUNT(*)
  const res = await pool.query(
    `SELECT 
       COALESCE(MAX(id), 0) as max_id,
       COUNT(*) as count
     FROM dictionary_entries
     WHERE language_id = $1`,
    [languageId]
  );
  
  const maxId = res.rows[0].max_id || 0;
  const count = res.rows[0].count || 0;
  const version = `${maxId}_${count}`;
  
  // Сохраняем версию в таблице languages
  await pool.query(
    "UPDATE languages SET version = $1 WHERE code = $2",
    [version, langCode]
  );
  
  return version;
}
