import type { Level } from "../../data/contracts/types";

export type AiEvaluationResult = {
  score: number;
  grammar: number;
  spelling: number;
  complexity: number;
  feedback: string;
  source: "rule-based" | "ai";
};

export type EvaluateResponseInput = {
  input: string;
  expected: string;
  level: Level;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s'-]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  const matchCount = a.filter((token) => bSet.has(token)).length;
  return matchCount / Math.max(a.length, b.length);
}

/**
 * Контракт для будущей AI-оценки предложений.
 * MVP использует быстрый rule-based fallback, чтобы не блокировать игровой цикл.
 */
export async function evaluateResponse(
  params: EvaluateResponseInput
): Promise<AiEvaluationResult> {
  const inputTokens = tokenize(params.input);
  const expectedTokens = tokenize(params.expected);
  const overlap = overlapRatio(inputTokens, expectedTokens);

  const grammar = Math.round(40 + overlap * 60);
  const spelling = Math.round(35 + overlap * 65);
  const complexityBase = params.level === "A0" ? 20 : 40;
  const complexity = Math.min(100, complexityBase + Math.min(inputTokens.length, 12) * 4);
  const score = Math.round((grammar * 0.4 + spelling * 0.4 + complexity * 0.2) * 100) / 100;

  return {
    score,
    grammar,
    spelling,
    complexity,
    feedback:
      overlap >= 0.75
        ? "Ответ близок к ожидаемому. Отличная основа."
        : "Есть расхождения с ожидаемым вариантом. Попробуйте упростить фразу и проверить грамматику.",
    source: "rule-based",
  };
}
