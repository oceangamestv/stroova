/**
 * Лестница уровней 1–100, привязанная к XP.
 * ~49k XP до 100 уровня; xp_to_next(n) = 80 + 8.5×(n−1).
 */

export { LEVELS_TOTAL, XP_FIRST_LEVEL, XP_STEP_PER_LEVEL, xpToReachLevel } from "./constants";
export {
  XP_THRESHOLDS,
  getDisplayXp,
  getLevelFromXp,
  getXpThresholdForLevel,
  getXpForNextLevel,
  getProgressInLevel,
  type LevelProgress,
} from "./levels";
