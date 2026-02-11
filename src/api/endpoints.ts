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
  AdminDictionaryEntryV2Response,
  AdminDictionaryListResponse,
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

export const adminDictionaryApi = {
  list: (params?: {
    lang?: string;
    q?: string;
    level?: string;
    register?: string;
    rarity?: string;
    reviewed?: "all" | "yes" | "no";
    missingExample?: boolean;
    missingIpa?: boolean;
    missingRu?: boolean;
    offset?: number;
    limit?: number;
    order?: "frequency" | "id" | "reviewed_at";
  }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    if (params?.q) search.set("q", params.q);
    if (params?.level) search.set("level", params.level);
    if (params?.register) search.set("register", params.register);
    if (params?.rarity) search.set("rarity", params.rarity);
    if (params?.reviewed) search.set("reviewed", params.reviewed);
    if (params?.missingExample) search.set("missingExample", "1");
    if (params?.missingIpa) search.set("missingIpa", "1");
    if (params?.missingRu) search.set("missingRu", "1");
    if (params?.offset != null) search.set("offset", String(params.offset));
    if (params?.limit != null) search.set("limit", String(params.limit));
    if (params?.order) search.set("order", params.order);
    const q = search.toString();
    return api.get<AdminDictionaryListResponse>(`/admin/dictionary/list${q ? `?${q}` : ""}`);
  },
  search: (params: { lang?: string; q: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("q", params.q);
    if (params?.limit != null) search.set("limit", String(params.limit));
    return api.get<{ items: Word[] }>(`/admin/dictionary/search?${search.toString()}`);
  },
  getEntry: (params: { lang?: string; id: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("id", String(params.id));
    return api.get<{ entry: Word }>(`/admin/dictionary/entry?${search.toString()}`);
  },
  patchEntry: (body: { lang?: string; id: number; patch: Partial<Word> }) =>
    api.patch<{ entry: Word }>(`/admin/dictionary/entry`, body),
  getEntryV2: (params: { lang?: string; id: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("id", String(params.id));
    return api.get<AdminDictionaryEntryV2Response>(`/admin/dictionary/entry-v2?${search.toString()}`);
  },
  setReviewed: (body: { lang?: string; entryId: number; reviewed: boolean }) =>
    api.post<{ ok: true; review: { reviewedAt: string | null; reviewedBy: string | null } }>(
      `/admin/dictionary/review`,
      body
    ),
  createSense: (body: { lang?: string; entryId: number; sense: { glossRu: string; level: string; register: string; definitionRu?: string; usageNote?: string } }) =>
    api.post<any>(`/admin/dictionary/sense`, body),
  patchSense: (body: { lang?: string; senseId: number; patch: { glossRu?: string; level?: string; register?: string; definitionRu?: string; usageNote?: string } }) =>
    api.patch<any>(`/admin/dictionary/sense`, body),
  addExample: (body: { lang?: string; senseId: number; example: { en: string; ru: string; isMain?: boolean; sortOrder?: number } }) =>
    api.post<{ ok: true; example: { id: number } }>(`/admin/dictionary/example`, body),
  patchExample: (body: { lang?: string; id: number; patch: { en?: string; ru?: string; isMain?: boolean; sortOrder?: number } }) =>
    api.patch<{ ok: true; example: { id: number } }>(`/admin/dictionary/example`, body),
  deleteExample: (body: { lang?: string; id: number }) =>
    api.post<{ ok: true }>(`/admin/dictionary/example/delete`, body),
  setMainExample: (body: { lang?: string; id: number }) =>
    api.post<{ ok: true; example: { id: number } }>(`/admin/dictionary/example/set-main`, body),
  addForm: (body: { lang?: string; lemmaId: number; form: { form: string; formType?: string; isIrregular?: boolean; notes?: string } }) =>
    api.post<{ ok: true; form: { id: number } }>(`/admin/dictionary/form`, body),
  patchForm: (body: { lang?: string; id: number; patch: { form?: string; formType?: string; isIrregular?: boolean; notes?: string } }) =>
    api.patch<{ ok: true; form: { id: number } }>(`/admin/dictionary/form`, body),
  deleteForm: (body: { lang?: string; id: number }) =>
    api.post<{ ok: true }>(`/admin/dictionary/form/delete`, body),
  deleteSense: (body: { lang?: string; id: number }) =>
    api.post<{ ok: true }>(`/admin/dictionary/sense/delete`, body),
  aiSuggest: (body: { lang?: string; word: string; existing?: Partial<Word> | null }) =>
    api.post<{ suggestion: Partial<Word> }>(`/admin/dictionary/ai-suggest`, body),
};

export const ratingApi = {
  participate: () => api.post<{ ok: boolean }>("/rating/participate", {}),
  getLeaderboard: () => api.get<LeaderboardResponse>("/rating/leaderboard"),
};
