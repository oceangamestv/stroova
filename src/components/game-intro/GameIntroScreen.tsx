import React, { useEffect, useState } from "react";
import { useAuth } from "../../features/auth/AuthContext";
import { authService } from "../../services/authService";
import { storyTrainerApi } from "../../api/endpoints";

export type GameSlug =
  | "pairs"
  | "puzzle"
  | "word-search"
  | "danetka"
  | "one-of-three"
  | "gates-of-knowledge"
  | "story-trainer";

const GAME_INTRO: Record<
  GameSlug,
  { title: string; description: string; rules: string[] }
> = {
  pairs: {
    title: "🔗 Поиск пары",
    description: "Находите правильные пары английских и русских слов.",
    rules: [
      "На каждом этапе перед вами 5 пар: английское слово и русский перевод.",
      "Сначала нажмите на английское слово, затем — на подходящий русский перевод. Если пара верная, она засчитается.",
      "Всего 5 этапов. За правильные пары начисляется опыт.",
    ],
  },
  puzzle: {
    title: "🧩 Puzzle Words",
    description: "По переводу соберите английское слово из букв.",
    rules: [
      "Вверху показан перевод. Ниже — буквы. Расставьте их по слотам в правильном порядке.",
      "Лёгкий режим: буквы даны, выбирайте по одной. Сложный: вводите слово с клавиатуры по буквам.",
      "За каждое верное слово начисляется опыт.",
    ],
  },
  "word-search": {
    title: "🔤 Word Search",
    description: "Найдите слова на поле, ведя пальцем или мышью от буквы к букве.",
    rules: [
      "Выберите размер поля в настройках ниже и нажмите «Начать».",
      "Зажмите на букве и ведите змейкой по соседним клеткам только по вертикали и горизонтали (без диагоналей).",
      "Каждую клетку можно использовать только один раз за игру, а слово засчитывается только по правильному маршруту.",
      "Лишние клетки скрыты: все видимые буквы относятся к словам на поле.",
    ],
  },
  danetka: {
    title: "❓ Данетка",
    description: "Решите, верный ли перевод дан к английскому слову.",
    rules: [
      "На экране — английское слово и один вариант перевода.",
      "Нажмите «Да», если перевод верный, или «Нет», если он не подходит к слову.",
      "Игра идёт на время: в начале у вас 60 секунд, таймер запускается после первого ответа.",
      "Вверху — шкала бонусов из 4 этапов (2, 4, 8 и 16 правильных ответов подряд). Каждый правильный ответ заполняет одну ячейку текущего этапа.",
      "Если вы ошиблись, прогресс текущего этапа сбрасывается, но время с таймера НЕ вычитается.",
      "Когда все ячейки этапа заполнены, вы получаете бонус ко времени, равный размеру этапа (2 / 4 / 8 / 16 секунд), и переходите к следующему этапу. Каждый этап можно пройти только один раз за игру.",
      "За верный ответ вы получаете опыт и увеличиваете прогресс слова; за ошибку прогресс слова уменьшается.",
    ],
  },
  "one-of-three": {
    title: "🎯 1 из 3",
    description: "Из трёх вариантов выберите один правильный перевод.",
    rules: [
      "Показано английское слово и три варианта перевода. Верный — только один.",
      "Выберите правильный вариант одним нажатием.",
      "За верный ответ — опыт; за ошибку прогресс слова уменьшается.",
    ],
  },
  "gates-of-knowledge": {
    title: "🚪 Врата познаний",
    description:
      "Режим забега из 5 врат: решайте микрозадания и наносите урон боссам словарным запасом A0.",
    rules: [
      "В забеге 5 врат подряд. У каждого босса свой запас HP и таймер.",
      "Правильный ответ наносит урон и дает бонус ко времени; ошибка снижает время и сбрасывает комбо.",
      "Типы заданий в MVP: собери слово, напиши перевод, подставь слово в пропуск.",
      "Для этого режима используются слова уровня A0 из общего словаря.",
      "Победа — открыть все 5 врат до истечения времени.",
    ],
  },
  "story-trainer": {
    title: "📖 AI Story Trainer",
    description: "Читайте историю по словам из вашего словаря и пишите пересказ. AI проверит смысл и начислит опыт.",
    rules: [
      "Вам выдаётся короткая история на английском, составленная из слов вашего словаря.",
      "Прочитайте историю и напишите пересказ своими словами (не менее 10 слов).",
      "Отправить на проверку можно только один раз за сессию.",
      "Отвечать можно на русском или английском; за ответ на английском даётся больше опыта.",
      "Обычные пользователи могут играть один раз в день; администраторы — без ограничений.",
    ],
  },
};

interface GameIntroScreenProps {
  gameSlug: GameSlug;
  onStart: () => void;
}

function formatResetTime(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const month = d.toLocaleDateString("ru-RU", { month: "long" });
  const isTomorrow =
    d.getUTCDate() !== new Date().getUTCDate() ||
    d.getUTCMonth() !== new Date().getUTCMonth();
  return isTomorrow ? `завтра, ${day} ${month} в 00:00 UTC` : `сегодня в 00:00 UTC`;
}

function timeUntilReset(iso: string): string {
  const end = new Date(iso).getTime();
  const now = Date.now();
  if (end <= now) return "сброс произошёл";
  const ms = end - now;
  const h = Math.floor(ms / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (h > 0) return `до сброса: ${h} ч ${m} мин`;
  return `до сброса: ${m} мин`;
}

const GameIntroScreen: React.FC<GameIntroScreenProps> = ({ gameSlug, onStart }) => {
  const [rulesExpanded, setRulesExpanded] = React.useState(false);
  const [storyLimit, setStoryLimit] = useState<{
    usedToday: boolean;
    isAdmin: boolean;
    nextResetUtc: string;
  } | null>(null);
  const { user, refresh: refreshUser } = useAuth();
  const puzzleDifficulty = user?.gameSettings?.puzzleDifficulty ?? "easy";
  const wordSearchGridSize = user?.gameSettings?.wordSearchGridSize ?? "small";

  const [limitTick, setLimitTick] = useState(0);
  useEffect(() => {
    if (gameSlug !== "story-trainer" || !user) return;
    storyTrainerApi
      .getLimit()
      .then((data) => setStoryLimit({ usedToday: data.usedToday, isAdmin: data.isAdmin, nextResetUtc: data.nextResetUtc }))
      .catch(() => setStoryLimit(null));
  }, [gameSlug, user]);

  useEffect(() => {
    if (gameSlug !== "story-trainer" || !storyLimit?.nextResetUtc) return;
    const id = setInterval(() => setLimitTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [gameSlug, storyLimit?.nextResetUtc]);

  const setPuzzleDifficulty = (value: "easy" | "hard") => {
    authService.updateGameSettings({ puzzleDifficulty: value });
    refreshUser();
  };

  const setWordSearchGridSize = (value: "small" | "medium" | "large") => {
    authService.updateGameSettings({ wordSearchGridSize: value });
    refreshUser();
  };
  const intro = GAME_INTRO[gameSlug];

  return (
    <div className="game-intro">
      <header className="game-intro__header game-intro__zone game-intro__zone--header">
        <div className="game-intro__header-inner">
          <h1 className="game-intro__title">{intro.title}</h1>
          <p className="game-intro__description">{intro.description}</p>
        </div>
      </header>
      <section
        className={`game-intro__rules game-intro__zone game-intro__zone--rules ${rulesExpanded ? "game-intro__rules--expanded" : ""}`}
        aria-label="Правила"
      >
        <button
          type="button"
          className="game-intro__rules-title"
          onClick={() => setRulesExpanded((v) => !v)}
          aria-expanded={rulesExpanded}
        >
          <span className="game-intro__zone-icon" aria-hidden="true">📜</span>
          <span className="game-intro__rules-title-desktop">Правила</span>
          <span className="game-intro__rules-title-mobile">Правила подробно</span>
        </button>
        <ul className="game-intro__rules-list">
          {intro.rules.map((rule, i) => (
            <li key={i} className="game-intro__rules-item">{rule}</li>
          ))}
        </ul>
      </section>
      <section className="game-intro__settings game-intro__zone game-intro__zone--settings" aria-label="Настройки">
        <h2 className="game-intro__settings-title">
          <span className="game-intro__zone-icon" aria-hidden="true">⚙️</span>
          Настройки
        </h2>
        {gameSlug === "word-search" ? (
          <div className="game-intro__setting">
            <span className="game-intro__setting-label">Размер поля:</span>
            <div className="game-dictionary-source-btns">
              <button
                type="button"
                className={`game-dictionary-source-btn ${wordSearchGridSize === "small" ? "active" : ""}`}
                onClick={() => setWordSearchGridSize("small")}
              >
                5×5
              </button>
              <button
                type="button"
                className={`game-dictionary-source-btn ${wordSearchGridSize === "medium" ? "active" : ""}`}
                onClick={() => setWordSearchGridSize("medium")}
              >
                6×6
              </button>
              <button
                type="button"
                className={`game-dictionary-source-btn ${wordSearchGridSize === "large" ? "active" : ""}`}
                onClick={() => setWordSearchGridSize("large")}
              >
                7×7
              </button>
            </div>
          </div>
        ) : gameSlug === "gates-of-knowledge" ? (
          <p className="game-intro__setting-label">
            В MVP для этого режима используется только общий словарь A0.
          </p>
        ) : null}
        {gameSlug === "story-trainer" && storyLimit && (
          <div className="game-intro__setting game-intro__story-limit" aria-label="Ограничения">
            <span className="game-intro__setting-label">Ограничения:</span>
            {storyLimit.isAdmin ? (
              <p className="game-intro__story-limit-text">Для администраторов ограничений по количеству попыток нет.</p>
            ) : (
              <>
                <p className="game-intro__story-limit-text">
                  Одна попытка в день. Отправить на проверку можно только один раз за сессию.
                </p>
                <p className="game-intro__story-limit-reset">
                  {formatResetTime(storyLimit.nextResetUtc)}. {timeUntilReset(storyLimit.nextResetUtc)}
                </p>
                {storyLimit.usedToday && (
                  <p className="game-intro__story-limit-used" role="status">
                    Сегодня попытка уже использована — следующая доступна завтра.
                  </p>
                )}
              </>
            )}
          </div>
        )}
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
      <div className="game-intro__zone game-intro__zone--action">
        <button type="button" className="primary-btn game-intro__start" onClick={onStart}>
          <span className="game-intro__zone-icon game-intro__zone-icon--btn" aria-hidden="true">▶</span>
          Начать
        </button>
      </div>
    </div>
  );
};

export default GameIntroScreen;
