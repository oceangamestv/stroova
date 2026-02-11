import React, { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { getSoundEnabled, setSoundEnabled, setPreferredVoiceUri, VOICE_STORAGE_KEY_PREFIX } from "../../utils/sounds";
import { useIsMobile } from "../../hooks/useIsMobile";

/** Конфиг навигации: легко добавлять новые разделы (например, "Уроки") */
const NAV_GROUPS: { id: string; label?: string; items: { to: string; label: string; shortLabel?: string; isGame?: boolean }[] }[] = [
  {
    id: "main",
    items: [
      { to: "/dictionary", label: "Словарь" },
      { to: "/rating", label: "Рейтинг" },
      { to: "/about", label: "О проекте" },
    ],
  },
  {
    id: "games",
    label: "Игры",
    items: [
      { to: "/pairs", label: "Поиск пары", shortLabel: "Пара", isGame: true },
      { to: "/puzzle", label: "Puzzle Words", shortLabel: "Puzzle", isGame: true },
      { to: "/danetka", label: "Данетка", shortLabel: "Данетка", isGame: true },
      { to: "/one-of-three", label: "1 из 3", shortLabel: "1 из 3", isGame: true },
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
  about: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
  soundOn: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  soundOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
    </svg>
  ),
};

/** Пункты сайдбара на десктопе: иконка + подпись, включая кнопку «Игры» */
const SIDEBAR_ITEMS: { to: string; label: string; iconKey: keyof typeof NavIcons }[] = [
  { to: "/", label: "Игры", iconKey: "games" },
  { to: "/dictionary", label: "Словарь", iconKey: "dictionary" },
  { to: "/rating", label: "Рейтинг", iconKey: "rating" },
  { to: "/about", label: "О проекте", iconKey: "about" },
];

/** Иконки для сегментов игр в полусфере (компактные) */
const GameSegmentIcons = [
  /* Пара — две карты */
  <svg key="pairs" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="2" y="4" width="10" height="14" rx="1" /><rect x="12" y="6" width="10" height="14" rx="1" /></svg>,
  /* Puzzle */
  <svg key="puzzle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M10 4H6a2 2 0 0 0-2 2v4h6V4zM14 4h4a2 2 0 0 1 2 2v4h-6V4zM4 14v4a2 2 0 0 0 2 2h4v-6H4zM14 14v6h4a2 2 0 0 0 2-2v-4h-6z" /></svg>,
  /* Данетка — вопросительный знак в круге */
  <svg key="danetka" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 0 1 4 2.2c0 1.5-1.5 2.5-1.5 2.5M12 16h.01" /></svg>,
  /* 1 из 3 — три точки */
  <svg key="one-of-three" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="8" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="16" cy="12" r="2" /></svg>,
];

const BottomLinkMarqueeText: React.FC<{ text: string; enable?: boolean }> = ({ text, enable = true }) => {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [marquee, setMarquee] = useState(false);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    if (!enable) {
      setMarquee(false);
      setShift(0);
      return;
    }
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;

    const update = () => {
      const smallScreen = window.matchMedia("(max-width: 420px)").matches;
      const overflow = Math.ceil(inner.scrollWidth - wrap.clientWidth);
      const shouldMarquee = smallScreen && overflow > 2;
      setMarquee(shouldMarquee);
      setShift(shouldMarquee ? overflow : 0);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    ro.observe(inner);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enable, text]);

  return (
    <span
      ref={wrapRef}
      className={`site-header__bottom-link-text ${marquee ? "site-header__bottom-link-text--marquee" : ""}`}
      style={{ "--marquee-shift": `${shift}px` } as React.CSSProperties}
    >
      <span ref={innerRef} className="site-header__bottom-link-text-inner">
        {text}
      </span>
    </span>
  );
};

const Header: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [soundOn, setSoundOn] = useState(getSoundEnabled);

  useEffect(() => {
    if (user) {
      const uri = localStorage.getItem(VOICE_STORAGE_KEY_PREFIX + user.username);
      setPreferredVoiceUri(uri || null);
    } else {
      setPreferredVoiceUri(null);
    }
  }, [user?.username]);

  const streakDays = user?.activeDays?.streakDays ?? 0;

  /** На десктопе — сайдбар с кнопкой «Игры» и иконками; на мобильном — все группы в верхней шапке */
  const navGroups = isMobile ? NAV_GROUPS : NAV_GROUPS.filter((g) => g.id !== "games");
  const gamePaths = ["/pairs", "/puzzle", "/danetka", "/one-of-three"];

  return (
    <>
      <header className={`site-header ${!isMobile ? "site-header--sidebar" : ""}`} role="banner">
        <div className="site-header__inner">
          <NavLink to="/" className="site-header__logo" aria-label="На главную">
            <img src="/logo.png" alt="" className="site-header__logo-icon" width={40} height={40} />
            <span className="site-header__logo-text">STroova</span>
          </NavLink>

          <nav className="site-header__nav" aria-label="Основная навигация">
            {!isMobile ? (
              <>
                <ul className="site-header__nav-list site-header__nav-list--sidebar" role="list">
                  {SIDEBAR_ITEMS.map((item) => {
                    const isGamesActive =
                      item.to === "/" &&
                      (location.pathname === "/" || gamePaths.includes(location.pathname));
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={({ isActive }) =>
                            `site-header__link site-header__link--sidebar ${item.to === "/" ? "site-header__link--game" : ""} ${isActive || isGamesActive ? "site-header__link--active" : ""}`
                          }
                        >
                          <span className="site-header__sidebar-link-icon">{NavIcons[item.iconKey]}</span>
                          <span className="site-header__sidebar-link-text">{item.label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
                <div className="site-header__sidebar-sound-wrap">
                  <button
                    type="button"
                    className={`site-header__link site-header__link--sidebar site-header__link--sound ${soundOn ? "site-header__link--sound-on" : "site-header__link--sound-off"}`}
                    onClick={() => {
                      const next = !soundOn;
                      setSoundEnabled(next);
                      setSoundOn(next);
                    }}
                    aria-label={soundOn ? "Выключить звук" : "Включить звук"}
                    title={soundOn ? "Выключить звук" : "Включить звук"}
                  >
                    <span className="site-header__sidebar-link-icon">
                      {soundOn ? NavIcons.soundOn : NavIcons.soundOff}
                    </span>
                    <span className="site-header__sidebar-link-text">
                      {soundOn ? "Звук включён" : "Звук выключен"}
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <>
                {navGroups.map((group) => (
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
              </>
            )}
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
            <BottomLinkMarqueeText
              text={user ? (user.displayName ?? user.username) : "Войти"}
              enable={!!user}
            />
          </NavLink>
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `site-header__bottom-link ${isActive ? "site-header__bottom-link--active" : ""}`}
            aria-label="О проекте"
          >
            <span className="site-header__bottom-link-icon">{NavIcons.about}</span>
            <BottomLinkMarqueeText text="О проекте" />
          </NavLink>
        </div>

        <div className="site-header__bottom-center">
          <NavLink
            to="/"
            className={({ isActive }) => {
              const gamePaths = ["/pairs", "/puzzle", "/danetka", "/one-of-three"];
              const isGamesSection = isActive || gamePaths.some((p) => location.pathname === p);
              return `site-header__bottom-games-btn ${isGamesSection ? "site-header__bottom-games-btn--active" : ""}`;
            }}
            aria-label="Игры"
          >
            <span className="site-header__bottom-games-btn-icon">{NavIcons.games}</span>
            <span className="site-header__bottom-games-btn-text">Игры</span>
          </NavLink>
        </div>

        <div className="site-header__bottom-right">
          <NavLink
            to="/rating"
            className={({ isActive }) =>
              `site-header__bottom-link ${isActive ? "site-header__bottom-link--active" : ""}`}
            aria-label="Рейтинг"
          >
            <span className="site-header__bottom-link-icon">{NavIcons.rating}</span>
            <span className="site-header__bottom-link-text">Рейтинг</span>
          </NavLink>
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
