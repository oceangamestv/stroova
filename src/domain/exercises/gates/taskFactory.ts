import type { Word } from "../../../data/contracts/types";
import {
  GATES_A0_DICTIONARY_LEVEL,
  TASK_ROTATION_BY_GATE,
} from "./config";
import {
  normalizeEnglishWord,
  splitRuVariants,
} from "./engine";
import type {
  AssembleTask,
  FillGapTask,
  GateTask,
  GateTaskType,
  TranslateTask,
} from "./types";

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

function compactSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function maskWordInExample(example: string, target: string): string {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  if (re.test(example)) {
    return example.replace(re, "_____");
  }
  return `I see _____.`;
}

function createAssembleTask(gateId: number, word: Word): AssembleTask {
  const expected = normalizeEnglishWord(word.en);
  const letters = expected.split("").filter(Boolean);
  return {
    id: `gate-${gateId}-assemble-${word.id}-${Date.now()}`,
    gateId,
    type: "assemble",
    word,
    prompt: word.ru,
    expected,
    letters: shuffle(letters),
  };
}

function createTranslateTask(gateId: number, word: Word): TranslateTask {
  const variants = splitRuVariants(word.ru);
  return {
    id: `gate-${gateId}-translate-${word.id}-${Date.now()}`,
    gateId,
    type: "translate",
    word,
    prompt: word.en,
    expectedRu: word.ru,
    acceptedRuVariants: variants.length > 0 ? variants : [word.ru.toLowerCase()],
  };
}

function createFillGapTask(gateId: number, word: Word, distractors: Word[]): FillGapTask {
  const sentenceSource = compactSpaces(word.example || "");
  const sentence =
    sentenceSource.length > 0 ? maskWordInExample(sentenceSource, word.en) : "I have _____.";
  const options = shuffle([
    word.en,
    ...distractors.slice(0, 2).map((item) => item.en),
  ]);
  return {
    id: `gate-${gateId}-fill-gap-${word.id}-${Date.now()}`,
    gateId,
    type: "fill-gap",
    word,
    sentence,
    options,
    expected: word.en,
  };
}

export function getA0GeneralWords(words: Word[]): Word[] {
  return words.filter((word) => word.level === GATES_A0_DICTIONARY_LEVEL);
}

export function createGateTask(params: {
  gateId: number;
  availableWords: Word[];
  usedWordIds: Set<number>;
  previousTaskType?: GateTaskType | null;
}): GateTask {
  const { gateId, availableWords, usedWordIds, previousTaskType } = params;
  const gateIndex = Math.max(0, gateId - 1);
  const taskRotation = TASK_ROTATION_BY_GATE[gateIndex] ?? TASK_ROTATION_BY_GATE[0];

  let nextType = randomItem(taskRotation);
  if (previousTaskType && taskRotation.length > 1 && nextType === previousTaskType) {
    const alternatives = taskRotation.filter((taskType) => taskType !== previousTaskType);
    nextType = randomItem(alternatives);
  }

  const notUsed = availableWords.filter((word) => !usedWordIds.has(word.id));
  const pool = notUsed.length > 0 ? notUsed : availableWords;
  const word = randomItem(pool);
  usedWordIds.add(word.id);

  if (nextType === "assemble") {
    return createAssembleTask(gateId, word);
  }
  if (nextType === "translate") {
    return createTranslateTask(gateId, word);
  }
  const distractors = shuffle(
    availableWords.filter((item) => item.id !== word.id)
  );
  return createFillGapTask(gateId, word, distractors);
}
