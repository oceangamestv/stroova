/**
 * Хранилище пользователей и сессий в JSON-файле (простая «БД»).
 * Один файл — одни данные для всех браузеров и устройств, подключающихся к этому серверу.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");

const defaultStats = () => ({
  totalXp: 0,
  exercisesCompleted: 0,
  pairsCompleted: 0,
  puzzlesCompleted: 0,
  bestScore: 0,
  xpByDate: {},
});

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return { users: {}, sessions: {} };
    throw e;
  }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function getUsers() {
  return load().users || {};
}

export function getUser(username) {
  return getUsers()[username] ?? null;
}

export function saveUser(user) {
  const data = load();
  data.users = data.users || {};
  data.users[user.username] = user;
  save(data);
}

/** Удалить пользователя по логину (например при смене ника — старая запись удаляется). */
export function removeUser(username) {
  const data = load();
  data.users = data.users || {};
  delete data.users[username];
  save(data);
}

export function getSessionByToken(token) {
  const data = load();
  const sessions = data.sessions || {};
  return sessions[token] ?? null;
}

export function createSession(token, username) {
  const data = load();
  data.sessions = data.sessions || {};
  data.sessions[token] = { username, loginTime: new Date().toISOString() };
  save(data);
}

export function removeSession(token) {
  const data = load();
  if (data.sessions) delete data.sessions[token];
  save(data);
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
