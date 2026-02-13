/**
 * Типы запросов и ответов API (контракт с бэкендом).
 */

import type { User, UserGameSettings, UserStats, Word, WordProgressMap } from "../data/contracts/types";

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

/** Один участник в лидерборде */
export type LeaderboardEntry = {
  rank: number;
  username: string;
  displayName: string;
  xp: number;
  level: number;
  maxStreak: number;
};

/** Лидерборд за один период */
export type LeaderboardPeriod = {
  items: LeaderboardEntry[];
  currentUser?: LeaderboardEntry;
  participating: boolean;
};

/** Ответ GET /rating/leaderboard */
export type LeaderboardResponse = {
  day: LeaderboardPeriod;
  week: LeaderboardPeriod;
  all: LeaderboardPeriod;
  participating: boolean;
};

// ===== Admin dictionary =====
export type AdminDictionaryListItem = Word & {
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  senseUpdatedAt?: string | null;
  hasIpa?: boolean;
  hasExample?: boolean;
};

export type AdminDictionaryListResponse = {
  items: AdminDictionaryListItem[];
  total: number;
};

export type AdminDictionaryEntryV2Response = {
  entry: Word;
  lemma: {
    id: number;
    lemmaKey: string;
    lemma: string;
    pos: string;
    frequencyRank: number;
    rarity: string;
    accent: string;
    ipaUk: string;
    ipaUs: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  senses: Array<{
    id: number;
    lemmaId: number;
    senseNo: number;
    level: string;
    register: string;
    glossRu: string;
    definitionRu: string;
    usageNote: string;
    reviewedAt: string | null;
    reviewedBy: string | null;
    createdAt: string;
    updatedAt: string;
    examples: Array<{
      id: number;
      senseId: number;
      en: string;
      ru: string;
      isMain: boolean;
      sortOrder: number;
    }>;
  }>;
  forms: Array<{
    id: number;
    lemmaId: number;
    form: string;
    formType: string;
    isIrregular: boolean;
    notes: string;
  }>;
  linkedSenseId: number | null;
};

export type AdminDictionaryAiDraft = {
  entryPatch?: Partial<Word>;
  lemmaPatch?: Partial<{
    frequencyRank: number;
    rarity: string;
    accent: string;
    ipaUk: string;
    ipaUs: string;
  }>;
  senses?: Array<{
    senseNo: number;
    level?: string;
    register?: string;
    glossRu?: string;
    definitionRu?: string;
    usageNote?: string;
    examples?: Array<{ en: string; ru?: string; isMain?: boolean }>;
  }>;
  forms?: Array<{
    form: string;
    formType: string;
    isIrregular?: boolean;
    notes?: string;
  }>;
  warnings?: string[];
};

export type AdminDictionaryAiDraftResponse = {
  draft: AdminDictionaryAiDraft;
};

export type AdminDictionaryApplyDraftBody = {
  lang?: string;
  entryId: number;
  draft: AdminDictionaryAiDraft;
  apply?: {
    entryPatch?: boolean;
    lemmaPatch?: boolean;
    selectedSenseNos?: number[];
    applySense1Core?: boolean;
    replaceExamples?: boolean;
    selectedFormIndexes?: number[];
  };
};

export type AdminDictionaryApplyDraftResponse = {
  ok: true;
  entry: AdminDictionaryEntryV2Response | null;
};
