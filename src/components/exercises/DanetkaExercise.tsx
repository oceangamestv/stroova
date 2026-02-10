import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Word } from "../../data/contracts/types";
import { useDictionary } from "../../features/dictionary/useDictionary";
import type { DictionarySource } from "../../services/dictionaryService";
import { dictionaryService } from "../../services/dictionaryService";
import { personalDictionaryService } from "../../services/personalDictionaryService";
import { progressService } from "../../services/progressService";
import { playCorrectSound, playErrorSound } from "../../utils/sounds";
import { authService } from "../../services/authService";
import { guestPendingResultService } from "../../services/guestPendingResultService";
import { useAuth } from "../../features/auth/AuthContext";
import { calculateXp, formatXp } from "../../domain/xp";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useGameOnlyLayout } from "../../contexts/GameOnlyLayoutContext";

const DANETKA_TIMER_INITIAL_SEC = 60;
/** Размеры этапов бонуса: 2, 4, 8, 16 правильных подряд. Каждый этап доступен 1 раз за игру. */
const DANETKA_STAGE_SIZES = [2, 4, 8, 16] as const;
/** Всегда показываем сетку 16 ячеек (8×2): 13 полосок + 3 квадрата. Лишние для текущего этапа затемняем. */
const DANETKA_STAGE_GRID_SIZE = 16;
const DANETKA_STAGE_BAR_COUNT = 13;

type SessionWordEntry = {
  word: Word;
  progressBefore: number;
  progressAfter: number;
  hadError: boolean;
};

type QuestionData = {
  word: Word;
  shownTranslation: string;
  isCorrectTranslation: boolean;
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

function buildQuestion(word: Word, pool: Word[]): QuestionData {
  const correctTranslation = word.ru;
  const others = pool.filter((w) => w.id !== word.id && w.ru !== correctTranslation);
  
  // Случайно выбираем: показывать правильный перевод (50%) или неправильный (50%)
  const showCorrect = Math.random() < 0.5;
  
  if (showCorrect) {
    return {
      word,
      shownTranslation: correctTranslation,
      isCorrectTranslation: true,
    };
  }
  
  // Выбираем случайный неправильный перевод
  if (others.length === 0) {
    // Если нет других слов, показываем правильный
    return {
      word,
      shownTranslation: correctTranslation,
      isCorrectTranslation: true,
    };
  }
  
  const randomOther = others[Math.floor(Math.random() * others.length)];
  return {
    word,
    shownTranslation: randomOther.ru,
    isCorrectTranslation: false,
  };
}

const formatTimer = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const progressType = "beginner" as const;

const DanetkaExercise: React.FC = () => {
  const { user, refresh: refreshUser } = useAuth();
  const { words: dictionaryWords, loading: wordsLoading } = useDictionary();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isGameOnly = useGameOnlyLayout();
  const isCompact = isMobile || isGameOnly;
  const dictionarySource: DictionarySource =
    user?.gameSettings?.dictionarySource ?? (user ? "personal" : "general");

  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(null);
  const [sessionXp, setSessionXp] = useState(0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [status, setStatus] = useState("Правильный ли это перевод?");
  const [locked, setLocked] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [sessionWords, setSessionWords] = useState<SessionWordEntry[]>([]);
  const [timeLeft, setTimeLeft] = useState(DANETKA_TIMER_INITIAL_SEC);
  const [timerRunning, setTimerRunning] = useState(false);
  const [endedByTime, setEndedByTime] = useState(false);
  const [userAnswer, setUserAnswer] = useState<boolean | null>(null);
  const [flashType, setFlashType] = useState<"correct" | "wrong" | null>(null);
  /** Индекс текущего этапа бонуса (0..3). 4 = все этапы пройдены. */
  const [stageIndex, setStageIndex] = useState(0);
  /** Сколько ячеек текущего этапа уже заполнено подряд (сбрасывается при ошибке). */
  const [stageProgress, setStageProgress] = useState(0);

  const sessionXpRef = useRef(0);
  const sessionWordsRef = useRef<SessionWordEntry[]>([]);
  const wrongAnswerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goNextWordRef = useRef<(() => void) | null>(null);
  sessionXpRef.current = sessionXp;
  sessionWordsRef.current = sessionWords;

  const poolWords = useMemo(() => {
    if (wordsLoading || dictionaryWords.length === 0) return [];
    return dictionaryService.getRandomWordsForGameFromPool(
      dictionaryWords,
      Math.max(50, dictionaryWords.length),
      "both",
      progressType,
      dictionarySource,
      { guestMode: !user }
    );
  }, [dictionaryWords, wordsLoading, dictionarySource, user]);

  const setDictionarySource = (source: DictionarySource) => {
    authService.updateGameSettings({ dictionarySource: source });
    refreshUser();
  };

  const pickNextWord = useCallback((): Word | null => {
    if (poolWords.length === 0) return null;
    const idx = Math.floor(Math.random() * poolWords.length);
    return poolWords[idx] ?? null;
  }, [poolWords]);

  useEffect(() => {
    return () => {
      if (wrongAnswerTimeoutRef.current) clearTimeout(wrongAnswerTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (poolWords.length === 0 || showResult) return;
    const word = pickNextWord();
    if (!word) return;
    const question = buildQuestion(word, poolWords);
    setCurrentQuestion(question);
    setLocked(false);
    setShowNext(false);
    setUserAnswer(null);
    setStatus("Правильный ли это перевод?");
  }, [poolWords, showResult, pickNextWord]);

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
          puzzlesCompleted: stats?.puzzlesCompleted ?? 0,
          pairsCompleted: stats?.pairsCompleted ?? 0,
          bestScore: Math.max(stats?.bestScore ?? 0, earnedXp),
        },
        { xpEarnedToday: earnedXp }
      );
      setTimeout(() => refreshUser(), 0);
    } else {
      const wordUpdates = words.map((w) => ({
        wordId: w.word.id,
        progressType,
        progressValue: w.progressAfter,
      }));
      guestPendingResultService.addGameResult("danetka", earnedXp, wordUpdates);
    }
  }, [refreshUser, user]);

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

  const handleAnswer = (answer: boolean) => {
    if (locked || !currentQuestion) return;

    const isFirstAnswer = sessionWords.length === 0;
    if (isFirstAnswer) setTimerRunning(true);

    // Правильный ответ: если показан правильный перевод и пользователь нажал "Да",
    // или показан неправильный перевод и пользователь нажал "Нет"
    const isCorrect =
      (currentQuestion.isCorrectTranslation && answer) ||
      (!currentQuestion.isCorrectTranslation && !answer);

    setLocked(true);
    setUserAnswer(answer);

    if (isCorrect) {
      setFlashType("correct");
      playCorrectSound();
      const progressBefore = progressService.getWordProgressValue(currentQuestion.word.id, progressType);
      const xpEarned = calculateXp({
        level: currentQuestion.word.level,
        exerciseType: "BEGINNER",
        gameType: "DANETKA",
        isCorrect: true,
      });
      setSessionXp((prev) => prev + xpEarned);
      progressService.updateWordProgress(currentQuestion.word.id, true, progressType);
      const progressAfter = progressService.getWordProgressValue(currentQuestion.word.id, progressType);
      setSessionWords((prev) => [
        ...prev,
        { word: currentQuestion.word, progressBefore, progressAfter, hadError: false },
      ]);
      const currentStageSize = stageIndex < DANETKA_STAGE_SIZES.length ? DANETKA_STAGE_SIZES[stageIndex] : 0;
      const nextProgress = stageProgress + 1;
      if (currentStageSize > 0 && nextProgress >= currentStageSize) {
        setTimeLeft((prev) => prev + currentStageSize);
        setStageProgress(0);
        setStageIndex((prev) => Math.min(prev + 1, DANETKA_STAGE_SIZES.length));
      } else {
        setStageProgress(nextProgress);
      }
      setStatus("Верно! Следующее слово…");
      const nextWord = pickNextWord();
      setTimeout(() => {
        setFlashType(null);
        if (nextWord) {
          const nextQuestion = buildQuestion(nextWord, poolWords);
          setCurrentQuestion(nextQuestion);
        }
        setLocked(false);
        setUserAnswer(null);
        setStatus("Правильный ли это перевод?");
      }, 400);
      return;
    }

    setFlashType("wrong");
    playErrorSound();
    setTimeout(() => setFlashType(null), 500);
    setTotalErrors((prev) => prev + 1);
    setStageProgress(0);
    const progressBefore = progressService.getWordProgressValue(currentQuestion.word.id, progressType);
    progressService.updateWordProgress(currentQuestion.word.id, false, progressType);
    const progressAfter = progressService.getWordProgressValue(currentQuestion.word.id, progressType);
    setSessionWords((prev) => [
      ...prev,
      { word: currentQuestion.word, progressBefore, progressAfter, hadError: true },
    ]);
    setStatus(
      currentQuestion.isCorrectTranslation
        ? "Неправильно. Это правильный перевод."
        : "Неправильно. Это неправильный перевод."
    );
    wrongAnswerTimeoutRef.current = window.setTimeout(() => goNextWordRef.current?.(), 400);
  };

  const goNextWord = useCallback(() => {
    const next = pickNextWord();
    if (next) {
      const nextQuestion = buildQuestion(next, poolWords);
      setCurrentQuestion(nextQuestion);
    }
    setLocked(false);
    setShowNext(false);
    setUserAnswer(null);
    setStatus("Правильный ли это перевод?");
  }, [pickNextWord, poolWords]);
  goNextWordRef.current = goNextWord;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showResult) return;
      if (e.key === "Enter" && showNext) {
        e.preventDefault();
        goNextWord();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showNext, showResult, goNextWord]);

  const restartGame = () => {
    setShowResult(false);
    setSessionWords([]);
    setSessionXp(0);
    setTotalErrors(0);
    setShowNext(false);
    setLocked(false);
    setStatus("Правильный ли это перевод?");
    setTimeLeft(DANETKA_TIMER_INITIAL_SEC);
    setTimerRunning(false);
    setEndedByTime(false);
    setUserAnswer(null);
    setStageIndex(0);
    setStageProgress(0);
    const next = pickNextWord();
    if (next) {
      const nextQuestion = buildQuestion(next, poolWords);
      setCurrentQuestion(nextQuestion);
    }
  };

  const progressPercent = (timeLeft / DANETKA_TIMER_INITIAL_SEC) * 100;
  const hasActiveStage = stageIndex < DANETKA_STAGE_SIZES.length;
  const currentStageSize = hasActiveStage ? DANETKA_STAGE_SIZES[stageIndex] : 0;
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
            <div className="puzzle-mobile-status danetka-status">
              <div className="danetka-top-row danetka-top-row--align-end">
                <span
                  className="danetka-timer-circle puzzle-timer"
                  aria-live="polite"
                  title={
                    !timerRunning && timeLeft === DANETKA_TIMER_INITIAL_SEC
                      ? "Таймер запустится после первого ответа"
                      : undefined
                  }
                >
                  <span className="danetka-timer-icon" aria-hidden>⏱</span> {timeLeft}
                </span>
                {hasActiveStage ? (
                  <>
                    <div className="danetka-stage-cells" role="progressbar" aria-valuenow={stageProgress} aria-valuemin={0} aria-valuemax={currentStageSize} aria-label={`Прогресс этапа: ${stageProgress} из ${currentStageSize}`}>
                      {Array.from({ length: DANETKA_STAGE_GRID_SIZE }, (_, i) => {
                        const isBar = i < DANETKA_STAGE_BAR_COUNT;
                        const active = i < currentStageSize;
                        const dimmed = !active;
                        const filled = active && i < stageProgress;
                        const isComplete = stageProgress === currentStageSize;
                        const completedHighlight = !isBar && active && isComplete && i < DANETKA_STAGE_BAR_COUNT + 2;
                        const base = isBar ? "danetka-stage-bar" : "danetka-stage-square";
                        const classes = [
                          base,
                          filled ? (isBar ? "danetka-stage-bar--filled" : "danetka-stage-square--filled") : "",
                          completedHighlight ? "danetka-stage-square--completed" : "",
                          dimmed ? "danetka-stage-cell--dimmed" : "",
                        ].filter(Boolean).join(" ");
                        return <div key={i} className={classes} />;
                      })}
                    </div>
                    <span className="danetka-bonus-head" aria-label={`Бонус за этап: +${currentStageSize} сек`}>+{currentStageSize}</span>
                  </>
                ) : (
                  <span className="danetka-stage-done">Все бонусы получены</span>
                )}
              </div>
            </div>
          ) : (
            <div className="lesson-header">
              <div>
                <span className="lesson-label">Игра</span>
                <h1 className="lesson-title">Данетка</h1>
              </div>
              <div className="progress">
                <div className="danetka-top-row danetka-top-row--desktop">
                  <div className="danetka-stats-block" aria-label={`Слов: ${sessionWords.length}, Опыт: ${formatXp(sessionXp)}`}>
                    <span className="danetka-stats-words">{`Слов: ${sessionWords.length}`}</span>
                    <div className="danetka-stats-divider" aria-hidden />
                    <span className="danetka-stats-xp">{formatXp(sessionXp)}</span>
                  </div>
                  <div className="danetka-top-row__right">
                    <span
                      className="danetka-timer-circle puzzle-timer"
                      aria-live="polite"
                      title={
                        !timerRunning && timeLeft === DANETKA_TIMER_INITIAL_SEC
                          ? "Таймер запустится после первого ответа"
                          : undefined
                      }
                    >
                      <span className="danetka-timer-icon" aria-hidden>⏱</span> {timeLeft}
                    </span>
                    {hasActiveStage ? (
                      <>
                        <div className="danetka-stage-cells" role="progressbar" aria-valuenow={stageProgress} aria-valuemin={0} aria-valuemax={currentStageSize} aria-label={`Прогресс этапа: ${stageProgress} из ${currentStageSize}`}>
                          {Array.from({ length: DANETKA_STAGE_GRID_SIZE }, (_, i) => {
                            const isBar = i < DANETKA_STAGE_BAR_COUNT;
                            const active = i < currentStageSize;
                            const dimmed = !active;
                            const filled = active && i < stageProgress;
                            const isComplete = stageProgress === currentStageSize;
                            const completedHighlight = !isBar && active && isComplete && i < DANETKA_STAGE_BAR_COUNT + 2;
                            const base = isBar ? "danetka-stage-bar" : "danetka-stage-square";
                            const classes = [
                              base,
                              filled ? (isBar ? "danetka-stage-bar--filled" : "danetka-stage-square--filled") : "",
                              completedHighlight ? "danetka-stage-square--completed" : "",
                              dimmed ? "danetka-stage-cell--dimmed" : "",
                            ].filter(Boolean).join(" ");
                            return <div key={i} className={classes} />;
                          })}
                        </div>
                        <span className="danetka-bonus-head" aria-label={`Бонус за этап: +${currentStageSize} сек`}>+{currentStageSize}</span>
                      </>
                    ) : (
                      <span className="danetka-stage-done">Все бонусы получены</span>
                    )}
                  </div>
                </div>
                <div className="progress-bar">
                  <div id="progress-fill" style={{ width: `${Math.min(100, progressPercent)}%` }} />
                </div>
              </div>
            </div>
          )}

          <div
            className={`danetka-exercise danetka-exercise-card ${isCompact ? "danetka-exercise--mobile" : ""} ${flashType ? `danetka-flash--${flashType}` : ""}`}
            id="danetka-exercise"
          >
            {isCompact && (
              <div className="danetka-card-stats-row" aria-label={`Слов: ${sessionWords.length}, Опыт: ${formatXp(sessionXp)}`}>
                <span className="danetka-stats-words">{`Слов: ${sessionWords.length}`}</span>
                <span className="danetka-stats-xp">{formatXp(sessionXp)}</span>
              </div>
            )}
            {currentQuestion && (
              <>
                <p className="danetka-word" aria-label={`Слово: ${currentQuestion.word.en}`}>
                  {currentQuestion.word.en}
                </p>
                <div className="danetka-translation-wrap">
                  <p className="danetka-translation" aria-label={`Перевод: ${currentQuestion.shownTranslation}`}>
                    {currentQuestion.shownTranslation}
                  </p>
                  {locked && ((userAnswer === true && currentQuestion.isCorrectTranslation) || (userAnswer === false && !currentQuestion.isCorrectTranslation)) && (
                    <span className="danetka-result-icon danetka-result-icon--correct" role="img" aria-label="Правильно">✓</span>
                  )}
                  {locked && ((userAnswer === true && !currentQuestion.isCorrectTranslation) || (userAnswer === false && currentQuestion.isCorrectTranslation)) && (
                    <span className="danetka-result-icon danetka-result-icon--wrong" role="img" aria-label="Неправильно">✗</span>
                  )}
                </div>
                <div className="danetka-yes-no-buttons" role="group" aria-label="Ответ: правильный ли перевод" key={currentQuestion.word.id}>
                  <button
                    type="button"
                    className={`danetka-yes-no-btn danetka-yes-no-btn--yes ${userAnswer === true && !currentQuestion.isCorrectTranslation ? "danetka-option--wrong" : ""} ${userAnswer === true && currentQuestion.isCorrectTranslation ? "danetka-option--correct" : ""} ${locked ? "danetka-option--locked" : ""}`}
                    onClick={() => handleAnswer(true)}
                    disabled={locked}
                  >
                    Да
                  </button>
                  <button
                    type="button"
                    className={`danetka-yes-no-btn danetka-yes-no-btn--no ${userAnswer === false && currentQuestion.isCorrectTranslation ? "danetka-option--wrong" : ""} ${userAnswer === false && !currentQuestion.isCorrectTranslation ? "danetka-option--correct" : ""} ${locked ? "danetka-option--locked" : ""}`}
                    onClick={() => handleAnswer(false)}
                    disabled={locked}
                  >
                    Нет
                  </button>
                </div>
              </>
            )}
          </div>

          {showResult && (
            <div className="modal puzzle-result-modal-backdrop">
              <div
                className="modal-content puzzle-result-modal"
                role="dialog"
                aria-labelledby="danetka-result-title"
                aria-describedby="danetka-result-score-block"
              >
                <header className="puzzle-result-hero">
                  <h2 id="danetka-result-title" className="puzzle-result-title">
                    {endedByTime ? "Время вышло!" : "Игра завершена"}
                  </h2>
                  <div id="danetka-result-score-block" className="puzzle-result-score-block">
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
                <section className="puzzle-result-words-section" aria-label="Результаты по словам">
                  <h3 className="puzzle-result-words-heading">Результаты по словам</h3>
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
                    onClick={() => navigate("/")}
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

export default DanetkaExercise;
