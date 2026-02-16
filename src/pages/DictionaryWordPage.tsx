import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Header from "../components/common/Header";
import { dictionaryApi, userDictionaryApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import { useAuth } from "../features/auth/AuthContext";
import { speakWord } from "../utils/sounds";
import { useIsMobile } from "../hooks/useIsMobile";

type LoadState = "idle" | "loading" | "error";

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

function normalizeToken(raw: string): string {
  return raw.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "").toLowerCase();
}

function splitTextToTokens(text: string): Array<{ kind: "word" | "sep"; value: string }> {
  const out: Array<{ kind: "word" | "sep"; value: string }> = [];
  const s = String(text || "");
  if (!s) return out;
  // split by spaces but keep punctuation with separators
  const parts = s.split(/(\s+)/);
  for (const p of parts) {
    if (!p) continue;
    if (/^\s+$/.test(p)) out.push({ kind: "sep", value: p });
    else out.push({ kind: "word", value: p });
  }
  return out;
}

function formatFormTypeLabel(type: string): string {
  const key = String(type || "").trim().toLowerCase();
  const labels: Record<string, string> = {
    ing: "Форма -ing",
    past: "Past",
    past_participle: "Past Participle",
    third_person_singular: "3rd person singular",
    plural: "Plural",
    comparative: "Comparative",
    superlative: "Superlative",
    other: "Другая форма",
  };
  return labels[key] || key || "Другая форма";
}

const Chip: React.FC<{ children: React.ReactNode; onClick?: () => void; title?: string; variant?: "default" | "link" }> = ({
  children,
  onClick,
  title,
  variant = "default",
}) => {
  if (onClick) {
    return (
      <button type="button" className={`dict-chip dict-chip--btn dict-chip--${variant}`} onClick={onClick} title={title}>
        {children}
      </button>
    );
  }
  return (
    <span className="dict-chip" title={title}>
      {children}
    </span>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="dict-adv-section">
    <h2 className="dict-adv-section__title">{title}</h2>
    <div className="dict-adv-section__body">{children}</div>
  </section>
);

const DictionaryWordPage: React.FC = () => {
  const { senseId: senseIdParam } = useParams();
  const senseId = Number(senseIdParam);
  const lang = "en";
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const trailParam = searchParams.get("trail") || "";
  const fromFormParam = searchParams.get("fromForm") || "";

  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<any | null>(null);

  const [senseState, setSenseState] = useState<{ isSaved: boolean; status: string | null } | null>(null);
  const [senseStateError, setSenseStateError] = useState<string | null>(null);
  const [phraseStates, setPhraseStates] = useState<Record<string, { isSaved: boolean; status: string | null }>>({});
  const [backFabCompact, setBackFabCompact] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [formPickError, setFormPickError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const isLoggedIn = !!user;

  useEffect(() => {
    if (!isMobile) {
      setBackFabCompact(false);
      return;
    }
    const onScroll = () => setBackFabCompact(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isMobile]);

  const trail = useMemo(() => {
    const items = trailParam
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const [label, id] = x.split(":");
        return { label: decodeURIComponent(label || ""), senseId: Number(id) };
      })
      .filter((x) => x.label && Number.isFinite(x.senseId) && x.senseId > 0);
    return items;
  }, [trailParam]);

  const pushTrail = (label: string, nextSenseId: number, fromForm?: string) => {
    const base = [...trail, { label, senseId: nextSenseId }];
    const compact = base.slice(-8); // avoid huge URL
    const next = compact.map((x) => `${encodeURIComponent(x.label)}:${x.senseId}`).join(",");
    const qp = new URLSearchParams();
    qp.set("trail", next);
    if (fromForm) qp.set("fromForm", fromForm);
    navigate(`/dictionary/word/${nextSenseId}?${qp.toString()}`);
  };

  const load = async () => {
    if (!Number.isFinite(senseId) || senseId <= 0) {
      setError("Некорректный senseId");
      return;
    }
    setState("loading");
    setError(null);
    setCard(null);
    try {
      const out = await dictionaryApi.getCardBySense({ lang, senseId });
      setCard(out);
      setState("idle");
    } catch (e) {
      setState("error");
      setError(formatApiError(e, "Не удалось загрузить слово"));
    }
  };

  const loadSenseState = async () => {
    if (!isLoggedIn) {
      setSenseState(null);
      return;
    }
    setSenseStateError(null);
    try {
      const out = await userDictionaryApi.getSenseState({ senseId });
      setSenseState(out);
    } catch (e) {
      setSenseStateError(formatApiError(e, "Не удалось загрузить состояние слова"));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senseIdParam]);

  useEffect(() => {
    void loadSenseState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senseIdParam, isLoggedIn]);

  const onLearn = async () => {
    if (!isLoggedIn) {
      setSenseStateError("Войдите, чтобы добавлять слова в личный словарь.");
      return;
    }
    try {
      if (!senseState?.isSaved) {
        await userDictionaryApi.addSense({ senseId });
      }
      await userDictionaryApi.setStatus({ senseId, status: "learning" });
      await loadSenseState();
      refresh();
    } catch (e) {
      setSenseStateError(formatApiError(e, "Не удалось добавить слово"));
    }
  };

  const onRemove = async (): Promise<boolean> => {
    if (!isLoggedIn) return false;
    try {
      await userDictionaryApi.removeSense({ senseId });
      await loadSenseState();
      refresh();
      return true;
    } catch (e) {
      setSenseStateError(formatApiError(e, "Не удалось удалить слово"));
      return false;
    }
  };

  const goByLookup = async (rawToken: string) => {
    const term = normalizeToken(rawToken);
    if (!term) return;
    try {
      const { items } = await dictionaryApi.lookup({ lang, term, limit: 5 });
      const first = items?.[0];
      const nextId = Number(first?.senseId);
      if (Number.isFinite(nextId) && nextId > 0) {
        pushTrail(first?.lemma || term, nextId);
      }
    } catch {
      // ignore lookup errors for now
    }
  };

  const onFormClick = async (form: string) => {
    const term = String(form || "").trim();
    if (!term) return;
    setFormPickError(null);
    try {
      const out = await dictionaryApi.getFormCard({ lang, senseId, form: term });
      if (out?.card) {
        const qp = new URLSearchParams();
        qp.set("fromSenseId", String(senseId));
        qp.set("fromForm", term);
        navigate(`/dictionary/form/${out.card.id}?${qp.toString()}`);
        return;
      }
      setFormPickError("Карточка формы пока не заполнена.");
    } catch (e) {
      setFormPickError(formatApiError(e, "Не удалось открыть карточку формы"));
    }
  };

  const entry = card?.entry;
  const senses = Array.isArray(card?.senses) ? card.senses : [];
  const forms = Array.isArray(card?.forms) ? card.forms : [];
  const links = Array.isArray(card?.links) ? card.links : [];
  const collocations = Array.isArray(card?.collocations) ? card.collocations : [];
  const patterns = Array.isArray(card?.patterns) ? card.patterns : [];
  const phraseKey = (itemType: "collocation" | "pattern", itemId: number) => `${itemType}:${itemId}`;

  const currentSense = senses.find((s: any) => Number(s.id) === senseId) || senses[0] || null;
  const mainExample = currentSense?.examples?.find?.((e: any) => e.isMain) || currentSense?.examples?.[0] || null;

  const linksGrouped = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const l of links) {
      const type = String(l.type || "related");
      const arr = m.get(type) || [];
      arr.push(l);
      m.set(type, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [links]);

  useEffect(() => {
    if (!isLoggedIn || !card) {
      setPhraseStates({});
      return;
    }
    const loadPhraseStates = async () => {
      const coll = collocations
        .map((c: any) => ({ itemType: "collocation" as const, itemId: Number(c.id) }))
        .filter((x) => Number.isFinite(x.itemId) && x.itemId > 0);
      const pats = patterns
        .map((p: any) => ({ itemType: "pattern" as const, itemId: Number(p.id) }))
        .filter((x) => Number.isFinite(x.itemId) && x.itemId > 0);
      const all = [...coll, ...pats];
      if (all.length === 0) {
        setPhraseStates({});
        return;
      }
      try {
        const entries = await Promise.all(
          all.map(async (x) => {
            const state = await userDictionaryApi.getPhraseState({ itemType: x.itemType, itemId: x.itemId });
            return [phraseKey(x.itemType, x.itemId), state] as const;
          })
        );
        setPhraseStates(Object.fromEntries(entries));
      } catch {
        // keep page usable even if phrase states fail
      }
    };
    void loadPhraseStates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, isLoggedIn]);

  const setPhraseStateLocal = (itemType: "collocation" | "pattern", itemId: number, next: { isSaved: boolean; status: string | null }) => {
    const key = phraseKey(itemType, itemId);
    setPhraseStates((prev) => ({ ...prev, [key]: next }));
  };

  const onPhraseLearn = async (itemType: "collocation" | "pattern", itemId: number) => {
    if (!isLoggedIn) {
      setSenseStateError("Войдите, чтобы добавлять фразы.");
      return;
    }
    try {
      await userDictionaryApi.addPhrase({ itemType, itemId });
      await userDictionaryApi.setPhraseStatus({ itemType, itemId, status: "learning" });
      setPhraseStateLocal(itemType, itemId, { isSaved: true, status: "learning" });
    } catch (e) {
      setSenseStateError(formatApiError(e, "Не удалось добавить фразу"));
    }
  };

  const onPhraseStatus = async (itemType: "collocation" | "pattern", itemId: number, status: "known" | "hard") => {
    if (!isLoggedIn) return;
    try {
      await userDictionaryApi.setPhraseStatus({ itemType, itemId, status });
      setPhraseStateLocal(itemType, itemId, { isSaved: true, status });
    } catch (e) {
      setSenseStateError(formatApiError(e, "Не удалось обновить статус фразы"));
    }
  };

  const onPhraseRemove = async (itemType: "collocation" | "pattern", itemId: number) => {
    if (!isLoggedIn) return;
    try {
      await userDictionaryApi.removePhrase({ itemType, itemId });
      setPhraseStateLocal(itemType, itemId, { isSaved: false, status: null });
    } catch (e) {
      setSenseStateError(formatApiError(e, "Не удалось удалить фразу"));
    }
  };

  return (
    <div className="app-shell dict-adv-page">
      <Header />
      <main className="main main--top">
        <div className="page-card dict-adv-card">
          {/* Шапка: назад, слово, бейджи, действия */}
          <header className="dict-adv-header">
            <button
              type="button"
              className={`dict-adv-back${isMobile ? " dict-adv-back--fab" : ""}${backFabCompact ? " dict-adv-back--compact" : ""}`}
              onClick={() => navigate(-1)}
              aria-label="Назад"
            >
              <svg className="dict-adv-back__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span className="dict-adv-back__label">Назад</span>
            </button>
            <div className="dict-adv-header__main">
              <div className="dict-adv-header__title-row">
                <h1 className="dict-adv-header__title">{entry?.en || card?.lemma?.lemma || "Слово"}</h1>
                <button
                  type="button"
                  className="dict-adv-header__speak-btn"
                  onClick={() => speakWord(entry?.en || card?.lemma?.lemma || "", "both")}
                  title="Озвучить слово"
                  aria-label="Озвучить слово"
                >
                  🔊
                </button>
              </div>
              {(entry?.ipaUs || card?.lemma?.ipaUs) && (
                <div className="dict-adv-header__ipa">
                  <span className="dict-adv-header__ipa-item" title="US">
                    {"\u{1F1FA}\u{1F1F8}"} {entry?.ipaUs || card?.lemma?.ipaUs}
                  </span>
                </div>
              )}
              <div className="dict-adv-header__badges">
                {currentSense?.level && (
                  <span className={`word-level-badge word-level-${currentSense.level}`}>{currentSense.level}</span>
                )}
                {currentSense?.register && <span className="dict-mini-badge">{currentSense.register}</span>}
                {!!fromFormParam && <span className="dict-mini-badge">Форма: {fromFormParam}</span>}
                {senseState?.isSaved && (
                  <span className="dict-mini-badge dict-mini-badge--saved">{senseState.status || "в моём"}</span>
                )}
              </div>
            </div>
            <div className="dict-adv-header__actions">
              {!senseState?.isSaved && (
                <button type="button" className="word-action-btn word-action-add-personal" onClick={onLearn}>
                  Учить
                </button>
              )}
              {senseState?.isSaved && (
                <button type="button" className="word-action-btn word-action-remove-personal" onClick={() => setDeleteConfirmOpen(true)}>
                  Удалить
                </button>
              )}
            </div>
          </header>

          {/* Ошибки — один блок */}
          {(senseStateError || error || formPickError) && (
            <div className="dict-adv-alerts">
              {senseStateError && <div className="dict-adv-alert dict-adv-alert--warning">{senseStateError}</div>}
              {error && <div className="dict-adv-alert dict-adv-alert--error">{error}</div>}
              {formPickError && <div className="dict-adv-alert dict-adv-alert--warning">{formPickError}</div>}
            </div>
          )}

          {state === "loading" && (
            <div className="dict-adv-loading">Загрузка…</div>
          )}

          {card && (
            <div className="dict-adv-body">
              {/* Блок определения текущего значения */}
              <div className="dict-adv-def-block">
                <p className="dict-adv-def-block__gloss">{currentSense?.glossRu || "—"}</p>
                {!!currentSense?.definitionRu && (
                  <p className="dict-adv-def-block__def">{currentSense.definitionRu}</p>
                )}
                {!!currentSense?.usageNote && (
                  <p className="dict-adv-def-block__note">{currentSense.usageNote}</p>
                )}
              </div>

              {!!mainExample?.en && (
                <section className="dict-adv-section">
                  <div className="dict-adv-section__body">
                  <div className="dict-adv-example">
                    <p className="dict-adv-example-en">
                      {splitTextToTokens(mainExample.en).map((t, idx) =>
                        t.kind === "sep" ? (
                          <span key={idx}>{t.value}</span>
                        ) : (
                          <button
                            key={idx}
                            type="button"
                            className="dict-token"
                            onClick={() => goByLookup(t.value)}
                            title="Открыть слово"
                          >
                            {t.value}
                          </button>
                        )
                      )}
                    </p>
                    {!!mainExample?.ru && <p className="dict-adv-example-ru">{mainExample.ru}</p>}
                  </div>
                  </div>
                </section>
              )}

              {senses.some((s: any) => Number(s.id) !== senseId) && (
                <Section title="Варианты значений слова">
                  <ul className="dict-adv-sense-list">
                    {senses
                      .filter((s: any) => Number(s.id) !== senseId)
                      .map((s: any) => (
                      <li key={s.id} className={`dict-sense-card ${Number(s.id) === senseId ? "dict-sense-card--active" : ""}`}>
                        <div className="dict-sense-card__head">
                          <span className={`word-level-badge word-level-${s.level}`}>{s.level}</span>
                          <span className="dict-mini-badge">{s.register}</span>
                          <span className="dict-sense-card__gloss">{s.glossRu || "—"}</span>
                        </div>
                        {!!s.definitionRu && <p className="dict-sense-card__def">{s.definitionRu}</p>}
                        {!!s.usageNote && <p className="dict-sense-card__note">{s.usageNote}</p>}
                        {!!s.examples?.length && (
                          <div className="dict-sense-card__examples">
                            {s.examples.slice(0, 2).map((ex: any) => (
                              <div key={ex.id} className="dict-example">
                                <div className="dict-example__en">{ex.en}</div>
                                {!!ex.ru && <div className="dict-example__ru">{ex.ru}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="dict-sense-card__actions">
                          <button type="button" className="word-action-btn" onClick={() => pushTrail(card?.lemma?.lemma || "word", Number(s.id))}>
                            Открыть
                          </button>
                          <button
                            type="button"
                            className="word-action-btn word-action-add-personal"
                            onClick={async () => {
                              if (!isLoggedIn) return setSenseStateError("Войдите, чтобы добавлять слова.");
                              try {
                                await userDictionaryApi.addSense({ senseId: Number(s.id) });
                                await userDictionaryApi.setStatus({ senseId: Number(s.id), status: "learning" });
                                if (Number(s.id) === senseId) await loadSenseState();
                              } catch (e) {
                                setSenseStateError(formatApiError(e, "Не удалось добавить смысл"));
                              }
                            }}
                          >
                            Учить этот смысл
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {forms.length > 0 && (
                <Section title="Формы">
                  <div className="dict-form-grid">
                    {forms.map((f: any, idx: number) => {
                      const formText = String(f.form || "").trim();
                      const typeRaw = String(f.formType || "").trim();
                      const typeLabel = formatFormTypeLabel(typeRaw);
                      const note = String(f.notes || "").trim();
                      const irregular = Boolean(f.isIrregular);
                      const formLevel = String(f.level || "").trim();
                      const formExample = String(f.example || "").trim();
                      const formExampleRu = String(f.exampleRu || "").trim();
                      const formRegister = String(f.register || "").trim();
                      const levelToShow = formLevel || currentSense?.level || entry?.level || "";
                      return (
                        <button
                          key={`${f.formType}-${f.form}-${idx}`}
                          type="button"
                          className="dict-form-tile"
                          onClick={() => onFormClick(formText)}
                          title="Открыть форму"
                          disabled={!formText}
                        >
                          <div className="dict-form-tile__main">
                            <div className="dict-form-tile__title-row">
                              <span className="dict-form-tile__title">{formText || "—"}</span>
                              <span
                                className="dict-form-tile__speak"
                                role="button"
                                tabIndex={0}
                                title="Озвучить"
                                aria-label="Озвучить"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (formText) speakWord(formText, "both");
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (formText) speakWord(formText, "both");
                                  }
                                }}
                              >
                                🔊
                              </span>
                            </div>
                            <div className="dict-form-tile__badges">
                              <span className="dict-form-tile__type">{typeLabel}</span>
                              {levelToShow && (
                                <span className={`word-level-badge word-level-${levelToShow}`}>{levelToShow}</span>
                              )}
                              {formRegister && <span className="dict-mini-badge">{formRegister}</span>}
                              <span className={`dict-form-tile__badge${irregular ? " dict-form-tile__badge--irregular" : ""}`}>
                                {irregular ? "irregular" : "regular"}
                              </span>
                              {!!note && <span className="dict-form-tile__note">{note}</span>}
                            </div>
                            {(formExample || formExampleRu) && (
                              <div className="dict-form-tile__example">
                                {formExample && <p className="dict-form-tile__example-en">{formExample}</p>}
                                {formExampleRu && <p className="dict-form-tile__example-ru">{formExampleRu}</p>}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}

              {patterns.length > 0 && (
                <Section title="Шаблоны употребления">
                  <ul className="dict-adv-pattern-list">
                    {patterns.map((p: any) => (
                      <li key={p.id} className="dict-pattern-item">
                        <div className="dict-example__en">{p.en}</div>
                        {!!p.ru && <div className="dict-example__ru">{p.ru}</div>}
                        <div className="dict-card__actions" style={{ marginTop: 8 }}>
                          {!phraseStates[phraseKey("pattern", Number(p.id))]?.isSaved ? (
                            <button type="button" className="word-action-btn word-action-add-personal" onClick={() => onPhraseLearn("pattern", Number(p.id))}>
                              Учить фразу
                            </button>
                          ) : (
                            <>
                              <button type="button" className="word-action-btn" onClick={() => onPhraseStatus("pattern", Number(p.id), "known")}>
                                Знаю
                              </button>
                              <button type="button" className="word-action-btn" onClick={() => onPhraseStatus("pattern", Number(p.id), "hard")}>
                                На повтор
                              </button>
                              <button type="button" className="word-action-btn word-action-remove-personal" onClick={() => onPhraseRemove("pattern", Number(p.id))}>
                                Удалить
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {collocations.length > 0 && (
                <Section title="Частые фразы">
                  <ul className="dict-adv-collocation-list">
                    {collocations.map((c: any) => (
                      <li key={c.id} className="dict-collocation-card">
                        <div className="dict-collocation-card__head">
                          <span className={`word-level-badge word-level-${c.level}`}>{c.level}</span>
                          <span className="dict-mini-badge">{c.register}</span>
                          <span className="dict-collocation-card__phrase">{c.phraseEn}</span>
                        </div>
                        {!!c.glossRu && <p className="dict-collocation-card__gloss">{c.glossRu}</p>}
                        {!!c.exampleEn && (
                          <div className="dict-collocation-card__example">
                            <div className="dict-example__en">
                              {splitTextToTokens(c.exampleEn).map((t, idx) =>
                                t.kind === "sep" ? (
                                  <span key={idx}>{t.value}</span>
                                ) : (
                                  <button key={idx} type="button" className="dict-token" onClick={() => goByLookup(t.value)}>
                                    {t.value}
                                  </button>
                                )
                              )}
                            </div>
                            {!!c.exampleRu && <div className="dict-example__ru">{c.exampleRu}</div>}
                          </div>
                        )}
                        <div className="dict-card__actions">
                          {!phraseStates[phraseKey("collocation", Number(c.id))]?.isSaved ? (
                            <button type="button" className="word-action-btn word-action-add-personal" onClick={() => onPhraseLearn("collocation", Number(c.id))}>
                              Учить фразу
                            </button>
                          ) : (
                            <>
                              <button type="button" className="word-action-btn" onClick={() => onPhraseStatus("collocation", Number(c.id), "known")}>
                                Знаю
                              </button>
                              <button type="button" className="word-action-btn" onClick={() => onPhraseStatus("collocation", Number(c.id), "hard")}>
                                На повтор
                              </button>
                              <button type="button" className="word-action-btn word-action-remove-personal" onClick={() => onPhraseRemove("collocation", Number(c.id))}>
                                Удалить
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {linksGrouped.length > 0 && (
                <Section title="Связанные слова">
                  <div className="dict-adv-links">
                    {linksGrouped.map(([type, arr]) => (
                      <div key={type} className="dict-adv-links-group">
                        <span className="dict-adv-links-type">{type}</span>
                        <div className="dict-chip-row">
                          {arr.map((l: any) => (
                            <Chip
                              key={l.id}
                              variant="link"
                              onClick={() => {
                                const next = Number(l.toSenseId);
                                if (Number.isFinite(next) && next > 0) pushTrail(l.toLemma || "word", next);
                              }}
                              title={l.noteRu || ""}
                            >
                              <b>{l.toLemma}</b>
                              {!!l.toGlossRu && <span className="muted">— {l.toGlossRu}</span>}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}
        </div>
      </main>
      {deleteConfirmOpen && (
        <div className="dict-modal dict-modal--confirm" role="dialog" aria-modal="true" aria-labelledby="dict-adv-delete-confirm-title">
          <div className="dict-modal__backdrop" onClick={() => setDeleteConfirmOpen(false)} />
          <div className="dict-modal__panel dict-modal__panel--confirm">
            <div className="dict-modal__head dict-modal__head--confirm">
              <div className="dict-modal__confirm-hero">
                <span className="dict-modal__confirm-icon" aria-hidden>!</span>
                <div className="dict-modal__confirm-heading">
                  <h2 id="dict-adv-delete-confirm-title" className="dict-modal__title dict-modal__title--confirm">Удалить слово?</h2>
                  <p className="dict-modal__confirm-subtitle">Действие нельзя отменить</p>
                </div>
              </div>
            </div>
            <div className="dict-modal__content dict-modal__content--confirm">
              <p className="dict-modal__confirm-text">
                Слово «{entry?.en || card?.lemma?.lemma || "Слово"}» будет удалено из списка «Мои слова». Продолжить?
              </p>
              <div className="dict-modal__confirm-actions">
                <button type="button" className="word-action-btn dict-modal__confirm-cancel" onClick={() => setDeleteConfirmOpen(false)}>
                  Отмена
                </button>
                <button
                  type="button"
                  className="word-action-btn word-action-remove-personal dict-modal__confirm-remove"
                  onClick={async () => {
                    const removed = await onRemove();
                    if (removed) setDeleteConfirmOpen(false);
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default DictionaryWordPage;

