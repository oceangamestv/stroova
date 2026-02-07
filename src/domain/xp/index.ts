/**
 * Модуль начисления опыта (XP) для приложения по изучению английского.
 * Базовая единица: 1.0 XP за одно правильное слово A0 в «найди пары» для начинающих.
 */

export {
  WORD_LEVELS,
  type WordLevel,
  type ExerciseType,
  type GameType,
  type PuzzleDifficulty,
  type XpInput,
} from "./types";

export {
  LEVEL_MULTIPLIERS,
  EXERCISE_MULTIPLIERS,
  GAME_MULTIPLIERS,
  PUZZLE_DIFFICULTY_MULTIPLIERS,
  BASE_XP,
} from "./constants";

export { calculateXp, formatXp } from "./calculateXp";
export { runXpTests } from "./calculateXp.test";
