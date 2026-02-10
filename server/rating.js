/**
 * Рейтинг пользователей: участники (opt-in), лидерборды за день / неделю / всего.
 * Уровень 1–100 по totalXp (формула как на фронте: 80 + 8.5*(n-1) за уровень).
 */

import { pool } from "./db.js";
import { getUsers } from "./store.js";

const PERIOD_DAY = "day";
const PERIOD_WEEK = "week";
const PERIOD_ALL = "all";

const LEVELS_TOTAL = 100;

/** Минимальный суммарный XP для перехода на уровень L (L=1..100). */
function xpToReachLevel(level) {
  if (level <= 1) return 0;
  const n = Math.min(level, LEVELS_TOTAL) - 1;
  return 80 * n + (8.5 * (n - 1) * n) / 2;
}

/** Уровень игрока по суммарному опыту (1–100). */
function getLevelFromXp(totalXp) {
  if (totalXp < 0) return 1;
  for (let L = LEVELS_TOTAL; L >= 1; L--) {
    if (totalXp >= xpToReachLevel(L)) return L;
  }
  return 1;
}

/** Текущая дата на сервере (локальное время) YYYY-MM-DD */
function getServerDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Даты за последние 7 дней (включая сегодня) */
function getLast7DateStrings() {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/**
 * Участвует ли пользователь в рейтинге.
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function isParticipating(username) {
  if (!username) return false;
  const res = await pool.query(
    "SELECT 1 FROM rating_participants WHERE username = $1",
    [username]
  );
  return res.rows.length > 0;
}

/**
 * Добавить пользователя в участники рейтинга.
 * @param {string} username
 */
export async function optIn(username) {
  await pool.query(
    `INSERT INTO rating_participants (username) VALUES ($1)
     ON CONFLICT (username) DO NOTHING`,
    [username]
  );
}

/**
 * Получить всех пользователей с данными для рейтинга (все, у кого есть XP за период).
 * Рейтинг теперь по умолчанию для всех: в таблицу попадают все, кто получил опыт.
 * @param {object} users - объект username -> user из getUsers()
 * @param {string} period - 'day' | 'week' | 'all'
 * @returns {string[]} usernames с xp > 0 за период
 */
function getUsernamesWithXpForPeriod(users, period) {
  const usernames = [];
  for (const username of Object.keys(users)) {
    const user = users[username];
    const stats = user?.stats || {};
    const xp = xpForPeriod(stats, period);
    if (xp > 0) usernames.push(username);
  }
  return usernames;
}

/**
 * Получить max_streak для набора пользователей.
 * @param {string[]} usernames
 * @returns {Promise<Map<string, number>>}
 */
async function getMaxStreaks(usernames) {
  if (usernames.length === 0) return new Map();
  const res = await pool.query(
    "SELECT username, max_streak FROM user_active_days WHERE username = ANY($1)",
    [usernames]
  );
  const map = new Map();
  for (const row of res.rows) {
    map.set(row.username, Math.max(0, Number(row.max_streak) || 0));
  }
  return map;
}

/**
 * Вычислить XP пользователя за период по stats.
 * @param {object} stats - user.stats (totalXp, xpByDate)
 * @param {string} period - 'day' | 'week' | 'all'
 * @returns {number}
 */
function xpForPeriod(stats, period) {
  if (!stats || typeof stats !== "object") return 0;
  const xpByDate = stats.xpByDate && typeof stats.xpByDate === "object" ? stats.xpByDate : {};
  const totalXp = typeof stats.totalXp === "number" ? stats.totalXp : (stats.totalScore ?? 0) || 0;

  if (period === PERIOD_ALL) return totalXp;
  if (period === PERIOD_DAY) {
    const today = getServerDateString();
    return typeof xpByDate[today] === "number" ? xpByDate[today] : 0;
  }
  if (period === PERIOD_WEEK) {
    const dates = getLast7DateStrings();
    let sum = 0;
    for (const d of dates) {
      if (typeof xpByDate[d] === "number") sum += xpByDate[d];
    }
    return sum;
  }
  return 0;
}

/**
 * Лидерборд за период (с уровнем и макс. страйком).
 * @param {string} period - 'day' | 'week' | 'all'
 * @param {string | null} currentUsername - для добавления в ответ текущего пользователя, если он вне топ-10
 * @returns {Promise<{ items: Array<{ rank, username, displayName, xp, level, maxStreak }>, currentUser?, participating }>}
 */
export async function getLeaderboard(period, currentUsername) {
  const users = await getUsers();
  const usernames = getUsernamesWithXpForPeriod(users, period);
  const maxStreaks = await getMaxStreaks(usernames);

  const list = [];
  for (const username of usernames) {
    const user = users[username];
    if (!user) continue;
    const stats = user.stats || {};
    const totalXp = typeof stats.totalXp === "number" ? stats.totalXp : (stats.totalScore ?? 0) || 0;
    const xp = xpForPeriod(stats, period);
    const displayName = (user.displayName || user.username || "").trim() || user.username;
    const level = getLevelFromXp(totalXp);
    const maxStreak = maxStreaks.get(username) ?? 0;
    list.push({ username, displayName, xp, level, maxStreak });
  }
  list.sort((a, b) => b.xp - a.xp);

  const items = list.slice(0, 10).map((entry, index) => ({
    rank: index + 1,
    username: entry.username,
    displayName: entry.displayName,
    xp: entry.xp,
    level: entry.level,
    maxStreak: entry.maxStreak,
  }));

  let currentUser = null;
  /** Участие по умолчанию: все с опытом в рейтинге; для UI считаем авторизованного участвующим */
  const participating = !!currentUsername;
  if (currentUsername) {
    const idx = list.findIndex((e) => e.username === currentUsername);
    if (idx >= 0) {
      const entry = list[idx];
      // Не показываем currentUser, если у него XP = 0
      if (entry.xp === 0) {
        currentUser = null;
      } else {
        currentUser = {
          rank: idx + 1,
          username: entry.username,
          displayName: entry.displayName,
          xp: entry.xp,
          level: entry.level,
          maxStreak: entry.maxStreak,
        };
      }
    }
  }

  return {
    items,
    currentUser: currentUser && currentUser.rank > 10 ? currentUser : undefined,
    participating,
  };
}
