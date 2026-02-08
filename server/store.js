/**
 * Хранилище пользователей и сессий в PostgreSQL.
 */

import { pool } from "./db.js";

const defaultStats = () => ({
  totalXp: 0,
  exercisesCompleted: 0,
  pairsCompleted: 0,
  puzzlesCompleted: 0,
  bestScore: 0,
  xpByDate: {},
});

function rowToUser(row) {
  if (!row) return null;
  return {
    username: row.username,
    displayName: row.display_name || row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    stats: row.stats && typeof row.stats === "object" ? row.stats : defaultStats(),
    wordProgress: row.word_progress && typeof row.word_progress === "object" ? row.word_progress : {},
    personalDictionary: Array.isArray(row.personal_dictionary) ? row.personal_dictionary : [],
    gameSettings: row.game_settings && typeof row.game_settings === "object" ? row.game_settings : {},
  };
}

export async function getUsers() {
  const res = await pool.query("SELECT * FROM users");
  const out = {};
  for (const row of res.rows) {
    const u = rowToUser(row);
    if (u) out[u.username] = u;
  }
  return out;
}

export async function getUser(username) {
  const res = await pool.query(
    "SELECT * FROM users WHERE username = $1",
    [username]
  );
  return rowToUser(res.rows[0] || null);
}

export async function saveUser(user) {
  const stats = JSON.stringify(user.stats || defaultStats());
  const wordProgress = JSON.stringify(user.wordProgress || {});
  const personalDictionary = JSON.stringify(user.personalDictionary || []);
  const gameSettings = JSON.stringify(user.gameSettings || {});

  await pool.query(
    `INSERT INTO users (username, display_name, password_hash, created_at, stats, word_progress, personal_dictionary, game_settings)
     VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
     ON CONFLICT (username) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       stats = EXCLUDED.stats,
       word_progress = EXCLUDED.word_progress,
       personal_dictionary = EXCLUDED.personal_dictionary,
       game_settings = EXCLUDED.game_settings`,
    [
      user.username,
      user.displayName ?? user.username,
      user.passwordHash,
      user.createdAt || new Date().toISOString(),
      stats,
      wordProgress,
      personalDictionary,
      gameSettings,
    ]
  );
}

export async function removeUser(username) {
  await pool.query("DELETE FROM users WHERE username = $1", [username]);
}

export async function getSessionByToken(token) {
  const res = await pool.query(
    "SELECT username, login_time FROM sessions WHERE token = $1",
    [token]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    username: row.username,
    loginTime: row.login_time instanceof Date ? row.login_time.toISOString() : row.login_time,
  };
}

export async function createSession(token, username) {
  await pool.query(
    "INSERT INTO sessions (token, username) VALUES ($1, $2) ON CONFLICT (token) DO UPDATE SET username = EXCLUDED.username, login_time = NOW()",
    [token, username]
  );
}

export async function removeSession(token) {
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

export function createDefaultUser(username, passwordHash) {
  return {
    username,
    displayName: username,
    passwordHash,
    createdAt: new Date().toISOString(),
    stats: defaultStats(),
    wordProgress: {},
    personalDictionary: [],
    gameSettings: {},
  };
}
