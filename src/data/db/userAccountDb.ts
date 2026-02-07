/**
 * База учётных записей: единая точка доступа к данным пользователей и сессии.
 * Хранит: таблицу пользователей (логин, прогресс, опыт, слова) и текущую сессию.
 */

import type { Session, User, UserStats } from "../contracts/types";
import { storage } from "../storage/localStorage";
import { USERS_STORAGE_KEY, SESSION_STORAGE_KEY } from "./storageKeys";

const defaultStats: UserStats = {
  totalXp: 0,
  exercisesCompleted: 0,
  pairsCompleted: 0,
  puzzlesCompleted: 0,
  bestScore: 0,
  xpByDate: {},
};

/** Таблица пользователей: ключ — логин, значение — User */
export type UsersTable = Record<string, User>;

function getUsersTable(): UsersTable {
  return storage.get<UsersTable>(USERS_STORAGE_KEY, {});
}

function saveUsersTable(users: UsersTable): void {
  storage.set(USERS_STORAGE_KEY, users);
}

/**
 * База учётных записей (таблица пользователей + сессия).
 * Прогресс, опыт и слова хранятся внутри каждой записи User.
 */
export const userAccountDb = {
  /** Все пользователи: Record<username, User> */
  getUsers(): UsersTable {
    return getUsersTable();
  },

  /** Один пользователь по логину */
  getUser(username: string): User | null {
    return getUsersTable()[username] ?? null;
  },

  /** Сохранить таблицу пользователей (полностью перезаписать) */
  saveUsers(users: UsersTable): void {
    saveUsersTable(users);
  },

  /** Обновить или создать пользователя */
  saveUser(username: string, user: User): void {
    const users = getUsersTable();
    users[username] = user;
    saveUsersTable(users);
  },

  /** Удалить пользователя (например при смене логина) */
  removeUser(username: string): void {
    const users = getUsersTable();
    delete users[username];
    saveUsersTable(users);
  },

  /** Текущая сессия (кто в системе) */
  getSession(): Session | null {
    return storage.get<Session | null>(SESSION_STORAGE_KEY, null);
  },

  /** Установить сессию */
  setSession(session: Session): void {
    storage.set(SESSION_STORAGE_KEY, session);
  },

  /** Выйти: очистить сессию */
  clearSession(): void {
    storage.remove(SESSION_STORAGE_KEY);
  },

  /**
   * Сбросить прогресс у всех пользователей: статистика и прогресс по словам обнуляются,
   * логины и пароли сохраняются.
   */
  resetAllUsersProgress(): void {
    const users = getUsersTable();
    const updated: UsersTable = {};
    for (const [username, user] of Object.entries(users)) {
      updated[username] = {
        ...user,
        stats: { ...defaultStats },
        wordProgress: {},
      };
    }
    saveUsersTable(updated);
  },
};
