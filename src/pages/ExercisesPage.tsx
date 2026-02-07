import React from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/common/Header";
import PairsExercise from "../components/exercises/PairsExercise";
import PuzzleExercise from "../components/exercises/PuzzleExercise";

const ExercisesPage: React.FC = () => {
  const { pathname } = useLocation();
  const exercise: "pairs" | "puzzle" =
    pathname === "/puzzle" ? "puzzle" : "pairs";

  return (
    <div className="app-shell">
      <Header />
      <main className="main">
        <section className="lesson-card">
          {exercise === "pairs" ? (
            <PairsExercise />
          ) : (
            <PuzzleExercise />
          )}
        </section>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default ExercisesPage;
