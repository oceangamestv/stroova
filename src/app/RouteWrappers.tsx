import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "../hooks/useIsMobile";
import ExercisesPage from "../pages/ExercisesPage";
import GameHubPage from "../pages/GameHubPage";
import GameOnlyLayout from "../components/layout/GameOnlyLayout";
import GameIntroScreen from "../components/game-intro/GameIntroScreen";
import type { GameSlug } from "../components/game-intro/GameIntroScreen";
import PairsExercise from "../components/exercises/PairsExercise";
import PuzzleExercise from "../components/exercises/PuzzleExercise";
import DanetkaExercise from "../components/exercises/DanetkaExercise";
import OneOfThreeExercise from "../components/exercises/OneOfThreeExercise";

/**
 * Главная: на мобильном — гейм-хаб, на десктопе — текущая главная (игра «Пара»).
 */
export const HomeOrHub: React.FC = () => {
  const isMobile = useIsMobile();
  if (isMobile) return <GameHubPage />;
  return <ExercisesPage />;
};

/**
 * Маршруты игр: на мобильном — сначала экран с описанием и настройками, затем игра в GameOnlyLayout.
 */
export const GameRoute: React.FC = () => {
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const [showIntro, setShowIntro] = useState(true);

  const exercise: GameSlug =
    pathname === "/puzzle"
      ? "puzzle"
      : pathname === "/danetka"
        ? "danetka"
        : pathname === "/one-of-three"
          ? "one-of-three"
          : "pairs";

  useEffect(() => {
    setShowIntro(true);
  }, [pathname]);

  if (isMobile) {
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
      ) : (
        <PairsExercise />
      );
    return (
      <GameOnlyLayout backIconOnly={exercise === "pairs"}>
        <section className="lesson-card">{content}</section>
      </GameOnlyLayout>
    );
  }

  return <ExercisesPage />;
};
