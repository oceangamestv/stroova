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
import type { UserStats } from "../data/contracts/types";
import { formatXp } from "../domain/xp";
import { getProgressInLevel, LEVELS_TOTAL } from "../domain/levels";
import { getDisplayStats, isStatsCorrupted, sanitizeStatsForSave } from "../utils/displayStats";
import { authService } from "../services/authService";

const VOICE_DEFAULT = "";

function getDisplayName(user: { displayName?: string; username: string } | null): string {
  return user?.displayName ?? user?.username ?? "";
}

const SettingsPage: React.FC = () => {
  const { user, refresh, updateDisplayName } = useAuth();
  const [nickname, setNickname] = useState(getDisplayName(user));
  const [voiceUri, setVoiceUri] = useState<string>(VOICE_DEFAULT);
  const [voiceOptions, setVoiceOptions] = useState<{ voiceURI: string; name: string }[]>([]);
  const [nickError, setNickError] = useState("");
  const [nickSuccess, setNickSuccess] = useState(false);
  const [previewWord, setPreviewWord] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  // При открытии страницы подтягиваем актуальные данные пользователя из базы (прогресс, опыт, счётчики).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Однократная починка битой статистики в хранилище (завышенные счётчики из-за старых багов).
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
      setNickname(getDisplayName(user));
      const stored = localStorage.getItem(VOICE_STORAGE_KEY_PREFIX + user.username);
      setVoiceUri(stored ?? VOICE_DEFAULT);
    }
  }, [user?.username, user?.displayName]);

  const trimmed = nickname.trim();
  const currentDisplayName = getDisplayName(user);
  const nickSaveDisabled = trimmed === currentDisplayName || trimmed.length < 1;

  const handleNickBlur = () => {
    if (trimmed.length === 0) setNickError("Введите никнейм");
    else setNickError("");
  };

  const handleNickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nickSaveDisabled || !user) return;
    setNickError("");
    setNickSuccess(false);
    const result = await updateDisplayName(nickname);
    if (result.success) setNickSuccess(true);
    else setNickError(result.error ?? "Ошибка сохранения");
  };

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

  // Реальные данные из учётной записи, приведённые к разумным значениям для отображения (защита от битых данных).
  const stats = getDisplayStats(user?.stats);
  const xp = stats.totalXp ?? 0;
  const progress = getProgressInLevel(xp);
  const bestScoreDisplay = stats.bestScore;

  return (
    <div className="app-shell">
      <Header />
      <main className="main">
        <div className="settings-page">
          <h1 className="settings-page-title">Настройки</h1>
          <p className="settings-page-subtitle">Профиль и предпочтения</p>

          <section className="settings-section">
            <h2 className="settings-section-title">Профиль</h2>
            <form className="settings-form settings-form--block" onSubmit={handleNickSubmit}>
              <div className="form-group">
                <label htmlFor="settings-nickname">Никнейм</label>
                <input
                  type="text"
                  id="settings-nickname"
                  placeholder="Введите никнейм"
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setNickError("");
                  }}
                  onBlur={handleNickBlur}
                  autoComplete="username"
                  minLength={3}
                  className="settings-input"
                />
              </div>
              {nickError && <div className="form-error">{nickError}</div>}
              {nickSuccess && <div className="form-success">Никнейм успешно изменён</div>}
              <button type="submit" className="primary-btn" disabled={nickSaveDisabled}>
                Сохранить никнейм
              </button>
            </form>
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">Голосовой помощник</h2>
            <p className="settings-section-desc">Голос для озвучки слов в упражнениях и словаре.</p>
            <div className="form-group">
              <label htmlFor="settings-voice">Голос</label>
              <select
                id="settings-voice"
                value={voiceUri}
                onChange={handleVoiceChange}
                className="settings-voice-select settings-select"
              >
                <option value={VOICE_DEFAULT}>По умолчанию (системный)</option>
                {voiceOptions.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="voice-preview">
              <button
                type="button"
                className="secondary-btn voice-preview-btn"
                onClick={handlePreviewVoice}
                disabled={isPlayingPreview}
              >
                {isPlayingPreview ? "…" : "🔊"} Прослушать на случайном слове
              </button>
              {previewWord && (
                <span className="voice-preview-word">
                  Пример: <em>{previewWord}</em>
                </span>
              )}
            </div>
          </section>

          <section className="settings-section" aria-labelledby="stats-section-title" id="profile-stats">
            <h2 id="stats-section-title" className="settings-section-title">Статистика и прогресс</h2>
            <p className="settings-section-desc">Опыт и уровень на основе вашей активности.</p>
            <div className="stats-cards">
              <div className="stats-card stats-card--level">
                <span className="stats-card-label">Уровень</span>
                <span className="stats-card-value stats-card-value--level" aria-live="polite">{progress.level}</span>
              </div>
              <div className="stats-card">
                <span className="stats-card-label">Опыт (XP)</span>
                <span className="stats-card-value" aria-live="polite">{formatXp(xp)}</span>
              </div>
              <div className="stats-card stats-card--progress">
                <span className="stats-card-label">
                  {progress.level >= LEVELS_TOTAL ? "Максимальный уровень" : "До следующего уровня"}
                </span>
                <div className="stats-progress-bar">
                  <div
                    className="stats-progress-fill"
                    style={{
                      width: `${progress.xpNeededForNext > 0 ? progress.progressFraction * 100 : 100}%`,
                    }}
                  />
                </div>
                <span className="stats-progress-text">
                  {progress.level >= LEVELS_TOTAL
                    ? "—"
                    : `${formatXp(progress.currentXpInLevel)} / ${formatXp(progress.xpNeededForNext)} XP`}
                </span>
              </div>
            </div>
            <div className="stats-details">
              <ul className="stats-list" aria-label="Статистика прогресса">
                <li>Упражнений пройдено: <strong>{stats.exercisesCompleted}</strong></li>
                <li>Пар собрано: <strong>{stats.pairsCompleted}</strong></li>
                <li>Puzzle пройдено: <strong>{stats.puzzlesCompleted}</strong></li>
                <li>Лучший результат (XP за сессию): <strong>{formatXp(bestScoreDisplay)}</strong></li>
              </ul>
            </div>
          </section>
        </div>
      </main>
      <footer className="footer">STroova</footer>
    </div>
  );
};

export default SettingsPage;
