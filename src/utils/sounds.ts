import { KokoroTTS } from "kokoro-js";

let speechSynthesisRef: SpeechSynthesis | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let kokoroTTS: KokoroTTS | null = null;
let kokoroInitializing = false;
let kokoroInitialized = false;

/** URI или name выбранного голоса из настроек; null = по умолчанию по акценту */
let preferredVoiceUri: string | null = null;

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

/** Инициализация Kokoro TTS (ленивая загрузка) */
const initializeKokoro = async (): Promise<boolean> => {
  if (kokoroInitialized || kokoroInitializing) return kokoroInitialized;
  
  try {
    kokoroInitializing = true;
    kokoroTTS = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8", // Используем квантованную версию для быстрой загрузки (~86MB)
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

/** Воспроизведение через Kokoro TTS */
const speakWithKokoro = async (
  word: string,
  accent: "UK" | "US" | "both" = "both",
  rate?: number,
  voiceOverride?: string
): Promise<void> => {
  if (!kokoroTTS) {
    const initialized = await initializeKokoro();
    if (!initialized || !kokoroTTS) {
      console.warn("Kokoro TTS not available");
      return;
    }
  }

  try {
    // Используем переданный голос или выбираем по акценту
    let voice = voiceOverride;
    if (!voice || !voice.startsWith("kokoro:")) {
      voice = getKokoroVoice(accent);
    } else {
      // Извлекаем имя голоса из формата "kokoro:af_heart"
      voice = voice.replace("kokoro:", "");
    }
    
    const audio = await kokoroTTS.generate(word, { voice });
    
    // Конвертируем RawAudio в Blob и воспроизводим через Web Audio API
    const audioBlob = await audio.toBlob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    source.buffer = audioBuffer;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Применяем скорость (rate) через изменение playbackRate
    if (rate !== undefined) {
      source.playbackRate.value = rate;
    }
    
    source.start(0);
    
    source.onended = () => {
      URL.revokeObjectURL(audioUrl);
      audioContext.close();
    };
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
    await speakWithKokoro(word, accent, rate, preferredVoiceUri || undefined);
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
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
    oscillator.onended = () => {
      audioContext.close();
    };
  } catch {
    // ignore
  }
};

export const initializeVoices = async () => {
  if (!speechSynthesisRef) return;
  if (speechSynthesisRef.getVoices().length === 0) {
    speechSynthesisRef.addEventListener("voiceschanged", () => {});
  }
  
  // Предзагружаем Kokoro TTS в фоне, если системные голоса недоступны
  if (!hasSystemVoices()) {
    initializeKokoro().catch(() => {
      // Игнорируем ошибки при предзагрузке
    });
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
