import React, { useEffect, useMemo, useState } from "react";
import Header from "../components/common/Header";
import { useAuth } from "../features/auth/AuthContext";
import { userDictionaryApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import { useNavigate } from "react-router-dom";
import { authService } from "../services/authService";

type LoadState = "idle" | "loading" | "error";
type Tab = "today" | "my" | "collections";
type StatusFilter = "all" | "queue" | "learning" | "known" | "hard";

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
          <button type="button" className="word-action-btn" onClick={onRemove}>
            Удалить
          </button>
        )}
      </div>
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
  const [currentCollection, setCurrentCollection] = useState<any | null>(null);

  const [myState, setMyState] = useState<LoadState>("idle");
  const [myError, setMyError] = useState<string | null>(null);
  const [myQ, setMyQ] = useState("");
  const [myStatus, setMyStatus] = useState<StatusFilter>("all");
  const [myItems, setMyItems] = useState<any[]>([]);
  const [myTotal, setMyTotal] = useState(0);

  const [collectionsState, setCollectionsState] = useState<LoadState>("idle");
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [collections, setCollections] = useState<any[]>([]);

  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionState, setCollectionState] = useState<LoadState>("idle");
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [collection, setCollection] = useState<any | null>(null);
  const [collectionItems, setCollectionItems] = useState<any[]>([]);

  const isLoggedIn = !!user;

  const loadToday = async () => {
    if (!isLoggedIn) return;
    setTodayState("loading");
    setTodayError(null);
    try {
      const out = await userDictionaryApi.today({ lang });
      setTodayDue(Array.isArray(out?.due) ? out.due : []);
      setTodayNew(Array.isArray(out?.new) ? out.new : []);
      setCurrentCollection(out?.currentCollection ?? null);
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

  const todayHasContent = todayDue.length > 0 || todayNew.length > 0;
  const mySummary = useMemo(() => {
    if (!myItems.length) return null;
    const known = myItems.filter((x) => x.status === "known").length;
    const learning = myItems.filter((x) => x.status === "learning").length;
    return { known, learning, total: myTotal || myItems.length };
  }, [myItems, myTotal]);

  return (
    <div className="app-shell dict-casual-page">
      <Header />
      <main className="main">
        <div className="page-card">
          <div className="dict-casual-head">
            <h1 className="dictionary-title">Словарь</h1>
            <p className="dictionary-subtitle">
              Казуальный режим: учите слова <b>по смыслу + по примеру</b>, открывайте связки и формы, собирайте темы.
            </p>
          </div>

          {!isLoggedIn && (
            <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>
              Войдите в аккаунт, чтобы пользоваться «Сегодня», «Мои слова» и коллекциями.
            </div>
          )}

          {!!user && (
            <div className="dict-mode-switch" style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
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
                  navigate("/dictionary/advanced");
                }}
              >
                Продвинуто
              </button>
            </div>
          )}

          {currentCollection?.collection && (
            <div className="dict-my-summary" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <b>Текущая коллекция:</b> {currentCollection.collection.title}
                  {currentCollection.progress && (
                    <span className="dict-mini-badge muted" style={{ marginLeft: 10 }}>
                      {currentCollection.progress.saved}/{currentCollection.progress.total} добавлено • {currentCollection.progress.known}/{currentCollection.progress.total} знаю
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="word-action-btn"
                  onClick={() => {
                    setTab("collections");
                    if (currentCollection.collection?.id) void openCollection(Number(currentCollection.collection.id));
                  }}
                >
                  Открыть
                </button>
              </div>
            </div>
          )}

          <div className="dict-casual-tabs">
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
                    onLearn={() => learnFromNew(Number(it.entryId))}
                    learnLabel="Учить"
                    onDetails={() => navigate(`/dictionary/word/${Number(it.senseId)}`)}
                  />
                ))}
              </div>

              {!todayHasContent && todayState !== "loading" && <div className="dict-empty">Нет данных. Попробуйте позже.</div>}
              {todayState === "loading" && <div className="dict-empty">Загрузка…</div>}
            </section>
          )}

          {tab === "my" && (
            <section className="dict-casual-section">
              {myError && <div className="dictionary-error-banner" style={{ padding: "10px 12px" }}>{myError}</div>}

              <div className="dict-my-toolbar">
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

              {mySummary && (
                <div className="dict-my-summary">
                  Всего: <b>{mySummary.total}</b> • Знаю: <b>{mySummary.known}</b> • Учу: <b>{mySummary.learning}</b>
                </div>
              )}

              <div className="dict-grid">
                {myItems.map((it) => (
                  <div key={`${it.senseId}`} className="dict-card">
                    <div className="dict-card__head">
                      <div className="dict-card__word">{it.en}</div>
                      <div className="dict-card__badges">
                        {it.level && <MiniBadge className={`lvl lvl-${it.level}`}>{it.level}</MiniBadge>}
                        {it.status && <MiniBadge className={`st st-${it.status}`}>{statusLabel(it.status)}</MiniBadge>}
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
                      <button type="button" className="word-action-btn" onClick={() => removeFromMySense(Number(it.senseId))}>
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
                      <MiniBadge className="muted">{c.levelFrom}–{c.levelTo}</MiniBadge>
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
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default DictionaryCasualPage;

