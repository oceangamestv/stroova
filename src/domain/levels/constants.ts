/**
 * Параметры формулы уровней.
 * xp_to_next(n) = XP_BASE + XP_STEP × (n − 1),  n = 1..99
 * Цель: ~49k XP до 100 уровня за год ежедневных 15 мин (~135 XP/день).
 */

export const LEVELS_TOTAL = 100;

/** XP для перехода 1→2. */
export const XP_FIRST_LEVEL = 80;

/** Прирост XP за каждый следующий переход (2→3, 3→4, …). */
export const XP_STEP_PER_LEVEL = 8.5;

/** Минимальный суммарный XP для перехода на уровень n (n = 1..100). */
export function xpToReachLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > LEVELS_TOTAL) level = LEVELS_TOTAL;
  // xp_total(L) = sum_{n=1}^{L-1} (80 + 8.5*(n-1)) = 80*(L-1) + 8.5 * (L-2)(L-1)/2
  const n = level - 1;
  return 80 * n + (8.5 * (n - 1) * n) / 2;
}
