/**
 * Эндпоинты и вызовы API (контракт с бэкендом).
 * Ожидаемые маршруты:
 *   POST /auth/register  { username, password }
 *   POST /auth/login     { username, password } → { token, user }
 *   GET  /auth/check-username?username=...
 *   GET  /me             → User
 *   PATCH /me            { username? | stats? | wordProgress? } → User
 */

import type { User, Word } from "../data/contracts/types";
import type {
  AuthResponse,
  CheckUsernameResponse,
  PatchMeBody,
  LeaderboardResponse,
} from "./types";
import { api } from "./client";

export const authApi = {
  register: (username: string, password: string) =>
    api.post<AuthResponse>("/auth/register", { username, password }),

  login: (username: string, password: string) =>
    api.post<AuthResponse>("/auth/login", { username, password }),

  checkUsername: (username: string) =>
    api.get<CheckUsernameResponse>(`/auth/check-username?username=${encodeURIComponent(username)}`),
};

export const meApi = {
  get: () => api.get<User>("/me"),
  patch: (body: PatchMeBody) => api.patch<User>("/me", body),
};

export const dictionaryApi = {
  getLanguages: () =>
    api.get<Array<{ id: number; code: string; name: string }>>("/languages"),
  getWords: (params?: { lang?: string; accent?: string; level?: string }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    if (params?.accent) search.set("accent", params.accent);
    if (params?.level) search.set("level", params.level);
    const q = search.toString();
    return api.get<Word[]>(`/dictionary/words${q ? `?${q}` : ""}`);
  },
  getVersion: (lang?: string) => {
    const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
    return api.get<{ version: string }>(`/dictionary/version${q}`);
  },
};

export const ratingApi = {
  participate: () => api.post<{ ok: boolean }>("/rating/participate", {}),
  getLeaderboard: () => api.get<LeaderboardResponse>("/rating/leaderboard"),
};
