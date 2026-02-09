import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Word } from "../../data/contracts/types";
import { useDictionary } from "../../features/dictionary/useDictionary";
import type { DictionarySource } from "../../services/dictionaryService";
import { dictionaryService } from "../../services/dictionaryService";
import { personalDictionaryService } from "../../services/personalDictionaryService";
import { progressService } from "../../services/progressService";
import { speakWord, playErrorSound } from "../../utils/sounds";
import { buildPairsCards, isMatch, PairsCard } from "../../domain/exercises/pairs";
import { authService } from "../../services/authService";
import { guestPendingResultService } from "../../services/guestPendingResultService";
import { useAuth } from "../../features/auth/AuthContext";
import { calculateXp, formatXp } from "../../domain/xp";
import { useIsMobile } from "../../hooks/useIsMobile";

/** Результат по слову за всю игру: одна запись на слово, progressAfter считаем при показе модалки */
type SessionWordEntry = {
  word: Word;
  progressBefore: number;
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

const PAIRS_STAGES_TOTAL = 5;
const PAIRS_PER_STAGE = 5;

const PairsExercise: React.FC = () => {
  const { user, refresh: refreshUser } = useAuth();
  const { words: dictionaryWords, loading: wordsLoading } = useDictionary();
  const navigate = useNavigate();
  const dictionarySource: DictionarySource =
    user?.gameSettings?.dictionarySource ?? (user ? "personal" : "general");
  const [stage, setStage] = useState(1);
  const [cards, setCards] = useState<PairsCard[]>([]);
  const [stageWords, setStageWords] = useState<Word[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [matchedCount, setMatchedCount] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [status, setStatus] = useState("Собери пары английского и русского слова.");
  const [locked, setLocked] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [sessionWords, setSessionWords] = useState<SessionWordEntry[]>([]);
  /** Слова, по которым в текущем раунде уже была ошибка — при верной паре прогресс не увеличиваем */
  const [wordsWithErrorThisStage, setWordsWithErrorThisStage] = useState<Set<number>>(new Set());
  const [wrongIndices, setWrongIndices] = useState<number[]>([]);
  const stageCompletedRef = useRef<number>(0);
  const sessionXpRef = useRef<number>(0);
  const sessionWordsRef = useRef<SessionWordEntry[]>([]);
  const stageTransitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // После смены этапа в том же цикле matchedCount ещё 5 (старый). Пропускаем завершение этапа только при реальной смене этапа.
  const justChangedStageRef = useRef<boolean>(false);
  const prevStageRef = useRef<number>(1);

  useEffect(() => {
    sessionXpRef.current = sessionXp;
  }, [sessionXp]);
  useEffect(() => {
    sessionWordsRef.current = sessionWords;
  }, [sessionWords]);

  const setDictionarySource = (source: DictionarySource) => {
    authService.updateGameSettings({ dictionarySource: source });
    refreshUser();
  };

  useEffect(() => {
    if (wordsLoading || dictionaryWords.length === 0) return;
    // Сбрасываем выбранную карточку сразу при изменении этапа
    setSelectedIndex(null);
    if (prevStageRef.current !== stage) {
      justChangedStageRef.current = true;
      prevStageRef.current = stage;
    }
    const words = dictionaryService.getRandomWordsForGameFromPool(
      dictionaryWords,
      PAIRS_PER_STAGE,
      "both",
      "beginner",
      dictionarySource
    );
    setStageWords(words);
    setCards(buildPairsCards(words));
    setMatchedCount(0);
    setWordsWithErrorThisStage(new Set());
    setStatus(`Этап ${stage} из ${PAIRS_STAGES_TOTAL}. Найди пары.`);
    if (stageTransitionTimeoutRef.current) {
      clearTimeout(stageTransitionTimeoutRef.current);
      stageTransitionTimeoutRef.current = null;
    }
  }, [stage, dictionarySource, dictionaryWords, wordsLoading]);

  const handleCardClick = (index: number) => {
    if (locked) return;
    const card = cards[index];
    if (!card || card.matched) return;

    if (selectedIndex === null) {
      setSelectedIndex(index);
      setStatus("Теперь выбери подходящую пару.");
      return;
    }

    if (selectedIndex === index) return;

    const selected = cards[selectedIndex];
    if (selected.type === card.type) {
      setSelectedIndex(index);
      const typeLabel = card.type === "en" ? "английское" : "русское";
      setStatus(`Выбрано ${typeLabel} слово. Теперь выбери слово другого языка.`);
      return;
    }

    setLocked(true);

    if (isMatch(selected, card, stageWords)) {
      const updated = cards.map((c) =>
        c.index === selected.index || c.index === card.index ? { ...c, matched: true } : c
      );
      setCards(updated);
      setMatchedCount((prev) => prev + 1);

      const enLabel = selected.type === "en" ? selected.label : card.label;
      const ruLabel = selected.type === "ru" ? selected.label : card.label;
      const wordData = stageWords.find((w) => w.en === enLabel && w.ru === ruLabel);
      const wordId = wordData?.id ?? selected.pairId;
      const hadErrorThisStage = wordsWithErrorThisStage.has(wordId);
      // Если по этой паре уже была ошибка на этапе — не начисляем опыт и не обновляем прогресс слова.
      const xpEarned =
        !hadErrorThisStage && wordData
          ? calculateXp({
              level: wordData.level,
              exerciseType: "BEGINNER",
              gameType: "PAIR_MATCH",
              isCorrect: true,
              wordsCount: 1,
            })
          : 0;
      if (xpEarned > 0) setSessionXp((prev) => prev + xpEarned);
      const progressBefore = wordData
        ? progressService.getWordProgressValue(wordData.id, "beginner")
        : 0;
      if (!hadErrorThisStage && wordData) {
        progressService.updateWordProgress(wordId, true, "beginner");
      }
      if (wordData) {
        setSessionWords((prev) => {
          const existing = prev.find((x) => x.word.id === wordId);
          if (existing) {
            return prev.map((x) =>
              x.word.id === wordId ? { ...x, hadError: x.hadError || false } : x
            );
          }
          return [...prev, { word: wordData, progressBefore, hadError: false }];
        });
      }

      const englishWord = selected.type === "en" ? selected.label : card.label;
      speakWord(englishWord, wordData?.accent || "both");

      setStatus("Отлично! Ты нашёл правильную пару.");
      setSelectedIndex(null);
      setLocked(false);
    } else {
      // За ошибку опыт не начисляется.
      setTotalErrors((prev) => prev + 1);
      const wordId = selected.pairId;
      const wordData = stageWords.find((w) => w.id === wordId);
      const progressBefore = wordData
        ? progressService.getWordProgressValue(wordData.id, "beginner")
        : 0;
      progressService.updateWordProgress(wordId, false, "beginner");
      setWordsWithErrorThisStage((prev) => new Set(prev).add(wordId));
      if (wordData) {
        setSessionWords((prev) => {
          const existing = prev.find((x) => x.word.id === wordId);
          if (existing) {
            return prev.map((x) =>
              x.word.id === wordId ? { ...x, hadError: true } : x
            );
          }
          return [...prev, { word: wordData, progressBefore, hadError: true }];
        });
      }
      playErrorSound();
      setStatus("Не совсем так. Попробуй ещё раз.");

      setWrongIndices([selected.index, card.index]);
      setTimeout(() => {
        setWrongIndices([]);
        setSelectedIndex(null);
        setLocked(false);
        setStatus("Выбери новую пару карточек.");
      }, 700);
    }
  };

  useEffect(() => {
    if (matchedCount !== PAIRS_PER_STAGE) return;
    if (stageCompletedRef.current >= stage) return;
    if (stageTransitionTimeoutRef.current) return;
    // Только что переключили этап: matchedCount ещё 5 от прошлого этапа — не считаем это завершением текущего
    if (justChangedStageRef.current) {
      justChangedStageRef.current = false;
      if (process.env.NODE_ENV === "development") {
        console.debug("[Pairs] skip completion: just changed stage", { stage, matchedCount });
      }
      return;
    }
    const currentStage = stage;
    stageCompletedRef.current = currentStage;
    // Сбрасываем выбранную карточку при завершении этапа
    setSelectedIndex(null);
    if (process.env.NODE_ENV === "development") {
      console.debug("[Pairs] stage completed", { currentStage, sessionXp: sessionXpRef.current });
    }

    if (currentStage < PAIRS_STAGES_TOTAL) {
      stageTransitionTimeoutRef.current = setTimeout(() => {
        // Дополнительно сбрасываем перед переходом на следующий этап
        setSelectedIndex(null);
        setStage((prev) => {
          if (prev === currentStage && prev < PAIRS_STAGES_TOTAL) {
            if (process.env.NODE_ENV === "development") {
              console.debug("[Pairs] transition", { from: prev, to: prev + 1 });
            }
            return prev + 1;
          }
          return prev;
        });
        stageTransitionTimeoutRef.current = null;
      }, 300);
    } else {
      // Последний этап завершен
      setShowResult(true);
      const earnedXp = sessionXpRef.current;
      const words = sessionWordsRef.current;
      if (user) {
        const stats = authService.getCurrentUser()?.stats;
        authService.updateUserStats(
          {
            totalXp: (stats?.totalXp ?? stats?.totalScore ?? 0) + earnedXp,
            exercisesCompleted: (stats?.exercisesCompleted || 0) + 1,
            pairsCompleted: (stats?.pairsCompleted || 0) + 1,
            bestScore: Math.max(stats?.bestScore ?? 0, earnedXp),
          },
          { xpEarnedToday: earnedXp }
        );
        setTimeout(() => refreshUser(), 0);
      } else {
        const wordUpdates = words.map((entry) => ({
          wordId: entry.word.id,
          progressType: "beginner" as const,
          progressValue: entry.hadError
            ? Math.max(0, entry.progressBefore - 1)
            : Math.min(100, entry.progressBefore + 1),
        }));
        guestPendingResultService.addGameResult("pairs", earnedXp, wordUpdates);
      }
    }
    // Не очищаем таймер здесь: иначе в Strict Mode / при повторном запуске эффекта
    // таймер сбрасывается и этап 2→3 (и далее) не срабатывает.
    // Таймер очищается при смене stage (первый useEffect) и при размонтировании (отдельный эффект ниже).
  }, [matchedCount, stage]);

  // Очистка таймера только при размонтировании компонента
  useEffect(() => {
    return () => {
      if (stageTransitionTimeoutRef.current) {
        clearTimeout(stageTransitionTimeoutRef.current);
        stageTransitionTimeoutRef.current = null;
      }
    };
  }, []);

  // Прогресс показывает завершенные этапы плюс прогресс текущего этапа
  // completedStages - количество полностью завершенных этапов (stage - 1)
  // currentStageProgress - прогресс текущего этапа (0 до 1)
  const completedStages = stage - 1;
  const currentStageProgress = matchedCount / PAIRS_PER_STAGE;
  const progressPercent = ((completedStages + currentStageProgress) / PAIRS_STAGES_TOTAL) * 100;
  const personalWordsCount =
    dictionaryWords.length > 0
      ? personalDictionaryService.getPersonalWordsFromPool(dictionaryWords).length
      : personalDictionaryService.getPersonalWordIds().length;
  const showPersonalEmpty = dictionarySource === "personal" && personalWordsCount === 0;
  const isMobile = useIsMobile();

  if (wordsLoading) {
    return (
      <div className="exercise-area">
        <p className="dictionary-subtitle">Загрузка словаря…</p>
      </div>
    );
  }

  return (
    <div className="exercise-area">
      {!isMobile && (
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
      {isMobile ? (
        <div className="pairs-stages-dots" role="progressbar" aria-valuenow={stage} aria-valuemin={1} aria-valuemax={PAIRS_STAGES_TOTAL} aria-label={`Этап ${stage} из ${PAIRS_STAGES_TOTAL}`}>
          {Array.from({ length: PAIRS_STAGES_TOTAL }, (_, i) => i + 1).map((s) => (
            <span
              key={s}
              className={`pairs-stages-dot ${s < stage ? "pairs-stages-dot--done" : ""} ${s === stage ? "pairs-stages-dot--current" : ""}`}
              aria-hidden
            />
          ))}
        </div>
      ) : (
        <div className="lesson-header">
          <div>
            <span className="lesson-label">Игра</span>
            <h1 className="lesson-title">Поиск пары</h1>
          </div>
          <div className="progress">
            <div className="progress-text">
              <span>{`Этап ${stage} / ${PAIRS_STAGES_TOTAL}`}</span>
              <span id="score-label">Опыт: {formatXp(sessionXp)}</span>
              <span className="progress-stats">
                <span className="stat-correct" aria-label="Правильные ответы">
                  ✓ {matchedCount}
                </span>
                <span className="stat-errors" id="errors-label" aria-label="Ошибки">
                  ✕ {totalErrors}
                </span>
              </span>
            </div>
            <div className="progress-bar">
              <div id="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className={`pairs-exercise ${isMobile ? "pairs-exercise--mobile" : ""}`} id="pairs-exercise">
        <div className="cards-pairs-wrapper" id="cards-grid">
          <div className="cards-column" id="cards-column-english">
          {cards
            .filter((c) => c.type === "en")
            .map((card) => (
              <button
                key={card.index}
                className={`card card--english ${card.matched ? "card--matched" : ""} ${
                  selectedIndex === card.index ? "card--selected" : ""
                } ${wrongIndices.includes(card.index) ? "card--wrong" : ""}`}
                onClick={() => handleCardClick(card.index)}
                type="button"
              >
                {card.accent !== "both" && (
                  <span className="card-accent">
                    {card.accent === "UK" ? "🇬🇧 UK" : "🇺🇸 US"}
                  </span>
                )}
                <span className="card-label">{card.label}</span>
              </button>
            ))}
          </div>
          <div className="cards-column" id="cards-column-russian">
          {cards
            .filter((c) => c.type === "ru")
            .map((card) => (
              <button
                key={card.index}
                className={`card card--russian ${card.matched ? "card--matched" : ""} ${
                  selectedIndex === card.index ? "card--selected" : ""
                } ${wrongIndices.includes(card.index) ? "card--wrong" : ""}`}
                onClick={() => handleCardClick(card.index)}
                type="button"
              >
                <span className="card-label">{card.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {showResult && (
        <div className="modal puzzle-result-modal-backdrop">
          <div
            className="modal-content puzzle-result-modal"
            role="dialog"
            aria-labelledby="pairs-result-title"
            aria-describedby="pairs-result-score-block"
          >
            <header className="puzzle-result-hero">
              <h2 id="pairs-result-title" className="puzzle-result-title">
                Упражнение завершено!
              </h2>
              <div id="pairs-result-score-block" className="puzzle-result-score-block">
                <div className="puzzle-result-score-card puzzle-result-score-card--points">
                  <span className="puzzle-result-score-card-value">{formatXp(sessionXp)}</span>
                  <span className="puzzle-result-score-card-label">Опыт (XP)</span>
                </div>
                <div className="puzzle-result-score-card puzzle-result-score-card--errors">
                  <span className="puzzle-result-score-card-value">{totalErrors}</span>
                  <span className="puzzle-result-score-card-label">Ошибки</span>
                </div>
                <div className="puzzle-result-score-card puzzle-result-score-card--words">
                  <span className="puzzle-result-score-card-value">{PAIRS_STAGES_TOTAL}</span>
                  <span className="puzzle-result-score-card-label">Этапов</span>
                </div>
              </div>
            </header>
            <section className="puzzle-result-words-section" aria-label="Прогресс по словам">
              <h3 className="puzzle-result-words-heading">Прогресс по словам</h3>
              <ul className="puzzle-result-words-grid" aria-label="Список слов и прогресс">
                {sessionWords.map((item) => {
                  const progressAfter = progressService.getWordProgressValue(
                    item.word.id,
                    "beginner"
                  );
                  return (
                    <li
                      key={item.word.id}
                      className={`puzzle-result-word-tile ${item.hadError ? "puzzle-result-word-tile--error" : "puzzle-result-word-tile--success"}`}
                    >
                      <div className="puzzle-result-word-tile-info">
                        <span className="puzzle-result-word-tile-en">{item.word.en}</span>
                        <span className="puzzle-result-word-tile-ru">{item.word.ru}</span>
                      </div>
                      <div className="puzzle-result-word-tile-progress">
                        <span className="puzzle-result-word-tile-percent" aria-hidden>
                          {item.progressBefore}% → {progressAfter}%
                        </span>
                        <AnimatedProgressBar
                          progressBefore={item.progressBefore}
                          progressAfter={progressAfter}
                          hadError={item.hadError}
                        />
                      </div>
                    </li>
                  );
                })}
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
                onClick={() => {
                  setShowResult(false);
                  setStage(1);
                  setMatchedCount(0);
                  setSessionXp(0);
                  setTotalErrors(0);
                  setSessionWords([]);
                  setWordsWithErrorThisStage(new Set());
                  sessionXpRef.current = 0;
                  stageCompletedRef.current = 0;
                  prevStageRef.current = 1;
                  justChangedStageRef.current = false;
                  stageTransitionTimeoutRef.current = null;
                }}
                type="button"
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

export default PairsExercise;
