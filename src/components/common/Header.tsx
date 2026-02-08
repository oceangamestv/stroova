import React, { useEffect, useState, useRef } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { setPreferredVoiceUri, VOICE_STORAGE_KEY_PREFIX } from "../../utils/sounds";

/** Конфиг навигации: легко добавлять новые разделы (например, "Уроки") */
const NAV_GROUPS: { id: string; label?: string; items: { to: string; label: string; shortLabel?: string; isGame?: boolean }[] }[] = [
  {
    id: "main",
    items: [
      { to: "/dictionary", label: "Словарь" },
      { to: "/rating", label: "Рейтинг" },
    ],
  },
  {
    id: "games",
    label: "Игры",
    items: [
      { to: "/pairs", label: "Поиск пары", shortLabel: "Пара", isGame: true },
      { to: "/puzzle", label: "Puzzle Words", shortLabel: "Puzzle", isGame: true },
      { to: "/danetka", label: "Данетка", shortLabel: "Данетка", isGame: true },
    ],
  },
];

const GAMES_ITEMS = NAV_GROUPS.find((g) => g.id === "games")!.items;

/** Иконки для нижнего меню (24×24) */
const NavIcons = {
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
    </svg>
  ),
  rating: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2l3 6.5 6.5.5-5 5 1.5 6.5L12 17l-5.5 3.5L8 14l-5-5 6.5-.5L12 2z" />
    </svg>
  ),
  games: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M8 12h.01M16 12h.01M12 12h.01" />
    </svg>
  ),
  dictionary: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8M8 11h6M8 15h4" />
    </svg>
  ),
};

/** Иконки для сегментов игр в полусфере (компактные) */
const GameSegmentIcons = [
  /* Пара — две карты */
  <svg key="pairs" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="2" y="4" width="10" height="14" rx="1" /><rect x="12" y="6" width="10" height="14" rx="1" /></svg>,
  /* Puzzle */
  <svg key="puzzle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M10 4H6a2 2 0 0 0-2 2v4h6V4zM14 4h4a2 2 0 0 1 2 2v4h-6V4zM4 14v4a2 2 0 0 0 2 2h4v-6H4zM14 14v6h4a2 2 0 0 0 2-2v-4h-6z" /></svg>,
  /* Данетка — вопросительный знак в круге */
  <svg key="danetka" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 0 1 4 2.2c0 1.5-1.5 2.5-1.5 2.5M12 16h.01" /></svg>,
];

const Header: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [gamesMenuOpen, setGamesMenuOpen] = useState(false);
  const gamesMenuRef = useRef<HTMLDivElement>(null);

  const isGameActive = ["/pairs", "/puzzle", "/danetka"].includes(location.pathname);

  useEffect(() => {
    if (!gamesMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (gamesMenuRef.current && !gamesMenuRef.current.contains(e.target as Node)) {
        setGamesMenuOpen(false);
      }
    };
    document.addEventListener("click", close, true);
    return () => document.removeEventListener("click", close, true);
  }, [gamesMenuOpen]);

  useEffect(() => {
    if (user) {
      const uri = localStorage.getItem(VOICE_STORAGE_KEY_PREFIX + user.username);
      setPreferredVoiceUri(uri || null);
    } else {
      setPreferredVoiceUri(null);
    }
  }, [user?.username]);

  const streakDays = user?.activeDays?.streakDays ?? 0;

  return (
    <>
      <header className="site-header" role="banner">
        <div className="site-header__inner">
          <NavLink to="/" className="site-header__logo" aria-label="На главную">
            <span className="site-header__logo-icon" aria-hidden>🟢</span>
            <span className="site-header__logo-text">STroova</span>
          </NavLink>

          <nav className="site-header__nav" aria-label="Основная навигация">
            {NAV_GROUPS.map((group) => (
              <div key={group.id} className="site-header__nav-group">
                {group.label && (
                  <span className="site-header__nav-group-label">{group.label}</span>
                )}
                <ul className="site-header__nav-list" role="list">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `site-header__link ${item.isGame ? "site-header__link--game" : ""} ${isActive ? "site-header__link--active" : ""}`
                        }
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="site-header__user">
            {user ? (
              <>
                <div className="site-header__streak" title="Дней подряд">
                  <span className="site-header__streak-icon" aria-hidden>🔥</span>
                  <span className="site-header__streak-text">День {streakDays}</span>
                </div>
                <NavLink to="/profile" className="site-header__profile" aria-label="Профиль">
                  <span className="site-header__username">{user.displayName ?? user.username}</span>
                </NavLink>
              </>
            ) : (
              <NavLink to="/login" className="site-header__profile site-header__profile--login" aria-label="Войти">
                Войти
              </NavLink>
            )}
          </div>
        </div>
      </header>

      {/* Нижняя навигация только на мобильных: иконка + подпись, центр — Игры с выезжающей панелью */}
      <nav className="site-header__bottom-nav" aria-label="Навигация">
        <div className="site-header__bottom-left">
          <NavLink
            to={user ? "/profile" : "/login"}
            className={({ isActive }) =>
              `site-header__bottom-link ${isActive ? "site-header__bottom-link--active" : ""}`}
            aria-label={user ? "Профиль" : "Войти"}
          >
            <span className="site-header__bottom-link-icon">{NavIcons.profile}</span>
            <span className="site-header__bottom-link-text">
              {user ? (user.displayName ?? user.username) : "Войти"}
            </span>
          </NavLink>
          <NavLink
            to="/rating"
            className={({ isActive }) =>
              `site-header__bottom-link ${isActive ? "site-header__bottom-link--active" : ""}`}
            aria-label="Рейтинг"
          >
            <span className="site-header__bottom-link-icon">{NavIcons.rating}</span>
            <span className="site-header__bottom-link-text">Рейтинг</span>
          </NavLink>
        </div>

        <div className="site-header__bottom-center" ref={gamesMenuRef}>
          <button
            type="button"
            className={`site-header__bottom-games-btn ${gamesMenuOpen || isGameActive ? "site-header__bottom-games-btn--active" : ""}`}
            onClick={() => setGamesMenuOpen((o) => !o)}
            aria-expanded={gamesMenuOpen}
            aria-haspopup="true"
            aria-label="Игры"
          >
            <span className="site-header__bottom-games-btn-icon">{NavIcons.games}</span>
            <span className="site-header__bottom-games-btn-text">Игры</span>
          </button>
          <div
            className={`site-header__games-panel ${gamesMenuOpen ? "site-header__games-panel--open" : ""}`}
            role="menu"
            aria-label="Выбор игры"
            aria-hidden={!gamesMenuOpen}
          >
            {GAMES_ITEMS.map((item, i) => (
              <Link
                key={item.to}
                to={item.to}
                className="site-header__games-tile"
                role="menuitem"
                onClick={() => setGamesMenuOpen(false)}
              >
                <span className="site-header__games-tile-icon">{GameSegmentIcons[i]}</span>
                <span className="site-header__games-tile-label">{item.shortLabel ?? item.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="site-header__bottom-right">
          <NavLink
            to="/dictionary"
            className={({ isActive }) =>
              `site-header__bottom-link ${isActive ? "site-header__bottom-link--active" : ""}`}
            aria-label="Словарь"
          >
            <span className="site-header__bottom-link-icon">{NavIcons.dictionary}</span>
            <span className="site-header__bottom-link-text">Словарь</span>
          </NavLink>
        </div>
      </nav>
    </>
  );
};

export default Header;
