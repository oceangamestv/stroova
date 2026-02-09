import React from "react";
import { useNavigate } from "react-router-dom";

interface GameOnlyLayoutProps {
  children: React.ReactNode;
}

/**
 * Минимальный лейаут для игры на мобильном: без Header и нижнего меню.
 * Слева — «Назад», справа — «Прервать» (выход из игры на главную).
 */
const GameOnlyLayout: React.FC<GameOnlyLayoutProps> = ({ children }) => {
  const navigate = useNavigate();

  return (
    <div className="app-shell app-shell--game-only">
      <header className="game-only-header" role="banner">
        <button
          type="button"
          className="game-only-header__back"
          onClick={() => navigate("/")}
          aria-label="Назад на главную"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Назад</span>
        </button>
        <button
          type="button"
          className="game-only-header__abort"
          onClick={() => navigate("/")}
          aria-label="Прервать игру"
          title="Прервать игру"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          <span>Прервать</span>
        </button>
      </header>
      <main className="main game-only-main">{children}</main>
    </div>
  );
};

export default GameOnlyLayout;
