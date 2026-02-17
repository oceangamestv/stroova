/**
 * Результаты игр, пройденных гостем до входа/регистрации.
 * Сохраняются в sessionStorage и применяются к аккаунту после логина/регистрации.
 */

import type { WordProgressMap, WordProgressType } from "../data/contracts/types";
import { authAdapter } from "../data/adapters/authAdapter";
import { authService } from "./authService";

const STORAGE_KEY = "guestPendingResult";

export type PendingWordUpdate = {
  wordId: number;
  progressType: WordProgressType;
  progressValue: number;
};

type PendingGuestResult = {
  totalXp: number;
  exercisesCompleted: number;
  pairsCompleted: number;
  puzzlesCompleted: number;
  bestScore: number;
  xpByDate: Record<string, number>;
  wordProgress: WordProgressMap;
};

const emptyPending = (): PendingGuestResult => ({
  totalXp: 0,
  exercisesCompleted: 0,
  pairsCompleted: 0,
  puzzlesCompleted: 0,
  bestScore: 0,
  xpByDate: {},
  wordProgress: {},
});

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadPending(): PendingGuestResult | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PendingGuestResult;
    return {
      ...emptyPending(),
      ...data,
      wordProgress: data.wordProgress && typeof data.wordProgress === "object" ? data.wordProgress : {},
      xpByDate: data.xpByDate && typeof data.xpByDate === "object" ? data.xpByDate : {},
    };
  } catch {
    return null;
  }
}

function savePending(pending: PendingGuestResult): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch (e) {
    console.warn("guestPendingResult: failed to save", e);
  }
}

function mergeWordProgress(
  current: WordProgressMap,
  updates: PendingWordUpdate[]
): WordProgressMap {
  const next: WordProgressMap = {};
  for (const id of Object.keys(current)) {
    next[Number(id)] = { ...(current[Number(id)] ?? {}) };
  }
  for (const { wordId, progressType, progressValue } of updates) {
    const existing = next[wordId] ?? {};
    const existingVal = existing[progressType] ?? 0;
    const val = Math.max(existingVal, Math.min(100, Math.max(0, progressValue)));
    next[wordId] = { ...existing, [progressType]: val };
  }
  return next;
}

export const guestPendingResultService = {
  getPending(): PendingGuestResult | null {
    return loadPending();
  },

  /**
   * Добавить результат одной игры (гость). Можно вызывать несколько раз до входа — результаты суммируются.
   */
  addGameResult(
    gameType: "pairs" | "puzzle" | "danetka" | "one-of-three" | "gates-of-knowledge",
    earnedXp: number,
    wordUpdates: PendingWordUpdate[]
  ): void {
    const pending = loadPending() ?? emptyPending();
    const today = getToday();

    pending.totalXp += earnedXp;
    pending.exercisesCompleted += 1;
    if (gameType === "pairs") pending.pairsCompleted += 1;
    else if (gameType === "puzzle") pending.puzzlesCompleted += 1;
    pending.bestScore = Math.max(pending.bestScore, earnedXp);
    pending.xpByDate[today] = (pending.xpByDate[today] ?? 0) + earnedXp;
    pending.wordProgress = mergeWordProgress(pending.wordProgress, wordUpdates);

    savePending(pending);
  },

  /**
   * Применить накопленный результат к текущему пользователю и очистить pending.
   * Вызывать после успешного login/register.
   */
  applyAndClear(): void {
    const user = authService.getCurrentUser();
    const pending = loadPending();
    if (!user || !pending) {
      if (pending) savePending(emptyPending());
      return;
    }

    const stats = user.stats ?? {
      exercisesCompleted: 0,
      pairsCompleted: 0,
      puzzlesCompleted: 0,
      bestScore: 0,
    };
    const newTotalXp = (stats.totalXp ?? stats.totalScore ?? 0) + pending.totalXp;
    const newBestScore = Math.max(stats.bestScore ?? 0, pending.bestScore);
    const xpByDate = { ...(user.stats?.xpByDate ?? {}) };
    for (const [date, xp] of Object.entries(pending.xpByDate)) {
      xpByDate[date] = (xpByDate[date] ?? 0) + xp;
    }

    authService.updateUserStats({
      totalXp: newTotalXp,
      exercisesCompleted: stats.exercisesCompleted + pending.exercisesCompleted,
      pairsCompleted: stats.pairsCompleted + pending.pairsCompleted,
      puzzlesCompleted: stats.puzzlesCompleted + pending.puzzlesCompleted,
      bestScore: newBestScore,
      xpByDate,
    });

    const currentUser = authService.getCurrentUser();
    if (!currentUser) {
      savePending(emptyPending());
      return;
    }
    const pendingUpdates: PendingWordUpdate[] = Object.entries(pending.wordProgress).flatMap(
      ([wordIdStr, byType]) =>
        Object.entries(byType).map(([type, value]) => ({
          wordId: Number(wordIdStr),
          progressType: type as WordProgressType,
          progressValue: typeof value === "number" ? value : 0,
        }))
    );
    if (pendingUpdates.length > 0) {
      const userProgress = (currentUser.wordProgress ?? {}) as WordProgressMap;
      const mergedProgress = mergeWordProgress(userProgress, pendingUpdates);
      const users = authAdapter.getUsers();
      const u = users[currentUser.username];
      if (u) {
        u.wordProgress = mergedProgress;
        authAdapter.saveUsers(users);
      }
    }

    savePending(emptyPending());
  },

  clearPending(): void {
    savePending(emptyPending());
  },
};
