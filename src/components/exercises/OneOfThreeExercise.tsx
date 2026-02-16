import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Word } from "../../data/contracts/types";
import { useDictionary } from "../../features/dictionary/useDictionary";
import type { DictionarySource } from "../../services/dictionaryService";
import { dictionaryService } from "../../services/dictionaryService";
import { personalDictionaryService } from "../../services/personalDictionaryService";
import { progressService } from "../../services/progressService";
import { speakWord, playErrorSound } from "../../utils/sounds";
import { authService } from "../../services/authService";
import { guestPendingResultService } from "../../services/guestPendingResultService";
import { useAuth } from "../../features/auth/AuthContext";
import { hydrateUser } from "../../data/adapters/serverAuthAdapter";
import { calculateXp, formatXp } from "../../domain/xp";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useGameOnlyLayout } from "../../contexts/GameOnlyLayoutContext";
import { ResultWordTile } from "../common/ResultWordTile";

const ONE_OF_THREE_TIMER_INITIAL_SEC = 60;
/** Размеры этапов бонуса: 2, 4, 8, 16 правильных подряд. Каждый этап доступен 1 раз за игру. */
const ONE_OF_THREE_STAGE_SIZES = [2, 4, 8, 16] as const;
const ONE_OF_THREE_STAGE_GRID_SIZE = 16;
const ONE_OF_THREE_STAGE_BAR_COUNT = 13;

type SessionWordEntry = {
  word: Word;
  progressBefore: number;
  progressAfter: number;
  hadError: boolean;
};

type Option = { ru: string; isCorrect: boolean };

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildOptions(correctWord: Word, pool: Word[]): Option[] {
  const correctRu = correctWord.ru;
  const others = pool.filter((w) => w.id !== correctWord.id && w.ru !== correctRu);
  
  // Перемешиваем массив других слов для случайного выбора
  const shuffledOthers = shuffle(others);
  
  const wrongRu: string[] = [];
  // Берем первые два уникальных перевода из перемешанного массива
  for (const w of shuffledOthers) {
    if (wrongRu.length >= 2) break;
    if (!wrongRu.includes(w.ru)) wrongRu.push(w.ru);
  }
  
  // Если не хватило уникальных вариантов, добавляем случайные из оставшихся
  while (wrongRu.length < 2 && shuffledOthers.length > 0) {
    const randomIndex = Math.floor(Math.random() * shuffledOthers.length);
    const randomRu = shuffledOthers[randomIndex].ru;
    if (!wrongRu.includes(randomRu)) {
      wrongRu.push(randomRu);
    }
    // Защита от бесконечного цикла: если все варианты уже добавлены, выходим
    if (wrongRu.length >= 2 || shuffledOthers.every(w => wrongRu.includes(w.ru))) {
      break;
    }
  }
  
  const options: Option[] = [
    { ru: correctRu, isCorrect: true },
    ...wrongRu.slice(0, 2).map((ru) => ({ ru, isCorrect: false })),
  ];
  return shuffle(options);
}

const progressType = "beginner" as const;

const OneOfThreeExercise: React.FC = () => {
  const { user, refresh: refreshUser } = useAuth();
  const { words: dictionaryWords, loading: wordsLoading } = useDictionary();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isGameOnly = useGameOnlyLayout();
  const isCompact = isMobile || isGameOnly;
  const dictionarySource: DictionarySource =
    user?.gameSettings?.dictionarySource ?? (user ? "personal" : "general");

  const [currentWord, setCurrentWord] = useState<Word | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [sessionXp, setSessionXp] = useState(0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [status, setStatus] = useState("Выбери правильный перевод.");
  const [locked, setLocked] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [sessionWords, setSessionWords] = useState<SessionWordEntry[]>([]);
  const [timeLeft, setTimeLeft] = useState(ONE_OF_THREE_TIMER_INITIAL_SEC);
  const [timerRunning, setTimerRunning] = useState(false);
  const [endedByTime, setEndedByTime] = useState(false);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [selectedWrongIndex, setSelectedWrongIndex] = useState<number | null>(null);
  /** Индекс текущего этапа бонуса (0..3). 4 = все этапы пройдены. */
  const [stageIndex, setStageIndex] = useState(0);
  /** Сколько ячеек текущего этапа уже заполнено подряд (сбрасывается при ошибке). */
  const [stageProgress, setStageProgress] = useState(0);

  const sessionXpRef = useRef(0);
  const sessionWordsRef = useRef<SessionWordEntry[]>([]);
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
    if (source === "personal") void hydrateUser().then(() => refreshUser());
  };

  useEffect(() => {
    if (dictionarySource === "personal") void hydrateUser().then(() => refreshUser());
  }, [dictionarySource]);

  const pickNextWord = useCallback((): Word | null => {
    if (poolWords.length === 0) return null;
    const idx = Math.floor(Math.random() * poolWords.length);
    return poolWords[idx] ?? null;
  }, [poolWords]);

  useEffect(() => {
    if (poolWords.length === 0 || showResult) return;
    const word = pickNextWord();
    if (!word) return;
    setCurrentWord(word);
    setOptions(buildOptions(word, poolWords));
    setLocked(false);
    setShowNext(false);
    setCorrectIndex(null);
    setSelectedWrongIndex(null);
    setStatus("Выбери правильный перевод.");
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
      guestPendingResultService.addGameResult("one-of-three", earnedXp, wordUpdates);
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

  const handleOptionClick = (index: number) => {
    if (locked || !currentWord) return;
    const opt = options[index];
    if (!opt) return;

    const isFirstAnswer = sessionWords.length === 0;
    if (isFirstAnswer) setTimerRunning(true);

    if (opt.isCorrect) {
      setLocked(true);
      const progressBefore = progressService.getWordProgressValue(currentWord.id, progressType);
      const xpEarned = calculateXp({
        level: currentWord.level,
        exerciseType: "BEGINNER",
        gameType: "ONE_OF_THREE",
        isCorrect: true,
      });
      setSessionXp((prev) => prev + xpEarned);
      progressService.updateWordProgress(currentWord.id, true, progressType);
      const progressAfter = progressService.getWordProgressValue(currentWord.id, progressType);
      setSessionWords((prev) => [
        ...prev,
        { word: currentWord, progressBefore, progressAfter, hadError: false },
      ]);
      const currentStageSize = stageIndex < ONE_OF_THREE_STAGE_SIZES.length ? ONE_OF_THREE_STAGE_SIZES[stageIndex] : 0;
      const nextProgress = stageProgress + 1;
      if (currentStageSize > 0 && nextProgress >= currentStageSize) {
        setTimeLeft((prev) => prev + currentStageSize);
        setStageProgress(0);
        setStageIndex((prev) => Math.min(prev + 1, ONE_OF_THREE_STAGE_SIZES.length));
      } else {
        setStageProgress(nextProgress);
      }
      speakWord(currentWord.en, currentWord.accent || "both", undefined);
      setStatus("Верно! Следующее слово…");
      const nextWord = pickNextWord();
      setTimeout(() => {
        setCurrentWord(nextWord);
        setOptions(nextWord ? buildOptions(nextWord, poolWords) : []);
        setLocked(false);
        setStatus("Выбери правильный перевод.");
      }, 400);
      return;
    }

    setLocked(true);
    setSelectedWrongIndex(index);
    const correctIdx = options.findIndex((o) => o.isCorrect);
    setCorrectIndex(correctIdx >= 0 ? correctIdx : null);
    setTotalErrors((prev) => prev + 1);
    const progressBefore = progressService.getWordProgressValue(currentWord.id, progressType);
    progressService.updateWordProgress(currentWord.id, false, progressType);
    const progressAfter = progressService.getWordProgressValue(currentWord.id, progressType);
    setSessionWords((prev) => [
      ...prev,
      { word: currentWord, progressBefore, progressAfter, hadError: true },
    ]);
    setStageProgress(0);
    playErrorSound();
    setStatus("Правильный вариант подсвечен. Нажми «Далее».");
    setShowNext(true);
  };

  const goNextWord = useCallback(() => {
    const next = pickNextWord();
    setCurrentWord(next);
    setOptions(next ? buildOptions(next, poolWords) : []);
    setLocked(false);
    setShowNext(false);
    setCorrectIndex(null);
    setSelectedWrongIndex(null);
    setStatus("Выбери правильный перевод.");
  }, [pickNextWord, poolWords]);

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
    setStatus("Выбери правильный перевод.");
    setTimeLeft(ONE_OF_THREE_TIMER_INITIAL_SEC);
    setTimerRunning(false);
    setEndedByTime(false);
    setCorrectIndex(null);
    setSelectedWrongIndex(null);
    setStageIndex(0);
    setStageProgress(0);
    const next = pickNextWord();
    setCurrentWord(next);
    setOptions(next ? buildOptions(next, poolWords) : []);
  };

  const progressPercent = (timeLeft / ONE_OF_THREE_TIMER_INITIAL_SEC) * 100;
  const hasActiveStage = stageIndex < ONE_OF_THREE_STAGE_SIZES.length;
  const currentStageSize = hasActiveStage ? ONE_OF_THREE_STAGE_SIZES[stageIndex] : 0;
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
                !timerRunning && timeLeft === ONE_OF_THREE_TIMER_INITIAL_SEC
                  ? "Таймер запустится после первого ответа"
                  : undefined
              }
            >
              <span className="danetka-timer-icon" aria-hidden>⏱</span> {timeLeft}
            </span>
            {hasActiveStage ? (
              <>
                <div className="danetka-stage-cells" role="progressbar" aria-valuenow={stageProgress} aria-valuemin={0} aria-valuemax={currentStageSize} aria-label={`Прогресс этапа: ${stageProgress} из ${currentStageSize}`}>
                  {Array.from({ length: ONE_OF_THREE_STAGE_GRID_SIZE }, (_, i) => {
                    const isBar = i < ONE_OF_THREE_STAGE_BAR_COUNT;
                    const active = i < currentStageSize;
                    const dimmed = !active;
                    const filled = active && i < stageProgress;
                    const isComplete = stageProgress === currentStageSize;
                    const completedHighlight = !isBar && active && isComplete && i < ONE_OF_THREE_STAGE_BAR_COUNT + 2;
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
            <h1 className="lesson-title">1 из 3</h1>
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
                    !timerRunning && timeLeft === ONE_OF_THREE_TIMER_INITIAL_SEC
                      ? "Таймер запустится после первого ответа"
                      : undefined
                  }
                >
                  <span className="danetka-timer-icon" aria-hidden>⏱</span> {timeLeft}
                </span>
                {hasActiveStage ? (
                  <>
                    <div className="danetka-stage-cells" role="progressbar" aria-valuenow={stageProgress} aria-valuemin={0} aria-valuemax={currentStageSize} aria-label={`Прогресс этапа: ${stageProgress} из ${currentStageSize}`}>
                      {Array.from({ length: ONE_OF_THREE_STAGE_GRID_SIZE }, (_, i) => {
                        const isBar = i < ONE_OF_THREE_STAGE_BAR_COUNT;
                        const active = i < currentStageSize;
                        const dimmed = !active;
                        const filled = active && i < stageProgress;
                        const isComplete = stageProgress === currentStageSize;
                        const completedHighlight = !isBar && active && isComplete && i < ONE_OF_THREE_STAGE_BAR_COUNT + 2;
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

          <div className={`danetka-exercise danetka-exercise-card ${isCompact ? "danetka-exercise--mobile" : ""}`} id="one-of-three-exercise">
            {isCompact && (
              <div className="danetka-card-stats-row" aria-label={`Слов: ${sessionWords.length}, Опыт: ${formatXp(sessionXp)}`}>
                <span className="danetka-stats-words">{`Слов: ${sessionWords.length}`}</span>
                <span className="danetka-stats-xp">{formatXp(sessionXp)}</span>
              </div>
            )}
            {currentWord && (
              <>
                <p className="danetka-word" aria-label={`Слово: ${currentWord.en}`}>
                  {currentWord.en}
                </p>
                <div className="one-of-three-options" role="group" aria-label="Варианты перевода" key={currentWord.id}>
                  {options.map((opt, index) => (
                    <button
                      key={`${currentWord.id}-${index}-${opt.ru}`}
                      type="button"
                      className={`one-of-three-option ${correctIndex === index ? "one-of-three-option--correct" : ""} ${selectedWrongIndex === index ? "one-of-three-option--wrong" : ""} ${locked ? "one-of-three-option--locked" : ""}`}
                      onClick={() => handleOptionClick(index)}
                      disabled={locked}
                    >
                      {opt.ru}
                    </button>
                  ))}
                </div>
                {showNext && (
                  <button className="puzzle-next-word-btn danetka-next" type="button" onClick={goNextWord}>
                    Далее (Enter)
                  </button>
                )}
              </>
            )}
          </div>

          {showResult && (
            <div className="modal puzzle-result-modal-backdrop">
              <div
                className="modal-content puzzle-result-modal"
                role="dialog"
                aria-labelledby="one-of-three-result-title"
                aria-describedby="one-of-three-result-score-block"
              >
                <header className="puzzle-result-hero">
                  <h2 id="one-of-three-result-title" className="puzzle-result-title">
                    {endedByTime ? "Время вышло!" : "Игра завершена"}
                  </h2>
                  <div id="one-of-three-result-score-block" className="puzzle-result-score-block">
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
                      <ResultWordTile
                        key={`${item.word.id}-${index}`}
                        word={item.word}
                        progressBefore={item.progressBefore}
                        progressAfter={item.progressAfter}
                        hadError={item.hadError}
                        isLoggedIn={!!user}
                      />
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

export default OneOfThreeExercise;
