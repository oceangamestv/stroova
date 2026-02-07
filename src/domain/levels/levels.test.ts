/**
 * Проверка порогов лестницы уровней (соответствие таблице 1–100).
 */

import {
  getLevelFromXp,
  getProgressInLevel,
  getXpThresholdForLevel,
  xpToReachLevel,
  LEVELS_TOTAL,
} from "./index";

const EPS = 1e-6;

function assertEqual(actual: number, expected: number, msg: string) {
  if (Math.abs(actual - expected) > EPS) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

export function runLevelsTests() {
  assertEqual(xpToReachLevel(1), 0, "L1");
  assertEqual(xpToReachLevel(2), 80, "L2");
  assertEqual(xpToReachLevel(3), 168.5, "L3");
  assertEqual(xpToReachLevel(10), 1026, "L10");
  assertEqual(xpToReachLevel(100), 49153.5, "L100");

  assertEqual(getLevelFromXp(0), 1, "getLevel(0)");
  assertEqual(getLevelFromXp(80), 2, "getLevel(80)");
  assertEqual(getLevelFromXp(168.5), 3, "getLevel(168.5)");
  assertEqual(getLevelFromXp(49153.5), 100, "getLevel(49153.5)");

  const p100 = getProgressInLevel(49153.5);
  if (p100.level !== 100 || p100.xpNeededForNext !== 0) {
    throw new Error(`Level 100 progress: ${JSON.stringify(p100)}`);
  }
}
