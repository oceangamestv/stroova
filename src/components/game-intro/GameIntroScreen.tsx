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
    description: "Соединяйте английские слова с правильными русскими переводами.",
    rules: [
      "На каждом этапе перед вами 5 пар: английское слово и русский перевод.",
      "Сначала нажмите на английское слово, затем — на подходящий русский перевод. Если пара верная, она засчитается.",
      "Всего 5 этапов. За правильные пары начисляется опыт.",
    ],
  },
  puzzle: {
    title: "Puzzle Words",
    description: "По переводу соберите английское слово из букв.",
    rules: [
      "Вверху показан перевод. Ниже — буквы. Расставьте их по слотам в правильном порядке.",
      "Лёгкий режим: буквы даны, выбирайте по одной. Сложный: вводите слово с клавиатуры по буквам.",
      "За каждое верное слово начисляется опыт.",
    ],
  },
  danetka: {
    title: "Данетка",
    description: "Решите, верный ли перевод дан к английскому слову.",
    rules: [
      "На экране — английское слово и один вариант перевода.",
      "Нажмите «Да», если перевод верный, или «Нет», если он не подходит к слову.",
      "За верный ответ — опыт; за ошибку прогресс слова уменьшается.",
    ],
  },
  "one-of-three": {
    title: "1 из 3",
    description: "Из трёх вариантов выберите один правильный перевод.",
    rules: [
      "Показано английское слово и три варианта перевода. Верный — только один.",
      "Выберите правильный вариант одним нажатием.",
      "За верный ответ — опыт; за ошибку прогресс слова уменьшается.",
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
      <header className="game-intro__header">
        <h1 className="game-intro__title">{intro.title}</h1>
        <p className="game-intro__description">{intro.description}</p>
      </header>
      <section className="game-intro__rules" aria-label="Правила">
        <h2 className="game-intro__rules-title">Правила</h2>
        <ul className="game-intro__rules-list">
          {intro.rules.map((rule, i) => (
            <li key={i} className="game-intro__rules-item">{rule}</li>
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
