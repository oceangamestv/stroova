import React, { useEffect, useMemo, useState } from "react";
import Header from "../components/common/Header";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAuth } from "../features/auth/AuthContext";
import type { Word } from "../data/contracts/types";
import { adminDictionaryApi } from "../api/endpoints";
import type { AdminDictionaryAiDraft, AdminDictionaryEntryV2Response, AdminDictionaryListItem } from "../api/types";
import { ApiError } from "../api/client";

type LoadState = "idle" | "loading" | "error";

type ReviewedFilter = "all" | "yes" | "no";

const LEVELS: Word["level"][] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
const ACCENTS: Word["accent"][] = ["both", "UK", "US"];
const RARITIES: NonNullable<Word["rarity"]>[] = ["не редкое", "редкое", "очень редкое"];
const REGISTERS: NonNullable<Word["register"]>[] = ["разговорная", "официальная"];

function toNumber(value: unknown, fallback: number) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
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

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out.map((v) => v.trim());
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
  const [saveState, setSaveState] = useState<LoadState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [v2, setV2] = useState<AdminDictionaryEntryV2Response | null>(null);
  const [v2Error, setV2Error] = useState<string | null>(null);
  const [editingSenseId, setEditingSenseId] = useState<number | null>(null);
  const [senseEdit, setSenseEdit] = useState<{ glossRu: string; level: string; register: string; definitionRu: string; usageNote: string } | null>(null);
  const [newExampleBySense, setNewExampleBySense] = useState<Record<number, { en: string; ru: string; isMain: boolean }>>({});
  const [newForm, setNewForm] = useState<{ form: string; formType: string; isIrregular: boolean; notes: string }>({
    form: "",
    formType: "",
    isIrregular: false,
    notes: "",
  });
  const [editingExampleId, setEditingExampleId] = useState<number | null>(null);
  const [exampleEdit, setExampleEdit] = useState<{ en: string; ru: string; isMain: boolean; sortOrder: number } | null>(null);
  const [editingFormId, setEditingFormId] = useState<number | null>(null);
  const [formEdit, setFormEdit] = useState<{ form: string; formType: string; isIrregular: boolean; notes: string } | null>(null);
  const [senseDraft, setSenseDraft] = useState<{ glossRu: string; level: string; register: string; definitionRu: string; usageNote: string }>({
    glossRu: "",
    level: "A1",
    register: "разговорная",
    definitionRu: "",
    usageNote: "",
  });

  const [aiState, setAiState] = useState<LoadState>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiJson, setAiJson] = useState<string>("");

  const [aiDraftState, setAiDraftState] = useState<LoadState>("idle");
  const [aiDraftError, setAiDraftError] = useState<string | null>(null);
  const [aiDraftJson, setAiDraftJson] = useState<string>("");
  const [aiDraft, setAiDraft] = useState<AdminDictionaryAiDraft | null>(null);
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
  const [applyDraftEntryPatch, setApplyDraftEntryPatch] = useState(true);
  const [applyDraftLemmaPatch, setApplyDraftLemmaPatch] = useState(true);
  const [applyDraftSenseNos, setApplyDraftSenseNos] = useState<number[]>([]);
  const [applyDraftFormIndexes, setApplyDraftFormIndexes] = useState<number[]>([]);
  const [applyDraftReplaceExamples, setApplyDraftReplaceExamples] = useState(false);
  const [applyDraftSense1Core, setApplyDraftSense1Core] = useState(false);

  const [importText, setImportText] = useState("");
  const [importState, setImportState] = useState<LoadState>("idle");
  const [importLog, setImportLog] = useState<string>("");

  const canAccess = !!user?.isAdmin && !isMobile;

  const loadList = async (reset = true) => {
    setSearchState("loading");
    setSearchError(null);
    if (reset) {
      setOffset(0);
      setItems([]);
      setSelectedId(null);
      setDraft(null);
      setV2(null);
      setV2Error(null);
    }
    setAiJson("");
    setAiError(null);
    setAiDraftJson("");
    setAiDraftError(null);
    setAiDraft(null);
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

  useEffect(() => {
    if (!canAccess) return;
    void loadList(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  const loadEntry = async (id: number) => {
    setSelectedId(id);
    setDraft(null);
    setSaveError(null);
    setV2(null);
    setV2Error(null);
    setEditingSenseId(null);
    setSenseEdit(null);
    setEditingExampleId(null);
    setExampleEdit(null);
    setEditingFormId(null);
    setFormEdit(null);
    setAiJson("");
    setAiError(null);
    setAiDraftJson("");
    setAiDraftError(null);
    setAiDraft(null);
    try {
      const { entry } = await adminDictionaryApi.getEntry({ lang, id });
      setDraft(entry);
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id });
      setV2(v2Data);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Не удалось загрузить запись");
    }
  };

  const save = async () => {
    if (!draft?.id) return;
    setSaveState("loading");
    setSaveError(null);
    try {
      const patch: Partial<Word> = {
        en: String(draft.en ?? "").trim(),
        ru: String(draft.ru ?? "").trim(),
        level: (draft.level as Word["level"]) ?? "A0",
        accent: (draft.accent as Word["accent"]) ?? "both",
        frequencyRank: toNumber(draft.frequencyRank, 15000),
        rarity: draft.rarity,
        register: draft.register,
        ipaUk: String(draft.ipaUk ?? ""),
        ipaUs: String(draft.ipaUs ?? ""),
        example: String(draft.example ?? ""),
        exampleRu: String(draft.exampleRu ?? ""),
      };
      const { entry } = await adminDictionaryApi.patchEntry({ lang, id: draft.id, patch });
      // Обновим в списке
      setItems((prev) => prev.map((w) => (w.id === entry.id ? { ...w, ...entry } : w)));
      setDraft(entry);
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
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось добавить пример"));
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

  const addForm = async () => {
    if (!v2?.lemma?.id) return;
    if (!newForm.form.trim()) return;
    try {
      await adminDictionaryApi.addForm({
        lang,
        lemmaId: v2.lemma.id,
        form: {
          form: newForm.form,
          formType: newForm.formType,
          isIrregular: newForm.isIrregular,
          notes: newForm.notes,
        },
      });
      if (draft?.id) {
        const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
        setV2(v2Data);
      }
      setNewForm({ form: "", formType: "", isIrregular: false, notes: "" });
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось добавить форму"));
    }
  };

  const deleteForm = async (formId: number) => {
    if (!draft?.id) return;
    if (!confirm("Удалить форму?")) return;
    try {
      await adminDictionaryApi.deleteForm({ lang, id: formId });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
      setV2(v2Data);
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось удалить форму"));
    }
  };

  const startEditForm = (f: { id: number; form: string; formType: string; isIrregular: boolean; notes: string }) => {
    setEditingFormId(f.id);
    setFormEdit({
      form: f.form || "",
      formType: f.formType || "",
      isIrregular: !!f.isIrregular,
      notes: f.notes || "",
    });
  };

  const saveForm = async (formId: number) => {
    if (!formEdit || !draft?.id) return;
    try {
      await adminDictionaryApi.patchForm({ lang, id: formId, patch: formEdit });
      const v2Data = await adminDictionaryApi.getEntryV2({ lang, id: draft.id });
      setV2(v2Data);
      setEditingFormId(null);
      setFormEdit(null);
    } catch (e) {
      setV2Error(formatApiError(e, "Не удалось сохранить форму"));
    }
  };

  const exportCsv = async () => {
    setSearchError(null);
    try {
      const all: AdminDictionaryListItem[] = [];
      let off = 0;
      let totalLocal = 0;
      while (true) {
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
          offset: off,
          limit: 500,
          order,
        });
        totalLocal = total;
        all.push(...items);
        off += items.length;
        if (items.length === 0 || all.length >= total) break;
        if (off > 100000) break;
      }
      const header = [
        "id",
        "en",
        "ru",
        "level",
        "register",
        "rarity",
        "frequencyRank",
        "reviewedAt",
        "reviewedBy",
        "hasExample",
        "hasIpa",
      ];
      const lines = [header.join(",")];
      for (const w of all) {
        const row = [
          w.id,
          w.en,
          w.ru,
          w.level,
          w.register,
          w.rarity,
          w.frequencyRank ?? "",
          w.reviewedAt ?? "",
          w.reviewedBy ?? "",
          w.hasExample ? "1" : "0",
          w.hasIpa ? "1" : "0",
        ].map(csvEscape);
        lines.push(row.join(","));
      }
      const filename = `dictionary_export_${lang}_${new Date().toISOString().slice(0, 10)}_${all.length}-of-${totalLocal}.csv`;
      downloadText(filename, lines.join("\n"), "text/csv;charset=utf-8");
    } catch (e) {
      setSearchError(formatApiError(e, "Не удалось экспортировать CSV"));
    }
  };

  const importCsv = async () => {
    const text = importText.trim();
    if (!text) return;
    setImportState("loading");
    setImportLog("");
    try {
      const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
      if (rawLines.length < 2) throw new Error("CSV должен содержать заголовок и хотя бы одну строку");
      const header = parseCsvLine(rawLines[0]).map((h) => h.replace(/^\uFEFF/, "").trim());
      const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
      const idIdx = idx("id");
      if (idIdx < 0) throw new Error("В CSV нет колонки id");

      const enIdx = idx("en");
      const ruIdx = idx("ru");
      const levelIdx = idx("level");
      const registerIdx = idx("register");
      const rarityIdx = idx("rarity");
      const reviewedIdx = idx("reviewed"); // optional: yes/no/1/0

      let ok = 0;
      let fail = 0;
      for (let i = 1; i < rawLines.length; i++) {
        const cols = parseCsvLine(rawLines[i]);
        const id = parseInt(cols[idIdx] || "", 10);
        if (!Number.isFinite(id)) continue;

        const patch: Partial<Word> = {};
        if (enIdx >= 0) patch.en = cols[enIdx];
        if (ruIdx >= 0) patch.ru = cols[ruIdx];
        if (levelIdx >= 0 && cols[levelIdx]) patch.level = cols[levelIdx] as any;
        if (registerIdx >= 0 && cols[registerIdx]) patch.register = cols[registerIdx] as any;
        if (rarityIdx >= 0 && cols[rarityIdx]) patch.rarity = cols[rarityIdx] as any;

        try {
          if (Object.keys(patch).length > 0) {
            await adminDictionaryApi.patchEntry({ lang, id, patch });
          }
          if (reviewedIdx >= 0) {
            const v = String(cols[reviewedIdx] || "").trim().toLowerCase();
            if (v === "yes" || v === "1" || v === "true") {
              await adminDictionaryApi.setReviewed({ lang, entryId: id, reviewed: true });
            } else if (v === "no" || v === "0" || v === "false") {
              await adminDictionaryApi.setReviewed({ lang, entryId: id, reviewed: false });
            }
          }
          ok++;
        } catch (rowErr) {
          fail++;
          setImportLog((prev) => prev + `\n#${i} id=${id}: ${formatApiError(rowErr, "ошибка")}`);
        }
      }

      setImportLog((prev) => `Готово. OK=${ok}, FAIL=${fail}` + prev);
      await loadList(true);
      setImportState("idle");
    } catch (e) {
      setImportState("error");
      setImportLog(formatApiError(e, "Не удалось импортировать CSV"));
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

  const askAi = async () => {
    const w = (draft?.en || selected?.en || query).trim();
    if (!w) return;
    setAiState("loading");
    setAiError(null);
    setAiJson("");
    try {
      const { suggestion } = await adminDictionaryApi.aiSuggest({
        lang,
        word: w,
        existing: draft ?? null,
      });
      setAiJson(JSON.stringify(suggestion, null, 2));
      setAiState("idle");
    } catch (e) {
      setAiState("error");
      setAiError(formatApiError(e, "Ошибка AI-подсказки"));
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
      setDraft((prev) => ({ ...(prev || {}), ...(parsed as Partial<Word>) }));
    } catch {
      setAiError("JSON не парсится");
    }
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
                className="word-action-btn word-action-add-personal"
                onClick={() => loadList(true)}
                disabled={searchState === "loading"}
              >
                {searchState === "loading" ? "Загрузка…" : "Применить"}
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
                className="word-action-btn"
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
              >
                Сброс
              </button>
            </div>
          </div>
          {searchError && (
            <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
              {searchError}
            </div>
          )}

          <div className="admin-dict-section" style={{ marginTop: 12 }}>
            <div className="admin-dict-section-title">Инструменты</div>
            <div className="admin-dict-actions" style={{ marginTop: 0 }}>
              <button type="button" className="word-action-btn" onClick={exportCsv}>
                Экспорт CSV (по текущим фильтрам)
              </button>
            </div>
            <div className="admin-dict-form">
              <label className="admin-dict-field">
                <span className="admin-dict-label">Импорт CSV (патчи)</span>
                <HelpText>
                  Минимум колонка <b>id</b>. Дополнительно можно указать <b>en, ru, level, register, rarity</b> и{" "}
                  <b>reviewed</b> (yes/no).
                </HelpText>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={6}
                  placeholder="Колонки минимум: id. Опционально: en,ru,level,register,rarity,reviewed(yes/no)"
                />
              </label>
              <button type="button" className="word-action-btn" onClick={importCsv} disabled={importState === "loading"}>
                {importState === "loading" ? "Импорт…" : "Импортировать"}
              </button>
              {importLog && (
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, padding: 10, border: "1px solid var(--border-subtle)", background: "var(--card)" }}>
                  {importLog}
                </pre>
              )}
            </div>
          </div>

          <div className="admin-dict-layout">
            <div className="admin-dict-results">
              <div className="admin-dict-results-title">
                Слова ({items.length}/{total})
              </div>
              <ul className="admin-dict-results-list" role="list">
                {items.map((w) => (
                  <li key={w.id}>
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
                          {!w.hasExample ? <span className="admin-dict-chip">no ex</span> : null}
                          {!w.hasIpa ? <span className="admin-dict-chip">no ipa</span> : null}
                        </span>
                        <span className={`admin-dict-review-pill ${w.reviewedAt ? "ok" : "todo"}`}>
                          {w.reviewedAt ? "Проверено" : "Не проверено"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {items.length < total && (
                <button
                  type="button"
                  className="word-action-btn"
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

            <div className="admin-dict-editor">
              <div className="admin-dict-results-title">Редактор</div>
              {!draft ? (
                <div className="dictionary-subtitle">Выбери слово слева.</div>
              ) : (
                <>
                  {saveError && (
                    <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginBottom: 8 }}>
                      {saveError}
                    </div>
                  )}

                  <div className="admin-dict-section">
                    <div className="admin-dict-section-title">Карточка слова (то, что видит пользователь)</div>
                    <div className="admin-dict-form">
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Слово/выражение (EN)</span>
                      <HelpText>Написание как в словаре. Можно фразу: <i>thank you</i>, <i>good morning</i>.</HelpText>
                      <input value={draft.en ?? ""} onChange={(e) => setDraft({ ...draft, en: e.target.value })} placeholder="например: run / thank you" />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Короткий перевод (RU)</span>
                      <HelpText>
                        1 самый частотный вариант (без длинных перечислений). Это «глосс» для карточки.
                      </HelpText>
                      <input value={draft.ru ?? ""} onChange={(e) => setDraft({ ...draft, ru: e.target.value })} placeholder="например: бежать" />
                    </label>

                    <div className="admin-dict-row">
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Уровень (CEFR)</span>
                        <HelpText>Уровень для основного значения (sense #1), которое используется в играх.</HelpText>
                        <select
                          value={(draft.level as string) ?? "A0"}
                          onChange={(e) => setDraft({ ...draft, level: e.target.value as Word["level"] })}
                        >
                          {LEVELS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Акцент</span>
                        <HelpText>Какой вариант произношения использовать в озвучке: UK / US / оба.</HelpText>
                        <select
                          value={(draft.accent as string) ?? "both"}
                          onChange={(e) => setDraft({ ...draft, accent: e.target.value as Word["accent"] })}
                        >
                          {ACCENTS.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="admin-dict-row">
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Частотность (rank)</span>
                        <HelpText>Чем меньше число — тем чаще слово встречается в языке.</HelpText>
                        <input
                          value={draft.frequencyRank ?? 15000}
                          onChange={(e) => setDraft({ ...draft, frequencyRank: toNumber(e.target.value, 15000) })}
                        />
                      </label>
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Редкость</span>
                        <HelpText>Качественная оценка частоты (помогает фильтровать экзотику).</HelpText>
                        <select
                          value={(draft.rarity as string) ?? "не редкое"}
                          onChange={(e) => setDraft({ ...draft, rarity: e.target.value as Word["rarity"] })}
                        >
                          {RARITIES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Регистр</span>
                        <HelpText>Где уместно: разговорная речь или официальная.</HelpText>
                        <select
                          value={(draft.register as string) ?? "разговорная"}
                          onChange={(e) => setDraft({ ...draft, register: e.target.value as Word["register"] })}
                        >
                          {REGISTERS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="admin-dict-row">
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Транскрипция (IPA UK)</span>
                        <HelpText>Можно оставить пустым — но лучше заполнить для обучения произношению.</HelpText>
                        <input value={draft.ipaUk ?? ""} onChange={(e) => setDraft({ ...draft, ipaUk: e.target.value })} placeholder="например: /rʌn/" />
                      </label>
                      <label className="admin-dict-field">
                        <span className="admin-dict-label">Транскрипция (IPA US)</span>
                        <HelpText>Если UK/US одинаковые — можно продублировать.</HelpText>
                        <input value={draft.ipaUs ?? ""} onChange={(e) => setDraft({ ...draft, ipaUs: e.target.value })} placeholder="например: /rʌn/" />
                      </label>
                    </div>

                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Пример (EN)</span>
                      <HelpText>Короткое естественное предложение (контекст важнее «словарности»).</HelpText>
                      <textarea
                        value={draft.example ?? ""}
                        onChange={(e) => setDraft({ ...draft, example: e.target.value })}
                        rows={3}
                        placeholder="например: I run every morning."
                      />
                    </label>
                    <label className="admin-dict-field">
                      <span className="admin-dict-label">Перевод примера (RU)</span>
                      <HelpText>Не дословно — главное естественность и тот же смысл.</HelpText>
                      <textarea
                        value={draft.exampleRu ?? ""}
                        onChange={(e) => setDraft({ ...draft, exampleRu: e.target.value })}
                        rows={3}
                        placeholder="например: Я бегаю каждое утро."
                      />
                    </label>
                    </div>
                  </div>

                  <div className="admin-dict-actions">
                    <button
                      type="button"
                      className="word-action-btn word-action-add-personal"
                      onClick={save}
                      disabled={saveState === "loading"}
                    >
                      {saveState === "loading" ? "Сохранение…" : "Сохранить"}
                    </button>
                    <button type="button" className="word-action-btn" onClick={() => toggleReviewed(true)}>
                      ✅ Проверено
                    </button>
                    <button type="button" className="word-action-btn" onClick={() => toggleReviewed(false)}>
                      ↩ Снять проверку
                    </button>
                    <button
                      type="button"
                      className="word-action-btn"
                      onClick={askAi}
                      disabled={aiState === "loading"}
                      title="Требует OPENAI_API_KEY на сервере"
                    >
                      {aiState === "loading" ? "AI…" : "AI‑подсказка"}
                    </button>
                    <button
                      type="button"
                      className="word-action-btn"
                      onClick={askAiDraft}
                      disabled={aiDraftState === "loading"}
                      title="Полный черновик: смыслы/примеры/формы. Требует OPENAI_API_KEY на сервере"
                    >
                      {aiDraftState === "loading" ? "Draft…" : "AI‑черновик"}
                    </button>
                    <button
                      type="button"
                      className="word-action-btn"
                      onClick={checkOpenAiKey}
                      title="Проверить, как сервер видит OPENAI_API_KEY (длина, префикс, суффикс)"
                    >
                      Проверить ключ
                    </button>
                  </div>
                  {(openaiCheckError || openaiCheckResult) && (
                    <div className="admin-dict-help" style={{ marginTop: 8 }}>
                      {openaiCheckError && (
                        <div className="dictionary-error-banner" style={{ padding: "8px 12px" }}>{openaiCheckError}</div>
                      )}
                      {openaiCheckResult && (
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {JSON.stringify(openaiCheckResult, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}

                  {(v2Error || v2) && (
                    <div className="admin-dict-section" style={{ marginTop: 14 }}>
                      <div className="admin-dict-section-title">Значения слова (смыслы)</div>
                      <HelpText>
                        <b>Значение #1</b> связано с карточкой пользователя (игры/прогресс). Поэтому его <b>глосс/уровень/регистр</b>{" "}
                        редактируются в блоке «Карточка слова». В v2 для #1 можно дополнять только определение и пометы.
                      </HelpText>
                      {v2Error && <div className="dictionary-error-banner" style={{ padding: "8px 12px" }}>{v2Error}</div>}
                      {v2?.senses && Array.isArray(v2.senses) && (
                        <div className="admin-dict-senses">
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
                                    <button type="button" className="word-action-btn" onClick={() => saveSense(s.id)}>
                                      Сохранить значение
                                    </button>
                                    <button type="button" className="word-action-btn" onClick={() => { setEditingSenseId(null); setSenseEdit(null); }}>
                                      Отмена
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {s.definitionRu ? <div className="admin-dict-sense-text">{s.definitionRu}</div> : null}
                                  {s.usageNote ? <div className="admin-dict-sense-note">{s.usageNote}</div> : null}
                                  <div className="admin-dict-actions" style={{ marginTop: 10 }}>
                                    <button type="button" className="word-action-btn" onClick={() => startEditSense(s)}>
                                      Редактировать
                                    </button>
                                    {s.senseNo > 1 && (
                                      <button type="button" className="word-action-btn" onClick={() => deleteSense(s.id)}>
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
                                  {(s.examples || []).map((ex) => (
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
                                            <button type="button" className="word-action-btn" onClick={() => saveExample(ex.id)}>
                                              Сохранить
                                            </button>
                                            <button type="button" className="word-action-btn" onClick={() => { setEditingExampleId(null); setExampleEdit(null); }}>
                                              Отмена
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.en}</div>
                                            <div style={{ color: "var(--text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.ru || "—"}</div>
                                          </div>
                                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                                            {ex.isMain ? (
                                              <span className="admin-dict-review-pill ok">Main</span>
                                            ) : (
                                              <button type="button" className="word-action-btn" onClick={() => setMainExample(ex.id)}>
                                                Сделать главным
                                              </button>
                                            )}
                                            <button type="button" className="word-action-btn" onClick={() => startEditExample(ex)}>
                                              Редактировать
                                            </button>
                                            <button type="button" className="word-action-btn" onClick={() => deleteExample(ex.id)}>
                                              Удалить
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
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
                                  <button type="button" className="word-action-btn" onClick={() => addExample(s.id)}>
                                    Добавить пример
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {v2?.lemma?.id && (
                        <div style={{ marginTop: 14 }}>
                          <div className="admin-dict-section-title">Формы слова (морфология)</div>
                          <HelpText>
                            Заполняй только если нужно для обучения/упражнений. Типы можно писать свободно, рекомендуемые:{" "}
                            <b>past</b>, <b>past_participle</b>, <b>ing</b>, <b>3sg</b>, <b>plural</b>, <b>comparative</b>,{" "}
                            <b>superlative</b>.
                          </HelpText>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {(v2.forms || []).map((f) => (
                              <div key={f.id} style={{ border: "1px solid var(--border-subtle)", padding: 10, background: "var(--card)", display: "flex", justifyContent: "space-between", gap: 10 }}>
                                {editingFormId === f.id && formEdit ? (
                                  <div className="admin-dict-form admin-dict-form--compact" style={{ marginTop: 0, width: "100%" }}>
                                    <div className="admin-dict-row">
                                      <label className="admin-dict-field">
                                        <span className="admin-dict-label">Form</span>
                                        <input value={formEdit.form} onChange={(e) => setFormEdit({ ...formEdit, form: e.target.value })} />
                                      </label>
                                      <label className="admin-dict-field">
                                        <span className="admin-dict-label">Type</span>
                                        <input value={formEdit.formType} onChange={(e) => setFormEdit({ ...formEdit, formType: e.target.value })} />
                                      </label>
                                    </div>
                                    <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                      <input type="checkbox" checked={formEdit.isIrregular} onChange={(e) => setFormEdit({ ...formEdit, isIrregular: e.target.checked })} />
                                      <span className="admin-dict-label" style={{ margin: 0 }}>Irregular</span>
                                    </label>
                                    <label className="admin-dict-field">
                                      <span className="admin-dict-label">Notes</span>
                                      <textarea value={formEdit.notes} onChange={(e) => setFormEdit({ ...formEdit, notes: e.target.value })} rows={2} />
                                    </label>
                                    <div className="admin-dict-actions" style={{ marginTop: 6 }}>
                                      <button type="button" className="word-action-btn" onClick={() => saveForm(f.id)}>
                                        Сохранить
                                      </button>
                                      <button type="button" className="word-action-btn" onClick={() => { setEditingFormId(null); setFormEdit(null); }}>
                                        Отмена
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div>
                                      <div style={{ fontWeight: 800 }}>{f.form}</div>
                                      <div className="admin-dict-muted">{[f.formType || "—", f.isIrregular ? "irregular" : "regular"].join(" • ")}</div>
                                      {f.notes ? <div className="admin-dict-sense-note">{f.notes}</div> : null}
                                    </div>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                                      <button type="button" className="word-action-btn" onClick={() => startEditForm(f)}>
                                        Редактировать
                                      </button>
                                      <button type="button" className="word-action-btn" onClick={() => deleteForm(f.id)}>
                                        Удалить
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="admin-dict-form admin-dict-form--compact" style={{ marginTop: 10 }}>
                            <div className="admin-dict-row">
                              <label className="admin-dict-field">
                                <span className="admin-dict-label">Форма</span>
                                <HelpText>Например: <i>went</i>, <i>running</i>, <i>children</i>.</HelpText>
                                <input value={newForm.form} onChange={(e) => setNewForm({ ...newForm, form: e.target.value })} placeholder="например: went" />
                              </label>
                              <label className="admin-dict-field">
                                <span className="admin-dict-label">Тип формы</span>
                                <HelpText>Короткая метка: past / ing / plural …</HelpText>
                                <input value={newForm.formType} onChange={(e) => setNewForm({ ...newForm, formType: e.target.value })} placeholder="past / ing / plural …" />
                              </label>
                            </div>
                            <label className="admin-dict-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <input type="checkbox" checked={newForm.isIrregular} onChange={(e) => setNewForm({ ...newForm, isIrregular: e.target.checked })} />
                              <span className="admin-dict-label" style={{ margin: 0 }}>Irregular</span>
                            </label>
                            <label className="admin-dict-field">
                              <span className="admin-dict-label">Комментарий</span>
                              <HelpText>Например: «устар.», «редко», «только в выражении …».</HelpText>
                              <textarea value={newForm.notes} onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} rows={2} />
                            </label>
                            <button type="button" className="word-action-btn" onClick={addForm}>
                              Добавить форму
                            </button>
                          </div>
                        </div>
                      )}

                      <div style={{ marginTop: 12 }}>
                        <div className="admin-dict-section-title">Добавить новое значение (sense #2+)</div>
                        <HelpText>Добавляй, если у слова есть отдельный смысл. Для каждого смысла — свои примеры и пометы.</HelpText>
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
                          <button type="button" className="word-action-btn" onClick={addSense}>
                            Добавить значение
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {aiError && (
                    <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
                      {aiError}
                    </div>
                  )}
                  {aiDraftError && (
                    <div className="dictionary-error-banner" style={{ padding: "8px 12px", marginTop: 8 }}>
                      {aiDraftError}
                    </div>
                  )}
                  {aiDraftJson && (
                    <div className="admin-dict-ai">
                      <div className="admin-dict-results-title">AI draft (JSON)</div>
                      <HelpText>
                        Это <b>черновик</b>: смыслы/примеры/формы. Выбери, что применить в БД. По умолчанию <b>sense #1</b> не
                        трогаем по core‑полям (уровень/регистр/глосс), чтобы не ломать legacy‑карточку.
                      </HelpText>
                      <textarea
                        value={aiDraftJson}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAiDraftJson(v);
                          try {
                            const parsed = JSON.parse(v);
                            if (parsed && typeof parsed === "object") setAiDraft(parsed as AdminDictionaryAiDraft);
                          } catch {
                            // ignore parse errors while typing
                          }
                        }}
                        rows={12}
                      />

                      <div className="admin-dict-form admin-dict-form--compact" style={{ marginTop: 10 }}>
                        <div className="admin-dict-row" style={{ alignItems: "center" }}>
                          <label className="admin-dict-qc-toggle">
                            <input type="checkbox" checked={applyDraftEntryPatch} onChange={(e) => setApplyDraftEntryPatch(e.target.checked)} />
                            <span>Применить entryPatch (legacy карточку)</span>
                          </label>
                          <label className="admin-dict-qc-toggle">
                            <input type="checkbox" checked={applyDraftLemmaPatch} onChange={(e) => setApplyDraftLemmaPatch(e.target.checked)} />
                            <span>Применить lemmaPatch (частотность/IPA…)</span>
                          </label>
                        </div>
                        <div className="admin-dict-row" style={{ alignItems: "center" }}>
                          <label className="admin-dict-qc-toggle">
                            <input type="checkbox" checked={applyDraftReplaceExamples} onChange={(e) => setApplyDraftReplaceExamples(e.target.checked)} />
                            <span>Заменять примеры (иначе только добавлять/обновлять)</span>
                          </label>
                          <label className="admin-dict-qc-toggle">
                            <input type="checkbox" checked={applyDraftSense1Core} onChange={(e) => setApplyDraftSense1Core(e.target.checked)} />
                            <span>Разрешить core‑правки для sense #1</span>
                          </label>
                        </div>

                        {aiDraft?.senses && aiDraft.senses.length > 0 && (
                          <div className="admin-dict-field">
                            <span className="admin-dict-label">Смыслы (какие применить)</span>
                            <div className="admin-dict-row" style={{ flexWrap: "wrap", gap: 10 }}>
                              {aiDraft.senses.map((s) => {
                                const no = Number(s.senseNo);
                                const checked = applyDraftSenseNos.includes(no);
                                return (
                                  <label key={no} className="admin-dict-qc-toggle">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        const on = e.target.checked;
                                        setApplyDraftSenseNos((prev) => (on ? Array.from(new Set([...prev, no])) : prev.filter((x) => x !== no)));
                                      }}
                                    />
                                    <span>
                                      #{no} {s.glossRu ? `— ${s.glossRu}` : ""}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {aiDraft?.forms && aiDraft.forms.length > 0 && (
                          <div className="admin-dict-field">
                            <span className="admin-dict-label">Формы (какие применить)</span>
                            <div className="admin-dict-row" style={{ flexWrap: "wrap", gap: 10 }}>
                              {aiDraft.forms.map((f, idx) => {
                                const checked = applyDraftFormIndexes.includes(idx);
                                return (
                                  <label key={`${f.form}-${f.formType}-${idx}`} className="admin-dict-qc-toggle">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        const on = e.target.checked;
                                        setApplyDraftFormIndexes((prev) => (on ? Array.from(new Set([...prev, idx])) : prev.filter((x) => x !== idx)));
                                      }}
                                    />
                                    <span>
                                      {f.form} <span className="admin-dict-muted">({f.formType})</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          className="word-action-btn word-action-add-personal"
                          onClick={applyAiDraft}
                          disabled={aiDraftState === "loading" || !draft?.id || !aiDraft}
                        >
                          {aiDraftState === "loading" ? "Применяем…" : "Применить выбранное в БД"}
                        </button>
                      </div>
                    </div>
                  )}
                  {aiJson && (
                    <div className="admin-dict-ai">
                      <div className="admin-dict-results-title">AI suggestion (JSON)</div>
                      <textarea value={aiJson} onChange={(e) => setAiJson(e.target.value)} rows={10} />
                      <button type="button" className="word-action-btn" onClick={applyAiJson}>
                        Применить в форму
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default AdminDictionaryPage;

