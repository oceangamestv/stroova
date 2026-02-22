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
  AdminDictionaryAiDraftResponse,
  AdminDictionaryAiDraftRequest,
  AdminDictionaryAiImportCommitRequest,
  AdminDictionaryAiImportCommitResponse,
  AdminDictionaryAiImportPreviewRequest,
  AdminDictionaryAiImportPreviewResponse,
  AdminDictionaryDeleteEntryBody,
  AdminDictionaryDeleteEntryResponse,
  AdminDictionaryDeleteFormCardBody,
  AdminDictionaryDeleteFormCardResponse,
  AdminDictionaryWizardChecklist,
  AdminDictionaryFormCard,
  AdminDictionaryFormCardDraft,
  AdminDictionaryApplyDraftBody,
  AdminDictionaryApplyDraftResponse,
  DictionaryFormCardLookupResponse,
  UserDictionaryAllWordsResponse,
  DictionaryUnifiedItemType,
  AdminDictionaryCollectionsListResponse,
  AdminDictionaryCollectionItemsResponse,
  AdminDictionaryCreateEntryRequest,
  AdminDictionaryCreateEntryResponse,
  AdminDictionaryBulkAddCollectionItemsRequest,
  AdminDictionaryBulkAddCollectionItemsResponse,
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
  getCard: (params: { lang?: string; id: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("id", String(params.id));
    return api.get<any>(`/dictionary/card?${search.toString()}`);
  },
  getCardBySense: (params: { lang?: string; senseId: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("senseId", String(params.senseId));
    return api.get<any>(`/dictionary/card-v2?${search.toString()}`);
  },
  lookup: (params: { lang?: string; term: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("term", params.term);
    if (params?.limit != null) search.set("limit", String(params.limit));
    return api.get<{ items: Array<{ senseId: number; lemmaId: number; lemma: string; glossRu: string; level: string; register: string; frequencyRank: number; matchedBy: "lemma" | "form"; matchedForm: string | null; isAmbiguous: boolean }> }>(`/dictionary/lookup?${search.toString()}`);
  },
  getFormCard: (params: { lang?: string; senseId: number; form: string }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("senseId", String(params.senseId));
    search.set("form", String(params.form || ""));
    return api.get<DictionaryFormCardLookupResponse>(`/dictionary/form-card?${search.toString()}`);
  },
  getFormCardById: (params: { lang?: string; cardId: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("cardId", String(params.cardId));
    return api.get<DictionaryFormCardLookupResponse>(`/dictionary/form-card-by-id?${search.toString()}`);
  },
};

export const userDictionaryApi = {
  today: (params?: { lang?: string }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    const q = search.toString();
    return api.get<{
      due: any[];
      new: any[];
      phraseDue?: any[];
      phraseNew?: any[];
      hardOfDay?: any | null;
      currentCollection?: any;
      startProfile?: string;
      startCollectionKey?: string;
    }>(
      `/user-dictionary/today${q ? `?${q}` : ""}`
    );
  },
  /** Сводка по словарю пользователя (всего слов, знаю, изучаю, повтор) для блока «Мой прогресс». */
  summary: (params?: { lang?: string }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    const q = search.toString();
    return api.get<{ total: number; queue: number; learning: number; known: number; hard: number }>(
      `/user-dictionary/summary${q ? `?${q}` : ""}`
    );
  },
  myWords: (params?: { lang?: string; q?: string; status?: "all" | "queue" | "learning" | "known" | "hard"; offset?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    if (params?.q) search.set("q", params.q);
    if (params?.status) search.set("status", params.status);
    if (params?.offset != null) search.set("offset", String(params.offset));
    if (params?.limit != null) search.set("limit", String(params.limit));
    return api.get<{ items: any[]; total: number }>(`/user-dictionary/my-words?${search.toString()}`);
  },
  myPhrases: (params?: { lang?: string; q?: string; status?: "all" | "queue" | "learning" | "known" | "hard"; offset?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    if (params?.q) search.set("q", params.q);
    if (params?.status) search.set("status", params.status);
    if (params?.offset != null) search.set("offset", String(params.offset));
    if (params?.limit != null) search.set("limit", String(params.limit));
    return api.get<{ items: any[]; total: number }>(`/user-dictionary/my-phrases?${search.toString()}`);
  },
  collections: (params?: { lang?: string }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    const q = search.toString();
    return api.get<{ items: any[] }>(`/user-dictionary/collections${q ? `?${q}` : ""}`);
  },
  getCollection: (params: { lang?: string; id: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("id", String(params.id));
    return api.get<{ collection: any; items: any[] }>(`/user-dictionary/collection?${search.toString()}`);
  },
  allWords: (params?: { lang?: string; offset?: number; limit?: number; q?: string }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    if (params?.offset != null) search.set("offset", String(params.offset));
    if (params?.limit != null) search.set("limit", String(params.limit));
    if (params?.q) search.set("q", params.q);
    return api.get<UserDictionaryAllWordsResponse>(
      `/user-dictionary/all-words?${search.toString()}`
    );
  },
  add: (body: { lang?: string; entryId: number }) => api.post<{ ok: true; senseId: number; lemmaId: number }>(`/user-dictionary/add`, body),
  addSense: (body: { senseId: number }) => api.post<{ ok: true }>(`/user-dictionary/add-sense`, body),
  remove: (body: { lang?: string; entryId: number }) => api.post<{ ok: boolean }>(`/user-dictionary/remove`, body),
  removeSense: (body: { senseId: number }) => api.post<{ ok: boolean }>(`/user-dictionary/remove-sense`, body),
  addAllFromCollection: (body: { lang?: string; collectionId: number }) =>
    api.post<{ ok: boolean; inserted?: number }>(`/user-dictionary/collection/add-all`, body),
  setStatus: (body: { senseId: number; status: "queue" | "learning" | "known" | "hard" }) =>
    api.post<{ ok: true; status: string }>(`/user-dictionary/status`, body),
  getSenseState: (params: { senseId: number }) => {
    const search = new URLSearchParams();
    search.set("senseId", String(params.senseId));
    return api.get<{ isSaved: boolean; status: string | null }>(`/user-dictionary/sense-state?${search.toString()}`);
  },
  addPhrase: (body: { itemType: "collocation" | "pattern" | "form_card"; itemId: number }) =>
    api.post<{ ok: boolean }>(`/user-dictionary/phrase/add`, body),
  removePhrase: (body: { itemType: "collocation" | "pattern" | "form_card"; itemId: number }) =>
    api.post<{ ok: boolean }>(`/user-dictionary/phrase/remove`, body),
  setPhraseStatus: (body: { itemType: "collocation" | "pattern" | "form_card"; itemId: number; status: "queue" | "learning" | "known" | "hard" }) =>
    api.post<{ ok: true; status: string }>(`/user-dictionary/phrase/status`, body),
  getPhraseState: (params: { itemType: "collocation" | "pattern" | "form_card"; itemId: number }) => {
    const search = new URLSearchParams();
    search.set("itemType", String(params.itemType));
    search.set("itemId", String(params.itemId));
    return api.get<{ isSaved: boolean; status: string | null }>(`/user-dictionary/phrase-state?${search.toString()}`);
  },
  setStartProfile: (body: { lang?: string; profile: "beginner" | "basic_sentences" | "everyday_topics" }) =>
    api.post<{
      ok: true;
      profile: string;
      collectionKey: string;
      currentCollection?: any;
      summary?: { total: number; queue: number; learning: number; known: number; hard: number };
      due?: any[];
      new?: any[];
    }>(`/user-dictionary/start-profile`, body),
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
  createEntry: (body: AdminDictionaryCreateEntryRequest) =>
    api.post<AdminDictionaryCreateEntryResponse>(`/admin/dictionary/entry/create`, body),
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
  openaiCheck: () =>
    api.get<{ keySet: boolean; keyLength: number; keyLengthRaw: number; prefix: string | null; suffix: string | null; baseUrl: string; model: string }>(
      "/admin/openai-check"
    ),
  aiSuggest: (body: { lang?: string; word: string; existing?: Partial<Word> | null }) =>
    api.post<{ suggestion: Partial<Word> }>(`/admin/dictionary/ai-suggest`, body),
  aiDraft: (body: AdminDictionaryAiDraftRequest) =>
    api.post<AdminDictionaryAiDraftResponse>(`/admin/dictionary/ai-draft`, body),
  aiDraftBlock1: (body: AdminDictionaryAiDraftRequest) =>
    api.post<AdminDictionaryAiDraftResponse>(`/admin/dictionary/ai-draft-block1`, body),
  aiDraftBlock2: (body: AdminDictionaryAiDraftRequest) =>
    api.post<AdminDictionaryAiDraftResponse>(`/admin/dictionary/ai-draft-block2`, body),
  aiDraftBlock3: (body: AdminDictionaryAiDraftRequest) =>
    api.post<{ draft: AdminDictionaryFormCardDraft }>(`/admin/dictionary/ai-draft-block3`, body),
  aiImportPreview: (body: AdminDictionaryAiImportPreviewRequest) =>
    api.post<AdminDictionaryAiImportPreviewResponse>(`/admin/dictionary/ai-import/preview`, body),
  aiImportCommit: (body: AdminDictionaryAiImportCommitRequest) =>
    api.post<AdminDictionaryAiImportCommitResponse>(`/admin/dictionary/ai-import/commit`, body),
  fillIpa: (body: { lang?: string; entryId?: number; word?: string }) =>
    api.post<{ ipaUk: string; ipaUs: string; en: string }>(`/admin/dictionary/fill-ipa`, body),
  deleteFormCard: (body: AdminDictionaryDeleteFormCardBody) =>
    api.post<AdminDictionaryDeleteFormCardResponse>(`/admin/dictionary/form-card/delete`, body),
  deleteEntry: (body: AdminDictionaryDeleteEntryBody) =>
    api.post<AdminDictionaryDeleteEntryResponse>(`/admin/dictionary/entry/delete`, body),
  applyDraft: (body: AdminDictionaryApplyDraftBody) =>
    api.post<AdminDictionaryApplyDraftResponse>(`/admin/dictionary/apply-draft`, body),
  wizardChecklist: (params: { lang?: string; id: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("id", String(params.id));
    return api.get<AdminDictionaryWizardChecklist>(`/admin/dictionary/wizard/checklist?${search.toString()}`);
  },
  getBlock3: (params: { id: number }) => {
    const search = new URLSearchParams();
    search.set("id", String(params.id));
    return api.get<{ cards: AdminDictionaryFormCard[] }>(`/admin/dictionary/block3?${search.toString()}`);
  },
  saveBlock3: (body: { entryId: number; cards: AdminDictionaryFormCard[] }) =>
    api.post<{ ok: true }>(`/admin/dictionary/block3/save`, body),
  collectionsList: (params?: { lang?: string; q?: string; offset?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    if (params?.q) search.set("q", params.q);
    if (params?.offset != null) search.set("offset", String(params.offset));
    if (params?.limit != null) search.set("limit", String(params.limit));
    const q = search.toString();
    return api.get<AdminDictionaryCollectionsListResponse>(`/admin/collections/list${q ? `?${q}` : ""}`);
  },
  collectionsItems: (params: { lang?: string; collectionId: number; q?: string; offset?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    search.set("collectionId", String(params.collectionId));
    if (params?.q) search.set("q", params.q);
    if (params?.offset != null) search.set("offset", String(params.offset));
    if (params?.limit != null) search.set("limit", String(params.limit));
    return api.get<AdminDictionaryCollectionItemsResponse>(`/admin/collections/items?${search.toString()}`);
  },
  collectionsCandidates: (params?: { lang?: string; q?: string; offset?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    if (params?.q) search.set("q", params.q);
    if (params?.offset != null) search.set("offset", String(params.offset));
    if (params?.limit != null) search.set("limit", String(params.limit));
    const q = search.toString();
    return api.get<UserDictionaryAllWordsResponse>(`/admin/collections/candidates${q ? `?${q}` : ""}`);
  },
  createCollection: (body: {
    lang?: string;
    collectionKey?: string;
    title: string;
    description?: string;
    levelFrom?: string;
    levelTo?: string;
    isPublic?: boolean;
    sortOrder?: number;
  }) => api.post<{ ok: true; collection: any }>(`/admin/collections/create`, body),
  updateCollection: (body: {
    lang?: string;
    collectionId: number;
    collectionKey?: string;
    title?: string;
    description?: string;
    levelFrom?: string;
    levelTo?: string;
    isPublic?: boolean;
    sortOrder?: number;
  }) => api.patch<{ ok: true; collection: any }>(`/admin/collections/update`, body),
  deleteCollection: (body: { lang?: string; collectionId: number }) =>
    api.post<{ ok: true; deleted: number }>(`/admin/collections/delete`, body),
  addCollectionItem: (body: {
    lang?: string;
    collectionId: number;
    senseId?: number;
    itemType?: DictionaryUnifiedItemType;
    itemId?: number;
    sortOrder?: number;
  }) => api.post<{ ok: boolean; item?: { id: number; collectionId: number; senseId: number; sortOrder: number } }>(`/admin/collections/item/add`, body),
  addCollectionItemsBulk: (body: AdminDictionaryBulkAddCollectionItemsRequest) =>
    api.post<AdminDictionaryBulkAddCollectionItemsResponse>(`/admin/collections/items/add-bulk`, body),
  removeCollectionItem: (body: {
    lang?: string;
    collectionId: number;
    senseId?: number;
    itemType?: DictionaryUnifiedItemType;
    itemId?: number;
  }) => api.post<{ ok: boolean; deleted?: number }>(`/admin/collections/item/remove`, body),
  reorderCollectionItems: (body: { lang?: string; collectionId: number; senseIds: number[] }) =>
    api.post<{ ok: boolean; updated?: number }>(`/admin/collections/items/reorder`, body),
};

export const adminAudioApi = {
  checkFull: (body?: { lang?: string }) =>
    api.post<{ updated: number; missingCount: number; missing: Array<{ id: number; en: string; slug: string }> }>(
      "/admin/audio/check-full",
      body ?? {}
    ),
  checkNew: (body?: { lang?: string }) =>
    api.post<{ updated: number; missingCount: number; missing: Array<{ id: number; en: string; slug: string }> }>(
      "/admin/audio/check-new",
      body ?? {}
    ),
  getMissing: (params?: { lang?: string }) => {
    const search = new URLSearchParams();
    if (params?.lang) search.set("lang", params.lang);
    const q = search.toString();
    return api.get<{
      missing: Array<{ id: number; en: string; slug: string; hasFemale: boolean; hasMale: boolean }>;
      total: number;
    }>(`/admin/audio/missing${q ? `?${q}` : ""}`);
  },
};

export const ratingApi = {
  participate: () => api.post<{ ok: boolean }>("/rating/participate", {}),
  getLeaderboard: () => api.get<LeaderboardResponse>("/rating/leaderboard"),
};
