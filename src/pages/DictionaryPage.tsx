import React, { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/common/Header";
import { useIsMobile } from "../hooks/useIsMobile";
import { useDictionary } from "../features/dictionary/useDictionary";
import { dictionaryService } from "../services/dictionaryService";
import { personalDictionaryService } from "../services/personalDictionaryService";
import { progressService } from "../services/progressService";
import { speakWord as speakWordUtil } from "../utils/sounds";
import type { Word, WordProgressMap, Level } from "../data/contracts/types";

type DictionaryTab = "general" | "personal";
const LEVELS: Level[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
type Filter = "all" | Level | "learned" | "learning";
type ViewSettingKey =
  | "translation"
  | "audio"
  | "slowAudio"
  | "transcription"
  | "example"
  | "exampleRu"
  | "level";

const defaultViewSettings: Record<ViewSettingKey, boolean> = {
  translation: true,
  audio: true,
  slowAudio: true,
  transcription: true,
  example: true,
  exampleRu: true,
  level: true,
};

function highlightWordInExample(example: string, word: string): string {
  if (!example || !word) return example;
  const regex = new RegExp(
    "(" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + ")",
    "gi"
  );
  return example.replace(regex, "<strong class=\"example-keyword\">$1</strong>");
}

/** Иконка «В моём словаре» — книжка */
const InMyDictionaryIcon: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <span className={className} title={title} role="img" aria-label={title || "В моём словаре"}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8M8 11h6M8 15h4" />
    </svg>
  </span>
);

const DictionaryPage: React.FC = () => {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<DictionaryTab>("general");
  const [filter, setFilter] = useState<Filter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewSettings, setViewSettings] = useState<Record<ViewSettingKey, boolean>>(() => {
    try {
      const stored = localStorage.getItem("dictionaryViewSettings");
      if (!stored) return { ...defaultViewSettings };
      return { ...defaultViewSettings, ...JSON.parse(stored) };
    } catch {
      return { ...defaultViewSettings };
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modalWord, setModalWord] = useState<Word | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const { words: generalWords, loading: wordsLoading, error: wordsError } = useDictionary();
  const [personalIds, setPersonalIds] = useState<number[]>(() =>
    personalDictionaryService.getPersonalWordIds()
  );
  const personalWords = useMemo(() => {
    const set = new Set(personalIds);
    return generalWords.filter((w) => set.has(w.id));
  }, [generalWords, personalIds]);

  const dictionary = tab === "general" ? generalWords : personalWords;
  const [progress, setProgress] = useState<WordProgressMap>(
    () => progressService.getWordProgress()
  );

  const filteredWords = useMemo(() => {
    let words = [...dictionary];
    if (LEVELS.includes(filter as Level)) words = words.filter((w) => w.level === filter);
    if (filter === "learned") words = words.filter((w) => progressService.isWordLearned(w.id));
    if (filter === "learning") {
      words = words.filter((w) => {
        const b = progressService.getWordProgressValue(w.id, "beginner");
        const e = progressService.getWordProgressValue(w.id, "experienced");
        const learned = progressService.isWordLearned(w.id);
        return (b > 0 || e > 0) && !learned;
      });
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      words = words.filter(
        (w) =>
          w.en.toLowerCase().includes(query) ||
          w.ru.toLowerCase().includes(query) ||
          w.example.toLowerCase().includes(query) ||
          (w.exampleRu && w.exampleRu.toLowerCase().includes(query))
      );
    }
    return words;
  }, [dictionary, filter, progress, searchQuery]);

  const stats = useMemo(() => {
    const total = dictionary.length;
    const learned = dictionary.filter((w) => progressService.isWordLearned(w.id)).length;
    let totalProgress = 0;
    dictionary.forEach((w) => {
      const b = progressService.getWordProgressValue(w.id, "beginner");
      const e = progressService.getWordProgressValue(w.id, "experienced");
      totalProgress += (b + e) / 2;
    });
    const avgProgress = total > 0 ? Math.round(totalProgress / total) : 0;
    return { total, learned, avgProgress };
  }, [dictionary, progress]);

  const addToPersonal = (word: Word) => {
    personalDictionaryService.addWord(word.id);
    setPersonalIds(personalDictionaryService.getPersonalWordIds());
  };

  const addAllFilteredToPersonal = () => {
    const toAdd = filteredWords.filter((w) => !personalIds.includes(w.id));
    if (toAdd.length === 0) {
      return;
    }
    const message = `Добавить в мой словарь ${toAdd.length} ${toAdd.length === 1 ? "слово" : toAdd.length < 5 ? "слова" : "слов"} из текущего списка?`;
    if (!confirm(message)) return;
    toAdd.forEach((w) => personalDictionaryService.addWord(w.id));
    setPersonalIds(personalDictionaryService.getPersonalWordIds());
  };

  const removeFromPersonal = (word: Word) => {
    personalDictionaryService.removeWord(word.id);
    setPersonalIds(personalDictionaryService.getPersonalWordIds());
  };

  const resetWord = (word: Word) => {
    if (confirm("Сбросить прогресс этого слова до 0%?")) {
      progressService.resetWordProgress(word.id);
      setProgress(progressService.getWordProgress());
    }
  };

  const markKnown = (word: Word) => {
    progressService.setWordAsKnown(word.id);
    setProgress(progressService.getWordProgress());
  };

  const speakWord = (word: Word, speed: "normal" | "slow") => {
    const rate = speed === "slow" ? 0.5 : 0.9;
    speakWordUtil(word.en, word.accent ?? "both", rate);
  };

  useEffect(() => {
    localStorage.setItem("dictionaryViewSettings", JSON.stringify(viewSettings));
  }, [viewSettings]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!settingsRef.current) return;
      if (!settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [settingsOpen]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalWord(null);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const sectionClassName = [
    "dictionary-section",
    !viewSettings.translation && "hide-translation",
    !viewSettings.audio && "hide-audio",
    !viewSettings.slowAudio && "hide-slow-audio",
    !viewSettings.audio && !viewSettings.slowAudio && "hide-audio-column",
    !viewSettings.transcription && "hide-transcription",
    !viewSettings.example && "hide-example",
    !viewSettings.exampleRu && "hide-example-ru",
    !viewSettings.level && "hide-level",
  ]
    .filter(Boolean)
    .join(" ");

  if (wordsLoading) {
    return (
      <div className="app-shell">
        <Header />
        <main className="main">
          <p className="dictionary-subtitle">Загрузка словаря…</p>
        </main>
      </div>
    );
  }

  return (
    <div className={`app-shell ${isMobile ? "app-shell--dictionary-mobile" : ""}`}>
      <Header />
      {wordsError && (
        <div className="dictionary-error-banner" style={{ padding: "8px 16px", background: "#fff3cd", margin: "8px" }}>
          {wordsError}
        </div>
      )}
      <main className="main">
        <section className={sectionClassName}>
          <div className="dictionary-header">
            {!isMobile && (
              <div className="dictionary-tabs">
                <button
                  type="button"
                  className={`dictionary-tab ${tab === "general" ? "active" : ""}`}
                  onClick={() => setTab("general")}
                >
                  Общий словарь
                </button>
                <button
                  type="button"
                  className={`dictionary-tab ${tab === "personal" ? "active" : ""}`}
                  onClick={() => {
                    setTab("personal");
                    setFilter("all");
                  }}
                >
                  Мой словарь
                </button>
              </div>
            )}
            <h1 className="dictionary-title">
              {tab === "general" ? "Общий словарь" : "Мой словарь"}
            </h1>
            <p className="dictionary-subtitle">
              {tab === "general"
                ? "Все слова на сайте. Добавляйте понравившиеся в «Мой словарь» — по нему можно играть в игры."
                : "Слова, которые вы добавили из общего словаря. В играх можно выбрать, из какого словаря брать слова."}
            </p>
            <div className="dictionary-stats">
              <div className="stat-item">
                <span className="stat-value">{stats.total}</span>
                <span className="stat-label">Всего слов</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{stats.learned}</span>
                <span className="stat-label">Изучено (100%)</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{stats.avgProgress}%</span>
                <span className="stat-label">Средний прогресс</span>
              </div>
            </div>
          </div>

          <div className="dictionary-filters">
            <button
              className={`filter-btn ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
              type="button"
            >
              Все слова
            </button>
            {LEVELS.map((level) => (
              <button
                key={level}
                className={`filter-btn ${filter === level ? "active" : ""}`}
                onClick={() => setFilter(level)}
                type="button"
              >
                {level}
              </button>
            ))}
            <button
              className={`filter-btn ${filter === "learned" ? "active" : ""}`}
              onClick={() => setFilter("learned")}
              type="button"
            >
              ✅ Изученные
            </button>
            <button
              className={`filter-btn ${filter === "learning" ? "active" : ""}`}
              onClick={() => setFilter("learning")}
              type="button"
            >
              📚 В процессе
            </button>
          </div>

          <div className="dictionary-toolbar">
            <div className="dictionary-search">
              <input
                type="text"
                placeholder="Поиск по словам..."
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {tab === "general" && (() => {
              const canAddCount = filteredWords.filter((w) => !personalIds.includes(w.id)).length;
              return canAddCount > 0 ? (
                <button
                  type="button"
                  className="word-action-btn word-action-add-personal"
                  onClick={addAllFilteredToPersonal}
                >
                  Добавить все из списка ({canAddCount})
                </button>
              ) : null;
            })()}
            <div className="dictionary-view-settings" ref={settingsRef}>
              <button
                className="view-settings-btn"
                type="button"
                onClick={() => setSettingsOpen((prev) => !prev)}
              >
                Настроить вид
              </button>
              <div className={`view-settings-panel ${settingsOpen ? "open" : ""}`}>
                {(Object.keys(defaultViewSettings) as ViewSettingKey[]).map((key) => (
                  <label className="view-setting" key={key}>
                    <input
                      type="checkbox"
                      checked={viewSettings[key]}
                      onChange={(event) =>
                        setViewSettings((prev) => ({
                          ...prev,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                    {key === "translation" && "Перевод"}
                    {key === "audio" && "Озвучивание"}
                    {key === "slowAudio" && "Медленное озвучивание"}
                    {key === "transcription" && "Транскрипция"}
                    {key === "example" && "Пример"}
                    {key === "exampleRu" && "Перевод примера"}
                    {key === "level" && "Уровень"}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="words-grid">
            {filteredWords.length === 0 && (
              <div className="empty-state">
                {tab === "personal" && personalWords.length === 0 ? (
                  <p>В вашем словаре пока нет слов. Откройте «Общий словарь» и добавляйте слова кнопкой «Добавить в мой словарь».</p>
                ) : (
                  <p>Слова не найдены</p>
                )}
              </div>
            )}
            {filteredWords.length > 0 && (
              <div className="word-row word-row-header">
                <div className="word-cell word-cell-level">Уровень</div>
                <div className="word-cell word-cell-main">Слово</div>
                <div className="word-cell word-cell-audio">Озвучка</div>
                <div className="word-cell word-cell-transcription">Транскрипция</div>
                <div className="word-cell word-cell-example">Пример</div>
              </div>
            )}
            {filteredWords.map((word) => {
              const beginnerVal = progressService.getWordProgressValue(word.id, "beginner");
              const experiencedVal = progressService.getWordProgressValue(word.id, "experienced");
              const exampleHighlighted = highlightWordInExample(word.example, word.en);
              return (
                <div key={word.id} className="word-card">
                  <div className="word-row">
                    <div className="word-cell word-cell-level">
                      <span className={`word-level-badge word-level-${word.level}`}>
                        {word.level}
                      </span>
                      {personalIds.includes(word.id) && (
                        <InMyDictionaryIcon className="word-level-in-dict-icon" title="В моём словаре" />
                      )}
                    </div>
                    <div className="word-cell word-cell-main">
                      <div className="word-title">{word.en}</div>
                      <div className="word-translation-under">{word.ru}</div>
                      <button
                        type="button"
                        className="word-details-btn word-details-btn--desktop"
                        onClick={() => setModalWord(word)}
                      >
                        Подробнее
                      </button>
                    </div>
                    <div className="word-cell word-cell-audio">
                      <button
                        type="button"
                        className="word-speak-btn"
                        title="Озвучить"
                        onClick={() => speakWord(word, "normal")}
                      >
                        🔊
                      </button>
                      <button
                        type="button"
                        className="word-speak-btn word-speak-btn-slow"
                        title="Медленное озвучивание"
                        onClick={() => speakWord(word, "slow")}
                      >
                        🐢
                      </button>
                    </div>
                    <div className="word-card-details">
                      <div className="word-cell word-cell-transcription word-card-table-row">
                        <span className="word-card-details-label word-card-table-caption">Транскрипция</span>
                        <div className="word-card-details-value word-card-table-grid">
                          <span className="word-card-table-th">🇬🇧 UK</span>
                          <span className="word-card-table-td">{word.ipaUk}</span>
                          <span className="word-card-table-th">🇺🇸 US</span>
                          <span className="word-card-table-td">{word.ipaUs}</span>
                        </div>
                      </div>
                      <div className="word-cell word-cell-example word-card-table-row">
                        <span className="word-card-details-label word-card-table-caption">Пример</span>
                        <div className="word-card-details-value word-card-table-grid">
                          <span className="word-card-table-th">EN</span>
                          <span className="word-card-table-td">
                            <span
                              className="word-example-text"
                              dangerouslySetInnerHTML={{ __html: exampleHighlighted }}
                            />
                          </span>
                          <span className="word-card-table-th">RU</span>
                          <span className="word-card-table-td">
                            {word.exampleRu != null && word.exampleRu !== "" ? word.exampleRu : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="word-row-footer">
                    <div className="word-progress word-progress--dual">
                      <div className="word-progress-track" title="Начинающий — опыт из игр «Найди пару» и пазлы (лёгкий)">
                        <span className="word-progress-label word-progress-label--beginner">Нач.</span>
                        <div className="word-progress-bar">
                          <div
                            className="word-progress-fill word-progress-fill--beginner"
                            style={{ width: `${Math.round(beginnerVal)}%` }}
                          />
                        </div>
                        <span className="word-progress-badge word-progress-badge--beginner">
                          {Math.round(beginnerVal)}%
                        </span>
                      </div>
                      <div className="word-progress-track" title="Опытный — опыт из пазлов (сложный режим)">
                        <span className="word-progress-label word-progress-label--experienced">Опыт.</span>
                        <div className="word-progress-bar">
                          <div
                            className="word-progress-fill word-progress-fill--experienced"
                            style={{ width: `${Math.round(experiencedVal)}%` }}
                          />
                        </div>
                        <span className="word-progress-badge word-progress-badge--experienced">
                          {Math.round(experiencedVal)}%
                        </span>
                      </div>
                    </div>
                    <div className="word-card-actions">
                      {tab === "general" ? (
                        personalIds.includes(word.id) ? null : (
                          <button
                            type="button"
                            className="word-action-btn word-action-add-personal"
                            onClick={() => addToPersonal(word)}
                          >
                            Добавить в мой словарь
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          className="word-action-btn word-action-remove-personal"
                          onClick={() => removeFromPersonal(word)}
                        >
                          Удалить из моего словаря
                        </button>
                      )}
                      <button
                        type="button"
                        className="word-action-btn word-action-reset"
                        onClick={() => resetWord(word)}
                      >
                        Сбросить прогресс
                      </button>
                      <button
                        type="button"
                        className="word-action-btn word-action-known"
                        onClick={() => markKnown(word)}
                      >
                        Я знаю это слово
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {modalWord && (
            <div className="word-modal open" onClick={() => setModalWord(null)}>
              <div className="word-modal-card" onClick={(event) => event.stopPropagation()}>
                <button
                  className="word-modal-close"
                  type="button"
                  onClick={() => setModalWord(null)}
                >
                  ✕
                </button>
                <div className="word-modal-content">
                  {viewSettings.level && (
                    <div className="modal-level">
                      <span className={`word-level-badge word-level-${modalWord.level}`}>
                        {modalWord.level}
                      </span>
                    </div>
                  )}
                  <div className="modal-header">
                    <div>
                      <div className="modal-word">{modalWord.en}</div>
                    </div>
                    <div className="modal-progress modal-progress--dual">
                      <span className="modal-progress-item modal-progress-item--beginner">
                        Начинающий: {Math.round(progressService.getWordProgressValue(modalWord.id, "beginner"))}%
                      </span>
                      <span className="modal-progress-item modal-progress-item--experienced">
                        Опытный: {Math.round(progressService.getWordProgressValue(modalWord.id, "experienced"))}%
                      </span>
                    </div>
                  </div>
                  {viewSettings.translation && (
                    <div className="modal-translation">{modalWord.ru}</div>
                  )}
                  {viewSettings.transcription && (
                    <div className="modal-row">
                      <span className="modal-label">Транскрипция</span>
                      <div className="modal-value">
                        <div>🇬🇧 UK {modalWord.ipaUk}</div>
                        <div>🇺🇸 US {modalWord.ipaUs}</div>
                      </div>
                    </div>
                  )}
                  {viewSettings.example && (
                    <div className="modal-row">
                      <span className="modal-label">Пример</span>
                      <div className="modal-value modal-example-block">
                        <div
                          className="word-example-text"
                          dangerouslySetInnerHTML={{
                            __html: highlightWordInExample(modalWord.example, modalWord.en),
                          }}
                        />
                        {viewSettings.exampleRu && modalWord.exampleRu && (
                          <div className="word-example-ru-under">{modalWord.exampleRu}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
      {isMobile && (
        <div className="dictionary-tabs-bar" role="tablist" aria-label="Выбор словаря">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "general"}
            className={`dictionary-tab-bar-btn ${tab === "general" ? "dictionary-tab-bar-btn--active" : ""}`}
            onClick={() => setTab("general")}
          >
            <span className="dictionary-tab-bar-btn-text">Общий словарь</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "personal"}
            className={`dictionary-tab-bar-btn ${tab === "personal" ? "dictionary-tab-bar-btn--active" : ""}`}
            onClick={() => {
              setTab("personal");
              setFilter("all");
            }}
          >
            <span className="dictionary-tab-bar-btn-text">Мой словарь</span>
          </button>
        </div>
      )}
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default DictionaryPage;
