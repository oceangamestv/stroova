import React from "react";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "../hooks/useIsMobile";
import ExercisesPage from "../pages/ExercisesPage";
import GameHubPage from "../pages/GameHubPage";
import GameOnlyLayout from "../components/layout/GameOnlyLayout";
import PairsExercise from "../components/exercises/PairsExercise";
import PuzzleExercise from "../components/exercises/PuzzleExercise";
import DanetkaExercise from "../components/exercises/DanetkaExercise";

/**
 * Главная: на мобильном — гейм-хаб, на десктопе — текущая главная (игра «Пара»).
 */
export const HomeOrHub: React.FC = () => {
  const isMobile = useIsMobile();
  if (isMobile) return <GameHubPage />;
  return <ExercisesPage />;
};

/**
 * Маршруты игр: на мобильном — только упражнение в GameOnlyLayout, на десктопе — обычная ExercisesPage.
 */
export const GameRoute: React.FC = () => {
  const { pathname } = useLocation();
  const isMobile = useIsMobile();

  const exercise =
    pathname === "/puzzle" ? "puzzle" : pathname === "/danetka" ? "danetka" : "pairs";

  if (isMobile) {
    const content =
      exercise === "puzzle" ? (
        <PuzzleExercise />
      ) : exercise === "danetka" ? (
        <DanetkaExercise />
      ) : (
        <PairsExercise />
      );
    return (
      <GameOnlyLayout>
        <section className="lesson-card">{content}</section>
      </GameOnlyLayout>
    );
  }

  return <ExercisesPage />;
};
