import type { Session, User } from "../contracts/types";
import { serverAuthAdapter } from "./serverAuthAdapter";

/**
 * Адаптер авторизации: все данные пользователей хранятся на сервере.
 * Сессия и токен — в памяти и localStorage только для поддержки входа между перезагрузками.
 */
export const authAdapter = {
  getUsers(): Record<string, User> {
    return serverAuthAdapter.getUsers();
  },

  saveUsers(users: Record<string, User>) {
    void serverAuthAdapter.saveUsers(users);
  },

  getSession(): Session | null {
    return serverAuthAdapter.getSession();
  },

  saveSession(session: Session) {
    serverAuthAdapter.saveSession(session);
  },

  clearSession() {
    serverAuthAdapter.clearSession();
  },

  /** Сбросить прогресс текущего пользователя на сервере. */
  resetAllUsersProgress() {
    void serverAuthAdapter.resetAllUsersProgress();
  },
};
