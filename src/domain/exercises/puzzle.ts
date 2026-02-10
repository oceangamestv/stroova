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
  difficulty: PuzzleDifficulty,
  clickedLetterIndex?: number
) => {
  if (state.slots[slotIndex] !== null) return state;
  const nextSlots = [...state.slots];
  const nextSlotsState = [...state.slotsState];
  nextSlots[slotIndex] = letter;

  const correctLetter = state.word[slotIndex];
  const isCorrect = letter === correctLetter;
  if (isCorrect) {
    nextSlotsState[slotIndex] = "correct";
  } else {
    nextSlotsState[slotIndex] = "wrong";
  }
  // В лёгком режиме: при правильной букве — помечаем ту, на которую нажали; при неправильной — ту, что должна была быть в этом слоте
  if (difficulty === "easy") {
    const letterToMark = isCorrect
      ? clickedLetterIndex !== undefined
        ? state.letters.find((item) => item.index === clickedLetterIndex)
        : state.letters.find((item) => item.letter === correctLetter && !item.used)
      : state.letters.find((item) => item.letter === correctLetter && !item.used);
    if (letterToMark) letterToMark.used = true;
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
