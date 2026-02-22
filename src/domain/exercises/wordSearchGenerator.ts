/**
 * Reusable word-search grid generator.
 *
 * This module intentionally has no React/UI dependencies so it can be reused
 * in web, mobile, and bot runtimes.
 */

export type DictionaryWord = {
  /** Stable internal id from source dictionary. */
  id: string;
  /** English word value, expected lowercase in source data. */
  value: string;
};

export type DictionaryMode = "global" | "user" | "mixed";

export interface GenerateGridOptions {
  mode: DictionaryMode;
  globalDictionary: DictionaryWord[];
  userDictionary: DictionaryWord[];
  gridSize: "small" | "medium" | "large";
  /**
   * Kept for backward compatibility with old callers.
   * Unresolved cells are kept as null in current logic.
   */
  allowEmptyCells?: boolean;
}

export type CellValue = string | null;
export type Grid = CellValue[][];

export interface CellCoord {
  row: number;
  col: number;
}

export interface PlacedWord {
  /** Placed word in uppercase. */
  value: string;
  /** Ordered path of the word on the grid (snake-like, orthogonal neighbors). */
  cells: CellCoord[];
}

export interface GeneratedGridResult {
  grid: Grid;
  /** Only words that were actually placed on the board. */
  words: PlacedWord[];
}

type NormalizedWord = {
  id: string;
  valueUpper: string;
};

type GridSize = { rows: number; cols: number };

export const GRID_SIZES = {
  small: { rows: 5, cols: 5 },
  medium: { rows: 6, cols: 6 },
  large: { rows: 7, cols: 7 },
} as const satisfies Record<GenerateGridOptions["gridSize"], GridSize>;

const VALID_WORD_RE = /^[a-z]+$/;

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function createEmptyGrid(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

function shuffleArray<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Prepare source words:
 * 1) pick dictionary list by mode,
 * 2) normalize and validate (`^[a-z]+$`),
 * 3) de-duplicate by value (case-insensitive) preserving first seen order.
 */
function buildCandidateWords(options: GenerateGridOptions): NormalizedWord[] {
  const source =
    options.mode === "global"
      ? options.globalDictionary
      : options.mode === "user"
        ? options.userDictionary
        : [...options.userDictionary, ...options.globalDictionary];

  const unique = new Set<string>();
  const result: NormalizedWord[] = [];

  for (const item of source) {
    const normalized = item.value.trim().toLowerCase();
    if (!VALID_WORD_RE.test(normalized)) continue;

    const valueUpper = normalized.toUpperCase();
    if (unique.has(valueUpper)) continue;
    unique.add(valueUpper);

    result.push({
      id: item.id,
      valueUpper,
    });
  }

  return result;
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function listAllCells(rows: number, cols: number): CellCoord[] {
  const cells: CellCoord[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ row, col });
    }
  }
  return cells;
}

/**
 * Only neighbors to the right and down. Words are placed so they are read
 * left-to-right and/or top-to-bottom (never up or left).
 */
function listRightDownNeighbors(
  rows: number,
  cols: number,
  cell: CellCoord
): CellCoord[] {
  const neighbors: CellCoord[] = [];
  if (cell.col < cols - 1) neighbors.push({ row: cell.row, col: cell.col + 1 });
  if (cell.row < rows - 1) neighbors.push({ row: cell.row + 1, col: cell.col });
  return neighbors;
}

function tryBuildSnakePathFromStart(
  rows: number,
  cols: number,
  length: number,
  start: CellCoord,
  occupied: ReadonlySet<string>
): CellCoord[] | null {
  const startKey = cellKey(start.row, start.col);
  if (occupied.has(startKey)) return null;
  if (length <= 0) return null;
  if (length === 1) return [start];

  const path: CellCoord[] = [start];
  const localUsed = new Set<string>([startKey]);

  const dfs = (current: CellCoord): boolean => {
    if (path.length === length) return true;

    const candidates = shuffleArray(
      listRightDownNeighbors(rows, cols, current).filter((candidate) => {
        const key = cellKey(candidate.row, candidate.col);
        return !occupied.has(key) && !localUsed.has(key);
      })
    );

    for (const nextCell of candidates) {
      const key = cellKey(nextCell.row, nextCell.col);
      localUsed.add(key);
      path.push(nextCell);
      if (dfs(nextCell)) return true;
      path.pop();
      localUsed.delete(key);
    }

    return false;
  };

  return dfs(start) ? path : null;
}

function placeWordByPath(grid: Grid, word: string, path: CellCoord[]): void {
  for (let i = 0; i < path.length; i += 1) {
    const cell = path[i];
    grid[cell.row][cell.col] = word[i];
  }
}

function finalizeGrid(grid: Grid, _allowEmptyCells: boolean): Grid {
  const result = cloneGrid(grid);
  for (let row = 0; row < result.length; row += 1) {
    for (let col = 0; col < result[row].length; col += 1) {
      if (result[row][col] !== null) continue;
      // Always leave cells that are not part of any word as null, so every
      // visible letter on the grid belongs to a word and can be found.
      result[row][col] = null;
    }
  }
  return result;
}

function sortWordsForAttempt(words: NormalizedWord[]): NormalizedWord[] {
  return [...words].sort((a, b) => {
    const byLength = b.valueUpper.length - a.valueUpper.length;
    if (byLength !== 0) return byLength;
    return Math.random() < 0.5 ? -1 : 1;
  });
}

function runSingleAttempt(
  words: NormalizedWord[],
  rows: number,
  cols: number
): { grid: Grid; placedWords: PlacedWord[]; filledCells: number } {
  const grid = createEmptyGrid(rows, cols);
  const placedWords: PlacedWord[] = [];
  const occupiedCellKeys = new Set<string>();

  const orderedWords = sortWordsForAttempt(words);
  const seenPlacedValues = new Set<string>();
  const allCells = listAllCells(rows, cols);

  for (const wordItem of orderedWords) {
    const word = wordItem.valueUpper;
    if (seenPlacedValues.has(word)) continue;
    if (word.length > rows * cols - occupiedCellKeys.size) continue;

    const starts = shuffleArray(allCells);
    for (const start of starts) {
      const startKey = cellKey(start.row, start.col);
      if (occupiedCellKeys.has(startKey)) continue;

      const path = tryBuildSnakePathFromStart(rows, cols, word.length, start, occupiedCellKeys);
      if (!path) continue;

      placeWordByPath(grid, word, path);
      for (const cell of path) {
        occupiedCellKeys.add(cellKey(cell.row, cell.col));
      }
      seenPlacedValues.add(word);
      placedWords.push({
        value: word,
        cells: path,
      });
      break;
    }
  }

  return {
    grid,
    placedWords,
    filledCells: occupiedCellKeys.size,
  };
}

/**
 * Generate a word-search board with snake-like word placement.
 *
 * The algorithm runs multiple randomized attempts and returns the best result
 * by number of placed words, then by number of filled cells.
 */
export function generateGrid(options: GenerateGridOptions): GeneratedGridResult {
  const { rows, cols } = GRID_SIZES[options.gridSize];
  const allowEmptyCells = options.allowEmptyCells ?? true;
  const candidates = buildCandidateWords(options).filter(
    (word) => word.valueUpper.length <= rows * cols
  );

  if (candidates.length === 0) {
    return {
      grid: finalizeGrid(createEmptyGrid(rows, cols), allowEmptyCells),
      words: [],
    };
  }

  const attempts = Math.max(25, Math.min(120, candidates.length * 3));
  let best = runSingleAttempt(candidates, rows, cols);

  for (let i = 1; i < attempts; i += 1) {
    const current = runSingleAttempt(candidates, rows, cols);
    const isBetter =
      current.placedWords.length > best.placedWords.length ||
      (current.placedWords.length === best.placedWords.length &&
        current.filledCells > best.filledCells);

    if (isBetter) {
      best = current;
      if (best.placedWords.length === candidates.length) break;
    }
  }

  return {
    grid: finalizeGrid(best.grid, allowEmptyCells),
    words: best.placedWords,
  };
}
