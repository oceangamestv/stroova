import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import GameHubPage from "../pages/GameHubPage";
import GameOnlyLayout from "../components/layout/GameOnlyLayout";
import GameIntroScreen from "../components/game-intro/GameIntroScreen";
import type { GameSlug } from "../components/game-intro/GameIntroScreen";
import PairsExercise from "../components/exercises/PairsExercise";
import PuzzleExercise from "../components/exercises/PuzzleExercise";
import DanetkaExercise from "../components/exercises/DanetkaExercise";
import OneOfThreeExercise from "../components/exercises/OneOfThreeExercise";
import GatesOfKnowledgeExercise from "../components/exercises/GatesOfKnowledgeExercise";
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
  const [showIntro, setShowIntro] = useState(true);

  const exercise: GameSlug =
    pathname === "/puzzle"
      ? "puzzle"
      : pathname === "/danetka"
        ? "danetka"
        : pathname === "/one-of-three"
          ? "one-of-three"
          : pathname === "/gates-of-knowledge"
            ? "gates-of-knowledge"
            : "pairs";

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
