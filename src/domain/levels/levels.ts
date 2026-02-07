/**
 * Лестница уровней 1–100 по суммарному опыту.
 * Уровень L: минимальный суммарный XP = таблица порогов; current_level = max(L, где xp_total ≥ threshold[L]).
 */

import { LEVELS_TOTAL, xpToReachLevel } from "./constants";

/** Максимум XP для отображения; защита только от явно битых данных (Infinity, астрономические числа). */
const MAX_DISPLAY_XP = 999_999_999;

/**
 * Нормализует значение XP для отображения: конечное число, не меньше 0.
 * Реальное значение из БД показывается как есть; ограничение только от явно некорректных данных.
 */
export function getDisplayXp(xp: number): number {
  const n = typeof xp === "number" && Number.isFinite(xp) && xp >= 0 ? xp : 0;
  return Math.min(n, MAX_DISPLAY_XP);
}

/** Пороги суммарного XP по уровням: индекс 0 = уровень 1, индекс 99 = уровень 100. */
const XP_THRESHOLDS: number[] = (() => {
  const t: number[] = [];
  for (let L = 1; L <= LEVELS_TOTAL; L++) {
    t.push(xpToReachLevel(L));
  }
  return t;
})();

export { XP_THRESHOLDS };

/**
 * Возвращает уровень игрока по суммарному опыту (1–100).
 * Уровень 1 = 0 XP; уровень 100 при xp_total ≥ 49153.5.
 */
export function getLevelFromXp(totalXp: number): number {
  if (totalXp < 0) return 1;
  let level = 1;
  for (let L = LEVELS_TOTAL; L >= 1; L--) {
    if (totalXp >= XP_THRESHOLDS[L - 1]) {
      level = L;
      break;
    }
  }
  return level;
}

/**
 * Минимальный суммарный XP, с которого начинается уровень.
 */
export function getXpThresholdForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > LEVELS_TOTAL) return XP_THRESHOLDS[LEVELS_TOTAL - 1];
  return XP_THRESHOLDS[level - 1];
}

/**
 * XP, нужный для перехода с уровня n на n+1 (по формуле).
 */
export function getXpForNextLevel(level: number): number {
  if (level < 1 || level >= LEVELS_TOTAL) return 0;
  return 80 + 8.5 * (level - 1);
}

export type LevelProgress = {
  level: number;
  /** XP, набранные внутри текущего уровня (от порога уровня до текущего totalXp). */
  currentXpInLevel: number;
  /** XP, нужные для перехода на следующий уровень (0 на макс. уровне). */
  xpNeededForNext: number;
  /** Доля до следующего уровня: 0..1 (на 100 уровне = 1). */
  progressFraction: number;
};

/**
 * Прогресс внутри текущего уровня: для полоски «до следующего уровня» и подписи X/Y XP.
 */
export function getProgressInLevel(totalXp: number): LevelProgress {
  const level = getLevelFromXp(totalXp);
  const thresholdCurrent = getXpThresholdForLevel(level);
  const thresholdNext = level < LEVELS_TOTAL ? getXpThresholdForLevel(level + 1) : thresholdCurrent;
  const xpNeededForNext = Math.max(0, thresholdNext - thresholdCurrent);
  const currentXpInLevel = Math.max(0, totalXp - thresholdCurrent);
  const progressFraction =
    xpNeededForNext > 0 ? Math.min(1, currentXpInLevel / xpNeededForNext) : 1;
  return {
    level,
    currentXpInLevel: Math.min(currentXpInLevel, xpNeededForNext),
    xpNeededForNext,
    progressFraction,
  };
}
