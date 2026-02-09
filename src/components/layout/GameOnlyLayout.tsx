import React from "react";
import { useNavigate } from "react-router-dom";
import { GameOnlyLayoutProvider } from "../../contexts/GameOnlyLayoutContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import Header from "../common/Header";

interface GameOnlyLayoutProps {
  children: React.ReactNode;
  /** Только иконка «назад», без текста (для игры «Найди пару»). */
  backIconOnly?: boolean;
}

/**
 * Лейаут для игры: на десктопе — боковое меню (Header) + контент с кнопкой «Назад»;
 * на мобильном — только кнопка «Назад» и контент.
 */
const GameOnlyLayout: React.FC<GameOnlyLayoutProps> = ({ children, backIconOnly = false }) => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  return (
    <GameOnlyLayoutProvider>
      <div className="app-shell app-shell--game-only">
        {!isMobile && <Header />}
        {isMobile && (
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
        )}
        <main className="main game-only-main">{children}</main>
      </div>
    </GameOnlyLayoutProvider>
  );
};

export default GameOnlyLayout;
