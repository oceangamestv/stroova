import type { GateConfig, GateTaskType } from "./types";

export const GATES_A0_CONFIG: readonly GateConfig[] = [
  {
    id: 1,
    bossName: "Страж Азбуки",
    bossHpMax: 120,
    timeLimitSec: 55,
    difficultyMultiplier: 1.0,
    theme: "База: частотные слова",
  },
  {
    id: 2,
    bossName: "Смотритель Переводов",
    bossHpMax: 155,
    timeLimitSec: 52,
    difficultyMultiplier: 1.15,
    theme: "Точность перевода",
  },
  {
    id: 3,
    bossName: "Хранитель Пропусков",
    bossHpMax: 205,
    timeLimitSec: 48,
    difficultyMultiplier: 1.3,
    theme: "Слова в простых фразах",
  },
  {
    id: 4,
    bossName: "Мастер Тем",
    bossHpMax: 265,
    timeLimitSec: 44,
    difficultyMultiplier: 1.45,
    theme: "Тематическое смешение",
  },
  {
    id: 5,
    bossName: "Владыка Врат",
    bossHpMax: 340,
    timeLimitSec: 40,
    difficultyMultiplier: 1.6,
    theme: "Финальная ротация",
  },
] as const;

export const BASE_DAMAGE_BY_TASK: Record<GateTaskType, number> = {
  assemble: 12,
  translate: 10,
  "fill-gap": 14,
};

export const TIMER_BONUS_BY_TASK: Record<GateTaskType, number> = {
  assemble: 2,
  translate: 1,
  "fill-gap": 1,
};

export const TIMER_PENALTY_BY_TASK: Record<GateTaskType, number> = {
  assemble: 3,
  translate: 2,
  "fill-gap": 2,
};

export const TASK_ROTATION_BY_GATE: readonly GateTaskType[][] = [
  ["assemble", "translate"],
  ["assemble", "translate", "fill-gap"],
  ["translate", "fill-gap", "assemble"],
  ["fill-gap", "translate", "assemble"],
  ["assemble", "translate", "fill-gap"],
] as const;

export const GATES_A0_DICTIONARY_LEVEL = "A0";
