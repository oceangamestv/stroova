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

export type AdminDictionaryAiDraftRequest = {
  lang?: string;
  entryId?: number;
  word?: string;
  mode?: "full" | "forms_only";
};

export type AdminDictionaryAiImportPreviewRequest = {
  lang?: string;
  level: string;
  topic?: string;
  count: number;
  register?: string;
};

export type AdminDictionaryAiImportPreviewResponse = {
  items: Array<{
    word: string;
    lemmaKey: string;
    exists: boolean;
  }>;
  status?: {
    ok: boolean;
    missing: number;
    message: string;
  };
  stats: {
    requested: number;
    unique: number;
    duplicates: number;
  };
};

export type AdminDictionaryAiImportCommitRequest = {
  lang?: string;
  level: string;
  register?: string;
  words: string[];
};

export type AdminDictionaryAiImportCommitResponse = {
  ok: true;
  inserted: number;
  skippedDuplicates: number;
};

export type AdminDictionaryDeleteFormCardBody = {
  lang?: string;
  entryId: number;
  formCardId: number;
};

export type AdminDictionaryDeleteFormCardResponse = {
  ok: true;
  deleted: number;
};

export type AdminDictionaryDeleteEntryBody = {
  lang?: string;
  entryId: number;
};

export type AdminDictionaryDeleteEntryResponse = {
  ok: true;
};

export type AdminDictionaryWizardChecklist = {
  block1: { ready: boolean; label: string };
  block2: { ready: boolean; label: string };
  block3: { ready: boolean; label: string };
  warnings: string[];
};

export type AdminDictionaryFormCard = {
  id?: number;
  entryId?: number;
  lemmaId?: number | null;
  sourceFormId?: number | null;
  en: string;
  ru: string;
  level: string;
  accent: string;
  frequencyRank: number;
  rarity: string;
  register: string;
  ipaUk: string;
  ipaUs: string;
  example: string;
  exampleRu: string;
  pos: string;
  sortOrder?: number;
};

export type AdminDictionaryFormCardDraft = {
  formCardsDraft: AdminDictionaryFormCard[];
  warnings?: string[];
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

export type AdminDictionaryCreateEntryRequest = {
  lang?: string;
  entry: {
    en: string;
    ru: string;
    level?: string;
    accent?: string;
    frequencyRank?: number;
    rarity?: string;
    register?: string;
    ipaUk?: string;
    ipaUs?: string;
    example?: string;
    exampleRu?: string;
  };
  senses?: Array<{
    level?: string;
    register?: string;
    glossRu: string;
    definitionRu?: string;
    usageNote?: string;
    examples?: Array<{
      en: string;
      ru?: string;
    }>;
  }>;
  forms?: Array<{
    form: string;
    formType?: string;
    isIrregular?: boolean;
    notes?: string;
  }>;
};

export type AdminDictionaryCreateEntryResponse = {
  ok: true;
  entryId: number;
  entry: Word | null;
  v2: AdminDictionaryEntryV2Response | null;
};

export type DictionaryFormCard = {
  id: number;
  entryId: number;
  sourceSenseId: number | null;
  lemmaId: number | null;
  sourceFormId: number | null;
  en: string;
  ru: string;
  level: string;
  accent: string;
  frequencyRank: number;
  rarity: string;
  register: string;
  ipaUk: string;
  ipaUs: string;
  example: string;
  exampleRu: string;
  pos: string;
  sortOrder: number;
  sourceForm: {
    id: number;
    form: string;
    formType: string;
    isIrregular: boolean;
    notes: string;
  } | null;
};

export type DictionaryFormCardLookupResponse = {
  card: DictionaryFormCard | null;
};

export type DictionaryUnifiedItemType =
  | "entry"
  | "form"
  | "form_card"
  | "collocation"
  | "pattern";

export type DictionaryUnifiedItem = {
  id: number;
  itemType: DictionaryUnifiedItemType;
  itemId: number;
  entryId: number | null;
  senseId: number | null;
  en: string;
  ru: string;
  level: string;
  example: string;
  exampleRu: string;
  isSaved: boolean;
};

export type UserDictionaryAllWordsResponse = {
  items: DictionaryUnifiedItem[];
  total: number;
};

export type AdminDictionaryCollection = {
  id: number;
  collectionKey: string;
  title: string;
  description: string;
  levelFrom: string;
  levelTo: string;
  isPublic: boolean;
  sortOrder: number;
  total: number;
};

export type AdminDictionaryCollectionItem = {
  id: number;
  collectionId: number;
  senseId: number;
  sortOrder: number;
  en: string;
  ru: string;
  level: string;
  example: string;
  exampleRu: string;
};

export type AdminDictionaryCollectionsListResponse = {
  items: AdminDictionaryCollection[];
  total: number;
};

export type AdminDictionaryCollectionItemsResponse = {
  collection: Omit<AdminDictionaryCollection, "total"> | null;
  items: AdminDictionaryCollectionItem[];
  total: number;
};

export type AdminDictionaryBulkAddCollectionItemsRequest = {
  lang?: string;
  collectionId: number;
  entryIds: number[];
};

export type AdminDictionaryBulkAddCollectionItemsResponse = {
  ok: true;
  totals: {
    requested: number;
    added: number;
    skipped: number;
    errors: number;
  };
  report: Array<{
    entryId: number;
    senseId?: number;
    status: "added" | "skipped" | "error";
    reason?: string;
  }>;
};
