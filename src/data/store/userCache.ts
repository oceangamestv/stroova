/**
 * Кэш текущего пользователя в памяти (для серверного режима).
 * Заполняется после login/register и GET /me; обновляется после PATCH /me.
 */

import type { Session, User } from "../contracts/types";

const SESSION_KEY = "stroova_session";

function getStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function setStoredSession(session: Session | null): void {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

let cachedUser: User | null = null;

export const userCache = {
  getUser(): User | null {
    return cachedUser;
  },

  setUser(user: User | null): void {
    cachedUser = user;
  },

  getSession(): Session | null {
    return getStoredSession();
  },

  setSession(session: Session | null): void {
    setStoredSession(session);
  },

  clear(): void {
    cachedUser = null;
    setStoredSession(null);
  },
};
