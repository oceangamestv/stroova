import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../features/auth/AuthContext";
import { authService } from "../../services/authService";
import { storyTrainerApi, userDictionaryApi, dictionaryApi } from "../../api/endpoints";
import { formatXp } from "../../domain/xp";
import { speakWord } from "../../utils/sounds";

const MIN_WORDS = 10;

type WordInfo = { en: string; ru: string; senseId: number; isSaved: boolean };
type Result = { xp: number; score: number; feedback: string };

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9'-]+$/g, "")
    .replace(/^[^a-z0-9]+/g, "");
}

const StoryTrainerExercise: React.FC = () => {
  const { user, refresh: refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [story, setStory] = useState<string | null>(null);
  const [words, setWords] = useState<WordInfo[]>([]);
  const [retelling, setRetelling] = useState("");
  const [language, setLanguage] = useState<"ru" | "en">("ru");
  const [submitted, setSubmitted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [popover, setPopover] = useState<{ wordInfo: WordInfo; rect: DOMRect; loading?: boolean } | null>(null);
  const [addingSenseId, setAddingSenseId] = useState<number | null>(null);
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const popoverContentRef = useRef<HTMLDivElement>(null);
  const lookupCacheRef = useRef<Map<string, WordInfo>>(new Map());

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setIsNarrow(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const wordCount = retelling.trim().split(/\s+/).filter(Boolean).length;
  const canSubmit = wordCount >= MIN_WORDS && !submitted && !checking;

  const wordsMap = useMemo(() => {
    const map = new Map<string, WordInfo>();
    words.forEach((w) => map.set(w.en.toLowerCase(), w));
    return map;
  }, [words]);

  const storyTokens = useMemo(() => {
    if (!story) return [];
    return story.split(/\s+/).filter(Boolean);
  }, [story]);

  useEffect(() => {
    if (!popover) return;
    const close = (e: MouseEvent) => {
      const el = e.target as Node;
      if (popoverContentRef.current?.contains(el)) return;
      setPopover(null);
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [popover]);

  const startGame = useCallback(async () => {
    if (!user) return;
    setError(null);
    setLoading(true);
    setResult(null);
    setRetelling("");
    setSubmitted(false);
    setSessionId(null);
    setStory(null);
    setWords([]);
    setPopover(null);
    lookupCacheRef.current.clear();
    try {
      const data = await storyTrainerApi.generate({ lang: "en" });
      setSessionId(data.sessionId);
      setStory(data.story);
      setWords(data.words);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Не удалось сгенерировать историю.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Сразу запускаем генерацию при входе (без промежуточного экрана «Начать»)
  useEffect(() => {
    if (!user || loading || sessionId || error) return;
    startGame();
  }, [user, loading, sessionId, error, startGame]);

  const submitRetelling = useCallback(async () => {
    if (!sessionId || !user || !canSubmit) return;
    setChecking(true);
    setError(null);
    try {
      const data = await storyTrainerApi.check({
        sessionId,
        retelling: retelling.trim(),
        language,
      });
      setResult({ xp: data.xp, score: data.score, feedback: data.feedback });
      setSubmitted(true);
      const stats = authService.getCurrentUser()?.stats;
      authService.updateUserStats(
        {
          totalXp: (stats?.totalXp ?? stats?.totalScore ?? 0) + data.xp,
          exercisesCompleted: (stats?.exercisesCompleted ?? 0) + 1,
          bestScore: Math.max(stats?.bestScore ?? 0, data.xp),
        },
        { xpEarnedToday: data.xp }
      );
      setTimeout(() => refreshUser(), 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось проверить пересказ.");
    } finally {
      setChecking(false);
    }
  }, [sessionId, user, canSubmit, retelling, language, refreshUser]);

  const handleWordClick = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>, token: string) => {
      e.preventDefault();
      e.stopPropagation();
      const normalized = normalizeToken(token);
      if (!normalized) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const fromMap = wordsMap.get(normalized);
      if (fromMap) {
        setPopover({ wordInfo: fromMap, rect });
        return;
      }
      const fromCache = lookupCacheRef.current.get(normalized);
      if (fromCache) {
        setPopover({ wordInfo: fromCache, rect });
        return;
      }
      setPopover({
        wordInfo: { en: token, ru: "", senseId: 0, isSaved: false },
        rect,
        loading: true,
      });
      try {
        const { items } = await dictionaryApi.lookup({ lang: "en", term: normalized, limit: 1 });
        const first = items?.[0];
        const info: WordInfo = first
          ? {
              en: first.lemma,
              ru: (first.glossRu || "").trim() || "—",
              senseId: first.senseId,
              isSaved: false,
            }
          : { en: token, ru: "Слово не найдено", senseId: 0, isSaved: false };
        lookupCacheRef.current.set(normalized, info);
        setPopover((prev) => (prev ? { ...prev, wordInfo: info, loading: false } : null));
      } catch {
        const info: WordInfo = { en: token, ru: "Слово не найдено", senseId: 0, isSaved: false };
        lookupCacheRef.current.set(normalized, info);
        setPopover((prev) => (prev ? { ...prev, wordInfo: info, loading: false } : null));
      }
    },
    [wordsMap]
  );

  const handlePlay = useCallback((en: string) => {
    speakWord(en, "both");
  }, []);

  const handleAddToDictionary = useCallback(
    async (senseId: number) => {
      if (addingSenseId !== null) return;
      setAddingSenseId(senseId);
      try {
        await userDictionaryApi.addSense({ senseId });
        await userDictionaryApi.setStatus({ senseId, status: "learning" });
        setWords((prev) =>
          prev.map((w) => (w.senseId === senseId ? { ...w, isSaved: true } : w))
        );
        setPopover((p) => (p ? { ...p, wordInfo: { ...p.wordInfo, isSaved: true } } : null));
      } catch {
        // keep popover open, user can retry
      } finally {
        setAddingSenseId(null);
      }
    },
    [addingSenseId]
  );

  if (!user) {
    return (
      <div className="exercise-area">
        <p className="dictionary-subtitle">Войдите в аккаунт, чтобы играть в AI Story Trainer.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="exercise-area">
        <p className="dictionary-subtitle">Генерация истории…</p>
      </div>
    );
  }

  if (error && !sessionId) {
    return (
      <div className="exercise-area">
        <p className="dictionary-subtitle" role="alert">{error}</p>
        <button type="button" className="primary-btn" onClick={startGame}>
          Попробовать снова
        </button>
      </div>
    );
  }

  return (
    <div className="exercise-area story-trainer">
      {error && <p className="story-trainer-error" role="alert">{error}</p>}
      {story && (
        <>
          <section className="story-trainer-story" aria-label="Текст истории">
            <div className="story-trainer-text-wrap">
              <p className="story-trainer-text">
                {storyTokens.map((token, i) => {
                  const normalized = normalizeToken(token);
                  if (!normalized) {
                    return (
                      <React.Fragment key={i}>
                        {i > 0 && " "}
                        <span className="story-trainer-word-plain">{token}</span>
                      </React.Fragment>
                    );
                  }
                  const info = wordsMap.get(normalized);
                  const title = info?.ru ?? "";
                  return (
                    <React.Fragment key={i}>
                      {i > 0 && " "}
                      <button
                        type="button"
                        className="story-trainer-word-btn"
                        onClick={(e) => void handleWordClick(e, token)}
                        title={title}
                        aria-label={title ? `${token}, перевод: ${title}` : token}
                      >
                        {token}
                      </button>
                    </React.Fragment>
                  );
                })}
              </p>
            </div>
            <p className="story-trainer-tap-hint">Нажмите на слово — появится перевод и кнопки.</p>
          </section>
        </>
      )}
      {popover && (
        <>
          <div
            className="story-trainer-popover-backdrop"
            aria-hidden
            onClick={() => setPopover(null)}
          />
          <div
            ref={popoverContentRef}
            className={`story-trainer-popover ${isNarrow ? "story-trainer-popover--mobile" : "story-trainer-popover--desktop"}`}
            role="dialog"
            aria-label="Подсказка к слову"
            style={
              isNarrow
                ? undefined
                : (() => {
                    const padding = 12;
                    const maxW = 280;
                    let left = popover.rect.left;
                    if (left + maxW > window.innerWidth - padding) left = window.innerWidth - maxW - padding;
                    if (left < padding) left = padding;
                    return { left, top: popover.rect.bottom + 8 };
                  })()
            }
          >
            <div className="story-trainer-popover-inner">
              <p className="story-trainer-popover-word">{popover.wordInfo.en}</p>
              <p className="story-trainer-popover-ru">
                {popover.loading ? "Загрузка…" : (popover.wordInfo.ru || "—")}
              </p>
              {!popover.loading && (
                <div className="story-trainer-popover-actions">
                  <button
                    type="button"
                    className="story-trainer-popover-btn story-trainer-popover-btn--play"
                    onClick={() => handlePlay(popover.wordInfo.en)}
                    aria-label="Воспроизвести"
                  >
                    🔊 Звук
                  </button>
                  {!popover.wordInfo.isSaved && popover.wordInfo.senseId > 0 && (
                    <button
                      type="button"
                      className="story-trainer-popover-btn story-trainer-popover-btn--add"
                      onClick={() => handleAddToDictionary(popover.wordInfo.senseId)}
                      disabled={addingSenseId === popover.wordInfo.senseId}
                      aria-label="Добавить в словарь"
                    >
                      {addingSenseId === popover.wordInfo.senseId ? "…" : "+ В словарь"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {!result ? (
        <>
          <section className="story-trainer-retelling" aria-label="Ваш пересказ">
            <h2 className="story-trainer-heading">Пересказ</h2>
            <p className="story-trainer-hint">
              Напишите пересказ своими словами (не менее {MIN_WORDS} слов). Можно на русском или английском — за английский даётся больше опыта.
            </p>
            <div className="story-trainer-lang">
              <label>
                <input
                  type="radio"
                  name="story-lang"
                  checked={language === "ru"}
                  onChange={() => setLanguage("ru")}
                />
                На русском
              </label>
              <label>
                <input
                  type="radio"
                  name="story-lang"
                  checked={language === "en"}
                  onChange={() => setLanguage("en")}
                />
                На английском
              </label>
            </div>
            <textarea
              className="story-trainer-textarea"
              value={retelling}
              onChange={(e) => setRetelling(e.target.value)}
              placeholder="Введите пересказ..."
              rows={5}
              disabled={submitted}
            />
            <p className="story-trainer-word-count">
              Слов: {wordCount} {wordCount < MIN_WORDS && `(нужно минимум ${MIN_WORDS})`}
            </p>
            <button
              type="button"
              className="primary-btn story-trainer-submit-btn"
              onClick={submitRetelling}
              disabled={!canSubmit}
            >
              {checking ? "Проверка…" : "Отправить на проверку"}
            </button>
          </section>
        </>
      ) : (
        <section className="story-trainer-result" aria-label="Результат">
          <h2 className="story-trainer-heading">Результат</h2>
          <p className="story-trainer-xp">Опыт: {formatXp(result.xp)} XP</p>
          <p className="story-trainer-score">Оценка: {Math.round(result.score * 100)}%</p>
          {result.feedback && <p className="story-trainer-feedback">{result.feedback}</p>}
        </section>
      )}
    </div>
  );
};

export default StoryTrainerExercise;
