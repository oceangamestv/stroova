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

/**
 * Проверяет, образуют ли две карточки правильную пару «слово — перевод».
 * Если передан массив words текущего этапа — считаем правильным любой выбор,
 * где комбинация (англ. слово, рус. перевод) совпадает с одной из пар в words.
 * Так «Hello» + «привет» засчитывается даже если на экране два слова с переводом «привет» (Hello, Hi).
 * Без words — классическая проверка по pairId (одна карточка от одного слова).
 */
export const isMatch = (a: PairsCard, b: PairsCard, words?: Word[]): boolean => {
  if (a.type === b.type) return false;
  const enCard = a.type === "en" ? a : b;
  const ruCard = a.type === "ru" ? a : b;
  const enLabel = enCard.label;
  const ruLabel = ruCard.label;

  if (words && words.length > 0) {
    return words.some((w) => w.en === enLabel && w.ru === ruLabel);
  }
  return a.pairId === b.pairId;
};
