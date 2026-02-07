/**
 * Санитарная обработка статистики для отображения в профиле.
 * Ограничивает завышенные/битые значения только для отображения; в БД не записываем «обрезанные» значения.
 */

import type { UserStats } from "../data/contracts/types";
import { getDisplayXp } from "../domain/levels";

/** Макс. значение счётчика для отображения (реальные значения показываем до этого предела). */
const MAX_DISPLAY_COUNT = 999_999;

/** Порог, выше которого счётчик считаем битым и при починке обнуляем (не 9999 — чтобы не записывать лимит в БД). */
const MAX_SANE_COUNT = 999_999;

const defaultStats: UserStats = {
  totalXp: 0,
  exercisesCompleted: 0,
  pairsCompleted: 0,
  puzzlesCompleted: 0,
  bestScore: 0,
};

/**
 * Возвращает статистику, пригодную только для отображения в UI (ограничивает только явно астрономические значения).
 */
export function getDisplayStats(raw: UserStats | null | undefined): UserStats {
  if (!raw || typeof raw !== "object") return defaultStats;
  const totalXp = getDisplayXp(raw.totalXp ?? raw.totalScore ?? 0);
  return {
    totalXp,
    totalScore: raw.totalScore,
    exercisesCompleted: capCountForDisplay(raw.exercisesCompleted ?? 0),
    pairsCompleted: capCountForDisplay(raw.pairsCompleted ?? 0),
    puzzlesCompleted: capCountForDisplay(raw.puzzlesCompleted ?? 0),
    bestScore: getDisplayXp(raw.bestScore ?? 0),
    xpByDate: raw.xpByDate ?? {},
  };
}

function capCountForDisplay(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), MAX_DISPLAY_COUNT);
}

/**
 * Проверяет, нужна ли «починка» сохранённой статистики (только явно битые: нечисловые, отрицательные, астрономические).
 * Пороги высокие, чтобы не считать «битыми» старые записанные лимиты (100k, 9999) и не перезаписывать их снова.
 */
export function isStatsCorrupted(raw: UserStats | null | undefined): boolean {
  if (!raw || typeof raw !== "object") return false;
  const rawXp = raw.totalXp ?? raw.totalScore ?? 0;
  const finiteXp = typeof rawXp === "number" && Number.isFinite(rawXp) && rawXp >= 0;
  const finiteBest = typeof raw.bestScore === "number" && Number.isFinite(raw.bestScore) && raw.bestScore >= 0;
  return (
    !finiteXp ||
    rawXp > 999_999_999 ||
    (raw.exercisesCompleted ?? 0) > MAX_SANE_COUNT ||
    (raw.pairsCompleted ?? 0) > MAX_SANE_COUNT ||
    (raw.puzzlesCompleted ?? 0) > MAX_SANE_COUNT ||
    !finiteBest ||
    (raw.bestScore ?? 0) > 999_999_999
  );
}

/**
 * Возвращает статистику, пригодную для записи в БД при починке: битые поля обнуляются, остальные берутся как есть.
 * Не подставляет 100000 или 9999 — только 0 для битых значений.
 */
export function sanitizeStatsForSave(raw: UserStats | null | undefined): UserStats {
  if (!raw || typeof raw !== "object") return defaultStats;
  const totalXp = raw.totalXp ?? raw.totalScore ?? 0;
  const best = raw.bestScore ?? 0;
  return {
    totalXp: saneXp(totalXp) ? totalXp : 0,
    totalScore: raw.totalScore,
    exercisesCompleted: saneCount(raw.exercisesCompleted ?? 0) ? Math.floor(raw.exercisesCompleted ?? 0) : 0,
    pairsCompleted: saneCount(raw.pairsCompleted ?? 0) ? Math.floor(raw.pairsCompleted ?? 0) : 0,
    puzzlesCompleted: saneCount(raw.puzzlesCompleted ?? 0) ? Math.floor(raw.puzzlesCompleted ?? 0) : 0,
    bestScore: saneXp(best) ? best : 0,
    xpByDate: raw.xpByDate ?? {},
  };
}

function saneXp(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 999_999_999;
}

function saneCount(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_SANE_COUNT;
}
