// Используем словарь уровня A0
let PAIRS = [];

// Элементы DOM
const gridEl = document.getElementById("cards-grid");
const cardsColumnEnglish = document.getElementById("cards-column-english");
const cardsColumnRussian = document.getElementById("cards-column-russian");
const errorsLabelEl = document.getElementById("errors-label");
const puzzleExerciseEl = document.getElementById("puzzle-exercise");
const puzzleTranslationEl = document.getElementById("puzzle-translation");
const puzzleSlotsEl = document.getElementById("puzzle-slots");
const puzzleSlotsWrapper = document.getElementById("puzzle-slots-wrapper");
const puzzleLettersEl = document.getElementById("puzzle-letters");
const puzzleHint = document.querySelector(".puzzle-hint");
const puzzleDifficultySwitcher = document.querySelector(".puzzle-difficulty-switcher");
const puzzleNextWordBtn = document.getElementById("puzzle-next-word-btn");
const puzzleHelpBtn = document.getElementById("puzzle-help-btn");
const puzzleRulesModal = document.getElementById("puzzle-rules-modal");
const puzzleRulesClose = document.getElementById("puzzle-rules-close");
const difficultyEasyBtn = document.getElementById("difficulty-easy");
const difficultyHardBtn = document.getElementById("difficulty-hard");
const themeToggle = document.getElementById("theme-toggle");
const lessonCard = document.querySelector(".lesson-card");
const progressEl = document.querySelector(".progress");
const progressLabelEl = document.getElementById("progress-label");
const scoreLabelEl = document.getElementById("score-label");
const progressFillEl = document.getElementById("progress-fill");
const statusMessageEl = document.getElementById("status-message");
const resetBtn = document.getElementById("reset-btn");
const resultModal = document.getElementById("result-modal");
const resultTitleEl = document.getElementById("result-title");
const resultTextEl = document.getElementById("result-text");
const modalCloseBtn = document.getElementById("modal-close-btn");
const lessonTitleEl = document.querySelector(".lesson-title");
const lessonSubtitleEl = document.querySelector(".lesson-subtitle");
const tabPairs = document.getElementById("tab-pairs");
const tabPuzzle = document.getElementById("tab-puzzle");
const usernameDisplay = document.getElementById("username-display");
const logoutBtn = document.getElementById("logout-btn");

// Состояние приложения
let currentExercise = "pairs"; // "pairs" или "puzzle"
let cards = [];
let selectedCard = null;
let matchedCount = 0;
let score = 0;
let isLocked = false;

// Поиск пар: 5 этапов по 5 слов
const PAIRS_STAGES_TOTAL = 5;
const PAIRS_PER_STAGE = 5;
let pairsCurrentStage = 1;
let pairsTotalScore = 0;
let pairsTotalErrors = 0;

// Сборка слова: 10 слов подряд
const PUZZLE_WORDS_TOTAL = 10;
let puzzleCurrentWord = 1;
let puzzleTotalScore = 0;
let puzzleTotalErrors = 0;
let puzzleDifficulty = "easy"; // "easy" или "hard"
let puzzleTransitionInProgress = false; // Флаг для предотвращения множественных переходов

// Состояние для упражнения "сборка слова"
let currentPuzzleWord = null;
let currentPuzzleWordData = null; // Сохраняем данные слова для отслеживания прогресса
let puzzleSlots = [];
let puzzleSlotsState = []; // Состояние каждого слота: null, "correct", "wrong"
let puzzleLetters = [];
let selectedSlotIndex = null;

// ========== УПРАЖНЕНИЕ "ПОИСК ПАРЫ" ==========

function createCards() {
  // Загружаем 5 слов для текущего этапа
  loadRandomWords(PAIRS_PER_STAGE);

  // Проверяем, что слова загружены
  if (!PAIRS || PAIRS.length === 0) {
    console.error("Не удалось загрузить слова для упражнения 'Найди пары'");
    return;
  }

  const englishCards = PAIRS.map((pair, i) => ({
    type: "en",
    pairId: pair.id,
    label: pair.en,
    accent: pair.accent || "both",
    index: i,
    matched: false,
  }));

  const russianCards = PAIRS.map((pair, i) => ({
    type: "ru",
    pairId: pair.id,
    label: pair.ru,
    index: PAIRS_PER_STAGE + i,
    matched: false,
  }));

  // Перемешиваем только русские карточки
  for (let i = russianCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [russianCards[i], russianCards[j]] = [russianCards[j], russianCards[i]];
  }
  russianCards.forEach((c, i) => (c.index = PAIRS_PER_STAGE + i));

  cards = [...englishCards, ...russianCards];
}

function renderCards() {
  if (!cardsColumnEnglish || !cardsColumnRussian) {
    console.error("Элементы колонок карточек не найдены");
    return;
  }

  if (!cards || cards.length === 0) {
    console.error("Карточки не созданы");
    return;
  }

  cardsColumnEnglish.innerHTML = "";
  cardsColumnRussian.innerHTML = "";

  const englishCards = cards.filter((c) => c.type === "en");
  const russianCards = cards.filter((c) => c.type === "ru");

  if (englishCards.length === 0 || russianCards.length === 0) {
    console.error("Не удалось разделить карточки на английские и русские");
    return;
  }

  englishCards.forEach((card) => {
    const el = createCardElement(card);
    cardsColumnEnglish.appendChild(el);
  });

  russianCards.forEach((card) => {
    const el = createCardElement(card);
    cardsColumnRussian.appendChild(el);
  });
}

function createCardElement(card) {
  const el = document.createElement("button");
  const accentClass = card.accent === "UK" ? "card--uk" : card.accent === "US" ? "card--us" : "";
  el.className = `card ${
    card.type === "en" ? "card--english" : "card--russian"
  } ${accentClass}`;
  el.dataset.index = card.index;

  const accentLabel = card.accent === "UK" ? "🇬🇧 UK" : card.accent === "US" ? "🇺🇸 US" : "";
  const accentTag = card.type === "en" && accentLabel ? `<span class="card-accent">${accentLabel}</span>` : "";

  el.innerHTML = `
    <span class="card-tag">${card.type === "en" ? "EN" : "RU"}</span>
    ${accentTag}
    <span>${card.label}</span>
  `;

  el.addEventListener("click", () => handleCardClick(card.index));
  return el;
}

function getCardElement(index) {
  return gridEl.querySelector(`[data-index="${index}"]`);
}

function handleCardClick(index) {
  if (isLocked) return;

  const card = cards[index];
  if (!card || card.matched) return;

  const cardEl = getCardElement(index);
  if (!cardEl) return;

  if (!selectedCard) {
    selectedCard = card;
    cardEl.classList.add("card--selected");
    setStatus("Теперь выбери подходящую пару.");
    return;
  }

  if (selectedCard.index === card.index) return;

  // Проверка: нельзя выбирать две карточки одного типа
  if (selectedCard.type === card.type) {
    // Отменяем выбор первой карточки
    const firstEl = getCardElement(selectedCard.index);
    if (firstEl) {
      firstEl.classList.remove("card--selected");
    }
    // Выбираем новую карточку
    selectedCard = card;
    cardEl.classList.add("card--selected");
    const typeLabel = card.type === "en" ? "английское" : "русское";
    setStatus(`Выбрано ${typeLabel} слово. Теперь выбери слово другого языка.`);
    return;
  }

  const firstEl = getCardElement(selectedCard.index);
  const secondEl = cardEl;

  isLocked = true;

  if (selectedCard.pairId === card.pairId && selectedCard.type !== card.type) {
    selectedCard.matched = true;
    card.matched = true;
    matchedCount += 1;
    score += 10;

    // Обновляем прогресс слова при правильном ответе
    const wordId = selectedCard.pairId;
    updateWordProgress(wordId, true);

    // Находим английское слово для произношения
    let englishWord = null;
    let wordAccent = "both";
    
    if (selectedCard.type === "en") {
      englishWord = selectedCard.label;
      const wordData = PAIRS.find((p) => p.id === wordId);
      wordAccent = wordData ? (wordData.accent || "both") : "both";
    } else if (card.type === "en") {
      englishWord = card.label;
      const wordData = PAIRS.find((p) => p.id === wordId);
      wordAccent = wordData ? (wordData.accent || "both") : "both";
    } else {
      // Если обе карточки русские (не должно быть, но на всякий случай)
      const wordData = PAIRS.find((p) => p.id === wordId);
      if (wordData) {
        englishWord = wordData.en;
        wordAccent = wordData.accent || "both";
      }
    }
    
    // Произносим слово на английском
    if (englishWord) {
      speakWord(englishWord, wordAccent);
    }

    firstEl.classList.remove("card--selected");
    secondEl.classList.remove("card--selected");
    firstEl.classList.add("card--matched");
    secondEl.classList.add("card--matched");

    setStatus("Отлично! Ты нашёл правильную пару.");
    updateProgress();

    selectedCard = null;
    isLocked = false;

    if (matchedCount === PAIRS_PER_STAGE) {
      // Этап завершён
      pairsTotalScore += score;
      if (pairsCurrentStage < PAIRS_STAGES_TOTAL) {
        pairsCurrentStage++;
        score = 0;
        matchedCount = 0;
        createCards(); // загружает 5 новых слов и создаёт карточки
        renderCards();
        setStatus(`Этап ${pairsCurrentStage} из ${PAIRS_STAGES_TOTAL}. Найди пары.`);
        updateProgress();
      } else {
        // Все 5 этапов пройдены — показываем итог
        showResult();
      }
    }
  } else {
    score = Math.max(0, score - 3);
    pairsTotalErrors += 1;

    // Обновляем прогресс слова при ошибке
    const wordId = selectedCard.pairId;
    updateWordProgress(wordId, false);

    // Воспроизводим звук ошибки
    playErrorSound();
    
    firstEl.classList.add("card--wrong");
    secondEl.classList.add("card--wrong");
    setStatus("Не совсем так. Попробуй ещё раз.");
    updateProgress();

    setTimeout(() => {
      firstEl.classList.remove("card--selected", "card--wrong");
      secondEl.classList.remove("card--selected", "card--wrong");
      selectedCard = null;
      isLocked = false;
      setStatus("Выбери новую пару карточек.");
    }, 700);
  }
}

// ========== УПРАЖНЕНИЕ "СБОРКА СЛОВА" ==========

function initPuzzle() {
  // Загружаем случайное слово из словаря
  loadRandomWords(1);

  // Проверяем, что слова загружены
  if (!PAIRS || PAIRS.length === 0) {
    console.error("Не удалось загрузить слова для пазла");
    return;
  }

  // Выбираем случайное слово
  currentPuzzleWordData = PAIRS[0]; // Используем первое (и единственное) загруженное слово
  if (!currentPuzzleWordData) {
    console.error("Данные слова не найдены");
    return;
  }
  
  currentPuzzleWord = currentPuzzleWordData.en.toUpperCase();
  const translation = currentPuzzleWordData.ru;

  if (puzzleTranslationEl) {
    puzzleTranslationEl.textContent = translation;
  }


  // Создаём слоты для букв
  puzzleSlots = Array(currentPuzzleWord.length).fill(null);
  puzzleSlotsState = Array(currentPuzzleWord.length).fill(null);
  renderPuzzleSlots();

  // Создаём буквы в зависимости от режима
  if (puzzleDifficulty === "easy") {
    // Лёгкий режим: только буквы из слова
    const letters = currentPuzzleWord.split("");
    // Фишер–Йетс
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }

    puzzleLetters = letters.map((letter, index) => ({
      letter,
      index,
      used: false,
    }));
  } else {
    // Сложный режим: все буквы алфавита
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    puzzleLetters = alphabet.map((letter, index) => ({
      letter,
      index,
      used: false,
    }));
  }

  renderPuzzleLetters();
}

function renderPuzzleSlots() {
  if (!puzzleSlotsEl || !puzzleSlots || !puzzleSlotsState) return;
  
  puzzleSlotsEl.innerHTML = "";
  puzzleSlots.forEach((letter, index) => {
    const slotContainer = document.createElement("div");
    slotContainer.className = "puzzle-slot-container";
    
    const slotEl = document.createElement("div");
    slotEl.className = "puzzle-slot";
    slotEl.dataset.slotIndex = index;
    
    if (letter) {
      slotEl.textContent = letter;
      slotEl.classList.add("filled");
      
      // Добавляем класс в зависимости от состояния
      if (puzzleSlotsState && puzzleSlotsState[index]) {
        const state = puzzleSlotsState[index];
        if (state === "correct") {
          slotEl.classList.add("correct");
        } else if (state === "wrong") {
          slotEl.classList.add("wrong");
          // В лёгком режиме показываем подсказку с правильной буквой
          if (puzzleDifficulty === "easy" && currentPuzzleWord) {
            const hintEl = document.createElement("div");
            hintEl.className = "puzzle-slot-hint";
            hintEl.textContent = currentPuzzleWord[index];
            slotContainer.appendChild(hintEl);
          }
        }
      }
    }
    
    slotContainer.appendChild(slotEl);
    puzzleSlotsEl.appendChild(slotContainer);
  });
}

function renderPuzzleLetters() {
  if (!puzzleLettersEl || !puzzleLetters) return;
  
  puzzleLettersEl.innerHTML = "";
  puzzleLetters.forEach((item) => {
    // В сложном режиме показываем все буквы, в лёгком - только неиспользованные
    if (puzzleDifficulty === "easy" && item.used) return;

    const letterEl = document.createElement("button");
    letterEl.className = "puzzle-letter";
    letterEl.textContent = item.letter;
    letterEl.dataset.letterIndex = item.index;
    
    // В сложном режиме буквы всегда активны
    if (puzzleDifficulty === "hard") {
      letterEl.addEventListener("click", () => {
        if (puzzleTransitionInProgress || isLocked) return;
        if (!puzzleSlots) return;
        const emptySlotIndex = puzzleSlots.findIndex((slot) => slot === null);
        if (emptySlotIndex !== -1) {
          placeLetterInSlot(item.letter, emptySlotIndex);
        }
      });
    } else {
      letterEl.addEventListener("click", () => handleLetterClick(item.index));
    }
    
    puzzleLettersEl.appendChild(letterEl);
  });
}

function placeLetterInFirstEmptySlot(letterItem) {
  if (puzzleTransitionInProgress) return; // Игнорируем ввод во время перехода
  if (isLocked) return; // Игнорируем ввод если заблокировано
  
  // Находим первый пустой слот
  const emptySlotIndex = puzzleSlots.findIndex((slot) => slot === null);
  if (emptySlotIndex === -1) return;

  // В лёгком режиме НЕ помечаем букву как использованную здесь
  // Это будет сделано в placeLetterInSlot в зависимости от правильности

  // Помещаем букву в слот с проверкой правильности
  placeLetterInSlot(letterItem.letter, emptySlotIndex);
}

function placeLetterInSlot(letter, slotIndex) {
  if (!currentPuzzleWord || !puzzleSlots || !puzzleSlotsState) return;
  if (slotIndex < 0 || slotIndex >= puzzleSlots.length) return;
  if (puzzleSlots[slotIndex] !== null) return; // Слот уже заполнен
  if (puzzleTransitionInProgress) return; // Игнорируем ввод во время перехода
  if (isLocked) return; // Игнорируем ввод если заблокировано
  
  puzzleSlots[slotIndex] = letter;
  
  // Проверяем правильность буквы сразу
  const correctLetter = currentPuzzleWord[slotIndex];
  if (letter === correctLetter) {
    puzzleSlotsState[slotIndex] = "correct";
    // В лёгком режиме правильная буква исчезает из списка
    if (puzzleDifficulty === "easy") {
      const correctLetterItem = puzzleLetters.find((item) => item.letter === correctLetter && !item.used);
      if (correctLetterItem) {
        correctLetterItem.used = true;
      }
    }
  } else {
    puzzleSlotsState[slotIndex] = "wrong";
    // В лёгком режиме неправильная буква НЕ исчезает, а исчезает правильная
    if (puzzleDifficulty === "easy") {
      const correctLetterItem = puzzleLetters.find((item) => item.letter === correctLetter && !item.used);
      if (correctLetterItem) {
        correctLetterItem.used = true; // Удаляем правильную букву из списка
      }
    }
    // Воспроизводим звук ошибки при неправильной букве
    playErrorSound();
  }
  
  renderPuzzleSlots();
  renderPuzzleLetters();
  checkPuzzleComplete();
}

// Удаление из слотов запрещено - функция оставлена для совместимости, но не используется
function handleSlotClick(slotIndex) {
  // Удаление букв из слотов запрещено
  return;
}

function handleLetterClick(letterIndex) {
  if (isLocked) return;
  if (puzzleTransitionInProgress) return; // Игнорируем клики во время перехода

  const letterItem = puzzleLetters[letterIndex];
  if (!letterItem || letterItem.used) return;

  placeLetterInFirstEmptySlot(letterItem);
}

function checkPuzzleComplete() {
  // Проверяем наличие необходимых переменных
  if (!currentPuzzleWord || !puzzleSlots || !puzzleSlotsState) return;
  
  // Проверяем, что слово полностью заполнено
  const isComplete = puzzleSlots.every((slot) => slot !== null);
  if (!isComplete) {
    setStatus("Продолжай собирать слово.");
    return;
  }

  // Если переход уже в процессе, не выполняем повторную проверку
  if (puzzleTransitionInProgress) return;
  if (isLocked) return; // Не проверяем если уже заблокировано

  const currentWord = puzzleSlots.join("");
  
  // Проверяем, все ли буквы правильные (все заполненные слоты должны быть "correct")
  const allCorrect = puzzleSlotsState.length === puzzleSlots.length && 
    puzzleSlotsState.every((state, index) => {
      // Если слот заполнен, проверяем что состояние "correct"
      return puzzleSlots[index] === null || state === "correct";
    });
  
  if (allCorrect && currentWord === currentPuzzleWord) {
    // Правильно! Показываем панель с правильным ответом и кнопкой перехода
    score += 15;
    puzzleTotalScore += score;
    isLocked = true;
    matchedCount = 1;
    puzzleTransitionInProgress = true; // Устанавливаем флаг перехода

    // Обновляем прогресс слова
    if (currentPuzzleWordData) {
      updateWordProgress(currentPuzzleWordData.id, true);
    }

    // Произносим слово на английском
    if (currentPuzzleWordData) {
      const wordAccent = currentPuzzleWordData.accent || "both";
      speakWord(currentPuzzleWordData.en, wordAccent);
    }

    // Подсвечиваем все слоты как правильные
    const slotElements = puzzleSlotsEl.querySelectorAll(".puzzle-slot");
    slotElements.forEach((el) => el.classList.add("correct"));

    // Показываем панель с правильным ответом и кнопкой перехода
    showPuzzleAnswer(true);
  } else {
    // Есть неправильные буквы - показываем правильный ответ и кнопку перехода
    showPuzzleAnswer(false);
  }
}

function showPuzzleAnswer(isCorrect = false) {
  if (!currentPuzzleWordData) return;
  
  isLocked = true;
  puzzleTransitionInProgress = true;
  
  if (!isCorrect) {
    // Увеличиваем счётчик ошибок только для неправильного ответа
    puzzleTotalErrors++;
    
    // Заполняем все слоты правильными буквами
    puzzleSlots = currentPuzzleWord.split("");
    puzzleSlotsState = Array(puzzleSlots.length).fill("correct");
    
    // Обновляем прогресс слова при ошибке
    updateWordProgress(currentPuzzleWordData.id, false);
    
    // Воспроизводим звук ошибки
    playErrorSound();
  }
  
  renderPuzzleSlots();
  
  // Просто показываем кнопку продолжения снизу, не скрывая другие элементы
  if (puzzleNextWordBtn) {
    puzzleNextWordBtn.classList.remove("hidden");
  }
  
  // Скрываем только буквы для выбора, так как слово уже собрано
  if (puzzleLettersEl) puzzleLettersEl.style.display = "none";
}

function goToNextPuzzleWord() {
  // Скрываем кнопку продолжения
  if (puzzleNextWordBtn) {
    puzzleNextWordBtn.classList.add("hidden");
  }
  
  if (puzzleCurrentWord < PUZZLE_WORDS_TOTAL) {
    // Переходим к следующему слову
    puzzleCurrentWord++;
    score = 0;
    matchedCount = 0;
    isLocked = false;
    puzzleTransitionInProgress = false;
    
    // Восстанавливаем видимость букв для выбора
    if (puzzleLettersEl) puzzleLettersEl.style.display = "";
    
    initPuzzle();
    const difficultyHint = puzzleDifficulty === "easy"
      ? "Лёгкий режим: используй только буквы из слова."
      : "Сложный режим: можно использовать любые буквы, но в правильном порядке.";
    setStatus(`Слово ${puzzleCurrentWord} из ${PUZZLE_WORDS_TOTAL}. ${difficultyHint}`);
    updateProgress();
  } else {
    // Все 10 слов собраны — показываем итог
    puzzleTransitionInProgress = false;
    showResult();
  }
}

function handleKeyDown(event) {
  if (currentExercise !== "puzzle") return;
  
  // Если открыт модал, не реагируем на ввод
  if (!resultModal.classList.contains("hidden")) return;

  // Обработка Enter для перехода к следующему слову
  if (event.key === "Enter") {
    // Проверяем, что слово полностью заполнено
    const isComplete = puzzleSlots && puzzleSlots.every((slot) => slot !== null);
    
    if (isComplete && puzzleNextWordBtn && !puzzleNextWordBtn.classList.contains("hidden")) {
      // Кнопка следующего слова показана - переходим к следующему слову
      event.preventDefault();
      goToNextPuzzleWord();
      return;
    } else if (isComplete && !isLocked && !puzzleTransitionInProgress) {
      // Слово заполнено, но кнопка ещё не показана - проверяем правильность
      // Это вызовет checkPuzzleComplete, который покажет окно со слотами и кнопку
      checkPuzzleComplete();
      return;
    }
    return;
  }
  
  if (isLocked) return;
  if (puzzleTransitionInProgress) return; // Игнорируем ввод во время перехода

  // Игнорируем другие служебные клавиши
  if (event.key === "Escape" || event.key === "Tab") {
    return;
  }

  const key = event.key;
  const isLetter = key.length === 1 && /[a-zA-Z]/.test(key);
  if (!isLetter) return;

  const letter = key.toUpperCase();

  // Находим первый пустой слот
  const emptySlotIndex = puzzleSlots.findIndex((slot) => slot === null);
  if (emptySlotIndex === -1) return;

  if (puzzleDifficulty === "easy") {
    // Лёгкий режим: только буквы из слова
    const letterItem = puzzleLetters.find(
      (item) => item.letter === letter && !item.used
    );
    if (!letterItem) return;
    placeLetterInFirstEmptySlot(letterItem);
  } else {
    // Сложный режим: любые буквы
    placeLetterInSlot(letter, emptySlotIndex);
  }
}

// ========== ОБЩИЕ ФУНКЦИИ ==========

function updateProgress() {
  if (currentExercise === "pairs") {
    progressLabelEl.textContent = `Этап ${pairsCurrentStage} / ${PAIRS_STAGES_TOTAL} · ${matchedCount} / ${PAIRS_PER_STAGE} пар`;
    const totalScore = pairsTotalScore + score;
    scoreLabelEl.textContent = `Очки: ${totalScore}`;
    if (errorsLabelEl) {
      errorsLabelEl.textContent = `Ошибки: ${pairsTotalErrors}`;
      errorsLabelEl.classList.remove("hidden");
    }
    const progressPercent =
      ((pairsCurrentStage - 1) * PAIRS_PER_STAGE + matchedCount) /
      (PAIRS_STAGES_TOTAL * PAIRS_PER_STAGE) *
      100;
    progressFillEl.style.width = `${progressPercent}%`;
  } else {
    // Сборка слова: показываем прогресс по словам
    progressLabelEl.textContent = `Слово ${puzzleCurrentWord} / ${PUZZLE_WORDS_TOTAL}`;
    const totalScore = puzzleTotalScore + score;
    scoreLabelEl.textContent = `Очки: ${totalScore}`;
    if (errorsLabelEl) {
      errorsLabelEl.textContent = `Ошибки: ${puzzleTotalErrors}`;
      errorsLabelEl.classList.remove("hidden");
    }
    const progressPercent = (puzzleCurrentWord / PUZZLE_WORDS_TOTAL) * 100;
    progressFillEl.style.width = `${progressPercent}%`;
  }
}

function setStatus(message) {
  statusMessageEl.textContent = message;
}

function loadRandomWords(count) {
  // Загружаем случайные слова для игры (исключаются слова с прогрессом 100%)
  try {
    if (typeof getRandomWordsForGame === "function") {
      PAIRS = getRandomWordsForGame(count);
    } else if (typeof getRandomWords === "function") {
      PAIRS = getRandomWords(count);
    } else {
      console.error("Функции загрузки слов не найдены");
      PAIRS = [];
      return;
    }
    
    if (!PAIRS || PAIRS.length === 0) {
      console.error("Не удалось загрузить слова из словаря");
      PAIRS = [];
    }
  } catch (error) {
    console.error("Ошибка при загрузке слов:", error);
    PAIRS = [];
  }
}

function resetState() {
  matchedCount = 0;
  score = 0;
  isLocked = false;
  selectedCard = null;

  if (currentExercise === "pairs") {
    pairsCurrentStage = 1;
    pairsTotalScore = 0;
    pairsTotalErrors = 0;
    loadRandomWords(PAIRS_PER_STAGE);
    createCards();
    renderCards();
    setStatus("Этап 1. Слева — английские слова, справа — переводы. Найди пары.");
  } else {
    puzzleCurrentWord = 1;
    puzzleTotalScore = 0;
    puzzleTotalErrors = 0;
    puzzleSlotsState = [];
    puzzleTransitionInProgress = false; // Сбрасываем флаг перехода
    // Скрываем кнопку следующего слова при сбросе
    if (puzzleNextWordBtn) {
      puzzleNextWordBtn.classList.add("hidden");
    }
    // Восстанавливаем видимость букв для выбора
    if (puzzleLettersEl) puzzleLettersEl.style.display = "";
    loadRandomWords(1);
    initPuzzle();
    const difficultyHint = puzzleDifficulty === "easy"
      ? "Лёгкий режим: используй только буквы из слова."
      : "Сложный режим: можно использовать любые буквы, но в правильном порядке.";
    setStatus(
      `Слово 1 из ${PUZZLE_WORDS_TOTAL}. ${difficultyHint}`
    );
  }

  updateProgress();
}

function showResult() {
  let title = "Отлично!";
  let text = "";

  if (currentExercise === "pairs") {
    const totalScore = pairsTotalScore;
    const totalPairs = PAIRS_STAGES_TOTAL * PAIRS_PER_STAGE;
    text = `Все 5 этапов пройдены. Набрано очков: ${totalScore}. Ошибок: ${pairsTotalErrors}.`;
    if (pairsTotalErrors === 0 && totalScore >= totalPairs * 10) {
      title = "Потрясающе!";
      text += " Без единой ошибки — так держать!";
    } else if (pairsTotalErrors <= 2) {
      title = "Отлично!";
      text += " Почти без ошибок.";
    } else if (pairsTotalErrors > totalPairs) {
      title = "Хорошее начало!";
      text += " Попробуй ещё раз — будет лучше.";
    }

    // Сохраняем прогресс (используем общий счёт за все этапы)
    saveUserProgress();
  } else {
    // Сборка слова: показываем статистику за все 10 слов
    const totalScore = puzzleTotalScore;
    text = `Все ${PUZZLE_WORDS_TOTAL} слов собраны! Набрано очков: ${totalScore}. Ошибок: ${puzzleTotalErrors}.`;
    if (puzzleTotalErrors === 0 && totalScore >= PUZZLE_WORDS_TOTAL * 15) {
      title = "Потрясающе!";
      text += " Без единой ошибки — отлично!";
    } else if (puzzleTotalErrors <= 2) {
      title = "Отлично!";
      text += " Почти без ошибок.";
    } else if (puzzleTotalErrors > PUZZLE_WORDS_TOTAL) {
      title = "Хорошее начало!";
      text += " Попробуй ещё раз — будет лучше.";
    }

    // Сохраняем прогресс (используем общий счёт за все слова)
    saveUserProgress();
  }

  resultTitleEl.textContent = title;
  resultTextEl.textContent = text;
  resultModal.classList.remove("hidden");
}

// Сохранение прогресса пользователя
function saveUserProgress() {
  const user = getCurrentUser();
  if (!user) return;

  const stats = getUserStats() || {
    totalScore: 0,
    exercisesCompleted: 0,
    pairsCompleted: 0,
    puzzlesCompleted: 0,
    bestScore: 0,
  };

  const scoreToAdd = currentExercise === "pairs" ? pairsTotalScore : puzzleTotalScore;
  const update = {
    totalScore: stats.totalScore + scoreToAdd,
    exercisesCompleted: stats.exercisesCompleted + 1,
    bestScore: Math.max(stats.bestScore, scoreToAdd),
  };

  if (currentExercise === "pairs") {
    update.pairsCompleted = (stats.pairsCompleted || 0) + 1;
  } else {
    update.puzzlesCompleted = (stats.puzzlesCompleted || 0) + 1;
  }

  updateUserStats(update);
}

function switchExercise(exerciseType) {
  currentExercise = exerciseType;

  // Обновляем активную вкладку
  tabPairs.classList.toggle("active", exerciseType === "pairs");
  tabPuzzle.classList.toggle("active", exerciseType === "puzzle");

  // Показываем/скрываем соответствующие элементы
  gridEl.classList.toggle("hidden", exerciseType !== "pairs");
  puzzleExerciseEl.classList.toggle("hidden", exerciseType !== "puzzle");

  // Обновляем заголовки
  if (exerciseType === "pairs") {
    lessonTitleEl.textContent = "Найди пару: слово и перевод";
    lessonSubtitleEl.textContent =
      "Слева — 5 английских слов, справа — 5 переводов. Найди пары. 5 этапов по 5 пар.";
  } else {
    lessonTitleEl.textContent = "Собери слово из пазлов";
    lessonSubtitleEl.textContent = "";
  }

  resetState();
}

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========

tabPairs.addEventListener("click", () => switchExercise("pairs"));
tabPuzzle.addEventListener("click", () => switchExercise("puzzle"));

resetBtn.addEventListener("click", () => {
  resetState();
});

modalCloseBtn.addEventListener("click", () => {
  resultModal.classList.add("hidden");
  resetState();
});

resultModal.addEventListener("click", (event) => {
  if (event.target === resultModal) {
    resultModal.classList.add("hidden");
  }
});

window.addEventListener("keydown", handleKeyDown);

// ========== ПЕРЕКЛЮЧАТЕЛЬ СЛОЖНОСТИ ПАЗЛОВ ==========

function switchPuzzleDifficulty(difficulty) {
  if (difficulty === puzzleDifficulty) return;
  
  puzzleDifficulty = difficulty;
  
  // Обновляем активные кнопки
  if (difficultyEasyBtn && difficultyHardBtn) {
    difficultyEasyBtn.classList.toggle("active", difficulty === "easy");
    difficultyHardBtn.classList.toggle("active", difficulty === "hard");
  }
  
  // Сбрасываем текущее слово и перезагружаем
  if (currentExercise === "puzzle") {
    puzzleSlots = Array(currentPuzzleWord.length).fill(null);
    puzzleSlotsState = Array(currentPuzzleWord.length).fill(null);
    puzzleTransitionInProgress = false; // Сбрасываем флаг перехода
    // Скрываем кнопку следующего слова при переключении сложности
    if (puzzleNextWordBtn) {
      puzzleNextWordBtn.classList.add("hidden");
    }
    // Восстанавливаем видимость букв для выбора
    if (puzzleLettersEl) puzzleLettersEl.style.display = "";
    isLocked = false;
    initPuzzle();
    setStatus(
      difficulty === "easy"
        ? "Лёгкий режим: используй только буквы из слова."
        : "Сложный режим: можно использовать любые буквы, но в правильном порядке."
    );
  }
}

if (difficultyEasyBtn) {
  difficultyEasyBtn.addEventListener("click", () => switchPuzzleDifficulty("easy"));
}

if (difficultyHardBtn) {
  difficultyHardBtn.addEventListener("click", () => switchPuzzleDifficulty("hard"));
}

if (puzzleNextWordBtn) {
  puzzleNextWordBtn.addEventListener("click", () => {
    goToNextPuzzleWord();
  });
}

// Обработчики для модального окна с правилами
if (puzzleHelpBtn) {
  puzzleHelpBtn.addEventListener("click", () => {
    if (puzzleRulesModal) {
      puzzleRulesModal.classList.remove("hidden");
    }
  });
}

if (puzzleRulesClose) {
  puzzleRulesClose.addEventListener("click", () => {
    if (puzzleRulesModal) {
      puzzleRulesModal.classList.add("hidden");
    }
  });
}

if (puzzleRulesModal) {
  puzzleRulesModal.addEventListener("click", (event) => {
    if (event.target === puzzleRulesModal) {
      puzzleRulesModal.classList.add("hidden");
    }
  });
}

// ========== ПРОВЕРКА АВТОРИЗАЦИИ ==========

function checkAuth() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    // Если не авторизован, перенаправляем на страницу входа
    window.location.href = "login.html";
    return false;
  }

  // Показываем имя пользователя
  const username = getCurrentUsername();
  if (username) {
    usernameDisplay.textContent = username;
  }

  return true;
}

// ========== ОБРАБОТЧИК ВЫХОДА ==========

logoutBtn.addEventListener("click", () => {
  if (confirm("Вы уверены, что хотите выйти?")) {
    logout();
    window.location.href = "login.html";
  }
});

// ========== ПЕРЕКЛЮЧАТЕЛЬ ТЕМЫ ==========

function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  if (themeToggle) {
    themeToggle.setAttribute("data-theme", savedTheme);
    themeToggle.querySelector(".theme-toggle-icon").textContent = savedTheme === "dark" ? "☀️" : "🌙";
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
  const newTheme = currentTheme === "light" ? "dark" : "light";
  
  // Добавляем класс для плавной анимации
  document.documentElement.classList.add("theme-transitioning");
  
  // Устанавливаем новую тему
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
  
  // Обновляем иконку переключателя с анимацией
  if (themeToggle) {
    themeToggle.setAttribute("data-theme", newTheme);
    const icon = themeToggle.querySelector(".theme-toggle-icon");
    if (icon) {
      // Анимация вращения и изменения иконки
      icon.style.transform = "rotate(360deg) scale(1.3)";
      icon.style.opacity = "0.5";
      
      setTimeout(() => {
        icon.textContent = newTheme === "dark" ? "☀️" : "🌙";
        icon.style.transform = "rotate(0deg) scale(1)";
        icon.style.opacity = "1";
      }, 300);
    }
    
    // Добавляем эффект свечения при переключении
    themeToggle.style.boxShadow = "0 0 20px rgba(255, 193, 7, 0.6), 0 0 40px rgba(33, 150, 243, 0.4)";
    setTimeout(() => {
      themeToggle.style.boxShadow = "";
    }, 600);
  }
  
  // Убираем класс анимации после завершения перехода
  setTimeout(() => {
    document.documentElement.classList.remove("theme-transitioning");
  }, 600);
}

if (themeToggle) {
  themeToggle.addEventListener("click", toggleTheme);
}

// Инициализируем тему при загрузке
initTheme();

// ========== ИНИЦИАЛИЗАЦИЯ ==========

if (checkAuth()) {
  switchExercise("pairs");
  
  // Инициализируем переключатель сложности пазлов
  if (difficultyEasyBtn && difficultyHardBtn) {
    difficultyEasyBtn.classList.toggle("active", puzzleDifficulty === "easy");
    difficultyHardBtn.classList.toggle("active", puzzleDifficulty === "hard");
  }
}
