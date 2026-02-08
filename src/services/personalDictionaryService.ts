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

function setPersonalWordIds(ids: number[]) {
  const session = authAdapter.getSession();
  if (!session) return;
  const users = authAdapter.getUsers();
  const user = users[session.username];
  if (!user) return;
  user.personalDictionary = ids;
  authAdapter.saveUsers(users);
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

  addWord(wordId: number): void {
    const session = authAdapter.getSession();
    if (!session) return;
    const users = authAdapter.getUsers();
    const user = users[session.username];
    if (!user) return;
    const existing = Array.isArray(user.personalDictionary)
      ? [...user.personalDictionary]
      : [];
    if (existing.includes(wordId)) return;
    user.personalDictionary = [...existing, wordId];
    authAdapter.saveUsers(users);
  },

  removeWord(wordId: number): void {
    const session = authAdapter.getSession();
    if (!session) return;
    const users = authAdapter.getUsers();
    const user = users[session.username];
    if (!user) return;
    const existing = Array.isArray(user.personalDictionary)
      ? [...user.personalDictionary]
      : [];
    user.personalDictionary = existing.filter((id) => id !== wordId);
    authAdapter.saveUsers(users);
  },
};
