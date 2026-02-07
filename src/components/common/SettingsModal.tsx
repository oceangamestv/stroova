import React, { useEffect, useState } from "react";
import { useAuth } from "../../features/auth/AuthContext";
import {
  getAvailableVoices,
  initializeVoices,
  setPreferredVoiceUri,
  VOICE_STORAGE_KEY_PREFIX,
} from "../../utils/sounds";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const VOICE_DEFAULT = "";

function getDisplayName(user: { displayName?: string; username: string } | null): string {
  return user?.displayName ?? user?.username ?? "";
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { user, updateDisplayName } = useAuth();
  const [nickname, setNickname] = useState(getDisplayName(user));
  const [voiceUri, setVoiceUri] = useState<string>(VOICE_DEFAULT);
  const [voiceOptions, setVoiceOptions] = useState<{ voiceURI: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    initializeVoices();
    setVoiceOptions(getAvailableVoices());
    const onVoicesChanged = () => setVoiceOptions(getAvailableVoices());
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && user) {
      setNickname(getDisplayName(user));
      const stored = localStorage.getItem(VOICE_STORAGE_KEY_PREFIX + user.username);
      setVoiceUri(stored ?? VOICE_DEFAULT);
      setError("");
      setSuccess(false);
    }
  }, [isOpen, user?.username, user?.displayName]);

  const trimmed = nickname.trim();
  const currentDisplayName = getDisplayName(user);
  const saveDisabled = trimmed === currentDisplayName || trimmed.length < 1;

  const handleBlur = () => {
    if (trimmed.length === 0) setError("Введите никнейм");
    else setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    if (!user) return;
    const result = await updateDisplayName(nickname);
    if (!result.success) {
      setError(result.error ?? "Ошибка сохранения");
      return;
    }
    if (voiceUri === VOICE_DEFAULT) {
      localStorage.removeItem(VOICE_STORAGE_KEY_PREFIX + user.username);
      setPreferredVoiceUri(null);
    } else {
      localStorage.setItem(VOICE_STORAGE_KEY_PREFIX + user.username, voiceUri);
      setPreferredVoiceUri(voiceUri);
    }
    setSuccess(true);
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

  if (!isOpen) return null;

  return (
    <div className="modal settings-modal" onClick={onClose} role="presentation">
      <div
        className="modal-content settings-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        <h2 id="settings-title" className="settings-modal-title">
          Настройки
        </h2>
        <form className="settings-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="settings-nickname">Никнейм</label>
            <input
              type="text"
              id="settings-nickname"
              placeholder="Введите никнейм"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                setError("");
              }}
              onBlur={handleBlur}
              autoComplete="username"
              minLength={3}
            />
          </div>
          <div className="form-group">
            <label htmlFor="settings-voice">Голос озвучивания</label>
            <select
              id="settings-voice"
              value={voiceUri}
              onChange={handleVoiceChange}
              className="settings-voice-select"
            >
              <option value={VOICE_DEFAULT}>По умолчанию (системный)</option>
              {voiceOptions.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
            <span className="form-hint">Используется при озвучке слов на всём сайте</span>
          </div>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">Никнейм успешно изменён</div>}
          <div className="settings-modal-actions">
            <button type="button" className="secondary-btn" onClick={onClose}>
              Закрыть
            </button>
            <button type="submit" className="primary-btn" disabled={saveDisabled}>
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;
