import React from "react";
import { useAuth } from "../../features/auth/AuthContext";
import { authService } from "../../services/authService";
import type { DictionarySource } from "../../services/dictionaryService";

export type GameSlug = "pairs" | "puzzle" | "danetka" | "one-of-three";

const GAME_INTRO: Record<
  GameSlug,
  { title: string; description: string; rules: string[] }
> = {
  pairs: {
    title: "Поиск пары",
    description: "Найдите пару: английское слово и русский перевод.",
    rules: [
      "На каждом этапе даётся 5 пар слов (EN и RU).",
      "Нажимайте по очереди на английское и русское слово — если пара верная, она засчитается.",
      "Этапов всего 5. За верные ответы начисляется опыт.",
    ],
  },
  puzzle: {
    title: "Puzzle Words",
    description: "Соберите слово из букв по переводу.",
    rules: [
      "Даётся перевод слова. Нужно собрать английское слово из букв внизу.",
      "Режим Easy: буквы подсвечены, можно подсказки. Режим Hard: только слоты и буквы.",
      "За каждое собранное слово начисляется опыт.",
    ],
  },
  danetka: {
    title: "Данетка",
    description: "Определите, правильный ли перевод показан для слова.",
    rules: [
      "Показывается английское слово и его возможный перевод.",
      "Нажмите «Да», если перевод правильный, или «Нет», если неправильный.",
      "За верный ответ — опыт, за ошибку — минус к прогрессу слова.",
    ],
  },
  "one-of-three": {
    title: "1 из 3",
    description: "Выберите правильный перевод из трёх вариантов.",
    rules: [
      "Показывается английское слово и 3 варианта перевода. Один верный.",
      "Выберите правильный ответ. За верный — опыт, за ошибку — минус к прогрессу слова.",
    ],
  },
};

interface GameIntroScreenProps {
  gameSlug: GameSlug;
  onStart: () => void;
}

const GameIntroScreen: React.FC<GameIntroScreenProps> = ({ gameSlug, onStart }) => {
  const { user, refresh: refreshUser } = useAuth();
  const dictionarySource: DictionarySource =
    user?.gameSettings?.dictionarySource ?? (user ? "personal" : "general");
  const puzzleDifficulty = user?.gameSettings?.puzzleDifficulty ?? "easy";

  const setDictionarySource = (source: DictionarySource) => {
    authService.updateGameSettings({ dictionarySource: source });
    refreshUser();
  };

  const setPuzzleDifficulty = (value: "easy" | "hard") => {
    authService.updateGameSettings({ puzzleDifficulty: value });
    refreshUser();
  };

  const intro = GAME_INTRO[gameSlug];

  return (
    <div className="game-intro">
      <h1 className="game-intro__title">{intro.title}</h1>
      <p className="game-intro__description">{intro.description}</p>
      <section className="game-intro__rules" aria-label="Правила">
        <h2 className="game-intro__rules-title">Правила</h2>
        <ul className="game-intro__rules-list">
          {intro.rules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      </section>
      <section className="game-intro__settings" aria-label="Настройки">
        <h2 className="game-intro__settings-title">Настройки</h2>
        <div className="game-intro__setting">
          <span className="game-intro__setting-label">Слова из:</span>
          <div className="game-dictionary-source-btns">
            <button
              type="button"
              className={`game-dictionary-source-btn ${dictionarySource === "general" ? "active" : ""}`}
              onClick={() => setDictionarySource("general")}
            >
              Общий словарь
            </button>
            <button
              type="button"
              className={`game-dictionary-source-btn ${dictionarySource === "personal" ? "active" : ""}`}
              onClick={() => setDictionarySource("personal")}
            >
              Мой словарь
            </button>
          </div>
        </div>
        {gameSlug === "puzzle" && (
          <div className="game-intro__setting">
            <span className="game-intro__setting-label">Сложность:</span>
            <div className="game-dictionary-source-btns">
              <button
                type="button"
                className={`game-dictionary-source-btn ${puzzleDifficulty === "easy" ? "active" : ""}`}
                onClick={() => setPuzzleDifficulty("easy")}
              >
                Лёгкий
              </button>
              <button
                type="button"
                className={`game-dictionary-source-btn ${puzzleDifficulty === "hard" ? "active" : ""}`}
                onClick={() => setPuzzleDifficulty("hard")}
              >
                Сложный
              </button>
            </div>
          </div>
        )}
      </section>
      <button type="button" className="primary-btn game-intro__start" onClick={onStart}>
        Начать
      </button>
    </div>
  );
};

export default GameIntroScreen;
