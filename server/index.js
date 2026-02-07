/**
 * Простой API-сервер для STroova.
 * Данные хранятся в server/data.json — одна «БД» для всех браузеров.
 * Запуск: node server/index.js   (из корня проекта)
 * Фронт должен быть настроен с VITE_API_URL=http://localhost:3000/api
 */

import http from "http";
import crypto from "crypto";
import {
  getUsers,
  getUser,
  saveUser,
  getSessionByToken,
  createSession,
  removeSession,
  createDefaultUser,
} from "./store.js";

const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

function hashPassword(password) {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex");
}

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

function send(res, status, body) {
  const data = typeof body === "object" ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(data);
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
    if (getUser(username)) {
      send(res, 400, { error: "Пользователь с таким логином уже существует" });
      return;
    }
    const user = createDefaultUser(username, hashPassword(password));
    saveUser(user);
    const token = randomToken();
    createSession(token, username);
    send(res, 200, { token, user });
  },

  "POST /api/auth/login": async (req, res, body) => {
    const username = (body.username || "").trim();
    const password = body.password || "";
    const user = getUser(username);
    if (!user) {
      send(res, 401, { error: "Неверный логин или пароль" });
      return;
    }
    const hash = hashPassword(password);
    if (user.passwordHash !== hash) {
      send(res, 401, { error: "Неверный логин или пароль" });
      return;
    }
    const token = randomToken();
    createSession(token, username);
    send(res, 200, { token, user });
  },

  "GET /api/auth/check-username": async (req, res, _, url) => {
    const u = url.searchParams.get("username");
    const username = (u || "").trim();
    const available = !getUser(username);
    send(res, 200, { available });
  },

  "GET /api/me": async (req, res) => {
    const token = getAuthToken(req);
    if (!token) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    const session = getSessionByToken(token);
    if (!session) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    let user = getUser(session.username);
    if (!user) {
      send(res, 401, { error: "Пользователь не найден" });
      return;
    }
    user = normalizeUserForResponse(user);
    send(res, 200, user);
  },

  "PATCH /api/me": async (req, res, body) => {
    const token = getAuthToken(req);
    if (!token) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    const session = getSessionByToken(token);
    if (!session) {
      send(res, 401, { error: "Требуется авторизация" });
      return;
    }
    let user = getUser(session.username);
    if (!user) {
      send(res, 401, { error: "Пользователь не найден" });
      return;
    }
    if (body.displayName !== undefined) {
      const displayName = (body.displayName ?? "").trim();
      user = { ...user, displayName: displayName || user.username };
    }
    if (body.stats && typeof body.stats === "object") {
      user.stats = { ...user.stats, ...body.stats };
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
    saveUser(user);
    send(res, 200, normalizeUserForResponse(user));
  },
};

function normalizeUserForResponse(user) {
  return {
    ...user,
    personalDictionary: Array.isArray(user.personalDictionary) ? user.personalDictionary : [],
    gameSettings: user.gameSettings && typeof user.gameSettings === "object" ? user.gameSettings : {},
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
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

server.listen(PORT, () => {
  console.log(`STroova API: http://localhost:${PORT}/api`);
  console.log(`CORS: ${CORS_ORIGIN}`);
});
