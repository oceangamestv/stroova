/**
 * Адаптер авторизации и данных пользователя через API.
 * Все данные хранятся на сервере; в клиенте — только токен и сессия (localStorage + память) для входа между перезагрузками.
 */

import type { Session, User, UserStats } from "../contracts/types";
import { getStoredToken, setStoredToken } from "../../api/client";
import { authApi, meApi } from "../../api/endpoints";
import { userCache } from "../store/userCache";
import { ApiError } from "../../api/client";

function getSession(): Session | null {
  return userCache.getSession();
}

function getUsers(): Record<string, User> {
  const session = userCache.getSession();
  const user = userCache.getUser();
  if (!session || !user) return {};
  return { [session.username]: user };
}

async function fetchMe(): Promise<User | null> {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const user = await meApi.get();
    userCache.setUser(user);
    return user;
  } catch {
    setStoredToken(null);
    userCache.clear();
    return null;
  }
}

/** Вызвать при старте приложения: подтянуть пользователя по токену. */
export async function hydrateUser(): Promise<User | null> {
  if (!getStoredToken()) return null;
  const user = await fetchMe();
  if (user && !userCache.getSession()) {
    userCache.setSession({ username: user.username, loginTime: new Date().toISOString() });
  }
  return user;
}

export const serverAuthAdapter = {
  getSession,
  getUsers,

  saveSession(session: Session | null): void {
    userCache.setSession(session);
  },

  clearSession(): void {
    setStoredToken(null);
    userCache.clear();
  },

  /** Текущий пользователь из кэша (синхронно). */
  getCurrentUser(): User | null {
    return userCache.getUser();
  },

  /** Логин: запрос к API, сохранение токена и сессии, заполнение кэша. */
  async login(username: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { token, user } = await authApi.login(username, password);
      setStoredToken(token);
      userCache.setSession({ username: user.username, loginTime: new Date().toISOString() });
      userCache.setUser(user);
      return { success: true };
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ошибка входа";
      return { success: false, error: message };
    }
  },

  /** Регистрация: запрос к API, затем то же, что и при логине. */
  async register(username: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { token, user } = await authApi.register(username, password);
      setStoredToken(token);
      userCache.setSession({ username: user.username, loginTime: new Date().toISOString() });
      userCache.setUser(user);
      return { success: true };
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ошибка регистрации";
      return { success: false, error: message };
    }
  },

  /** Смена отображаемого имени (никнейма). Логин не меняется. */
  async updateDisplayName(displayName: string): Promise<{ success: boolean; error?: string }> {
    if (!getSession()) return { success: false, error: "Необходимо войти в аккаунт" };
    try {
      const updated = await meApi.patch({ displayName: displayName.trim() });
      userCache.setUser(updated);
      return { success: true };
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ошибка сохранения";
      return { success: false, error: message };
    }
  },

  /** Доступность логина (только для регистрации). */
  async isUsernameAvailable(username: string, excludeUsername?: string | null): Promise<boolean> {
    if (excludeUsername && username.toLowerCase() === excludeUsername.toLowerCase()) return true;
    try {
      const { available } = await authApi.checkUsername(username);
      return available;
    } catch {
      return false;
    }
  },

  /** Сохранить данные текущего пользователя на сервер (stats, wordProgress, username). */
  async saveUsers(users: Record<string, User>): Promise<void> {
    const session = getSession();
    if (!session) return;
    const user = users[session.username];
    if (!user) return;
    try {
      const updated = await meApi.patch({
        stats: user.stats,
        wordProgress: user.wordProgress as Record<number, { beginner?: number; experienced?: number; expert?: number }>,
        personalDictionary: user.personalDictionary,
        gameSettings: user.gameSettings,
      });
      // Если бэкенд не возвращает personalDictionary/gameSettings — сохраняем локальные значения
      userCache.setUser({
        ...updated,
        personalDictionary: Array.isArray(updated.personalDictionary)
          ? updated.personalDictionary
          : (user.personalDictionary ?? updated.personalDictionary),
        gameSettings:
          updated.gameSettings && typeof updated.gameSettings === "object"
            ? updated.gameSettings
            : (user.gameSettings ?? updated.gameSettings),
      });
    } catch (e) {
      console.error("Failed to save user to server", e);
    }
  },

  /** Сброс прогресса (если бэкенд поддерживает). */
  async resetAllUsersProgress(): Promise<void> {
    try {
      await meApi.patch({
        stats: {
          totalXp: 0,
          exercisesCompleted: 0,
          pairsCompleted: 0,
          puzzlesCompleted: 0,
          bestScore: 0,
          xpByDate: {},
        },
        wordProgress: {},
      });
      const user = userCache.getUser();
      if (user) {
        userCache.setUser({
          ...user,
          stats: { ...user.stats, totalXp: 0, exercisesCompleted: 0, pairsCompleted: 0, puzzlesCompleted: 0, bestScore: 0, xpByDate: {} },
          wordProgress: {},
        });
      }
    } catch (e) {
      console.error("Failed to reset progress on server", e);
    }
  },
};
