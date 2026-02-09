import React from "react";
import { useNavigate } from "react-router-dom";

interface GameOnlyLayoutProps {
  children: React.ReactNode;
  /** Только иконка «назад», без текста (для игры «Найди пару»). */
  backIconOnly?: boolean;
}

/**
 * Минимальный лейаут для игры на мобильном: без Header и нижнего меню.
 * Слева — кнопка «Назад» на главную.
 */
const GameOnlyLayout: React.FC<GameOnlyLayoutProps> = ({ children, backIconOnly = false }) => {
  const navigate = useNavigate();

  return (
    <div className="app-shell app-shell--game-only">
      <header className="game-only-header" role="banner">
        <button
          type="button"
          className={`game-only-header__back ${backIconOnly ? "game-only-header__back--icon-only" : ""}`}
          onClick={() => navigate("/")}
          aria-label="Назад на главную"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {!backIconOnly && <span>Назад</span>}
        </button>
      </header>
      <main className="main game-only-main">{children}</main>
    </div>
  );
};

export default GameOnlyLayout;
