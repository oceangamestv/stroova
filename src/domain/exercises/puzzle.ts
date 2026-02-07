import type { Word } from "../../data/contracts/types";

export type PuzzleDifficulty = "easy" | "hard";

export type PuzzleLetter = {
  letter: string;
  index: number;
  used: boolean;
};

export type PuzzleSlotState = "correct" | "wrong" | null;

export type PuzzleState = {
  word: string;
  translation: string;
  letters: PuzzleLetter[];
  slots: (string | null)[];
  slotsState: PuzzleSlotState[];
};

export const createPuzzleState = (wordData: Word, difficulty: PuzzleDifficulty): PuzzleState => {
  const word = wordData.en.toUpperCase();
  const slots = Array(word.length).fill(null);
  const slotsState = Array(word.length).fill(null);
  let letters: PuzzleLetter[] = [];

  if (difficulty === "easy") {
    const lettersArray = word.split("");
    for (let i = lettersArray.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [lettersArray[i], lettersArray[j]] = [lettersArray[j], lettersArray[i]];
    }
    letters = lettersArray.map((letter, index) => ({ letter, index, used: false }));
  } else {
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter, index) => ({
      letter,
      index,
      used: false,
    }));
  }

  return {
    word,
    translation: wordData.ru,
    letters,
    slots,
    slotsState,
  };
};

export const placeLetterInSlot = (
  state: PuzzleState,
  letter: string,
  slotIndex: number,
  difficulty: PuzzleDifficulty
) => {
  if (state.slots[slotIndex] !== null) return state;
  const nextSlots = [...state.slots];
  const nextSlotsState = [...state.slotsState];
  nextSlots[slotIndex] = letter;

  const correctLetter = state.word[slotIndex];
  if (letter === correctLetter) {
    nextSlotsState[slotIndex] = "correct";
    if (difficulty === "easy") {
      const correctLetterItem = state.letters.find(
        (item) => item.letter === correctLetter && !item.used
      );
      if (correctLetterItem) correctLetterItem.used = true;
    }
  } else {
    nextSlotsState[slotIndex] = "wrong";
    if (difficulty === "easy") {
      const correctLetterItem = state.letters.find(
        (item) => item.letter === correctLetter && !item.used
      );
      if (correctLetterItem) correctLetterItem.used = true;
    }
  }

  return {
    ...state,
    slots: nextSlots,
    slotsState: nextSlotsState,
  };
};

export const isPuzzleComplete = (state: PuzzleState) =>
  state.slots.every((slot) => slot !== null);

export const isPuzzleCorrect = (state: PuzzleState) =>
  state.slots.join("") === state.word &&
  state.slotsState.every((slotState) => slotState === "correct");
