import React from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/common/Header";
import PairsExercise from "../components/exercises/PairsExercise";
import PuzzleExercise from "../components/exercises/PuzzleExercise";
import DanetkaExercise from "../components/exercises/DanetkaExercise";
import OneOfThreeExercise from "../components/exercises/OneOfThreeExercise";

const ExercisesPage: React.FC = () => {
  const { pathname } = useLocation();
  const exercise: "pairs" | "puzzle" | "danetka" | "one-of-three" =
    pathname === "/puzzle"
      ? "puzzle"
      : pathname === "/danetka"
        ? "danetka"
        : pathname === "/one-of-three"
          ? "one-of-three"
          : "pairs";

  return (
    <div className="app-shell app-shell--game">
      <Header />
      <main className="main">
        <section className="lesson-card">
          {exercise === "pairs" && <PairsExercise />}
          {exercise === "puzzle" && <PuzzleExercise />}
          {exercise === "danetka" && <DanetkaExercise />}
          {exercise === "one-of-three" && <OneOfThreeExercise />}
        </section>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default ExercisesPage;
