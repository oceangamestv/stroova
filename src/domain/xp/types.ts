/**
 * Типы и перечисления для системы начисления XP.
 * Уровни слов, тип упражнения, тип игры и сложность пазлов.
 */

/** Уровень сложности слова (CEFR). */
export type WordLevel = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** Все уровни по порядку (для итерации и валидации). */
export const WORD_LEVELS: readonly WordLevel[] = [
  "A0",
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
] as const;

/** Тип упражнения: для начинающих или для опытных. */
export type ExerciseType = "BEGINNER" | "ADVANCED";

/** Тип игры. */
export type GameType = "PAIR_MATCH" | "PUZZLE" | "DANETKA";

/** Сложность игры «пазлы»: лёгкий (варианты видны) или сложный (ввод с клавиатуры). */
export type PuzzleDifficulty = "EASY" | "HARD";

/** Входные данные для расчёта XP за один или несколько правильных ответов. */
export interface XpInput {
  /** Уровень слова. */
  level: WordLevel;
  /** Тип упражнения (начинающий / опытный). */
  exerciseType: ExerciseType;
  /** Тип игры (найди пары / пазлы). */
  gameType: GameType;
  /** Сложность пазлов; обязателен, если gameType === "PUZZLE". */
  puzzleDifficulty?: PuzzleDifficulty;
  /** Правильный ли ответ. При false функция возвращает 0. */
  isCorrect: boolean;
  /** Сколько слов обработано этим действием (по умолчанию 1). */
  wordsCount?: number;
}
