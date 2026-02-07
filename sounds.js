// Модуль для работы со звуками в упражнениях

// Инициализация Web Speech API
let speechSynthesis = null;
let currentUtterance = null;

if ('speechSynthesis' in window) {
  speechSynthesis = window.speechSynthesis;
}

// Получить голос для нужного акцента
function getVoiceForAccent(accent) {
  if (!speechSynthesis) return null;

  const voices = speechSynthesis.getVoices();
  
  // Фильтруем голоса по языку (en-US или en-GB)
  let preferredVoices = [];
  
  if (accent === "UK") {
    // Ищем британские голоса
    preferredVoices = voices.filter(
      (voice) =>
        voice.lang.includes("en-GB") ||
        voice.name.includes("British") ||
        voice.name.includes("UK")
    );
  } else if (accent === "US") {
    // Ищем американские голоса
    preferredVoices = voices.filter(
      (voice) =>
        voice.lang.includes("en-US") ||
        (voice.lang.includes("en") && !voice.lang.includes("GB"))
    );
  } else {
    // Для "both" используем любой английский голос
    preferredVoices = voices.filter((voice) => voice.lang.startsWith("en"));
  }

  // Возвращаем первый доступный голос или первый английский
  if (preferredVoices.length > 0) {
    return preferredVoices[0];
  }

  // Если не нашли подходящий, возвращаем первый английский голос
  const englishVoices = voices.filter((voice) => voice.lang.startsWith("en"));
  return englishVoices.length > 0 ? englishVoices[0] : voices[0] || null;
}

// Произнести английское слово
function speakWord(word, accent = "both") {
  if (!speechSynthesis) {
    console.warn("Speech synthesis not supported");
    return;
  }

  // Останавливаем предыдущее произношение, если оно есть
  if (currentUtterance) {
    speechSynthesis.cancel();
  }

  // Создаём новое произношение
  const utterance = new SpeechSynthesisUtterance(word);
  
  // Настраиваем параметры
  utterance.lang = accent === "UK" ? "en-GB" : "en-US";
  utterance.rate = 0.9; // Скорость речи (немного медленнее для лучшего понимания)
  utterance.pitch = 1.0; // Высота тона
  utterance.volume = 1.0; // Громкость

  // Пытаемся найти подходящий голос
  const voice = getVoiceForAccent(accent);
  if (voice) {
    utterance.voice = voice;
  }

  // Сохраняем текущее произношение
  currentUtterance = utterance;

  // Произносим слово
  speechSynthesis.speak(utterance);
}

// Создать звук ошибки через Web Audio API
function playErrorSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Создаём осциллятор для генерации звука
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // Подключаем узлы
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Настраиваем звук ошибки (низкий тон, короткий)
    oscillator.frequency.value = 200; // Низкая частота
    oscillator.type = "sine"; // Плавный звук

    // Настраиваем громкость (envelope)
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

    // Воспроизводим звук
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);

    // Очищаем после завершения
    oscillator.onended = () => {
      audioContext.close();
    };
  } catch (error) {
    console.warn("Error sound playback failed:", error);
    // Fallback: используем простой beep через создание аудио элемента
    try {
      const audio = new Audio();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 200;
      oscillator.type = "sine";
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.15);
    } catch (e) {
      // Если и это не работает, просто игнорируем
    }
  }
}

// Инициализация голосов (нужно вызвать после загрузки страницы)
function initializeVoices() {
  if (!speechSynthesis) return;

  // Голоса могут загружаться асинхронно, поэтому проверяем несколько раз
  if (speechSynthesis.getVoices().length === 0) {
    speechSynthesis.addEventListener("voiceschanged", () => {
      // Голоса загружены
    });
  }
}

// Инициализация при загрузке
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeVoices);
} else {
  initializeVoices();
}
