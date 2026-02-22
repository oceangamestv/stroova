/**
 * Слово → безопасное имя файла для озвучки.
 * Совпадает с логикой в src/utils/sounds.ts и используется в generate-audio.mjs и audioAdminRepo.
 * @param {string} en — английское слово (или фраза)
 * @returns {string} slug (lowercase, пробелы → _, только a-z0-9_)
 */
export function wordToSlug(en) {
  return String(en)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
