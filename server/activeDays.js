/**
 * Активные дни: учёт по серверной дате (00:00–23:59).
 * Один выполненный задание в день = +1 к серии; пропуск дня = сброс серии.
 */

import { pool } from "./db.js";

/** Текущая дата на сервере (локальное время) в формате YYYY-MM-DD */
export function getServerDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Вчера (серверная дата) в формате YYYY-MM-DD */
function getYesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Привести дату к строке в серверном локальном времени (как getServerDateString). */
function toServerDateString(val) {
  if (val == null) return null;
  const d = val instanceof Date ? val : new Date(val);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Получить данные активных дней пользователя.
 * @returns {{ lastActiveDate: string | null, streakDays: number, maxStreak: number }}
 */
export async function getActiveDays(username) {
  const res = await pool.query(
    "SELECT last_active_date, streak_days, max_streak FROM user_active_days WHERE username = $1",
    [username]
  );
  const row = res.rows[0];
  if (!row) {
    return { lastActiveDate: null, streakDays: 0, maxStreak: 0 };
  }
  const lastActiveDate = toServerDateString(row.last_active_date) || (row.last_active_date ? String(row.last_active_date).slice(0, 10) : null);
  return {
    lastActiveDate: lastActiveDate || null,
    streakDays: Math.max(0, Number(row.streak_days) || 0),
    maxStreak: Math.max(0, Number(row.max_streak) || 0),
  };
}

/**
 * Конфиг награды по ключу (например { xp: 10 }).
 * @param {string} rewardKey
 * @returns {Promise<{ xp?: number } | null>}
 */
export async function getRewardConfig(rewardKey) {
  const res = await pool.query(
    "SELECT config FROM rewards WHERE reward_key = $1",
    [rewardKey]
  );
  const row = res.rows[0];
  if (!row || !row.config) return null;
  return typeof row.config === "object" ? row.config : {};
}

/**
 * Записать активность: пользователь выполнил задание сегодня.
 * Учитывается только первый учёт за день; повторные вызовы в тот же день не увеличивают серию.
 * Используется транзакция с блокировкой строки, чтобы при нескольких быстрых запросах серия не дублировалась.
 *
 * @param {string} username
 * @returns {Promise<{ streakDays: number, lastActiveDate: string, xpGranted: number }>}
 */
export async function recordActivity(username) {
  const today = getServerDateString();
  const yesterday = getYesterdayString();

  const result = { streakDays: 1, lastActiveDate: today, xpGranted: 0 };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [username]);

    const res = await client.query(
      "SELECT last_active_date, streak_days, max_streak FROM user_active_days WHERE username = $1 FOR UPDATE",
      [username]
    );
    const row = res.rows[0];

    if (row) {
      const prevDate = toServerDateString(row.last_active_date) || (row.last_active_date ? String(row.last_active_date).slice(0, 10) : null);
      const prevStreak = Math.max(0, Number(row.streak_days) || 0);

      if (prevDate === today) {
        await client.query("COMMIT");
        result.streakDays = prevStreak;
        result.lastActiveDate = today;
        return result;
      }
      if (prevDate === yesterday) {
        result.streakDays = prevStreak + 1;
      }
    }

    const prevMax = row ? Math.max(0, Number(row.max_streak) || 0) : 0;
    const newMaxStreak = Math.max(prevMax, result.streakDays);

    await client.query(
      `INSERT INTO user_active_days (username, last_active_date, streak_days, max_streak)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (username) DO UPDATE SET
         last_active_date = EXCLUDED.last_active_date,
         streak_days = EXCLUDED.streak_days,
         max_streak = GREATEST(user_active_days.max_streak, EXCLUDED.max_streak)`,
      [username, result.lastActiveDate, result.streakDays, newMaxStreak]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  const rewardConfig = await getRewardConfig("active_day");
  result.xpGranted = rewardConfig && typeof rewardConfig.xp === "number" ? rewardConfig.xp : 0;
  return result;
}
