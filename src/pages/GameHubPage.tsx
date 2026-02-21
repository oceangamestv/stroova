import React from "react";
import { Link } from "react-router-dom";
import Header from "../components/common/Header";

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

/** Иконка: буквенная сетка (поиск слов) */
const IconWordSearch: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="8" y="8" width="32" height="32" rx="4" />
    <path d="M19 8v32M29 8v32M8 19h32M8 29h32" />
    <path d="M12 14h4M22 14h4M32 14h4M12 24h4M22 24h4M32 24h4M12 34h4M22 34h4M32 34h4" />
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

/** Иконка: врата и звезда (режим забега по боссам) */
const IconGates: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 40V10a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v30" />
    <path d="M16 40V18h16v22" />
    <path d="M24 24l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6L24 24z" />
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
    to: "/word-search",
    title: "Word Search",
    description: "Ищите английские слова на поле, выделяя их только вправо или вниз.",
    Icon: IconWordSearch,
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
  {
    to: "/gates-of-knowledge",
    title: "Врата познаний",
    description: "Пройдите 5 врат A0: выполняйте задания, бейте боссов и удерживайте таймер.",
    Icon: IconGates,
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
        <section className="game-hub" aria-label="Выбор игры">
          <div className="game-hub__header">
            <h1 className="game-hub__title">Игры</h1>
            <p className="game-hub__subtitle">Выберите игру и нажмите, чтобы начать.</p>
          </div>
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
