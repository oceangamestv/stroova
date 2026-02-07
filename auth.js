// Модуль управления пользователями и авторизацией

// Простая функция хеширования пароля (для демонстрации)
// В реальном приложении используйте более безопасные методы
function hashPassword(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

// Получить всех пользователей из localStorage
function getUsers() {
  const usersJson = localStorage.getItem("linguaMatch_users");
  return usersJson ? JSON.parse(usersJson) : {};
}

// Сохранить пользователей в localStorage
function saveUsers(users) {
  localStorage.setItem("linguaMatch_users", JSON.stringify(users));
}

// Регистрация нового пользователя
function registerUser(username, password) {
  const users = getUsers();

  // Проверка, существует ли пользователь
  if (users[username]) {
    return { success: false, error: "Пользователь с таким логином уже существует" };
  }

  // Проверка длины логина и пароля
  if (username.length < 3) {
    return { success: false, error: "Логин должен содержать минимум 3 символа" };
  }

  if (password.length < 4) {
    return { success: false, error: "Пароль должен содержать минимум 4 символа" };
  }

  // Создаём нового пользователя
  users[username] = {
    username: username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    stats: {
      totalScore: 0,
      exercisesCompleted: 0,
      pairsCompleted: 0,
      puzzlesCompleted: 0,
      bestScore: 0,
    },
    wordProgress: {}, // { wordId: percentage (0-100) }
  };

  saveUsers(users);
  return { success: true };
}

// Авторизация пользователя
function loginUser(username, password) {
  const users = getUsers();
  const user = users[username];

  if (!user) {
    return { success: false, error: "Неверный логин или пароль" };
  }

  const passwordHash = hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    return { success: false, error: "Неверный логин или пароль" };
  }

  // Сохраняем текущую сессию
  const session = {
    username: username,
    loginTime: new Date().toISOString(),
  };
  localStorage.setItem("linguaMatch_session", JSON.stringify(session));

  return { success: true, user: user };
}

// Выход из системы
function logout() {
  localStorage.removeItem("linguaMatch_session");
}

// Проверить, авторизован ли пользователь
function getCurrentUser() {
  const sessionJson = localStorage.getItem("linguaMatch_session");
  if (!sessionJson) return null;

  const session = JSON.parse(sessionJson);
  const users = getUsers();
  return users[session.username] || null;
}

// Получить текущего пользователя с именем
function getCurrentUsername() {
  const sessionJson = localStorage.getItem("linguaMatch_session");
  if (!sessionJson) return null;

  const session = JSON.parse(sessionJson);
  return session.username;
}

// Обновить статистику пользователя
function updateUserStats(statsUpdate) {
  const username = getCurrentUsername();
  if (!username) return;

  const users = getUsers();
  const user = users[username];
  if (!user) return;

  // Обновляем статистику
  user.stats = {
    ...user.stats,
    ...statsUpdate,
  };

  // Пересчитываем общий счёт
  if (statsUpdate.totalScore !== undefined) {
    user.stats.totalScore = Math.max(user.stats.totalScore, statsUpdate.totalScore || 0);
  }

  // Обновляем лучший результат
  if (statsUpdate.bestScore !== undefined) {
    user.stats.bestScore = Math.max(user.stats.bestScore, statsUpdate.bestScore || 0);
  }

  saveUsers(users);
}

// Получить статистику текущего пользователя
function getUserStats() {
  const user = getCurrentUser();
  return user ? user.stats : null;
}

// Получить прогресс слов пользователя (формат: { wordId: number } или { wordId: { beginner?, experienced?, expert? } })
function getUserWordProgress() {
  const user = getCurrentUser();
  return user ? (user.wordProgress || {}) : {};
}

// Типы прогресса: начинающий (зелёный), опытный (жёлтый), эксперт (красный — зарезервирован)
function getWordProgressValue(wordId, type) {
  type = type || "beginner";
  const progress = getUserWordProgress();
  const raw = progress[wordId];
  if (raw == null) return 0;
  if (typeof raw === "number") {
    return type === "beginner" ? Math.max(0, Math.min(100, raw)) : 0;
  }
  const val = raw[type];
  return typeof val === "number" ? Math.max(0, Math.min(100, val)) : 0;
}

// Слово изучено, когда и начинающий, и опытный треки = 100%
function isWordLearned(wordId) {
  return getWordProgressValue(wordId, "beginner") === 100 && getWordProgressValue(wordId, "experienced") === 100;
}

function ensureWordProgressObject(users, username, wordId) {
  const user = users[username];
  if (!user || !user.wordProgress) return;
  const raw = user.wordProgress[wordId];
  if (typeof raw === "number") {
    user.wordProgress[wordId] = { beginner: Math.max(0, Math.min(100, raw)), experienced: 0, expert: 0 };
  } else if (raw && typeof raw === "object") {
    user.wordProgress[wordId] = { beginner: raw.beginner ?? 0, experienced: raw.experienced ?? 0, expert: raw.expert ?? 0 };
  }
}

// Обновить прогресс слова. progressType: "beginner" | "experienced" | "expert" (по умолчанию "beginner")
function updateWordProgress(wordId, isCorrect, progressType) {
  progressType = progressType || "beginner";
  const username = getCurrentUsername();
  if (!username) return;

  const users = getUsers();
  const user = users[username];
  if (!user) return;

  if (!user.wordProgress) user.wordProgress = {};
  ensureWordProgressObject(users, username, wordId);
  const byType = user.wordProgress[wordId];
  if (typeof byType === "number") {
    user.wordProgress[wordId] = { beginner: byType, experienced: 0, expert: 0 };
  }
  const obj = user.wordProgress[wordId];
  if (typeof obj !== "object" || obj === null) {
    user.wordProgress[wordId] = { beginner: 0, experienced: 0, expert: 0 };
  }
  const current = user.wordProgress[wordId][progressType] ?? 0;
  const next = isCorrect ? Math.min(100, current + 1) : Math.max(0, current - 1);
  user.wordProgress[wordId][progressType] = next;
  saveUsers(users);
}

// Получить прогресс конкретного слова (обратная совместимость: один number = beginner)
function getWordProgress(wordId) {
  return getWordProgressValue(wordId, "beginner");
}

// Сбросить прогресс слова полностью (0% по всем трекам)
function resetWordProgress(wordId) {
  const username = getCurrentUsername();
  if (!username) return;

  const users = getUsers();
  const user = users[username];
  if (!user) return;

  if (!user.wordProgress) user.wordProgress = {};
  user.wordProgress[wordId] = { beginner: 0, experienced: 0, expert: 0 };
  saveUsers(users);
}

// Отметить слово как изученное (100% по начинающему и опытному) — по умолчанию не попадает в игры
function setWordAsKnown(wordId) {
  const username = getCurrentUsername();
  if (!username) return;

  const users = getUsers();
  const user = users[username];
  if (!user) return;

  if (!user.wordProgress) user.wordProgress = {};
  user.wordProgress[wordId] = { beginner: 100, experienced: 100, expert: 100 };
  saveUsers(users);
}
