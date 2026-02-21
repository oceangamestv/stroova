import type {
  DictionaryWord,
  GeneratedGridResult,
  Grid,
  PlacedWord,
} from "./wordSearchGenerator";

export interface CellCoord {
  row: number;
  col: number;
}

export interface CheckWordResult {
  isValid: boolean;
  word?: string;
  reason?:
    | "empty-selection"
    | "duplicate-cells"
    | "out-of-bounds"
    | "not-neighbor-chain"
    | "contains-empty"
    | "cell-already-used"
    | "already-found"
    | "not-in-placed-words"
    | "not-in-dictionary";
}

type GeneratedGridWithFoundState = GeneratedGridResult & {
  /**
   * Optional runtime state from UI layer. If provided, checker can reject
   * already-counted words without relying on component-only logic.
   */
  foundWordIds?: string[];
};

function getPlacedWordId(word: PlacedWord): string {
  const path = word.cells.map((cell) => `${cell.row}:${cell.col}`).join("|");
  return `${word.value}:${path}`;
}

function isInBounds(grid: Grid, coord: CellCoord): boolean {
  if (coord.row < 0 || coord.col < 0) return false;
  if (coord.row >= grid.length) return false;
  if (grid.length === 0) return false;
  return coord.col < grid[coord.row].length;
}

function toUpperDictionarySet(dictionary: DictionaryWord[]): Set<string> {
  const set = new Set<string>();
  for (const item of dictionary) {
    const normalized = item.value.trim().toUpperCase();
    if (normalized.length > 0) set.add(normalized);
  }
  return set;
}

/**
 * Validates selected cell chain and checks whether it is a placed word.
 *
 * Rules:
 * - selection must be a snake path in user-selected order (orthogonal neighbors only),
 * - selected cells cannot contain null values,
 * - selection must match exactly one placed word path (same cells and order).
 */
export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function isOrthogonalNeighbor(prev: CellCoord, next: CellCoord): boolean {
  const dr = Math.abs(next.row - prev.row);
  const dc = Math.abs(next.col - prev.col);
  return dr + dc === 1;
}

export function checkSelectedCells(
  gridResult: GeneratedGridResult,
  selectedCells: CellCoord[],
  dictionary: DictionaryWord[],
  usedCellKeys?: ReadonlySet<string>
): CheckWordResult {
  if (selectedCells.length === 0) {
    return { isValid: false, reason: "empty-selection" };
  }

  const used = usedCellKeys ?? new Set<string>();

  const dedupe = new Set<string>();
  for (const cell of selectedCells) {
    const key = cellKey(cell.row, cell.col);
    if (used.has(key)) return { isValid: false, reason: "cell-already-used" };
    if (dedupe.has(key)) return { isValid: false, reason: "duplicate-cells" };
    dedupe.add(key);
  }

  for (const cell of selectedCells) {
    if (!isInBounds(gridResult.grid, cell)) {
      return { isValid: false, reason: "out-of-bounds" };
    }
  }

  let selectedWord = "";
  for (const cell of selectedCells) {
    const value = gridResult.grid[cell.row][cell.col];
    if (value === null) {
      return { isValid: false, reason: "contains-empty" };
    }
    selectedWord += value;
  }

  for (let i = 1; i < selectedCells.length; i += 1) {
    const prev = selectedCells[i - 1];
    const current = selectedCells[i];
    if (!isOrthogonalNeighbor(prev, current)) {
      return { isValid: false, reason: "not-neighbor-chain" };
    }
  }

  const expectedPlacement = gridResult.words.find((word) => {
    if (word.value !== selectedWord) return false;
    if (word.cells.length !== selectedCells.length) return false;
    for (let i = 0; i < selectedCells.length; i += 1) {
      const selected = selectedCells[i];
      const placed = word.cells[i];
      if (selected.row !== placed.row || selected.col !== placed.col) return false;
    }
    return true;
  });

  if (!expectedPlacement) {
    const dictionarySet = toUpperDictionarySet(dictionary);
    if (!dictionarySet.has(selectedWord)) {
      return { isValid: false, word: selectedWord, reason: "not-in-dictionary" };
    }
    return { isValid: false, word: selectedWord, reason: "not-in-placed-words" };
  }

  const withFound = gridResult as GeneratedGridWithFoundState;
  const foundWordIds = withFound.foundWordIds ?? [];
  const placedWordId = getPlacedWordId(expectedPlacement);

  if (foundWordIds.includes(placedWordId)) {
    return { isValid: false, word: selectedWord, reason: "already-found" };
  }

  return { isValid: true, word: selectedWord };
}
