import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDictionary } from "../../features/dictionary/useDictionary";
import { calculateXp, formatXp } from "../../domain/xp";
import { authService } from "../../services/authService";
import { guestPendingResultService, type PendingWordUpdate } from "../../services/guestPendingResultService";
import { progressService } from "../../services/progressService";
import { useAuth } from "../../features/auth/AuthContext";
import { gameTelemetryService } from "../../services/gameTelemetryService";
import { playErrorSound, speakWord } from "../../utils/sounds";
import { ResultWordTile } from "../common/ResultWordTile";
import {
  GATES_A0_CONFIG,
  GATES_A0_DICTIONARY_LEVEL,
} from "../../domain/exercises/gates/config";
import {
  calculateDamage,
  checkAssembleAnswer,
  checkFillGapAnswer,
  checkTranslateAnswer,
  getTimerDelta,
} from "../../domain/exercises/gates/engine";
import { createGateTask, getA0GeneralWords } from "../../domain/exercises/gates/taskFactory";
import type { GateRunStats, GateTask } from "../../domain/exercises/gates/types";
import AssembleWordTask from "./gates-tasks/AssembleWordTask";
import TranslateWordTask from "./gates-tasks/TranslateWordTask";
import FillGapTask from "./gates-tasks/FillGapTask";

type Phase = "battle" | "gate-clear" | "run-win" | "run-fail";

type SessionWordResult = {
  id: string;
  word: GateTask["word"];
  progressBefore: number;
  progressAfter: number;
  hadError: boolean;
};

const INITIAL_RUN_STATS: GateRunStats = {
  totalXp: 0,
  totalDamage: 0,
  totalAnswers: 0,
  correctAnswers: 0,
  mistakes: 0,
  gateCleared: 0,
};

const ANSWER_LOCK_MS = 320;

const formatTimer = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

const GatesOfKnowledgeExercise: React.FC = () => {
  const navigate = useNavigate();
  const { user, refresh: refreshUser } = useAuth();
  const { words: dictionaryWords, loading: wordsLoading } = useDictionary();

  const [phase, setPhase] = useState<Phase>("battle");
  const [gateIndex, setGateIndex] = useState(0);
  const [bossHp, setBossHp] = useState(GATES_A0_CONFIG[0].bossHpMax);
  const [timeLeft, setTimeLeft] = useState(GATES_A0_CONFIG[0].timeLimitSec);
  const [timerRunning, setTimerRunning] = useState(false);
  const [combo, setCombo] = useState(0);
  const [status, setStatus] = useState("Наносите урон правильными ответами.");
  const [activeTask, setActiveTask] = useState<GateTask | null>(null);
  const [answerLocked, setAnswerLocked] = useState(false);
  const [lastDamage, setLastDamage] = useState<number | null>(null);
  const [runStats, setRunStats] = useState<GateRunStats>(INITIAL_RUN_STATS);
  const [sessionWords, setSessionWords] = useState<SessionWordResult[]>([]);
  const [showResultModal, setShowResultModal] = useState(false);

  const runFinishedRef = useRef(false);
  const taskTypeRef = useRef<GateTask["type"] | null>(null);
  const usedWordIdsRef = useRef<Set<number>>(new Set());
  const lockTimerRef = useRef<number | null>(null);
  const pendingWordUpdatesRef = useRef<PendingWordUpdate[]>([]);
  const guestProgressRef = useRef<Record<number, number>>({});
  const runStatsRef = useRef<GateRunStats>(INITIAL_RUN_STATS);

  const a0Words = useMemo(
    () => getA0GeneralWords(dictionaryWords).filter((word) => word.level === GATES_A0_DICTIONARY_LEVEL),
    [dictionaryWords]
  );
  const gateConfig = GATES_A0_CONFIG[gateIndex];
  const bossHpPercent = Math.max(0, Math.min(100, (bossHp / gateConfig.bossHpMax) * 100));
  const timePercent = Math.max(0, Math.min(100, (timeLeft / gateConfig.timeLimitSec) * 100));

  useEffect(() => {
    runStatsRef.current = runStats;
  }, [runStats]);

  const createAndSetTask = useCallback(
    (gateId: number) => {
      if (a0Words.length === 0) return;
      const task = createGateTask({
        gateId,
        availableWords: a0Words,
        usedWordIds: usedWordIdsRef.current,
        previousTaskType: taskTypeRef.current,
      });
      taskTypeRef.current = task.type;
      setActiveTask(task);
    },
    [a0Words]
  );

  const beginGate = useCallback(
    (nextGateIndex: number) => {
      const config = GATES_A0_CONFIG[nextGateIndex];
      setGateIndex(nextGateIndex);
      setBossHp(config.bossHpMax);
      setTimeLeft(config.timeLimitSec);
      setTimerRunning(false);
      setCombo(0);
      setLastDamage(null);
      setPhase("battle");
      setStatus(`Врата ${config.id}: ${config.theme}`);
      createAndSetTask(config.id);
      gameTelemetryService.track("gate_start", {
        gateId: config.id,
        bossName: config.bossName,
        hpMax: config.bossHpMax,
        timeLimitSec: config.timeLimitSec,
      });
    },
    [createAndSetTask]
  );

  const persistRunStats = useCallback(
    (isWin: boolean) => {
      const finalStats = runStatsRef.current;
      const earnedXp = finalStats.totalXp;
      const wordUpdates = pendingWordUpdatesRef.current;

      if (user) {
        const stats = authService.getCurrentUser()?.stats;
        authService.updateUserStats(
          {
            totalXp: (stats?.totalXp ?? stats?.totalScore ?? 0) + earnedXp,
            exercisesCompleted: (stats?.exercisesCompleted ?? 0) + 1,
            bestScore: Math.max(stats?.bestScore ?? 0, earnedXp),
          },
          { xpEarnedToday: earnedXp }
        );
        setTimeout(() => refreshUser(), 0);
      } else {
        guestPendingResultService.addGameResult("gates-of-knowledge", earnedXp, wordUpdates);
      }

      gameTelemetryService.track(isWin ? "run_completed" : "run_failed", {
        totalXp: earnedXp,
        totalDamage: finalStats.totalDamage,
        totalAnswers: finalStats.totalAnswers,
        correctAnswers: finalStats.correctAnswers,
        mistakes: finalStats.mistakes,
        gateCleared: finalStats.gateCleared,
      });
    },
    [refreshUser, user]
  );

  const finishRun = useCallback(
    (isWin: boolean) => {
      if (runFinishedRef.current) return;
      runFinishedRef.current = true;
      setTimerRunning(false);
      setAnswerLocked(true);
      setActiveTask(null);
      setPhase(isWin ? "run-win" : "run-fail");
      setShowResultModal(true);
      setStatus(isWin ? "Все 5 врат пройдены!" : "Время вышло. Попробуйте снова.");
      persistRunStats(isWin);
    },
    [persistRunStats]
  );

  useEffect(() => {
    if (wordsLoading || a0Words.length === 0) return;
    beginGate(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsLoading, a0Words.length]);

  useEffect(() => {
    if (!timerRunning || phase !== "battle") return;
    const id = window.setInterval(() => {
      setTimeLeft((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          window.clearInterval(id);
          finishRun(false);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [finishRun, phase, timerRunning]);

  useEffect(() => {
    return () => {
      if (lockTimerRef.current != null) {
        window.clearTimeout(lockTimerRef.current);
      }
    };
  }, []);

  const applyProgressUpdate = (wordId: number, isCorrect: boolean): { before: number; after: number } => {
    if (user) {
      const before = progressService.getWordProgressValue(wordId, "beginner");
      progressService.updateWordProgress(wordId, isCorrect, "beginner");
      const after = progressService.getWordProgressValue(wordId, "beginner");
      pendingWordUpdatesRef.current.push({ wordId, progressType: "beginner", progressValue: after });
      return { before, after };
    }

    const before = guestProgressRef.current[wordId] ?? 0;
    const after = Math.max(0, Math.min(100, before + (isCorrect ? 1 : -1)));
    guestProgressRef.current[wordId] = after;
    pendingWordUpdatesRef.current.push({ wordId, progressType: "beginner", progressValue: after });
    return { before, after };
  };

  const handleAnswer = (rawInput: string) => {
    if (!activeTask || phase !== "battle" || answerLocked || runFinishedRef.current) return;

    const gate = GATES_A0_CONFIG[gateIndex];
    setAnswerLocked(true);
    if (lockTimerRef.current != null) window.clearTimeout(lockTimerRef.current);
    lockTimerRef.current = window.setTimeout(() => setAnswerLocked(false), ANSWER_LOCK_MS);

    if (!timerRunning) setTimerRunning(true);

    const result =
      activeTask.type === "assemble"
        ? checkAssembleAnswer(rawInput, activeTask.expected)
        : activeTask.type === "translate"
          ? checkTranslateAnswer(rawInput, activeTask)
          : checkFillGapAnswer(rawInput, activeTask.expected);

    const timerDelta = getTimerDelta(activeTask.type, result.isCorrect);
    const nextTime = Math.max(0, timeLeft + timerDelta);
    setTimeLeft(nextTime);

    const progress = applyProgressUpdate(activeTask.word.id, result.isCorrect);
    const xpEarned = calculateXp({
      level: activeTask.word.level,
      exerciseType: "BEGINNER",
      gameType: "GATES_OF_KNOWLEDGE",
      isCorrect: result.isCorrect,
    });

    setSessionWords((prev) => [
      ...prev,
      {
        id: `${activeTask.id}-${prev.length}`,
        word: activeTask.word,
        progressBefore: progress.before,
        progressAfter: progress.after,
        hadError: !result.isCorrect,
      },
    ]);

    const nextCombo = result.isCorrect ? combo + 1 : 0;
    setCombo(nextCombo);

    const damage = result.isCorrect
      ? calculateDamage(activeTask.type, nextCombo, gate.difficultyMultiplier)
      : 0;
    const nextBossHp = Math.max(0, bossHp - damage);
    setBossHp(nextBossHp);
    setLastDamage(result.isCorrect ? damage : null);

    if (!result.isCorrect) {
      playErrorSound();
    } else {
      speakWord(activeTask.word.en, activeTask.word.accent ?? "both", undefined);
    }

    const nextStats: GateRunStats = {
      totalXp: runStatsRef.current.totalXp + xpEarned,
      totalDamage: runStatsRef.current.totalDamage + damage,
      totalAnswers: runStatsRef.current.totalAnswers + 1,
      correctAnswers: runStatsRef.current.correctAnswers + (result.isCorrect ? 1 : 0),
      mistakes: runStatsRef.current.mistakes + (result.isCorrect ? 0 : 1),
      gateCleared: runStatsRef.current.gateCleared,
    };

    runStatsRef.current = nextStats;
    setRunStats(nextStats);

    gameTelemetryService.track("task_answered", {
      gateId: gate.id,
      taskType: activeTask.type,
      isCorrect: result.isCorrect,
      timerDelta,
      combo: nextCombo,
    });
    if (result.isCorrect) {
      gameTelemetryService.track("boss_damaged", {
        gateId: gate.id,
        damage,
        bossHpLeft: nextBossHp,
      });
    }

    if (nextTime <= 0) {
      finishRun(false);
      return;
    }

    if (nextBossHp <= 0) {
      const gatesCleared = nextStats.gateCleared + 1;
      const statsWithClear = { ...nextStats, gateCleared: gatesCleared };
      runStatsRef.current = statsWithClear;
      setRunStats(statsWithClear);
      setTimerRunning(false);
      setPhase("gate-clear");
      setStatus(`Врата ${gate.id} повержены.`);
      gameTelemetryService.track("gate_clear", { gateId: gate.id, gatesCleared });
      if (gateIndex >= GATES_A0_CONFIG.length - 1) {
        finishRun(true);
      }
      return;
    }

    setStatus(
      result.isCorrect
        ? `Попадание! -${damage} HP`
        : "Промах. Комбо сброшено."
    );
    createAndSetTask(gate.id);
  };

  const goToNextGate = () => {
    if (phase !== "gate-clear") return;
    if (gateIndex >= GATES_A0_CONFIG.length - 1) {
      finishRun(true);
      return;
    }
    beginGate(gateIndex + 1);
  };

  const restartRun = () => {
    pendingWordUpdatesRef.current = [];
    guestProgressRef.current = {};
    usedWordIdsRef.current = new Set();
    taskTypeRef.current = null;
    runFinishedRef.current = false;
    runStatsRef.current = INITIAL_RUN_STATS;
    setRunStats(INITIAL_RUN_STATS);
    setSessionWords([]);
    setShowResultModal(false);
    setAnswerLocked(false);
    beginGate(0);
  };

  if (wordsLoading) {
    return (
      <div className="exercise-area">
        <p className="dictionary-subtitle">Загрузка словаря…</p>
      </div>
    );
  }

  if (a0Words.length === 0) {
    return (
      <div className="exercise-area">
        <div className="game-empty-personal">
          <p>Для режима «Врата познаний» не найдено слов уровня A0 в общем словаре.</p>
          <p>Проверьте загрузку словаря и повторите попытку.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="exercise-area gates-root">
      <div className="gates-hud">
        <div className="gates-hud-top">
          <div>
            <span className="lesson-label">Врата {gateConfig.id}/5</span>
            <h1 className="lesson-title gates-boss-title">{gateConfig.bossName}</h1>
            <p className="dictionary-subtitle">{gateConfig.theme}</p>
          </div>
          <div className={`gates-timer ${timeLeft < 10 ? "gates-timer--warning" : ""}`} aria-live="polite">
            ⏱ {formatTimer(timeLeft)}
          </div>
        </div>

        <div className="gates-bars">
          <div className="gates-bar-row">
            <span>HP босса</span>
            <strong>{bossHp}/{gateConfig.bossHpMax}</strong>
          </div>
          <div className="progress-bar gates-hp-bar">
            <div className="gates-hp-fill" style={{ width: `${bossHpPercent}%` }} />
          </div>
          <div className="gates-bar-row">
            <span>Время</span>
            <strong>{formatTimer(timeLeft)}</strong>
          </div>
          <div className="progress-bar gates-time-bar">
            <div className="gates-time-fill" style={{ width: `${timePercent}%` }} />
          </div>
        </div>

        <div className="gates-stats-strip">
          <span>Комбо: x{combo}</span>
          <span>XP: {formatXp(runStats.totalXp)}</span>
          <span>Урон: {runStats.totalDamage}</span>
          <span>Ошибки: {runStats.mistakes}</span>
        </div>
      </div>

      <div className="gates-battle-zone">
        {lastDamage != null && phase === "battle" && (
          <div className="gates-damage-pop" aria-live="polite">
            -{lastDamage}
          </div>
        )}
        <p className="gates-status" aria-live="polite">{status}</p>

        {phase === "battle" && activeTask?.type === "assemble" && (
          <AssembleWordTask key={activeTask.id} task={activeTask} disabled={answerLocked} onSubmit={handleAnswer} />
        )}
        {phase === "battle" && activeTask?.type === "translate" && (
          <TranslateWordTask key={activeTask.id} task={activeTask} disabled={answerLocked} onSubmit={handleAnswer} />
        )}
        {phase === "battle" && activeTask?.type === "fill-gap" && (
          <FillGapTask key={activeTask.id} task={activeTask} disabled={answerLocked} onSubmit={handleAnswer} />
        )}

        {phase === "gate-clear" && (
          <div className="gates-gate-clear-card">
            <h3>Врата {gateConfig.id} открыты</h3>
            <p>Босс повержен. Подготовьтесь к следующей зоне.</p>
            <button type="button" className="primary-btn" onClick={goToNextGate}>
              К следующим вратам
            </button>
          </div>
        )}
      </div>

      {showResultModal && (phase === "run-win" || phase === "run-fail") && (
        <div className="modal">
          <div className="modal-content gates-result-modal">
            <h2>{phase === "run-win" ? "Победа во всех вратах!" : "Забег завершён"}</h2>
            {phase === "run-fail" && (
              <p className="dictionary-subtitle">
                Время закончилось, а у текущего босса осталось <strong>{bossHp}</strong> HP.
              </p>
            )}
            <div className="gates-result-grid">
              <div className="gates-result-cell">
                <span>Открыто врат</span>
                <strong>{runStats.gateCleared}/5</strong>
              </div>
              <div className="gates-result-cell">
                <span>XP</span>
                <strong>{formatXp(runStats.totalXp)}</strong>
              </div>
              <div className="gates-result-cell">
                <span>Урон</span>
                <strong>{runStats.totalDamage}</strong>
              </div>
              <div className="gates-result-cell">
                <span>Точность</span>
                <strong>
                  {runStats.totalAnswers > 0
                    ? `${Math.round((runStats.correctAnswers / runStats.totalAnswers) * 100)}%`
                    : "0%"}
                </strong>
              </div>
              <div className="gates-result-cell">
                <span>Правильных ответов</span>
                <strong>{runStats.correctAnswers}</strong>
              </div>
              <div className="gates-result-cell">
                <span>Ошибок</span>
                <strong>{runStats.mistakes}</strong>
              </div>
            </div>

            <section className="puzzle-result-words-section" aria-label="Прогресс по словам">
              <h3 className="puzzle-result-words-heading">Прогресс по словам</h3>
              <ul className="puzzle-result-words-grid" aria-label="Список слов и прогресс">
                {sessionWords.slice(-20).map((item) => (
                  <ResultWordTile
                    key={item.id}
                    word={item.word}
                    progressBefore={item.progressBefore}
                    progressAfter={item.progressAfter}
                    hadError={item.hadError}
                    isLoggedIn={!!user}
                  />
                ))}
              </ul>
            </section>

            <footer className="gates-result-actions">
              <button type="button" className="primary-btn" onClick={restartRun}>
                Играть снова
              </button>
              <button type="button" className="primary-btn gates-secondary-btn" onClick={() => navigate("/")}>
                На главную
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default GatesOfKnowledgeExercise;
