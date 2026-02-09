import React from "react";
import { Link } from "react-router-dom";
import Header from "../components/common/Header";

const GAMES = [
  {
    to: "/pairs",
    title: "Поиск пары",
    description: "Найдите пару: английское слово и русский перевод. Тренирует запоминание и скорость.",
  },
  {
    to: "/puzzle",
    title: "Puzzle Words",
    description: "Соберите слово из букв по переводу. Удобно для запоминания написания и перевода.",
  },
  {
    to: "/danetka",
    title: "Данетка",
    description: "Выберите правильный перевод из нескольких вариантов. Проверка словарного запаса.",
  },
] as const;

/**
 * Гейм-хаб: список игр с описаниями. Показывается на мобильной главной (/).
 */
const GameHubPage: React.FC = () => {
  return (
    <div className="app-shell">
      <Header />
      <main className="main">
        <section className="game-hub">
          <h1 className="game-hub__title">Игры</h1>
          <p className="game-hub__subtitle">Выберите игру и нажмите, чтобы начать.</p>
          <ul className="game-hub__list" role="list">
            {GAMES.map((game) => (
              <li key={game.to}>
                <Link to={game.to} className="game-hub__card">
                  <h2 className="game-hub__card-title">{game.title}</h2>
                  <p className="game-hub__card-desc">{game.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default GameHubPage;
