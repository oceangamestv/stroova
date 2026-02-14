import React, { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/common/Header";
import { useAuth } from "../features/auth/AuthContext";
import { userDictionaryApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import { useNavigate } from "react-router-dom";
import { authService } from "../services/authService";
import { useIsMobile } from "../hooks/useIsMobile";

type LoadState = "idle" | "loading" | "error";
type Tab = "today" | "my" | "collections";
type StatusFilter = "all" | "queue" | "learning" | "known" | "hard";
type StartProfile = "beginner" | "basic_sentences" | "everyday_topics";
type DictionaryAddMode = "ask" | "instant" | "onboarding";

/** Элемент колоды: либо на повтор (due), либо новое слово (new). */
type DeckItem =
  | { kind: "due"; senseId: number; en: string; ru?: string; example?: string; exampleRu?: string; level?: string; register?: string }
  | { kind: "new"; entryId: number; senseId: number; en: string; ru?: string; example?: string; exampleRu?: string; level?: string; register?: string };

const svgProps = { viewBox: "0 0 24 24" as const, fill: "none" as const, stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

/** Подпись кнопки нижнего меню: при нехватке места включается бегущая строка */
const DictTabLabel: React.FC<{ text: string }> = ({ text }) => {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [marquee, setMarquee] = useState(false);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const update = () => {
      const narrow = window.matchMedia("(max-width: 360px)").matches;
      const overflow = Math.ceil(inner.scrollWidth - wrap.clientWidth);
      const shouldMarquee = narrow && overflow > 2;
      setMarquee(shouldMarquee);
      setShift(shouldMarquee ? overflow : 0);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    ro.observe(inner);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [text]);
  return (
    <span
      ref={wrapRef}
      className={`dict-casual-bottom-tabs__label ${marquee ? "dict-casual-bottom-tabs__label--marquee" : ""}`}
      style={{ "--marquee-shift": `${shift}px` } as React.CSSProperties}
    >
      <span ref={innerRef} className="dict-casual-bottom-tabs__label-inner">
        {text}
      </span>
    </span>
  );
};

const LevelBeginnerIcon = () => (
  <svg {...svgProps} width={24} height={24}><path d="M12 2l3 6 6 .8-4.4 4.3 1 6-5.6-3-5.6 3 1-6L3 8.8 9 8l3-6z" /></svg>
);
const LevelBasicIcon = () => (
  <svg {...svgProps} width={24} height={24}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M8 7h8M8 11h8" /></svg>
);
const LevelEverydayIcon = () => (
  <svg {...svgProps} width={24} height={24}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
);
const LevelSoonIcon = () => (
  <svg {...svgProps} width={24} height={24}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
);

const START_PROFILE_OPTIONS: Array<{
  id: StartProfile;
  title: string;
  subtitle: string;
  shortTitle: string;
  hint: string;
  collection: string;
  icon: React.ReactNode;
}> = [
  {
    id: "beginner",
    title: "Я только начинаю учить английский",
    subtitle: "Простой старт с базовыми словами и короткими фразами.",
    shortTitle: "Начальная",
    hint: "I, you, hello — первые слова",
    collection: "A0",
    icon: <LevelBeginnerIcon />,
  },
  {
    id: "basic_sentences",
    title: "Я умею составлять простые предложения",
    subtitle: "Укрепляем словарь для бытового общения и ежедневных ситуаций.",
    shortTitle: "Базовая",
    hint: "Простые предложения, бытовые фразы",
    collection: "A1",
    icon: <LevelBasicIcon />,
  },
  {
    id: "everyday_topics",
    title: "Я общаюсь на простые темы",
    subtitle: "Расширяем лексику и уверенность в повседневном разговоре.",
    shortTitle: "Лёгкая",
    hint: "Простые темы, повседневный разговор",
    collection: "A2",
    icon: <LevelEverydayIcon />,
  },
];

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

const MiniBadge: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span className={`dict-mini-badge ${className || ""}`.trim()}>{children}</span>
);

const WordCardTile: React.FC<{
  item: any;
  onDetails: () => void;
  onLearn?: () => void;
  onRemove?: () => void;
  learnLabel?: string;
}> = ({ item, onDetails, onLearn, onRemove, learnLabel }) => {
  return (
    <div className="dict-card">
      <div className="dict-card__head">
        <div className="dict-card__word">{item.en}</div>
        <div className="dict-card__badges">
          {item.level && <MiniBadge className={`lvl lvl-${item.level}`}>{item.level}</MiniBadge>}
          {item.register && <MiniBadge>{item.register}</MiniBadge>}
        </div>
      </div>
      <div className="dict-card__ru">{item.ru || "—"}</div>
      {!!item.example && (
        <div className="dict-card__example">
          <div className="dict-card__example-en">{item.example}</div>
          {!!item.exampleRu && <div className="dict-card__example-ru">{item.exampleRu}</div>}
        </div>
      )}
      <div className="dict-card__actions">
        {onLearn && (
          <button type="button" className="word-action-btn word-action-add-personal" onClick={onLearn}>
            {learnLabel || "Учить"}
          </button>
        )}
        <button type="button" className="word-action-btn" onClick={onDetails}>
          Подробнее
        </button>
        {onRemove && (
          <button type="button" className="word-action-btn word-action-remove-personal" onClick={onRemove}>
            Удалить
          </button>
        )}
      </div>
    </div>
  );
};

/** Карточка слова в колоде (минималистичный вид). */
const WordDeckCard: React.FC<{
  item: DeckItem;
  style?: React.CSSProperties;
  className?: string;
}> = ({ item, style, className }) => (
  <div className={`dict-deck-card ${className || ""}`.trim()} style={style}>
    <div className="dict-deck-card__chip">
      {item.kind === "due" ? "Повтор" : "Новое"}
    </div>
    <div className="dict-deck-card__word">{item.en}</div>
    <div className="dict-deck-card__ru">{item.ru || "—"}</div>
    <div className="dict-deck-card__badges">
      {item.level && <MiniBadge className={`lvl lvl-${item.level}`}>{item.level}</MiniBadge>}
    </div>
  </div>
);

/** Колода: одна карточка + жесты + кнопки. */
const WordDeck: React.FC<{
  items: DeckItem[];
  activeIndex: number;
  onIndexChange: (next: number) => void;
  onAdd: (item: DeckItem) => void;
  onSkip: (item: DeckItem) => void;
  onDetails: (item: DeckItem) => void;
  onListen: (item: DeckItem) => void;
  speakEn: (text: string) => void;
  addLabel: string;
}> = ({ items, activeIndex, onIndexChange, onAdd, onSkip, onDetails, onListen, speakEn, addLabel }) => {
  const [drag, setDrag] = useState({ x: 0, y: 0, startX: 0, startY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const SWIPE_THRESHOLD = 60;
  const cardRef = React.useRef<HTMLDivElement>(null);

  const current = items[activeIndex];
  const canGoNext = activeIndex < items.length - 1;
  const canGoPrev = activeIndex > 0;

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDragging(true);
    setDrag({ x: 0, y: 0, startX: e.clientX, startY: e.clientY });
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !current) return;
    setDrag((d) => ({ ...d, x: e.clientX - d.startX, y: e.clientY - d.startY }));
  };
  const handlePointerUp = () => {
    if (!isDragging || !current) return;
    setIsDragging(false);
    const { x, y } = drag;
    if (x > SWIPE_THRESHOLD) {
      onAdd(current);
      onIndexChange(Math.min(activeIndex + 1, items.length - 1));
    } else if (x < -SWIPE_THRESHOLD) {
      onSkip(current);
      onIndexChange(Math.min(activeIndex + 1, items.length - 1));
    } else if (y < -SWIPE_THRESHOLD) {
      onDetails(current);
    }
    setDrag({ x: 0, y: 0, startX: 0, startY: 0 });
  };

  if (!current) {
    return (
      <div className="dict-deck dict-deck--empty">
        <div className="dict-deck__empty">На сегодня всё</div>
      </div>
    );
  }

  const transform = `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * 0.03}deg)`;

  return (
    <div className="dict-deck">
      <div className="dict-deck__counters">
        <span className="dict-deck__counter">Повтор: {items.filter((i) => i.kind === "due").length}</span>
        <span className="dict-deck__counter">Новые: {items.filter((i) => i.kind === "new").length}</span>
      </div>
      <div
        ref={cardRef}
        className="dict-deck__card-wrap"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <WordDeckCard
          item={current}
          style={{ transform }}
          className={isDragging ? "dict-deck-card--dragging" : ""}
        />
      </div>
      <div className="dict-deck__actions">
        <button type="button" className="dict-deck__btn dict-deck__btn--skip" onClick={() => { onSkip(current); onIndexChange(Math.min(activeIndex + 1, items.length - 1)); }} title="Пропустить">
          <svg {...svgProps} width={24} height={24}><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
        <button type="button" className="dict-deck__btn dict-deck__btn--listen" onClick={() => speakEn(current.en)} title="Слушать">
          <svg {...svgProps} width={24} height={24}><path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
        </button>
        <button type="button" className="dict-deck__btn dict-deck__btn--add word-action-add-personal" onClick={() => { onAdd(current); onIndexChange(Math.min(activeIndex + 1, items.length - 1)); }} title={addLabel}>
          <svg {...svgProps} width={24} height={24}><path d="M12 5v14M5 12h14" /></svg>
          <span className="dict-deck__btn-label">{addLabel}</span>
        </button>
        <button type="button" className="dict-deck__btn dict-deck__btn--details" onClick={() => onDetails(current)} title="Подробнее">
          <svg {...svgProps} width={24} height={24}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>
        </button>
      </div>
      <p className="dict-deck__hint">Свайп вправо — добавить/учить, влево — пропустить, вверх — подробнее</p>
    </div>
  );
};

const DictionaryCasualPage: React.FC = () => {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const lang = "en";
  const [tab, setTab] = useState<Tab>("today");

  const [todayState, setTodayState] = useState<LoadState>("idle");
  const [todayError, setTodayError] = useState<string | null>(null);
  const [todayDue, setTodayDue] = useState<any[]>([]);
  const [todayNew, setTodayNew] = useState<any[]>([]);
  const [hardOfDay, setHardOfDay] = useState<any | null>(null);
  const [currentCollection, setCurrentCollection] = useState<any | null>(null);
  const [startProfile, setStartProfile] = useState<StartProfile | null>(
    (user?.gameSettings?.dictionaryStartProfile as StartProfile | undefined) || null
  );
  const [startProfileSaving, setStartProfileSaving] = useState(false);
  const [startProfileModalOpen, setStartProfileModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const dictionaryAddMode =
    ((user?.gameSettings as any)?.dictionaryAddMode as DictionaryAddMode | undefined) || "ask";
  const [addModeModal, setAddModeModal] = useState<{ open: boolean; item: any | null }>({
    open: false,
    item: null,
  });
  const [addModeRemember, setAddModeRemember] = useState(false);

  const [onboarding, setOnboarding] = useState<{
    open: boolean;
    item: any | null;
    step: 0 | 1 | 2 | 3;
    meaningOptions: Array<{ id: string; label: string; correct: boolean }>;
    meaningWrong: boolean;
    pieces: Array<{ id: string; text: string }>;
    picked: Array<{ id: string; text: string }>;
    audioPlayed: boolean;
    quickOptions: Array<{ id: string; label: string; correct: boolean }>;
    quickWrong: boolean;
  }>({
    open: false,
    item: null,
    step: 0,
    meaningOptions: [],
    meaningWrong: false,
    pieces: [],
    picked: [],
    audioPlayed: false,
    quickOptions: [],
    quickWrong: false,
  });

  const [todayView, setTodayView] = useState<"deck" | "list">("deck");
  const [todaySubView, setTodaySubView] = useState<"home" | "deck" | "list">("home");
  const [deckIndex, setDeckIndex] = useState(0);
  const [detailsSheet, setDetailsSheet] = useState<{ open: boolean; item: DeckItem | null }>({ open: false, item: null });
  const [heroCarouselSlide, setHeroCarouselSlide] = useState<0 | 1>(0);
  const [heroTimerKey, setHeroTimerKey] = useState(0);
  const isMobile = useIsMobile();

  const [myState, setMyState] = useState<LoadState>("idle");
  const [myError, setMyError] = useState<string | null>(null);
  const [myQ, setMyQ] = useState("");
  const [myStatus, setMyStatus] = useState<StatusFilter>("all");
  const [myItems, setMyItems] = useState<any[]>([]);
  const [myTotal, setMyTotal] = useState(0);
  const [myWordsPanelOpen, setMyWordsPanelOpen] = useState(false);
  const [myToolsFabCompact, setMyToolsFabCompact] = useState(false);
  const myWordsSearchInputRef = useRef<HTMLInputElement>(null);
  const myWordsPanelOpenButtonRef = useRef<HTMLButtonElement>(null);

  const [collectionsState, setCollectionsState] = useState<LoadState>("idle");
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [collections, setCollections] = useState<any[]>([]);

  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionState, setCollectionState] = useState<LoadState>("idle");
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [collection, setCollection] = useState<any | null>(null);
  const [collectionItems, setCollectionItems] = useState<any[]>([]);

  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; senseId: number | null; wordLabel: string }>({
    open: false,
    senseId: null,
    wordLabel: "",
  });

  const isLoggedIn = !!user;

  const loadToday = async () => {
    if (!isLoggedIn) return;
    setTodayState("loading");
    setTodayError(null);
    try {
      const out = await userDictionaryApi.today({ lang });
      setTodayDue(Array.isArray(out?.due) ? out.due : []);
      setTodayNew(Array.isArray(out?.new) ? out.new : []);
      setHardOfDay(out?.hardOfDay ?? null);
      setCurrentCollection(out?.currentCollection ?? null);
      if (Object.prototype.hasOwnProperty.call(out || {}, "startProfile")) {
        setStartProfile((out?.startProfile as StartProfile | null) ?? null);
      }
      setTodayState("idle");
    } catch (e) {
      setTodayState("error");
      setTodayError(formatApiError(e, "Не удалось загрузить «Сегодня»"));
    }
  };

  const loadMy = async () => {
    if (!isLoggedIn) return;
    setMyState("loading");
    setMyError(null);
    try {
      const out = await userDictionaryApi.myWords({ lang, q: myQ.trim() || undefined, status: myStatus, offset: 0, limit: 80 });
      setMyItems(Array.isArray(out?.items) ? out.items : []);
      setMyTotal(typeof out?.total === "number" ? out.total : 0);
      setMyState("idle");
    } catch (e) {
      setMyState("error");
      setMyError(formatApiError(e, "Не удалось загрузить «Мои слова»"));
    }
  };

  const loadCollections = async () => {
    setCollectionsState("loading");
    setCollectionsError(null);
    try {
      const out = await userDictionaryApi.collections({ lang });
      setCollections(Array.isArray(out?.items) ? out.items : []);
      setCollectionsState("idle");
    } catch (e) {
      setCollectionsState("error");
      setCollectionsError(formatApiError(e, "Не удалось загрузить коллекции"));
    }
  };

  const pickStartProfile = async (profile: StartProfile) => {
    if (!isLoggedIn) return;
    setStartProfileSaving(true);
    setTodayError(null);
    try {
      const out = await userDictionaryApi.setStartProfile({ lang, profile });
      authService.updateGameSettings({ dictionaryStartProfile: profile });
      setStartProfile(profile);
      setStartProfileModalOpen(false);
      setCurrentCollection(out?.currentCollection ?? null);
      setTodayDue(Array.isArray(out?.due) ? out.due : []);
      setTodayNew(Array.isArray(out?.new) ? out.new : []);
      refresh();
      await loadMy();
      await loadCollections();
    } catch (e) {
      setTodayError(formatApiError(e, "Не удалось сохранить стартовый профиль"));
    } finally {
      setStartProfileSaving(false);
    }
  };

  const learnFromNew = async (entryId: number) => {
    if (!isLoggedIn) return;
    try {
      const out = await userDictionaryApi.add({ lang, entryId });
      await userDictionaryApi.setStatus({ senseId: Number(out.senseId), status: "learning" });
      await loadToday();
      await loadMy();
    } catch (e) {
      setTodayError(formatApiError(e, "Не удалось добавить слово"));
    }
  };

  const shuffle = <T,>(arr: T[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const buildPiecesForWord = (word: string): Array<{ id: string; text: string }> => {
    const w = String(word || "").trim();
    if (!w) return [];
    const letters = w.split("");
    if (letters.length <= 7) {
      return shuffle(letters.map((ch, idx) => ({ id: `l-${idx}-${ch}`, text: ch })));
    }
    const partsCount = letters.length <= 10 ? 3 : 4;
    const chunkSize = Math.ceil(letters.length / partsCount);
    const chunks: string[] = [];
    for (let i = 0; i < letters.length; i += chunkSize) chunks.push(letters.slice(i, i + chunkSize).join(""));
    return shuffle(chunks.map((t, idx) => ({ id: `c-${idx}-${t}`, text: t })));
  };

  const speakEn = (text: string) => {
    const t = String(text || "").trim();
    if (!t) return false;
    // @ts-expect-error: speechSynthesis доступен в браузере
    const synth: SpeechSynthesis | undefined = typeof window !== "undefined" ? (window as any).speechSynthesis : undefined;
    // @ts-expect-error: SpeechSynthesisUtterance доступен в браузере
    const Utterance: typeof SpeechSynthesisUtterance | undefined = typeof window !== "undefined" ? (window as any).SpeechSynthesisUtterance : undefined;
    if (!synth || !Utterance) return false;
    try {
      synth.cancel();
      const u = new Utterance(t);
      u.lang = "en-US";
      u.rate = 0.95;
      synth.speak(u);
      return true;
    } catch {
      return false;
    }
  };

  const openAddMode = (item: any) => {
    setAddModeRemember(false);
    setAddModeModal({ open: true, item });
  };

  const openOnboarding = (item: any) => {
    const ru = String(item?.ru || "").trim();
    const en = String(item?.en || "").trim();
    const otherRu = todayNew
      .map((x) => String(x?.ru || "").trim())
      .filter((x) => !!x && x !== ru)
      .slice(0, 20);
    const meaningDistr = shuffle(otherRu).slice(0, 2);
    const meaningOptions = shuffle(
      [{ id: "c", label: ru || "—", correct: true }].concat(
        meaningDistr.map((t, i) => ({ id: `d-${i}`, label: t, correct: false }))
      )
    );

    const otherEn = todayNew
      .map((x) => String(x?.en || "").trim())
      .filter((x) => !!x && x.toLowerCase() !== en.toLowerCase())
      .slice(0, 20);
    const quickDistr = shuffle(otherEn).slice(0, 2);
    const quickOptions = shuffle(
      [{ id: "c", label: en || "—", correct: true }].concat(
        quickDistr.map((t, i) => ({ id: `d-${i}`, label: t, correct: false }))
      )
    );

    setOnboarding({
      open: true,
      item,
      step: 0,
      meaningOptions,
      meaningWrong: false,
      pieces: buildPiecesForWord(en),
      picked: [],
      audioPlayed: false,
      quickOptions,
      quickWrong: false,
    });
  };

  const addNewWord = async (item: any) => {
    const entryId = Number(item?.entryId);
    if (!Number.isFinite(entryId) || entryId <= 0) return;
    if (dictionaryAddMode === "instant") {
      await learnFromNew(entryId);
      return;
    }
    if (dictionaryAddMode === "onboarding") {
      openOnboarding(item);
      return;
    }
    openAddMode(item);
  };

  const learnFromDue = async (senseId: number) => {
    if (!isLoggedIn) return;
    try {
      await userDictionaryApi.setStatus({ senseId: Number(senseId), status: "learning" });
      await loadToday();
      await loadMy();
    } catch (e) {
      setTodayError(formatApiError(e, "Не удалось обновить статус"));
    }
  };

  const removeFromMySense = async (senseId: number) => {
    if (!isLoggedIn) return;
    try {
      await userDictionaryApi.removeSense({ senseId });
      await loadToday();
      await loadMy();
    } catch (e) {
      setMyError(formatApiError(e, "Не удалось удалить слово"));
    }
  };

  const openCollection = async (id: number) => {
    if (!isLoggedIn) {
      setCollectionsError("Войдите, чтобы открывать коллекции.");
      return;
    }
    setCollectionOpen(true);
    setCollectionState("loading");
    setCollectionError(null);
    setCollection(null);
    setCollectionItems([]);
    try {
      const out = await userDictionaryApi.getCollection({ lang, id });
      setCollection(out.collection);
      setCollectionItems(Array.isArray(out.items) ? out.items : []);
      setCollectionState("idle");
    } catch (e) {
      setCollectionState("error");
      setCollectionError(formatApiError(e, "Не удалось открыть коллекцию"));
    }
  };

  const closeCollection = () => {
    setCollectionOpen(false);
    setCollectionState("idle");
    setCollectionError(null);
    setCollection(null);
    setCollectionItems([]);
  };

  const addAllCollection = async () => {
    if (!isLoggedIn || !collection?.id) return;
    setCollectionState("loading");
    setCollectionError(null);
    try {
      await userDictionaryApi.addAllFromCollection({ lang, collectionId: Number(collection.id) });
      await openCollection(Number(collection.id));
      await loadToday();
      await loadMy();
      setCollectionState("idle");
    } catch (e) {
      setCollectionState("error");
      setCollectionError(formatApiError(e, "Не удалось добавить слова из коллекции"));
    }
  };

  const addOneFromCollection = async (senseId: number) => {
    if (!isLoggedIn) return;
    try {
      await userDictionaryApi.addSense({ senseId });
      await userDictionaryApi.setStatus({ senseId, status: "learning" });
      setCollectionItems((prev) =>
        prev.map((x) =>
          Number(x.senseId) === Number(senseId)
            ? { ...x, isSaved: true, status: "learning" }
            : x
        )
      );
      await loadToday();
      await loadMy();
    } catch (e) {
      setCollectionError(formatApiError(e, "Не удалось добавить слово"));
    }
  };

  const statusLabel = (s: StatusFilter) => {
    if (s === "all") return "Все";
    if (s === "queue") return "В очереди";
    if (s === "learning") return "Учу";
    if (s === "known") return "Знаю";
    return "Сложное";
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    void loadToday();
    void loadMy();
    void loadCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  useEffect(() => {
    const fromUser = (user?.gameSettings?.dictionaryStartProfile as StartProfile | undefined) || null;
    setStartProfile(fromUser);
  }, [user]);

  useEffect(() => {
    if (!isLoggedIn) {
      setStartProfileModalOpen(false);
      return;
    }
    if (todayState === "loading") return;
    const effectiveProfile = startProfile ?? (user?.gameSettings?.dictionaryStartProfile as StartProfile | undefined) ?? null;
    if (!effectiveProfile) setStartProfileModalOpen(true);
  }, [isLoggedIn, startProfile, user?.gameSettings?.dictionaryStartProfile, todayState]);

  const deckItems = useMemo((): DeckItem[] => {
    const due: DeckItem[] = (todayDue || []).map((it) => ({
      kind: "due",
      senseId: Number(it.senseId),
      en: String(it.en ?? ""),
      ru: it.ru,
      example: it.example,
      exampleRu: it.exampleRu,
      level: it.level,
      register: it.register,
    }));
    const newItems: DeckItem[] = (todayNew || []).map((it) => ({
      kind: "new",
      entryId: Number(it.entryId),
      senseId: Number(it.senseId),
      en: String(it.en ?? ""),
      ru: it.ru,
      example: it.example,
      exampleRu: it.exampleRu,
      level: it.level,
      register: it.register,
    }));
    return [...due, ...newItems];
  }, [todayDue, todayNew]);

  useEffect(() => {
    if (deckItems.length === 0) setDeckIndex(0);
    else if (deckIndex >= deckItems.length) setDeckIndex(Math.max(0, deckItems.length - 1));
  }, [deckItems.length, deckIndex]);

  useEffect(() => {
    if (!isMobile) return;
    if (myWordsPanelOpen) {
      const t = setTimeout(() => myWordsSearchInputRef.current?.focus(), 100);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setMyWordsPanelOpen(false);
      };
      document.addEventListener("keydown", onKey);
      return () => {
        clearTimeout(t);
        document.removeEventListener("keydown", onKey);
      };
    }
    myWordsPanelOpenButtonRef.current?.focus({ preventScroll: true });
  }, [isMobile, myWordsPanelOpen]);

  useEffect(() => {
    if (!isMobile || tab !== "my") {
      setMyToolsFabCompact(false);
      return;
    }
    const onScroll = () => {
      setMyToolsFabCompact(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isMobile, tab]);

  const todayHasContent = todayDue.length > 0 || todayNew.length > 0;

  const mySummary = useMemo(() => {
    if (!myItems.length && !myTotal) return null;
    const items = myItems.length ? myItems : [];
    const known = items.filter((x) => x.status === "known").length;
    const learning = items.filter((x) => x.status === "learning").length;
    const hard = items.filter((x) => x.status === "hard").length;
    const total = myTotal ?? items.length;
    return { known, learning, hard, total };
  }, [myItems, myTotal]);
  const totalForBar = (mySummary?.known ?? 0) + (mySummary?.learning ?? 0) + (mySummary?.hard ?? 0);
  const selectedProfileOption = useMemo(
    () => START_PROFILE_OPTIONS.find((x) => x.id === startProfile) || null,
    [startProfile]
  );

  return (
    <div className="app-shell dict-casual-page">
      <Header />
      <main className="main">
        <div className="page-card">
          <div className="dict-casual-head">
            {!!user && <div className="dict-casual-head__spacer" aria-hidden />}
            <h1 className="dict-casual-head__title">Мой Словарь</h1>
            {!!user && (
              <>
                <button
                  type="button"
                  className="dict-casual-head__gear"
                  onClick={() => setSettingsOpen((v) => !v)}
                  aria-label="Настройки"
                  aria-expanded={settingsOpen}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                {settingsOpen && (
                  <>
                    <div className="dict-casual-settings-backdrop" onClick={() => setSettingsOpen(false)} aria-hidden />
                    <div className="dict-casual-settings-panel">
                      <h2 className="dict-casual-settings-panel__title">Настройки</h2>

                      <section className="dict-casual-settings-panel__section">
                        <h3 className="dict-casual-settings-panel__section-title">Сложность словаря</h3>
                        <div className="dict-casual-settings-panel__section-body">
                          {selectedProfileOption ? (
                            <p className="dict-casual-settings-panel__value">
                              {selectedProfileOption.title}
                              <span className="dict-mini-badge muted dict-casual-settings-panel__badge">
                                Коллекция {selectedProfileOption.collection}
                              </span>
                            </p>
                          ) : (
                            <p className="dict-casual-settings-panel__value dict-casual-settings-panel__value--muted">не выбрана</p>
                          )}
                          <p className="dict-casual-settings-panel__hint">
                            Это стартовая точка. По тренировкам путь можно в любой момент поменять.
                          </p>
                          <button
                            type="button"
                            className="word-action-btn dict-casual-settings-panel__btn"
                            onClick={() => {
                              setSettingsOpen(false);
                              setStartProfileModalOpen(true);
                            }}
                            disabled={startProfileSaving}
                          >
                            Изменить сложность
                          </button>
                        </div>
                      </section>

                      <section className="dict-casual-settings-panel__section">
                        <h3 className="dict-casual-settings-panel__section-title">Режим по умолчанию</h3>
                        <div className="dict-casual-settings-panel__section-body">
                          <div className="dict-casual-settings-panel__mode-switch">
                            <button
                              type="button"
                              className={`dictionary-tab ${user?.gameSettings?.dictionaryViewMode !== "advanced" ? "active" : ""}`}
                              onClick={() => {
                                authService.updateGameSettings({ dictionaryViewMode: "casual" });
                                refresh();
                              }}
                            >
                              Казуально
                            </button>
                            <button
                              type="button"
                              className={`dictionary-tab ${user?.gameSettings?.dictionaryViewMode === "advanced" ? "active" : ""}`}
                              onClick={() => {
                                authService.updateGameSettings({ dictionaryViewMode: "advanced" });
                                refresh();
                                setSettingsOpen(false);
                                navigate("/dictionary/advanced");
                              }}
                            >
                              Продвинуто
                            </button>
                          </div>
                        </div>
                      </section>

                      {currentCollection?.collection && (
                        <section className="dict-casual-settings-panel__section">
                          <h3 className="dict-casual-settings-panel__section-title">Текущая коллекция</h3>
                          <div className="dict-casual-settings-panel__section-body">
                            <p className="dict-casual-settings-panel__value">{currentCollection.collection.title}</p>
                            {currentCollection.progress && (
                              <p className="dict-casual-settings-panel__meta">
                                <span className="dict-mini-badge muted">
                                  {currentCollection.progress.saved}/{currentCollection.progress.total} добавлено · {currentCollection.progress.known} знаю
                                </span>
                              </p>
                            )}
                            <button
                              type="button"
                              className="word-action-btn dict-casual-settings-panel__btn"
                              onClick={() => {
                                setSettingsOpen(false);
                                setTab("collections");
                                if (currentCollection.collection?.id) void openCollection(Number(currentCollection.collection.id));
                              }}
                            >
                              Открыть коллекцию
                            </button>
                          </div>
                        </section>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {!!user && tab !== "collections" && (
            <div className="dict-progress-block dict-progress-block--top">
              <div className="dict-progress-block__head">
                <h3 className="dict-progress-block__title">Твой прогресс</h3>
                {(user?.activeDays?.streakDays ?? 0) > 0 && (
                  <div className="dict-progress-block__streak" title="Серия дней">
                    <span className="dict-progress-block__streak-icon" aria-hidden>🔥</span>
                    <span className="dict-progress-block__streak-text">День {user?.activeDays?.streakDays}</span>
                  </div>
                )}
              </div>

              <div className="dict-progress-block__kpis">
                <div className="dict-progress-block__kpi">
                  <div className="dict-progress-block__kpi-num">{mySummary?.total ?? 0}</div>
                  <div className="dict-progress-block__kpi-label">всего слов</div>
                </div>
              </div>

              <div className="dict-progress-bar">
                <div
                  className="dict-progress-bar__segment dict-progress-bar__segment--known"
                  style={{ width: `${totalForBar ? (100 * (mySummary?.known ?? 0) / totalForBar) : 0}%` }}
                  title={`Знаю: ${mySummary?.known ?? 0}`}
                />
                <div
                  className="dict-progress-bar__segment dict-progress-bar__segment--learning"
                  style={{ width: `${totalForBar ? (100 * (mySummary?.learning ?? 0) / totalForBar) : 0}%` }}
                  title={`Изучаю: ${mySummary?.learning ?? 0}`}
                />
                <div
                  className="dict-progress-bar__segment dict-progress-bar__segment--forgot"
                  style={{ width: `${totalForBar ? (100 * (mySummary?.hard ?? 0) / totalForBar) : 0}%` }}
                  title={`На повтор: ${mySummary?.hard ?? 0}`}
                />
              </div>

              <div className="dict-progress-block__chips" aria-label="Разбивка по статусам">
                <span className="dict-progress-chip dict-progress-chip--known" title={`Знаю: ${mySummary?.known ?? 0}`}>
                  Знаю · <b>{mySummary?.known ?? 0}</b>
                </span>
                <span className="dict-progress-chip dict-progress-chip--learning" title={`Изучаю: ${mySummary?.learning ?? 0}`}>
                  Изучаю · <b>{mySummary?.learning ?? 0}</b>
                </span>
                <span className="dict-progress-chip dict-progress-chip--repeat" title={`На повтор: ${mySummary?.hard ?? 0}`}>
                  Повтор · <b>{mySummary?.hard ?? 0}</b>
                </span>
              </div>
            </div>
          )}

          {!isLoggedIn && (
            <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>
              Войдите в аккаунт, чтобы пользоваться «Сегодня», «Мои слова» и коллекциями.
            </div>
          )}

          <div className="dict-casual-tabs dict-casual-tabs--inline">
            <button type="button" className={`dictionary-tab ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
              Сегодня
            </button>
            <button type="button" className={`dictionary-tab ${tab === "my" ? "active" : ""}`} onClick={() => setTab("my")}>
              Мои слова
            </button>
            <button type="button" className={`dictionary-tab ${tab === "collections" ? "active" : ""}`} onClick={() => setTab("collections")}>
              Коллекции
            </button>
          </div>

          {tab === "today" && (
            <section className="dict-casual-section">
              {todayError && <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>{todayError}</div>}

              {todaySubView === "home" && (
                <>
                  <div className="dict-hero dict-hero-carousel">
                    {/* Мобильная шапка: для «Новые слова» — огонь с двух сторон; для «Повторение» — иконка повторения с двух сторон */}
                    <div className={`dict-hero-carousel__mobile-header ${heroCarouselSlide === 1 ? "dict-hero-carousel__mobile-header--repeat" : ""}`}>
                      <div className="dict-hero-carousel__mobile-header-inner">
                        {heroCarouselSlide === 0 ? (
                          <span className="dict-hero-carousel__fire" aria-hidden>🔥</span>
                        ) : (
                          <span className="dict-hero-carousel__repeat-emoji" aria-hidden>♻️</span>
                        )}
                        <span className="dict-hero-carousel__slide-title">
                          {heroCarouselSlide === 0 ? "Новые слова" : "Повторение"}
                        </span>
                        {heroCarouselSlide === 0 ? (
                          <span className="dict-hero-carousel__fire" aria-hidden>🔥</span>
                        ) : (
                          <span className="dict-hero-carousel__repeat-emoji" aria-hidden>♻️</span>
                        )}
                      </div>
                    </div>
                    {/* Полоска таймера (мобильная версия): 15 сек, по окончании — переворот */}
                    {isMobile && todayState !== "loading" && (
                      <div className="dict-hero-carousel__timer-wrap">
                        <div
                          key={heroTimerKey}
                          className="dict-hero-carousel__timer-bar"
                          onAnimationEnd={() => {
                            setHeroCarouselSlide((s) => (s === 0 ? 1 : 0));
                            setHeroTimerKey((k) => k + 1);
                          }}
                        />
                      </div>
                    )}
                    {todayState === "loading" && (
                      <div className="dict-hero-carousel__loading">Загрузка…</div>
                    )}
                    {todayState !== "loading" && (
                      <div className="dict-hero-carousel__panel-wrap" key={heroCarouselSlide}>
                        <div className="dict-hero-carousel__panel" role="tabpanel">
                          {heroCarouselSlide === 0 ? (
                            todayNew.length === 0 ? (
                              <p className="dict-hero-carousel__empty">Нет новых слов на сегодня. Загляните завтра или откройте коллекции.</p>
                            ) : (
                              <ul className="dict-hero-words dict-hero-words--new">
                                {todayNew.slice(0, 5).map((it) => (
                                  <li key={it.entryId ?? it.senseId}>
                                    <button
                                      type="button"
                                      className="dict-hero-word"
                                      onClick={() => navigate(`/dictionary/word/${Number(it.senseId)}`)}
                                    >
                                      <span className="dict-hero-word__split">
                                        <span className="dict-hero-word__part dict-hero-word__part--en">
                                          <span className="dict-hero-word__en">{it.en}</span>
                                        </span>
                                        <span className="dict-hero-word__part dict-hero-word__part--ru">
                                          <span className="dict-hero-word__ru">{it.ru ?? "—"}</span>
                                        </span>
                                      </span>
                                      <span className="dict-hero-word__right">
                                        {it.level && <span className={`dict-hero-word__level dict-hero-word__level--${it.level}`}>{it.level}</span>}
                                        <span className="dict-hero-word__chev" aria-hidden>→</span>
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )
                          ) : todayDue.length === 0 ? (
                            <p className="dict-hero-carousel__empty">Нет слов на повтор. Возьмите новые слова или загляните завтра.</p>
                          ) : (
                            <ul className="dict-hero-words dict-hero-words--repeat">
                              {(todayDue.slice(0, 5) as Array<{ senseId?: number; en?: string; ru?: string; level?: string }>).map((it, idx) => (
                                <li key={it.senseId ?? idx}>
                                  <button
                                    type="button"
                                    className="dict-hero-word"
                                    onClick={() => navigate(`/dictionary/word/${Number(it.senseId)}`)}
                                  >
                                    <span className="dict-hero-word__split">
                                      <span className="dict-hero-word__part dict-hero-word__part--en">
                                        <span className="dict-hero-word__en">{it.en ?? ""}</span>
                                      </span>
                                      <span className="dict-hero-word__part dict-hero-word__part--ru">
                                        <span className="dict-hero-word__ru">{it.ru ?? "—"}</span>
                                      </span>
                                    </span>
                                    <span className="dict-hero-word__right">
                                      {it.level && <span className={`dict-hero-word__level dict-hero-word__level--${it.level}`}>{it.level}</span>}
                                      <span className="dict-hero-word__chev" aria-hidden>→</span>
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Блок «Сложное слово дня» — 1 слово из top-2000, зафиксированное на день сервером */}
                  <div className="dict-hero dict-hard-block">
                    <div className="dict-hard-block__header">
                      <div className="dict-hard-block__header-inner">
                        <span className="dict-hard-block__emoji" aria-hidden>⚠️</span>
                        <span className="dict-hard-block__title">Сложное слово</span>
                        <span className="dict-hard-block__emoji" aria-hidden>⚠️</span>
                      </div>
                    </div>
                    <div className="dict-hard-block__panel">
                      {!hardOfDay ? (
                        <div className="dict-hard-block__empty-wrap">
                          <p className="dict-hero-carousel__empty">Сегодня сложное слово не найдено.</p>
                          <p className="dict-hard-block__empty-sub">Проверь позже — подберём из top-2000.</p>
                        </div>
                      ) : (() => {
                        const difficultyType = String(hardOfDay?.difficultyType || "");
                        const reasonClass =
                          difficultyType === "pronunciation"
                            ? "dict-hard-block__reason-chip--pronunciation"
                            : difficultyType === "grammar"
                              ? "dict-hard-block__reason-chip--grammar"
                              : "dict-hard-block__reason-chip--mixed";
                        const reasonIcon =
                          difficultyType === "pronunciation"
                            ? "🔊"
                            : difficultyType === "grammar"
                              ? "🧩"
                              : "⚠️";
                        const reasonText = String(hardOfDay?.difficultyHint || "Сложное слово");
                        const reasonShortText =
                          difficultyType === "pronunciation"
                            ? "Произношение"
                            : difficultyType === "grammar"
                              ? "Грамматика"
                              : "Произн. + грамм.";
                        return (
                          <button
                            type="button"
                            className="dict-hard-word"
                            onClick={() => navigate(`/dictionary/word/${Number(hardOfDay.senseId)}`)}
                          >
                            <div className="dict-hard-word__head">
                              <span className="dict-hard-word__en">{hardOfDay.en ?? ""}</span>
                              {hardOfDay.level && <span className="dict-hard-word__level">{hardOfDay.level}</span>}
                            </div>
                            <div className="dict-hard-word__ru">{hardOfDay.ru ?? "—"}</div>
                            <div className="dict-hard-word__meta">
                              <span className={`dict-hard-block__reason-chip ${reasonClass}`} title={reasonText}>
                                <span aria-hidden>{reasonIcon}</span>
                                <span className="dict-hard-block__reason-text">{reasonShortText}</span>
                              </span>
                              <span className="dict-hard-word__cta">Открыть →</span>
                            </div>
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </>
              )}

              {todaySubView !== "home" && (
                <>
                  <div className="dict-today-toolbar">
                    <button type="button" className="dictionary-tab" onClick={() => setTodaySubView("home")}>
                      Главная
                    </button>
                    <button
                      type="button"
                      className={`dictionary-tab ${todayView === "deck" ? "active" : ""}`}
                      onClick={() => setTodayView("deck")}
                    >
                      Колода
                    </button>
                    <button
                      type="button"
                      className={`dictionary-tab ${todayView === "list" ? "active" : ""}`}
                      onClick={() => setTodayView("list")}
                    >
                      Список
                    </button>
                  </div>

                  {todayView === "deck" && (
                    <>
                      {todayState === "loading" && <div className="dict-empty">Загрузка…</div>}
                      {todayState !== "loading" && deckItems.length === 0 && <div className="dict-empty">На сегодня слов нет. Загляните позже.</div>}
                      {todayState !== "loading" && deckItems.length > 0 && (
                        <WordDeck
                          items={deckItems}
                          activeIndex={deckIndex}
                          onIndexChange={setDeckIndex}
                          onAdd={(item) => {
                            if (item.kind === "due") {
                              learnFromDue(item.senseId);
                            } else {
                              addNewWord({ ...item, entryId: item.entryId });
                            }
                          }}
                          onSkip={() => {}}
                          onDetails={(item) => setDetailsSheet({ open: true, item })}
                          onListen={() => {}}
                          speakEn={speakEn}
                          addLabel={deckItems[deckIndex]?.kind === "new" ? "Добавить" : "Учить"}
                        />
                      )}
                    </>
                  )}

                  {todayView === "list" && (
                <>
                  <div className="dict-casual-section-title">Повторить</div>
                  <div className="dict-grid">
                    {todayDue.map((it) => (
                      <WordCardTile
                        key={it.senseId}
                        item={it}
                        onLearn={() => learnFromDue(Number(it.senseId))}
                        learnLabel="Учить"
                        onDetails={() => navigate(`/dictionary/word/${Number(it.senseId)}`)}
                      />
                    ))}
                  </div>
                  {todayDue.length === 0 && todayState !== "loading" && (
                    <div className="dict-empty">Пока нечего повторять — возьмём новые слова ниже.</div>
                  )}

                  <div className="dict-casual-section-title" style={{ marginTop: 14 }}>
                    Новые
                  </div>
                  <div className="dict-grid">
                    {todayNew.map((it) => (
                      <WordCardTile
                        key={it.entryId}
                        item={it}
                        onLearn={() => addNewWord(it)}
                        learnLabel="Добавить"
                        onDetails={() => navigate(`/dictionary/word/${Number(it.senseId)}`)}
                      />
                    ))}
                  </div>

                  {!todayHasContent && todayState !== "loading" && <div className="dict-empty">Нет данных. Попробуйте позже.</div>}
                  {todayState === "loading" && <div className="dict-empty">Загрузка…</div>}
                </>
                  )}
                </>
              )}
            </section>
          )}

          {tab === "my" && (
            <section className="dict-casual-section">
              {myError && <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>{myError}</div>}

              {/* Desktop: full toolbar; mobile: hidden, use icon bar + sheet instead */}
              <div className="dict-my-toolbar dict-my-toolbar--desktop">
                <input
                  className="search-input"
                  placeholder="Поиск по моим словам…"
                  value={myQ}
                  onChange={(e) => setMyQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") loadMy();
                  }}
                />
                <select value={myStatus} onChange={(e) => setMyStatus(e.target.value as StatusFilter)}>
                  {(["all", "queue", "learning", "known", "hard"] as StatusFilter[]).map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
                <button type="button" className="word-action-btn" onClick={loadMy} disabled={myState === "loading"}>
                  {myState === "loading" ? "…" : "Применить"}
                </button>
              </div>

              {/* Mobile only: floating pill button for search + filters */}
              {isMobile && (
                <button
                  type="button"
                  ref={myWordsPanelOpenButtonRef}
                  className={`dict-my-tools-fab${myToolsFabCompact ? " dict-my-tools-fab--compact" : ""}`}
                  onClick={() => setMyWordsPanelOpen(true)}
                  aria-label="Открыть поиск и фильтры словаря"
                >
                  <svg {...svgProps} width={20} height={20}>
                    <circle cx="9" cy="9" r="5.5" />
                    <path d="m14.5 14.5 4 4" />
                    <path d="M14 3h6" />
                    <path d="M17 3v5" />
                  </svg>
                  <span className="dict-my-tools-fab__label">Поиск и фильтр</span>
                </button>
              )}

              {/* Mobile bottom sheet: search + filter + Apply */}
              {isMobile && myWordsPanelOpen && (
                <div
                  className="dict-my-words-sheet-overlay"
                  role="presentation"
                  onClick={() => setMyWordsPanelOpen(false)}
                />
              )}
              {isMobile && myWordsPanelOpen && (
                <div className="dict-my-words-sheet" role="dialog" aria-label="Поиск и фильтры">
                  <div className="dict-my-words-sheet__handle" aria-hidden />
                  <div className="dict-my-words-sheet__content">
                    <div className="dict-my-toolbar dict-my-toolbar--sheet">
                      <input
                        ref={myWordsSearchInputRef}
                        className="search-input"
                        placeholder="Поиск по моим словам…"
                        value={myQ}
                        onChange={(e) => setMyQ(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            loadMy();
                            setMyWordsPanelOpen(false);
                          }
                        }}
                      />
                      <select value={myStatus} onChange={(e) => setMyStatus(e.target.value as StatusFilter)}>
                        {(["all", "queue", "learning", "known", "hard"] as StatusFilter[]).map((s) => (
                          <option key={s} value={s}>
                            {statusLabel(s)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="word-action-btn"
                        onClick={async () => {
                          await loadMy();
                          setMyWordsPanelOpen(false);
                        }}
                        disabled={myState === "loading"}
                      >
                        {myState === "loading" ? "…" : "Применить"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="dict-my-words-sheet__close word-action-btn"
                      onClick={() => setMyWordsPanelOpen(false)}
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              )}

              <div className="dict-grid">
                {myItems.map((it) => (
                  <div key={`${it.senseId}`} className="dict-card">
                    <div className="dict-card__head">
                      <div className="dict-card__word">{it.en}</div>
                      <div className="dict-card__badges">
                        {it.status && <MiniBadge className={`st st-${it.status}`}>{statusLabel(it.status)}</MiniBadge>}
                        {it.level && <MiniBadge className={`lvl lvl-${it.level}`}>{it.level}</MiniBadge>}
                      </div>
                    </div>
                    <div className="dict-card__ru">{it.ru || "—"}</div>
                    {!!it.example && (
                      <div className="dict-card__example">
                        <div className="dict-card__example-en">{it.example}</div>
                        {!!it.exampleRu && <div className="dict-card__example-ru">{it.exampleRu}</div>}
                      </div>
                    )}
                    <div className="dict-card__actions">
                      <button type="button" className="word-action-btn" onClick={() => navigate(`/dictionary/word/${Number(it.senseId)}`)}>
                        Подробнее
                      </button>
                      <button type="button" className="word-action-btn word-action-remove-personal" onClick={() => setDeleteConfirm({ open: true, senseId: Number(it.senseId), wordLabel: it.en || "Слово" })}>
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {myItems.length === 0 && myState !== "loading" && <div className="dict-empty">Пока пусто. Добавьте слова из «Сегодня».</div>}
              {myState === "loading" && <div className="dict-empty">Загрузка…</div>}
            </section>
          )}

          {tab === "collections" && (
            <section className="dict-casual-section">
              {collectionsError && <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>{collectionsError}</div>}
              <div className="dict-collections">
                {collections.map((c) => (
                  <div key={c.id} className="dict-collection-card">
                    <div className="dict-collection-title">{c.title}</div>
                    <div className="dict-collection-meta">
                      <MiniBadge className="muted">{c.levelFrom === c.levelTo ? c.levelFrom : `${c.levelFrom}–${c.levelTo}`}</MiniBadge>
                      {typeof c.total === "number" && (
                        <span className="dict-collection-stats">
                          {c.total} слов
                          {typeof c.saved === "number" && (
                            <> · {c.saved} добавлено</>
                          )}
                        </span>
                      )}
                    </div>
                    {!!c.description && <div className="dict-collection-desc">{c.description}</div>}
                    <div className="dict-card__actions">
                      <button type="button" className="word-action-btn" onClick={() => openCollection(Number(c.id))}>
                        Открыть
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {collections.length === 0 && collectionsState !== "loading" && <div className="dict-empty">Пока нет коллекций (их можно наполнить позже).</div>}
              {collectionsState === "loading" && <div className="dict-empty">Загрузка…</div>}
            </section>
          )}
          {!!user && startProfileModalOpen && (
            <div className="dict-modal dict-modal--in-card" role="dialog" aria-modal="true">
              <div className="dict-modal__backdrop" />
              <div className="dict-modal__panel">
                <div className="dict-modal__head dict-modal__head--level-pick">
                  <div className="dict-modal__title dict-modal__title--level-pick">Выбери свой путь!</div>
                  {!!startProfile && (
                    <button
                      type="button"
                      className="dict-modal__close"
                      onClick={() => setStartProfileModalOpen(false)}
                      disabled={startProfileSaving}
                      aria-label="Закрыть"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
                <div className="dict-modal__content dict-modal__content--level-pick">
                  <div className="dict-modal__level-options">
                    {START_PROFILE_OPTIONS.map((opt) => {
                      const active = startProfile === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={`dict-modal__level-option word-action-btn${active ? " dict-modal__level-option--active" : ""}`}
                          onClick={() => pickStartProfile(opt.id)}
                          disabled={startProfileSaving}
                        >
                          <span className="dict-modal__level-icon">{opt.icon}</span>
                          <span className="dict-modal__level-text">
                            <span className="dict-modal__level-title">{opt.shortTitle}</span>
                            <span className="dict-modal__level-hint">{opt.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                    <div className="dict-modal__level-option dict-modal__level-option--soon" aria-hidden>
                      <span className="dict-modal__level-icon">
                        <LevelSoonIcon />
                      </span>
                      <span className="dict-modal__level-text">
                        <span className="dict-modal__level-title">Скоро</span>
                        <span className="dict-modal__level-hint">Новая сложность</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!!user && addModeModal.open && addModeModal.item && (
            <div className="dict-modal dict-modal--in-card" role="dialog" aria-modal="true">
              <div className="dict-modal__backdrop" onClick={() => setAddModeModal({ open: false, item: null })} />
              <div className="dict-modal__panel dict-modal__panel--wide">
                <div className="dict-modal__head">
                  <div className="dict-modal__title">Как добавить слово?</div>
                  <button
                    type="button"
                    className="dict-modal__close"
                    onClick={() => setAddModeModal({ open: false, item: null })}
                    aria-label="Закрыть"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="dict-modal__content">
                  <div className="dict-onboard-word">
                    <div className="dict-onboard-word__en">{String(addModeModal.item.en || "")}</div>
                    <div className="dict-onboard-word__ru">{String(addModeModal.item.ru || "")}</div>
                  </div>

                  <div className="dict-choice-grid">
                    <button
                      type="button"
                      className="dict-choice-card"
                      onClick={async () => {
                        const item = addModeModal.item;
                        setAddModeModal({ open: false, item: null });
                        if (addModeRemember) {
                          authService.updateGameSettings({ dictionaryAddMode: "instant" });
                          refresh();
                        }
                        await learnFromNew(Number(item.entryId));
                      }}
                    >
                      <div className="dict-choice-card__row">
                        <span className="dict-choice-card__icon">
                          <svg {...svgProps} width={22} height={22}><path d="M12 2v10" /><path d="M7 7l5 5 5-5" /><path d="M5 22h14" /></svg>
                        </span>
                        <div className="dict-choice-card__title">Добавить сразу</div>
                        <div className="dict-choice-card__time">0–5 сек</div>
                      </div>
                      <div className="dict-choice-card__hint">Слово сразу попадёт в «Учу».</div>
                    </button>

                    <button
                      type="button"
                      className="dict-choice-card"
                      onClick={() => {
                        const item = addModeModal.item;
                        setAddModeModal({ open: false, item: null });
                        if (addModeRemember) {
                          authService.updateGameSettings({ dictionaryAddMode: "onboarding" });
                          refresh();
                        }
                        openOnboarding(item);
                      }}
                    >
                      <div className="dict-choice-card__row">
                        <span className="dict-choice-card__icon">
                          <svg {...svgProps} width={22} height={22}><path d="M12 2l3 6 6 .8-4.4 4.3 1 6-5.6-3-5.6 3 1-6L3 8.8 9 8l3-6z" /></svg>
                        </span>
                        <div className="dict-choice-card__title">Знакомство</div>
                        <div className="dict-choice-card__time">1–2 мин</div>
                      </div>
                      <div className="dict-choice-card__hint">Мини‑игра, чтобы запомнить лучше.</div>
                    </button>
                  </div>

                  <label className="dict-choice-remember">
                    <input
                      type="checkbox"
                      checked={addModeRemember}
                      onChange={(e) => setAddModeRemember(e.target.checked)}
                    />
                    Запомнить мой выбор
                  </label>
                </div>
              </div>
            </div>
          )}

          {!!user && onboarding.open && onboarding.item && (
            <div className="dict-modal dict-modal--in-card" role="dialog" aria-modal="true">
              <div className="dict-modal__backdrop" />
              <div className="dict-modal__panel dict-modal__panel--wide">
                <div className="dict-modal__head">
                  <div className="dict-modal__title">
                    Знакомство <span className="dict-mini-badge muted" style={{ marginLeft: 10 }}>Шаг {onboarding.step + 1}/4</span>
                  </div>
                  <button
                    type="button"
                    className="dict-modal__close"
                    onClick={() => setOnboarding((s) => ({ ...s, open: false, item: null }))}
                    aria-label="Закрыть"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>

                <div className="dict-modal__content dict-onboard">
                  <div className="dict-onboard-word">
                    <div className="dict-onboard-word__en">{String(onboarding.item.en || "")}</div>
                    <div className="dict-onboard-word__ru">{String(onboarding.item.ru || "")}</div>
                  </div>

                  {onboarding.step === 0 && (
                    <div>
                      <div className="dict-onboard__prompt">Выбери перевод</div>
                      <div className="dict-onboard__options">
                        {onboarding.meaningOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            className="dict-onboard__opt word-action-btn"
                            onClick={() => {
                              if (opt.correct) {
                                setOnboarding((s) => ({ ...s, step: 1, meaningWrong: false }));
                              } else {
                                setOnboarding((s) => ({ ...s, meaningWrong: true }));
                              }
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {onboarding.meaningWrong && <div className="dict-onboard__note">Почти! Попробуй ещё раз.</div>}
                    </div>
                  )}

                  {onboarding.step === 1 && (
                    <div>
                      <div className="dict-onboard__prompt">Собери слово</div>
                      <div className="dict-onboard__assembled">
                        {onboarding.picked.map((p) => p.text).join("") || <span style={{ opacity: 0.6 }}>…</span>}
                      </div>
                      <div className="dict-onboard__pieces">
                        {onboarding.pieces.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="dict-onboard__piece"
                            onClick={() => {
                              setOnboarding((s) => ({
                                ...s,
                                pieces: s.pieces.filter((x) => x.id !== p.id),
                                picked: s.picked.concat([p]),
                              }));
                            }}
                          >
                            {p.text}
                          </button>
                        ))}
                      </div>
                      <div className="dict-onboard__row">
                        <button
                          type="button"
                          className="word-action-btn"
                          onClick={() => {
                            setOnboarding((s) => {
                              if (!s.picked.length) return s;
                              const last = s.picked[s.picked.length - 1];
                              return { ...s, picked: s.picked.slice(0, -1), pieces: [last, ...s.pieces] };
                            });
                          }}
                          disabled={!onboarding.picked.length}
                        >
                          Назад
                        </button>
                        <button
                          type="button"
                          className="word-action-btn word-action-add-personal"
                          onClick={() => setOnboarding((s) => ({ ...s, step: 2 }))}
                          disabled={
                            onboarding.picked.map((p) => p.text).join("").toLowerCase() !==
                            String(onboarding.item.en || "").trim().toLowerCase()
                          }
                        >
                          Дальше
                        </button>
                      </div>
                    </div>
                  )}

                  {onboarding.step === 2 && (
                    <div>
                      <div className="dict-onboard__prompt">Послушай произношение</div>
                      <div className="dict-onboard__row">
                        <button
                          type="button"
                          className="word-action-btn"
                          onClick={() => {
                            speakEn(String(onboarding.item.en || ""));
                            // Даже если браузер не поддерживает синтез речи — не блокируем сценарий.
                            setOnboarding((s) => ({ ...s, audioPlayed: true }));
                          }}
                        >
                          Прослушать
                        </button>
                        <button
                          type="button"
                          className="word-action-btn word-action-add-personal"
                          onClick={() => setOnboarding((s) => ({ ...s, step: 3 }))}
                          disabled={!onboarding.audioPlayed}
                        >
                          Дальше
                        </button>
                      </div>
                      {!onboarding.audioPlayed && (
                        <div className="dict-onboard__note">Нажми «Прослушать» один раз, затем продолжай.</div>
                      )}
                    </div>
                  )}

                  {onboarding.step === 3 && (
                    <div>
                      <div className="dict-onboard__prompt">Быстрая проверка</div>
                      <div className="dict-onboard__options">
                        {onboarding.quickOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            className="dict-onboard__opt word-action-btn"
                            onClick={async () => {
                              if (!opt.correct) {
                                setOnboarding((s) => ({ ...s, quickWrong: true }));
                                return;
                              }
                              const entryId = Number(onboarding.item.entryId);
                              await learnFromNew(entryId);
                              setOnboarding((s) => ({ ...s, open: false, item: null }));
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {onboarding.quickWrong && <div className="dict-onboard__note">Почти! Ещё раз.</div>}
                    </div>
                  )}

                  <div className="dict-onboard__footer">
                    <button
                      type="button"
                      className="word-action-btn"
                      onClick={async () => {
                        const entryId = Number(onboarding.item.entryId);
                        await learnFromNew(entryId);
                        setOnboarding((s) => ({ ...s, open: false, item: null }));
                      }}
                    >
                      Пропустить и добавить
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {detailsSheet.open && detailsSheet.item && (
            <>
              <div className="dict-sheet-backdrop" onClick={() => setDetailsSheet({ open: false, item: null })} aria-hidden />
              <div className="dict-sheet" role="dialog" aria-modal="true">
              <div className="dict-sheet__handle" />
              <div className="dict-sheet__head">
                <div className="dict-sheet__word">{detailsSheet.item.en}</div>
                <button type="button" className="dict-modal__close" onClick={() => setDetailsSheet({ open: false, item: null })} aria-label="Закрыть">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="dict-sheet__content">
                <div className="dict-sheet__ru">{detailsSheet.item.ru || "—"}</div>
                {detailsSheet.item.example && (
                  <div className="dict-sheet__example">
                    <div className="dict-sheet__example-en">{detailsSheet.item.example}</div>
                    {detailsSheet.item.exampleRu && <div className="dict-sheet__example-ru">{detailsSheet.item.exampleRu}</div>}
                  </div>
                )}
                <div className="dict-sheet__actions">
                  <button type="button" className="word-action-btn" onClick={() => speakEn(detailsSheet.item!.en)}>
                    Слушать
                  </button>
                  {detailsSheet.item.kind === "due" ? (
                    <button
                      type="button"
                      className="word-action-btn word-action-add-personal"
                      onClick={async () => {
                        learnFromDue(detailsSheet.item!.senseId);
                        setDetailsSheet({ open: false, item: null });
                      }}
                    >
                      Учить
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="word-action-btn word-action-add-personal"
                      onClick={() => {
                        const it = detailsSheet.item!;
                        if (it.kind === "new") addNewWord({ ...it, entryId: it.entryId });
                        setDetailsSheet({ open: false, item: null });
                      }}
                    >
                      Добавить
                    </button>
                  )}
                  <button
                    type="button"
                    className="word-action-btn"
                    onClick={() => {
                      navigate(`/dictionary/word/${detailsSheet.item!.senseId}`);
                      setDetailsSheet({ open: false, item: null });
                    }}
                  >
                    Страница слова
                  </button>
                </div>
              </div>
            </div>
            </>
          )}

        </div>

        {collectionOpen && (
          <div className="dict-modal" role="dialog" aria-modal="true">
            <div className="dict-modal__backdrop" onClick={closeCollection} />
            <div className="dict-modal__panel">
              <div className="dict-modal__head">
                <div className="dict-modal__title">{collection?.title || "Коллекция"}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="word-action-btn word-action-add-personal" onClick={addAllCollection} disabled={collectionState === "loading"}>
                    Добавить всё
                  </button>
                  <button type="button" className="word-action-btn" onClick={closeCollection}>
                    Закрыть
                  </button>
                </div>
              </div>
              {collectionError && <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>{collectionError}</div>}
              {collectionState === "loading" && <div className="dict-empty">Загрузка…</div>}
              {collection && (
                <div className="dict-modal__content">
                  {!!collection.description && <div className="dict-modal__ru">{collection.description}</div>}
                  <div className="dict-grid" style={{ marginTop: 10 }}>
                    {collectionItems.map((it) => (
                      <div key={it.senseId} className="dict-card">
                        <div className="dict-card__head">
                          <div className="dict-card__word">{it.en}</div>
                          <div className="dict-card__badges">
                            {it.level && <MiniBadge className={`lvl lvl-${it.level}`}>{it.level}</MiniBadge>}
                            {it.isSaved && <MiniBadge className="st">В моём</MiniBadge>}
                          </div>
                        </div>
                        <div className="dict-card__ru">{it.ru || "—"}</div>
                        {!!it.example && (
                          <div className="dict-card__example">
                            <div className="dict-card__example-en">{it.example}</div>
                            {!!it.exampleRu && <div className="dict-card__example-ru">{it.exampleRu}</div>}
                          </div>
                        )}
                        <div className="dict-card__actions">
                          {!it.isSaved ? (
                            <button type="button" className="word-action-btn word-action-add-personal" onClick={() => addOneFromCollection(Number(it.senseId))}>
                              Учить
                            </button>
                          ) : (
                            <button type="button" className="word-action-btn" disabled>
                              Уже добавлено
                            </button>
                          )}
                          <button type="button" className="word-action-btn" onClick={() => navigate(`/dictionary/word/${Number(it.senseId)}`)}>
                            Подробнее
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {collectionItems.length === 0 && <div className="dict-empty">Пусто.</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {deleteConfirm.open && deleteConfirm.senseId !== null && (
        <div className="dict-modal dict-modal--confirm" role="dialog" aria-modal="true" aria-labelledby="dict-delete-confirm-title">
          <div className="dict-modal__backdrop" onClick={() => setDeleteConfirm({ open: false, senseId: null, wordLabel: "" })} />
          <div className="dict-modal__panel dict-modal__panel--confirm">
            <div className="dict-modal__head dict-modal__head--confirm">
              <div className="dict-modal__confirm-hero">
                <span className="dict-modal__confirm-icon" aria-hidden>!</span>
                <div className="dict-modal__confirm-heading">
                  <h2 id="dict-delete-confirm-title" className="dict-modal__title dict-modal__title--confirm">Удалить слово?</h2>
                  <p className="dict-modal__confirm-subtitle">Действие нельзя отменить</p>
                </div>
              </div>
            </div>
            <div className="dict-modal__content dict-modal__content--confirm">
              <p className="dict-modal__confirm-text">
                Слово «{deleteConfirm.wordLabel}» будет удалено из списка «Мои слова». Продолжить?
              </p>
              <div className="dict-modal__confirm-actions">
                <button
                  type="button"
                  className="word-action-btn dict-modal__confirm-cancel"
                  onClick={() => setDeleteConfirm({ open: false, senseId: null, wordLabel: "" })}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="word-action-btn word-action-remove-personal dict-modal__confirm-remove"
                  onClick={async () => {
                    if (deleteConfirm.senseId !== null) {
                      await removeFromMySense(deleteConfirm.senseId);
                      setDeleteConfirm({ open: false, senseId: null, wordLabel: "" });
                    }
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <nav className="dict-casual-bottom-tabs" aria-label="Разделы словаря">
        <button type="button" className={`dictionary-tab dictionary-tab--side ${tab === "collections" ? "active" : ""}`} onClick={() => setTab("collections")}>
          <DictTabLabel text="Коллекции" />
        </button>
        <button type="button" className={`dictionary-tab dictionary-tab--center ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
          <DictTabLabel text="Сегодня" />
        </button>
        <button type="button" className={`dictionary-tab dictionary-tab--side ${tab === "my" ? "active" : ""}`} onClick={() => setTab("my")}>
          <DictTabLabel text="Мои слова" />
        </button>
      </nav>

      <footer className="footer">STroova</footer>
    </div>
  );
};

export default DictionaryCasualPage;

