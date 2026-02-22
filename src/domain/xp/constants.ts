/**
 * Коэффициенты для расчёта XP.
 * Формула: XP = 1.0 × k_level × k_exercise × k_game × wordsCount
 * База: 1.0 XP за одно слово A0 в «найди пары» для начинающих.
 */

import type { WordLevel, ExerciseType, GameType, PuzzleDifficulty } from "./types";

/** Множители за уровень слова (k_level). */
export const LEVEL_MULTIPLIERS: Record<WordLevel, number> = {
  A0: 1.0,
  A1: 1.2,
  A2: 1.5,
  B1: 2.0,
  B2: 2.5,
  C1: 3.0,
  C2: 3.5,
};

/** Множители за тип упражнения (k_exercise). */
export const EXERCISE_MULTIPLIERS: Record<ExerciseType, number> = {
  BEGINNER: 1.0,
  ADVANCED: 1.4,
};

/**
 * Множители за игру (k_game).
 * Для PUZZLE используется puzzleDifficulty (EASY / HARD).
 */
export const GAME_MULTIPLIERS: Record<GameType, number> = {
  PAIR_MATCH: 1.0,
  PUZZLE: 0, // не использовать напрямую; для пазлов берётся из PUZZLE_DIFFICULTY_MULTIPLIERS
  DANETKA: 1.2,
  ONE_OF_THREE: 1.2,
  GATES_OF_KNOWLEDGE: 1.35,
  WORD_SEARCH: 1.2,
};

/** Множители за сложность пазлов (k_game для PUZZLE). */
export const PUZZLE_DIFFICULTY_MULTIPLIERS: Record<PuzzleDifficulty, number> = {
  EASY: 1.25,
  HARD: 1.6,
};

/** Базовое значение XP (одно слово A0, найди пары, начинающий). */
export const BASE_XP = 1.0;
