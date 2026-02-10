/**
 * API-сервер для STroova. Данные в PostgreSQL.
 * Запуск: node server/index.js (из корня проекта).
 * Нужны в .env: DATABASE_URL, PORT, CORS_ORIGIN.
 */
import "dotenv/config";

import http from "http";
import crypto from "crypto";
import zlib from "zlib";
import { initDb } from "./db.js";
import {
  getUser,
  saveUser,
  getSessionByToken,
  createSession,
  createDefaultUser,
  getLoginLockout,
  recordFailedLogin,
  clearLoginLockout,
} from "./store.js";
import { getWordsByLanguage, getLanguages, getWordIdsByLevel, getDictionaryVersion } from "./dictionaryRepo.js";
import { getActiveDays, recordActivity } from "./activeDays.js";
import { optIn, getLeaderboard } from "./rating.js";

const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
/** Список разрешённых origin (сайт + Capacitor Android/iOS) */
const CORS_ORIGINS = CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);

function getAllowedOrigin(req) {
  const origin = req?.headers?.origin;
  if (origin && CORS_ORIGINS.includes(origin)) return origin;
  return CORS_ORIGINS[0] || "*";
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex");
}

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

function send(res, status, body) {
  const req = res.req;
  const allowOrigin = getAllowedOrigin(req);
  const data = typeof body === "object" ? JSON.stringify(body) : body;
  const dataBuffer = Buffer.from(data, "utf8");
  
  // Проверяем, поддерживает ли клиент gzip
  const acceptEncoding = req?.headers["accept-encoding"] || "";
  const supportsGzip = acceptEncoding.includes("gzip") && dataBuffer.length > 1024; // Сжимаем только ответы >1KB
  
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  
  if (supportsGzip) {
    try {
      const compressed = zlib.gzipSync(dataBuffer);
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = compressed.length;
      res.writeHead(status, headers);
      res.end(compressed);
    } catch (err) {
      // Если сжатие не удалось, отправляем без сжатия
      headers["Content-Length"] = dataBuffer.length;
      res.writeHead(status, headers);
      res.end(dataBuffer);
    }
  } else {
    headers["Content-Length"] = dataBuffer.length;
    res.writeHead(status, headers);
    res.end(dataBuffer);
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (chunk) => (buf += chunk));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function getAuthToken(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

const routes = {
  "POST /api/auth/register": async (req, res, body) => {
    const username = (body.username || "").trim();
    const password = body.password || "";
    if (username.length < 3) {
      send(res, 400, { error: "Логин должен содержать минимум 3 символа" });
      return;
    }
    if (password.length < 4) {
      send(res, 400, { error: "Пароль должен содержать минимум 4 символа" });
      return;
    }
    if (await getUser(username)) {
      send(res, 400, { error: "Пользователь с таким логином уже существует" });
      return;
    }
    const user = createDefaultUser(username, hashPassword(password));
    const a0Ids = await getWordIdsByLevel("en", "A0");
    if (a0Ids.length > 0) user.personalDictionary = a0Ids;
    await saveUser(user);
    const token = randomToken();
    await createSession(token, username);
    send(res, 200, { token, user: normalizeUserForResponse(user) });
  },

  "POST /api/auth/login": async (req, res, body) => {
    const username = (body.username || "").trim();
    const password = body.password || "";
    const lockout = await getLoginLockout(username);
    if (lockout.lockedUntil) {
      const waitSec = Math.ceil((lockout.lockedUntil - new Date()) / 1000);
      send(res, 429, {
        error: "Слишком много попыток входа. Подождите 60 секунд.",
        retryAfterSeconds: Math.max(1, waitSec),
      });
      return;
    }
    const user = await getUser(username);
    if (!user) {
      send(res, 401, { error: "Неверный логин или пароль" });
      return;
    }
    const hash = hashPassword(password);
    if (user.passwordHash !== hash) {
      const { justLocked } = await recordFailedLogin(username);
      if (justLocked) {
        send(res, 429, {
          error: "Слишком много попыток входа. Подождите 60 секунд.",
          retryAfterSeconds: 60,
        });
      } else {
        send(res, 401, { error: "Неверный логин или пароль" });
      }
      return;
    }
    await clearLoginLockout(username);
    const token = randomToken();
    await createSession(token, username);
    send(res, 200, { token, user: normalizeUserForResponse(user) });
  },

  "GET /api/auth/check-username": async (req, res, _, url) => {
    const u = url.searchParams.get("username");
    const username = (u || "").trim();
    const available = !(await getUser(username));
    send(res, 200, { available });
  },

  "GET /api/me": async (req, res) => {
    const token = getAuthToken(req);
    if (!token) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    const session = await getSessionByToken(token);
    if (!session) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    let user = await getUser(session.username);
    if (!user) {
      send(res, 401, { error: "Пользователь не найден" });
      return;
    }
    const activeDays = await getActiveDays(session.username);
    user = normalizeUserForResponse(user, activeDays);
    send(res, 200, user);
  },

  "PATCH /api/me": async (req, res, body) => {
    const token = getAuthToken(req);
    if (!token) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    const session = await getSessionByToken(token);
    if (!session) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    let user = await getUser(session.username);
    if (!user) {
      send(res, 401, { error: "Пользователь не найден" });
      return;
    }
    let activeDays = { streakDays: 0, lastActiveDate: null };
    let activityXpGranted = 0;
    if (body.stats && typeof body.stats === "object") {
      const activity = await recordActivity(session.username);
      activeDays = {
        streakDays: activity.streakDays,
        lastActiveDate: activity.lastActiveDate,
      };
      activityXpGranted = activity.xpGranted || 0;
    }
    if (body.displayName !== undefined) {
      const displayName = (body.displayName ?? "").trim();
      user = { ...user, displayName: displayName || user.username };
    }
    if (body.stats && typeof body.stats === "object") {
      user.stats = { ...user.stats, ...body.stats };
      if (activityXpGranted > 0) {
        user.stats.totalXp = (user.stats.totalXp ?? 0) + activityXpGranted;
      }
    }
    if (body.wordProgress && typeof body.wordProgress === "object") {
      user.wordProgress = { ...user.wordProgress, ...body.wordProgress };
    }
    if (body.personalDictionary !== undefined) {
      user.personalDictionary = Array.isArray(body.personalDictionary)
        ? body.personalDictionary
        : [];
    }
    if (body.gameSettings !== undefined && typeof body.gameSettings === "object") {
      user.gameSettings = { ...user.gameSettings, ...body.gameSettings };
    }
    await saveUser(user);
    if (activeDays.streakDays === 0 && activeDays.lastActiveDate === null) {
      activeDays = await getActiveDays(session.username);
    }
    send(res, 200, normalizeUserForResponse(user, activeDays));
  },

  "GET /api/languages": async (req, res, body, url) => {
    const list = await getLanguages();
    send(res, 200, list);
  },

  "GET /api/dictionary/words": async (req, res, body, url) => {
    const lang = url.searchParams.get("lang") || "en";
    const accent = url.searchParams.get("accent") || undefined;
    const level = url.searchParams.get("level") || undefined;
    const words = await getWordsByLanguage(lang, { accent, level });
    send(res, 200, words);
  },

  "GET /api/dictionary/version": async (req, res, body, url) => {
    const lang = url.searchParams.get("lang") || "en";
    const version = await getDictionaryVersion(lang);
    send(res, 200, { version });
  },

  "POST /api/rating/participate": async (req, res) => {
    const token = getAuthToken(req);
    if (!token) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    const session = await getSessionByToken(token);
    if (!session) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    await optIn(session.username);
    send(res, 200, { ok: true });
  },

  "GET /api/rating/leaderboard": async (req, res, body, url) => {
    let currentUsername = null;
    const token = getAuthToken(req);
    if (token) {
      const session = await getSessionByToken(token);
      if (session) currentUsername = session.username;
    }
    const [day, week, all] = await Promise.all([
      getLeaderboard("day", currentUsername),
      getLeaderboard("week", currentUsername),
      getLeaderboard("all", currentUsername),
    ]);
    send(res, 200, {
      day,
      week,
      all,
      participating: day.participating,
    });
  },
};

function normalizeUserForResponse(user, activeDays) {
  const { passwordHash: _, ...rest } = user;
  const out = {
    ...rest,
    personalDictionary: Array.isArray(user.personalDictionary) ? user.personalDictionary : [],
    gameSettings: user.gameSettings && typeof user.gameSettings === "object" ? user.gameSettings : {},
  };
  if (activeDays) {
    out.activeDays = {
      streakDays: activeDays.streakDays ?? 0,
      lastActiveDate: activeDays.lastActiveDate ?? null,
      maxStreak: activeDays.maxStreak ?? 0,
    };
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    const allowOrigin = getAllowedOrigin(req);
    res.writeHead(204, {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const path = `${req.method} ${url.pathname}`;
  const handler = routes[path];

  if (!handler) {
    send(res, 404, { error: "Not found" });
    return;
  }

  let body = {};
  if (req.method === "POST" || req.method === "PATCH") {
    body = await parseBody(req);
  }

  try {
    await handler(req, res, body, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Internal server error" });
  }
});

async function start() {
  await initDb();
  server.listen(PORT, () => {
    console.log(`STroova API: http://localhost:${PORT}/api`);
    console.log(`CORS: ${CORS_ORIGIN}`);
    console.log(`DB: PostgreSQL`);
  });
}

start().catch((err) => {
  console.error("Ошибка запуска:", err);
  process.exit(1);
});
