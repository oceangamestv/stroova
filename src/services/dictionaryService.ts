import type { Accent, WordProgressType } from "../data/contracts/types";
import type { Word } from "../data/contracts/types";
import { getDictionary, getRandomWords, getWordsByAccent } from "../data/dictionary";
import { progressService } from "./progressService";
import { personalDictionaryService } from "./personalDictionaryService";

export type DictionarySource = "general" | "personal";

function filterByAccent(words: Word[], accent: Accent) {
  if (accent === "both") return words;
  return words.filter((w) => w.accent === accent || w.accent === "both");
}

export const dictionaryService = {
  getAllWords: getDictionary,
  getWordsByAccent,
  getRandomWords,

  /** Случайные слова из переданного пула (словарь из API). */
  getRandomWordsFromPool(words: Word[], count: number, accent: Accent = "both"): Word[] {
    const byAccent = filterByAccent(words, accent);
    const shuffled = [...byAccent].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  },

  /**
   * Слова для игры из переданного пула. source: «общий словарь» или «мой словарь».
   * Для гостей (guestMode: true) при source "general" используются только слова уровня A0.
   */
  getRandomWordsForGameFromPool(
    pool: Word[],
    count: number,
    accent: Accent = "both",
    progressType: WordProgressType = "beginner",
    source: DictionarySource = "general",
    options?: { guestMode?: boolean }
  ): Word[] {
    let words =
      source === "personal"
        ? personalDictionaryService.getPersonalWordsFromPool(pool)
        : pool;
    if (options?.guestMode && source === "general") {
      words = words.filter((w) => w.level === "A0");
    }
    const byAccent = filterByAccent(words, accent);
    const filtered = byAccent.filter((w) =>
      progressService.isWordAvailableForGame(w.id, progressType)
    );
    const available = filtered.length > 0 ? filtered : byAccent;
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  },

  /**
   * Слова для игры (использует статический словарь — для обратной совместимости).
   */
  getRandomWordsForGame(
    count: number,
    accent: Accent = "both",
    progressType: WordProgressType = "beginner",
    source: DictionarySource = "general"
  ) {
    const pool =
      source === "personal"
        ? personalDictionaryService.getPersonalWords()
        : getDictionary();
    const byAccent = filterByAccent(pool, accent);
    const words = byAccent.filter((w) =>
      progressService.isWordAvailableForGame(w.id, progressType)
    );
    const available = words.length > 0 ? words : byAccent;
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  },
};
