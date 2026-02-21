import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  checkSelectedCells,
  cellKey,
  type CellCoord,
} from "../../domain/exercises/wordSearchChecker";
import {
  generateGrid,
  type DictionaryMode,
  type DictionaryWord,
  type GeneratedGridResult,
} from "../../domain/exercises/wordSearchGenerator";
import { speakWord, playTickSound } from "../../utils/sounds";
import { progressService } from "../../services/progressService";
import { authService } from "../../services/authService";
import { guestPendingResultService } from "../../services/guestPendingResultService";
import { useAuth } from "../../features/auth/AuthContext";
import { formatXp } from "../../domain/xp";

/** XP за раунд по размеру поля: лёгкое 25, среднее 38, большое 50. */
const WORD_SEARCH_XP: Record<WordSearchGridSize, number> = {
  small: 25,
  medium: 38,
  large: 50,
};

/** Палитра фонов для найденных слов: насыщенные, но не ядовитые, с хорошей читаемостью чёрного. */
const WORD_SEARCH_COLORS = [
  "#64b5f6",
  "#81c784",
  "#ffb74d",
  "#ba68c8",
  "#4dd0e1",
  "#7986cb",
  "#f06292",
  "#4db6ac",
  "#a1887f",
  "#9575cd",
  "#e57373",
  "#ff8a65",
];

export type WordSearchGridSize = "small" | "medium" | "large";

export interface WordSearchProps {
  globalDictionary: DictionaryWord[];
  userDictionary: DictionaryWord[];
  gridSize: WordSearchGridSize;
  mode: DictionaryMode;
  allowEmptyCells: boolean;
}

type FoundWordEntry = {
  wordId: string;
  cellKeys: string[];
  colorIndex: number;
  /** id из словаря для прогресса (number); может отсутствовать, если слово не найдено в словаре. */
  dictionaryWordId?: number;
  wordValue: string;
};

function getPlacedWordId(word: GeneratedGridResult["words"][number]): string {
  const path = word.cells.map((cell) => `${cell.row}:${cell.col}`).join("|");
  return `${word.value}:${path}`;
}

function formatDurationMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  if (min > 0) return `${min} мин ${sec % 60} с`;
  return `${sec} с`;
}

/** Данные для финального окна результата раунда */
type WordSearchResultStats = {
  xp: number;
  durationMs: number;
  words: { wordValue: string; progressBefore: number; progressAfter: number; dictionaryWordId?: number }[];
};

/**
 * Игра Word Search: настройки приходят из интро (пропсы), поле генерируется при монтировании.
 * Выделение — змейкой (зажатие и ведение). Каждая клетка используется один раз. Найденные слова раскрашиваются.
 */
const WordSearchGame: React.FC<WordSearchProps> = ({
  globalDictionary,
  userDictionary,
  gridSize,
  mode,
  allowEmptyCells,
}) => {
  const navigate = useNavigate();
  const { user, refresh: refreshUser } = useAuth();
  const [gridResult, setGridResult] = useState<GeneratedGridResult | null>(null);
  const [selectedCells, setSelectedCells] = useState<CellCoord[]>([]);
  const [foundWords, setFoundWords] = useState<FoundWordEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  /** Финальное окно: показывать и данные для него */
  const [showResult, setShowResult] = useState(false);
  const [resultStats, setResultStats] = useState<WordSearchResultStats | null>(null);
  /** Инкремент перезапускает генерацию поля (новая игра) */
  const [gameSeed, setGameSeed] = useState(0);
  /** Момент нахождения первого слова (для подсчёта времени до конца раунда) */
  const firstWordFoundAtRef = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const selectedCellsRef = useRef<CellCoord[]>([]);
  const applyCheckResultRef = useRef<(cells: CellCoord[]) => void>(() => {});
  /** Актуальные словари для генерации; не в deps эффекта, чтобы refreshUser() не перезапускал раунд */
  const dictionariesRef = useRef({ globalDictionary, userDictionary });
  dictionariesRef.current = { globalDictionary, userDictionary };
  selectedCellsRef.current = selectedCells;

  const dictionaryForMode = useMemo(() => {
    if (mode === "global") return globalDictionary;
    if (mode === "user") return userDictionary;
    return [...userDictionary, ...globalDictionary];
  }, [mode, globalDictionary, userDictionary]);

  const usedCellKeys = useMemo(() => {
    const set = new Set<string>();
    for (const entry of foundWords) {
      for (const k of entry.cellKeys) set.add(k);
    }
    return set;
  }, [foundWords]);

  const cellToColorIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of foundWords) {
      for (const k of entry.cellKeys) map.set(k, entry.colorIndex);
    }
    return map;
  }, [foundWords]);

  useEffect(() => {
    const { globalDictionary: g, userDictionary: u } = dictionariesRef.current;
    const result = generateGrid({
      mode,
      gridSize,
      allowEmptyCells,
      globalDictionary: g,
      userDictionary: u,
    });
    firstWordFoundAtRef.current = null;
    setShowResult(false);
    setResultStats(null);
    setGridResult(result);
    setSelectedCells([]);
    setFoundWords([]);
  }, [mode, gridSize, allowEmptyCells, gameSeed]);

  const getCellUnderPointer = useCallback((clientX: number, clientY: number): { row: number; col: number } | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const cell = el?.closest?.("[data-word-search-cell]");
    if (!cell || !(cell instanceof HTMLElement)) return null;
    const row = cell.getAttribute("data-row");
    const col = cell.getAttribute("data-col");
    if (row === null || col === null) return null;
    return { row: Number(row), col: Number(col) };
  }, []);

  const handlePointerDown = useCallback(
    (row: number, col: number) => {
      if (!gridResult) return;
      if (gridResult.grid[row]?.[col] === null) return;
      setIsDragging(true);
      setSelectedCells([{ row, col }]);
    },
    [gridResult]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: PointerEvent) => {
      const cell = getCellUnderPointer(e.clientX, e.clientY);
      if (!cell || !gridResult) return;

      const prev = selectedCellsRef.current;
      let next: CellCoord[];

      if (prev.length === 0) {
        next = [{ row: cell.row, col: cell.col }];
        playTickSound();
      } else {
        const last = prev[prev.length - 1];
        const key = cellKey(cell.row, cell.col);

        if (cell.row === last.row && cell.col === last.col) return;

        const prevIndex = prev.findIndex((c) => c.row === cell.row && c.col === cell.col);
        if (prevIndex >= 0 && prevIndex === prev.length - 2) {
          next = prev.slice(0, -1);
        } else {
          const isAdjacentRight = last.row === cell.row && cell.col === last.col + 1;
          const isAdjacentDown = last.col === cell.col && cell.row === last.row + 1;
          const isAdjacentLeft = last.row === cell.row && cell.col === last.col - 1;
          const isAdjacentUp = last.col === cell.col && cell.row === last.row - 1;
          if (isAdjacentRight || isAdjacentDown || isAdjacentLeft || isAdjacentUp) {
            if (prev.some((c) => c.row === cell.row && c.col === cell.col)) return;
            if (usedCellKeys.has(key)) return;
            if (gridResult.grid[cell.row]?.[cell.col] === null) return;
            next = [...prev, cell];
            playTickSound();
          } else {
            return;
          }
        }
      }

      setSelectedCells(next);
    };

    const handleUp = () => {
      const toCheck = selectedCellsRef.current;
      setIsDragging(false);
      applyCheckResultRef.current(toCheck);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleUp);
    };
  }, [isDragging, getCellUnderPointer, gridResult, usedCellKeys]);

  const finishRound = useCallback(
    (foundList: FoundWordEntry[]) => {
      if (!gridResult) return;
      const endTime = Date.now();
      const startTime = firstWordFoundAtRef.current ?? endTime;
      const durationMs = Math.max(0, endTime - startTime);
      const xp = WORD_SEARCH_XP[gridSize];

      const wordsWithProgress: WordSearchResultStats["words"] = [];
      for (const entry of foundList) {
        const progressBefore =
          entry.dictionaryWordId != null
            ? progressService.getWordProgressValue(entry.dictionaryWordId, "beginner")
            : 0;
        if (entry.dictionaryWordId != null) {
          progressService.updateWordProgress(entry.dictionaryWordId, true, "beginner");
        }
        const progressAfter =
          entry.dictionaryWordId != null
            ? progressService.getWordProgressValue(entry.dictionaryWordId, "beginner")
            : progressBefore;
        wordsWithProgress.push({
          wordValue: entry.wordValue,
          progressBefore,
          progressAfter,
          dictionaryWordId: entry.dictionaryWordId,
        });
      }

      if (user) {
        const stats = authService.getCurrentUser()?.stats;
        authService.updateUserStats(
          {
            totalXp: (stats?.totalXp ?? stats?.totalScore ?? 0) + xp,
            exercisesCompleted: (stats?.exercisesCompleted ?? 0) + 1,
            bestScore: Math.max(stats?.bestScore ?? 0, xp),
          },
          { xpEarnedToday: xp }
        );
        setTimeout(() => refreshUser(), 0);
      } else {
        const wordUpdates = wordsWithProgress
          .filter((w) => w.dictionaryWordId != null)
          .map((w) => ({
            wordId: w.dictionaryWordId!,
            progressType: "beginner" as const,
            progressValue: w.progressAfter,
          }));
        guestPendingResultService.addGameResult("word-search", xp, wordUpdates);
      }

      setResultStats({ xp, durationMs, words: wordsWithProgress });
      setShowResult(true);
    },
    [gridResult, gridSize, user]
  );

  const applyCheckResult = useCallback(
    (cells: CellCoord[]) => {
      if (!gridResult || cells.length === 0) return;

      const result = checkSelectedCells(
        { ...gridResult, foundWordIds: foundWords.map((f) => f.wordId) } as Parameters<typeof checkSelectedCells>[0],
        cells,
        dictionaryForMode,
        usedCellKeys
      );

      if (!result.isValid) {
        setSelectedCells([]);
        return;
      }

      const placedWord = gridResult.words.find(
        (w) =>
          w.value === result.word &&
          w.cells.length === cells.length &&
          w.cells.every((cell, index) => cell.row === cells[index].row && cell.col === cells[index].col)
      );

      if (!placedWord) {
        setSelectedCells([]);
        return;
      }

      const wordId = getPlacedWordId(placedWord);
      const cellKeys = placedWord.cells.map((c) => cellKey(c.row, c.col));
      const colorIndex = foundWords.length % WORD_SEARCH_COLORS.length;
      const wordValue = result.word ?? placedWord.value;
      const dictWord = dictionaryForMode.find(
        (d) => d.value.trim().toUpperCase() === wordValue.toUpperCase()
      );
      const numId = dictWord ? Number(dictWord.id) : NaN;
      const dictionaryWordId = Number.isFinite(numId) ? numId : undefined;

      if (foundWords.length === 0) firstWordFoundAtRef.current = Date.now();

      const newEntry: FoundWordEntry = {
        wordId,
        cellKeys,
        colorIndex,
        wordValue,
        ...(dictionaryWordId != null ? { dictionaryWordId } : {}),
      };
      const newFoundWords = [...foundWords, newEntry];

      setFoundWords(newFoundWords);
      setSelectedCells([]);
      if (result.word) void speakWord(result.word);

      if (newFoundWords.length === gridResult.words.length) {
        finishRound(newFoundWords);
      }
    },
    [gridResult, dictionaryForMode, foundWords, usedCellKeys, finishRound]
  );
  applyCheckResultRef.current = applyCheckResult;

  const isCellSelected = useCallback(
    (row: number, col: number) =>
      selectedCells.some((c) => c.row === row && c.col === col),
    [selectedCells]
  );

  if (!gridResult) {
    return (
      <div className="exercise-area">
        <p className="dictionary-subtitle">Загрузка…</p>
      </div>
    );
  }

  const cols = gridResult.grid[0]?.length ?? 0;
  const rows = gridResult.grid.length;

  return (
    <div className="exercise-area word-search">
      <div className="word-search__grid-wrap" ref={gridRef}>
        <div
          className="word-search__grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
          role="grid"
          aria-label="Поле слов"
        >
          {gridResult.grid.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const isEmpty = cell === null;
              const selected = isCellSelected(rowIndex, colIndex);
              const key = cellKey(rowIndex, colIndex);
              const colorIdx = cellToColorIndex.get(key);
              const bg =
                colorIdx !== undefined
                  ? WORD_SEARCH_COLORS[colorIdx]
                  : undefined;
              const isFound = bg !== undefined;
              return (
                <div
                  key={`${rowIndex}-${colIndex}`}
                  role="gridcell"
                  className={`word-search__cell ${isEmpty ? "word-search__cell--empty" : ""} ${selected ? "word-search__cell--selected" : ""} ${isFound ? "word-search__cell--found" : ""}`}
                  data-word-search-cell
                  data-row={rowIndex}
                  data-col={colIndex}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    if (!isEmpty) handlePointerDown(rowIndex, colIndex);
                  }}
                  style={
                    isEmpty
                      ? undefined
                      : { background: bg }
                  }
                  aria-label={isEmpty ? "" : `Ячейка ${rowIndex}, ${colIndex}`}
                >
                  {cell ?? ""}
                </div>
              );
            })
          )}
        </div>
      </div>

      {showResult && resultStats && (
        <div className="modal puzzle-result-modal-backdrop">
          <div
            className="modal-content puzzle-result-modal"
            role="dialog"
            aria-labelledby="word-search-result-title"
            aria-describedby="word-search-result-stats"
          >
            <header className="puzzle-result-hero">
              <h2 id="word-search-result-title" className="puzzle-result-title">
                Раунд завершён!
              </h2>
              <div id="word-search-result-stats" className="puzzle-result-score-block">
                <div className="puzzle-result-score-card puzzle-result-score-card--points">
                  <span className="puzzle-result-score-card-value">{formatXp(resultStats.xp)}</span>
                  <span className="puzzle-result-score-card-label">Опыт (XP)</span>
                </div>
                <div className="puzzle-result-score-card">
                  <span className="puzzle-result-score-card-value">
                    {formatDurationMs(resultStats.durationMs)}
                  </span>
                  <span className="puzzle-result-score-card-label">Время (от 1-го слова)</span>
                </div>
                <div className="puzzle-result-score-card puzzle-result-score-card--words">
                  <span className="puzzle-result-score-card-value">{resultStats.words.length}</span>
                  <span className="puzzle-result-score-card-label">Слов найдено</span>
                </div>
              </div>
            </header>
            <section className="puzzle-result-words-section" aria-label="Прогресс по словам">
              <h3 className="puzzle-result-words-heading">Прогресс по словам (+1% за каждое)</h3>
              <ul className="puzzle-result-words-grid" aria-label="Список слов и прогресс">
                {resultStats.words.map((w, i) => (
                  <li
                    key={`${w.wordValue}-${i}`}
                    className="puzzle-result-word-tile puzzle-result-word-tile--success"
                  >
                    <div className="puzzle-result-word-tile-main">
                      <div className="puzzle-result-word-tile-info">
                        <span className="puzzle-result-word-tile-en">{w.wordValue}</span>
                        <span className="puzzle-result-word-tile-ru">
                          {w.progressBefore}% → {w.progressAfter}%
                        </span>
                      </div>
                      <div className="puzzle-result-word-tile-progress">
                        <span className="puzzle-result-word-tile-percent" aria-hidden>
                          {w.progressBefore}% → {w.progressAfter}%
                        </span>
                        <div className="puzzle-result-progress-track">
                          <div
                            className="puzzle-result-progress-fill puzzle-result-progress-fill--increase"
                            style={{ width: `${w.progressAfter}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            {!user && (
              <div className="puzzle-result-guest-cta" role="region" aria-label="Сохранить прогресс">
                <p className="puzzle-result-guest-cta-text">
                  Войдите или зарегистрируйтесь, чтобы сохранить прогресс и не потерять достижения.
                </p>
                <button
                  type="button"
                  className="primary-btn puzzle-result-guest-btn"
                  onClick={() => navigate("/login")}
                >
                  Войти / Зарегистрироваться
                </button>
              </div>
            )}
            <footer className="puzzle-result-footer">
              <button
                className="primary-btn puzzle-result-btn"
                type="button"
                onClick={() => {
                  setShowResult(false);
                  setResultStats(null);
                  firstWordFoundAtRef.current = null;
                  setGameSeed((s) => s + 1);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
                Играть снова
              </button>
              <button
                className="primary-btn puzzle-result-btn puzzle-result-btn--secondary"
                type="button"
                onClick={() => navigate("/")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                На главную
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default WordSearchGame;
