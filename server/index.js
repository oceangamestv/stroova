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
import {
  getWordsByLanguage,
  getLanguages,
  getWordIdsByLevel,
  getDictionaryVersion,
  searchDictionaryEntries,
  getDictionaryEntryById,
  patchDictionaryEntry,
  updateDictionaryVersion,
  listDictionaryEntriesAdmin,
  getEntryV2Admin,
  setSenseReviewedAdmin,
  createSenseAdmin,
  patchSenseAdmin,
  addExampleAdmin,
  deleteExampleAdmin,
  setMainExampleAdmin,
  addFormAdmin,
  deleteFormAdmin,
  patchExampleAdmin,
  patchFormAdmin,
  deleteSenseAdmin,
} from "./dictionaryRepo.js";
import { getActiveDays, recordActivity } from "./activeDays.js";
import { optIn, getLeaderboard } from "./rating.js";
import { pool } from "./db.js";
import {
  addSavedByEntryId,
  addManySavedSenses,
  addSavedBySenseId,
  ensureUserDictionaryBackfilled,
  getCollection,
  getTodayPack,
  getWordCardByEntryId,
  getWordCardBySenseId,
  listCollections,
  listMyWords,
  lookupDictionaryTerm,
  ensureDefaultCollectionEnrolled,
  getCollectionProgress,
  getMyWordsSummary,
  getUserSenseState,
  removeSavedByEntryId,
  removeSavedBySenseId,
  setSavedStatus,
  syncUserDictionaryFromMePatch,
} from "./userDictionaryRepo.js";
import { getIpaBoth } from "./lib/ipaGenerator.js";

const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
/** Список разрешённых origin (сайт + Capacitor Android/iOS); убираем кавычки и пробелы */
const CORS_ORIGINS = CORS_ORIGIN.split(",")
  .map((s) => s.trim().replace(/^["']|["']$/g, "").trim())
  .filter(Boolean);

function getAllowedOrigin(req) {
  const origin = req?.headers?.origin;
  if (origin && CORS_ORIGINS.includes(origin)) return origin;
  if (origin === "null" || origin === "" || !origin) return CORS_ORIGINS[0] || "*";
  if (typeof origin === "string" && (origin.startsWith("capacitor://") || origin.startsWith("http://localhost") || origin.startsWith("https://localhost"))) return origin;
  return CORS_ORIGINS[0] || "*";
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex");
}

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

/** Убирает из API-ключа лишние символы (кавычки, > при копировании и т.д.). */
function sanitizeOpenAiKey(key) {
  if (!key || typeof key !== "string") return "";
  let s = key.trim();
  s = s.replace(/^["']|["']$/g, "").trim();
  // Ключи OpenAI: sk-proj-... или sk-..., допустимы буквы, цифры, дефис, подчёркивание
  s = s.replace(/[^\w-]+$/g, ""); // убрать хвост вроде > или пробелы
  return s;
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

async function getOptionalAuthUser(req) {
  const token = getAuthToken(req);
  if (!token) return null;
  const session = await getSessionByToken(token);
  if (!session) return null;
  const user = await getUser(session.username);
  if (!user) return null;
  return { user, session };
}

async function requireAuthUser(req, res) {
  const auth = await getOptionalAuthUser(req);
  if (!auth) {
    send(res, 401, { error: "Требуется авторизация" });
    return null;
  }
  return auth;
}

async function requireAdmin(req, res) {
  const auth = await requireAuthUser(req, res);
  if (!auth) return null;
  if (!auth.user?.isAdmin) {
    send(res, 403, { error: "Недостаточно прав" });
    return null;
  }
  return auth;
}

const START_PROFILE_TO_COLLECTION = {
  beginner: "a0_basics",
  basic_sentences: "a1_basics",
  everyday_topics: "a2_basics",
};

function normalizeStartProfile(v) {
  const s = String(v || "").trim();
  if (s === "beginner" || s === "basic_sentences" || s === "everyday_topics") return s;
  return null;
}

function getStartCollectionByUser(user) {
  const profile = normalizeStartProfile(user?.gameSettings?.dictionaryStartProfile);
  if (!profile) return { profile: null, collectionKey: null };
  return { profile, collectionKey: START_PROFILE_TO_COLLECTION[profile] || null };
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
    // Синхронизируем legacy JSON-поля → нормализованный персональный словарь
    try {
      const lang = String(body?.lang || "en").trim() || "en";
      await ensureUserDictionaryBackfilled(session.username, lang);
      await syncUserDictionaryFromMePatch(session.username, lang, {
        personalDictionary: body.personalDictionary,
        wordProgress: body.wordProgress,
      });
    } catch (e) {
      console.warn("user dictionary sync failed:", e);
    }
    if (activeDays.streakDays === 0 && activeDays.lastActiveDate === null) {
      activeDays = await getActiveDays(session.username);
    }
    send(res, 200, normalizeUserForResponse(user, activeDays));
  },

  // ===== User dictionary (казуальная подача) =====
  "GET /api/user-dictionary/today": async (req, res, body, url) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    await ensureUserDictionaryBackfilled(auth.user.username, lang);
    const { profile, collectionKey } = getStartCollectionByUser(auth.user);
    // Автоподключаем стартовую коллекцию только после явного выбора профиля.
    if (collectionKey) {
      try {
        await ensureDefaultCollectionEnrolled(auth.user.username, lang, collectionKey);
      } catch (e) {
        console.warn("default collection enroll failed:", e);
      }
    }
    const pack = await getTodayPack(auth.user.username, lang);
    const currentCollection = collectionKey
      ? await getCollectionProgress(auth.user.username, lang, collectionKey)
      : null;
    send(res, 200, { ...pack, currentCollection, startProfile: profile, startCollectionKey: collectionKey });
  },

  "POST /api/user-dictionary/start-profile": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const profile = normalizeStartProfile(body?.profile);
    if (!profile) {
      send(res, 400, { error: "Поле profile обязательно (beginner | basic_sentences | everyday_topics)" });
      return;
    }
    const collectionKey = START_PROFILE_TO_COLLECTION[profile] || "a0_basics";
    const user = auth.user;
    user.gameSettings = {
      ...(user.gameSettings && typeof user.gameSettings === "object" ? user.gameSettings : {}),
      dictionaryStartProfile: profile,
    };
    await saveUser(user);
    await ensureUserDictionaryBackfilled(user.username, lang);
    try {
      await ensureDefaultCollectionEnrolled(user.username, lang, collectionKey);
    } catch (e) {
      console.warn("start profile enroll failed:", e);
    }
    const pack = await getTodayPack(user.username, lang);
    const currentCollection = await getCollectionProgress(user.username, lang, collectionKey);
    send(res, 200, { ok: true, profile, collectionKey, currentCollection, ...pack });
  },

  "GET /api/user-dictionary/summary": async (req, res, body, url) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    await ensureUserDictionaryBackfilled(auth.user.username, lang);
    const out = await getMyWordsSummary(auth.user.username, lang);
    send(res, 200, out);
  },

  "GET /api/user-dictionary/my-words": async (req, res, body, url) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    await ensureUserDictionaryBackfilled(auth.user.username, lang);
    const q = url.searchParams.get("q") || "";
    const status = url.searchParams.get("status") || "all";
    const offset = url.searchParams.get("offset") || "0";
    const limit = url.searchParams.get("limit") || "50";
    const out = await listMyWords(auth.user.username, lang, { q, status, offset: Number(offset), limit: Number(limit) });
    send(res, 200, out);
  },

  "GET /api/user-dictionary/collections": async (req, res, body, url) => {
    const lang = url.searchParams.get("lang") || "en";
    const auth = await getOptionalAuthUser(req);
    const items = await listCollections(lang, auth?.user?.username ?? null);
    send(res, 200, { items });
  },

  "GET /api/user-dictionary/collection": async (req, res, body, url) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const id = url.searchParams.get("id");
    if (!id) {
      send(res, 400, { error: "Параметр id обязателен" });
      return;
    }
    await ensureUserDictionaryBackfilled(auth.user.username, lang);
    const out = await getCollection(auth.user.username, lang, Number(id));
    if (!out) {
      send(res, 404, { error: "Коллекция не найдена" });
      return;
    }
    send(res, 200, out);
  },

  "POST /api/user-dictionary/add": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = body?.entryId;
    if (!entryId) {
      send(res, 400, { error: "Поле entryId обязательно" });
      return;
    }
    await ensureUserDictionaryBackfilled(auth.user.username, lang);
    const out = await addSavedByEntryId(auth.user.username, lang, Number(entryId), "manual");
    if (!out) {
      send(res, 404, { error: "Слово не найдено" });
      return;
    }
    send(res, 200, { ok: true, ...out });
  },

  "POST /api/user-dictionary/add-sense": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const senseId = body?.senseId;
    if (!senseId) {
      send(res, 400, { error: "Поле senseId обязательно" });
      return;
    }
    await addSavedBySenseId(auth.user.username, Number(senseId), "manual");
    send(res, 200, { ok: true });
  },

  "POST /api/user-dictionary/remove": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = body?.entryId;
    if (!entryId) {
      send(res, 400, { error: "Поле entryId обязательно" });
      return;
    }
    await ensureUserDictionaryBackfilled(auth.user.username, lang);
    const out = await removeSavedByEntryId(auth.user.username, lang, Number(entryId));
    send(res, 200, out);
  },

  "POST /api/user-dictionary/remove-sense": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const senseId = body?.senseId;
    if (!senseId) {
      send(res, 400, { error: "Поле senseId обязательно" });
      return;
    }
    const out = await removeSavedBySenseId(auth.user.username, Number(senseId));
    send(res, 200, out);
  },

  "POST /api/user-dictionary/collection/add-all": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const collectionId = body?.collectionId;
    if (!collectionId) {
      send(res, 400, { error: "Поле collectionId обязательно" });
      return;
    }
    await ensureUserDictionaryBackfilled(auth.user.username, lang);
    const col = await getCollection(auth.user.username, lang, Number(collectionId));
    if (!col) {
      send(res, 404, { error: "Коллекция не найдена" });
      return;
    }
    const senseIds = (col.items || []).map((x) => Number(x.senseId)).filter((n) => Number.isFinite(n) && n > 0);
    const out = await addManySavedSenses(auth.user.username, senseIds, "collection");
    send(res, 200, out);
  },

  "POST /api/user-dictionary/status": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const senseId = body?.senseId;
    const status = body?.status;
    if (!senseId || !status) {
      send(res, 400, { error: "Поля senseId и status обязательны" });
      return;
    }
    const out = await setSavedStatus(auth.user.username, Number(senseId), String(status));
    if (!out) {
      send(res, 404, { error: "Запись не найдена" });
      return;
    }
    send(res, 200, { ok: true, status: out.status });
  },

  "GET /api/user-dictionary/sense-state": async (req, res, body, url) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const senseId = url.searchParams.get("senseId");
    if (!senseId) {
      send(res, 400, { error: "Параметр senseId обязателен" });
      return;
    }
    const out = await getUserSenseState(auth.user.username, Number(senseId));
    send(res, 200, out || { isSaved: false, status: null });
  },

  "GET /api/dictionary/card": async (req, res, body, url) => {
    const lang = url.searchParams.get("lang") || "en";
    const id = url.searchParams.get("id");
    if (!id) {
      send(res, 400, { error: "Параметр id обязателен" });
      return;
    }
    const card = await getWordCardByEntryId(lang, Number(id));
    if (!card) {
      send(res, 404, { error: "Слово не найдено" });
      return;
    }
    send(res, 200, card);
  },

  "GET /api/dictionary/card-v2": async (req, res, body, url) => {
    const lang = url.searchParams.get("lang") || "en";
    const senseId = url.searchParams.get("senseId");
    if (!senseId) {
      send(res, 400, { error: "Параметр senseId обязателен" });
      return;
    }
    const card = await getWordCardBySenseId(lang, Number(senseId));
    if (!card) {
      send(res, 404, { error: "Смысл не найден" });
      return;
    }
    send(res, 200, card);
  },

  "GET /api/dictionary/lookup": async (req, res, body, url) => {
    const lang = url.searchParams.get("lang") || "en";
    const term = url.searchParams.get("term") || "";
    const limit = url.searchParams.get("limit") || "5";
    if (!String(term).trim()) {
      send(res, 400, { error: "Параметр term обязателен" });
      return;
    }
    const items = await lookupDictionaryTerm(lang, term, Number(limit));
    send(res, 200, { items });
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

  /** Отладка: как сервер видит OPENAI_API_KEY (без показа самого ключа). Только для админа. */
  "GET /api/admin/openai-check": async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const raw = (process.env.OPENAI_API_KEY || "").trim();
    const key = sanitizeOpenAiKey(process.env.OPENAI_API_KEY);
    const info = {
      keySet: !!raw,
      keyLength: key.length,
      keyLengthRaw: raw.length,
      prefix: key ? key.slice(0, 10) + "..." : null,
      suffix: key ? "..." + key.slice(-4) : null,
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim(),
      model: (process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
    };
    send(res, 200, info);
  },

  // ===== Admin: словарь (только для is_admin = true) =====
  "GET /api/admin/dictionary/search": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const q = url.searchParams.get("q") || "";
    const limit = url.searchParams.get("limit") || "50";
    if (!String(q).trim()) {
      send(res, 400, { error: "Параметр q обязателен" });
      return;
    }
    const items = await searchDictionaryEntries(lang, q, Number(limit));
    send(res, 200, { items });
  },

  "GET /api/admin/dictionary/entry": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const id = url.searchParams.get("id");
    if (!id) {
      send(res, 400, { error: "Параметр id обязателен" });
      return;
    }
    const entry = await getDictionaryEntryById(lang, Number(id));
    if (!entry) {
      send(res, 404, { error: "Запись не найдена" });
      return;
    }
    send(res, 200, { entry });
  },

  "PATCH /api/admin/dictionary/entry": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = (body?.lang || "en").trim();
    const id = body?.id;
    const patch = body?.patch;
    if (!id) {
      send(res, 400, { error: "Поле id обязательно" });
      return;
    }
    const updated = await patchDictionaryEntry(lang, Number(id), patch || {}, auth.user.username);
    if (!updated) {
      send(res, 404, { error: "Запись не найдена" });
      return;
    }
    // Если правили словарь — обновим версию (для кэша на клиентах)
    await updateDictionaryVersion(lang);
    send(res, 200, { entry: updated });
  },

  "GET /api/admin/dictionary/list": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const q = url.searchParams.get("q") || "";
    const level = url.searchParams.get("level") || "all";
    const register = url.searchParams.get("register") || "all";
    const rarity = url.searchParams.get("rarity") || "all";
    const reviewed = url.searchParams.get("reviewed") || "all"; // all|yes|no
    const missingExample = url.searchParams.get("missingExample") === "1";
    const missingIpa = url.searchParams.get("missingIpa") === "1";
    const missingRu = url.searchParams.get("missingRu") === "1";
    const offset = url.searchParams.get("offset") || "0";
    const limit = url.searchParams.get("limit") || "100";
    const order = url.searchParams.get("order") || "frequency";
    const data = await listDictionaryEntriesAdmin(lang, {
      q,
      level,
      register,
      rarity,
      reviewed,
      missingExample,
      missingIpa,
      missingRu,
      offset: Number(offset),
      limit: Number(limit),
      order,
    });
    send(res, 200, data);
  },

  "GET /api/admin/dictionary/entry-v2": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const id = url.searchParams.get("id");
    if (!id) {
      send(res, 400, { error: "Параметр id обязателен" });
      return;
    }
    const data = await getEntryV2Admin(lang, Number(id));
    if (!data) {
      send(res, 404, { error: "Запись не найдена" });
      return;
    }
    send(res, 200, data);
  },

  "POST /api/admin/dictionary/review": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = body?.entryId;
    const reviewed = !!body?.reviewed;
    if (!entryId) {
      send(res, 400, { error: "Поле entryId обязательно" });
      return;
    }
    const r = await setSenseReviewedAdmin(lang, Number(entryId), auth.user.username, reviewed);
    if (!r) {
      send(res, 404, { error: "Связанный sense не найден" });
      return;
    }
    send(res, 200, { ok: true, review: r });
  },

  "POST /api/admin/dictionary/sense": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = body?.entryId;
    const sense = body?.sense;
    if (!entryId) {
      send(res, 400, { error: "Поле entryId обязательно" });
      return;
    }
    const data = await createSenseAdmin(lang, Number(entryId), sense || {}, auth.user.username);
    if (!data) {
      send(res, 400, { error: "Не удалось создать значение" });
      return;
    }
    send(res, 200, data);
  },

  "PATCH /api/admin/dictionary/sense": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const senseId = body?.senseId;
    const patch = body?.patch;
    if (!senseId) {
      send(res, 400, { error: "Поле senseId обязательно" });
      return;
    }
    const updated = await patchSenseAdmin(lang, Number(senseId), patch || {}, auth.user.username);
    if (!updated) {
      send(res, 400, { error: "Не удалось обновить значение" });
      return;
    }
    send(res, 200, { ok: true, sense: updated });
  },

  "POST /api/admin/dictionary/example": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const senseId = body?.senseId;
    const example = body?.example;
    if (!senseId || !example) {
      send(res, 400, { error: "Поля senseId и example обязательны" });
      return;
    }
    const created = await addExampleAdmin(lang, Number(senseId), example, auth.user.username);
    if (!created) {
      send(res, 400, { error: "Не удалось добавить пример" });
      return;
    }
    send(res, 200, { ok: true, example: created });
  },

  "PATCH /api/admin/dictionary/example": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const id = body?.id;
    const patch = body?.patch;
    if (!id || !patch) {
      send(res, 400, { error: "Поля id и patch обязательны" });
      return;
    }
    const updated = await patchExampleAdmin(lang, Number(id), patch, auth.user.username);
    if (!updated) {
      send(res, 404, { error: "Пример не найден" });
      return;
    }
    send(res, 200, { ok: true, example: updated });
  },

  "POST /api/admin/dictionary/example/delete": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const id = body?.id;
    if (!id) {
      send(res, 400, { error: "Поле id обязательно" });
      return;
    }
    const out = await deleteExampleAdmin(lang, Number(id), auth.user.username);
    if (!out) {
      send(res, 404, { error: "Пример не найден" });
      return;
    }
    send(res, 200, { ok: true });
  },

  "POST /api/admin/dictionary/example/set-main": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const id = body?.id;
    if (!id) {
      send(res, 400, { error: "Поле id обязательно" });
      return;
    }
    const updated = await setMainExampleAdmin(lang, Number(id), auth.user.username);
    if (!updated) {
      send(res, 404, { error: "Пример не найден" });
      return;
    }
    send(res, 200, { ok: true, example: updated });
  },

  "POST /api/admin/dictionary/form": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const lemmaId = body?.lemmaId;
    const form = body?.form;
    if (!lemmaId || !form) {
      send(res, 400, { error: "Поля lemmaId и form обязательны" });
      return;
    }
    const created = await addFormAdmin(lang, Number(lemmaId), form, auth.user.username);
    if (!created) {
      send(res, 400, { error: "Не удалось добавить форму" });
      return;
    }
    send(res, 200, { ok: true, form: created });
  },

  "PATCH /api/admin/dictionary/form": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const id = body?.id;
    const patch = body?.patch;
    if (!id || !patch) {
      send(res, 400, { error: "Поля id и patch обязательны" });
      return;
    }
    const updated = await patchFormAdmin(lang, Number(id), patch, auth.user.username);
    if (!updated) {
      send(res, 404, { error: "Форма не найдена" });
      return;
    }
    send(res, 200, { ok: true, form: updated });
  },

  "POST /api/admin/dictionary/form/delete": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const id = body?.id;
    if (!id) {
      send(res, 400, { error: "Поле id обязательно" });
      return;
    }
    const out = await deleteFormAdmin(lang, Number(id), auth.user.username);
    if (!out) {
      send(res, 404, { error: "Форма не найдена" });
      return;
    }
    send(res, 200, { ok: true });
  },

  "POST /api/admin/dictionary/sense/delete": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const id = body?.id;
    if (!id) {
      send(res, 400, { error: "Поле id обязательно" });
      return;
    }
    const out = await deleteSenseAdmin(lang, Number(id), auth.user.username);
    if (!out) {
      send(res, 404, { error: "Значение не найдено" });
      return;
    }
    if (out.error) {
      send(res, 400, { error: out.error });
      return;
    }
    send(res, 200, { ok: true });
  },

  /**
   * Генерация IPA (UK/US) для слова/выражения.
   * Используется отдельной кнопкой в админке.
   */
  "POST /api/admin/dictionary/fill-ipa": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = body?.entryId != null ? Number(body.entryId) : null;
    const wordRaw = String(body?.word || "").trim();
    let en = wordRaw;

    if (!en && entryId) {
      const existing = await getDictionaryEntryById(lang, entryId);
      if (!existing) {
        send(res, 404, { error: "Запись словаря не найдена" });
        return;
      }
      en = String(existing.en || "").trim();
    }

    if (!en) {
      send(res, 400, { error: "Нужно передать word или entryId с непустым en" });
      return;
    }

    const { ipaUk, ipaUs } = await getIpaBoth(en);
    send(res, 200, { ipaUk, ipaUs, en });
  },
  "POST /admin/dictionary/fill-ipa": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = body?.entryId != null ? Number(body.entryId) : null;
    const wordRaw = String(body?.word || "").trim();
    let en = wordRaw;
    if (!en && entryId) {
      const existing = await getDictionaryEntryById(lang, entryId);
      if (!existing) {
        send(res, 404, { error: "Запись словаря не найдена" });
        return;
      }
      en = String(existing.en || "").trim();
    }
    if (!en) {
      send(res, 400, { error: "Нужно передать word или entryId с непустым en" });
      return;
    }
    const { ipaUk, ipaUs } = await getIpaBoth(en);
    send(res, 200, { ipaUk, ipaUs, en });
  },

  /**
   * AI-подсказка по слову для админки. Требует OPENAI_API_KEY.
   * Возвращает suggestion в формате полей dictionary_entries.
   */
  "POST /api/admin/dictionary/ai-suggest": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const apiKey = sanitizeOpenAiKey(process.env.OPENAI_API_KEY);
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
    const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
    const lang = String(body?.lang || "en").trim() || "en";
    const word = String(body?.word || "").trim();
    const existing = body?.existing && typeof body.existing === "object" ? body.existing : null;

    if (!word) {
      send(res, 400, { error: "Поле word обязательно" });
      return;
    }
    if (!apiKey) {
      send(res, 400, { error: "OPENAI_API_KEY не задан на сервере" });
      return;
    }

    const inputJson = { lang, word, existing };
    let outputJson = {};
    let errText = "";
    try {
      const prompt = [
        "Ты помощник администратора словаря английских слов.",
        "Сгенерируй JSON-объект ТОЛЬКО со следующими полями (можно пропускать неизвестные):",
        "en, ru, level, accent, frequencyRank, rarity, register, ipaUk, ipaUs, example, exampleRu",
        "Требования:",
        "- en: исходное слово/выражение (как в запросе)",
        "- ru: короткий, самый частотный перевод (1 вариант, без скобок и перечислений)",
        "- level: A0|A1|A2|B1|B2|C1|C2 (примерно, по сложности)",
        "- rarity: 'не редкое'|'редкое'|'очень редкое'",
        "- register: 'официальная'|'разговорная'",
        "- ipaUk/ipaUs: транскрипция IPA для UK/US (если не уверен — оставь пустой строкой)",
        "- example/exampleRu: короткий пример на EN и естественный перевод на RU",
        "Если existing задан — старайся улучшить/уточнить его, но не делай слишком длинно.",
        "Верни СТРОГО JSON без пояснений и без markdown.",
      ].join("\n");

      const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(inputJson) },
          ],
          temperature: 0.4,
        }),
      });

      if (!response.ok) {
        const t = await response.text();
        throw new Error(`LLM error ${response.status}: ${t}`);
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("Пустой ответ от модели");
      }
      outputJson = JSON.parse(content);
      send(res, 200, { suggestion: outputJson });
    } catch (e) {
      errText = e instanceof Error ? e.message : String(e);
      send(res, 500, { error: "Не удалось получить AI-подсказку", details: errText });
    } finally {
      try {
        await pool.query(
          `INSERT INTO dictionary_ai_suggestions (username, lang_code, input_json, output_json, model, error)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
          [
            auth.user.username,
            lang,
            JSON.stringify(inputJson || {}),
            JSON.stringify(outputJson || {}),
            model,
            errText || "",
          ]
        );
      } catch (logErr) {
        console.warn("Не удалось записать лог AI:", logErr);
      }
    }
  },

  /**
   * AI-черновик по слову/записи для админки. Требует OPENAI_API_KEY.
   * Возвращает draft (расширенный JSON: смыслы, примеры, формы).
   */
  "POST /api/admin/dictionary/ai-draft": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const apiKey = sanitizeOpenAiKey(process.env.OPENAI_API_KEY);
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
    const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = body?.entryId != null ? Number(body.entryId) : null;
    const word = String(body?.word || "").trim();

    if (!apiKey) {
      send(res, 400, { error: "OPENAI_API_KEY не задан на сервере" });
      return;
    }
    if (!entryId && !word) {
      send(res, 400, { error: "Нужно передать entryId или word" });
      return;
    }

    let existing = null;
    try {
      if (entryId) existing = await getEntryV2Admin(lang, entryId);
    } catch (e) {
      console.warn("ai-draft: failed to fetch existing entry:", e);
    }

    const inputJson = { lang, entryId, word, existing };
    let outputJson = {};
    let errText = "";

    const safeParseJson = (text) => {
      const t = String(text || "").trim();
      if (!t) throw new Error("Пустой ответ от модели");
      try {
        return JSON.parse(t);
      } catch {
        // Попытка вытащить JSON-объект из текста
        const start = t.indexOf("{");
        const end = t.lastIndexOf("}");
        if (start >= 0 && end > start) {
          const slice = t.slice(start, end + 1);
          return JSON.parse(slice);
        }
        throw new Error("Не удалось распарсить JSON из ответа модели");
      }
    };
    const normalizeDraftForUi = (draftRaw) => {
      const draftObj = draftRaw && typeof draftRaw === "object" ? { ...draftRaw } : {};
      const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
      const toNum = (v, fallback) => {
        const raw = String(v ?? "").trim();
        if (!/^-?\d+$/.test(raw)) return fallback;
        const n = Number.parseInt(raw, 10);
        return Number.isFinite(n) ? n : fallback;
      };
      const normalizeLevel = (v) => {
        const s = String(v ?? "").trim().toUpperCase();
        return ["A0", "A1", "A2", "B1", "B2", "C1", "C2"].includes(s) ? s : null;
      };
      const normalizeAccent = (v) => {
        const s = String(v ?? "").trim().toLowerCase();
        if (!s) return null;
        if (s === "both" || s === "uk/us" || s === "us/uk") return "both";
        if (s === "uk" || s === "british" || s === "br") return "UK";
        if (s === "us" || s === "american" || s === "am") return "US";
        return null;
      };
      const normalizeRarity = (v) => {
        const s = String(v ?? "").trim().toLowerCase();
        if (!s) return null;
        if (s.includes("очень") && s.includes("ред")) return "очень редкое";
        if (s === "редкое" || s === "rare" || s === "uncommon") return "редкое";
        if (s === "не редкое" || s === "частое" || s === "обычное" || s === "common") return "не редкое";
        return null;
      };
      const normalizeRegister = (v) => {
        const s = String(v ?? "").trim().toLowerCase();
        if (!s) return null;
        if (s === "официальная" || s === "formal") return "официальная";
        if (s === "разговорная" || s === "informal" || s === "colloquial") return "разговорная";
        return null;
      };
      const ALIASES = {
        en: "en",
        lemma: "en",
        ru: "ru",
        gloss_ru: "ru",
        level: "level",
        accent: "accent",
        frequencyRank: "frequencyRank",
        frequency_rank: "frequencyRank",
        rarity: "rarity",
        register: "register",
        ipaUk: "ipaUk",
        ipa_uk: "ipaUk",
        ipaUs: "ipaUs",
        ipa_us: "ipaUs",
        example: "example",
        exampleRu: "exampleRu",
        example_ru: "exampleRu",
      };
      const pickCard = (src) => {
        const obj = asObj(src);
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
          const field = ALIASES[k];
          if (!field || v === undefined) continue;
          if (field === "frequencyRank") out.frequencyRank = Math.max(1, toNum(v, 15000));
          else if (field === "level") {
            const n = normalizeLevel(v);
            if (n) out.level = n;
          } else if (field === "accent") {
            const n = normalizeAccent(v);
            if (n) out.accent = n;
          } else if (field === "rarity") {
            const n = normalizeRarity(v);
            if (n) out.rarity = n;
          } else if (field === "register") {
            const n = normalizeRegister(v);
            if (n) out.register = n;
          } else {
            out[field] = typeof v === "string" ? v.trim() : String(v ?? "");
          }
        }
        return out;
      };

      const mergedEntryPatch = {
        ...pickCard(draftObj),
        ...pickCard(draftObj.lemmaPatch),
        ...pickCard(draftObj.entryPatch),
      };

      draftObj.entryPatch = mergedEntryPatch;
      if (!Array.isArray(draftObj.senses)) draftObj.senses = [];
      if (!Array.isArray(draftObj.forms)) draftObj.forms = [];
      if (!Array.isArray(draftObj.warnings)) draftObj.warnings = [];

      const required = ["en", "ru", "level", "accent", "frequencyRank", "rarity", "register", "ipaUk", "ipaUs", "example", "exampleRu"];
      const missing = required.filter((k) => {
        const v = mergedEntryPatch[k];
        return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
      });
      if (missing.length > 0) {
        draftObj.warnings = [...draftObj.warnings, `entryPatch missing: ${missing.join(", ")}`];
      }

      return draftObj;
    };

    try {
      const schema = [
        "{",
        '  "entryPatch": { "en": "...", "ru": "...", "level": "A0|A1|A2|B1|B2|C1|C2", "accent": "both|UK|US", "frequencyRank": 1200, "rarity": "не редкое|редкое|очень редкое", "register": "разговорная|официальная", "ipaUk": "/.../ или \"\"", "ipaUs": "/.../ или \"\"", "example": "...", "exampleRu": "..." },',
        '  "lemmaPatch": { /* опционально: frequencyRank, rarity, accent, ipaUk, ipaUs */ },',
        '  "senses": [',
        "    {",
        '      "senseNo": 1,',
        '      "level": "A0|A1|A2|B1|B2|C1|C2",',
        '      "register": "официальная|разговорная",',
        '      "glossRu": "короткий перевод (1 вариант)",',
        '      "definitionRu": "более развернутое объяснение (опционально)",',
        '      "usageNote": "заметка об употреблении (опционально)",',
        '      "examples": [ { "en": "...", "ru": "...", "isMain": true|false } ]',
        "    }",
        "  ],",
        '  "forms": [ { "form": "...", "formType": "ing|past|past_participle|third_person_singular|plural|comparative|superlative|other", "isIrregular": true|false, "notes": "" } ],',
        '  "warnings": [ "..." ]',
        "}",
      ].join("\n");

      const prompt = [
        "Ты помощник администратора словаря английских слов. Генерируешь черновик по слову для ручного подтверждения.",
        "Вход: JSON с lang, entryId?, word?, existing? (текущие данные записи, если есть).",
        "",
        "Критично — объект entryPatch (карточка слова). ОБЯЗАТЕЛЕН, все поля с осмысленными и правильными значениями:",
        "- en — головная форма (как в запросе или из existing).",
        "- ru — один короткий частотный перевод (не перечисление через запятую).",
        "- level — CEFR (A0–C2) по реальной частотности и сложности.",
        "- accent — both | UK | US по употреблению.",
        "- frequencyRank — число (чем меньше, тем частотнее; типично 1–20000).",
        "- rarity — «не редкое» | «редкое» | «очень редкое».",
        "- register — «разговорная» | «официальная».",
        "- ipaUk, ipaUs — IPA в слэшах; если не уверен — пустая строка \"\".",
        "- example — одно короткое естественное предложение на EN, иллюстрирующее главное значение.",
        "- exampleRu — перевод этого примера на RU, естественный и краткий.",
        "Каждое поле — уникальный смысл; не дублировать, не заполнять «для галочки».",
        "Нельзя складывать карточные поля только в lemmaPatch: они обязательно должны быть в entryPatch.",
        "- Смыслы (senses): 1–4 реально разных значения, glossRu — один вариант на смысл. Примеры короткие и естественные.",
        "- Формы (forms): по части речи (глагол: ing, past, past_participle; сущ.: plural; прил.: comparative/superlative). Если неочевидно — не добавляй.",
        "",
        "Выход: СТРОГО один JSON без markdown. Формат:",
        schema,
      ].join("\n");

      const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(inputJson) },
          ],
          temperature: 0.35,
        }),
      });

      if (!response.ok) {
        const t = await response.text();
        throw new Error(`LLM error ${response.status}: ${t}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      outputJson = normalizeDraftForUi(safeParseJson(content));
      send(res, 200, { draft: outputJson });
    } catch (e) {
      errText = e instanceof Error ? e.message : String(e);
      send(res, 500, { error: "Не удалось получить AI-черновик", details: errText });
    } finally {
      try {
        await pool.query(
          `INSERT INTO dictionary_ai_suggestions (username, lang_code, input_json, output_json, model, error)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
          [
            auth.user.username,
            lang,
            JSON.stringify(inputJson || {}),
            JSON.stringify(outputJson || {}),
            model,
            errText || "",
          ]
        );
      } catch (logErr) {
        console.warn("Не удалось записать лог AI:", logErr);
      }
    }
  },

  /**
   * Применение AI-черновика (частично, по выбору) к записи словаря.
   * Операция выполняется транзакционно.
   */
  "POST /api/admin/dictionary/apply-draft": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = body?.entryId != null ? Number(body.entryId) : null;
    const draft = body?.draft && typeof body.draft === "object" ? body.draft : null;
    const apply = body?.apply && typeof body.apply === "object" ? body.apply : {};

    if (!entryId || !draft) {
      send(res, 400, { error: "Поля entryId и draft обязательны" });
      return;
    }

    const applyEntryPatch = apply?.entryPatch !== false; // default true
    const applyLemmaPatch = apply?.lemmaPatch !== false; // default true
    const selectedSenseNos = Array.isArray(apply?.selectedSenseNos)
      ? apply.selectedSenseNos.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : null; // null => all
    const applySense1Core = Boolean(apply?.applySense1Core); // default false
    const replaceExamples = Boolean(apply?.replaceExamples); // default false
    const selectedFormIndexes = Array.isArray(apply?.selectedFormIndexes)
      ? apply.selectedFormIndexes.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0)
      : null; // null => all

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) Apply legacy entry patch (also syncs lemma/sense#1 + main example + link)
      if (applyEntryPatch && draft.entryPatch && typeof draft.entryPatch === "object") {
        await patchDictionaryEntry(lang, entryId, draft.entryPatch, auth.user.username, client);
      }

      // 2) Ensure v2 link exists (and get lemmaId/senseId)
      const linkRes = await client.query(
        `SELECT lemma_id AS "lemmaId", sense_id AS "senseId" FROM dictionary_entry_links WHERE entry_id = $1`,
        [entryId]
      );
      let lemmaId = linkRes.rows[0]?.lemmaId || null;
      let sense1Id = linkRes.rows[0]?.senseId || null;

      if (!lemmaId || !sense1Id) {
        // try to reconstruct from entry (same policy as v2 sync)
        const entryRes = await client.query(
          `SELECT language_id AS "languageId", id, en, ru, accent, level,
                  frequency_rank AS "frequencyRank", rarity, register,
                  ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu"
           FROM dictionary_entries WHERE id = $1`,
          [entryId]
        );
        const row = entryRes.rows[0];
        if (row?.languageId) {
          // call internal helper via SQL equivalent (reuse existing sync through patchDictionaryEntry would have done it;
          // but if entryPatch wasn't applied we still want link)
          // Minimal: upsert lemma + sense#1 + link + main example.
          const lemmaKey = String(row.en || "").trim().toLowerCase();
          if (lemmaKey) {
            const lemmaRes = await client.query(
              `
                INSERT INTO dictionary_lemmas (language_id, lemma_key, lemma, frequency_rank, rarity, accent, ipa_uk, ipa_us, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (language_id, lemma_key) DO UPDATE SET
                  lemma = EXCLUDED.lemma,
                  frequency_rank = EXCLUDED.frequency_rank,
                  rarity = EXCLUDED.rarity,
                  accent = EXCLUDED.accent,
                  ipa_uk = EXCLUDED.ipa_uk,
                  ipa_us = EXCLUDED.ipa_us,
                  updated_at = NOW()
                RETURNING id
              `,
              [
                row.languageId,
                lemmaKey,
                String(row.en || "").trim(),
                row.frequencyRank ?? 15000,
                String(row.rarity || "не редкое"),
                String(row.accent || "both"),
                String(row.ipaUk || "").trim(),
                String(row.ipaUs || "").trim(),
              ]
            );
            lemmaId = lemmaRes.rows[0]?.id || null;
          }
          if (lemmaId) {
            const senseRes = await client.query(
              `
                INSERT INTO dictionary_senses (lemma_id, sense_no, level, register, gloss_ru, updated_at)
                VALUES ($1, 1, $2, $3, $4, NOW())
                ON CONFLICT (lemma_id, sense_no) DO UPDATE SET
                  level = EXCLUDED.level,
                  register = EXCLUDED.register,
                  gloss_ru = EXCLUDED.gloss_ru,
                  updated_at = NOW()
                RETURNING id
              `,
              [lemmaId, String(row.level || "A0"), String(row.register || "разговорная"), String(row.ru || "").trim()]
            );
            sense1Id = senseRes.rows[0]?.id || null;
          }
          if (sense1Id) {
            await client.query(`DELETE FROM dictionary_examples WHERE sense_id = $1 AND is_main = TRUE`, [sense1Id]);
            const exEn = String(row.example || "").trim();
            const exRu = String(row.exampleRu || "").trim();
            if (exEn) {
              await client.query(
                `INSERT INTO dictionary_examples (sense_id, en, ru, is_main, sort_order)
                 VALUES ($1, $2, $3, TRUE, 0)
                 ON CONFLICT (sense_id, en, ru) DO NOTHING`,
                [sense1Id, exEn, exRu]
              );
            }
            await client.query(
              `
                INSERT INTO dictionary_entry_links (entry_id, lemma_id, sense_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (entry_id) DO UPDATE SET lemma_id = EXCLUDED.lemma_id, sense_id = EXCLUDED.sense_id
              `,
              [entryId, lemmaId, sense1Id]
            );
          }
        }
      }

      if (!lemmaId) throw new Error("Не удалось определить lemmaId для записи");

      // 3) Apply lemmaPatch
      if (applyLemmaPatch && draft.lemmaPatch && typeof draft.lemmaPatch === "object") {
        const p = draft.lemmaPatch || {};
        const sets = [];
        const params = [];
        let i = 1;
        const setIf = (col, val) => {
          if (val === undefined) return;
          sets.push(`${col} = $${i++}`);
          params.push(val);
        };
        setIf("frequency_rank", p.frequencyRank);
        setIf("rarity", p.rarity);
        setIf("accent", p.accent);
        setIf("ipa_uk", p.ipaUk);
        setIf("ipa_us", p.ipaUs);
        if (sets.length) {
          params.push(lemmaId);
          await client.query(`UPDATE dictionary_lemmas SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${i}`, params);
        }
      }

      // 4) Apply senses + examples
      const senses = Array.isArray(draft.senses) ? draft.senses : [];
      const senseNosToApply = selectedSenseNos || senses.map((s) => Number(s?.senseNo)).filter((n) => Number.isFinite(n) && n > 0);

      for (const s of senses) {
        const senseNo = Number(s?.senseNo);
        if (!Number.isFinite(senseNo) || senseNo <= 0) continue;
        if (!senseNosToApply.includes(senseNo)) continue;

        // upsert sense row
        const level = s?.level;
        const register = s?.register;
        const glossRu = s?.glossRu;
        const definitionRu = s?.definitionRu;
        const usageNote = s?.usageNote;

        // For sense #1: keep legacy sync rules — don't touch core fields unless explicitly allowed
        const canTouchCore = senseNo !== 1 || applySense1Core;

        const existingSenseRes = await client.query(
          `SELECT id FROM dictionary_senses WHERE lemma_id = $1 AND sense_no = $2`,
          [lemmaId, senseNo]
        );
        let senseId = existingSenseRes.rows[0]?.id || null;

        if (!senseId) {
          const ins = await client.query(
            `
              INSERT INTO dictionary_senses (lemma_id, sense_no, level, register, gloss_ru, definition_ru, usage_note, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
              RETURNING id
            `,
            [
              lemmaId,
              senseNo,
              canTouchCore ? (level || "A0") : "A0",
              canTouchCore ? (register || "разговорная") : "разговорная",
              canTouchCore ? String(glossRu || "") : "",
              String(definitionRu || ""),
              String(usageNote || ""),
            ]
          );
          senseId = ins.rows[0]?.id || null;
        } else {
          const sets = [];
          const params = [];
          let i = 1;
          const setIf = (col, val) => {
            if (val === undefined) return;
            sets.push(`${col} = $${i++}`);
            params.push(val);
          };
          if (canTouchCore) {
            setIf("level", level);
            setIf("register", register);
            setIf("gloss_ru", glossRu);
          }
          setIf("definition_ru", definitionRu);
          setIf("usage_note", usageNote);
          if (sets.length) {
            params.push(senseId);
            await client.query(`UPDATE dictionary_senses SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${i}`, params);
          }
        }

        if (!senseId) continue;

        const examples = Array.isArray(s?.examples) ? s.examples : [];
        if (replaceExamples) {
          await client.query(`DELETE FROM dictionary_examples WHERE sense_id = $1`, [senseId]);
        }
        for (const ex of examples) {
          const en = String(ex?.en || "").trim();
          const ru = String(ex?.ru || "").trim();
          if (!en) continue;
          const isMain = Boolean(ex?.isMain);

          const inserted = await client.query(
            `
              INSERT INTO dictionary_examples (sense_id, en, ru, is_main, sort_order)
              VALUES ($1, $2, $3, $4, 0)
              ON CONFLICT (sense_id, en, ru) DO UPDATE SET
                ru = EXCLUDED.ru
              RETURNING id
            `,
            [senseId, en, ru, isMain]
          );
          const exampleId = inserted.rows[0]?.id;
          if (exampleId && isMain) {
            // ensure single main
            await client.query(`UPDATE dictionary_examples SET is_main = FALSE WHERE sense_id = $1 AND id <> $2`, [senseId, exampleId]);
          }
        }
      }

      // 5) Apply forms
      const forms = Array.isArray(draft.forms) ? draft.forms : [];
      const idxToApply = selectedFormIndexes || forms.map((_, idx) => idx);
      for (let idx = 0; idx < forms.length; idx++) {
        if (!idxToApply.includes(idx)) continue;
        const f = forms[idx];
        const form = String(f?.form || "").trim();
        const formType = String(f?.formType || "").trim();
        if (!form || !formType) continue;
        await client.query(
          `
            INSERT INTO dictionary_forms (lemma_id, form, form_type, is_irregular, notes)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (lemma_id, form, form_type) DO UPDATE SET
              is_irregular = EXCLUDED.is_irregular,
              notes = EXCLUDED.notes
          `,
          [lemmaId, form, formType, Boolean(f?.isIrregular), String(f?.notes || "")]
        );
      }

      await client.query("COMMIT");
      await updateDictionaryVersion(lang);
      const fresh = await getEntryV2Admin(lang, entryId);
      send(res, 200, { ok: true, entry: fresh });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      const msg = e instanceof Error ? e.message : String(e);
      send(res, 500, { error: "Не удалось применить черновик", details: msg });
    } finally {
      client.release();
    }
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
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;
  // Если прокси отдаёт путь без /api (например /admin/dictionary/...), добавляем префикс для совпадения с routes
  if (!pathname.startsWith("/api") && /^\/(admin|auth|rating|me|languages|dictionary|user-dictionary)/.test(pathname)) {
    pathname = "/api" + pathname;
  }
  let path = `${req.method} ${pathname}`;
  let handler = routes[path];
  if (!handler && pathname.endsWith("/") && pathname.length > 1) {
    path = `${req.method} ${pathname.slice(0, -1)}`;
    handler = routes[path];
  }
  if (!handler) {
    console.warn("[routes] Not found:", path);
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
    console.log(`CORS_ORIGIN: ${CORS_ORIGIN}`);
    console.log(`CORS origins (${CORS_ORIGINS.length}): ${CORS_ORIGINS.join(", ")}`);
    console.log(`DB: PostgreSQL`);
  });
}

start().catch((err) => {
  console.error("Ошибка запуска:", err);
  process.exit(1);
});
