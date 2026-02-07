/**
 * Расчёт начисляемого опыта (XP) за правильные ответы.
 * XP начисляется только за правильные ответы; дробные значения не округляются.
 */

import {
  LEVEL_MULTIPLIERS,
  EXERCISE_MULTIPLIERS,
  GAME_MULTIPLIERS,
  PUZZLE_DIFFICULTY_MULTIPLIERS,
  BASE_XP,
} from "./constants";
import type { XpInput, PuzzleDifficulty } from "./types";

function getGameMultiplier(
  gameType: XpInput["gameType"],
  puzzleDifficulty?: XpInput["puzzleDifficulty"]
): number {
  if (gameType === "PAIR_MATCH") {
    return GAME_MULTIPLIERS.PAIR_MATCH;
  }
  if (gameType === "PUZZLE") {
    const difficulty: PuzzleDifficulty = puzzleDifficulty ?? "EASY";
    return PUZZLE_DIFFICULTY_MULTIPLIERS[difficulty];
  }
  return 1.0;
}

/**
 * Вычисляет XP за один или несколько правильных ответов.
 *
 * Правила:
 * - При isCorrect === false возвращает 0.
 * - При отсутствии wordsCount считается 1 слово.
 * - XP = BASE_XP × k_level × k_exercise × k_game × wordsCount.
 * - Возвращаемое значение — число с плавающей точкой, без округления.
 *
 * @param input - параметры ответа (уровень, тип упражнения, игра, правильность, кол-во слов)
 * @returns начисленный XP (0 если ответ неправильный)
 */
export function calculateXp(input: XpInput): number {
  if (!input.isCorrect) {
    return 0;
  }

  const wordsCount = input.wordsCount ?? 1;
  const k_level = LEVEL_MULTIPLIERS[input.level];
  const k_exercise = EXERCISE_MULTIPLIERS[input.exerciseType];
  const k_game = getGameMultiplier(input.gameType, input.puzzleDifficulty);

  const xpForOneWord = BASE_XP * k_level * k_exercise * k_game;
  const totalXp = xpForOneWord * wordsCount;

  return totalXp;
}

/**
 * Форматирует XP для отображения: целое число без дробной части, если значение целое; иначе до 2 знаков.
 */
export function formatXp(xp: number): string {
  if (Number.isInteger(xp)) return String(xp);
  const rounded = Math.round(xp * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2);
}
