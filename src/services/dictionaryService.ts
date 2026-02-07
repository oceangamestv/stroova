import type { Accent, WordProgressType } from "../data/contracts/types";
import { getDictionary, getRandomWords, getWordsByAccent } from "../data/dictionary";
import { progressService } from "./progressService";
import { personalDictionaryService } from "./personalDictionaryService";

export type DictionarySource = "general" | "personal";

function filterByAccent(words: ReturnType<typeof getDictionary>, accent: Accent) {
  if (accent === "both") return words;
  return words.filter((w) => w.accent === accent || w.accent === "both");
}

export const dictionaryService = {
  getAllWords: getDictionary,
  getWordsByAccent,
  getRandomWords,

  /**
   * Слова для игры. source: «общий словарь» (все слова сайта) или «мой словарь».
   * Берутся только слова с прогрессом по заданному типу < 100% (если не keepLearnedWordsInGames).
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
