/** URI выбранного голоса из настроек; null = по умолчанию Bella */
let preferredVoiceUri: string | null = null;

let globalAudioContext: AudioContext | null = null;

/** Ключ localStorage: включён ли звук в упражнениях (по умолчанию да). */
const SOUND_ENABLED_KEY = "stroova_sound_enabled";

/** Минимальный тихий WAV для обхода iOS (медиа-канал вместо звонка). */
const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/** Читает, включён ли звук (из localStorage). По умолчанию true. */
export const getSoundEnabled = (): boolean => {
  try {
    return localStorage.getItem(SOUND_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
};

/** Включает/выключает звук. При включении вызывает обход беззвучного режима на iOS. */
export const setSoundEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
  if (enabled) {
    ensureMediaPlaybackOnIOS();
  }
};

/**
 * На iOS: переводит воспроизведение в медиа-канал, чтобы звук шёл даже при беззвучном режиме.
 * iOS 17+: Audio Session API. Старые iOS: тихий <audio> в фоне.
 */
export const ensureMediaPlaybackOnIOS = (): void => {
  if (typeof navigator === "undefined") return;
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession !== undefined && typeof nav.audioSession.type !== "undefined") {
      nav.audioSession.type = "playback";
      return;
    }
  } catch {
    // ignore
  }
  try {
    const el = document.createElement("audio");
    el.src = SILENT_WAV_DATA_URL;
    el.setAttribute("playsinline", "true");
    el.volume = 0;
    el.play().catch(() => {});
  } catch {
    // ignore
  }
};

/** Единственные голоса в приложении: Bella (женский), Michael (мужской) */
const VOICES = {
  BELLA: "af_bella",
  MICHAEL: "am_michael",
} as const;

/** Папка по голосу: female / male (am_* → male, остальные → female) */
function getVoiceFolder(voiceUri: string): "female" | "male" {
  const v = voiceUri.startsWith("kokoro:") ? voiceUri.replace("kokoro:", "") : voiceUri;
  return v.startsWith("am_") ? "male" : "female";
}

/** Слово → безопасное имя файла (совпадает с server/generate-audio.mjs) */
function wordToSlug(en: string): string {
  return String(en)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

const getAudioContext = (): AudioContext => {
  if (!globalAudioContext) {
    globalAudioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (globalAudioContext.state === "suspended") {
    globalAudioContext.resume();
  }
  return globalAudioContext;
};

/** Устанавливает голос озвучивания (Bella или Michael). */
export const setPreferredVoiceUri = (uri: string | null) => {
  preferredVoiceUri = uri;
};

/** Воспроизводит AudioBuffer через Web Audio API или HTMLAudioElement */
const playAudioBuffer = async (audioBuffer: AudioBuffer, rate?: number): Promise<void> => {
  try {
    try {
      const audioContext = getAudioContext();
      const source = audioContext.createBufferSource();
      const gainNode = audioContext.createGain();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      if (rate !== undefined) source.playbackRate.value = rate;
      gainNode.gain.value = 1.0;
      source.start(0);
      return;
    } catch {
      // fallback
    }
    const audioContext = getAudioContext();
    const wavBlob = await audioBufferToWav(audioBuffer);
    const audioUrl = URL.createObjectURL(wavBlob);
    const audio = new Audio(audioUrl);
    if (rate !== undefined) audio.playbackRate = rate;
    audio.volume = 1.0;
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        reject(new Error("Audio playback failed"));
      };
      audio.play().catch(reject);
    });
  } catch (error) {
    console.error("Error playing audio:", error);
  }
};

const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const length = buffer.length;
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
  const view = new DataView(arrayBuffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * numberOfChannels * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * 2, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length * numberOfChannels * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
};

/** URL предгенерированного WAV: /audio/female/{slug}.wav или /audio/male/{slug}.wav */
export const getPreGeneratedAudioUrl = (voice: string, wordEn: string): string => {
  const folder = getVoiceFolder(voice);
  const slug = wordToSlug(wordEn);
  return `/audio/${folder}/${slug}.wav`;
};

/** Базовый URL сайта (без /api) для загрузки озвучки с сервера в мобильном приложении. */
function getAudioBaseUrl(): string {
  try {
    const env = (typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env) || {};
    const apiUrl = (env.VITE_API_URL || "").trim();
    if (!apiUrl) return "";
    return apiUrl.replace(/\/api\/?$/i, "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** Воспроизведение предгенерированного файла по английскому слову. В браузере — относительный /audio/... (тот же домен). В приложении — абсолютный URL сервера. */
const tryPlayPreGenerated = async (
  wordEn: string,
  voice: string,
  rate?: number
): Promise<boolean> => {
  const path = getPreGeneratedAudioUrl(voice, wordEn);
  const base = getAudioBaseUrl();
  const url = base ? `${base}${path}` : path;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    const audioContext = getAudioContext();
    const audioBuffer = await audioContext.decodeAudioData(buf);
    await playAudioBuffer(audioBuffer, rate);
    return true;
  } catch {
    return false;
  }
};

/** Озвучивает слово: предгенерированные файлы (Bella/Michael) с сайта или с сервера. */
export const speakWord = async (
  word: string,
  _accent: "UK" | "US" | "both" = "both",
  rate?: number
): Promise<void> => {
  if (!getSoundEnabled()) return;
  const voice = preferredVoiceUri || `kokoro:${VOICES.BELLA}`;
  await tryPlayPreGenerated(word, voice, rate);
};

/** Короткий чёткий звук ошибки (низкий тон) */
export const playErrorSound = (): void => {
  if (!getSoundEnabled()) return;
  try {
    const audioContext = getAudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = 200;
    oscillator.type = "sine";
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch {
    // ignore
  }
};

/** Короткий звонкий звук при правильном ответе (два быстрых тона) */
export const playCorrectSound = (): void => {
  if (!getSoundEnabled()) return;
  try {
    const ctx = getAudioContext();
    const t0 = ctx.currentTime;
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);
    gainNode.gain.setValueAtTime(0, t0);
    gainNode.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, t0 + 0.12);
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(660, t0);
    osc1.frequency.setValueAtTime(880, t0 + 0.06);
    osc1.connect(gainNode);
    osc1.start(t0);
    osc1.stop(t0 + 0.12);
  } catch {
    // ignore
  }
};

export const initializeVoices = async (): Promise<void> => {
  // Голоса только Bella и Michael, предзагрузка TTS не нужна
};

/** Ключ в localStorage для голоса по логину пользователя */
export const VOICE_STORAGE_KEY_PREFIX = "stroova_voice_";

/** Доступные голоса: только Bella и Michael. */
export const getAvailableVoices = (): { voiceURI: string; name: string }[] => [
  { voiceURI: `kokoro:${VOICES.BELLA}`, name: "Bella" },
  { voiceURI: `kokoro:${VOICES.MICHAEL}`, name: "Michael" },
];
