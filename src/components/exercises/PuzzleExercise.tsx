import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useGameOnlyLayout } from "../../contexts/GameOnlyLayoutContext";
import type { Word } from "../../data/contracts/types";
import { useDictionary } from "../../features/dictionary/useDictionary";
import type { DictionarySource } from "../../services/dictionaryService";
import { dictionaryService } from "../../services/dictionaryService";
import { personalDictionaryService } from "../../services/personalDictionaryService";
import { progressService } from "../../services/progressService";
import { speakWord, playErrorSound } from "../../utils/sounds";
import {
  createPuzzleState,
  isPuzzleComplete,
  isPuzzleCorrect,
  placeLetterInSlot,
  PuzzleDifficulty,
  PuzzleState,
} from "../../domain/exercises/puzzle";
import { authService } from "../../services/authService";
import { guestPendingResultService } from "../../services/guestPendingResultService";
import { useAuth } from "../../features/auth/AuthContext";
import { calculateXp, formatXp } from "../../domain/xp";

const PUZZLE_TIMER_INITIAL_SEC = 60;

type SessionWordResult = {
  word: Word;
  progressBefore: number;
  progressAfter: number;
  hadError: boolean;
};

const AnimatedProgressBar: React.FC<{
  progressBefore: number;
  progressAfter: number;
  hadError: boolean;
}> = ({ progressBefore, progressAfter, hadError }) => {
  const [displayProgress, setDisplayProgress] = useState(progressBefore);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDisplayProgress(progressAfter));
    });
    return () => cancelAnimationFrame(id);
  }, [progressAfter]);
  return (
    <div className="puzzle-result-progress-track">
      <div
        className={`puzzle-result-progress-fill ${hadError ? "puzzle-result-progress-fill--decrease" : "puzzle-result-progress-fill--increase"}`}
        style={{ width: `${displayProgress}%` }}
      />
    </div>
  );
};

const formatTimer = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const PuzzleExercise: React.FC = () => {
  const { user, refresh: refreshUser } = useAuth();
  const { words: dictionaryWords, loading: wordsLoading } = useDictionary();
  const navigate = useNavigate();
  const dictionarySource: DictionarySource =
    user?.gameSettings?.dictionarySource ?? (user ? "personal" : "general");
  const difficulty: PuzzleDifficulty =
    user?.gameSettings?.puzzleDifficulty === "hard" ? "hard" : "easy";
  const setDifficulty = (value: PuzzleDifficulty) => {
    authService.updateGameSettings({ puzzleDifficulty: value });
    refreshUser();
  };
  const [currentIndex, setCurrentIndex] = useState(1);
  const [sessionXp, setSessionXp] = useState(0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [status, setStatus] = useState("Собери слово из пазлов.");
  const [locked, setLocked] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [currentWordData, setCurrentWordData] = useState<Word | null>(null);
  const [state, setState] = useState<PuzzleState | null>(null);
  const [sessionWords, setSessionWords] = useState<SessionWordResult[]>([]);
  const [timeLeft, setTimeLeft] = useState(PUZZLE_TIMER_INITIAL_SEC);
  const [timerRunning, setTimerRunning] = useState(false);
  const [endedByTime, setEndedByTime] = useState(false);

  const sessionXpRef = useRef(0);
  const sessionWordsRef = useRef<SessionWordResult[]>([]);
  const hardInputRef = useRef<HTMLInputElement>(null);
  const learningAreaRef = useRef<HTMLDivElement>(null);
  /** Охлаждение после нажатия буквы (мобильные: защита от множественного срабатывания) */
  const letterCooldownUntilRef = useRef(0);
  /** Охлаждение кнопки «Следующее слово» (защита от двойного тапа) */
  const nextWordCooldownUntilRef = useRef(0);
  /** Блокировка повторного вызова goNextWord до следующего появления кнопки */
  const nextWordHandledRef = useRef(false);
  /** Grace period: кнопка «Следующее слово» не реагирует первые N мс после появления (защита от «призрачного» тапа) */
  const nextButtonReadyAtRef = useRef(0);
  /** Grace period: кнопки модалки результатов не реагируют первые N мс после появления */
  const resultModalReadyAtRef = useRef(0);
  const isMobile = useIsMobile();
  const isGameOnly = useGameOnlyLayout();
  const isCompact = isMobile || isGameOnly;
  sessionXpRef.current = sessionXp;
  sessionWordsRef.current = sessionWords;

  /* На мобильных при открытии пазла — акцент на области обучения (слово + слоты + буквы) */
  useEffect(() => {
    if (!isMobile) return;
    const el = learningAreaRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ block: "start", behavior: "auto" });
    }, 100);
    return () => clearTimeout(t);
  }, [isMobile]);

  const hasEmptySlot = state?.slots.some((s) => s === null) ?? false;

  /* В сложном режиме на мобильном: автоматически открыть клавиатуру при старте и держать её открытой */
  useEffect(() => {
    if (!isMobile || difficulty !== "hard" || !state || !hasEmptySlot || locked) return;
    const input = hardInputRef.current;
    if (!input) return;
    // Фокусируем input с небольшой задержкой, чтобы DOM успел обновиться
    const t = setTimeout(() => {
      input.focus();
    }, 100);
    return () => clearTimeout(t);
  }, [isMobile, difficulty, state, hasEmptySlot, locked, currentIndex]);

  /* Держим фокус на input в сложном режиме на мобильном */
  useEffect(() => {
    if (!isMobile || difficulty !== "hard" || !state || !hasEmptySlot || locked) return;
    const input = hardInputRef.current;
    if (!input) return;
    const handleBlur = () => {
      // Если input потерял фокус, возвращаем его обратно (чтобы клавиатура не закрывалась)
      setTimeout(() => {
        if (input && document.activeElement !== input && !locked) {
          const stillHasEmpty = state?.slots.some((s) => s === null) ?? false;
          if (stillHasEmpty) {
            input.focus();
          }
        }
      }, 50);
    };
    input.addEventListener("blur", handleBlur);
    return () => input.removeEventListener("blur", handleBlur);
  }, [isMobile, difficulty, state, hasEmptySlot, locked]);

  const endGameByTime = useCallback(() => {
    setTimerRunning(false);
    setLocked(true);
    setEndedByTime(true);
    resultModalReadyAtRef.current = Date.now() + RESULT_MODAL_GRACE_MS;
    setShowResult(true);
    const earnedXp = sessionXpRef.current;
    const words = sessionWordsRef.current;
    if (user) {
      const stats = authService.getCurrentUser()?.stats;
      authService.updateUserStats(
        {
          totalXp: (stats?.totalXp ?? stats?.totalScore ?? 0) + earnedXp,
          exercisesCompleted: (stats?.exercisesCompleted || 0) + 1,
          puzzlesCompleted: (stats?.puzzlesCompleted || 0) + 1,
          bestScore: Math.max(stats?.bestScore ?? 0, earnedXp),
        },
        { xpEarnedToday: earnedXp }
      );
      setTimeout(() => refreshUser(), 0);
    } else {
      const wordUpdates = words.map((w) => ({
        wordId: w.word.id,
        progressType: (difficulty === "hard" ? "experienced" : "beginner") as "beginner" | "experienced",
        progressValue: w.progressAfter,
      }));
      guestPendingResultService.addGameResult("puzzle", earnedXp, wordUpdates);
    }
  }, [refreshUser, user, difficulty]);

  const setDictionarySource = (source: DictionarySource) => {
    authService.updateGameSettings({ dictionarySource: source });
    refreshUser();
  };

  const progressType = difficulty === "hard" ? "experienced" : "beginner";
  const randomWord = useMemo(
    () =>
      dictionaryWords.length > 0
        ? dictionaryService.getRandomWordsForGameFromPool(
            dictionaryWords,
            1,
            "both",
            progressType,
            dictionarySource,
            { guestMode: !user }
          )[0]
        : undefined,
    [currentIndex, difficulty, dictionarySource, dictionaryWords, user]
  );

  useEffect(() => {
    if (!randomWord) return;
    setCurrentWordData(randomWord);
    setState(createPuzzleState(randomWord, difficulty));
    setStatus(
      `Слово ${currentIndex}. ${
        difficulty === "easy"
          ? "Лёгкий режим: используй только буквы из слова."
          : "Сложный режим: можно использовать любые буквы, но в правильном порядке."
      }`
    );
    setLocked(false);
    setShowNext(false);
    nextWordHandledRef.current = false;
  }, [randomWord, difficulty, currentIndex]);

  useEffect(() => {
    if (!timerRunning || showResult) return;
    const id = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          endGameByTime();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning, showResult, endGameByTime]);

  const LETTER_COOLDOWN_MS = 400;
  const NEXT_WORD_COOLDOWN_MS = 500;
  const NEXT_BUTTON_GRACE_MS = 400;
  const RESULT_MODAL_GRACE_MS = 400;

  const applyLetter = (letter: string, letterIndex?: number) => {
    if (!state || locked) return;
    if (difficulty === "easy" && Date.now() < letterCooldownUntilRef.current) return;
    const emptySlotIndex = state.slots.findIndex((slot) => slot === null);
    if (emptySlotIndex === -1) return;

    if (difficulty === "easy") letterCooldownUntilRef.current = Date.now() + LETTER_COOLDOWN_MS;
    const updated = placeLetterInSlot(state, letter, emptySlotIndex, difficulty, letterIndex);
    setState({ ...updated, letters: [...updated.letters] });

    const complete = isPuzzleComplete(updated);
    if (complete) {
      finalizePuzzle(updated);
    }
  };

  const handleHardInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!state || locked) return;
    const raw = e.target.value.toUpperCase().replace(/[^A-Z\s\-]/g, "");
    const maxLen = state.slots.length;
    const filtered = raw.slice(0, maxLen);
    const current = state.slots.join("");
    if (filtered.length <= current.length) return;
    const added = filtered.slice(current.length);
    let nextState: PuzzleState = state;
    for (const letter of added) {
      const emptyIdx = nextState.slots.findIndex((s) => s === null);
      if (emptyIdx === -1) break;
      nextState = placeLetterInSlot(nextState, letter, emptyIdx, difficulty);
    }
    setState({ ...nextState, letters: [...nextState.letters] });
    if (isPuzzleComplete(nextState)) {
      finalizePuzzle(nextState);
    }
  };

  const finalizePuzzle = (updated: PuzzleState) => {
    if (locked) return;
    setLocked(true);
    const correct = isPuzzleCorrect(updated);
    const isFirstWord = sessionWords.length === 0;

    if (correct && currentWordData) {
      const progressBefore = progressService.getWordProgressValue(
        currentWordData.id,
        progressType
      );
      const xpEarned = calculateXp({
        level: currentWordData.level,
        exerciseType: progressType === "experienced" ? "ADVANCED" : "BEGINNER",
        gameType: "PUZZLE",
        puzzleDifficulty: difficulty === "hard" ? "HARD" : "EASY",
        isCorrect: true,
      });
      // Опыт начисляется только за правильный ответ; за ошибку XP не начисляется.
      setSessionXp((prev) => prev + xpEarned);
      progressService.updateWordProgress(currentWordData.id, true, progressType);
      const progressAfter = progressService.getWordProgressValue(
        currentWordData.id,
        progressType
      );
      setSessionWords((prev) => [
        ...prev,
        { word: currentWordData, progressBefore, progressAfter, hadError: false },
      ]);
      if (isFirstWord) setTimerRunning(true);
      setTimeLeft((prev) => prev + 1);
      speakWord(currentWordData.en, currentWordData.accent || "both", undefined);
      setStatus("Отлично! Слово собрано верно.");
      nextButtonReadyAtRef.current = Date.now() + NEXT_BUTTON_GRACE_MS;
      setShowNext(true);
      return;
    }

    if (currentWordData) {
      // За ошибку опыт не начисляется.
      const progressBefore = progressService.getWordProgressValue(
        currentWordData.id,
        progressType
      );
      setTotalErrors((prev) => prev + 1);
      progressService.updateWordProgress(currentWordData.id, false, progressType);
      const progressAfter = progressService.getWordProgressValue(
        currentWordData.id,
        progressType
      );
      setSessionWords((prev) => [
        ...prev,
        { word: currentWordData, progressBefore, progressAfter, hadError: true },
      ]);
      if (isFirstWord) setTimerRunning(true);
      setTimeLeft((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0) endGameByTime();
        return next;
      });
    }
    playErrorSound();
    setState({ ...updated, letters: [...updated.letters] });
    setStatus("Есть ошибки. Посмотри правильное слово.");
    nextButtonReadyAtRef.current = Date.now() + NEXT_BUTTON_GRACE_MS;
    setShowNext(true);
    // Сброс состояния выбора на мобильных (убирает «залипание» подсветки кнопки буквы), как в игре «Выбери пару»
    const container = document.getElementById("puzzle-learning-area");
    const active = document.activeElement;
    if (container && active instanceof HTMLElement && container.contains(active)) {
      active.blur();
    }
  };

  const goNextWord = () => {
    if (nextWordHandledRef.current) return;
    if (Date.now() < nextWordCooldownUntilRef.current) return;
    if (Date.now() < nextButtonReadyAtRef.current) return;
    nextWordHandledRef.current = true;
    nextWordCooldownUntilRef.current = Date.now() + NEXT_WORD_COOLDOWN_MS;
    setCurrentIndex((prev) => prev + 1);
    setLocked(false);
    setShowNext(false);
  };

  const restartGame = () => {
    if (Date.now() < resultModalReadyAtRef.current) return;
    setShowResult(false);
    setSessionWords([]);
    setCurrentIndex(1);
    setSessionXp(0);
    setTotalErrors(0);
    setShowNext(false);
    setLocked(false);
    setStatus("Собери слово из пазлов.");
    setTimeLeft(PUZZLE_TIMER_INITIAL_SEC);
    setTimerRunning(false);
    setEndedByTime(false);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (showResult) return;
      if (event.key === "Enter") {
        if (showNext) {
          event.preventDefault();
          goNextWord();
        }
        return;
      }
      if (!state || locked) return;
      const target = event.target as Node;
      if (target instanceof HTMLInputElement && target.getAttribute("data-puzzle-hard-input") === "true") return;
      if (event.key === "Escape" || event.key === "Tab") return;
      const key = event.key;
      const isLetter = key.length === 1 && /[a-zA-Z]/.test(key);
      const isSpaceOrHyphen = key === " " || key === "-";
      if (!isLetter && !isSpaceOrHyphen) return;
      const letter = isLetter ? key.toUpperCase() : key;
      if (difficulty === "easy") {
        const letterItem = state.letters.find((item) => item.letter === letter && !item.used);
        if (!letterItem) return;
        // При использовании клавиатуры используем индекс найденной буквы
        applyLetter(letter, letterItem.index);
      } else {
        if (key === " ") event.preventDefault();
        applyLetter(letter);
      }
      if (key === " " && difficulty !== "easy") event.preventDefault();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state, locked, showNext, showResult, difficulty]);

  const progressPercent = (timeLeft / PUZZLE_TIMER_INITIAL_SEC) * 100;
  const visibleLetterCount =
    difficulty === "easy"
      ? (state?.letters.filter((l) => !l.used).length ?? 0)
      : (state?.letters.length ?? 0);
  const showLettersPanel =
    difficulty === "easy" && hasEmptySlot && visibleLetterCount > 0;
  
  // Длина слова для стилизации
  const wordLength = state?.word.length ?? 0;

  const personalWordsCount =
    dictionaryWords.length > 0
      ? personalDictionaryService.getPersonalWordsFromPool(dictionaryWords).length
      : personalDictionaryService.getPersonalWordIds().length;
  const showPersonalEmpty = dictionarySource === "personal" && personalWordsCount === 0;

  if (wordsLoading) {
    return (
      <div className="exercise-area">
        <p className="dictionary-subtitle">Загрузка словаря…</p>
      </div>
    );
  }

  return (
    <div className="exercise-area">
      {!isCompact && (
        <div className="game-dictionary-source">
          <span className="game-dictionary-source-label">Слова из:</span>
          <div className="game-dictionary-source-btns">
            <button
              type="button"
              className={`game-dictionary-source-btn ${dictionarySource === "general" ? "active" : ""}`}
              onClick={() => setDictionarySource("general")}
            >
              Общий словарь
            </button>
            <button
              type="button"
              className={`game-dictionary-source-btn ${dictionarySource === "personal" ? "active" : ""}`}
              onClick={() => setDictionarySource("personal")}
            >
              Мой словарь
            </button>
          </div>
        </div>
      )}
      {showPersonalEmpty ? (
        <div className="game-empty-personal">
          <p>В «Мой словарь» пока нет слов.</p>
          <p>
            Добавьте слова в разделе{" "}
            <button type="button" className="game-empty-personal-link" onClick={() => navigate("/dictionary")}>
              Словарь
            </button>
            .
          </p>
        </div>
      ) : (
        <>
      {isCompact ? (
        <div className="puzzle-mobile-status">
          <div className="puzzle-mobile-status-row">
            <span className="puzzle-mobile-stat" aria-label={`Слов: ${sessionWords.length}`}>{`Слов: ${sessionWords.length}`}</span>
            <span className="puzzle-mobile-stat" aria-label={`Опыт: ${formatXp(sessionXp)}`}>{`Опыт: ${formatXp(sessionXp)}`}</span>
            <span className="puzzle-timer" aria-live="polite" title={!timerRunning && timeLeft === PUZZLE_TIMER_INITIAL_SEC ? "Таймер запустится после первого собранного слова" : undefined}>
              ⏱ {formatTimer(timeLeft)}
            </span>
          </div>
        </div>
      ) : (
        <div className="lesson-header">
          <div>
            <span className="lesson-label">Игра</span>
            <h1 className="lesson-title">Puzzle Words</h1>
          </div>
          <div className="progress">
            <div className="progress-text">
              <span>{`Слов: ${sessionWords.length}`}</span>
              <span>{`Опыт: ${formatXp(sessionXp)}`}</span>
              <span className="puzzle-timer" aria-live="polite" title={!timerRunning && timeLeft === PUZZLE_TIMER_INITIAL_SEC ? "Таймер запустится после первого собранного слова" : undefined}>
                ⏱ {formatTimer(timeLeft)}
              </span>
            </div>
            <div className="progress-bar">
              <div id="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className={`puzzle-exercise ${isCompact ? "puzzle-exercise--mobile" : ""}`} id="puzzle-exercise">
        <div ref={learningAreaRef} id="puzzle-learning-area" className="puzzle-learning-area">
        {!isCompact && (
          <div className="puzzle-difficulty-switcher">
            <button
              className={`difficulty-btn ${difficulty === "easy" ? "active" : ""}`}
              type="button"
              onClick={() => setDifficulty("easy")}
            >
              Easy
            </button>
            <button
              className={`difficulty-btn ${difficulty === "hard" ? "active" : ""}`}
              type="button"
              onClick={() => setDifficulty("hard")}
            >
              Hard
            </button>
          </div>
        )}

        <div className="puzzle-hint">
          {currentWordData?.accent && currentWordData.accent !== "both" && (
            <span className="puzzle-hint-accent" title={currentWordData.accent === "UK" ? "Британский вариант" : "Американский вариант"}>
              {currentWordData.accent === "UK" ? "🇬🇧 UK" : "🇺🇸 US"}
            </span>
          )}
          {currentWordData?.accent === "both" && (
            <span className="puzzle-hint-accent" title="Британский и американский вариант">
              🇬🇧 UK / 🇺🇸 US
            </span>
          )}
          <p className="puzzle-translation" id="puzzle-translation">
            {state?.translation || ""}
          </p>
          {difficulty === "hard" && state && state.slots.length > 0 && (
            <p className="puzzle-hint-letter-count" aria-live="polite">
              Слово из {state.slots.length} букв
            </p>
          )}
        </div>

        <div className="puzzle-slots-wrapper" id="puzzle-slots-wrapper">
          <div className={`puzzle-slots puzzle-slots--long-word ${wordLength > 8 ? "puzzle-slots--medium-long" : ""} ${wordLength > 10 ? "puzzle-slots--very-long" : ""}`} id="puzzle-slots">
            {state?.slots.map((letter, index) => (
              <span
                key={`slot-${index}`}
                className={`puzzle-slot-text ${
                  state.slotsState[index] === "correct"
                    ? "puzzle-slot-text--correct"
                    : state.slotsState[index] === "wrong"
                      ? "puzzle-slot-text--wrong"
                      : letter
                        ? "puzzle-slot-text--filled"
                        : "puzzle-slot-text--empty"
                }`}
              >
                {letter === " " ? "␣" : letter || " "}
              </span>
            ))}
            {state?.slotsState?.some((s) => s === "wrong") && state?.word && (
              <div className="puzzle-long-word-correct">
                Правильно: <strong>{state.word}</strong>
              </div>
            )}
          </div>
        </div>

        {difficulty === "hard" && state && hasEmptySlot && !locked && isMobile && (
          <div className={`puzzle-hard-input-wrap puzzle-hard-input-wrap--mobile`}>
            {!isCompact && (
              <label htmlFor="puzzle-hard-input" className="puzzle-hard-input-label">
                Введите слово сюда
              </label>
            )}
            <div
              className="puzzle-hard-input-inner puzzle-hard-input-inner--mobile"
              onClick={() => hardInputRef.current?.focus()}
            >
              {!isCompact && (
                <span className="puzzle-hard-input-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
                  </svg>
                </span>
              )}
              <input
                ref={hardInputRef}
                id="puzzle-hard-input"
                type="text"
                className="puzzle-hard-input puzzle-hard-input--mobile"
                data-puzzle-hard-input="true"
                autoComplete="off"
                autoCapitalize="characters"
                inputMode="text"
                maxLength={state.slots.length}
                value={state.slots.join("")}
                onChange={handleHardInputChange}
                placeholder=""
                aria-label={`Введите слово из ${state.slots.length} букв`}
              />
            </div>
          </div>
        )}

        <div className="puzzle-letters-area" aria-hidden={!showLettersPanel && !showNext}>
          {showLettersPanel && (
            <div className="puzzle-letters" id="puzzle-letters">
              {state?.letters.map((item) => {
                const isUsed = difficulty === "easy" && item.used;
                return (
                  <button
                    key={`letter-${item.index}-${item.letter}`}
                    className={`puzzle-letter ${isUsed ? "puzzle-letter--used" : ""}`}
                    type="button"
                    onClick={() => !isUsed && applyLetter(item.letter, item.index)}
                    onPointerDown={(e) => {
                      if (!isUsed && (e.pointerType === "touch" || e.pointerType === "pen")) {
                        e.preventDefault();
                        applyLetter(item.letter, item.index);
                      }
                    }}
                    disabled={isUsed}
                    aria-disabled={isUsed}
                  >
                    {item.letter === " " ? "␣" : item.letter}
                  </button>
                );
              })}
            </div>
          )}
          {showNext && (
            <button
              type="button"
              className="puzzle-letters puzzle-letters--next-btn puzzle-next-word-btn"
              onClick={(e) => {
                e.preventDefault();
                goNextWord();
              }}
              onPointerDown={(e) => {
                if (e.pointerType === "touch" || e.pointerType === "pen") {
                  e.preventDefault();
                  goNextWord();
                }
              }}
            >
              {isCompact ? "Следующее слово" : "Следующее слово (Enter)"}
            </button>
          )}
        </div>
        </div>

      </div>

      {showRules && (
        <div className="puzzle-rules-modal" id="puzzle-rules-modal" onClick={() => setShowRules(false)}>
          <div className="puzzle-rules-content" onClick={(e) => e.stopPropagation()}>
            <button className="puzzle-rules-close" onClick={() => setShowRules(false)} type="button">
              ×
            </button>
            <h3 className="puzzle-rules-title">Правила</h3>
            <p className="puzzle-rules-text">
              {difficulty === "easy" ? (
                <>
                  Посмотри на русский перевод и собери английское слово из букв-пазлов. Используй
                  только буквы из слова. Собери как можно больше слов за 1 минуту.
                </>
              ) : (
                <>
                  Посмотри на русский перевод и собери английское слово. Можно использовать любые
                  буквы алфавита в правильном порядке. Собери как можно больше слов за 1 минуту.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {showResult && (
        <div className="modal puzzle-result-modal-backdrop">
          <div className="modal-content puzzle-result-modal" role="dialog" aria-labelledby="puzzle-result-title" aria-describedby="puzzle-result-score-block">
            <header className="puzzle-result-hero">
              <h2 id="puzzle-result-title" className="puzzle-result-title">
                {endedByTime ? "Время вышло!" : "Упражнение завершено"}
              </h2>
              <div id="puzzle-result-score-block" className="puzzle-result-score-block">
                <div className="puzzle-result-score-card puzzle-result-score-card--points">
                  <span className="puzzle-result-score-card-value">{formatXp(sessionXp)}</span>
                  <span className="puzzle-result-score-card-label">Опыт (XP)</span>
                </div>
                <div className="puzzle-result-score-card puzzle-result-score-card--errors">
                  <span className="puzzle-result-score-card-value">{totalErrors}</span>
                  <span className="puzzle-result-score-card-label">Ошибки</span>
                </div>
                <div className="puzzle-result-score-card puzzle-result-score-card--words">
                  <span className="puzzle-result-score-card-value">{sessionWords.length}</span>
                  <span className="puzzle-result-score-card-label">Слов</span>
                </div>
              </div>
            </header>
            <section className="puzzle-result-words-section" aria-label="Прогресс по словам">
              <h3 className="puzzle-result-words-heading">Прогресс по словам</h3>
              <ul className="puzzle-result-words-grid" aria-label="Список слов и прогресс">
                {sessionWords.map((item, index) => (
                  <li
                    key={`${item.word.id}-${index}`}
                    className={`puzzle-result-word-tile ${item.hadError ? "puzzle-result-word-tile--error" : "puzzle-result-word-tile--success"}`}
                  >
                    <div className="puzzle-result-word-tile-info">
                      <span className="puzzle-result-word-tile-en">{item.word.en}</span>
                      <span className="puzzle-result-word-tile-ru">{item.word.ru}</span>
                    </div>
                    <div className="puzzle-result-word-tile-progress">
                      <span className="puzzle-result-word-tile-percent" aria-hidden>
                        {item.progressBefore}% → {item.progressAfter}%
                      </span>
                      <AnimatedProgressBar
                        progressBefore={item.progressBefore}
                        progressAfter={item.progressAfter}
                        hadError={item.hadError}
                      />
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
              <button className="primary-btn puzzle-result-btn" onClick={restartGame} type="button">
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
                onClick={() => {
                  if (Date.now() < resultModalReadyAtRef.current) return;
                  navigate("/");
                }}
                type="button"
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
        </>
      )}
    </div>
  );
};

export default PuzzleExercise;
