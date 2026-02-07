// Логика страницы словаря

const wordsGrid = document.getElementById("words-grid");
const searchInput = document.getElementById("search-input");
const filterButtons = document.querySelectorAll(".filter-btn");
const usernameDisplay = document.getElementById("username-display");
const logoutBtn = document.getElementById("logout-btn");
const totalWordsEl = document.getElementById("total-words");
const learnedWordsEl = document.getElementById("learned-words");
const avgProgressEl = document.getElementById("avg-progress");
const dictionarySection = document.querySelector(".dictionary-section");
const viewSettingsBtn = document.getElementById("view-settings-btn");
const viewSettingsPanel = document.getElementById("view-settings-panel");
const viewSettingInputs = document.querySelectorAll("[data-view-setting]");
const wordModal = document.getElementById("word-modal");
const wordModalContent = document.getElementById("word-modal-content");
const wordModalClose = document.getElementById("word-modal-close");

let currentFilter = "all";
let searchQuery = "";
let availableVoices = [];

const defaultViewSettings = {
  translation: true,
  audio: true,
  slowAudio: true,
  transcription: true,
  example: true,
  exampleRu: true,
  level: true,
};

let viewSettings = loadViewSettings();

// Проверка авторизации
function checkAuth() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = "login.html";
    return false;
  }

  const username = getCurrentUsername();
  if (username) {
    usernameDisplay.textContent = username;
  }

  return true;
}

// Обработчик выхода
logoutBtn.addEventListener("click", () => {
  if (confirm("Вы уверены, что хотите выйти?")) {
    logout();
    window.location.href = "login.html";
  }
});

// Фильтрация и поиск
function filterWords() {
  const dictionary = getDictionary();
  const wordProgress = getUserWordProgress();
  let filtered = [...dictionary];

  // Фильтр по акценту
  if (currentFilter === "uk") {
    filtered = filtered.filter((w) => w.accent === "UK");
  } else if (currentFilter === "us") {
    filtered = filtered.filter((w) => w.accent === "US");
  } else if (currentFilter === "both") {
    filtered = filtered.filter((w) => w.accent === "both");
  } else if (currentFilter === "learned") {
    filtered = filtered.filter((w) => typeof isWordLearned === "function" && isWordLearned(w.id));
  } else if (currentFilter === "learning") {
    filtered = filtered.filter((w) => {
      const b = typeof getWordProgressValue === "function" ? getWordProgressValue(w.id, "beginner") : (wordProgress[w.id] || 0);
      const e = typeof getWordProgressValue === "function" ? getWordProgressValue(w.id, "experienced") : 0;
      const learned = typeof isWordLearned === "function" && isWordLearned(w.id);
      return (b > 0 || e > 0) && !learned;
    });
  }

  // Поиск
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (w) =>
        w.en.toLowerCase().includes(query) ||
        w.ru.toLowerCase().includes(query) ||
        w.example.toLowerCase().includes(query) ||
        (w.exampleRu && w.exampleRu.toLowerCase().includes(query))
    );
  }

  return filtered;
}

function escapeHtml(text) {
  if (text == null) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function highlightWordInExample(example, word) {
  if (!example || !word) return escapeHtml(example);
  const escaped = escapeHtml(example);
  const regex = new RegExp(
    "(" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + ")",
    "gi"
  );
  return escaped.replace(regex, "<strong class=\"example-keyword\">$1</strong>");
}

function loadViewSettings() {
  try {
    const stored = localStorage.getItem("dictionaryViewSettings");
    if (!stored) return { ...defaultViewSettings };
    return { ...defaultViewSettings, ...JSON.parse(stored) };
  } catch (error) {
    console.warn("Не удалось загрузить настройки вида:", error);
    return { ...defaultViewSettings };
  }
}

function saveViewSettings() {
  localStorage.setItem("dictionaryViewSettings", JSON.stringify(viewSettings));
}

function applyViewSettings() {
  if (!dictionarySection) return;
  dictionarySection.classList.toggle("hide-translation", !viewSettings.translation);
  dictionarySection.classList.toggle("hide-audio", !viewSettings.audio);
  dictionarySection.classList.toggle("hide-slow-audio", !viewSettings.slowAudio);
  dictionarySection.classList.toggle(
    "hide-audio-column",
    !viewSettings.audio && !viewSettings.slowAudio
  );
  dictionarySection.classList.toggle("hide-transcription", !viewSettings.transcription);
  dictionarySection.classList.toggle("hide-example", !viewSettings.example);
  dictionarySection.classList.toggle("hide-example-ru", !viewSettings.exampleRu);
  dictionarySection.classList.toggle("hide-level", !viewSettings.level);
}

function syncViewSettingInputs() {
  viewSettingInputs.forEach((input) => {
    const key = input.dataset.viewSetting;
    if (!key) return;
    input.checked = Boolean(viewSettings[key]);
  });
}

function loadVoices() {
  if (typeof speechSynthesis === "undefined") return;
  availableVoices = speechSynthesis.getVoices();
}

function pickVoice(lang) {
  if (!availableVoices.length) return null;
  return (
    availableVoices.find((voice) => voice.lang === lang) ||
    availableVoices.find((voice) => voice.lang.startsWith(lang.split("-")[0])) ||
    availableVoices[0]
  );
}

function speakWord(text, accent, rate) {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const lang = accent === "UK" ? "en-GB" : "en-US";
  utterance.lang = lang;
  utterance.rate = rate;
  const voice = pickVoice(lang);
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

function openWordModal(word, progressValues) {
  if (!wordModal || !wordModalContent) return;
  const beginner = typeof progressValues === "object" ? (progressValues.beginner ?? 0) : progressValues;
  const experienced = typeof progressValues === "object" ? (progressValues.experienced ?? 0) : 0;
  const exampleHighlighted = highlightWordInExample(word.example, word.en);
  const transcriptionBlock = viewSettings.transcription
    ? `
      <div class="modal-row">
        <span class="modal-label">Транскрипция</span>
        <div class="modal-value">
          <div>🇬🇧 UK ${escapeHtml(word.ipaUk)}</div>
          <div>🇺🇸 US ${escapeHtml(word.ipaUs)}</div>
        </div>
      </div>
    `
    : "";
  const exampleRuUnder =
    viewSettings.exampleRu && word.exampleRu
      ? `<div class="word-example-ru-under">${escapeHtml(word.exampleRu)}</div>`
      : "";
  const exampleBlock = viewSettings.example
    ? `
      <div class="modal-row">
        <span class="modal-label">Пример</span>
        <div class="modal-value modal-example-block">
          <div class="word-example-text">${exampleHighlighted}</div>
          ${exampleRuUnder}
        </div>
      </div>
    `
    : "";
  wordModalContent.innerHTML = `
    ${viewSettings.level ? `<div class="modal-level"><span class="word-level-badge word-level-${word.level}">${word.level}</span></div>` : ""}
    <div class="modal-header">
      <div>
        <div class="modal-word">${escapeHtml(word.en)}</div>
      </div>
      <div class="modal-progress modal-progress--dual">
        <span class="modal-progress-item modal-progress-item--beginner">Начинающий: ${Math.round(beginner)}%</span>
        <span class="modal-progress-item modal-progress-item--experienced">Опытный: ${Math.round(experienced)}%</span>
      </div>
    </div>
    ${viewSettings.translation ? `<div class="modal-translation">${escapeHtml(word.ru)}</div>` : ""}
    ${transcriptionBlock}
    ${exampleBlock}
  `;
  wordModal.classList.add("open");
}

function closeWordModal() {
  if (!wordModal) return;
  wordModal.classList.remove("open");
}

// Рендеринг слов
function renderWords() {
  const words = filterWords();
  const wordProgress = getUserWordProgress();

  wordsGrid.innerHTML = "";

  if (words.length === 0) {
    wordsGrid.innerHTML = `
      <div class="empty-state">
        <p>Слова не найдены</p>
      </div>
    `;
    return;
  }

  const headerRow = document.createElement("div");
  headerRow.className = "word-row word-row-header";
  headerRow.innerHTML = `
    <div class="word-cell word-cell-level">Уровень</div>
    <div class="word-cell word-cell-main">Слово</div>
    <div class="word-cell word-cell-audio">Озвучка</div>
    <div class="word-cell word-cell-transcription">Транскрипция</div>
    <div class="word-cell word-cell-example">Пример</div>
  `;
  wordsGrid.appendChild(headerRow);

  words.forEach((word) => {
    const beginnerVal = typeof getWordProgressValue === "function" ? getWordProgressValue(word.id, "beginner") : (wordProgress[word.id] || 0);
    const experiencedVal = typeof getWordProgressValue === "function" ? getWordProgressValue(word.id, "experienced") : 0;
    const exampleHighlighted = highlightWordInExample(word.example, word.en);

    const wordRow = document.createElement("div");
    wordRow.className = "word-row";
    wordRow.innerHTML = `
      <div class="word-cell word-cell-level">
        <span class="word-level-badge word-level-${word.level}">${word.level}</span>
      </div>
      <div class="word-cell word-cell-main">
        <div class="word-title">${escapeHtml(word.en)}</div>
        <div class="word-translation-under">${escapeHtml(word.ru)}</div>
        <button type="button" class="word-details-btn">Подробнее</button>
      </div>
      <div class="word-cell word-cell-audio">
        <button type="button" class="word-speak-btn" data-speed="normal" title="Озвучить">
          🔊
        </button>
        <button type="button" class="word-speak-btn word-speak-btn-slow" data-speed="slow" title="Медленное озвучивание">
          🐢
        </button>
      </div>
      <div class="word-cell word-cell-transcription">
        <div>🇬🇧 UK ${escapeHtml(word.ipaUk)}</div>
        <div>🇺🇸 US ${escapeHtml(word.ipaUs)}</div>
      </div>
      <div class="word-cell word-cell-example">
        <div class="word-example-text">${exampleHighlighted}</div>
        ${word.exampleRu ? `<div class="word-example-ru-under">${escapeHtml(word.exampleRu)}</div>` : ""}
      </div>
    `;

    const wordFooter = document.createElement("div");
    wordFooter.className = "word-row-footer";
    wordFooter.innerHTML = `
      <div class="word-progress word-progress--dual">
        <div class="word-progress-track" title="Начинающий — опыт из игр «Найди пару» и пазлы (лёгкий)">
          <span class="word-progress-label word-progress-label--beginner">Нач.</span>
          <div class="word-progress-bar">
            <div class="word-progress-fill word-progress-fill--beginner" style="width: ${Math.round(beginnerVal)}%"></div>
          </div>
          <span class="word-progress-badge word-progress-badge--beginner">${Math.round(beginnerVal)}%</span>
        </div>
        <div class="word-progress-track" title="Опытный — опыт из пазлов (сложный режим)">
          <span class="word-progress-label word-progress-label--experienced">Опыт.</span>
          <div class="word-progress-bar">
            <div class="word-progress-fill word-progress-fill--experienced" style="width: ${Math.round(experiencedVal)}%"></div>
          </div>
          <span class="word-progress-badge word-progress-badge--experienced">${Math.round(experiencedVal)}%</span>
        </div>
      </div>
      <div class="word-card-actions">
        <button type="button" class="word-action-btn word-action-reset" data-word-id="${word.id}" title="Сбросить прогресс до 0%">
          Сбросить прогресс
        </button>
        <button type="button" class="word-action-btn word-action-known" data-word-id="${word.id}" title="Отметить как изученное (100%) — не будет в играх">
          Я знаю это слово
        </button>
      </div>
    `;

    const resetBtn = wordFooter.querySelector(".word-action-reset");
    const knownBtn = wordFooter.querySelector(".word-action-known");
    const speakButtons = wordRow.querySelectorAll(".word-speak-btn");
    const detailsBtn = wordRow.querySelector(".word-details-btn");

    speakButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const speed = btn.dataset.speed === "slow" ? 0.25 : 1;
        speakWord(word.en, word.accent, speed);
      });
    });

    detailsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openWordModal(word, { beginner: beginnerVal, experienced: experiencedVal });
    });

    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Сбросить прогресс этого слова до 0%?")) {
        resetWordProgress(word.id);
        renderWords();
      }
    });

    knownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setWordAsKnown(word.id);
      renderWords();
    });

    wordsGrid.appendChild(wordRow);
    wordsGrid.appendChild(wordFooter);
  });

  updateStats();
}

// Обновление статистики
function updateStats() {
  const dictionary = getDictionary();
  const wordProgress = getUserWordProgress();

  const total = dictionary.length;
  const learned = typeof isWordLearned === "function"
    ? dictionary.filter((w) => isWordLearned(w.id)).length
    : dictionary.filter((w) => (wordProgress[w.id] || 0) === 100).length;

  let totalProgress = 0;
  dictionary.forEach((w) => {
    const b = typeof getWordProgressValue === "function" ? getWordProgressValue(w.id, "beginner") : (wordProgress[w.id] || 0);
    const e = typeof getWordProgressValue === "function" ? getWordProgressValue(w.id, "experienced") : 0;
    totalProgress += (b + e) / 2;
  });
  const avgProgress = total > 0 ? Math.round(totalProgress / total) : 0;

  totalWordsEl.textContent = total;
  learnedWordsEl.textContent = learned;
  avgProgressEl.textContent = `${avgProgress}%`;
}

// Обработчики событий
filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderWords();
  });
});

searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderWords();
});

if (viewSettingsBtn && viewSettingsPanel) {
  viewSettingsBtn.addEventListener("click", () => {
    viewSettingsPanel.classList.toggle("open");
  });

  document.addEventListener("click", (event) => {
    if (!viewSettingsPanel.classList.contains("open")) return;
    if (
      viewSettingsPanel.contains(event.target) ||
      viewSettingsBtn.contains(event.target)
    ) {
      return;
    }
    viewSettingsPanel.classList.remove("open");
  });
}

viewSettingInputs.forEach((input) => {
  input.addEventListener("change", () => {
    const key = input.dataset.viewSetting;
    if (!key) return;
    viewSettings = { ...viewSettings, [key]: input.checked };
    saveViewSettings();
    applyViewSettings();
  });
});

if (wordModalClose) {
  wordModalClose.addEventListener("click", closeWordModal);
}

if (wordModal) {
  wordModal.addEventListener("click", (event) => {
    if (event.target === wordModal) closeWordModal();
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeWordModal();
});

// Инициализация
if (checkAuth()) {
  applyViewSettings();
  syncViewSettingInputs();
  loadVoices();
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  renderWords();
}
