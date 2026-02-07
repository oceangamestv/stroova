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

const VOICE_DEFAULT = "";

const DAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function getLast7Days(): { date: string; label: string; shortLabel: string; dayOfWeek: number }[] {
  const out: { date: string; label: string; shortLabel: string; dayOfWeek: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay();
    const dayNum = d.getDate();
    out.push({
      date,
      label: `${DAY_LABELS[dayOfWeek]} ${dayNum}`,
      shortLabel: DAY_LABELS[dayOfWeek],
      dayOfWeek,
    });
  }
  return out;
}

/** Округляет максимум вверх до «красивого» шага для оси Y (как в Duolingo). */
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

/** Отображаемое имя: никнейм или логин. */
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
      <main className="main">
        <div className="profile-page">
          <div className="profile-hero">
            <div className="profile-avatar" aria-hidden>
              <span className="profile-avatar-inner">{currentDisplayName.slice(0, 2).toUpperCase()}</span>
            </div>
            <div className="profile-identity">
              <h1 className="profile-username">{currentDisplayName}</h1>
            </div>
            <div className="profile-level-badge">
              <span className="profile-level-num">{progress.level}</span>
              <span className="profile-level-label">уровень</span>
            </div>
          </div>

          <section className="profile-section profile-stats">
            <h2 className="profile-section-title">Статистика</h2>
            <div className="profile-stats-grid">
              <div className="profile-stat-card">
                <span className="profile-stat-icon">🎯</span>
                <span className="profile-stat-value">{formatXp(xp)}</span>
                <span className="profile-stat-label">Опыт (XP)</span>
              </div>
              <div className="profile-stat-card">
                <span className="profile-stat-icon">🃏</span>
                <span className="profile-stat-value">{stats.pairsCompleted}</span>
                <span className="profile-stat-label">Игр «Поиск пары»</span>
              </div>
              <div className="profile-stat-card">
                <span className="profile-stat-icon">🧩</span>
                <span className="profile-stat-value">{stats.puzzlesCompleted}</span>
                <span className="profile-stat-label">Игр «Puzzle»</span>
              </div>
              <div className="profile-stat-card profile-stat-card--best">
                <span className="profile-stat-icon">⭐</span>
                <span className="profile-stat-value">{formatXp(stats.bestScore)}</span>
                <span className="profile-stat-label">Лучший результат</span>
              </div>
            </div>
            <div className="profile-level-progress">
              <div className="profile-level-progress-head">
                <span>
                  {progress.level >= LEVELS_TOTAL ? "Максимальный уровень" : "До следующего уровня"}
                </span>
                <span className="profile-level-progress-nums">
                  {progress.level >= LEVELS_TOTAL
                    ? "—"
                    : `${formatXp(progress.currentXpInLevel)} / ${formatXp(progress.xpNeededForNext)} XP`}
                </span>
              </div>
              <div className="profile-level-progress-bar">
                <div
                  className="profile-level-progress-fill"
                  style={{
                    width: `${progress.level >= LEVELS_TOTAL ? 100 : progress.progressFraction * 100}%`,
                  }}
                />
              </div>
            </div>
          </section>

          <section className="profile-section profile-graph">
            <div className="profile-graph-header">
              <h2 className="profile-section-title profile-graph-title">Опыт за неделю</h2>
              <div className="profile-graph-legend">
                <span className="profile-graph-legend-dot" aria-hidden />
                <span className="profile-graph-legend-label">{formatXp(weekTotalXp)} XP</span>
              </div>
            </div>
            <div className="profile-week-chart profile-week-chart--line">
              <svg className="profile-week-chart-svg" viewBox="0 0 700 200" preserveAspectRatio="xMidYMid meet" aria-hidden>
                <defs>
                  <linearGradient id="profile-xp-line-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" className="profile-chart-gradient-top" stopOpacity="0.35" />
                    <stop offset="100%" className="profile-chart-gradient-bottom" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Grid */}
                <g className="profile-week-chart-grid">
                  {yTicks.slice(0, -1).map((tick) => {
                    const y = 32 + (1 - tick / yMax) * 136;
                    return (
                      <line key={tick} x1={52} y1={y} x2={684} y2={y} />
                    );
                  })}
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                    const x = 52 + (i / 6) * 632;
                    return <line key={i} x1={x} y1={32} x2={x} y2={168} />;
                  })}
                </g>
                {/* Y-axis labels */}
                <g className="profile-week-chart-axis-y" aria-hidden>
                  {yTicks.map((tick) => {
                    const y = 32 + (1 - tick / yMax) * 136;
                    return (
                      <text key={tick} x={48} y={y + 4} textAnchor="end">
                        {tick >= 1000 ? `${tick / 1000}k` : tick}
                      </text>
                    );
                  })}
                </g>
                {/* X-axis labels */}
                <g className="profile-week-chart-axis-x" aria-hidden>
                  {weekData.map((d, i) => {
                    const x = 52 + (i / 6) * 632;
                    return (
                      <text key={d.date} x={x} y={188} textAnchor="middle">
                        {d.shortLabel}
                      </text>
                    );
                  })}
                </g>
                {/* Area fill under line */}
                <path
                  className="profile-week-chart-area"
                  d={ (() => {
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
                {/* Line */}
                <polyline
                  className="profile-week-chart-line"
                  points={weekData
                    .map((d, i) => {
                      const x = 52 + (i / 6) * 632;
                      const y = 32 + (1 - d.xp / yMax) * 136;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />
                {/* Data points */}
                <g className="profile-week-chart-points">
                  {weekData.map((d, i) => {
                    const x = 52 + (i / 6) * 632;
                    const y = 32 + (1 - d.xp / yMax) * 136;
                    return (
                      <circle
                        key={d.date}
                        cx={x}
                        cy={y}
                        r={5}
                        className="profile-week-chart-dot"
                        aria-hidden
                      />
                    );
                  })}
                </g>
              </svg>
            </div>
          </section>

          <section className="profile-section profile-voice">
            <h2 className="profile-section-title">Голос озвучивания</h2>
            <p className="profile-section-desc">Голос для слов в упражнениях и словаре.</p>
            <div className="profile-voice-row">
              <select
                id="profile-voice"
                value={voiceUri}
                onChange={handleVoiceChange}
                className="profile-voice-select"
              >
                <option value={VOICE_DEFAULT}>По умолчанию (системный)</option>
                {voiceOptions.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="profile-btn profile-btn--secondary"
                onClick={handlePreviewVoice}
                disabled={isPlayingPreview}
              >
                {isPlayingPreview ? "…" : "🔊"} Прослушать
              </button>
            </div>
            {previewWord && (
              <span className="profile-voice-preview">Пример: <em>{previewWord}</em></span>
            )}
          </section>

          <section className="profile-section profile-actions">
            <button
              type="button"
              className="profile-logout-btn"
              onClick={handleLogout}
            >
              Выйти из аккаунта
            </button>
          </section>
        </div>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default ProfilePage;
