/**
 * Генерация IPA-транскрипции для английских слов (UK/US).
 * Использует phonemizer (eSpeak NG).
 */

import { phonemize } from "phonemizer";

/**
 * Форматирует результат phonemize в строку вида "/.../"
 * @param {string} word — слово для отображения при ошибке
 * @param {string[]|string} result — результат phonemize
 * @returns {string}
 */
function formatIpa(word, result) {
  const ipa = Array.isArray(result) ? result[0] : result;
  if (ipa && typeof ipa === "string") {
    const trimmed = ipa.trim();
    if (trimmed) return `/${trimmed}/`;
  }
  return `/${word}/`;
}

/**
 * IPA для британского произношения (en-gb).
 * @param {string} word — английское слово или фраза
 * @returns {Promise<string>} строка вида "/həlˈəʊ/"
 */
export async function getIpaUk(word) {
  const w = (word || "").trim();
  if (!w) return "//";
  try {
    const result = await phonemize(w, "en-gb");
    return formatIpa(w, result);
  } catch (err) {
    return `/${w}/`;
  }
}

/**
 * IPA для американского произношения (en-us).
 * @param {string} word — английское слово или фраза
 * @returns {Promise<string>} строка вида "/hoʊˈloʊ/"
 */
export async function getIpaUs(word) {
  const w = (word || "").trim();
  if (!w) return "//";
  try {
    const result = await phonemize(w, "en-us");
    return formatIpa(w, result);
  } catch (err) {
    return `/${w}/`;
  }
}

/**
 * Обе транскрипции за один вызов (меньше накладных расходов при пакетной обработке).
 * @param {string} word
 * @returns {Promise<{ ipaUk: string, ipaUs: string }>}
 */
export async function getIpaBoth(word) {
  const w = (word || "").trim();
  if (!w) return { ipaUk: "//", ipaUs: "//" };
  try {
    const [uk, us] = await Promise.all([
      phonemize(w, "en-gb"),
      phonemize(w, "en-us"),
    ]);
    return {
      ipaUk: formatIpa(w, uk),
      ipaUs: formatIpa(w, us),
    };
  } catch (err) {
    return { ipaUk: `/${w}/`, ipaUs: `/${w}/` };
  }
}
