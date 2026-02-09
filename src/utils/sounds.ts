import { KokoroTTS } from "kokoro-js";
import { loadAudio, saveAudio } from "./audioStorage";
import type { Word } from "../data/contracts/types";

let speechSynthesisRef: SpeechSynthesis | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let kokoroTTS: KokoroTTS | null = null;
let kokoroInitializing = false;
let kokoroInitialized = false;

/** URI или name выбранного голоса из настроек; null = по умолчанию по акценту */
let preferredVoiceUri: string | null = null;

// Единый AudioContext для воспроизведения (не закрываем его)
let globalAudioContext: AudioContext | null = null;

// Локальные голоса Kokoro TTS (2 женских, 2 мужских с высокими рейтингами)
const KOKORO_VOICES = {
  US_FEMALE: "af_heart", // Американский женский - один из лучших
  US_MALE: "am_adam", // Американский мужской - популярный
  UK_FEMALE: "bf_emma", // Британский женский - качественный
  UK_MALE: "bm_daniel", // Британский мужской - естественный
} as const;

if ("speechSynthesis" in window) {
  speechSynthesisRef = window.speechSynthesis;
}

/** Получает или создает глобальный AudioContext */
const getAudioContext = (): AudioContext => {
  if (!globalAudioContext) {
    globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Возобновляем контекст если он приостановлен
  if (globalAudioContext.state === "suspended") {
    globalAudioContext.resume();
  }
  return globalAudioContext;
};

/** Проверяет доступность WebGPU */
const isWebGPUSupported = (): boolean => {
  try {
    return typeof navigator !== "undefined" && "gpu" in navigator && typeof navigator.gpu !== "undefined";
  } catch {
    return false;
  }
};

/** Инициализация Kokoro TTS с поддержкой WebGPU */
const initializeKokoro = async (): Promise<boolean> => {
  if (kokoroInitialized || kokoroInitializing) return kokoroInitialized;
  
  try {
    kokoroInitializing = true;
    // Используем WebGPU если доступно, иначе WASM (быстрее чем CPU)
    const device = isWebGPUSupported() ? "webgpu" : "wasm";
    kokoroTTS = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8", // Квантованная версия для быстрой загрузки (~86MB)
      device: device as "webgpu" | "wasm",
    });
    kokoroInitialized = true;
    return true;
  } catch (error) {
    console.warn("Failed to initialize Kokoro TTS:", error);
    kokoroInitialized = false;
    return false;
  } finally {
    kokoroInitializing = false;
  }
};

/** Проверяет, доступны ли системные голоса */
const hasSystemVoices = (): boolean => {
  if (!speechSynthesisRef) return false;
  const voices = speechSynthesisRef.getVoices();
  return voices.length > 0 && voices.some((v) => v.lang.startsWith("en"));
};

/** Устанавливает голос озвучивания для пользователя (вызывается при загрузке и при сохранении настроек). */
export const setPreferredVoiceUri = (uri: string | null) => {
  preferredVoiceUri = uri;
};

const getVoiceForAccent = (accent: "UK" | "US" | "both") => {
  if (!speechSynthesisRef) return null;
  const voices = speechSynthesisRef.getVoices();

  if (preferredVoiceUri) {
    const preferred = voices.find(
      (v) => v.voiceURI === preferredVoiceUri || v.name === preferredVoiceUri
    );
    if (preferred) return preferred;
  }

  let preferredVoices: SpeechSynthesisVoice[] = [];
  if (accent === "UK") {
    preferredVoices = voices.filter(
      (voice) =>
        voice.lang.includes("en-GB") ||
        voice.name.includes("British") ||
        voice.name.includes("UK")
    );
  } else if (accent === "US") {
    preferredVoices = voices.filter(
      (voice) =>
        voice.lang.includes("en-US") ||
        (voice.lang.includes("en") && !voice.lang.includes("GB"))
    );
  } else {
    preferredVoices = voices.filter((voice) => voice.lang.startsWith("en"));
  }

  if (preferredVoices.length > 0) return preferredVoices[0];
  const englishVoices = voices.filter((voice) => voice.lang.startsWith("en"));
  return englishVoices.length > 0 ? englishVoices[0] : voices[0] || null;
};

/** Получает голос Kokoro TTS по акценту */
const getKokoroVoice = (accent: "UK" | "US" | "both"): string => {
  if (accent === "UK") {
    return KOKORO_VOICES.UK_FEMALE; // По умолчанию женский для UK
  } else if (accent === "US") {
    return KOKORO_VOICES.US_FEMALE; // По умолчанию женский для US
  }
  return KOKORO_VOICES.US_FEMALE; // По умолчанию US женский
};

/** Воспроизводит AudioBuffer через Web Audio API или HTMLAudioElement */
const playAudioBuffer = async (audioBuffer: AudioBuffer, rate?: number): Promise<void> => {
  try {
    // Пробуем использовать Web Audio API
    try {
      const audioContext = getAudioContext();
      const source = audioContext.createBufferSource();
      const gainNode = audioContext.createGain();
      
      source.buffer = audioBuffer;
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      if (rate !== undefined) {
        source.playbackRate.value = rate;
      }
      
      // Устанавливаем нормальную громкость
      gainNode.gain.value = 1.0;
      
      source.start(0);
      return;
    } catch (webAudioError) {
      // Если Web Audio API не работает, используем HTMLAudioElement
      console.warn("Web Audio API failed, using HTMLAudioElement:", webAudioError);
    }
    
    // Fallback: используем HTMLAudioElement (более надежно в Telegram и других WebView)
    const audioContext = getAudioContext();
    const wavBlob = await audioBufferToWav(audioBuffer);
    const audioUrl = URL.createObjectURL(wavBlob);
    
    const audio = new Audio(audioUrl);
    if (rate !== undefined) {
      audio.playbackRate = rate;
    }
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

/** Конвертирует AudioBuffer в WAV Blob */
const audioBufferToWav = async (buffer: AudioBuffer): Promise<Blob> => {
  const length = buffer.length;
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
  const view = new DataView(arrayBuffer);
  
  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
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
  
  // Convert float32 to int16
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: "audio/wav" });
};

/** Генерирует и сохраняет аудио для слова */
const generateAndSaveAudio = async (
  word: string,
  voice: string,
  accent: string
): Promise<AudioBuffer | null> => {
  if (!kokoroTTS) {
    const initialized = await initializeKokoro();
    if (!initialized || !kokoroTTS) {
      console.warn("Kokoro TTS not available");
      return null;
    }
  }

  try {
    // Генерируем аудио
    const audio = await kokoroTTS.generate(word, { voice });
    const audioBlob = await audio.toBlob();
    
    // Декодируем
    const audioContext = getAudioContext();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Сохраняем в IndexedDB
    await saveAudio(word, voice, accent, arrayBuffer);
    
    return audioBuffer;
  } catch (error) {
    console.error("Error generating audio:", error);
    return null;
  }
};

/** Воспроизведение через Kokoro TTS с использованием IndexedDB */
const speakWithKokoro = async (
  word: string,
  accent: "UK" | "US" | "both" = "both",
  rate?: number,
  voiceOverride?: string
): Promise<void> => {
  try {
    // Определяем голос
    let voice = voiceOverride;
    if (!voice || !voice.startsWith("kokoro:")) {
      voice = getKokoroVoice(accent);
    } else {
      voice = voice.replace("kokoro:", "");
    }
    
    // Пытаемся загрузить из IndexedDB
    const cachedArrayBuffer = await loadAudio(word, voice, accent);
    
    if (cachedArrayBuffer) {
      // Найдено в IndexedDB - декодируем и воспроизводим мгновенно
      const audioContext = getAudioContext();
      const audioBuffer = await audioContext.decodeAudioData(cachedArrayBuffer);
      await playAudioBuffer(audioBuffer, rate);
      return;
    }
    
    // Не найдено - генерируем, сохраняем и воспроизводим
    const audioBuffer = await generateAndSaveAudio(word, voice, accent);
    if (audioBuffer) {
      await playAudioBuffer(audioBuffer, rate);
    }
  } catch (error) {
    console.error("Error speaking with Kokoro TTS:", error);
  }
};

export const speakWord = async (
  word: string,
  accent: "UK" | "US" | "both" = "both",
  rate?: number
) => {
  // Проверяем, выбран ли голос Kokoro в настройках
  const useKokoro = preferredVoiceUri && preferredVoiceUri.startsWith("kokoro:");
  
  // Используем Kokoro TTS, если выбран голос Kokoro или системные голоса недоступны
  if (useKokoro || !hasSystemVoices()) {
    // Выполняем асинхронно без блокировки UI
    speakWithKokoro(word, accent, rate, preferredVoiceUri || undefined).catch((error) => {
      console.error("Error in speakWithKokoro:", error);
    });
    return;
  }
  
  // Используем Web Speech API, если доступны системные голоса
  if (speechSynthesisRef) {
    if (currentUtterance) {
      speechSynthesisRef.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = accent === "UK" ? "en-GB" : "en-US";
    utterance.rate = rate ?? 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    const voice = getVoiceForAccent(accent);
    if (voice) utterance.voice = voice;
    currentUtterance = utterance;
    speechSynthesisRef.speak(utterance);
  }
};

export const playErrorSound = () => {
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

export const initializeVoices = async () => {
  if (!speechSynthesisRef) return;
  if (speechSynthesisRef.getVoices().length === 0) {
    speechSynthesisRef.addEventListener("voiceschanged", () => {});
  }
  
  // Проверяем, нужно ли предзагрузить Kokoro
  const useKokoro = preferredVoiceUri && preferredVoiceUri.startsWith("kokoro:");
  const shouldPreloadKokoro = useKokoro || !hasSystemVoices();
  
  if (shouldPreloadKokoro) {
    // Предзагружаем модель при старте приложения
    initializeKokoro().catch(() => {
      // Игнорируем ошибки при предзагрузке
    });
  }
};

/** Предгенерация аудио для всего словаря */
export const pregenerateDictionaryAudio = async (
  words: Word[],
  onProgress?: (current: number, total: number) => void
): Promise<void> => {
  if (!kokoroTTS) {
    const initialized = await initializeKokoro();
    if (!initialized || !kokoroTTS) {
      console.warn("Kokoro TTS not available for pregeneration");
      return;
    }
  }

  let processed = 0;
  const total = words.length;

  // Генерируем по одному слову за раз, чтобы не перегружать браузер
  for (const word of words) {
    try {
      const accent = word.accent || "both";
      const voice = getKokoroVoice(accent);
      
      // Проверяем, есть ли уже в IndexedDB
      const exists = await loadAudio(word.en, voice, accent);
      if (exists) {
        processed++;
        onProgress?.(processed, total);
        continue;
      }
      
      // Генерируем и сохраняем
      await generateAndSaveAudio(word.en, voice, accent);
      processed++;
      onProgress?.(processed, total);
      
      // Небольшая задержка между словами, чтобы не перегружать систему
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error(`Error pregenerating audio for word "${word.en}":`, error);
      processed++;
      onProgress?.(processed, total);
    }
  }
};

/** Ключ в localStorage для голоса по логину пользователя */
export const VOICE_STORAGE_KEY_PREFIX = "stroova_voice_";

/** Доступные английские голоса для настроек (системные + локальные Kokoro). */
export const getAvailableVoices = (): { voiceURI: string; name: string }[] => {
  const voices: { voiceURI: string; name: string }[] = [];
  
  // Добавляем системные голоса, если доступны
  if (speechSynthesisRef) {
    const systemVoices = speechSynthesisRef.getVoices();
    const en = systemVoices.filter((v) => v.lang.startsWith("en"));
    voices.push(...en.slice(0, 10).map((v) => ({ voiceURI: v.voiceURI, name: v.name })));
  }
  
  // Добавляем локальные голоса Kokoro TTS, если системные недоступны
  if (voices.length === 0 || !hasSystemVoices()) {
    voices.push(
      { voiceURI: `kokoro:${KOKORO_VOICES.US_FEMALE}`, name: "Kokoro US Female (Heart)" },
      { voiceURI: `kokoro:${KOKORO_VOICES.US_MALE}`, name: "Kokoro US Male (Adam)" },
      { voiceURI: `kokoro:${KOKORO_VOICES.UK_FEMALE}`, name: "Kokoro UK Female (Emma)" },
      { voiceURI: `kokoro:${KOKORO_VOICES.UK_MALE}`, name: "Kokoro UK Male (Daniel)" }
    );
  }
  
  return voices;
};
