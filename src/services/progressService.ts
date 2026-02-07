import type { WordProgressByType, WordProgressMap, WordProgressType } from "../data/contracts/types";
import { authAdapter } from "../data/adapters/authAdapter";

const STEP = 1;

function isLegacyProgress(
  raw: WordProgressMap | Record<number, number> | undefined
): raw is Record<number, number> {
  if (!raw || typeof raw !== "object") return false;
  const firstKey = Object.keys(raw)[0];
  if (firstKey === undefined) return false;
  const val = (raw as Record<number, number>)[Number(firstKey)];
  return typeof val === "number";
}

function normalizeWordProgress(
  raw: WordProgressMap | Record<number, number> | undefined
): WordProgressMap {
  if (!raw || typeof raw !== "object") return {};
  if (!isLegacyProgress(raw)) return raw as WordProgressMap;
  const result: WordProgressMap = {};
  Object.entries(raw as Record<number, number>).forEach(([idStr, value]) => {
    const id = Number(idStr);
    if (Number.isFinite(id) && typeof value === "number") {
      result[id] = { beginner: Math.max(0, Math.min(100, value)) };
    }
  });
  return result;
}

function ensureModernProgress(
  user: { wordProgress?: WordProgressMap | Record<number, number> },
  users: Record<string, unknown>,
  save: () => void
) {
  if (!user.wordProgress || !isLegacyProgress(user.wordProgress)) return;
  user.wordProgress = normalizeWordProgress(user.wordProgress);
  save();
}

export const progressService = {
  /** Возвращает нормализованный прогресс по всем словам (миграция старых number → { beginner } с сохранением). */
  getWordProgress(): WordProgressMap {
    const session = authAdapter.getSession();
    if (!session) return {};
    const users = authAdapter.getUsers();
    const user = users[session.username];
    if (!user) return {};
    ensureModernProgress(user, users, () => authAdapter.saveUsers(users));
    return (user.wordProgress as WordProgressMap) || {};
  },

  /** Значение прогресса по слову. type — тип трека; без type возвращает beginner (для обратной совместимости). */
  getWordProgressValue(wordId: number, type: WordProgressType = "beginner"): number {
    const progress = this.getWordProgress();
    const byType = progress[wordId];
    if (!byType) return 0;
    const value = byType[type];
    return typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
  },

  /** Обновить прогресс слова по указанному типу (начисляет опыт игры этого типа). */
  updateWordProgress(wordId: number, isCorrect: boolean, progressType: WordProgressType) {
    const session = authAdapter.getSession();
    if (!session) return;
    const users = authAdapter.getUsers();
    const user = users[session.username];
    if (!user) return;
    ensureModernProgress(user, users, () => authAdapter.saveUsers(users));
    const map = user.wordProgress as WordProgressMap;
    map[wordId] = map[wordId] || {};
    const current = map[wordId][progressType] ?? 0;
    const next = isCorrect
      ? Math.min(100, current + STEP)
      : Math.max(0, current - STEP);
    map[wordId][progressType] = next;
    authAdapter.saveUsers(users);
  },

  resetWordProgress(wordId: number) {
    const session = authAdapter.getSession();
    if (!session) return;
    const users = authAdapter.getUsers();
    const user = users[session.username];
    if (!user) return;
    ensureModernProgress(user, users, () => authAdapter.saveUsers(users));
    const map = user.wordProgress as WordProgressMap;
    map[wordId] = { beginner: 0, experienced: 0, expert: 0 };
    authAdapter.saveUsers(users);
  },

  /** Отметить слово как изученное: 100% по начинающему и опытному (эксперт заложен на будущее). */
  setWordAsKnown(wordId: number) {
    const session = authAdapter.getSession();
    if (!session) return;
    const users = authAdapter.getUsers();
    const user = users[session.username];
    if (!user) return;
    ensureModernProgress(user, users, () => authAdapter.saveUsers(users));
    const map = user.wordProgress as WordProgressMap;
    map[wordId] = { ...map[wordId], beginner: 100, experienced: 100, expert: 100 };
    authAdapter.saveUsers(users);
  },

  /**
   * Слово доступно для игры с данным типом опыта, если прогресс по этому типу < 100%.
   * Если у пользователя включено keepLearnedWordsInGames — всегда true (закладка на будущее).
   */
  isWordAvailableForGame(wordId: number, progressType: WordProgressType): boolean {
    const user = authAdapter.getSession() && authAdapter.getUsers()[authAdapter.getSession()!.username];
    if (user?.gameSettings?.keepLearnedWordsInGames) return true;
    return this.getWordProgressValue(wordId, progressType) < 100;
  },

  /** Слово считается изученным, когда и начинающий, и опытный треки = 100%. */
  isWordLearned(wordId: number): boolean {
    return (
      this.getWordProgressValue(wordId, "beginner") === 100 &&
      this.getWordProgressValue(wordId, "experienced") === 100
    );
  },
};
