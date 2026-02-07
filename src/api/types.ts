/**
 * Типы запросов и ответов API (контракт с бэкендом).
 */

import type { User, UserGameSettings, UserStats, WordProgressMap } from "../data/contracts/types";

/** Ответ логина / регистрации */
export type AuthResponse = {
  token: string;
  user: User;
};

/** Тело PATCH /me — частичное обновление профиля */
export type PatchMeBody = {
  /** Сменить отображаемое имя (никнейм). Логин (username) не меняется. */
  displayName?: string;
  stats?: Partial<UserStats>;
  wordProgress?: WordProgressMap;
  /** Идентификаторы слов в «Мой словарь». */
  personalDictionary?: number[];
  gameSettings?: Partial<UserGameSettings>;
};

/** Ответ проверки доступности логина */
export type CheckUsernameResponse = {
  available: boolean;
};
