import React from "react";
import { Link } from "react-router-dom";
import Header from "../components/common/Header";
import { useIsMobile } from "../hooks/useIsMobile";

/** Иконка: две карточки (поиск пары) */
const IconPairs: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="6" y="8" width="20" height="28" rx="3" />
    <rect x="22" y="12" width="20" height="28" rx="3" />
    <path d="M14 20h8M14 24h6M14 28h8" />
    <path d="M30 24h6M30 28h4M30 32h6" />
  </svg>
);

/** Иконка: пазл (квадрат с выступом) */
const IconPuzzle: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="10" y="18" width="28" height="20" rx="3" />
    <path d="M20 18V12a4 4 0 018 0v6M24 8v4" />
  </svg>
);

/** Иконка: викторина (галочка — выбор ответа) */
const IconDanetka: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="24" cy="24" r="20" />
    <path d="M16 24l6 6 12-12" />
  </svg>
);

/** Иконка: выбор из вариантов (три точки) */
const IconOneOfThree: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="16" cy="24" r="4" />
    <circle cx="24" cy="24" r="4" />
    <circle cx="32" cy="24" r="4" />
  </svg>
);

const GAMES = [
  {
    to: "/pairs",
    title: "Поиск пары",
    description: "Найдите пару: английское слово и русский перевод. Тренирует запоминание и скорость.",
    Icon: IconPairs,
  },
  {
    to: "/puzzle",
    title: "Puzzle Words",
    description: "Соберите слово из букв по переводу. Удобно для запоминания написания и перевода.",
    Icon: IconPuzzle,
  },
  {
    to: "/danetka",
    title: "Данетка",
    description: "Определите, правильный ли перевод показан для слова. Тренирует понимание значений.",
    Icon: IconDanetka,
  },
  {
    to: "/one-of-three",
    title: "1 из 3",
    description: "Выберите правильный перевод из трёх вариантов. Проверка словарного запаса.",
    Icon: IconOneOfThree,
  },
] as const;

/**
 * Гейм-хаб: список игр с описаниями. Показывается на мобильной главной (/).
 */
const GameHubPage: React.FC = () => {
  const isMobile = useIsMobile();
  
  return (
    <div className="app-shell">
      <Header />
      <main className="main">
        <section className="game-hub" aria-label="Выбор игры">
          {!isMobile && (
            <div className="game-hub__header">
              <h1 className="game-hub__title">Игры</h1>
              <p className="game-hub__subtitle">Выберите игру и нажмите, чтобы начать.</p>
            </div>
          )}
          <ul className="game-hub__list" role="list">
            {GAMES.map((game, index) => (
              <li key={game.to} className="game-hub__item" style={{ animationDelay: `${index * 80}ms` }}>
                <Link to={game.to} className="game-hub__card">
                  <span className="game-hub__card-icon" aria-hidden>
                    <game.Icon className="game-hub__card-icon-svg" />
                  </span>
                  <div className="game-hub__card-body">
                    <h2 className="game-hub__card-title">{game.title}</h2>
                    <p className="game-hub__card-desc">{game.description}</p>
                    <span className="game-hub__card-cta">Играть →</span>
                  </div>
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
