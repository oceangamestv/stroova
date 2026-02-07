/**
 * Эндпоинты и вызовы API (контракт с бэкендом).
 * Ожидаемые маршруты:
 *   POST /auth/register  { username, password }
 *   POST /auth/login     { username, password } → { token, user }
 *   GET  /auth/check-username?username=...
 *   GET  /me             → User
 *   PATCH /me            { username? | stats? | wordProgress? } → User
 */

import type { User } from "../data/contracts/types";
import type { AuthResponse, CheckUsernameResponse, PatchMeBody } from "./types";
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
