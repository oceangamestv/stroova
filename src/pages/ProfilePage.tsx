import React, { useEffect, useState } from "react";
import Header from "../components/common/Header";
import { useAuth } from "../features/auth/AuthContext";
import {
  getAvailableVoices,
  initializeVoices,
  setPreferredVoiceUri,
  speakWord,
  VOICE_STORAGE_KEY_PREFIX,
} from "../utils/sounds";
import { dictionaryService } from "../services/dictionaryService";
import { authService } from "../services/authService";
import { getDisplayStats, isStatsCorrupted, sanitizeStatsForSave } from "../utils/displayStats";
import { formatXp } from "../domain/xp";
import { getProgressInLevel, LEVELS_TOTAL } from "../domain/levels";

/** Иконка: две карточки (поиск пары) */
const IconPairs: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="10" height="14" rx="1.5" />
    <rect x="11" y="6" width="10" height="14" rx="1.5" />
  </svg>
);

/** Иконка: пазл */
const IconPuzzle: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="5" y="9" width="14" height="10" rx="1.5" />
    <path d="M10 9V6a2 2 0 0 1 4 0v3M12 4v2" />
  </svg>
);

/** Иконка: викторина (галочка) */
const IconDanetka: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12l2 2 4-4" />
  </svg>
);

/** Иконка: выбор из вариантов (три точки) */
const IconOneOfThree: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="8" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="16" cy="12" r="2" />
  </svg>
);

const VOICE_DEFAULT = "";

const DAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function getLast7Days(): { date: string; label: string; shortLabel: string; dayOfWeek: number }[] {
  const out: { date: string; label: string; shortLabel: string; dayOfWeek: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay();
    out.push({
      date,
      label: `${DAY_LABELS[dayOfWeek]} ${d.getDate()}`,
      shortLabel: DAY_LABELS[dayOfWeek],
      dayOfWeek,
    });
  }
  return out;
}

function niceYMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  let step = 1;
  if (normalized <= 1) step = 1;
  else if (normalized <= 2) step = 2;
  else if (normalized <= 5) step = 5;
  else step = 10;
  return Math.ceil(value / (magnitude * step)) * magnitude * step;
}

function getDisplayName(user: { displayName?: string; username: string } | null): string {
  return user?.displayName ?? user?.username ?? "";
}

const ProfilePage: React.FC = () => {
  const { user, refresh, logout } = useAuth();
  const [voiceUri, setVoiceUri] = useState<string>(VOICE_DEFAULT);
  const [voiceOptions, setVoiceOptions] = useState<{ voiceURI: string; name: string }[]>([]);
  const [previewWord, setPreviewWord] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user?.stats || !isStatsCorrupted(user.stats)) return;
    const fixed = sanitizeStatsForSave(user.stats);
    authService.updateUserStats({
      totalXp: fixed.totalXp,
      exercisesCompleted: fixed.exercisesCompleted,
      pairsCompleted: fixed.pairsCompleted,
      puzzlesCompleted: fixed.puzzlesCompleted,
      bestScore: fixed.bestScore,
    });
    refresh();
  }, [user?.stats, refresh]);

  useEffect(() => {
    initializeVoices();
    setVoiceOptions(getAvailableVoices());
    const onVoicesChanged = () => setVoiceOptions(getAvailableVoices());
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
    }
  }, []);

  useEffect(() => {
    if (user) {
      const stored = localStorage.getItem(VOICE_STORAGE_KEY_PREFIX + user.username);
      setVoiceUri(stored ?? VOICE_DEFAULT);
    }
  }, [user?.username]);

  const currentDisplayName = getDisplayName(user);
  const streakDays = user?.activeDays?.streakDays ?? 0;

  const dictionarySource: "general" | "personal" =
    user?.gameSettings?.dictionarySource ?? "personal";

  const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setVoiceUri(value);
    if (!user) return;
    if (value === VOICE_DEFAULT) {
      localStorage.removeItem(VOICE_STORAGE_KEY_PREFIX + user.username);
      setPreferredVoiceUri(null);
    } else {
      localStorage.setItem(VOICE_STORAGE_KEY_PREFIX + user.username, value);
      setPreferredVoiceUri(value);
    }
  };

  const handleDictionarySourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as "general" | "personal";
    authService.updateGameSettings({ dictionarySource: value });
    refresh();
  };

  const pickRandomWord = () => {
    const words = dictionaryService.getRandomWords(1, "both");
    return words[0] ? words[0].en : "hello";
  };

  const handlePreviewVoice = () => {
    const word = pickRandomWord();
    setPreviewWord(word);
    setIsPlayingPreview(true);
    speakWord(word, "both", 0.85);
    setTimeout(() => setIsPlayingPreview(false), 2000);
  };

  const handleLogout = () => {
    if (confirm("Вы уверены, что хотите выйти?")) {
      logout();
    }
  };

  const stats = getDisplayStats(user?.stats);
  const xp = stats.totalXp ?? 0;
  const progress = getProgressInLevel(xp);
  const weekDays = getLast7Days();
  const xpByDate = stats.xpByDate ?? {};
  const weekData = weekDays.map((d) => ({ ...d, xp: xpByDate[d.date] ?? 0 }));
  const maxDayXp = Math.max(1, ...weekData.map((d) => d.xp));
  const weekTotalXp = weekData.reduce((sum, d) => sum + d.xp, 0);
  const yMax = niceYMax(maxDayXp);
  const yTicks = (() => {
    const step = yMax <= 10 ? 1 : yMax <= 100 ? 25 : yMax <= 500 ? 100 : 1000;
    const ticks: number[] = [];
    for (let v = 0; v <= yMax; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] !== yMax) ticks.push(yMax);
    return ticks;
  })();

  return (
    <div className="app-shell">
      <Header />
      <main className="main main--top">
        <div className="profile-card">
          {/* Герой: аватар + имя + уровень + серия */}
          <header className="profile-card__hero">
            <div className="profile-card__avatar" aria-hidden>
              <span className="profile-card__avatar-text">{currentDisplayName.slice(0, 2).toUpperCase()}</span>
            </div>
            <div className="profile-card__identity">
              <h1 className="profile-card__name">{currentDisplayName}</h1>
              <div className="profile-card__meta">
                <span className="profile-card__level">
                  Уровень <strong>{progress.level}</strong>
                </span>
                {streakDays > 0 && (
                  <span className="profile-card__streak" title="Дней подряд">
                    🔥 {streakDays}
                  </span>
                )}
              </div>
            </div>
          </header>

          {/* Статистика: общая и по играм */}
          <div className="profile-card__stats-grid">
            {/* Общая статистика */}
            <section className="profile-card__section profile-card__section--tile" aria-labelledby="profile-overall-heading">
              <h2 id="profile-overall-heading" className="profile-card__section-title">Общая статистика</h2>
              <div className="profile-card__overall-stats">
                <div className="profile-card__overall-stat">
                  <span className="profile-card__overall-stat-icon">🎯</span>
                  <div className="profile-card__overall-stat-content">
                    <span className="profile-card__overall-stat-value">{formatXp(xp)}</span>
                    <span className="profile-card__overall-stat-label">Опыт</span>
                  </div>
                </div>
                <div className="profile-card__overall-stat">
                  <span className="profile-card__overall-stat-icon">⭐</span>
                  <div className="profile-card__overall-stat-content">
                    <span className="profile-card__overall-stat-value">{formatXp(stats.bestScore)}</span>
                    <span className="profile-card__overall-stat-label">Рекорд</span>
                  </div>
                </div>
              </div>
              <div className="profile-card__progress">
                <div className="profile-card__progress-head">
                  <span>
                    {progress.level >= LEVELS_TOTAL ? "Макс. уровень" : "До след. уровня"}
                  </span>
                  <span className="profile-card__progress-nums">
                    {progress.level >= LEVELS_TOTAL
                      ? "—"
                      : `${formatXp(progress.currentXpInLevel)} / ${formatXp(progress.xpNeededForNext)}`}
                  </span>
                </div>
                <div className="profile-card__progress-bar">
                  <div
                    className="profile-card__progress-fill"
                    style={{
                      width: `${progress.level >= LEVELS_TOTAL ? 100 : progress.progressFraction * 100}%`,
                    }}
                  />
                </div>
              </div>
            </section>

            {/* Статистика по играм */}
            <section className="profile-card__section profile-card__section--tile" aria-labelledby="profile-games-heading">
              <h2 id="profile-games-heading" className="profile-card__section-title">По играм</h2>
              <div className="profile-card__games-list">
                <div className="profile-card__game-item">
                  <div className="profile-card__game-icon">
                    <IconPairs className="profile-card__game-icon-svg" />
                  </div>
                  <span className="profile-card__game-name">Поиск пары</span>
                  <span className="profile-card__game-count">{stats.pairsCompleted}</span>
                </div>
                <div className="profile-card__game-item">
                  <div className="profile-card__game-icon">
                    <IconPuzzle className="profile-card__game-icon-svg" />
                  </div>
                  <span className="profile-card__game-name">Puzzle Words</span>
                  <span className="profile-card__game-count">{stats.puzzlesCompleted}</span>
                </div>
                <div className="profile-card__game-item">
                  <div className="profile-card__game-icon">
                    <IconDanetka className="profile-card__game-icon-svg" />
                  </div>
                  <span className="profile-card__game-name">Данетка</span>
                  <span className="profile-card__game-count">0</span>
                </div>
                <div className="profile-card__game-item">
                  <div className="profile-card__game-icon">
                    <IconOneOfThree className="profile-card__game-icon-svg" />
                  </div>
                  <span className="profile-card__game-name">1 из 3</span>
                  <span className="profile-card__game-count">0</span>
                </div>
              </div>
            </section>
          </div>

          {/* График недели */}
          <section className="profile-card__section" aria-labelledby="profile-graph-heading">
            <div className="profile-card__graph-head">
              <h2 id="profile-graph-heading" className="profile-card__section-title">Неделя</h2>
              <span className="profile-card__graph-total">{formatXp(weekTotalXp)} XP</span>
            </div>
            <div className="profile-card__chart">
              <svg className="profile-card__chart-svg" viewBox="0 0 700 200" preserveAspectRatio="xMidYMid meet" aria-hidden>
                <defs>
                  <linearGradient id="profile-xp-line-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" className="profile-card__chart-stop-top" stopOpacity="0.35" />
                    <stop offset="100%" className="profile-card__chart-stop-bottom" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <g className="profile-card__chart-grid">
                  {yTicks.slice(0, -1).map((tick) => {
                    const y = 32 + (1 - tick / yMax) * 136;
                    return <line key={tick} x1={52} y1={y} x2={684} y2={y} />;
                  })}
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                    const x = 52 + (i / 6) * 632;
                    return <line key={i} x1={x} y1={32} x2={x} y2={168} />;
                  })}
                </g>
                <g className="profile-card__chart-axis-y" aria-hidden>
                  {yTicks.map((tick) => {
                    const y = 32 + (1 - tick / yMax) * 136;
                    return (
                      <text key={tick} x={48} y={y + 4} textAnchor="end">
                        {tick >= 1000 ? `${tick / 1000}k` : tick}
                      </text>
                    );
                  })}
                </g>
                <g className="profile-card__chart-axis-x" aria-hidden>
                  {weekData.map((d, i) => {
                    const x = 52 + (i / 6) * 632;
                    return (
                      <text key={d.date} x={x} y={188} textAnchor="middle">
                        {d.shortLabel}
                      </text>
                    );
                  })}
                </g>
                <path
                  className="profile-card__chart-area"
                  d={(() => {
                    const w = 632;
                    const h = 136;
                    const ox = 52;
                    const oy = 32 + h;
                    const pts = weekData.map((d, i) => {
                      const x = ox + (i / 6) * w;
                      const y = oy - (d.xp / yMax) * h;
                      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                    });
                    return `${pts.join(" ")} L ${ox + w} ${oy} L ${ox} ${oy} Z`;
                  })()}
                />
                <polyline
                  className="profile-card__chart-line"
                  points={weekData
                    .map((d, i) => {
                      const x = 52 + (i / 6) * 632;
                      const y = 32 + (1 - d.xp / yMax) * 136;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />
                <g className="profile-card__chart-points">
                  {weekData.map((d, i) => {
                    const x = 52 + (i / 6) * 632;
                    const y = 32 + (1 - d.xp / yMax) * 136;
                    return (
                      <circle
                        key={d.date}
                        cx={x}
                        cy={y}
                        r={5}
                        className="profile-card__chart-dot"
                        aria-hidden
                      />
                    );
                  })}
                </g>
              </svg>
            </div>
          </section>

          {/* Настройки: голос + словарь */}
          <section className="profile-card__section" aria-labelledby="profile-settings-heading">
            <h2 id="profile-settings-heading" className="profile-card__section-title">Настройки</h2>
            <div className="profile-card__settings">
              <div className="profile-card__setting">
                <label htmlFor="profile-voice" className="profile-card__setting-label">Голос</label>
                <div className="profile-card__setting-control">
                  <select
                    id="profile-voice"
                    value={voiceUri}
                    onChange={handleVoiceChange}
                    className="profile-card__select"
                  >
                    <option value={VOICE_DEFAULT}>По умолчанию</option>
                    {voiceOptions.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="profile-card__btn profile-card__btn--secondary"
                    onClick={handlePreviewVoice}
                    disabled={isPlayingPreview}
                  >
                    {isPlayingPreview ? "…" : "🔊"}
                  </button>
                </div>
                {previewWord && (
                  <span className="profile-card__preview">Пример: <em>{previewWord}</em></span>
                )}
              </div>
              <div className="profile-card__setting">
                <label htmlFor="profile-dictionary-source" className="profile-card__setting-label">Словарь в играх</label>
                <select
                  id="profile-dictionary-source"
                  value={dictionarySource}
                  onChange={handleDictionarySourceChange}
                  className="profile-card__select"
                >
                  <option value="personal">Мой словарь</option>
                  <option value="general">Общий словарь</option>
                </select>
              </div>
            </div>
          </section>

          <footer className="profile-card__footer">
            <button
              type="button"
              className="profile-card__logout"
              onClick={handleLogout}
            >
              Выйти из аккаунта
            </button>
          </footer>
        </div>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default ProfilePage;
