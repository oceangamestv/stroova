import React, { useEffect, useMemo, useState } from "react";
import Header from "../components/common/Header";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAuth } from "../features/auth/AuthContext";
import { useNavigate, useParams } from "react-router-dom";
import type { Word } from "../data/contracts/types";
import { adminDictionaryApi, adminAudioApi } from "../api/endpoints";
import { getStoredToken } from "../api/client";
import { API_BASE_URL } from "../api/config";
import type {
  AdminDictionaryAiDraft,
  AdminDictionaryCollection,
  AdminDictionaryCollectionItem,
  AdminDictionaryEntryV2Response,
  AdminDictionaryFormCard,
  AdminDictionaryFormCardDraft,
  AdminDictionaryListItem,
  AdminDictionaryWizardChecklist,
  DictionaryUnifiedItem,
} from "../api/types";
import { ApiError } from "../api/client";

type LoadState = "idle" | "loading" | "error";

type ReviewedFilter = "all" | "yes" | "no";

type AiImportItem = {
  word: string;
  lemmaKey: string;
  exists: boolean;
};

type AdminView = "words" | "collections" | "ai_bulk" | "audio";

type CreateSenseDraft = {
  glossRu: string;
  level: string;
  register: string;
  definitionRu: string;
  usageNote: string;
  examples: Array<{ en: string; ru: string }>;
};

type CreateFormDraft = {
  form: string;
  formType: string;
  isIrregular: boolean;
  notes: string;
};

const LEVELS: Word["level"][] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
const ACCENTS: Word["accent"][] = ["both", "UK", "US"];
const RARITIES: NonNullable<Word["rarity"]>[] = ["не редкое", "редкое", "очень редкое"];
const REGISTERS: NonNullable<Word["register"]>[] = ["разговорная", "официальная"];
const WORD_EDIT_FIELDS = [
  "en",
  "ru",
  "level",
  "accent",
  "frequencyRank",
  "rarity",
  "register",
  "ipaUk",
  "ipaUs",
  "example",
  "exampleRu",
] as const;
type WordEditField = (typeof WORD_EDIT_FIELDS)[number];
const IMPORTANT_EMPTY_FIELDS: WordEditField[] = ["ru", "frequencyRank", "rarity", "register", "ipaUk", "ipaUs", "example", "exampleRu"];

const CARD_FIELD_ALIASES: Record<string, WordEditField> = {
  en: "en",
  lemma: "en",
  ru: "ru",
  gloss_ru: "ru",
  level: "level",
  accent: "accent",
  frequencyRank: "frequencyRank",
  frequency_rank: "frequencyRank",
  rarity: "rarity",
  register: "register",
  ipaUk: "ipaUk",
  ipa_uk: "ipaUk",
  ipaUs: "ipaUs",
  ipa_us: "ipaUs",
  example: "example",
  exampleRu: "exampleRu",
  example_ru: "exampleRu",
};

function normalizeLevelValue(value: unknown): Word["level"] | null {
  const v = String(value ?? "").trim().toUpperCase();
  return (LEVELS as readonly string[]).includes(v) ? (v as Word["level"]) : null;
}

function normalizeAccentValue(value: unknown): Word["accent"] | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "both" || raw === "uk/us" || raw === "us/uk") return "both";
  if (raw === "uk" || raw === "british" || raw === "br") return "UK";
  if (raw === "us" || raw === "american" || raw === "am") return "US";
  return null;
}

function normalizeRarityValue(value: unknown): NonNullable<Word["rarity"]> | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("очень") && raw.includes("ред")) return "очень редкое";
  if (raw === "редкое" || raw === "rare" || raw === "uncommon") return "редкое";
  if (raw === "не редкое" || raw === "частое" || raw === "обычное" || raw === "common") return "не редкое";
  return null;
}

function normalizeRegisterValue(value: unknown): NonNullable<Word["register"]> | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "официальная" || raw === "formal") return "официальная";
  if (raw === "разговорная" || raw === "informal" || raw === "colloquial") return "разговорная";
  return null;
}

function toNumber(value: unknown, fallback: number) {
  const raw = String(value ?? "").trim();
  if (!/^-?\d+$/.test(raw)) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function pickCardFieldsFromObject(obj: Record<string, unknown>): Partial<Word> {
  const out: Partial<Word> = {};
  for (const [key, value] of Object.entries(obj)) {
    const field = CARD_FIELD_ALIASES[key];
    if (!field || value === undefined) continue;
    if (field === "frequencyRank") {
      out.frequencyRank = Math.max(1, toNumber(value, 15000));
    } else if (field === "level") {
      const normalized = normalizeLevelValue(value);
      if (normalized) out.level = normalized;
    } else if (field === "accent") {
      const normalized = normalizeAccentValue(value);
      if (normalized) out.accent = normalized;
    } else if (field === "rarity") {
      const normalized = normalizeRarityValue(value);
      if (normalized) out.rarity = normalized;
    } else if (field === "register") {
      const normalized = normalizeRegisterValue(value);
      if (normalized) out.register = normalized;
    } else {
      (out as Record<string, unknown>)[field] = typeof value === "string" ? value : String(value ?? "");
    }
  }
  return out;
}

function formatApiError(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    const details = e.details?.details;
    if (details) {
      const d = typeof details === "string" ? details : JSON.stringify(details);
      return `${e.message}\n\n${d}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : fallback;
}

const HelpText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="admin-dict-help">{children}</div>
);

const IconAdminWords: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="7" y="8" width="34" height="32" rx="6" />
    <path d="M15 18h18M15 24h18M15 30h10" />
  </svg>
);

const IconAdminCollections: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="8" y="12" width="14" height="24" rx="2" />
    <rect x="18" y="8" width="14" height="28" rx="2" />
    <rect x="28" y="14" width="12" height="22" rx="2" />
  </svg>
);

const IconAdminAiBulk: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="17" cy="16" r="5" />
    <circle cx="31" cy="16" r="5" />
    <circle cx="24" cy="31" r="5" />
    <path d="M21 19l3 7M27 19l-3 7M22 31h4" />
  </svg>
);

const IconAdminAudio: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M24 6v36M14 16v16M34 16v16M9 26v-4h6v4H9zm24 0v-4h6v4h-6z" />
    <path d="M18 12l6 6 6-6" />
  </svg>
);

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const AdminDictionaryPage: React.FC = () => {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { entryId } = useParams<{ entryId?: string }>();
  const editingEntryId = Number.isFinite(Number(entryId)) && Number(entryId) > 0 ? Number(entryId) : null;

  const [lang] = useState("en");
  const [query, setQuery] = useState("");
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterRegister, setFilterRegister] = useState<string>("all");
  const [filterRarity, setFilterRarity] = useState<string>("all");
  const [filterReviewed, setFilterReviewed] = useState<ReviewedFilter>("no");
  const [order, setOrder] = useState<"frequency" | "id" | "reviewed_at">("frequency");
  const [qcMissingExample, setQcMissingExample] = useState(false);
  const [qcMissingIpa, setQcMissingIpa] = useState(false);
  const [qcMissingRu, setQcMissingRu] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [items, setItems] = useState<AdminDictionaryListItem[]>([]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(() => items.find((w) => w.id === selectedId) ?? null, [items, selectedId]);

  const [draft, setDraft] = useState<Partial<Word> | null>(null);
  const [editedDraft, setEditedDraft] = useState<Partial<Word> | null>(null);
  const [saveState, setSaveState] = useState<LoadState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [v2, setV2] = useState<AdminDictionaryEntryV2Response | null>(null);
  const [v2Error, setV2Error] = useState<string | null>(null);
  const [editingSenseId, setEditingSenseId] = useState<number | null>(null);
  const [senseEdit, setSenseEdit] = useState<{ glossRu: string; level: string; register: string; definitionRu: string; usageNote: string } | null>(null);
  const [newExampleBySense, setNewExampleBySense] = useState<Record<number, { en: string; ru: string; isMain: boolean }>>({});
  const [addExampleSenseId, setAddExampleSenseId] = useState<number | null>(null);
  const [editingExampleId, setEditingExampleId] = useState<number | null>(null);
  const [exampleEdit, setExampleEdit] = useState<{ en: string; ru: string; isMain: boolean; sortOrder: number } | null>(null);
  const [senseDraft, setSenseDraft] = useState<{ glossRu: string; level: string; register: string; definitionRu: string; usageNote: string }>({
    glossRu: "",
    level: "A1",
    register: "разговорная",
    definitionRu: "",
    usageNote: "",
  });
  const [addSenseOpen, setAddSenseOpen] = useState(false);

  const [aiState, setAiState] = useState<LoadState>("idle");
  const [ipaFillState, setIpaFillState] = useState<LoadState>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiStatusText, setAiStatusText] = useState<string>("");
  const [ipaStatusText, setIpaStatusText] = useState<string>("");
  const [aiSuggestedFields, setAiSuggestedFields] = useState<WordEditField[] | null>(null);
  const [aiAppliedSensesCount, setAiAppliedSensesCount] = useState<number | null>(null);
  const [aiJson, setAiJson] = useState<string>("");

  const [aiDraftState, setAiDraftState] = useState<LoadState>("idle");
  const [aiDraftError, setAiDraftError] = useState<string | null>(null);
  const [aiDraftJson, setAiDraftJson] = useState<string>("");
  const [aiDraft, setAiDraft] = useState<AdminDictionaryAiDraft | null>(null);
  const [formsDraftState, setFormsDraftState] = useState<LoadState>("idle");
  const [formsDraftError, setFormsDraftError] = useState<string | null>(null);
  const [formsDraft, setFormsDraft] = useState<AdminDictionaryFormCardDraft | null>(null);
  const [formsDraftJson, setFormsDraftJson] = useState<string>("");
  const [formsDraftStatusText, setFormsDraftStatusText] = useState<string>("");
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardChecklist, setWizardChecklist] = useState<AdminDictionaryWizardChecklist | null>(null);
  const [formCards, setFormCards] = useState<AdminDictionaryFormCard[]>([]);
  const [formCardsState, setFormCardsState] = useState<LoadState>("idle");
  const [formCardsError, setFormCardsError] = useState<string | null>(null);
  const [formCardsStatus, setFormCardsStatus] = useState<string>("");
  const [openaiCheckResult, setOpenaiCheckResult] = useState<{
    keySet: boolean;
    keyLength: number;
    keyLengthRaw: number;
    prefix: string | null;
    suffix: string | null;
    baseUrl: string;
    model: string;
  } | null>(null);
  const [openaiCheckError, setOpenaiCheckError] = useState<string | null>(null);
  const [block2AiState, setBlock2AiState] = useState<LoadState>("idle");
  const [block2AiStatus, setBlock2AiStatus] = useState<string>("");
  const [applyDraftEntryPatch, setApplyDraftEntryPatch] = useState(true);
  const [applyDraftLemmaPatch, setApplyDraftLemmaPatch] = useState(true);
  const [applyDraftSenseNos, setApplyDraftSenseNos] = useState<number[]>([]);
  const [applyDraftFormIndexes, setApplyDraftFormIndexes] = useState<number[]>([]);
  const [applyDraftReplaceExamples, setApplyDraftReplaceExamples] = useState(false);
  const [applyDraftSense1Core, setApplyDraftSense1Core] = useState(false);

  const [aiImportOpen, setAiImportOpen] = useState(false);
  const [aiImportLevel, setAiImportLevel] = useState<string>("A0");
  const [aiImportRegister, setAiImportRegister] = useState<NonNullable<Word["register"]>>("разговорная");
  const [aiImportTopic, setAiImportTopic] = useState("");
  const [aiImportCount, setAiImportCount] = useState(30);
  const [aiImportPreviewState, setAiImportPreviewState] = useState<LoadState>("idle");
  const [aiImportCommitState, setAiImportCommitState] = useState<LoadState>("idle");
  const [aiImportError, setAiImportError] = useState<string | null>(null);
  const [aiImportPreview, setAiImportPreview] = useState<AiImportItem[]>([]);
  const [aiImportStats, setAiImportStats] = useState<{ requested: number; unique: number; duplicates: number } | null>(null);
  const [aiImportStatus, setAiImportStatus] = useState<{ ok: boolean; missing: number; message: string } | null>(null);
  const [aiImportCommitResult, setAiImportCommitResult] = useState<{ inserted: number; skippedDuplicates: number } | null>(null);

  const [batchSelectedIds, setBatchSelectedIds] = useState<number[]>([]);
  const [batchState, setBatchState] = useState<LoadState>("idle");
  const [batchReport, setBatchReport] = useState<Array<{ id: number; en: string; status: "ok" | "error"; formsCount: number; warnings: string[]; error?: string }>>([]);
  const [batchDelayMs, setBatchDelayMs] = useState(350);
  const [batchRetryCount, setBatchRetryCount] = useState(1);
  const [adminView, setAdminView] = useState<AdminView>("words");
  const [batchMode, setBatchMode] = useState<"forms_only" | "full_apply">("full_apply");
  const [batchApplyEntryPatch, setBatchApplyEntryPatch] = useState(true);
  const [batchApplySenses, setBatchApplySenses] = useState(true);
  const [batchApplyForms, setBatchApplyForms] = useState(true);
  const [batchApplyReplaceExamples, setBatchApplyReplaceExamples] = useState(false);
  const [batchApplySense1Core, setBatchApplySense1Core] = useState(false);
  const [batchCollectionId, setBatchCollectionId] = useState<number | null>(null);
  const [batchCollectionState, setBatchCollectionState] = useState<LoadState>("idle");
  const [batchCollectionResult, setBatchCollectionResult] = useState<{ added: number; skipped: number; errors: number; requested: number } | null>(null);
  const [batchCollectionError, setBatchCollectionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState<LoadState>("idle");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<string>("");
  const [createEntryDraft, setCreateEntryDraft] = useState<Partial<Word>>({
    en: "",
    ru: "",
    level: "A0",
    accent: "both",
    frequencyRank: 15000,
    rarity: "не редкое",
    register: "разговорная",
    ipaUk: "",
    ipaUs: "",
    example: "",
    exampleRu: "",
  });
  const [createSenses, setCreateSenses] = useState<CreateSenseDraft[]>([
    {
      glossRu: "",
      level: "A0",
      register: "разговорная",
      definitionRu: "",
      usageNote: "",
      examples: [{ en: "", ru: "" }],
    },
  ]);
  const [createForms, setCreateForms] = useState<CreateFormDraft[]>([{ form: "", formType: "", isIrregular: false, notes: "" }]);

  const sectionCards: Array<{ key: AdminView; title: string; description: string; Icon: React.FC<{ className?: string }> }> = [
    {
      key: "words",
      title: "Слова",
      description: "Поиск, фильтры, редактирование и ручное создание слов.",
      Icon: IconAdminWords,
    },
    {
      key: "collections",
      title: "Коллекции",
      description: "Управляйте коллекциями и их составом.",
      Icon: IconAdminCollections,
    },
    {
      key: "ai_bulk",
      title: "AI + массовые",
      description: "AI-импорт, пакетная обработка и массовое добавление в коллекции.",
      Icon: IconAdminAiBulk,
    },
    {
      key: "audio",
      title: "Аудио файлы",
      description: "Проверка наличия озвучки по каталогам, список слов без озвучки и выгрузка файла для локальной генерации.",
      Icon: IconAdminAudio,
    },
  ];
  const [collectionsList, setCollectionsList] = useState<AdminDictionaryCollection[]>([]);
  const [collectionsTotal, setCollectionsTotal] = useState(0);
  const [collectionsState, setCollectionsState] = useState<LoadState>("idle");
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [collectionsQuery, setCollectionsQuery] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [collectionItems, setCollectionItems] = useState<AdminDictionaryCollectionItem[]>([]);
  const [collectionItemsTotal, setCollectionItemsTotal] = useState(0);
  const [collectionItemsState, setCollectionItemsState] = useState<LoadState>("idle");
  const [collectionItemsError, setCollectionItemsError] = useState<string | null>(null);
  const [collectionCandidates, setCollectionCandidates] = useState<DictionaryUnifiedItem[]>([]);
  const [collectionCandidatesState, setCollectionCandidatesState] = useState<LoadState>("idle");
  const [collectionCandidatesError, setCollectionCandidatesError] = useState<string | null>(null);
  const [collectionCandidatesQ, setCollectionCandidatesQ] = useState("");
  const [collectionSaving, setCollectionSaving] = useState<LoadState>("idle");
  const [collectionForm, setCollectionForm] = useState<{
    mode: "create" | "edit";
    collectionId: number | null;
    collectionKey: string;
    title: string;
    description: string;
    levelFrom: string;
    levelTo: string;
    isPublic: boolean;
    sortOrder: number;
  }>({
    mode: "create",
    collectionId: null,
    collectionKey: "",
    title: "",
    description: "",
    levelFrom: "A0",
    levelTo: "C2",
    isPublic: true,
    sortOrder: 0,
  });

  const [audioCheckState, setAudioCheckState] = useState<LoadState>("idle");
  const [audioCheckError, setAudioCheckError] = useState<string | null>(null);
  const [audioCheckResult, setAudioCheckResult] = useState<{
    updated: number;
    missingCount: number;
    missing: Array<{ id: number; en: string; slug: string }>;
  } | null>(null);
  const [audioMissingList, setAudioMissingList] = useState<Array<{ id: number; en: string; slug: string; hasFemale: boolean; hasMale: boolean }>>([]);
  const [audioMissingTotal, setAudioMissingTotal] = useState(0);
  const [audioMissingState, setAudioMissingState] = useState<LoadState>("idle");

  const canAccess = !!user?.isAdmin && !isMobile;

  const normalizeFieldValue = (field: WordEditField, value: unknown) => {
    if (field === "frequencyRank") return toNumber(value, 15000);
    return String(value ?? "").trim();
  };

  const isFieldChanged = (field: WordEditField) => {
    if (!draft || !editedDraft) return false;
    return normalizeFieldValue(field, draft[field]) !== normalizeFieldValue(field, editedDraft[field]);
  };

  const isFieldEmpty = (field: WordEditField) => {
    if (!editedDraft) return false;
    if (field === "frequencyRank") return !Number.isFinite(toNumber(editedDraft.frequencyRank, NaN));
    return String(editedDraft[field] ?? "").trim() === "";
  };

  const changedFields = useMemo(() => WORD_EDIT_FIELDS.filter((field) => isFieldChanged(field)), [draft, editedDraft]);
  const emptyImportantFields = useMemo(
    () => IMPORTANT_EMPTY_FIELDS.filter((field) => isFieldEmpty(field)),
    [editedDraft]
  );
  const aiSuggestedFieldsSafe = aiSuggestedFields ?? [];
  const loadList = async (reset = true) => {
    setSearchState("loading");
    setSearchError(null);
    if (reset) {
      setOffset(0);
      setItems([]);
      setSelectedId(null);
      setDraft(null);
      setEditedDraft(null);
      setV2(null);
      setV2Error(null);
    }
    setAiJson("");
    setAiError(null);
    setAiDraftJson("");
    setAiDraftError(null);
    setAiDraft(null);
    setFormsDraft(null);
    setFormsDraftJson("");
    setFormsDraftError(null);
    setFormsDraftStatusText("");
    try {
      const { items, total } = await adminDictionaryApi.list({
        lang,
        q: query.trim() || undefined,
        level: filterLevel,
        register: filterRegister,
        rarity: filterRarity,
        reviewed: filterReviewed,
        missingExample: qcMissingExample,
        missingIpa: qcMissingIpa,
        missingRu: qcMissingRu,
        offset: reset ? 0 : offset,
        limit: 120,
        order,
      });
      setTotal(total);
      setItems(reset ? items : (prev) => [...prev, ...items]);
      setSearchState("idle");
    } catch (e) {
      setSearchState("error");
      setSearchError(formatApiError(e, "Ошибка загрузки словаря"));
    }
  };

  const runAiImportPreview = async () => {
    setAiImportPreviewState("loading");
    setAiImportError(null);
    setAiImportCommitResult(null);
    setAiImportStatus(null);
    try {
      const resp = await adminDictionaryApi.aiImportPreview({
        lang,
        level: aiImportLevel,
        topic: aiImportTopic.trim() || undefined,
        count: Math.max(1, Math.min(200, Number(aiImportCount) || 1)),
        register: aiImportRegister,
      });
      setAiImportPreview(resp.items || []);
      setAiImportStats(resp.stats || null);
      setAiImportStatus(resp.status || null);
      setAiImportPreviewState("idle");
    } catch (e) {
      setAiImportPreviewState("error");
      setAiImportError(formatApiError(e, "Ошибка AI‑импорта (preview)"));
    }
  };

  const runAiImportCommit = async () => {
    const words = aiImportPreview.filter((i) => !i.exists).map((i) => i.word);
    if (words.length === 0) return;
    setAiImportCommitState("loading");
    setAiImportError(null);
    try {
      const resp = await adminDictionaryApi.aiImportCommit({
        lang,
        level: aiImportLevel,
        register: aiImportRegister,
        words,
      });
      setAiImportCommitResult({ inserted: resp.inserted, skippedDuplicates: resp.skippedDuplicates });
      setAiImportPreview([]);
      setAiImportStats(null);
      setAiImportStatus(null);
      setAiImportCommitState("idle");
      await loadList(true);
    } catch (e) {
      setAiImportCommitState("error");
      setAiImportError(formatApiError(e, "Ошибка AI‑импорта (commit)"));
    }
  };

  const aiImportSavableCount = useMemo(() => aiImportPreview.filter((i) => !i.exists).length, [aiImportPreview]);

  useEffect(() => {
    if (!canAccess) return;
    void loadList(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess) return;
    if (!editingEntryId) return;
    void loadEntryData(editingEntryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, editingEntryId]);

  useEffect(() => {
    if (!canAccess) return;
    if (adminView !== "collections" && adminView !== "ai_bulk") return;
    void loadCollectionsAdmin(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, adminView]);

  const loadAudioMissing = async () => {
    setAudioMissingState("loading");
    try {
      const out = await adminAudioApi.getMissing({ lang });
      setAudioMissingList(Array.isArray(out?.missing) ? out.missing : []);
      setAudioMissingTotal(Number(out?.total ?? 0));
      setAudioMissingState("idle");
    } catch (e) {
      setAudioMissingState("error");
      setAudioMissingList([]);
      setAudioMissingTotal(0);
    }
  };

  useEffect(() => {
    if (!canAccess || adminView !== "audio") return;
    void loadAudioMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, adminView, lang]);

  const runAudioCheckFull = async () => {
    setAudioCheckState("loading");
    setAudioCheckError(null);
    setAudioCheckResult(null);
    setAudioMissingList([]);
    setAudioMissingTotal(0);
    setAudioMissingState("loading");
    try {
      const result = await adminAudioApi.checkFull({ lang });
      setAudioCheckResult(result);
      setAudioCheckState("idle");
      void loadAudioMissing();
    } catch (e) {
      setAudioCheckError(e instanceof ApiError ? e.message : String(e));
      setAudioCheckState("error");
    }
  };

  const runAudioCheckNew = async () => {
    setAudioCheckState("loading");
    setAudioCheckError(null);
    setAudioCheckResult(null);
    setAudioMissingList([]);
    setAudioMissingTotal(0);
    setAudioMissingState("loading");
    try {
      const result = await adminAudioApi.checkNew({ lang });
      setAudioCheckResult(result);
      setAudioCheckState("idle");
      void loadAudioMissing();
    } catch (e) {
      setAudioCheckError(e instanceof ApiError ? e.message : String(e));
      setAudioCheckState("error");
    }
  };

  const downloadMissingAudioJson = async () => {
    const base = (API_BASE_URL || "").trim() || "/api";
    const url = `${base.replace(/\/$/, "")}/admin/audio/missing-export?lang=${encodeURIComponent(lang)}`;
    const token = getStoredToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Ошибка загрузки");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "missing-audio.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const resetCollectionForm = () => {
    setCollectionForm({
      mode: "create",
      collectionId: null,
      collectionKey: "",
      title: "",
      description: "",
      levelFrom: "A0",
      levelTo: "C2",
      isPublic: true,
      sortOrder: 0,
    });
  };

  const syncCollectionFormFromSelected = (col: AdminDictionaryCollection) => {
    setCollectionForm({
      mode: "edit",
      collectionId: Number(col.id),
      collectionKey: String(col.collectionKey || ""),
      title: String(col.title || ""),
      description: String(col.description || ""),
      levelFrom: String(col.levelFrom || "A0"),
      levelTo: String(col.levelTo || "C2"),
      isPublic: !!col.isPublic,
      sortOrder: Number(col.sortOrder || 0),
    });
  };

  const loadCollectionsAdmin = async (reset = true) => {
    setCollectionsState("loading");
    setCollectionsError(null);
    try {
      const out = await adminDictionaryApi.collectionsList({
        lang,
        q: collectionsQuery.trim() || undefined,
        offset: 0,
        limit: 120,
      });
      const next = Array.isArray(out?.items) ? out.items : [];
      setCollectionsList(next);
      setCollectionsTotal(Number(out?.total || 0));
      setCollectionsState("idle");

      const selectedStillExists = next.some((x) => Number(x.id) === Number(selectedCollectionId));
      if (!selectedStillExists) {
        const first = next[0] || null;
        if (first) {
          setSelectedCollectionId(Number(first.id));
          syncCollectionFormFromSelected(first);
          await loadCollectionItemsAdmin(Number(first.id));
        } else {
          setSelectedCollectionId(null);
          setCollectionItems([]);
          setCollectionItemsTotal(0);
          if (reset) resetCollectionForm();
        }
      } else if (selectedCollectionId != null) {
        const selected = next.find((x) => Number(x.id) === Number(selectedCollectionId));
        if (selected && collectionForm.mode === "edit" && Number(collectionForm.collectionId) === Number(selected.id)) {
          syncCollectionFormFromSelected(selected);
        }
      }
    } catch (e) {
      setCollectionsState("error");
      setCollectionsError(formatApiError(e, "Не удалось загрузить коллекции"));
    }
  };

  const loadCollectionItemsAdmin = async (collectionId: number) => {
    if (!Number.isFinite(collectionId) || collectionId <= 0) return;
    setCollectionItemsState("loading");
    setCollectionItemsError(null);
    try {
      const out = await adminDictionaryApi.collectionsItems({ lang, collectionId, offset: 0, limit: 500 });
      setCollectionItems(Array.isArray(out?.items) ? out.items : []);
      setCollectionItemsTotal(Number(out?.total || 0));
      setCollectionItemsState("idle");
    } catch (e) {
      setCollectionItemsState("error");
      setCollectionItemsError(formatApiError(e, "Не удалось загрузить элементы коллекции"));
    }
  };

  const selectCollectionAdmin = async (collectionId: number) => {
    setSelectedCollectionId(collectionId);
    const selected = collectionsList.find((x) => Number(x.id) === Number(collectionId));
    if (selected) syncCollectionFormFromSelected(selected);
    await loadCollectionItemsAdmin(collectionId);
  };

  const saveCollectionAdmin = async () => {
    const title = String(collectionForm.title || "").trim();
    if (!title) {
      setCollectionsError("Укажите название коллекции");
      return;
    }
    setCollectionSaving("loading");
    setCollectionsError(null);
    try {
      if (collectionForm.mode === "edit" && collectionForm.collectionId) {
        await adminDictionaryApi.updateCollection({
          lang,
          collectionId: Number(collectionForm.collectionId),
          collectionKey: collectionForm.collectionKey || undefined,
          title: title,
          description: collectionForm.description || "",
          levelFrom: collectionForm.levelFrom || "A0",
          levelTo: collectionForm.levelTo || "C2",
          isPublic: collectionForm.isPublic,
          sortOrder: Number(collectionForm.sortOrder || 0),
        });
        await loadCollectionsAdmin(false);
        if (selectedCollectionId) await loadCollectionItemsAdmin(Number(selectedCollectionId));
      } else {
        const out = await adminDictionaryApi.createCollection({
          lang,
          collectionKey: collectionForm.collectionKey || undefined,
          title: title,
          description: collectionForm.description || "",
          levelFrom: collectionForm.levelFrom || "A0",
          levelTo: collectionForm.levelTo || "C2",
          isPublic: collectionForm.isPublic,
          sortOrder: Number(collectionForm.sortOrder || 0),
        });
        await loadCollectionsAdmin(false);
        const createdId = Number((out as any)?.collection?.id || 0) || null;
        if (createdId) {
          setSelectedCollectionId(createdId);
          await loadCollectionItemsAdmin(createdId);
          const created = collectionsList.find((x) => Number(x.id) === createdId);
          if (created) syncCollectionFormFromSelected(created);
          else {
            setCollectionForm((prev) => ({ ...prev, mode: "edit", collectionId: createdId }));
          }
        }
      }
      setCollectionSaving("idle");
    } catch (e) {
      setCollectionSaving("error");
      setCollectionsError(formatApiError(e, "Не удалось сохранить коллекцию"));
    }
  };

  const deleteCollectionAdmin = async () => {
    if (!collectionForm.collectionId) return;
    const ok = window.confirm("Удалить коллекцию? Это удалит и её состав.");
    if (!ok) return;
    setCollectionSaving("loading");
    setCollectionsError(null);
    try {
      await adminDictionaryApi.deleteCollection({ lang, collectionId: Number(collectionForm.collectionId) });
      resetCollectionForm();
      setSelectedCollectionId(null);
      setCollectionItems([]);
      setCollectionItemsTotal(0);
      await loadCollectionsAdmin(true);
      setCollectionSaving("idle");
    } catch (e) {
      setCollectionSaving("error");
      setCollectionsError(formatApiError(e, "Не удалось удалить коллекцию"));
    }
  };

  const loadCollectionCandidatesAdmin = async () => {
    setCollectionCandidatesState("loading");
    setCollectionCandidatesError(null);
    try {
      const out = await adminDictionaryApi.collectionsCandidates({
        lang,
        q: collectionCandidatesQ.trim() || undefined,
        offset: 0,
        limit: 80,
      });
      setCollectionCandidates(Array.isArray(out?.items) ? out.items : []);
      setCollectionCandidatesState("idle");
    } catch (e) {
      setCollectionCandidatesState("error");
      setCollectionCandidatesError(formatApiError(e, "Не удалось загрузить кандидатов"));
    }
  };

  const addCandidateToCollection = async (candidate: DictionaryUnifiedItem) => {
    if (!selectedCollectionId) return;
    try {
      await adminDictionaryApi.addCollectionItem({
        lang,
        collectionId: Number(selectedCollectionId),
        itemType: candidate.itemType,
        itemId: Number(candidate.itemId),
      });
      await loadCollectionItemsAdmin(Number(selectedCollectionId));
    } catch (e) {
      setCollectionItemsError(formatApiError(e, "Не удалось добавить элемент в коллекцию"));
    }
  };

  const removeCollectionSense = async (senseId: number) => {
    if (!selectedCollectionId) return;
    try {
      await adminDictionaryApi.removeCollectionItem({
        lang,
        collectionId: Number(selectedCollectionId),
        senseId: Number(senseId),
      });
      await loadCollectionItemsAdmin(Number(selectedCollectionId));
    } catch (e) {
      setCollectionItemsError(formatApiError(e, "Не удалось удалить элемент из коллекции"));
    }
  };

  const reorderCollectionItems = async (senseIds: number[]) => {
    if (!selectedCollectionId) return;
    try {
      await adminDictionaryApi.reorderCollectionItems({
        lang,
        collectionId: Number(selectedCollectionId),
        senseIds,
      });
    } catch (e) {
      setCollectionItemsError(formatApiError(e, "Не удалось сохранить порядок коллекции"));
    }
  };

  const moveCollectionItem = async (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= collectionItems.length) return;
    const next = [...collectionItems];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setCollectionItems(next);
    const senseIds = next.map((x) => Number(x.senseId)).filter((n) => Number.isFinite(n) && n > 0);
    await reorderCollectionItems(senseIds);
  };

  const loadEntryData = async (id: number) => {
    setSelectedId(id);
    setDraft(null);
    setEditedDraft(null);
    setSaveError(null);
    setV2(null);
    setV2Error(null);
    setEditingSenseId(null);
    setSenseEdit(null);
    setEditingExampleId(null);
    setExampleEdit(null);
    setAddExampleSenseId(null);
    setAddSenseOpen(false);
    setAiJson("");
    setAiError(null);
    setAiDraftJson("");
    setAiDraftError(null);
    setAiDraft(null);
    setFormsDraft(null);
    setFormsDraftJson("");
    setFormsDraftError(null);
    setFormsDraftStatusText("");
    setAiSuggestedFields(null);
    setAiAppliedSensesCount(null);
    setWizardStep(1);
    setWizardChecklist(null);
    setFormCards([]);
    setFormCardsError(null);
    try {
      const { entry } = await adminDictionaryApi.getEntry({ lang, id });
      setDraft(entry);
      setEditedDraft(entry);
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id });
      setV2(v2Data);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Не удалось загрузить запись");
      return;
    }
    try {
      const [checklist, block3] = await Promise.all([
        adminDictionaryApi.wizardChecklist({ lang, id }),
        adminDictionaryApi.getBlock3({ id }),
      ]);
      setWizardChecklist(checklist);
      setFormCards(Array.isArray(block3.cards) ? block3.cards : []);
    } catch (e) {
      // Не ломаем открытие карточки, если вспомогательные wizard-данные недоступны.
      setFormCardsError(e instanceof Error ? e.message : "Не удалось загрузить данные мастера");
    }
  };

  const loadEntry = async (id: number) => {
    navigate(`/admin/dictionary/word/${id}`);
  };

  const refreshWizardState = async (id: number) => {
    try {
      const [checklist, block3] = await Promise.all([
        adminDictionaryApi.wizardChecklist({ lang, id }),
        adminDictionaryApi.getBlock3({ id }),
      ]);
      setWizardChecklist(checklist);
      setFormCards(Array.isArray(block3.cards) ? block3.cards : []);
    } catch (e) {
      setFormCardsError(e instanceof Error ? e.message : "Не удалось обновить мастер");
    }
  };

  const save = async () => {
    if (!draft?.id || !editedDraft) return;
    setSaveState("loading");
    setSaveError(null);
    try {
      const patch: Partial<Word> = {};
      for (const field of WORD_EDIT_FIELDS) {
        if (!isFieldChanged(field)) continue;
        if (field === "frequencyRank") {
          patch.frequencyRank = toNumber(editedDraft.frequencyRank, 15000);
          continue;
        }
        (patch as any)[field] = String(editedDraft[field] ?? "").trim();
      }
      if (Object.keys(patch).length === 0) {
        setSaveState("idle");
        return;
      }
      const { entry } = await adminDictionaryApi.patchEntry({ lang, id: draft.id, patch });
      // Обновим в списке
      setItems((prev) => prev.map((w) => (w.id === entry.id ? { ...w, ...entry } : w)));
      setDraft(entry);
      setEditedDraft(entry);
      try {
        const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: entry.id });
        setV2(v2Data);
      } catch (e) {
        setV2Error(e instanceof Error ? e.message : "Не удалось обновить v2");
      }
      setSaveState("idle");
    } catch (e) {
      setSaveState("error");
      setSaveError(formatApiError(e, "Ошибка сохранения"));
    }
  };

  const toggleReviewed = async (reviewed: boolean) => {
    if (!draft?.id) return;
    try {
      await adminDictionaryApi.setReviewed({ lang, entryId: draft.id, reviewed });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
      setV2(v2Data);
      await loadList(true);
    } catch (e) {
      setV2Error(e instanceof Error ? e.message : "Не удалось изменить статус проверки");
    }
  };

  const addSense = async () => {
    if (!draft?.id) return;
    try {
      const data = await adminDictionaryApi.createSense({ lang, entryId: draft.id, sense: senseDraft });
      setV2(data);
      setSenseDraft({ glossRu: "", level: "A1", register: "разговорная", definitionRu: "", usageNote: "" });
      setAddSenseOpen(false);
    } catch (e) {
      setV2Error(e instanceof Error ? e.message : "Не удалось добавить значение");
    }
  };

  const startEditSense = (s: AdminDictionaryEntryV2Response["senses"][number]) => {
    setEditingSenseId(s.id);
    setSenseEdit({
      glossRu: s.glossRu || "",
      level: s.level || "A0",
      register: s.register || "разговорная",
      definitionRu: s.definitionRu || "",
      usageNote: s.usageNote || "",
    });
  };

  const saveSense = async (senseId: number) => {
    if (!senseEdit || !draft?.id) return;
    try {
      await adminDictionaryApi.patchSense({ lang, senseId, patch: senseEdit });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
      setV2(v2Data);
      setEditingSenseId(null);
      setSenseEdit(null);
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось сохранить значение"));
    }
  };

  const deleteSense = async (senseId: number) => {
    if (!draft?.id) return;
    if (!confirm("Удалить это значение?")) return;
    try {
      await adminDictionaryApi.deleteSense({ lang, id: senseId });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
      setV2(v2Data);
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось удалить значение"));
    }
  };

  const addExample = async (senseId: number) => {
    const cur = newExampleBySense[senseId] || { en: "", ru: "", isMain: true };
    if (!cur.en.trim()) return;
    try {
      await adminDictionaryApi.addExample({ lang, senseId, example: { en: cur.en, ru: cur.ru, isMain: cur.isMain } });
      if (draft?.id) {
        const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
        setV2(v2Data);
      }
      setNewExampleBySense((prev) => ({ ...prev, [senseId]: { en: "", ru: "", isMain: false } }));
      setAddExampleSenseId(null);
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось добавить пример"));
    }
  };

  const askAiBlock2 = async () => {
    const id = draft?.id || selected?.id || selectedId;
    const w = (draft?.en || selected?.en || query).trim();
    if (!id && !w) return;
    setBlock2AiState("loading");
    setBlock2AiStatus("Генерирую смыслы и примеры для блока 2...");
    setV2Error(null);
    try {
      const { draft: out } = await adminDictionaryApi.aiDraftBlock2({
        lang,
        entryId: id ?? undefined,
        word: id ? undefined : w,
      });
      const senses = Array.isArray(out?.senses) ? out.senses : [];
      if (!id || senses.length === 0) {
        setBlock2AiStatus("AI не вернул новых смыслов/примеров.");
        setBlock2AiState("idle");
        return;
      }
      const senseNos = senses.map((s) => Number(s?.senseNo)).filter((n) => Number.isFinite(n) && n > 0);
      await adminDictionaryApi.applyDraft({
        lang,
        entryId: id,
        draft: { senses, warnings: out?.warnings || [] },
        apply: {
          entryPatch: false,
          lemmaPatch: false,
          selectedSenseNos: senseNos,
          replaceExamples: true,
          applySense1Core: true,
          selectedFormIndexes: [],
        },
      });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id });
      setV2(v2Data);
      await refreshWizardState(id);
      setBlock2AiStatus(`Готово: обновлено смыслов — ${senses.length}.`);
      setBlock2AiState("idle");
    } catch (e) {
      setBlock2AiState("error");
      setV2Error(formatApiError(e, "Ошибка AI блока 2"));
      setBlock2AiStatus("Ошибка AI блока 2.");
    }
  };

  const setMainExample = async (exampleId: number) => {
    if (!draft?.id) return;
    try {
      await adminDictionaryApi.setMainExample({ lang, id: exampleId });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
      setV2(v2Data);
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось сделать пример главным"));
    }
  };

  const deleteExample = async (exampleId: number) => {
    if (!draft?.id) return;
    if (!confirm("Удалить пример?")) return;
    try {
      await adminDictionaryApi.deleteExample({ lang, id: exampleId });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
      setV2(v2Data);
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось удалить пример"));
    }
  };

  const startEditExample = (ex: { en: string; ru: string; isMain: boolean; sortOrder: number; id: number }) => {
    setEditingExampleId(ex.id);
    setExampleEdit({ en: ex.en, ru: ex.ru || "", isMain: !!ex.isMain, sortOrder: ex.sortOrder ?? 0 });
  };

  const saveExample = async (exampleId: number) => {
    if (!exampleEdit || !draft?.id) return;
    try {
      await adminDictionaryApi.patchExample({ lang, id: exampleId, patch: exampleEdit });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
      setV2(v2Data);
      setEditingExampleId(null);
      setExampleEdit(null);
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось сохранить пример"));
    }
  };

  const checkOpenAiKey = async () => {
    setOpenaiCheckResult(null);
    setOpenaiCheckError(null);
    try {
      const info = await adminDictionaryApi.openaiCheck();
      setOpenaiCheckResult(info);
    } catch (e) {
      setOpenaiCheckError(formatApiError(e, "Не удалось проверить ключ"));
    }
  };

  const toggleBatchId = (id: number) => {
    setBatchSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllVisibleForBatch = () => {
    setBatchSelectedIds((prev) => {
      const visible = items.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0);
      const allSelected = visible.length > 0 && visible.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !visible.includes(id));
      return Array.from(new Set([...prev, ...visible]));
    });
  };

  const runBatchFormsDraft = async () => {
    if (batchSelectedIds.length === 0) return;
    setBatchState("loading");
    setBatchReport([]);
    const report: Array<{ id: number; en: string; status: "ok" | "error"; formsCount: number; warnings: string[]; error?: string }> = [];
    const selectedWords = items.filter((x) => batchSelectedIds.includes(Number(x.id)));
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const w of selectedWords) {
      let attempt = 0;
      let success = false;
      let lastErr = "";
      while (!success && attempt <= batchRetryCount) {
        attempt++;
        try {
          const isFormsOnly = batchMode === "forms_only";
          const { draft: out } = await adminDictionaryApi.aiDraft({
            lang,
            entryId: Number(w.id),
            mode: isFormsOnly ? "forms_only" : "full",
          });
          if (!isFormsOnly) {
            const senses = Array.isArray(out?.senses) ? out.senses : [];
            const forms = Array.isArray(out?.forms) ? out.forms : [];
            const selectedSenseNos = batchApplySenses
              ? senses.map((s) => Number(s?.senseNo)).filter((n) => Number.isFinite(n) && n > 0)
              : [];
            const selectedFormIndexes = batchApplyForms ? forms.map((_, idx) => idx) : [];
            await adminDictionaryApi.applyDraft({
              lang,
              entryId: Number(w.id),
              draft: out,
              apply: {
                entryPatch: batchApplyEntryPatch,
                lemmaPatch: batchApplyEntryPatch,
                selectedSenseNos,
                selectedFormIndexes,
                replaceExamples: batchApplyReplaceExamples,
                applySense1Core: batchApplySense1Core,
              },
            });
          }
          report.push({
            id: Number(w.id),
            en: String(w.en || ""),
            status: "ok",
            formsCount: Array.isArray(out?.forms) ? out.forms.length : 0,
            warnings: Array.isArray(out?.warnings) ? out.warnings.map((x) => String(x)) : [],
          });
          success = true;
        } catch (e) {
          lastErr = formatApiError(e, "Ошибка пакетного AI-применения");
          if (attempt > batchRetryCount) {
            report.push({
              id: Number(w.id),
              en: String(w.en || ""),
              status: "error",
              formsCount: 0,
              warnings: [],
              error: lastErr,
            });
          }
        }
      }
      setBatchReport([...report]);
      if (batchDelayMs > 0) await pause(batchDelayMs);
    }
    setBatchState("idle");
  };

  const exportBatchReport = () => {
    if (!batchReport.length) return;
    const header = ["id", "en", "status", "formsCount", "warnings", "error"];
    const lines = [header.join(",")];
    for (const row of batchReport) {
      lines.push(
        [
          row.id,
          row.en,
          row.status,
          row.formsCount,
          (row.warnings || []).join(" | "),
          row.error || "",
        ].map(csvEscape).join(",")
      );
    }
    downloadText(`ai_batch_report_${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  };

  const updateCreateEntryField = (field: WordEditField, value: unknown) => {
    setCreateEntryDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateCreateSense = (idx: number, patch: Partial<CreateSenseDraft>) => {
    setCreateSenses((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const updateCreateExample = (senseIdx: number, exIdx: number, patch: Partial<{ en: string; ru: string }>) => {
    setCreateSenses((prev) =>
      prev.map((s, i) => {
        if (i !== senseIdx) return s;
        const nextExamples = s.examples.map((ex, eIdx) => (eIdx === exIdx ? { ...ex, ...patch } : ex));
        return { ...s, examples: nextExamples };
      })
    );
  };

  const addCreateSense = () => {
    setCreateSenses((prev) => [
      ...prev,
      {
        glossRu: "",
        level: String(createEntryDraft.level || "A0"),
        register: String(createEntryDraft.register || "разговорная"),
        definitionRu: "",
        usageNote: "",
        examples: [{ en: "", ru: "" }],
      },
    ]);
  };

  const removeCreateSense = (idx: number) => {
    setCreateSenses((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const addCreateExample = (senseIdx: number) => {
    setCreateSenses((prev) =>
      prev.map((s, i) => (i === senseIdx ? { ...s, examples: [...s.examples, { en: "", ru: "" }] } : s))
    );
  };

  const removeCreateExample = (senseIdx: number, exIdx: number) => {
    setCreateSenses((prev) =>
      prev.map((s, i) => {
        if (i !== senseIdx) return s;
        if (s.examples.length <= 1) return s;
        return { ...s, examples: s.examples.filter((_, eIdx) => eIdx !== exIdx) };
      })
    );
  };

  const updateCreateForm = (idx: number, patch: Partial<CreateFormDraft>) => {
    setCreateForms((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const addCreateForm = () => {
    setCreateForms((prev) => [...prev, { form: "", formType: "", isIrregular: false, notes: "" }]);
  };

  const removeCreateForm = (idx: number) => {
    setCreateForms((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const resetCreateForm = () => {
    setCreateEntryDraft({
      en: "",
      ru: "",
      level: "A0",
      accent: "both",
      frequencyRank: 15000,
      rarity: "не редкое",
      register: "разговорная",
      ipaUk: "",
      ipaUs: "",
      example: "",
      exampleRu: "",
    });
    setCreateSenses([
      {
        glossRu: "",
        level: "A0",
        register: "разговорная",
        definitionRu: "",
        usageNote: "",
        examples: [{ en: "", ru: "" }],
      },
    ]);
    setCreateForms([{ form: "", formType: "", isIrregular: false, notes: "" }]);
  };

  const runCreateEntry = async () => {
    const en = String(createEntryDraft.en || "").trim();
    const ru = String(createEntryDraft.ru || "").trim();
    if (!en || !ru) {
      setCreateError("Для создания слова обязательны EN и RU.");
      return;
    }
    setCreateState("loading");
    setCreateError(null);
    setCreateResult("");
    try {
      const payloadSenses = createSenses
        .map((s) => ({
          glossRu: String(s.glossRu || "").trim(),
          level: String(s.level || "A0"),
          register: String(s.register || "разговорная"),
          definitionRu: String(s.definitionRu || ""),
          usageNote: String(s.usageNote || ""),
          examples: (Array.isArray(s.examples) ? s.examples : [])
            .map((ex) => ({ en: String(ex.en || "").trim(), ru: String(ex.ru || "").trim() }))
            .filter((ex) => ex.en),
        }))
        .filter((s) => s.glossRu);
      if (!payloadSenses.length) {
        setCreateError("Добавьте минимум один смысл (gloss RU).");
        setCreateState("error");
        return;
      }
      const payloadForms = createForms
        .map((f) => ({
          form: String(f.form || "").trim(),
          formType: String(f.formType || "").trim(),
          isIrregular: !!f.isIrregular,
          notes: String(f.notes || ""),
        }))
        .filter((f) => f.form);
      const out = await adminDictionaryApi.createEntry({
        lang,
        entry: {
          en,
          ru,
          level: String(createEntryDraft.level || "A0"),
          accent: String(createEntryDraft.accent || "both"),
          frequencyRank: toNumber(createEntryDraft.frequencyRank, 15000),
          rarity: String(createEntryDraft.rarity || "не редкое"),
          register: String(createEntryDraft.register || "разговорная"),
          ipaUk: String(createEntryDraft.ipaUk || "").trim(),
          ipaUs: String(createEntryDraft.ipaUs || "").trim(),
          example: String(createEntryDraft.example || "").trim(),
          exampleRu: String(createEntryDraft.exampleRu || "").trim(),
        },
        senses: payloadSenses,
        forms: payloadForms,
      });
      setCreateResult(`Слово создано: #${out.entryId}`);
      setCreateState("idle");
      resetCreateForm();
      await loadList(true);
      if (out.entryId) {
        navigate(`/admin/dictionary/word/${out.entryId}`);
      }
    } catch (e) {
      setCreateState("error");
      setCreateError(formatApiError(e, "Не удалось создать слово"));
    }
  };

  const runBulkAddSelectedToCollection = async () => {
    if (!batchSelectedIds.length || !batchCollectionId) return;
    setBatchCollectionState("loading");
    setBatchCollectionError(null);
    setBatchCollectionResult(null);
    try {
      const out = await adminDictionaryApi.addCollectionItemsBulk({
        lang,
        collectionId: Number(batchCollectionId),
        entryIds: batchSelectedIds,
      });
      setBatchCollectionResult({
        requested: Number(out?.totals?.requested || 0),
        added: Number(out?.totals?.added || 0),
        skipped: Number(out?.totals?.skipped || 0),
        errors: Number(out?.totals?.errors || 0),
      });
      setBatchCollectionState("idle");
      if (selectedCollectionId && Number(selectedCollectionId) === Number(batchCollectionId)) {
        await loadCollectionItemsAdmin(Number(selectedCollectionId));
      }
    } catch (e) {
      setBatchCollectionState("error");
      setBatchCollectionError(formatApiError(e, "Не удалось массово добавить слова в коллекцию"));
    }
  };

  const askAi = async () => {
    const id = draft?.id ?? null;
    const w = (editedDraft?.en || draft?.en || selected?.en || query).trim();
    if (!w) return;
    if (!id) {
      setAiError("Откройте слово для подсказки по карточке (блок 1).");
      setAiStatusText("Ожидание: откройте слово, затем запустите AI‑подсказку для блока 1.");
      return;
    }
    setAiState("loading");
    setAiError(null);
    setAiStatusText("Выполняется AI‑подсказка...");
    setAiSuggestedFields(null);
    setAiAppliedSensesCount(null);
    const prev = editedDraft ?? draft ?? {};
    try {
      const { suggestion } = await adminDictionaryApi.aiSuggest({
        lang,
        word: w,
        existing: prev,
      });
      if (!suggestion || typeof suggestion !== "object") {
        setAiState("idle");
        return;
      }
      const entryPatch = pickCardFieldsFromObject(suggestion as Record<string, unknown>) as Partial<Word>;
      const prevEntry = editedDraft ?? draft ?? {};
      const changedByAi = (WORD_EDIT_FIELDS as readonly string[]).filter(
        (field) => {
          const key = field as WordEditField;
          if (!(key in entryPatch)) return false;
          return normalizeFieldValue(key, prevEntry[key]) !== normalizeFieldValue(key, (entryPatch as Partial<Word>)[key]);
        }
      ) as WordEditField[];
      setAiSuggestedFields(changedByAi);
      setEditedDraft((prevState) => ({ ...(prevState || {}), ...(entryPatch as Partial<Word>) }));
      setAiStatusText(`Готово: AI предложил обновить ${changedByAi.length} полей карточки (блок 1).`);
    } catch (e) {
      const msg = formatApiError(e, "Ошибка AI-подсказки");
      setAiError(msg);
      setAiStatusText(`Ошибка AI: ${msg}`);
    } finally {
      setAiState("idle");
    }
  };

  const fillIpa = async () => {
    const id = draft?.id || selected?.id || selectedId;
    const word = String(editedDraft?.en ?? draft?.en ?? selected?.en ?? "").trim();
    if (!id && !word) {
      setAiError("Укажите слово (EN), чтобы сгенерировать IPA.");
      setIpaStatusText("Ожидание: укажите слово (EN) для генерации IPA.");
      return;
    }
    setIpaFillState("loading");
    setAiError(null);
    setIpaStatusText("Выполняется генерация IPA (UK/US)...");
    try {
      const res = await adminDictionaryApi.fillIpa({
        lang,
        entryId: id ?? undefined,
        word: word || undefined,
      });
      setEditedDraft((prev) => ({
        ...(prev || {}),
        ipaUk: String(res.ipaUk || ""),
        ipaUs: String(res.ipaUs || ""),
      }));
      setIpaStatusText(`Готово: IPA заполнены. UK: ${String(res.ipaUk || "")} | US: ${String(res.ipaUs || "")}`);
    } catch (e) {
      const msg = formatApiError(e, "Ошибка генерации IPA");
      setAiError(msg);
      setIpaStatusText(`Ошибка IPA: ${msg}`);
    } finally {
      setIpaFillState("idle");
    }
  };

  const askAiDraft = async () => {
    const id = draft?.id || selected?.id || selectedId;
    const w = (draft?.en || selected?.en || query).trim();
    if (!id && !w) return;
    setAiDraftState("loading");
    setAiDraftError(null);
    setAiDraftJson("");
    setAiDraft(null);
    try {
      const { draft: out } = await adminDictionaryApi.aiDraft({
        lang,
        entryId: id ?? undefined,
        word: id ? undefined : w,
      });
      setAiDraft(out || null);
      setAiDraftJson(JSON.stringify(out || {}, null, 2));
      const senseNos = Array.isArray(out?.senses)
        ? out.senses.map((s) => Number(s?.senseNo)).filter((n) => Number.isFinite(n) && n > 0)
        : [];
      setApplyDraftSenseNos(senseNos);
      const formIdx = Array.isArray(out?.forms) ? out.forms.map((_, idx) => idx) : [];
      setApplyDraftFormIndexes(formIdx);
      setApplyDraftEntryPatch(true);
      setApplyDraftLemmaPatch(true);
      setAiDraftState("idle");
    } catch (e) {
      setAiDraftState("error");
      setAiDraftError(formatApiError(e, "Ошибка AI‑черновика"));
    }
  };

  const askAiFormsDraft = async () => {
    const id = draft?.id || selected?.id || selectedId;
    const w = (draft?.en || selected?.en || query).trim();
    if (!id && !w) return;
    setFormsDraftState("loading");
    setFormsDraftError(null);
    setFormsDraftJson("");
    setFormsDraft(null);
    setFormsDraftStatusText("Генерация черновика форм...");
    try {
      const { draft: out } = await adminDictionaryApi.aiDraftBlock3({
        lang,
        entryId: id ?? undefined,
        word: id ? undefined : w,
      });
      const clean = out || null;
      setFormsDraft(clean);
      setFormsDraftJson(JSON.stringify(clean || {}, null, 2));
      setFormsDraftStatusText(`Готово: сгенерировано карточек форм — ${Array.isArray(clean?.formCardsDraft) ? clean.formCardsDraft.length : 0}.`);
      setFormsDraftState("idle");
    } catch (e) {
      setFormsDraftState("error");
      setFormsDraftError(formatApiError(e, "Ошибка AI‑черновика форм"));
      setFormsDraftStatusText("Ошибка генерации форм.");
    }
  };

  const applyFormsDraft = async () => {
    if (!formsDraft) return;
    setFormsDraftState("loading");
    setFormsDraftError(null);
    setFormsDraftStatusText("Применение форм из черновика...");
    try {
      const nextCards = (Array.isArray(formsDraft.formCardsDraft) ? formsDraft.formCardsDraft : []).map((x, idx) => ({
        ...x,
        en: String(x?.en || "").trim(),
        sortOrder: idx,
      })) as AdminDictionaryFormCard[];
      if (nextCards.length > 0) {
        setFormCards(nextCards);
      }
      setFormsDraftStatusText("Готово: формы применены в карточки блока 3.");
      setFormsDraftState("idle");
    } catch (e) {
      setFormsDraftState("error");
      setFormsDraftError(formatApiError(e, "Не удалось применить формы из черновика"));
      setFormsDraftStatusText("Ошибка применения форм.");
    }
  };

  const addFormCard = () => {
    const base = editedDraft || draft;
    setFormCards((prev) => [
      ...prev,
      {
        en: "",
        ru: String(base?.ru || ""),
        level: String(base?.level || "A0"),
        accent: String(base?.accent || "both"),
        frequencyRank: Number(base?.frequencyRank || 15000),
        rarity: String(base?.rarity || "редкое"),
        register: String(base?.register || "разговорная"),
        ipaUk: String(base?.ipaUk || ""),
        ipaUs: String(base?.ipaUs || ""),
        example: String(base?.example || ""),
        exampleRu: String(base?.exampleRu || ""),
        pos: String((v2 as any)?.lemma?.pos || ""),
      },
    ]);
  };

  const patchFormCard = (idx: number, patch: Partial<AdminDictionaryFormCard>) => {
    setFormCards((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const removeFormCard = (idx: number) => {
    setFormCards((prev) => prev.filter((_, i) => i !== idx));
  };

  const deleteFormCard = async (idx: number) => {
    const card = formCards[idx];
    if (!card) return;
    // Not saved yet — only local removal
    if (!card.id) {
      removeFormCard(idx);
      return;
    }
    if (!draft?.id) return;

    const en = String(card.en || "").trim() || `#${idx + 1}`;
    if (!window.confirm(`Удалить карточку формы "${en}"? Она исчезнет из «Все слова».`)) return;

    setFormCardsState("loading");
    setFormCardsError(null);
    setFormCardsStatus("");
    try {
      const res = await adminDictionaryApi.deleteFormCard({
        lang,
        entryId: draft.id,
        formCardId: Number(card.id),
      });
      if (!res?.ok) throw new Error("deleteFormCard: unexpected response");
      setFormCards((prev) => prev.filter((_, i) => i !== idx));
      setFormCardsState("idle");
      setFormCardsStatus(`Удалено: "${en}".`);
    } catch (e) {
      setFormCardsState("error");
      setFormCardsError(formatApiError(e, "Не удалось удалить карточку формы"));
    }
  };

  const deleteEntryFully = async (entryId: number, label: string) => {
    if (!window.confirm(`Полностью удалить слово "${label}"?`)) return;
    setSearchState("loading");
    setSearchError(null);
    try {
      const res = await adminDictionaryApi.deleteEntry({ lang, entryId });
      if (!res?.ok) throw new Error("deleteEntry: unexpected response");
      if (Number(editingEntryId) === Number(entryId)) {
        navigate("/admin/dictionary");
      }
      setBatchSelectedIds((prev) => prev.filter((id) => Number(id) !== Number(entryId)));
      await loadList(true);
      setSearchState("idle");
    } catch (e) {
      setSearchState("error");
      setSearchError(formatApiError(e, "Не удалось удалить слово"));
    }
  };

  const saveFormCards = async () => {
    if (!draft?.id) return;
    setFormCardsState("loading");
    setFormCardsError(null);
    setFormCardsStatus("");
    try {
      const normalized = formCards.map((c, idx) => ({
        ...c,
        en: String(c.en || "").trim(),
        ru: String(c.ru || "").trim(),
        level: String(c.level || "A0").trim() || "A0",
        accent: String(c.accent || "both").trim() || "both",
        frequencyRank: Math.max(1, Number(c.frequencyRank || 15000) || 15000),
        rarity: String(c.rarity || "редкое").trim() || "редкое",
        register: String(c.register || "разговорная").trim() || "разговорная",
        ipaUk: String(c.ipaUk || "").trim(),
        ipaUs: String(c.ipaUs || "").trim(),
        example: String(c.example || "").trim(),
        exampleRu: String(c.exampleRu || "").trim(),
        pos: String(c.pos || "").trim(),
        sortOrder: idx,
      }));
      const errors: string[] = [];
      const dupes = new Set<string>();
      const seen = new Set<string>();
      normalized.forEach((c, idx) => {
        if (!c.en) errors.push(`Карточка #${idx + 1}: пустое поле EN.`);
        if (!c.level || !c.register || !c.example || !c.exampleRu) {
          errors.push(`Карточка #${idx + 1}: заполните level/register/example/exampleRu.`);
        }
        const key = c.en.toLowerCase();
        if (key) {
          if (seen.has(key)) dupes.add(c.en);
          seen.add(key);
        }
      });
      if (dupes.size > 0) {
        errors.push(`Дубли EN форм: ${Array.from(dupes).join(", ")}`);
      }
      if (errors.length > 0) {
        setFormCardsState("error");
        setFormCardsError(errors.join(" "));
        return;
      }
      await adminDictionaryApi.saveBlock3({ entryId: draft.id, cards: normalized });
      await refreshWizardState(draft.id);
      setFormCardsState("idle");
    } catch (e) {
      setFormCardsState("error");
      setFormCardsError(formatApiError(e, "Не удалось сохранить карточки форм"));
    }
  };

  const applyAiDraft = async () => {
    if (!draft?.id || !aiDraft) return;
    setAiDraftState("loading");
    setAiDraftError(null);
    try {
      const res = await adminDictionaryApi.applyDraft({
        lang,
        entryId: draft.id,
        draft: aiDraft,
        apply: {
          entryPatch: applyDraftEntryPatch,
          lemmaPatch: applyDraftLemmaPatch,
          selectedSenseNos: applyDraftSenseNos,
          selectedFormIndexes: applyDraftFormIndexes,
          replaceExamples: applyDraftReplaceExamples,
          applySense1Core: applyDraftSense1Core,
        },
      });
      if (res?.entry) setV2(res.entry);
      // Подтянем свежие данные и в форму карточки (legacy) — чтобы не расходиться с v2/примером.
      const { entry } = await adminDictionaryApi.getEntry({ lang, id: draft.id });
      setDraft(entry);
      setAiDraftState("idle");
      await loadList(true);
    } catch (e) {
      setAiDraftState("error");
      setAiDraftError(formatApiError(e, "Не удалось применить AI‑черновик"));
    }
  };

  const applyAiJson = () => {
    try {
      const parsed = JSON.parse(aiJson);
      if (!parsed || typeof parsed !== "object") return;
      setEditedDraft((prev) => ({ ...(prev || {}), ...(parsed as Partial<Word>) }));
    } catch {
      setAiError("JSON не парсится");
    }
  };

  const fieldLabel: Record<WordEditField, string> = {
    en: "Слово/выражение (EN)",
    ru: "Короткий перевод (RU)",
    level: "Уровень (CEFR)",
    accent: "Акцент",
    frequencyRank: "Частотность (rank)",
    rarity: "Редкость",
    register: "Регистр",
    ipaUk: "Транскрипция (IPA UK)",
    ipaUs: "Транскрипция (IPA US)",
    example: "Пример (EN)",
    exampleRu: "Перевод примера (RU)",
  };

  const updateEditedField = (field: WordEditField, value: unknown) => {
    setEditedDraft((prev) => ({ ...(prev || {}), [field]: value }));
  };

  const restoreEditedField = (field: WordEditField) => {
    if (!draft) return;
    setEditedDraft((prev) => ({ ...(prev || {}), [field]: draft[field] }));
  };

  if (!canAccess) {
    return (
      <div className="app-shell">
        <Header />
        <main className="main">
          <div className="page-card">
            <h1 className="dictionary-title">Админка словаря</h1>
            <p className="dictionary-subtitle">
              Доступно только администраторам и только в ПК‑интерфейсе.
            </p>
          </div>
        </main>
        <footer className="footer">STroova</footer>
      </div>
    );
  }

  return (
    <div className="app-shell admin-dict-page">
      <Header />
      <main className="main">
        <div className="page-card">
          <h1 className="dictionary-title">Админка словаря</h1>
          <p className="dictionary-subtitle">
            Справочник слов (леммы/значения/примеры/формы) + фильтры качества + отметка «проверено лингвистом».
          </p>

          <section className="admin-dict-hub" aria-label="Разделы админки словаря">
            <div className="admin-dict-hub__header">
              <h2 className="admin-dict-hub__title">Разделы</h2>
              <p className="admin-dict-hub__subtitle">Выберите нужный сценарий работы.</p>
            </div>
            <ul className="admin-dict-hub__list" role="list">
              {sectionCards.map((section, index) => (
                <li key={section.key} className="admin-dict-hub__item" style={{ animationDelay: `${index * 70}ms` }}>
                  <button
                    type="button"
                    className={`admin-dict-hub__card ${adminView === section.key ? "active" : ""}`}
                    onClick={() => {
                      setAdminView(section.key);
                      if (section.key !== "words") {
                        void loadCollectionsAdmin(true);
                      }
                    }}
                  >
                    <span className="admin-dict-hub__card-icon" aria-hidden>
                      <section.Icon className="admin-dict-hub__card-icon-svg" />
                    </span>
                    <div className="admin-dict-hub__card-body">
                      <h3 className="admin-dict-hub__card-title">{section.title}</h3>
                      <p className="admin-dict-hub__card-desc">{section.description}</p>
                      <span className="admin-dict-hub__card-cta">Открыть →</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {adminView === "words" && (
          <div className="admin-dict-toolbar">
            <div className="admin-dict-search-row">
              <input
                className="search-input"
                placeholder="Поиск по EN/RU…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") loadList(true);
                }}
              />
              <button
                type="button"
                className="admin-dict-btn admin-dict-btn--primary"
                onClick={() => loadList(true)}
                disabled={searchState === "loading"}
                title="Применить поиск и фильтры"
              >
                {searchState === "loading" ? "Загрузка…" : "Найти"}
              </button>
            </div>
            <div className="admin-dict-filters-row">
              <select value={filterReviewed} onChange={(e) => setFilterReviewed(e.target.value as ReviewedFilter)}>
                <option value="no">Не проверено</option>
                <option value="yes">Проверено</option>
                <option value="all">Все</option>
              </select>
              <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
                <option value="all">Уровень: все</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <select value={filterRegister} onChange={(e) => setFilterRegister(e.target.value)}>
                <option value="all">Регистр: любой</option>
                {REGISTERS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select value={filterRarity} onChange={(e) => setFilterRarity(e.target.value)}>
                <option value="all">Редкость: любая</option>
                {RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select value={order} onChange={(e) => setOrder(e.target.value as any)}>
                <option value="frequency">Сортировка: частотность</option>
                <option value="id">Сортировка: ID</option>
                <option value="reviewed_at">Сортировка: проверка</option>
              </select>
              <label className="admin-dict-qc-toggle">
                <input type="checkbox" checked={qcMissingExample} onChange={(e) => setQcMissingExample(e.target.checked)} />
                <span>Нет примера</span>
              </label>
              <label className="admin-dict-qc-toggle">
                <input type="checkbox" checked={qcMissingIpa} onChange={(e) => setQcMissingIpa(e.target.checked)} />
                <span>Нет IPA</span>
              </label>
              <label className="admin-dict-qc-toggle">
                <input type="checkbox" checked={qcMissingRu} onChange={(e) => setQcMissingRu(e.target.checked)} />
                <span>Нет RU</span>
              </label>
              <button
                type="button"
                className="admin-dict-btn admin-dict-btn--secondary"
                onClick={() => {
                  setQuery("");
                  setFilterLevel("all");
                  setFilterRegister("all");
                  setFilterRarity("all");
                  setFilterReviewed("no");
                  setOrder("frequency");
                  setQcMissingExample(false);
                  setQcMissingIpa(false);
                  setQcMissingRu(false);
                  void loadList(true);
                }}
                title="Сбросить все фильтры"
              >
                Сброс фильтров
              </button>
            </div>
          </div>
          )}

          {adminView === "ai_bulk" && !editingEntryId && (
            <div className="admin-dict-section admin-dict-section--spaced">
              <div className="admin-dict-section-title admin-dict-section-title--with-actions">
                <span>AI‑импорт слов</span>
                <button
                  type="button"
                  className="admin-dict-btn admin-dict-btn--secondary"
                  onClick={() => setAiImportOpen((v) => !v)}
                  title="Показать/скрыть инструмент AI‑импорта"
                >
                  {aiImportOpen ? "Скрыть" : "Показать"}
                </button>
              </div>

              {aiImportOpen && (
                <div className="admin-dict-form admin-dict-form--spaced">
                  <label className="admin-dict-field">
                    <span className="admin-dict-label">Уровень</span>
                    <select value={aiImportLevel} onChange={(e) => setAiImportLevel(e.target.value)}>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-dict-field">
                    <span className="admin-dict-label">Регистр</span>
                    <select value={aiImportRegister} onChange={(e) => setAiImportRegister(e.target.value as any)}>
                      {REGISTERS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-dict-field">
                    <span className="admin-dict-label">Тема (опционально)</span>
                    <input
                      value={aiImportTopic}
                      onChange={(e) => setAiImportTopic(e.target.value)}
                      placeholder="Напр.: IT, медицина, путешествия…"
                    />
                  </label>

                  <label className="admin-dict-field">
                    <span className="admin-dict-label">Количество</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={aiImportCount}
                      onChange={(e) => setAiImportCount(Number(e.target.value))}
                    />
                    <HelpText>Сначала генерируется предпросмотр. Дубликаты уже в словаре будут пропущены автоматически.</HelpText>
                  </label>

                  <div className="admin-dict-actions admin-dict-actions--no-top">
                    <button
                      type="button"
                      className="admin-dict-btn admin-dict-btn--primary"
                      onClick={runAiImportPreview}
                      disabled={aiImportPreviewState === "loading" || aiImportCommitState === "loading"}
                    >
                      {aiImportPreviewState === "loading" ? "Генерация…" : "Сгенерировать список"}
                    </button>

                    <button
                      type="button"
                      className="admin-dict-btn admin-dict-btn--secondary"
                      onClick={runAiImportCommit}
                      disabled={aiImportCommitState === "loading" || aiImportSavableCount === 0}
                      title={aiImportSavableCount === 0 ? "Нет новых слов для сохранения" : `Сохранить ${aiImportSavableCount}`}
                    >
                      {aiImportCommitState === "loading" ? "Сохранение…" : `Сохранить (${aiImportSavableCount})`}
                    </button>
                  </div>

                  {aiImportError && (
                    <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
                      {aiImportError}
                    </div>
                  )}

                  {aiImportCommitResult && (
                    <div className="dictionary-success-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
                      Добавлено: {aiImportCommitResult.inserted}. Пропущено (дубликаты): {aiImportCommitResult.skippedDuplicates}.
                    </div>
                  )}

                  {(aiImportStats || aiImportPreview.length > 0) && (
                    <div className="admin-dict-block admin-dict-block--spaced">
                      {aiImportStatus && !aiImportStatus.ok && (
                        <div className="dictionary-warning-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
                          {aiImportStatus.message}
                        </div>
                      )}
                      {aiImportStats && (
                        <div className="admin-dict-help">
                          Предпросмотр: {aiImportStats.unique} (из них дубликаты: {aiImportStats.duplicates}) при запросе {aiImportStats.requested}.
                        </div>
                      )}

                      {aiImportPreview.length > 0 && (
                        <ul className="admin-dict-results-list admin-dict-results-list--spaced">
                          {aiImportPreview.map((it) => (
                            <li key={it.lemmaKey}>
                              <div
                                className="admin-dict-result"
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  opacity: it.exists ? 0.55 : 1,
                                }}
                              >
                                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                  <div style={{ fontWeight: 700 }}>{it.word}</div>
                                  {it.exists && <div className="admin-dict-help">уже в словаре (будет пропущено)</div>}
                                </div>
                                <button
                                  type="button"
                                  className="admin-dict-btn admin-dict-btn--ghost"
                                  onClick={() => setAiImportPreview((prev) => prev.filter((x) => x.lemmaKey !== it.lemmaKey))}
                                  title="Удалить из списка"
                                >
                                  Удалить
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {adminView === "ai_bulk" && !editingEntryId && (
            <div className="admin-dict-section admin-dict-section--spaced">
              <div className="admin-dict-section-title">Массовые действия по отмеченным словам</div>
              <div className="admin-dict-help">
                Отмечайте слова в категории «Слова», затем возвращайтесь сюда для пакетной обработки.
              </div>
              <div className="admin-dict-inline-meta">
                <span>Отмечено слов: <b>{batchSelectedIds.length}</b></span>
                <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => setAdminView("words")}>
                  Перейти к выбору слов
                </button>
              </div>

              <div className="admin-dict-form admin-dict-form--spaced">
                <label className="admin-dict-field">
                  <span className="admin-dict-label">Режим batch AI</span>
                  <select value={batchMode} onChange={(e) => setBatchMode(e.target.value as "forms_only" | "full_apply")}>
                    <option value="full_apply">Полный draft + применение</option>
                    <option value="forms_only">Только forms-only draft (без применения)</option>
                  </select>
                </label>
                <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={batchApplyEntryPatch} onChange={(e) => setBatchApplyEntryPatch(e.target.checked)} disabled={batchMode === "forms_only"} />
                  <span className="admin-dict-label" style={{ margin: 0 }}>Применять карточку/lemma patch</span>
                </label>
                <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={batchApplySenses} onChange={(e) => setBatchApplySenses(e.target.checked)} disabled={batchMode === "forms_only"} />
                  <span className="admin-dict-label" style={{ margin: 0 }}>Применять смыслы и примеры</span>
                </label>
                <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={batchApplyForms} onChange={(e) => setBatchApplyForms(e.target.checked)} />
                  <span className="admin-dict-label" style={{ margin: 0 }}>Применять формы</span>
                </label>
                <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={batchApplyReplaceExamples} onChange={(e) => setBatchApplyReplaceExamples(e.target.checked)} disabled={batchMode === "forms_only"} />
                  <span className="admin-dict-label" style={{ margin: 0 }}>Replace examples</span>
                </label>
                <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={batchApplySense1Core} onChange={(e) => setBatchApplySense1Core(e.target.checked)} disabled={batchMode === "forms_only"} />
                  <span className="admin-dict-label" style={{ margin: 0 }}>Разрешить core-поля для sense #1</span>
                </label>
                <div className="admin-dict-row">
                  <label className="admin-dict-field">
                    <span className="admin-dict-label">Пауза между запросами, мс</span>
                    <input type="number" value={batchDelayMs} onChange={(e) => setBatchDelayMs(Math.max(0, Number(e.target.value) || 0))} />
                  </label>
                  <label className="admin-dict-field">
                    <span className="admin-dict-label">Retry</span>
                    <input type="number" value={batchRetryCount} onChange={(e) => setBatchRetryCount(Math.max(0, Math.min(5, Number(e.target.value) || 0)))} />
                  </label>
                </div>
                <div className="admin-dict-actions">
                  <button type="button" className="admin-dict-btn admin-dict-btn--primary" onClick={() => void runBatchFormsDraft()} disabled={batchState === "loading" || batchSelectedIds.length === 0}>
                    {batchState === "loading" ? "Batch..." : "Запустить batch AI"}
                  </button>
                  <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={exportBatchReport} disabled={batchReport.length === 0}>
                    Экспорт отчёта batch
                  </button>
                </div>
                {batchReport.length > 0 && (
                  <div className="admin-dict-help">
                    Готово: {batchReport.filter((x) => x.status === "ok").length} ok / {batchReport.filter((x) => x.status === "error").length} error.
                  </div>
                )}
              </div>

              <div className="admin-dict-block admin-dict-block--spaced-lg">
                <div className="admin-dict-section-title">Массово добавить отмеченные слова в коллекцию</div>
                <div className="admin-dict-row admin-dict-row--spaced">
                  <label className="admin-dict-field">
                    <span className="admin-dict-label">Коллекция</span>
                    <select value={String(batchCollectionId || "")} onChange={(e) => setBatchCollectionId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Выберите коллекцию</option>
                      {collectionsList.map((c) => (
                        <option key={`bulk-col-${c.id}`} value={c.id}>
                          {c.title} ({c.collectionKey})
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="admin-dict-actions admin-dict-actions--end">
                    <button
                      type="button"
                      className="admin-dict-btn admin-dict-btn--primary"
                      onClick={() => void runBulkAddSelectedToCollection()}
                      disabled={batchCollectionState === "loading" || !batchCollectionId || batchSelectedIds.length === 0}
                    >
                      {batchCollectionState === "loading" ? "Добавление..." : "Добавить выбранные"}
                    </button>
                  </div>
                </div>
                {batchCollectionError && <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>{batchCollectionError}</div>}
                {batchCollectionResult && (
                  <div className="dictionary-success-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
                    Запрошено: {batchCollectionResult.requested}. Добавлено: {batchCollectionResult.added}. Пропущено: {batchCollectionResult.skipped}. Ошибок: {batchCollectionResult.errors}.
                  </div>
                )}
              </div>
            </div>
          )}

          {searchError && (
            <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
              {searchError}
            </div>
          )}

          {adminView === "collections" && (
            <div className="admin-dict-section admin-dict-section--spaced">
              {collectionsError && <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginBottom: 8 }}>{collectionsError}</div>}

              <div className="admin-dict-section-title">Управление коллекциями</div>
              <div className="admin-dict-help">
                Коллекции поддерживают добавление элементов разных типов (слово, форма, карточка формы, фраза, паттерн).
                В состав коллекции сохраняется соответствующий смысл (`sense`), поэтому дубликаты автоматически схлопываются.
              </div>

              <div className="admin-dict-row admin-dict-row--spaced-md">
                <label className="admin-dict-field">
                  <span className="admin-dict-label">Поиск коллекций</span>
                  <input
                    value={collectionsQuery}
                    onChange={(e) => setCollectionsQuery(e.target.value)}
                    placeholder="Название / key / описание"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void loadCollectionsAdmin(true);
                    }}
                  />
                </label>
                <div className="admin-dict-actions admin-dict-actions--end">
                  <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => void loadCollectionsAdmin(true)}>
                    Обновить список
                  </button>
                  <button
                    type="button"
                    className="admin-dict-btn admin-dict-btn--secondary"
                    onClick={() => {
                      resetCollectionForm();
                      setSelectedCollectionId(null);
                      setCollectionItems([]);
                      setCollectionItemsTotal(0);
                    }}
                  >
                    Новая коллекция
                  </button>
                </div>
              </div>

              <div className="admin-dict-layout admin-dict-layout--spaced">
                <div className="admin-dict-results">
                  <div className="admin-dict-results-title">
                    Коллекции ({collectionsList.length}/{collectionsTotal})
                  </div>
                  {collectionsState === "loading" && <div className="admin-dict-muted">Загрузка коллекций…</div>}
                  <ul className="admin-dict-results-list" role="list">
                    {collectionsList.map((c) => (
                      <li key={`col-${c.id}`}>
                        <button
                          type="button"
                          className={`admin-dict-result ${Number(selectedCollectionId) === Number(c.id) ? "active" : ""}`}
                          onClick={() => void selectCollectionAdmin(Number(c.id))}
                        >
                          <div className="admin-dict-result-top">
                            <span className="admin-dict-result-en">{c.title}</span>
                            <span className="admin-dict-chip">#{c.sortOrder}</span>
                          </div>
                          <div className="admin-dict-result-bottom">
                            <span className="admin-dict-result-ru">{c.collectionKey}</span>
                            <span className="admin-dict-muted">{c.total} эл.</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="admin-dict-editor">
                  <div className="admin-dict-results-title">
                    {collectionForm.mode === "edit" ? "Редактирование коллекции" : "Создание коллекции"}
                  </div>
                  <div className="admin-dict-form admin-dict-form--compact">
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Collection key</span>
                      <input
                        value={collectionForm.collectionKey}
                        onChange={(e) => setCollectionForm((prev) => ({ ...prev, collectionKey: e.target.value }))}
                        placeholder="my_custom_collection"
                      />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Название</span>
                      <input
                        value={collectionForm.title}
                        onChange={(e) => setCollectionForm((prev) => ({ ...prev, title: e.target.value }))}
                        placeholder="Название коллекции"
                      />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Описание</span>
                      <textarea
                        rows={2}
                        value={collectionForm.description}
                        onChange={(e) => setCollectionForm((prev) => ({ ...prev, description: e.target.value }))}
                      />
                    </label>
                    <div className="admin-dict-row">
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Level from</span>
                        <select value={collectionForm.levelFrom} onChange={(e) => setCollectionForm((prev) => ({ ...prev, levelFrom: e.target.value }))}>
                          {LEVELS.map((l) => <option key={`col-lf-${l}`} value={l}>{l}</option>)}
                        </select>
                      </label>
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Level to</span>
                        <select value={collectionForm.levelTo} onChange={(e) => setCollectionForm((prev) => ({ ...prev, levelTo: e.target.value }))}>
                          {LEVELS.map((l) => <option key={`col-lt-${l}`} value={l}>{l}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="admin-dict-row">
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Порядок (sort order)</span>
                        <input
                          type="number"
                          value={collectionForm.sortOrder}
                          onChange={(e) => setCollectionForm((prev) => ({ ...prev, sortOrder: toNumber(e.target.value, 0) }))}
                        />
                      </label>
                      <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={collectionForm.isPublic}
                          onChange={(e) => setCollectionForm((prev) => ({ ...prev, isPublic: e.target.checked }))}
                        />
                        <span className="admin-dict-label" style={{ margin: 0 }}>Публичная коллекция</span>
                      </label>
                    </div>
                    <div className="admin-dict-actions">
                      <button
                        type="button"
                        className="admin-dict-btn admin-dict-btn--primary"
                        onClick={() => void saveCollectionAdmin()}
                        disabled={collectionSaving === "loading"}
                      >
                        {collectionSaving === "loading" ? "Сохранение…" : "Сохранить коллекцию"}
                      </button>
                      {collectionForm.mode === "edit" && collectionForm.collectionId && (
                        <button
                          type="button"
                          className="admin-dict-btn admin-dict-btn--secondary"
                          onClick={() => void deleteCollectionAdmin()}
                          disabled={collectionSaving === "loading"}
                        >
                          Удалить коллекцию
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedCollectionId && (
                    <div style={{ marginTop: 14 }}>
                      <div className="admin-dict-section-title">Состав коллекции ({collectionItemsTotal})</div>
                      {collectionItemsError && <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>{collectionItemsError}</div>}
                      {collectionItemsState === "loading" && <div className="admin-dict-muted">Загрузка состава…</div>}
                      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        {collectionItems.map((it, idx) => (
                          <div key={`ci-${it.id}-${it.senseId}`} style={{ border: "1px solid var(--border-subtle)", background: "var(--card)", padding: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 700 }}>{it.en}</div>
                                <div className="admin-dict-muted">{it.ru || "—"} • {it.level || "—"} • sense #{it.senseId}</div>
                              </div>
                              <div className="admin-dict-actions" style={{ marginTop: 0 }}>
                                <button type="button" className="admin-dict-btn admin-dict-btn--ghost" onClick={() => void moveCollectionItem(idx, idx - 1)} disabled={idx === 0}>↑</button>
                                <button type="button" className="admin-dict-btn admin-dict-btn--ghost" onClick={() => void moveCollectionItem(idx, idx + 1)} disabled={idx === collectionItems.length - 1}>↓</button>
                                <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => void removeCollectionSense(Number(it.senseId))}>Удалить</button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {collectionItems.length === 0 && collectionItemsState !== "loading" && <div className="admin-dict-muted">Пока пусто.</div>}
                      </div>

                      <div style={{ marginTop: 14 }}>
                        <div className="admin-dict-section-title">Добавить элементы</div>
                        <div className="admin-dict-help">
                          Поиск работает по всем сущностям: слова, формы, карточки форм, фразы и паттерны.
                        </div>
                        <div className="admin-dict-row" style={{ marginTop: 6 }}>
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Поиск кандидатов</span>
                            <input
                              value={collectionCandidatesQ}
                              onChange={(e) => setCollectionCandidatesQ(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void loadCollectionCandidatesAdmin();
                              }}
                              placeholder="Введите слово/форму/фразу…"
                            />
                          </label>
                          <div className="admin-dict-actions" style={{ alignSelf: "end" }}>
                            <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => void loadCollectionCandidatesAdmin()}>
                              Найти
                            </button>
                          </div>
                        </div>
                        {collectionCandidatesError && <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>{collectionCandidatesError}</div>}
                        {collectionCandidatesState === "loading" && <div className="admin-dict-muted">Загрузка кандидатов…</div>}
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          {collectionCandidates.map((c) => (
                            <div key={`cand-${c.itemType}-${c.itemId}`} style={{ border: "1px solid var(--border-subtle)", background: "var(--card)", padding: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                <div>
                                  <div style={{ fontWeight: 700 }}>{c.en}</div>
                                  <div className="admin-dict-muted">{c.ru || "—"}</div>
                                  <div className="admin-dict-muted">
                                    {c.itemType} • sense #{c.senseId ?? "—"} • level {c.level || "—"}
                                  </div>
                                </div>
                                <div className="admin-dict-actions" style={{ marginTop: 0 }}>
                                  <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => void addCandidateToCollection(c)}>
                                    Добавить
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                          {collectionCandidates.length === 0 && collectionCandidatesState !== "loading" && (
                            <div className="admin-dict-muted">Кандидаты не найдены. Уточните запрос.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {adminView === "audio" && (
            <div className="admin-dict-section admin-dict-section--spaced">
              <div className="admin-dict-section-title">Озвучка слов (female / male)</div>
              <div className="admin-dict-help">
                Проверка сканирует каталоги <code>public/audio/female</code> и <code>public/audio/male</code> на сервере и обновляет флаги в БД.
                «Только новые слова» — только те, у которых флаги ещё не проставлены. После проверки можно скачать JSON для локальной генерации.
              </div>
              <div className="admin-dict-row admin-dict-row--spaced-md">
                <button
                  type="button"
                  className="admin-dict-btn admin-dict-btn--primary"
                  onClick={() => void runAudioCheckFull()}
                  disabled={audioCheckState === "loading"}
                >
                  {audioCheckState === "loading" ? "Проверка…" : "Полная проверка"}
                </button>
                <button
                  type="button"
                  className="admin-dict-btn admin-dict-btn--secondary"
                  onClick={() => void runAudioCheckNew()}
                  disabled={audioCheckState === "loading"}
                >
                  Только новые слова
                </button>
              </div>
              {audioCheckError && (
                <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>{audioCheckError}</div>
              )}
              {audioCheckResult && (
                <div className="dictionary-success-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
                  Обновлено записей: {audioCheckResult.updated}. Слов без озвучки: {audioCheckResult.missingCount}.
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <div className="admin-dict-section-title">Слова без озвучки: {audioMissingTotal}</div>
                {audioMissingState === "loading" && <div className="admin-dict-muted">Загрузка списка…</div>}
                {audioMissingState === "idle" && audioMissingList.length > 0 && (
                  <>
                    <ul className="admin-dict-results-list" style={{ maxHeight: 300, overflow: "auto" }} role="list">
                      {audioMissingList.slice(0, 100).map((m) => (
                        <li key={`am-${m.id}`}>
                          {m.en} <span className="admin-dict-muted">({m.slug})</span>
                          {!m.hasFemale && <span style={{ marginLeft: 6, color: "var(--muted)" }}>нет ♀</span>}
                          {!m.hasMale && <span style={{ marginLeft: 4, color: "var(--muted)" }}>нет ♂</span>}
                        </li>
                      ))}
                    </ul>
                    {audioMissingList.length > 100 && (
                      <div className="admin-dict-muted" style={{ marginTop: 6 }}>Показаны первые 100 из {audioMissingList.length}.</div>
                    )}
                  </>
                )}
                {audioMissingState === "idle" && audioMissingList.length === 0 && audioMissingTotal === 0 && (
                  <div className="admin-dict-muted">Нет слов без озвучки. Выполните полную проверку или «Только новые слова».</div>
                )}
                {audioMissingState === "idle" && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="admin-dict-btn admin-dict-btn--primary"
                      onClick={() => void downloadMissingAudioJson()}
                    >
                      Скачать список для генерации (missing-audio.json)
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {adminView === "words" && !editingEntryId && (
            <div className="admin-dict-section" style={{ marginTop: 12 }}>
              <div className="admin-dict-section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span>Ручное создание слова</span>
                <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => setCreateOpen((v) => !v)}>
                  {createOpen ? "Скрыть" : "Показать"}
                </button>
              </div>
              {createOpen && (
                <div className="admin-dict-form" style={{ marginTop: 8 }}>
                  <div className="admin-dict-row">
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">EN *</span>
                      <input value={String(createEntryDraft.en || "")} onChange={(e) => updateCreateEntryField("en", e.target.value)} placeholder="word" />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">RU *</span>
                      <input value={String(createEntryDraft.ru || "")} onChange={(e) => updateCreateEntryField("ru", e.target.value)} placeholder="перевод" />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Level</span>
                      <select value={String(createEntryDraft.level || "A0")} onChange={(e) => updateCreateEntryField("level", e.target.value)}>
                        {LEVELS.map((l) => <option key={`create-level-${l}`} value={l}>{l}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="admin-dict-row">
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Accent</span>
                      <select value={String(createEntryDraft.accent || "both")} onChange={(e) => updateCreateEntryField("accent", e.target.value)}>
                        {ACCENTS.map((a) => <option key={`create-acc-${a}`} value={a}>{a}</option>)}
                      </select>
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Frequency rank</span>
                      <input type="number" value={String(createEntryDraft.frequencyRank ?? 15000)} onChange={(e) => updateCreateEntryField("frequencyRank", toNumber(e.target.value, 15000))} />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Rarity</span>
                      <select value={String(createEntryDraft.rarity || "не редкое")} onChange={(e) => updateCreateEntryField("rarity", e.target.value)}>
                        {RARITIES.map((r) => <option key={`create-rarity-${r}`} value={r}>{r}</option>)}
                      </select>
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Register</span>
                      <select value={String(createEntryDraft.register || "разговорная")} onChange={(e) => updateCreateEntryField("register", e.target.value)}>
                        {REGISTERS.map((r) => <option key={`create-reg-${r}`} value={r}>{r}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="admin-dict-row">
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">IPA UK</span>
                      <input value={String(createEntryDraft.ipaUk || "")} onChange={(e) => updateCreateEntryField("ipaUk", e.target.value)} />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">IPA US</span>
                      <input value={String(createEntryDraft.ipaUs || "")} onChange={(e) => updateCreateEntryField("ipaUs", e.target.value)} />
                    </label>
                  </div>
                  <div className="admin-dict-row">
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Main example EN</span>
                      <textarea rows={2} value={String(createEntryDraft.example || "")} onChange={(e) => updateCreateEntryField("example", e.target.value)} />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Main example RU</span>
                      <textarea rows={2} value={String(createEntryDraft.exampleRu || "")} onChange={(e) => updateCreateEntryField("exampleRu", e.target.value)} />
                    </label>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div className="admin-dict-section-title">Смыслы и примеры</div>
                    {createSenses.map((sense, senseIdx) => (
                      <div key={`create-sense-${senseIdx}`} style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, padding: 10, marginTop: 8, background: "var(--card)" }}>
                        <div className="admin-dict-row">
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Gloss RU *</span>
                            <input value={sense.glossRu} onChange={(e) => updateCreateSense(senseIdx, { glossRu: e.target.value })} />
                          </label>
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Level</span>
                            <select value={sense.level} onChange={(e) => updateCreateSense(senseIdx, { level: e.target.value })}>
                              {LEVELS.map((l) => <option key={`create-sense-level-${senseIdx}-${l}`} value={l}>{l}</option>)}
                            </select>
                          </label>
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Register</span>
                            <select value={sense.register} onChange={(e) => updateCreateSense(senseIdx, { register: e.target.value })}>
                              {REGISTERS.map((r) => <option key={`create-sense-reg-${senseIdx}-${r}`} value={r}>{r}</option>)}
                            </select>
                          </label>
                        </div>
                        <div className="admin-dict-row">
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Definition RU</span>
                            <textarea rows={2} value={sense.definitionRu} onChange={(e) => updateCreateSense(senseIdx, { definitionRu: e.target.value })} />
                          </label>
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Usage note</span>
                            <textarea rows={2} value={sense.usageNote} onChange={(e) => updateCreateSense(senseIdx, { usageNote: e.target.value })} />
                          </label>
                        </div>
                        <div className="admin-dict-help">Примеры для смысла</div>
                        {sense.examples.map((ex, exIdx) => (
                          <div key={`create-ex-${senseIdx}-${exIdx}`} className="admin-dict-row" style={{ marginTop: 6 }}>
                            <label className="admin-dict-field">
                              <span className="admin-dict-label">EN</span>
                              <input value={ex.en} onChange={(e) => updateCreateExample(senseIdx, exIdx, { en: e.target.value })} />
                            </label>
                            <label className="admin-dict-field">
                              <span className="admin-dict-label">RU</span>
                              <input value={ex.ru} onChange={(e) => updateCreateExample(senseIdx, exIdx, { ru: e.target.value })} />
                            </label>
                            <div className="admin-dict-actions" style={{ alignSelf: "end" }}>
                              <button type="button" className="admin-dict-btn admin-dict-btn--ghost" onClick={() => removeCreateExample(senseIdx, exIdx)} disabled={sense.examples.length <= 1}>Удалить пример</button>
                            </div>
                          </div>
                        ))}
                        <div className="admin-dict-actions" style={{ marginTop: 6 }}>
                          <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => addCreateExample(senseIdx)}>Добавить пример</button>
                          <button type="button" className="admin-dict-btn admin-dict-btn--ghost" onClick={() => removeCreateSense(senseIdx)} disabled={createSenses.length <= 1}>Удалить смысл</button>
                        </div>
                      </div>
                    ))}
                    <div className="admin-dict-actions" style={{ marginTop: 8 }}>
                      <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={addCreateSense}>Добавить смысл</button>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="admin-dict-section-title">Формы</div>
                    {createForms.map((form, formIdx) => (
                      <div key={`create-form-${formIdx}`} className="admin-dict-row" style={{ marginTop: 8 }}>
                        <label className="admin-dict-field">
                          <span className="admin-dict-label">Form</span>
                          <input value={form.form} onChange={(e) => updateCreateForm(formIdx, { form: e.target.value })} />
                        </label>
                        <label className="admin-dict-field">
                          <span className="admin-dict-label">Form type</span>
                          <input value={form.formType} onChange={(e) => updateCreateForm(formIdx, { formType: e.target.value })} />
                        </label>
                        <label className="admin-dict-field">
                          <span className="admin-dict-label">Notes</span>
                          <input value={form.notes} onChange={(e) => updateCreateForm(formIdx, { notes: e.target.value })} />
                        </label>
                        <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <input type="checkbox" checked={form.isIrregular} onChange={(e) => updateCreateForm(formIdx, { isIrregular: e.target.checked })} />
                          <span className="admin-dict-label" style={{ margin: 0 }}>Irregular</span>
                        </label>
                        <div className="admin-dict-actions" style={{ alignSelf: "end" }}>
                          <button type="button" className="admin-dict-btn admin-dict-btn--ghost" onClick={() => removeCreateForm(formIdx)} disabled={createForms.length <= 1}>Удалить форму</button>
                        </div>
                      </div>
                    ))}
                    <div className="admin-dict-actions" style={{ marginTop: 8 }}>
                      <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={addCreateForm}>Добавить форму</button>
                    </div>
                  </div>

                  <div className="admin-dict-actions" style={{ marginTop: 12 }}>
                    <button type="button" className="admin-dict-btn admin-dict-btn--primary" onClick={() => void runCreateEntry()} disabled={createState === "loading"}>
                      {createState === "loading" ? "Создание..." : "Создать слово"}
                    </button>
                    <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={resetCreateForm} disabled={createState === "loading"}>
                      Очистить форму
                    </button>
                  </div>
                  {createError && <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>{createError}</div>}
                  {createResult && <div className="dictionary-success-banner" style={{ padding: "8px 12px", marginTop: 8 }}>{createResult}</div>}
                </div>
              )}
            </div>
          )}

          {adminView === "words" && (
          <div className="admin-dict-layout admin-dict-layout--single">
            <div className="admin-dict-results" style={editingEntryId ? { display: "none" } : undefined}>
              <div className="admin-dict-results-title">
                Слова ({items.length}/{total})
              </div>
              <div className="admin-dict-help" style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={selectAllVisibleForBatch}>
                    {items.length > 0 && items.every((w) => batchSelectedIds.includes(Number(w.id))) ? "Снять выбор с видимых" : "Выбрать видимые"}
                  </button>
                  <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => setAdminView("ai_bulk")} disabled={batchSelectedIds.length === 0}>
                    Открыть AI + массовые
                  </button>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <span>Выбрано: <b>{batchSelectedIds.length}</b></span>
                </div>
              </div>
              <ul className="admin-dict-results-list" role="list">
                {items.map((w) => (
                  <li key={w.id}>
                    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <input
                        type="checkbox"
                        checked={batchSelectedIds.includes(Number(w.id))}
                        onChange={() => toggleBatchId(Number(w.id))}
                        style={{ marginTop: 10 }}
                      />
                      <button
                        type="button"
                        className={`admin-dict-result ${selectedId === w.id ? "active" : ""}`}
                        onClick={() => loadEntry(w.id)}
                      >
                        <div className="admin-dict-result-top">
                          <span className="admin-dict-result-en">{w.en}</span>
                          <span className={`word-level-badge word-level-${w.level}`}>{w.level}</span>
                        </div>
                        <div className="admin-dict-result-bottom">
                          <span className="admin-dict-result-ru">{w.ru}</span>
                          <span className="admin-dict-qc-badges" aria-hidden>
                            {!String(w.ru || "").trim() ? <span className="admin-dict-chip">no ru</span> : null}
                            {!Number.isFinite(Number(w.frequencyRank)) ? <span className="admin-dict-chip">no freq</span> : null}
                            {!w.hasExample ? <span className="admin-dict-chip">no ex</span> : null}
                            {!w.hasIpa ? <span className="admin-dict-chip">no ipa</span> : null}
                          </span>
                          <span className={`admin-dict-review-pill ${w.reviewedAt ? "ok" : "todo"}`}>
                            {w.reviewedAt ? "Проверено" : "Не проверено"}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="admin-dict-btn admin-dict-btn--secondary"
                        onClick={() => void deleteEntryFully(Number(w.id), String(w.en || w.id))}
                        title="Полностью удалить слово"
                        disabled={searchState === "loading"}
                      >
                        Удалить
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {items.length < total && (
                <button
                  type="button"
                  className="admin-dict-btn admin-dict-btn--secondary"
                  onClick={() => {
                    setOffset(items.length);
                    void loadList(false);
                  }}
                  disabled={searchState === "loading"}
                  style={{ marginTop: 10, width: "100%" }}
                >
                  Показать ещё
                </button>
              )}
            </div>

            <div className="admin-dict-editor" style={!editingEntryId ? { display: "none" } : undefined}>
              <div className="admin-dict-results-title">Редактор</div>
              {!draft ? (
                <div className="dictionary-subtitle">Загрузка слова…</div>
              ) : (
                <>
                  {saveError && (
                    <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginBottom: 8 }}>
                      {saveError}
                    </div>
                  )}

                  <div className="admin-dict-section" style={{ marginBottom: 12 }}>
                    <div className="admin-dict-section-title">Пошаговый мастер (soft-gate)</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <button type="button" className={`admin-dict-btn ${wizardStep === 1 ? "admin-dict-btn--primary" : "admin-dict-btn--secondary"}`} onClick={() => setWizardStep(1)}>
                        1. Карточка {wizardChecklist?.block1?.ready ? "✅" : "⚠️"}
                      </button>
                      <button type="button" className={`admin-dict-btn ${wizardStep === 2 ? "admin-dict-btn--primary" : "admin-dict-btn--secondary"}`} onClick={() => setWizardStep(2)}>
                        2. Смыслы {wizardChecklist?.block2?.ready ? "✅" : "⚠️"}
                      </button>
                      <button type="button" className={`admin-dict-btn ${wizardStep === 3 ? "admin-dict-btn--primary" : "admin-dict-btn--secondary"}`} onClick={() => setWizardStep(3)}>
                        3. Формы {wizardChecklist?.block3?.ready ? "✅" : "⚠️"}
                      </button>
                    </div>
                    {Array.isArray(wizardChecklist?.warnings) && wizardChecklist!.warnings.length > 0 && (
                      <div className="admin-dict-help">
                        {wizardChecklist!.warnings.join(" • ")}
                      </div>
                    )}
                  </div>

                  <div className="admin-dict-section" style={wizardStep === 1 ? undefined : { display: "none" }}>
                    <div className="admin-dict-section-title" id="admin-card">Карточка слова (то, что видит пользователь)</div>
                    {draft && editedDraft && (
                    <div className="admin-dict-card-grid">
                      <div className="admin-dict-modal-pane">
                        <div className="admin-dict-results-title">Сейчас в БД (read-only)</div>
                        {WORD_EDIT_FIELDS.map((field) => (
                          <label key={`left-${field}`} className="admin-dict-field admin-dict-field--mirror">
                            <div className="admin-dict-field-head admin-dict-field-head--readonly">
                              <span className="admin-dict-label">{fieldLabel[field]}</span>
                              <span className="admin-dict-field-head-spacer" aria-hidden />
                            </div>
                            {field === "example" || field === "exampleRu" ? (
                              <textarea value={String(draft[field] ?? "")} rows={2} readOnly />
                            ) : (
                              <input value={field === "frequencyRank" ? String(draft.frequencyRank ?? "") : String(draft[field] ?? "")} readOnly />
                            )}
                          </label>
                        ))}
                        <label className="admin-dict-field admin-dict-field--mirror">
                          <div className="admin-dict-field-head admin-dict-field-head--readonly">
                            <span className="admin-dict-label">POS (lemma)</span>
                            <span className="admin-dict-field-head-spacer" aria-hidden />
                          </div>
                          <input value={String((v2 as any)?.lemma?.pos || "—")} readOnly />
                        </label>
                      </div>
                      <div className="admin-dict-modal-pane">
                        <div className="admin-dict-results-title">Редактируемые поля</div>
                        {WORD_EDIT_FIELDS.map((field) => {
                          const changed = isFieldChanged(field);
                          const empty = IMPORTANT_EMPTY_FIELDS.includes(field) && isFieldEmpty(field);
                          return (
                            <label key={`right-${field}`} className={`admin-dict-field admin-dict-field--mirror ${changed ? "admin-dict-field--changed" : ""} ${empty ? "admin-dict-field--empty" : ""}`}>
                              <div className="admin-dict-field-head">
                                <span className="admin-dict-label">{fieldLabel[field]}</span>
                                <button type="button" className="admin-dict-btn admin-dict-btn--ghost" onClick={() => restoreEditedField(field)} disabled={!changed} title="Вернуть значение из БД">
                                  Отменить
                                </button>
                              </div>
                              {field === "level" ? (
                                <select value={String(editedDraft.level ?? "A0")} onChange={(e) => updateEditedField("level", e.target.value as Word["level"])}>
                                  {LEVELS.map((l) => (
                                    <option key={l} value={l}>{l}</option>
                                  ))}
                                </select>
                              ) : field === "accent" ? (
                                <select value={String(editedDraft.accent ?? "both")} onChange={(e) => updateEditedField("accent", e.target.value as Word["accent"])}>
                                  {ACCENTS.map((a) => (
                                    <option key={a} value={a}>{a}</option>
                                  ))}
                                </select>
                              ) : field === "rarity" ? (
                                <select value={String(editedDraft.rarity ?? "не редкое")} onChange={(e) => updateEditedField("rarity", e.target.value as Word["rarity"])}>
                                  {RARITIES.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                  ))}
                                </select>
                              ) : field === "register" ? (
                                <select value={String(editedDraft.register ?? "разговорная")} onChange={(e) => updateEditedField("register", e.target.value as Word["register"])}>
                                  {REGISTERS.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                  ))}
                                </select>
                              ) : field === "example" || field === "exampleRu" ? (
                                <textarea value={String(editedDraft[field] ?? "")} rows={2} onChange={(e) => updateEditedField(field, e.target.value)} />
                              ) : field === "frequencyRank" ? (
                                <input
                                  value={String(editedDraft.frequencyRank ?? "")}
                                  onChange={(e) => updateEditedField("frequencyRank", toNumber(e.target.value, 15000))}
                                />
                              ) : (
                                <input value={String(editedDraft[field] ?? "")} onChange={(e) => updateEditedField(field, e.target.value)} />
                              )}
                            </label>
                          );
                        })}
                        <label className="admin-dict-field admin-dict-field--mirror">
                          <div className="admin-dict-field-head">
                            <span className="admin-dict-label">POS (lemma)</span>
                          </div>
                          <input value={String((v2 as any)?.lemma?.pos || "—")} readOnly />
                        </label>
                        <div className="admin-dict-help">
                          Изменено: <b>{changedFields.length}</b>
                          {emptyImportantFields.length > 0 && (
                            <> • Пустые: <b>{emptyImportantFields.map((f) => fieldLabel[f]).join(", ")}</b></>
                          )}
                        </div>
                        <div className="admin-dict-card-helpers">
                          <button
                            type="button"
                            className="admin-dict-btn admin-dict-btn--secondary"
                            onClick={() => void askAi()}
                            disabled={aiState === "loading"}
                            title="Заполнит поля карточки (блок 1) по подсказке AI (нужен OPENAI_API_KEY на сервере)."
                          >
                            {aiState === "loading" ? "AI…" : "AI‑подсказка"}
                          </button>
                          <button
                            type="button"
                            className="admin-dict-btn admin-dict-btn--secondary"
                            onClick={() => void fillIpa()}
                            disabled={ipaFillState === "loading"}
                            title="Сгенерировать IPA UK/US по полю EN."
                          >
                            {ipaFillState === "loading" ? "IPA…" : "Заполнить IPA"}
                          </button>
                          <button
                            type="button"
                            className="admin-dict-btn admin-dict-btn--primary"
                            onClick={save}
                            disabled={saveState === "loading" || changedFields.length === 0}
                            title="Сохранить изменения блока 1"
                          >
                            {saveState === "loading" ? "Сохранение…" : "Сохранить блок 1"}
                          </button>
                        </div>
                        {(aiStatusText || ipaStatusText) && (
                          <div className="admin-dict-help">
                            {aiStatusText && <div><strong>Статус AI:</strong> {aiStatusText}</div>}
                            {ipaStatusText && <div><strong>Статус IPA:</strong> {ipaStatusText}</div>}
                          </div>
                        )}
                        {(aiSuggestedFieldsSafe.length > 0 || aiAppliedSensesCount != null) && (
                          <div className="admin-dict-help admin-dict-ai-changed">
                            {aiSuggestedFieldsSafe.length > 0 && (
                              <div><strong>Карточка (поля изменены):</strong> {aiSuggestedFieldsSafe.map((f) => fieldLabel[f]).join(", ")}</div>
                            )}
                            {aiAppliedSensesCount != null && aiAppliedSensesCount > 0 && (
                              <div><strong>Смыслы и примеры:</strong> применено в БД — {aiAppliedSensesCount} смысл(ов) с примерами</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    )}
                    <div className="admin-dict-actions" style={{ marginTop: 10 }}>
                      <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => setWizardStep(2)}>
                        Далее: блок 2
                      </button>
                    </div>
                  </div>

                  {(v2Error || v2) && (
                    <div className="admin-dict-section" style={wizardStep === 1 ? { display: "none" } : { marginTop: 14 }}>
                      {wizardStep === 2 && (
                        <>
                          <div className="admin-dict-section-title">Значения слова (смыслы)</div>
                          <HelpText>
                            <b>Значение #1</b> связано с карточкой пользователя (игры/прогресс). Поэтому его <b>глосс/уровень/регистр</b>{" "}
                            редактируются в блоке «Карточка слова». В v2 для #1 можно дополнять только определение и пометы.
                          </HelpText>
                          {v2Error && <div className="dictionary-error-banner" style={{ padding: "8px 12px" }}>{v2Error}</div>}
                          <div className="admin-dict-actions" style={{ marginBottom: 10 }}>
                            <button
                              type="button"
                              className="admin-dict-btn admin-dict-btn--secondary"
                              onClick={() => void askAiBlock2()}
                              disabled={block2AiState === "loading"}
                            >
                              {block2AiState === "loading" ? "AI…" : "AI для блока 2"}
                            </button>
                            {block2AiStatus ? <span className="admin-dict-muted">{block2AiStatus}</span> : null}
                          </div>
                        </>
                      )}
                      {wizardStep === 2 && v2?.senses && Array.isArray(v2.senses) && (
                        <div className="admin-dict-senses" id="admin-senses">
                          {v2.senses.map((s) => (
                            <div key={s.id} className="admin-dict-sense-card">
                              <div className="admin-dict-sense-head">
                                <div className="admin-dict-sense-title">
                                  <span className="admin-dict-sense-no">{s.senseNo}.</span>
                                  <span>{s.glossRu || "—"}</span>
                                </div>
                                <div className="admin-dict-sense-meta">
                                  <span className={`word-level-badge word-level-${s.level}`}>{s.level}</span>
                                  <span className="admin-dict-chip">{s.register}</span>
                                  <span className={`admin-dict-review-pill ${s.reviewedAt ? "ok" : "todo"}`}>
                                    {s.reviewedAt ? "Проверено" : "Не проверено"}
                                  </span>
                                </div>
                              </div>
                              {s.reviewedAt && (
                                <div className="admin-dict-muted">
                                  {new Date(s.reviewedAt).toLocaleString()} • {s.reviewedBy || "—"}
                                </div>
                              )}
                              {editingSenseId === s.id && senseEdit ? (
                                <div className="admin-dict-form admin-dict-form--compact">
                                  <div className="admin-dict-row">
                                    <label className="admin-dict-field">
                                    <span className="admin-dict-label">Короткий перевод (глосс)</span>
                                    <HelpText>Коротко «как подписать смысл» на русском. 1 вариант.</HelpText>
                                      <input
                                        value={senseEdit.glossRu}
                                        disabled={s.senseNo === 1}
                                        onChange={(e) => setSenseEdit({ ...senseEdit, glossRu: e.target.value })}
                                      />
                                    </label>
                                    <label className="admin-dict-field">
                                      <span className="admin-dict-label">Level</span>
                                      <select
                                        value={senseEdit.level}
                                        disabled={s.senseNo === 1}
                                        onChange={(e) => setSenseEdit({ ...senseEdit, level: e.target.value })}
                                      >
                                        {LEVELS.map((l) => (
                                          <option key={l} value={l}>
                                            {l}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                  <label className="admin-dict-field">
                                    <span className="admin-dict-label">Register</span>
                                    <select
                                      value={senseEdit.register}
                                      disabled={s.senseNo === 1}
                                      onChange={(e) => setSenseEdit({ ...senseEdit, register: e.target.value })}
                                    >
                                      {REGISTERS.map((r) => (
                                        <option key={r} value={r}>
                                          {r}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="admin-dict-field">
                                    <span className="admin-dict-label">Определение (RU)</span>
                                    <HelpText>Можно в стиле словаря: что значит, когда употребляется.</HelpText>
                                    <textarea
                                      value={senseEdit.definitionRu}
                                      onChange={(e) => setSenseEdit({ ...senseEdit, definitionRu: e.target.value })}
                                      rows={3}
                                    />
                                  </label>
                                  <label className="admin-dict-field">
                                    <span className="admin-dict-label">Пометы/употребление</span>
                                    <HelpText>Например: «разг.», «амер.», «в бизнес‑контексте», «неформально».</HelpText>
                                    <textarea
                                      value={senseEdit.usageNote}
                                      onChange={(e) => setSenseEdit({ ...senseEdit, usageNote: e.target.value })}
                                      rows={2}
                                    />
                                  </label>
                                  <div className="admin-dict-actions">
                                    <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => saveSense(s.id)}>
                                      Сохранить значение
                                    </button>
                                    <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => { setEditingSenseId(null); setSenseEdit(null); }}>
                                      Отмена
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {s.definitionRu ? <div className="admin-dict-sense-text">{s.definitionRu}</div> : null}
                                  {s.usageNote ? <div className="admin-dict-sense-note">{s.usageNote}</div> : null}
                                  <div className="admin-dict-actions" style={{ marginTop: 10 }}>
                                    <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => startEditSense(s)}>
                                      Редактировать
                                    </button>
                                    {s.senseNo > 1 && (
                                      <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => deleteSense(s.id)}>
                                        Удалить
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}

                              <div style={{ marginTop: 10 }}>
                                <div className="admin-dict-section-title" style={{ marginBottom: 6 }}>Примеры для этого смысла</div>
                                <HelpText>Можно несколько примеров. Главный пример используется для синхронизации в карточку (если это sense #1).</HelpText>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  {(s.examples || []).map((ex, exIdx) => (
                                    <div key={ex.id} style={{ border: "1px solid var(--border-subtle)", padding: 10, background: "var(--card)" }}>
                                      {editingExampleId === ex.id && exampleEdit ? (
                                        <div className="admin-dict-form admin-dict-form--compact" style={{ marginTop: 0 }}>
                                          <label className="admin-dict-field">
                                            <span className="admin-dict-label">EN</span>
                                            <input value={exampleEdit.en} onChange={(e) => setExampleEdit({ ...exampleEdit, en: e.target.value })} />
                                          </label>
                                          <label className="admin-dict-field">
                                            <span className="admin-dict-label">RU</span>
                                            <input value={exampleEdit.ru} onChange={(e) => setExampleEdit({ ...exampleEdit, ru: e.target.value })} />
                                          </label>
                                          <div className="admin-dict-actions" style={{ marginTop: 6 }}>
                                            <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => saveExample(ex.id)}>
                                              Сохранить
                                            </button>
                                            <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => { setEditingExampleId(null); setExampleEdit(null); }}>
                                              Отмена
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className="admin-dict-muted">Пример #{exIdx + 1}</div>
                                            <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.en}</div>
                                            <div style={{ color: "var(--text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.ru || "—"}</div>
                                          </div>
                                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                                            {ex.isMain ? (
                                              <span className="admin-dict-review-pill ok">Main</span>
                                            ) : (
                                              <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => setMainExample(ex.id)}>
                                                Сделать главным
                                              </button>
                                            )}
                                            <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => startEditExample(ex)}>
                                              Редактировать
                                            </button>
                                            <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => deleteExample(ex.id)}>
                                              Удалить
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <div className="admin-dict-actions" style={{ marginTop: 8 }}>
                                  <button
                                    type="button"
                                    className="admin-dict-btn admin-dict-btn--secondary"
                                    onClick={() => setAddExampleSenseId((prev) => (prev === s.id ? null : s.id))}
                                  >
                                    {addExampleSenseId === s.id ? "Отмена" : "Добавить пример"}
                                  </button>
                                </div>
                                {addExampleSenseId === s.id && (
                                  <div className="admin-dict-form admin-dict-form--compact" style={{ marginTop: 8 }}>
                                    <label className="admin-dict-field">
                                      <span className="admin-dict-label">Пример (EN)</span>
                                      <HelpText>Одно предложение. Лучше без редких слов и без слишком сложной грамматики.</HelpText>
                                      <input
                                        value={(newExampleBySense[s.id]?.en ?? "")}
                                        onChange={(e) =>
                                          setNewExampleBySense((prev) => ({
                                            ...prev,
                                            [s.id]: { ...(prev[s.id] || { en: "", ru: "", isMain: true }), en: e.target.value },
                                          }))
                                        }
                                      />
                                    </label>
                                    <label className="admin-dict-field">
                                      <span className="admin-dict-label">Перевод (RU)</span>
                                      <input
                                        value={(newExampleBySense[s.id]?.ru ?? "")}
                                        onChange={(e) =>
                                          setNewExampleBySense((prev) => ({
                                            ...prev,
                                            [s.id]: { ...(prev[s.id] || { en: "", ru: "", isMain: true }), ru: e.target.value },
                                          }))
                                        }
                                      />
                                    </label>
                                    <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                      <input
                                        type="checkbox"
                                        checked={newExampleBySense[s.id]?.isMain ?? true}
                                        onChange={(e) =>
                                          setNewExampleBySense((prev) => ({
                                            ...prev,
                                            [s.id]: { ...(prev[s.id] || { en: "", ru: "", isMain: true }), isMain: e.target.checked },
                                          }))
                                        }
                                      />
                                      <span className="admin-dict-label" style={{ margin: 0 }}>Сделать главным примером</span>
                                    </label>
                                    <button type="button" className="admin-dict-btn admin-dict-btn--primary" onClick={() => addExample(s.id)}>
                                      Сохранить пример
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {wizardStep === 3 && v2?.lemma?.id && (
                        <div style={{ marginTop: 14 }} id="admin-forms">
                          <div className="admin-dict-section-title">Формы слова (полноценные карточки)</div>
                          <HelpText>
                            В этом блоке формы редактируются как отдельные карточки с полями уровня/IPA/примеров.
                          </HelpText>
                          {formCardsError && <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginBottom: 8 }}>{formCardsError}</div>}
                          {formCardsStatus && <div className="dictionary-success-banner" style={{ padding: "8px 12px", marginBottom: 8 }}>{formCardsStatus}</div>}
                          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="admin-dict-btn admin-dict-btn--secondary"
                              onClick={() => void askAiFormsDraft()}
                              disabled={formsDraftState === "loading"}
                              title="Сгенерировать формы слова в черновик (блок 3)."
                            >
                              {formsDraftState === "loading" ? "Формы…" : "AI: заполнить формы"}
                            </button>
                            <button
                              type="button"
                              className="admin-dict-btn admin-dict-btn--secondary"
                              onClick={() => void applyFormsDraft()}
                              disabled={formsDraftState === "loading" || !Array.isArray(formsDraft?.formCardsDraft) || formsDraft.formCardsDraft.length === 0}
                              title="Применить формы из AI-черновика в блок 3."
                            >
                              Применить формы
                            </button>
                            <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={addFormCard}>
                              + Карточка формы
                            </button>
                            <button type="button" className="admin-dict-btn admin-dict-btn--primary" onClick={() => void saveFormCards()} disabled={formCardsState === "loading"}>
                              {formCardsState === "loading" ? "Сохранение…" : "Сохранить блок 3"}
                            </button>
                          </div>
                          <div className="admin-dict-help">
                            <b>Flow:</b> 1) AI: заполнить формы → 2) Применить формы → 3) Сохранить блок 3
                          </div>
                          {(formsDraftError || formsDraft || formsDraftStatusText) && (
                            <div className="admin-dict-help admin-dict-ai-changed" style={{ marginTop: 8 }}>
                              {formsDraftStatusText && <div><strong>Статус форм:</strong> {formsDraftStatusText}</div>}
                              {formsDraftError && <div><strong>Ошибка форм:</strong> {formsDraftError}</div>}
                              {formsDraft && (
                                <>
                                  <div style={{ marginTop: 8, fontWeight: 700 }}>
                                    Черновик форм: {Array.isArray(formsDraft.formCardsDraft) ? formsDraft.formCardsDraft.length : 0}
                                  </div>
                                  {Array.isArray(formsDraft.warnings) && formsDraft.warnings.length > 0 && (
                                    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                                      {formsDraft.warnings.map((w, idx) => <li key={`fd-w-${idx}`}>{w}</li>)}
                                    </ul>
                                  )}
                                  {Array.isArray(formsDraft.formCardsDraft) && formsDraft.formCardsDraft.length > 0 && (
                                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                                      {formsDraft.formCardsDraft.map((f, idx) => (
                                        <div key={`fd-f-${idx}`} style={{ border: "1px solid var(--border-subtle)", padding: 8, background: "var(--card)" }}>
                                          <b>{String((f as any).en || "")}</b> • {String((f as any).level || "A0")} • {String((f as any).register || "разговорная")}
                                          {String((f as any).example || "").trim() ? <div className="admin-dict-muted">{String((f as any).example || "")}</div> : null}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <button
                                      type="button"
                                      className="admin-dict-btn admin-dict-btn--secondary"
                                      onClick={() => void applyFormsDraft()}
                                      disabled={formsDraftState === "loading" || !Array.isArray(formsDraft.formCardsDraft) || formsDraft.formCardsDraft.length === 0}
                                    >
                                      Применить формы из черновика
                                    </button>
                                    <button
                                      type="button"
                                      className="admin-dict-btn admin-dict-btn--secondary"
                                      onClick={() => downloadText(`forms_draft_${draft?.id || selectedId || "word"}.json`, formsDraftJson || "{}")}
                                      disabled={!formsDraftJson}
                                    >
                                      Экспорт forms-draft JSON
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                          <div style={{ display: "grid", gap: 8 }}>
                            {formCards.map((card, idx) => (
                              <div key={`fc-${idx}-${card.id || "new"}`} style={{ border: "1px solid var(--border-subtle)", padding: 10, background: "var(--card)" }}>
                                <div className="admin-dict-row">
                                  <label className="admin-dict-field"><span className="admin-dict-label">EN форма</span><input value={String(card.en || "")} onChange={(e) => patchFormCard(idx, { en: e.target.value })} /></label>
                                  <label className="admin-dict-field"><span className="admin-dict-label">RU</span><input value={String(card.ru || "")} onChange={(e) => patchFormCard(idx, { ru: e.target.value })} /></label>
                                </div>
                                <div className="admin-dict-row">
                                  <label className="admin-dict-field"><span className="admin-dict-label">Level</span><select value={String(card.level || "A0")} onChange={(e) => patchFormCard(idx, { level: e.target.value })}>{LEVELS.map((l) => <option key={`fc-l-${idx}-${l}`} value={l}>{l}</option>)}</select></label>
                                  <label className="admin-dict-field"><span className="admin-dict-label">Accent</span><select value={String(card.accent || "both")} onChange={(e) => patchFormCard(idx, { accent: e.target.value })}>{ACCENTS.map((a) => <option key={`fc-a-${idx}-${a}`} value={a}>{a}</option>)}</select></label>
                                </div>
                                <div className="admin-dict-row">
                                  <label className="admin-dict-field"><span className="admin-dict-label">Частотность (rank)</span><input value={String(card.frequencyRank ?? 15000)} onChange={(e) => patchFormCard(idx, { frequencyRank: toNumber(e.target.value, 15000) })} /></label>
                                  <label className="admin-dict-field"><span className="admin-dict-label">Rarity</span><select value={String(card.rarity || "редкое")} onChange={(e) => patchFormCard(idx, { rarity: e.target.value })}>{RARITIES.map((r) => <option key={`fc-r-${idx}-${r}`} value={r}>{r}</option>)}</select></label>
                                </div>
                                <div className="admin-dict-row">
                                  <label className="admin-dict-field"><span className="admin-dict-label">Register</span><select value={String(card.register || "разговорная")} onChange={(e) => patchFormCard(idx, { register: e.target.value })}>{REGISTERS.map((r) => <option key={`fc-reg-${idx}-${r}`} value={r}>{r}</option>)}</select></label>
                                  <label className="admin-dict-field"><span className="admin-dict-label">POS</span><input value={String(card.pos || "")} onChange={(e) => patchFormCard(idx, { pos: e.target.value })} /></label>
                                </div>
                                <div className="admin-dict-row">
                                  <label className="admin-dict-field"><span className="admin-dict-label">IPA UK</span><input value={String(card.ipaUk || "")} onChange={(e) => patchFormCard(idx, { ipaUk: e.target.value })} /></label>
                                  <label className="admin-dict-field"><span className="admin-dict-label">IPA US</span><input value={String(card.ipaUs || "")} onChange={(e) => patchFormCard(idx, { ipaUs: e.target.value })} /></label>
                                </div>
                                <label className="admin-dict-field"><span className="admin-dict-label">Example</span><textarea rows={2} value={String(card.example || "")} onChange={(e) => patchFormCard(idx, { example: e.target.value })} /></label>
                                <label className="admin-dict-field"><span className="admin-dict-label">Example RU</span><textarea rows={2} value={String(card.exampleRu || "")} onChange={(e) => patchFormCard(idx, { exampleRu: e.target.value })} /></label>
                                <div className="admin-dict-actions" style={{ marginTop: 6 }}>
                                  <button
                                    type="button"
                                    className="admin-dict-btn admin-dict-btn--secondary"
                                    onClick={() => void deleteFormCard(idx)}
                                    disabled={formCardsState === "loading"}
                                  >
                                    Удалить карточку формы
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="admin-dict-actions" style={{ marginTop: 10 }}>
                            <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => setWizardStep(2)}>
                              Назад
                            </button>
                          </div>
                        </div>
                      )}
                      {wizardStep === 2 && (
                      <div style={{ marginTop: 12 }}>
                        <div className="admin-dict-section-title">Добавить новое значение (sense #2+)</div>
                        <HelpText>Добавляй, если у слова есть отдельный смысл. Для каждого смысла — свои примеры и пометы.</HelpText>
                        <div className="admin-dict-actions" style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            className="admin-dict-btn admin-dict-btn--secondary"
                            onClick={() => setAddSenseOpen((v) => !v)}
                          >
                            {addSenseOpen ? "Скрыть форму нового значения" : "Добавить новое значение"}
                          </button>
                        </div>
                        {addSenseOpen && (
                        <div className="admin-dict-form admin-dict-form--compact">
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Короткий перевод (RU)</span>
                            <HelpText>Например: «управлять (делом)», «запускать (программу)».</HelpText>
                            <input value={senseDraft.glossRu} onChange={(e) => setSenseDraft({ ...senseDraft, glossRu: e.target.value })} placeholder="кратко: что значит этот смысл" />
                          </label>
                          <div className="admin-dict-row">
                            <label className="admin-dict-field">
                              <span className="admin-dict-label">Level</span>
                              <select value={senseDraft.level} onChange={(e) => setSenseDraft({ ...senseDraft, level: e.target.value })}>
                                {LEVELS.map((l) => (
                                  <option key={l} value={l}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="admin-dict-field">
                              <span className="admin-dict-label">Register</span>
                              <select
                                value={senseDraft.register}
                                onChange={(e) => setSenseDraft({ ...senseDraft, register: e.target.value })}
                              >
                                {REGISTERS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Definition (RU)</span>
                            <textarea value={senseDraft.definitionRu} onChange={(e) => setSenseDraft({ ...senseDraft, definitionRu: e.target.value })} rows={3} />
                          </label>
                          <label className="admin-dict-field">
                            <span className="admin-dict-label">Usage note</span>
                            <textarea value={senseDraft.usageNote} onChange={(e) => setSenseDraft({ ...senseDraft, usageNote: e.target.value })} rows={2} />
                          </label>
                          <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={addSense}>
                            Добавить значение
                          </button>
                        </div>
                        )}
                        <div className="admin-dict-actions" style={{ marginTop: 10 }}>
                          <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => draft?.id && void refreshWizardState(draft.id)}>
                            Сохранить блок 2
                          </button>
                          <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => setWizardStep(3)}>
                            Далее: блок 3
                          </button>
                          <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => setWizardStep(1)}>
                            Назад
                          </button>
                        </div>
                      </div>
                      )}
                    </div>
                  )}

                  <div className="admin-dict-footer-actions">
                    <button
                      type="button"
                      className="admin-dict-btn admin-dict-btn--primary"
                      onClick={save}
                      disabled={saveState === "loading" || changedFields.length === 0}
                      title="Сохранить изменения карточки в БД"
                    >
                      {saveState === "loading" ? "Сохранение…" : "Сохранить карточку"}
                    </button>
                    <button
                      type="button"
                      className="admin-dict-btn admin-dict-btn--secondary"
                      onClick={() => { setEditedDraft(draft); setAiSuggestedFields(null); setAiAppliedSensesCount(null); }}
                      title="Отменить правки карточки"
                    >
                      Сбросить карточку
                    </button>
                    <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => toggleReviewed(true)} title="Отметить запись как проверенную лингвистом">
                      ✅ Проверено
                    </button>
                    <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => toggleReviewed(false)} title="Снять отметку проверки">
                      Снять проверку
                    </button>
                    <button type="button" className="admin-dict-btn admin-dict-btn--secondary" onClick={() => navigate("/admin/dictionary")}>
                      ← К списку слов
                    </button>
                  </div>

                  {aiError && (
                    <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
                      {aiError}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          )}

        </div>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default AdminDictionaryPage;

