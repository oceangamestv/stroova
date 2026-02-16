import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Header from "../components/common/Header";
import { dictionaryApi, userDictionaryApi } from "../api/endpoints";
import type { DictionaryFormCard } from "../api/types";
import { ApiError } from "../api/client";
import { useAuth } from "../features/auth/AuthContext";
import { speakWord } from "../utils/sounds";

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

type FormTypeHint = {
  what: string;
  when: string;
  pattern: string;
  note?: string;
};

function getFormTypeHint(type: string): FormTypeHint | null {
  const key = String(type || "").trim().toLowerCase();
  const hints: Record<string, FormTypeHint> = {
    ing: {
      what: "Форма -ing описывает действие как процесс и может работать как герундий.",
      when: "Используется в Continuous, после некоторых глаголов (enjoy, avoid, keep) и после предлогов.",
      pattern: "be + verb-ing; после предлога: verb-ing.",
      note: "Пример: I am doing my homework. / Doing sports helps me focus.",
    },
    past: {
      what: "Past (V2) обозначает завершенное действие в прошлом.",
      when: "Используется, когда действие произошло в прошлом и не связано напрямую с настоящим результатом.",
      pattern: "Утверждение: V2; вопрос/отрицание: did + base verb.",
      note: "Пример: I did my homework yesterday.",
    },
    past_participle: {
      what: "Past Participle (V3) используется в составных временах и пассиве.",
      when: "Нужен для Perfect (have/has/had + V3) и Passive (be + V3).",
      pattern: "have/has/had + V3; be + V3.",
      note: "Пример: I have done my homework. / The work is done.",
    },
    third_person_singular: {
      what: "Форма 3-го лица единственного числа в Present Simple (he/she/it).",
      when: "Используется для регулярных действий и фактов с he, she, it.",
      pattern: "Утверждение: verb + s/es; вопрос/отрицание: does + base verb.",
      note: "Пример: She does her homework every day.",
    },
    plural: {
      what: "Форма множественного числа существительных.",
      when: "Используется, когда речь идет о двух и более объектах.",
      pattern: "Чаще всего: noun + s/es; есть нерегулярные формы (children, men).",
    },
    comparative: {
      what: "Сравнительная степень прилагательного.",
      when: "Используется для сравнения двух объектов.",
      pattern: "short adj + -er / more + adjective.",
      note: "Пример: This task is easier.",
    },
    superlative: {
      what: "Превосходная степень прилагательного.",
      when: "Используется, когда выделяем один объект среди группы.",
      pattern: "the + short adj + -est / the most + adjective.",
      note: "Пример: This is the easiest task.",
    },
    other: {
      what: "Специальная или нестандартная форма слова.",
      when: "Используется в конкретном грамматическом контексте для этой лексемы.",
      pattern: "Проверяйте употребление по примеру ниже.",
    },
  };
  return hints[key] || null;
}

const DictionaryFormCardPage: React.FC = () => {
  const { cardId: cardIdParam } = useParams();
  const cardId = Number(cardIdParam);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromForm = searchParams.get("fromForm") || "";
  const { user } = useAuth();
  const isLoggedIn = !!user;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<DictionaryFormCard | null>(null);
  const [formCardState, setFormCardState] = useState<{ isSaved: boolean; status: string | null } | null>(null);
  const [senseStateError, setSenseStateError] = useState<string | null>(null);
  const [learnLoading, setLearnLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const formHint = getFormTypeHint(card?.sourceForm?.formType || "");

  const canLearn = card != null;

  useEffect(() => {
    const run = async () => {
      if (!Number.isFinite(cardId) || cardId <= 0) {
        setError("Некорректный cardId");
        return;
      }
      setLoading(true);
      setError(null);
      setFormCardState(null);
      try {
        const out = await dictionaryApi.getFormCardById({ lang: "en", cardId });
        if (!out?.card) {
          setError("Карточка формы не найдена.");
          setCard(null);
        } else {
          setCard(out.card);
        }
      } catch (e) {
        setError(formatApiError(e, "Не удалось загрузить карточку формы"));
        setCard(null);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [cardId]);

  useEffect(() => {
    if (!isLoggedIn || !card?.id) {
      setFormCardState(null);
      return;
    }
    let cancelled = false;
    setSenseStateError(null);
    userDictionaryApi
      .getPhraseState({ itemType: "form_card", itemId: card.id })
      .then((out) => {
        if (!cancelled) setFormCardState(out);
      })
      .catch((e) => {
        if (!cancelled) setSenseStateError(formatApiError(e, "Не удалось загрузить состояние"));
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, card?.id]);

  const onLearn = async () => {
    if (!isLoggedIn) {
      setSenseStateError("Войдите, чтобы добавлять слова в личный словарь.");
      return;
    }
    if (!card) return;
    setLearnLoading(true);
    setSenseStateError(null);
    try {
      if (!formCardState?.isSaved) await userDictionaryApi.addPhrase({ itemType: "form_card", itemId: card.id });
      await userDictionaryApi.setPhraseStatus({ itemType: "form_card", itemId: card.id, status: "learning" });
      const out = await userDictionaryApi.getPhraseState({ itemType: "form_card", itemId: card.id });
      setFormCardState(out);
    } catch (e) {
      setSenseStateError(formatApiError(e, "Не удалось добавить в словарь"));
    } finally {
      setLearnLoading(false);
    }
  };

  const onRemove = async () => {
    if (!isLoggedIn || !card) return;
    setRemoveLoading(true);
    setSenseStateError(null);
    try {
      await userDictionaryApi.removePhrase({ itemType: "form_card", itemId: card.id });
      const out = await userDictionaryApi.getPhraseState({ itemType: "form_card", itemId: card.id });
      setFormCardState(out);
    } catch (e) {
      setSenseStateError(formatApiError(e, "Не удалось удалить из словаря"));
    } finally {
      setRemoveLoading(false);
    }
  };

  return (
    <div className="app-shell dict-adv-page dict-form-page">
      <Header />
      <main className="main main--top">
        <div className="page-card dict-adv-card dict-form-page__card">
          <header className="dict-adv-header">
            <button type="button" className="dict-adv-back" onClick={() => navigate(-1)} aria-label="Назад">
              <svg className="dict-adv-back__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span className="dict-adv-back__label">Назад</span>
            </button>
            <div className="dict-adv-header__main">
              <div className="dict-adv-header__title-row">
                <h1 className="dict-adv-header__title">{card?.en || "Карточка формы"}</h1>
                <button
                  type="button"
                  className="dict-adv-header__speak-btn"
                  onClick={() => speakWord(card?.en || "", "both")}
                  title="Озвучить"
                  aria-label="Озвучить"
                >
                  🔊
                </button>
              </div>
              {!!card?.ipaUs && (
                <div className="dict-adv-header__ipa">
                  <span className="dict-adv-header__ipa-item" title="US">
                    {"\u{1F1FA}\u{1F1F8}"} {card.ipaUs}
                  </span>
                </div>
              )}
              <div className="dict-adv-header__badges">
                {!!card?.level && <span className={`word-level-badge word-level-${card.level}`}>{card.level}</span>}
                {!!card?.register && <span className="dict-mini-badge">{card.register}</span>}
                {!!card?.sourceForm?.formType && <span className="dict-mini-badge">{formatFormTypeLabel(card.sourceForm.formType)}</span>}
                {!!fromForm && <span className="dict-mini-badge">Форма: {fromForm}</span>}
              </div>
              {canLearn && (
                <div className="dict-adv-header__actions">
                  {formCardState?.isSaved ? (
                    <button
                      type="button"
                      className="word-action-btn word-action-remove-personal"
                      onClick={onRemove}
                      disabled={removeLoading}
                    >
                      {removeLoading ? "Удаление…" : "Удалить"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="word-action-btn word-action-add-personal"
                      onClick={onLearn}
                      disabled={learnLoading}
                    >
                      {learnLoading ? "Добавление…" : "Учить"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </header>

          {(error || loading || senseStateError) && (
            <div className="dict-adv-alerts">
              {loading && <div className="dict-adv-alert dict-adv-alert--warning">Загрузка карточки формы…</div>}
              {error && <div className="dict-adv-alert dict-adv-alert--error">{error}</div>}
              {senseStateError && <div className="dict-adv-alert dict-adv-alert--error">{senseStateError}</div>}
            </div>
          )}

          {card && !loading && (
            <div className="dict-adv-body">
              <div className="dict-adv-def-block">
                <p className="dict-adv-def-block__gloss">{card.ru || "—"}</p>
              </div>

              {!!card.example && (
                <section className="dict-adv-section">
                  <h2 className="dict-adv-section__title">Пример</h2>
                  <div className="dict-adv-section__body">
                    <div className="dict-adv-example">
                      <p className="dict-adv-example-en">{card.example}</p>
                      {!!card.exampleRu && <p className="dict-adv-example-ru">{card.exampleRu}</p>}
                    </div>
                  </div>
                </section>
              )}

              {!!formHint && (
                <section className="dict-adv-section">
                  <h2 className="dict-adv-section__title">О форме</h2>
                  <div className="dict-adv-section__body">
                    <div className="dict-form-hint">
                      <p className="dict-form-hint__line">
                        <strong>Что это:</strong> {formHint.what}
                      </p>
                      <p className="dict-form-hint__line">
                        <strong>Когда используется:</strong> {formHint.when}
                      </p>
                      <p className="dict-form-hint__line">
                        <strong>Как строится:</strong> {formHint.pattern}
                      </p>
                      {!!formHint.note && <p className="dict-form-hint__note">{formHint.note}</p>}
                    </div>
                  </div>
                </section>
              )}

            </div>
          )}
        </div>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default DictionaryFormCardPage;
