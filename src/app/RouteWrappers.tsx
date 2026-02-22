import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import GameHubPage from "../pages/GameHubPage";
import GameOnlyLayout from "../components/layout/GameOnlyLayout";
import GameIntroScreen from "../components/game-intro/GameIntroScreen";
import type { GameSlug } from "../components/game-intro/GameIntroScreen";
import PairsExercise from "../components/exercises/PairsExercise";
import PuzzleExercise from "../components/exercises/PuzzleExercise";
import WordSearchGame from "../components/exercises/WordSearchGame";
import DanetkaExercise from "../components/exercises/DanetkaExercise";
import OneOfThreeExercise from "../components/exercises/OneOfThreeExercise";
import GatesOfKnowledgeExercise from "../components/exercises/GatesOfKnowledgeExercise";
import { useAuth } from "../features/auth/AuthContext";
import { useDictionary } from "../features/dictionary/useDictionary";
import { personalDictionaryService } from "../services/personalDictionaryService";
import { getSoundEnabled, ensureMediaPlaybackOnIOS } from "../utils/sounds";

/**
 * Главная: и на мобильном, и на десктопе — гейм-хаб (одинаковый сценарий и стиль).
 */
export const HomeOrHub: React.FC = () => {
  return <GameHubPage />;
};

/**
 * Маршруты игр: сначала экран с описанием и настройками, затем игра в минимальном layout (мобильный и десктоп).
 */
export const GameRoute: React.FC = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [showIntro, setShowIntro] = useState(true);
  const { words: dictionaryWords, loading: wordsLoading } = useDictionary();

  const exercise: GameSlug =
    pathname === "/puzzle"
      ? "puzzle"
      : pathname === "/word-search"
        ? "word-search"
      : pathname === "/danetka"
        ? "danetka"
        : pathname === "/one-of-three"
          ? "one-of-three"
          : pathname === "/gates-of-knowledge"
            ? "gates-of-knowledge"
            : "pairs";

  const personalWords = personalDictionaryService.getPersonalWordsFromPool(dictionaryWords);
  const personalWordIds = new Set(personalWords.map((word) => word.id));
  const globalWords = dictionaryWords.filter((word) => !personalWordIds.has(word.id));

  const toDictionaryWords = (words: typeof dictionaryWords) =>
    words.map((word) => ({
      id: String(word.id),
      value: word.en.trim().toLowerCase(),
    }));

  useEffect(() => {
    setShowIntro(true);
  }, [pathname]);

  useEffect(() => {
    if (!showIntro && getSoundEnabled()) {
      ensureMediaPlaybackOnIOS();
    }
  }, [showIntro, exercise]);

  if (showIntro) {
    return (
      <GameOnlyLayout backIconOnly={false}>
        <section className="lesson-card game-intro-card">
          <GameIntroScreen gameSlug={exercise} onStart={() => setShowIntro(false)} />
        </section>
      </GameOnlyLayout>
    );
  }

  const content =
    exercise === "puzzle" ? (
      <PuzzleExercise />
    ) : exercise === "word-search" ? (
      wordsLoading ? (
        <div className="exercise-area">
          <p className="dictionary-subtitle">Загрузка словаря…</p>
        </div>
      ) : (
        <WordSearchGame
          globalDictionary={toDictionaryWords(globalWords)}
          userDictionary={toDictionaryWords(personalWords)}
          gridSize={user?.gameSettings?.wordSearchGridSize ?? "small"}
          mode="mixed"
          allowEmptyCells={true}
        />
      )
    ) : exercise === "danetka" ? (
      <DanetkaExercise />
    ) : exercise === "one-of-three" ? (
      <OneOfThreeExercise />
    ) : exercise === "gates-of-knowledge" ? (
      <GatesOfKnowledgeExercise />
    ) : (
      <PairsExercise />
    );

  return (
    <GameOnlyLayout backIconOnly={exercise === "pairs"}>
      {content}
    </GameOnlyLayout>
  );
};
