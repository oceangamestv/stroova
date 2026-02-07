export type Accent = "UK" | "US" | "both";
export type Level = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** Тип прогресса слова: начинающий (зелёный), опытный (жёлтый), эксперт (красный — пока не используется). */
export type WordProgressType = "beginner" | "experienced" | "expert";

export type WordProgressByType = {
  beginner?: number;
  experienced?: number;
  expert?: number;
};

/** Старые данные могли быть Record<number, number>; после миграции всегда WordProgressMap. */
export type WordProgressMap = Record<number, WordProgressByType>;

export type ExerciseType = "pairs" | "puzzle";

export type Word = {
  id: number;
  en: string;
  ru: string;
  accent: Accent;
  level: Level;
  ipaUk: string;
  ipaUs: string;
  example: string;
  exampleRu: string;
};

export type UserStats = {
  /** Суммарный опыт (XP); при отсутствии для совместимости используется totalScore. */
  totalXp?: number;
  /** @deprecated Используется для миграции; в интерфейсе показывается totalXp ?? totalScore. */
  totalScore?: number;
  exercisesCompleted: number;
  pairsCompleted: number;
  puzzlesCompleted: number;
  /** Лучший результат за одну сессию (в XP). */
  bestScore: number;
  /** Опыт по дням для графика: ключ "YYYY-MM-DD", значение — XP за этот день. */
  xpByDate?: Record<string, number>;
};

/** В будущем: если true, изученные слова (100% по обоим трекам) всё равно показываются в играх. */
export type UserGameSettings = {
  keepLearnedWordsInGames?: boolean;
  /** Из какого словаря брать слова в играх: общий или мой. */
  dictionarySource?: "general" | "personal";
};

export type User = {
  /** Логин — для входа, уникальный, не меняется при смене никнейма. */
  username: string;
  /** Отображаемое имя (никнейм). Можно менять свободно. Если нет — показывается username. */
  displayName?: string;
  passwordHash: string;
  createdAt: string;
  stats: UserStats;
  /** Прогресс по словам: по типам начинающий / опытный / эксперт (0–100). */
  wordProgress: WordProgressMap | Record<number, number>;
  /** Идентификаторы слов, добавленных пользователем в «Мой словарь». */
  personalDictionary?: number[];
  gameSettings?: UserGameSettings;
};

export type Session = {
  username: string;
  loginTime: string;
};

export type ExerciseResult = {
  type: ExerciseType;
  score: number;
  errors: number;
};
