import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Header from "../components/common/Header";
import { useAuth } from "../features/auth/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { userDictionaryApi } from "../api/endpoints";
import { ApiError } from "../api/client";

type LoadState = "idle" | "loading" | "error";

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

const svgProps = { viewBox: "0 0 24 24" as const, fill: "none" as const, stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const DictionaryCollectionPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const isLoggedIn = !!user;
  const lang = "en";

  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [hideSaved, setHideSaved] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const SCROLL_THRESHOLD = 400;

  useEffect(() => {
    const onScroll = () => setShowScrollToTop(window.scrollY > SCROLL_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const filteredItems = items
    .filter(
      (it) =>
        !searchQ.trim() ||
        String(it.en || "").toLowerCase().includes(searchQ.trim().toLowerCase()) ||
        String(it.ru || "").toLowerCase().includes(searchQ.trim().toLowerCase())
    )
    .filter((it) => !hideSaved || !it.isSaved);

  useEffect(() => {
    if (!isLoggedIn || !id) return;
    const numId = Number(id);
    if (!Number.isFinite(numId) || numId <= 0) return;
    setState("loading");
    setError(null);
    setCollection(null);
    setItems([]);
    userDictionaryApi
      .getCollection({ lang, id: numId })
      .then((out) => {
        setCollection(out.collection);
        setItems(Array.isArray(out.items) ? out.items : []);
        setState("idle");
      })
      .catch((e) => {
        setState("error");
        setError(formatApiError(e, "Не удалось открыть коллекцию"));
      });
  }, [isLoggedIn, id, lang]);

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

  const addAll = async () => {
    if (!isLoggedIn || !collection?.id) return;
    setState("loading");
    setError(null);
    try {
      await userDictionaryApi.addAllFromCollection({ lang, collectionId: Number(collection.id) });
      const out = await userDictionaryApi.getCollection({ lang, id: Number(collection.id) });
      setCollection(out.collection);
      setItems(Array.isArray(out.items) ? out.items : []);
      setState("idle");
    } catch (e) {
      setState("error");
      setError(formatApiError(e, "Не удалось добавить слова из коллекции"));
    }
  };

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

  const addOne = async (senseId: number) => {
    if (!isLoggedIn) return;
    try {
      await userDictionaryApi.addSense({ senseId });
      await userDictionaryApi.setStatus({ senseId, status: "learning" });
      setItems((prev) =>
        prev.map((x) =>
          Number(x.senseId) === Number(senseId) ? { ...x, isSaved: true, status: "learning" } : x
        )
      );
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
            <div className="dict-empty">Войдите, чтобы открывать коллекции.</div>
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
          <div className="dict-modal__head" style={{ marginBottom: 12 }}>
            <button type="button" className="word-action-btn" onClick={() => navigate("/dictionary", { state: { tab: "collections" } })}>
              ← К коллекциям
            </button>
            <h1 className="dict-modal__title" style={{ marginTop: 8 }}>{collection?.title || "Коллекция"}</h1>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" className="word-action-btn word-action-add-personal" onClick={addAll} disabled={state === "loading"}>
                Добавить всё
              </button>
            </div>
          </div>
          {error && <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>{error}</div>}
          {state === "loading" && !collection && <div className="dict-empty">Загрузка…</div>}
          {collection && (
            <div className="dict-modal__content">
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
                <div className="dict-my-words-sheet" role="dialog" aria-label="Поиск по словам в коллекции">
                  <div className="dict-my-words-sheet__handle" aria-hidden />
                  <div className="dict-my-words-sheet__content">
                    <div className="dict-my-toolbar dict-my-toolbar--sheet">
                      <input
                        ref={searchInputRef}
                        className="search-input"
                        placeholder="Поиск по слову или переводу…"
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && setSearchPanelOpen(false)}
                      />
                    </div>
                    <label className="dict-collection-filter-checkbox">
                      <input
                        type="checkbox"
                        checked={hideSaved}
                        onChange={(e) => setHideSaved(e.target.checked)}
                      />
                      <span>Скрыть уже добавленные в словарь</span>
                    </label>
                    <button
                      type="button"
                      className="dict-my-words-sheet__close word-action-btn"
                      onClick={() => setSearchPanelOpen(false)}
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              )}
              {!!collection.description && <div className="dict-modal__ru">{collection.description}</div>}
              <div className="dict-grid" style={{ marginTop: 10 }}>
                {filteredItems.map((it) => (
                  <div key={it.senseId} className="dict-card">
                    <div className="dict-card__head">
                      <div className="dict-card__word">{it.en}</div>
                      <div className="dict-card__badges">
                        {it.level && <MiniBadge className={`lvl lvl-${it.level}`}>{it.level}</MiniBadge>}
                        <MiniBadge className="muted">Слово</MiniBadge>
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
                        <button type="button" className="word-action-btn word-action-add-personal" onClick={() => addOne(Number(it.senseId))}>
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
              {filteredItems.length === 0 && <div className="dict-empty">{searchQ.trim() ? "Ничего не найдено." : "Пусто."}</div>}
            </div>
          )}
          {isMobile && showScrollToTop && (
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

export default DictionaryCollectionPage;
