import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/common/Header";
import { useAuth } from "../features/auth/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { userDictionaryApi } from "../api/endpoints";
import { ApiError } from "../api/client";

type LoadState = "idle" | "loading" | "error";
type AllWordsItemType = "entry" | "form" | "form_card" | "collocation" | "pattern";
type AllWordsItem = {
  id: number;
  itemType: AllWordsItemType;
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

const PAGE_SIZE = 50;

const MiniBadge: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span className={className ? `dict-mini-badge ${className}`.trim() : "dict-mini-badge"}>{children}</span>
);

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

function allWordsItemTypeLabel(t: AllWordsItemType): string {
  if (t === "entry") return "Слово";
  if (t === "form") return "Форма";
  if (t === "form_card") return "Карточка формы";
  if (t === "collocation") return "Фраза";
  return "Паттерн";
}

const svgProps = { viewBox: "0 0 24 24" as const, fill: "none" as const, stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const DictionaryAllWordsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const isLoggedIn = !!user;
  const lang = "en";

  const [items, setItems] = useState<AllWordsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [hideSaved, setHideSaved] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const SCROLL_THRESHOLD = 400;

  const displayedItems = items.filter((it) => !hideSaved || !it.isSaved);

  useEffect(() => {
    const onScroll = () => setShowScrollToTop(window.scrollY > SCROLL_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const loadInitial = useCallback(
    (search: string) => {
      if (!isLoggedIn) return;
      setState("loading");
      setError(null);
      userDictionaryApi
        .allWords({ lang, offset: 0, limit: PAGE_SIZE, q: search || undefined })
        .then((out) => {
          setItems(Array.isArray(out?.items) ? out.items : []);
          setTotal(typeof out?.total === "number" ? out.total : 0);
          setState("idle");
        })
        .catch((e) => {
          setState("error");
          setError(formatApiError(e, "Не удалось загрузить список слов"));
        });
    },
    [isLoggedIn, lang]
  );

  const loadMore = useCallback(() => {
    if (!isLoggedIn || state === "loading" || items.length >= total) return;
    setState("loading");
    setError(null);
    const nextOffset = items.length;
    userDictionaryApi
      .allWords({ lang, offset: nextOffset, limit: PAGE_SIZE, q: q || undefined })
      .then((out) => {
        const nextItems = Array.isArray(out?.items) ? out.items : [];
        setItems((prev) => [...prev, ...nextItems]);
        setTotal(typeof out?.total === "number" ? out.total : total);
        setState("idle");
      })
      .catch((e) => {
        setState("idle");
        setError(formatApiError(e, "Не удалось загрузить ещё"));
      });
  }, [isLoggedIn, lang, state, items.length, total, q]);

  useEffect(() => {
    if (!isLoggedIn) return;
    loadInitial(q);
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isMobile) return;
    if (searchPanelOpen) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 100);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setSearchPanelOpen(false);
      };
      document.addEventListener("keydown", onKey);
      return () => {
        clearTimeout(t);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [isMobile, searchPanelOpen]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || total === 0 || items.length >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && state !== "loading" && items.length < total) loadMore();
      },
      { rootMargin: "200px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [state, items.length, total, loadMore]);

  const onSearch = () => loadInitial(q);

  const scrollToTop = () => {
    const start = window.scrollY;
    const startTime = performance.now();
    const duration = 320;
    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      window.scrollTo(0, start * (1 - easeOutCubic(progress)));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const openDetails = (item: AllWordsItem) => {
    if (item.itemType === "form_card") {
      navigate(`/dictionary/form/${Number(item.itemId)}`);
      return;
    }
    if (item.senseId) navigate(`/dictionary/word/${Number(item.senseId)}`);
  };

  const addOne = async (item: AllWordsItem) => {
    if (!isLoggedIn) return;
    try {
      if (item.itemType === "collocation" || item.itemType === "pattern" || item.itemType === "form_card") {
        await userDictionaryApi.addPhrase({ itemType: item.itemType, itemId: Number(item.itemId) });
        await userDictionaryApi.setPhraseStatus({ itemType: item.itemType, itemId: Number(item.itemId), status: "learning" });
        setItems((prev) =>
          prev.map((it) =>
            it.itemType === item.itemType && Number(it.itemId) === Number(item.itemId) ? { ...it, isSaved: true } : it
          )
        );
      } else if (item.itemType === "entry") {
        const entryId = item.entryId != null ? Number(item.entryId) : null;
        const senseId = item.senseId != null ? Number(item.senseId) : null;
        if (entryId != null) await userDictionaryApi.add({ lang, entryId });
        else if (senseId != null) await userDictionaryApi.addSense({ senseId });
        else throw new Error("Нет entryId или senseId для добавления");
        if (senseId) await userDictionaryApi.setStatus({ senseId, status: "learning" });
        setItems((prev) =>
          prev.map((it) =>
            it.itemType === item.itemType && Number(it.itemId) === Number(item.itemId) ? { ...it, isSaved: true } : it
          )
        );
      } else {
        const senseId = Number(item.senseId || 0);
        if (!senseId) throw new Error("Для выбранной сущности не найден senseId");
        await userDictionaryApi.addSense({ senseId });
        await userDictionaryApi.setStatus({ senseId, status: "learning" });
        setItems((prev) =>
          prev.map((it) =>
            it.itemType === item.itemType && Number(it.itemId) === Number(item.itemId) ? { ...it, isSaved: true } : it
          )
        );
      }
    } catch (e) {
      setError(formatApiError(e, "Не удалось добавить слово"));
    }
  };

  if (!isLoggedIn) {
    return (
      <div className={`app-shell dict-casual-page ${isMobile ? "app-shell--dictionary-mobile" : ""}`}>
        <Header />
        <main className="main main--top">
          <div className="dict-collection-page-content">
            <div className="dict-empty">Войдите, чтобы открыть «Все слова».</div>
            <button type="button" className="word-action-btn" onClick={() => navigate("/dictionary")}>
              К словарю
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`app-shell dict-casual-page ${isMobile ? "app-shell--dictionary-mobile" : ""}`}>
      <Header />
      <main className="main main--top">
        <div className="dict-collection-page-content">
          <div style={{ marginBottom: 12 }}>
            <button type="button" className="word-action-btn" onClick={() => navigate("/dictionary", { state: { tab: "collections" } })}>
              ← К коллекциям
            </button>
            <h1 className="dict-modal__title" style={{ marginTop: 8 }}>Все слова</h1>
          </div>
          {error && <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>{error}</div>}
          {!isMobile && (
            <div className="dict-all-words-toolbar">
              <input
                className="search-input"
                placeholder="Поиск по слову или переводу…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
              />
              <button type="button" className="word-action-btn" onClick={onSearch} disabled={state === "loading"}>
                Найти
              </button>
            </div>
          )}
          {isMobile && !showScrollToTop && (
            <button
              type="button"
              className="dict-my-tools-fab dict-my-tools-fab--compact dict-collections-tools-fab"
              onClick={() => setSearchPanelOpen(true)}
              aria-label="Открыть поиск и фильтры"
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
          {isMobile && searchPanelOpen && (
            <div
              className="dict-my-words-sheet-overlay"
              role="presentation"
              onClick={() => setSearchPanelOpen(false)}
            />
          )}
          {isMobile && searchPanelOpen && (
            <div className="dict-my-words-sheet" role="dialog" aria-label="Поиск и фильтры">
              <div className="dict-my-words-sheet__handle" aria-hidden />
              <div className="dict-my-words-sheet__content">
                <div className="dict-my-toolbar dict-my-toolbar--sheet">
                  <input
                    ref={searchInputRef}
                    className="search-input"
                    placeholder="Поиск по слову или переводу…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (onSearch(), setSearchPanelOpen(false))}
                  />
                  <button type="button" className="word-action-btn" onClick={() => (onSearch(), setSearchPanelOpen(false))} disabled={state === "loading"}>
                    Найти
                  </button>
                </div>
                <label className="dict-collection-filter-checkbox">
                  <input type="checkbox" checked={hideSaved} onChange={(e) => setHideSaved(e.target.checked)} />
                  <span>Скрыть уже добавленные в словарь</span>
                </label>
                <button type="button" className="dict-my-words-sheet__close word-action-btn" onClick={() => setSearchPanelOpen(false)}>
                  Закрыть
                </button>
              </div>
            </div>
          )}
          {state === "loading" && !items.length && <div className="dict-empty">Загрузка…</div>}
          <div className="dict-grid" style={{ marginTop: 10 }}>
            {displayedItems.map((it) => (
                  <div key={`${it.itemType}-${it.itemId}`} className="dict-card">
                    <div className="dict-card__head">
                      <div className="dict-card__word">{it.en}</div>
                      <div className="dict-card__badges">
                        {it.level && <MiniBadge className={`lvl lvl-${it.level}`}>{it.level}</MiniBadge>}
                        <MiniBadge className="muted">{allWordsItemTypeLabel(it.itemType)}</MiniBadge>
                      </div>
                    </div>
                    <div className="dict-card__ru">{it.ru || "—"}</div>
                    <div className="dict-card__example">
                      {it.example ? (
                        <>
                          <div className="dict-card__example-en">{it.example}</div>
                          {!!it.exampleRu && <div className="dict-card__example-ru">{it.exampleRu}</div>}
                        </>
                      ) : (
                        <div className="dict-card__example-en dict-card__example--placeholder">Пример пока не готов</div>
                      )}
                    </div>
                    <div className="dict-card__actions">
                      {!it.isSaved ? (
                        <button type="button" className="word-action-btn word-action-add-personal" onClick={() => addOne(it)}>
                          {it.itemType === "collocation" || it.itemType === "pattern" ? "Добавить в мои фразы" : "Добавить в мои слова"}
                        </button>
                      ) : (
                        <button type="button" className="word-action-btn" disabled>
                          Уже добавлено
                        </button>
                      )}
                      <button
                        type="button"
                        className="word-action-btn"
                        onClick={() => openDetails(it)}
                        disabled={!it.senseId && it.itemType !== "form_card"}
                      >
                        Подробнее
                      </button>
                    </div>
                  </div>
                ))}
          </div>
          {displayedItems.length === 0 && state !== "loading" && (
            <div className="dict-empty">{items.length === 0 ? "Слов не найдено." : "Нет слов, которые ещё не добавлены."}</div>
          )}
          {items.length > 0 && items.length < total && (
            <div ref={loadMoreSentinelRef} className="dict-all-words-sentinel" style={{ minHeight: 24, padding: 12 }}>
              {state === "loading" && <div className="dict-empty">Загрузка…</div>}
            </div>
          )}
          {showScrollToTop && (
            <button
              type="button"
              className="dict-scroll-to-top"
              onClick={scrollToTop}
              aria-label="В начало страницы"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 15l-6-6-6 6" />
              </svg>
            </button>
          )}
        </div>
      </main>
    </div>
  );
};

export default DictionaryAllWordsPage;
