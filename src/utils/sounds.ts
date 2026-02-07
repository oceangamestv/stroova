let speechSynthesisRef: SpeechSynthesis | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;

/** URI или name выбранного голоса из настроек; null = по умолчанию по акценту */
let preferredVoiceUri: string | null = null;

if ("speechSynthesis" in window) {
  speechSynthesisRef = window.speechSynthesis;
}

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

export const speakWord = (
  word: string,
  accent: "UK" | "US" | "both" = "both",
  rate?: number
) => {
  if (!speechSynthesisRef) return;
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

export const initializeVoices = () => {
  if (!speechSynthesisRef) return;
  if (speechSynthesisRef.getVoices().length === 0) {
    speechSynthesisRef.addEventListener("voiceschanged", () => {});
  }
};

/** Ключ в localStorage для голоса по логину пользователя */
export const VOICE_STORAGE_KEY_PREFIX = "stroova_voice_";

/** Доступные английские голоса для настроек (до 10 вариантов в стиле озвучки игр/интерфейса). */
export const getAvailableVoices = (): { voiceURI: string; name: string }[] => {
  if (!speechSynthesisRef) return [];
  const voices = speechSynthesisRef.getVoices();
  const en = voices.filter((v) => v.lang.startsWith("en"));
  return en.slice(0, 10).map((v) => ({ voiceURI: v.voiceURI, name: v.name }));
};
