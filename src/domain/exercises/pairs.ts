import type { Accent, Word } from "../../data/contracts/types";

export type PairsCard = {
  type: "en" | "ru";
  pairId: number;
  label: string;
  accent: Accent;
  index: number;
  matched: boolean;
};

export const buildPairsCards = (words: Word[]): PairsCard[] => {
  const englishCards: PairsCard[] = words.map((pair, i) => ({
    type: "en",
    pairId: pair.id,
    label: pair.en,
    accent: pair.accent || "both",
    index: i,
    matched: false,
  }));

  const russianCards: PairsCard[] = words.map((pair, i) => ({
    type: "ru",
    pairId: pair.id,
    label: pair.ru,
    accent: pair.accent || "both",
    index: words.length + i,
    matched: false,
  }));

  for (let i = russianCards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [russianCards[i], russianCards[j]] = [russianCards[j], russianCards[i]];
  }
  russianCards.forEach((c, i) => {
    c.index = words.length + i;
  });

  return [...englishCards, ...russianCards];
};

export const isMatch = (a: PairsCard, b: PairsCard) =>
  a.pairId === b.pairId && a.type !== b.type;
