/**
 * Примеры и проверки расчёта XP (базовые сценарии из спецификации).
 * Запуск: в консоли браузера или через вызов runXpTests() из приложения.
 */

import { calculateXp } from "./calculateXp";
import type { XpInput } from "./types";

const EPS = 1e-10;

function assertEqual(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > EPS) {
    throw new Error(
      `[XP] ${label}: expected ${expected}, got ${actual}`
    );
  }
}

/**
 * Запускает проверки расчёта XP. Выбрасывает при первой ошибке.
 */
export function runXpTests(): void {
  // A0, BEGINNER, PAIR_MATCH, correct, 1 слово → 1.0 XP
  assertEqual(
    calculateXp({
      level: "A0",
      exerciseType: "BEGINNER",
      gameType: "PAIR_MATCH",
      isCorrect: true,
    }),
    1.0,
    "A0 BEGINNER PAIR_MATCH 1 word"
  );

  // A1, BEGINNER, PAIR_MATCH, correct, 1 слово → 1.2 XP
  assertEqual(
    calculateXp({
      level: "A1",
      exerciseType: "BEGINNER",
      gameType: "PAIR_MATCH",
      isCorrect: true,
    }),
    1.2,
    "A1 BEGINNER PAIR_MATCH 1 word"
  );

  // A2, BEGINNER, PUZZLE EASY, correct, 1 слово → 1 × 1.5 × 1.0 × 1.25 = 1.875 XP
  assertEqual(
    calculateXp({
      level: "A2",
      exerciseType: "BEGINNER",
      gameType: "PUZZLE",
      puzzleDifficulty: "EASY",
      isCorrect: true,
    }),
    1.875,
    "A2 BEGINNER PUZZLE EASY 1 word"
  );

  // B1, ADVANCED, PAIR_MATCH, correct, 1 слово → 1 × 2.0 × 1.4 × 1.0 = 2.8 XP
  assertEqual(
    calculateXp({
      level: "B1",
      exerciseType: "ADVANCED",
      gameType: "PAIR_MATCH",
      isCorrect: true,
    }),
    2.8,
    "B1 ADVANCED PAIR_MATCH 1 word"
  );

  // C2, ADVANCED, PUZZLE HARD, correct, 1 слово → 1 × 3.5 × 1.4 × 1.6 = 7.84 XP
  assertEqual(
    calculateXp({
      level: "C2",
      exerciseType: "ADVANCED",
      gameType: "PUZZLE",
      puzzleDifficulty: "HARD",
      isCorrect: true,
    }),
    7.84,
    "C2 ADVANCED PUZZLE HARD 1 word"
  );

  // A0, BEGINNER, GATES_OF_KNOWLEDGE, correct, 1 слово -> 1 x 1.0 x 1.0 x 1.35 = 1.35 XP
  assertEqual(
    calculateXp({
      level: "A0",
      exerciseType: "BEGINNER",
      gameType: "GATES_OF_KNOWLEDGE",
      isCorrect: true,
    }),
    1.35,
    "A0 BEGINNER GATES_OF_KNOWLEDGE 1 word"
  );

  // Любой вариант с isCorrect === false → 0 XP
  const wrongInputs: XpInput[] = [
    {
      level: "A0",
      exerciseType: "BEGINNER",
      gameType: "PAIR_MATCH",
      isCorrect: false,
    },
    {
      level: "C2",
      exerciseType: "ADVANCED",
      gameType: "PUZZLE",
      puzzleDifficulty: "HARD",
      isCorrect: false,
      wordsCount: 10,
    },
  ];
  for (const input of wrongInputs) {
    assertEqual(calculateXp(input), 0, `wrong answer (${input.level})`);
  }

  // wordsCount: 2 слова A0 BEGINNER PAIR_MATCH → 2.0 XP
  assertEqual(
    calculateXp({
      level: "A0",
      exerciseType: "BEGINNER",
      gameType: "PAIR_MATCH",
      isCorrect: true,
      wordsCount: 2,
    }),
    2.0,
    "2 words A0 BEGINNER PAIR_MATCH"
  );
}
