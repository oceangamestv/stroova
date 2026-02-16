import type { Word } from "../data/contracts/types";
import { getWordsByIds } from "../data/dictionary";
import { authAdapter } from "../data/adapters/authAdapter";

function getPersonalWordIds(): number[] {
  const session = authAdapter.getSession();
  if (!session) return [];
  const users = authAdapter.getUsers();
  const user = users[session.username];
  const ids = user?.personalDictionary;
  return Array.isArray(ids) ? [...ids] : [];
}

export const personalDictionaryService = {
  getPersonalWordIds,

  getPersonalWords(): Word[] {
    return getWordsByIds(getPersonalWordIds());
  },

  /** Слова из «Моего словаря» по переданному пулу (словарь из API). */
  getPersonalWordsFromPool(allWords: Word[]): Word[] {
    const ids = getPersonalWordIds();
    const set = new Set(ids);
    return allWords.filter((w) => set.has(w.id));
  },

  isInPersonal(wordId: number): boolean {
    return getPersonalWordIds().includes(wordId);
  },
};
