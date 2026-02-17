import { BASE_DAMAGE_BY_TASK, TIMER_BONUS_BY_TASK, TIMER_PENALTY_BY_TASK } from "./config";
import type { GateTaskType, TaskCheckResult, TranslateTask } from "./types";

const WORD_NORMALIZE_REGEX = /[^a-z\-']/g;
const RU_NORMALIZE_REGEX = /[^а-яёa-z0-9\s-]/gi;

export function calculateComboMultiplier(combo: number): number {
  return 1 + Math.min(Math.max(combo, 0), 5) * 0.1;
}

export function calculateDamage(
  taskType: GateTaskType,
  combo: number,
  gateDifficultyMultiplier: number
): number {
  const base = BASE_DAMAGE_BY_TASK[taskType];
  const comboMultiplier = calculateComboMultiplier(combo);
  return Math.max(1, Math.round(base * comboMultiplier * gateDifficultyMultiplier));
}

export function getTimerDelta(taskType: GateTaskType, isCorrect: boolean): number {
  return isCorrect ? TIMER_BONUS_BY_TASK[taskType] : -TIMER_PENALTY_BY_TASK[taskType];
}

export function normalizeEnglishWord(input: string): string {
  return input.trim().toLowerCase().replace(WORD_NORMALIZE_REGEX, "");
}

export function normalizeRussianText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace("ё", "е")
    .replace(RU_NORMALIZE_REGEX, "")
    .replace(/\s+/g, " ");
}

export function splitRuVariants(ru: string): string[] {
  const rawParts = ru.split(/[;,/]| или /gi).map((part) => normalizeRussianText(part));
  const filtered = rawParts.filter(Boolean);
  return Array.from(new Set(filtered));
}

export function checkAssembleAnswer(input: string, expected: string): TaskCheckResult {
  const normalizedInput = normalizeEnglishWord(input);
  const normalizedExpected = normalizeEnglishWord(expected);
  return {
    isCorrect: normalizedInput === normalizedExpected,
    normalizedInput,
    expected: normalizedExpected,
  };
}

export function checkTranslateAnswer(input: string, task: TranslateTask): TaskCheckResult {
  const normalizedInput = normalizeRussianText(input);
  const expected = task.acceptedRuVariants[0] ?? normalizeRussianText(task.expectedRu);
  const isCorrect = task.acceptedRuVariants.includes(normalizedInput);
  return {
    isCorrect,
    normalizedInput,
    expected,
  };
}

export function checkFillGapAnswer(input: string, expected: string): TaskCheckResult {
  const normalizedInput = normalizeEnglishWord(input);
  const normalizedExpected = normalizeEnglishWord(expected);
  return {
    isCorrect: normalizedInput === normalizedExpected,
    normalizedInput,
    expected: normalizedExpected,
  };
}
