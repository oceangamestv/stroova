import type { Word } from "../../../data/contracts/types";

export type GateTaskType = "assemble" | "translate" | "fill-gap";

export type GateConfig = {
  id: number;
  bossName: string;
  bossHpMax: number;
  timeLimitSec: number;
  difficultyMultiplier: number;
  theme: string;
};

type GateTaskBase = {
  id: string;
  gateId: number;
  type: GateTaskType;
  word: Word;
};

export type AssembleTask = GateTaskBase & {
  type: "assemble";
  prompt: string;
  letters: string[];
  expected: string;
};

export type TranslateTask = GateTaskBase & {
  type: "translate";
  prompt: string;
  expectedRu: string;
  acceptedRuVariants: string[];
};

export type FillGapTask = GateTaskBase & {
  type: "fill-gap";
  sentence: string;
  options: string[];
  expected: string;
};

export type GateTask = AssembleTask | TranslateTask | FillGapTask;

export type TaskCheckResult = {
  isCorrect: boolean;
  normalizedInput: string;
  expected: string;
};

export type GateRunStats = {
  totalXp: number;
  totalDamage: number;
  totalAnswers: number;
  correctAnswers: number;
  mistakes: number;
  gateCleared: number;
};
