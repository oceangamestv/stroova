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
import { calculateXp, formatXp } from "../../domain/xp";

const DANETKA_TIMER_INITIAL_SEC = 60;

type SessionWordEntry = {
  word: Word;
  progressBefore: number;
  progressAfter: number;
  hadError: boolean;
};

type Option = { ru: string; isCorrect: boolean };

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
  const wrongRu: string[] = [];
  for (const w of others) {
    if (wrongRu.length >= 2) break;
    if (!wrongRu.includes(w.ru)) wrongRu.push(w.ru);
  }
  while (wrongRu.length < 2 && others.length > 0) {
    wrongRu.push(others[wrongRu.length % others.length].ru);
    if (wrongRu.length >= 2) break;
  }
  const options: Option[] = [
    { ru: correctRu, isCorrect: true },
    ...wrongRu.slice(0, 2).map((ru) => ({ ru, isCorrect: false })),
  ];
  return shuffle(options);
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
  const [timeLeft, setTimeLeft] = useState(DANETKA_TIMER_INITIAL_SEC);
  const [timerRunning, setTimerRunning] = useState(false);
  const [endedByTime, setEndedByTime] = useState(false);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [selectedWrongIndex, setSelectedWrongIndex] = useState<number | null>(null);

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
      dictionarySource
    );
  }, [dictionaryWords, wordsLoading, dictionarySource]);

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
        gameType: "DANETKA",
        isCorrect: true,
      });
      setSessionXp((prev) => prev + xpEarned);
      progressService.updateWordProgress(currentWord.id, true, progressType);
      const progressAfter = progressService.getWordProgressValue(currentWord.id, progressType);
      setSessionWords((prev) => [
        ...prev,
        { word: currentWord, progressBefore, progressAfter, hadError: false },
      ]);
      setTimeLeft((prev) => Math.max(0, prev + 1));
      speakWord(currentWord.en, currentWord.accent || "both");
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
    setTimeLeft((prev) => {
      const next = Math.max(0, prev - 1);
      if (next === 0) endGameByTime();
      return next;
    });
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
    setTimeLeft(DANETKA_TIMER_INITIAL_SEC);
    setTimerRunning(false);
    setEndedByTime(false);
    setCorrectIndex(null);
    setSelectedWrongIndex(null);
    const next = pickNextWord();
    setCurrentWord(next);
    setOptions(next ? buildOptions(next, poolWords) : []);
  };

  const progressPercent = (timeLeft / DANETKA_TIMER_INITIAL_SEC) * 100;
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
              <h1 className="lesson-title">Данетка</h1>
            </div>
            <div className="progress">
              <div className="progress-text">
                <span>{`Слов: ${sessionWords.length}`}</span>
                <span>{`Опыт: ${formatXp(sessionXp)}`}</span>
                <span
                  className="puzzle-timer"
                  aria-live="polite"
                  title={
                    !timerRunning && timeLeft === DANETKA_TIMER_INITIAL_SEC
                      ? "Таймер запустится после первого ответа"
                      : undefined
                  }
                >
                  ⏱ {formatTimer(timeLeft)}
                </span>
              </div>
              <div className="progress-bar">
                <div id="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          </div>

          <div className="danetka-exercise" id="danetka-exercise">
            {currentWord && (
              <>
                <p className="danetka-word" aria-label={`Слово: ${currentWord.en}`}>
                  {currentWord.en}
                </p>
                <div className="danetka-options" role="group" aria-label="Варианты перевода">
                  {options.map((opt, index) => (
                    <button
                      key={`${opt.ru}-${index}`}
                      type="button"
                      className={`danetka-option ${correctIndex === index ? "danetka-option--correct" : ""} ${selectedWrongIndex === index ? "danetka-option--wrong" : ""} ${locked ? "danetka-option--locked" : ""}`}
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

export default DanetkaExercise;
