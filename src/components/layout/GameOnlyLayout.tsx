import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GameOnlyLayoutProvider } from "../../contexts/GameOnlyLayoutContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { getSoundEnabled, setSoundEnabled } from "../../utils/sounds";
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
  const [soundOn, setSoundOn] = useState(getSoundEnabled);

  const handleSoundToggle = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
  };

  return (
    <GameOnlyLayoutProvider>
      <div className="app-shell app-shell--game-only">
        {!isMobile && <Header />}
        {isMobile && (
          <header className="game-only-header" role="banner">
            <div className="game-only-header__inner">
              <button
                type="button"
                className={`game-only-header__btn game-only-header__back ${backIconOnly ? "game-only-header__back--icon-only" : ""}`}
                onClick={() => navigate("/")}
                aria-label="Назад на главную"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                {!backIconOnly && <span className="game-only-header__back-text">Назад</span>}
              </button>
              <span className="game-only-header__title" aria-hidden>Игра</span>
              <button
                type="button"
                className={`game-only-header__btn game-only-header__sound ${soundOn ? "game-only-header__sound--on" : "game-only-header__sound--off"}`}
                onClick={handleSoundToggle}
                aria-label={soundOn ? "Выключить звук" : "Включить звук"}
                title={soundOn ? "Выключить звук" : "Включить звук"}
              >
                {soundOn ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                  </svg>
                )}
              </button>
            </div>
          </header>
        )}
        <main className="main game-only-main">{children}</main>
      </div>
    </GameOnlyLayoutProvider>
  );
};

export default GameOnlyLayout;
