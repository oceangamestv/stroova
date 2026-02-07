import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Word } from "../../data/contracts/types";
import type { DictionarySource } from "../../services/dictionaryService";
import { dictionaryService } from "../../services/dictionaryService";
import { personalDictionaryService } from "../../services/personalDictionaryService";
import { progressService } from "../../services/progressService";
import { speakWord, playErrorSound } from "../../utils/sounds";
import { buildPairsCards, isMatch, PairsCard } from "../../domain/exercises/pairs";
import { authService } from "../../services/authService";
import { useAuth } from "../../features/auth/AuthContext";
import { calculateXp, formatXp } from "../../domain/xp";

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
  const navigate = useNavigate();
  const dictionarySource: DictionarySource =
    user?.gameSettings?.dictionarySource ?? "general";
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
  const stageTransitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // После смены этапа в том же цикле matchedCount ещё 5 (старый). Пропускаем завершение этапа только при реальной смене этапа.
  const justChangedStageRef = useRef<boolean>(false);
  const prevStageRef = useRef<number>(1);

  useEffect(() => {
    sessionXpRef.current = sessionXp;
  }, [sessionXp]);

  const setDictionarySource = (source: DictionarySource) => {
    authService.updateGameSettings({ dictionarySource: source });
    refreshUser();
  };

  useEffect(() => {
    // Ставим флаг только при реальной смене этапа (не при первом монтировании, когда prevStage === stage)
    if (prevStageRef.current !== stage) {
      justChangedStageRef.current = true;
      prevStageRef.current = stage;
    }
    const words = dictionaryService.getRandomWordsForGame(
      PAIRS_PER_STAGE,
      "both",
      "beginner",
      dictionarySource
    );
    setStageWords(words);
    setCards(buildPairsCards(words));
    setSelectedIndex(null);
    setMatchedCount(0);
    setWordsWithErrorThisStage(new Set());
    setStatus(`Этап ${stage} из ${PAIRS_STAGES_TOTAL}. Найди пары.`);
    if (stageTransitionTimeoutRef.current) {
      clearTimeout(stageTransitionTimeoutRef.current);
      stageTransitionTimeoutRef.current = null;
    }
  }, [stage, dictionarySource]);

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

    if (isMatch(selected, card)) {
      const updated = cards.map((c) =>
        c.index === selected.index || c.index === card.index ? { ...c, matched: true } : c
      );
      setCards(updated);
      setMatchedCount((prev) => prev + 1);

      const wordId = selected.pairId;
      const wordData = stageWords.find((w) => w.id === wordId);
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
    if (process.env.NODE_ENV === "development") {
      console.debug("[Pairs] stage completed", { currentStage, sessionXp: sessionXpRef.current });
    }

    if (currentStage < PAIRS_STAGES_TOTAL) {
      stageTransitionTimeoutRef.current = setTimeout(() => {
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
      }, 1000);
    } else {
      // Последний этап завершен
      setShowResult(true);
      const stats = authService.getCurrentUser()?.stats;
      const earnedXp = sessionXpRef.current;
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
  const personalWordsCount = personalDictionaryService.getPersonalWords().length;
  const showPersonalEmpty = dictionarySource === "personal" && personalWordsCount === 0;

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

      <div className="pairs-exercise" id="pairs-exercise">
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
                <span className="card-tag">EN</span>
                {card.accent !== "both" && (
                  <span className="card-accent">
                    {card.accent === "UK" ? "🇬🇧 UK" : "🇺🇸 US"}
                  </span>
                )}
                <span>{card.label}</span>
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
                <span className="card-tag">RU</span>
                <span>{card.label}</span>
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

export default PairsExercise;
