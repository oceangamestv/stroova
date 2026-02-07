import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { setPreferredVoiceUri, VOICE_STORAGE_KEY_PREFIX } from "../../utils/sounds";

const Header: React.FC = () => {
  const { user } = useAuth();

  React.useEffect(() => {
    if (user) {
      const uri = localStorage.getItem(VOICE_STORAGE_KEY_PREFIX + user.username);
      setPreferredVoiceUri(uri || null);
    } else {
      setPreferredVoiceUri(null);
    }
  }, [user?.username]);

  return (
    <>
      <header className="top-bar">
        <NavLink to="/" className="logo logo-link" aria-label="На главную">
          <span className="logo-icon">🟢</span>
          <span className="logo-text">STroova</span>
        </NavLink>
        <nav className="main-nav" aria-label="Основная навигация">
          <NavLink
            to="/dictionary"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            Словарь
          </NavLink>
          <NavLink
            to="/pairs"
            className={({ isActive }) => `nav-link nav-link--game ${isActive ? "active" : ""}`}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            Поиск пары
          </NavLink>
          <NavLink
            to="/puzzle"
            className={({ isActive }) => `nav-link nav-link--game ${isActive ? "active" : ""}`}
          >
            Puzzle Words
          </NavLink>
        </nav>
        <div className="user-info">
          <div className="streak-pill">
            <span className="streak-icon">🔥</span>
            <span className="streak-text">Day 1</span>
          </div>
          <NavLink
            to="/profile"
            className="user-menu-trigger user-menu-trigger--link"
            aria-label="Профиль"
          >
            <span className="username">{user?.displayName ?? user?.username ?? ""}</span>
          </NavLink>
        </div>
      </header>
    </>
  );
};

export default Header;
