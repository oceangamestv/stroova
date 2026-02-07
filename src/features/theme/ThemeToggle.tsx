import React from "react";
import { useTheme } from "./ThemeProvider";

const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const icon = theme === "dark" ? "☀️" : "🌙";

  return (
    <button
      className="theme-toggle"
      data-theme={theme}
      title="Переключить тему"
      onClick={toggleTheme}
      type="button"
    >
      <span className="theme-toggle-icon">{icon}</span>
    </button>
  );
};

export default ThemeToggle;
