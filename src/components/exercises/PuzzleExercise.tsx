import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>("easy");
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
  sessionXpRef.current = sessionXp;
  sessionWordsRef.current = sessionWords;

  const endGameByTime = useCallback(() => {
    setTimerRunning(false);
    setLocked(true);
    setEndedByTime(true);
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
            dictionarySource
          )[0]
        : undefined,
    [currentIndex, difficulty, dictionarySource, dictionaryWords]
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

  const applyLetter = (letter: string) => {
    if (!state || locked) return;
    const emptySlotIndex = state.slots.findIndex((slot) => slot === null);
    if (emptySlotIndex === -1) return;

    const updated = placeLetterInSlot(state, letter, emptySlotIndex, difficulty);
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
      speakWord(currentWordData.en, currentWordData.accent || "both");
      setStatus("Отлично! Слово собрано верно.");
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
    setShowNext(true);
  };

  const goNextWord = () => {
    setCurrentIndex((prev) => prev + 1);
    setLocked(false);
    setShowNext(false);
  };

  const restartGame = () => {
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
      }
      if (key === " ") event.preventDefault();
      applyLetter(letter);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state, locked, showNext, showResult, difficulty]);

  const progressPercent = (timeLeft / PUZZLE_TIMER_INITIAL_SEC) * 100;
  const hasEmptySlot = state?.slots.some((s) => s === null) ?? false;
  const visibleLetterCount =
    difficulty === "easy"
      ? (state?.letters.filter((l) => !l.used).length ?? 0)
      : (state?.letters.length ?? 0);
  const showLettersPanel =
    difficulty === "easy" && hasEmptySlot && visibleLetterCount > 0;

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

      <div className="puzzle-exercise" id="puzzle-exercise">
        <button
          className="puzzle-help-btn"
          id="puzzle-help-btn"
          type="button"
          onClick={() => setShowRules(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 17c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm1-4h-2c0-2 2-2.5 2-4 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 2-2 2.5-2 4z"
              fill="currentColor"
            />
          </svg>
        </button>

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
            {state?.slotsState?.some((s) => s === "wrong") && state?.word && (
              <span className="puzzle-translation-correct"> — {state.word}</span>
            )}
          </p>
          {difficulty === "hard" && state && state.slots.length > 0 && (
            <p className="puzzle-hint-letter-count" aria-live="polite">
              Слово из {state.slots.length} букв
            </p>
          )}
        </div>

        <div className="puzzle-slots-wrapper" id="puzzle-slots-wrapper">
          <div className="puzzle-slots" id="puzzle-slots">
            {state?.slots.map((letter, index) => (
              <div className="puzzle-slot-container" key={`slot-${index}`}>
                <div
                  className={`puzzle-slot ${letter ? "filled" : ""} ${
                    state.slotsState[index] === "correct"
                      ? "correct"
                      : state.slotsState[index] === "wrong"
                        ? "wrong"
                        : ""
                  }`}
                >
                  {letter === " " ? "␣" : letter || ""}
                </div>
                {state.slotsState[index] === "wrong" && (
                  <div className="puzzle-slot-hint">
                    {state.word[index] === " " ? "␣" : state.word[index]}
                  </div>
                )}
              </div>
            ))}
          </div>
          {showNext && (
            <button className="puzzle-next-word-btn" type="button" onClick={goNextWord}>
              Следующее слово (Enter)
            </button>
          )}
        </div>

        {difficulty === "hard" && state && hasEmptySlot && !locked && (
          <div className="puzzle-hard-input-wrap">
            <label htmlFor="puzzle-hard-input" className="puzzle-hard-input-label">
              Введите слово сюда
            </label>
            <div
              className="puzzle-hard-input-inner"
              onClick={() => hardInputRef.current?.focus()}
            >
              <span className="puzzle-hard-input-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                  <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
                </svg>
              </span>
              <input
                ref={hardInputRef}
                id="puzzle-hard-input"
                type="text"
                className="puzzle-hard-input"
                data-puzzle-hard-input="true"
                autoComplete="off"
                autoCapitalize="characters"
                inputMode="text"
                maxLength={state.slots.length}
                value={state.slots.join("")}
                onChange={handleHardInputChange}
                placeholder=""
                aria-label={`Введите слово из ${state.slots.length} букв. Нажмите в это поле, чтобы открыть клавиатуру.`}
              />
            </div>
          </div>
        )}

        {showLettersPanel && (
          <div className="puzzle-letters" id="puzzle-letters">
            {state?.letters.map((item) => {
              if (difficulty === "easy" && item.used) return null;
              return (
                <button
                  key={`letter-${item.index}-${item.letter}`}
                  className="puzzle-letter"
                  type="button"
                  onClick={() => applyLetter(item.letter)}
                >
                  {item.letter === " " ? "␣" : item.letter}
                </button>
              );
            })}
          </div>
        )}
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
                Играть снова
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
