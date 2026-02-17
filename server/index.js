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
  invalidatePersonalDictionaryColumnCache,
} from "./store.js";
import {
  getWordsByLanguage,
  getLanguages,
  getWordIdsByLevel,
  getDictionaryVersion,
  searchDictionaryEntries,
  getDictionaryEntryById,
  patchDictionaryEntry,
  syncDictionaryV2FromEntries,
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
  addSavedByEntryIds,
  addManySavedSenses,
  addSavedBySenseId,
  addPhraseProgress,
  ensureUserDictionaryBackfilled,
  getFormCardById,
  getCollection,
  getTodayPack,
  getUserPhraseState,
  getFormCardBySenseAndForm,
  getWordCardByEntryId,
  getWordCardBySenseId,
  listAllWords,
  listCollections,
  listMyWords,
  listMyPhrases,
  lookupDictionaryTerm,
  removePhraseProgress,
  ensureDefaultCollectionEnrolled,
  getCollectionProgress,
  listCollectionsAdmin,
  createCollectionAdmin,
  patchCollectionAdmin,
  deleteCollectionAdmin,
  listCollectionItemsAdmin,
  searchCollectionCandidatesAdmin,
  addCollectionItemAdmin,
  removeCollectionItemAdmin,
  reorderCollectionItemsAdmin,
  getMyWordsSummary,
  setPhraseStatus,
  getUserSenseState,
  removeSavedByEntryId,
  removeSavedBySenseId,
  setSavedStatus,
  syncUserDictionaryFromMePatch,
  getPersonalEntryIdsFromSavedSenses,
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

const DICT_LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
function normalizeImportLevel(v) {
  const s = String(v ?? "").trim().toUpperCase();
  return DICT_LEVELS.includes(s) ? s : null;
}
function normalizeImportRegister(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "официальная" || s === "formal") return "официальная";
  if (s === "разговорная" || s === "informal" || s === "colloquial") return "разговорная";
  return null;
}
function normalizeImportWord(raw) {
  const word = String(raw ?? "").trim();
  if (!word) return null;
  // Only single EN word token (no spaces). Allow internal hyphen/apostrophe.
  if (/\s/.test(word)) return null;
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) return null;
  const lemmaKey = word.toLowerCase();
  return { word, lemmaKey };
}
function safeParseJsonArray(text) {
  const t = String(text || "").trim();
  if (!t) throw new Error("Пустой ответ от модели");
  try {
    const parsed = JSON.parse(t);
    if (!Array.isArray(parsed)) throw new Error("Ожидается JSON-массив");
    return parsed;
  } catch {
    // Попытка вытащить JSON-массив из текста
    const start = t.indexOf("[");
    const end = t.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const slice = t.slice(start, end + 1);
      const parsed = JSON.parse(slice);
      if (!Array.isArray(parsed)) throw new Error("Ожидается JSON-массив");
      return parsed;
    }
    throw new Error("Не удалось распарсить JSON-массив из ответа модели");
  }
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
    await saveUser(user);
    const a0Ids = await getWordIdsByLevel("en", "A0");
    if (a0Ids.length > 0) {
      try {
        await addSavedByEntryIds(username, "en", a0Ids, "registration");
      } catch (e) {
        console.warn("registration starter words failed:", e);
      }
    }
    const token = randomToken();
    await createSession(token, username);
    let userForResponse = await getUser(username);
    const personalEntryIds = await getPersonalEntryIdsFromSavedSenses(username, "en");
    userForResponse = { ...userForResponse, personalDictionary: personalEntryIds };
    send(res, 200, { token, user: normalizeUserForResponse(userForResponse) });
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
    const personalEntryIds = await getPersonalEntryIdsFromSavedSenses(username, "en");
    const userForResponse = { ...user, personalDictionary: personalEntryIds };
    send(res, 200, { token, user: normalizeUserForResponse(userForResponse) });
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
    // «Мой словарь» в играх берём из user_saved_senses (слова, добавленные через раздел Словарь)
    const personalEntryIds = await getPersonalEntryIdsFromSavedSenses(session.username, "en");
    user = { ...user, personalDictionary: personalEntryIds };
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
    if (body.gameSettings !== undefined && typeof body.gameSettings === "object") {
      user.gameSettings = { ...user.gameSettings, ...body.gameSettings };
    }
    await saveUser(user);
    try {
      const lang = String(body?.lang || "en").trim() || "en";
      await ensureUserDictionaryBackfilled(session.username, lang);
      await syncUserDictionaryFromMePatch(session.username, lang, {
        wordProgress: body.wordProgress,
      });
    } catch (e) {
      console.warn("user dictionary sync failed:", e);
    }
    if (activeDays.streakDays === 0 && activeDays.lastActiveDate === null) {
      activeDays = await getActiveDays(session.username);
    }
    const personalEntryIds = await getPersonalEntryIdsFromSavedSenses(session.username, "en");
    user = { ...user, personalDictionary: personalEntryIds };
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

  "GET /api/user-dictionary/my-phrases": async (req, res, body, url) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const q = url.searchParams.get("q") || "";
    const status = url.searchParams.get("status") || "all";
    const offset = url.searchParams.get("offset") || "0";
    const limit = url.searchParams.get("limit") || "50";
    const out = await listMyPhrases(auth.user.username, lang, {
      q,
      status,
      offset: Number(offset),
      limit: Number(limit),
    });
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

  "GET /api/user-dictionary/all-words": async (req, res, body, url) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
    const q = (url.searchParams.get("q") || "").trim();
    const opts = { offset, limit, q: q || undefined };
    const out = await listAllWords(auth.user.username, lang, opts);
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

  "POST /api/user-dictionary/phrase/add": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const itemType = String(body?.itemType || "").trim();
    const itemId = body?.itemId;
    if (!itemType || !itemId) {
      send(res, 400, { error: "Поля itemType и itemId обязательны" });
      return;
    }
    const out = await addPhraseProgress(auth.user.username, itemType, Number(itemId), "manual");
    if (!out?.ok) {
      send(res, 400, { error: "Некорректные параметры фразы" });
      return;
    }
    send(res, 200, { ok: true });
  },

  "POST /api/user-dictionary/phrase/remove": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const itemType = String(body?.itemType || "").trim();
    const itemId = body?.itemId;
    if (!itemType || !itemId) {
      send(res, 400, { error: "Поля itemType и itemId обязательны" });
      return;
    }
    const out = await removePhraseProgress(auth.user.username, itemType, Number(itemId));
    send(res, 200, out || { ok: false });
  },

  "POST /api/user-dictionary/phrase/status": async (req, res, body) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const itemType = String(body?.itemType || "").trim();
    const itemId = body?.itemId;
    const status = body?.status;
    if (!itemType || !itemId || !status) {
      send(res, 400, { error: "Поля itemType, itemId и status обязательны" });
      return;
    }
    const out = await setPhraseStatus(auth.user.username, itemType, Number(itemId), String(status));
    if (!out) {
      send(res, 404, { error: "Фраза не найдена в прогрессе" });
      return;
    }
    send(res, 200, { ok: true, status: out.status });
  },

  "GET /api/user-dictionary/phrase-state": async (req, res, body, url) => {
    const auth = await requireAuthUser(req, res);
    if (!auth) return;
    const itemType = url.searchParams.get("itemType");
    const itemId = url.searchParams.get("itemId");
    if (!itemType || !itemId) {
      send(res, 400, { error: "Параметры itemType и itemId обязательны" });
      return;
    }
    const out = await getUserPhraseState(auth.user.username, itemType, Number(itemId));
    send(res, 200, out || { isSaved: false, status: null });
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

  "GET /api/dictionary/form-card": async (req, res, body, url) => {
    const lang = url.searchParams.get("lang") || "en";
    const senseId = url.searchParams.get("senseId");
    const form = url.searchParams.get("form") || "";
    if (!senseId) {
      send(res, 400, { error: "Параметр senseId обязателен" });
      return;
    }
    if (!String(form).trim()) {
      send(res, 400, { error: "Параметр form обязателен" });
      return;
    }
    const card = await getFormCardBySenseAndForm(lang, Number(senseId), form);
    send(res, 200, { card });
  },

  "GET /api/dictionary/form-card-by-id": async (req, res, body, url) => {
    const lang = url.searchParams.get("lang") || "en";
    const cardId = url.searchParams.get("cardId");
    if (!cardId) {
      send(res, 400, { error: "Параметр cardId обязателен" });
      return;
    }
    const card = await getFormCardById(lang, Number(cardId));
    send(res, 200, { card });
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

  // ===== Admin: collections =====
  "GET /api/admin/collections/list": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(url.searchParams.get("lang") || "en").trim() || "en";
    const q = String(url.searchParams.get("q") || "");
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 50);
    const out = await listCollectionsAdmin(lang, { q, offset, limit });
    send(res, 200, out);
  },

  "GET /api/admin/collections/items": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(url.searchParams.get("lang") || "en").trim() || "en";
    const collectionId = Number(url.searchParams.get("collectionId") || 0);
    if (!collectionId) {
      send(res, 400, { error: "Параметр collectionId обязателен" });
      return;
    }
    const q = String(url.searchParams.get("q") || "");
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 100);
    const out = await listCollectionItemsAdmin(lang, collectionId, { q, offset, limit });
    send(res, 200, out);
  },

  "GET /api/admin/collections/candidates": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(url.searchParams.get("lang") || "en").trim() || "en";
    const q = String(url.searchParams.get("q") || "");
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 60);
    const out = await searchCollectionCandidatesAdmin(lang, { q, offset, limit });
    send(res, 200, out);
  },

  "POST /api/admin/collections/create": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const created = await createCollectionAdmin(lang, {
      collectionKey: body?.collectionKey,
      title: body?.title,
      description: body?.description,
      levelFrom: body?.levelFrom,
      levelTo: body?.levelTo,
      isPublic: body?.isPublic,
      sortOrder: body?.sortOrder,
    });
    if (!created) {
      send(res, 400, { error: "Не удалось создать коллекцию. Проверьте title и collectionKey." });
      return;
    }
    send(res, 200, { ok: true, collection: created });
  },

  "PATCH /api/admin/collections/update": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const collectionId = Number(body?.collectionId || 0);
    if (!collectionId) {
      send(res, 400, { error: "Поле collectionId обязательно" });
      return;
    }
    const updated = await patchCollectionAdmin(lang, collectionId, {
      collectionKey: body?.collectionKey,
      title: body?.title,
      description: body?.description,
      levelFrom: body?.levelFrom,
      levelTo: body?.levelTo,
      isPublic: body?.isPublic,
      sortOrder: body?.sortOrder,
    });
    if (!updated) {
      send(res, 404, { error: "Коллекция не найдена или не обновлена" });
      return;
    }
    send(res, 200, { ok: true, collection: updated });
  },

  "POST /api/admin/collections/delete": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const collectionId = Number(body?.collectionId || 0);
    if (!collectionId) {
      send(res, 400, { error: "Поле collectionId обязательно" });
      return;
    }
    const out = await deleteCollectionAdmin(lang, collectionId);
    if (!out?.ok) {
      send(res, 400, { error: "Не удалось удалить коллекцию" });
      return;
    }
    send(res, 200, out);
  },

  "POST /api/admin/collections/item/add": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const collectionId = Number(body?.collectionId || 0);
    if (!collectionId) {
      send(res, 400, { error: "Поле collectionId обязательно" });
      return;
    }
    const out = await addCollectionItemAdmin(lang, collectionId, {
      senseId: body?.senseId,
      itemType: body?.itemType,
      itemId: body?.itemId,
      sortOrder: body?.sortOrder,
    });
    if (!out?.ok) {
      send(res, 400, { error: "Не удалось добавить элемент в коллекцию", details: out?.reason || null });
      return;
    }
    send(res, 200, out);
  },

  "POST /api/admin/collections/item/remove": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const collectionId = Number(body?.collectionId || 0);
    if (!collectionId) {
      send(res, 400, { error: "Поле collectionId обязательно" });
      return;
    }
    const out = await removeCollectionItemAdmin(lang, collectionId, {
      senseId: body?.senseId,
      itemType: body?.itemType,
      itemId: body?.itemId,
    });
    if (!out?.ok) {
      send(res, 400, { error: "Не удалось удалить элемент из коллекции", details: out?.reason || null });
      return;
    }
    send(res, 200, out);
  },

  "POST /api/admin/collections/items/reorder": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const collectionId = Number(body?.collectionId || 0);
    const senseIds = Array.isArray(body?.senseIds) ? body.senseIds : [];
    if (!collectionId) {
      send(res, 400, { error: "Поле collectionId обязательно" });
      return;
    }
    const out = await reorderCollectionItemsAdmin(lang, collectionId, senseIds);
    send(res, 200, out);
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

  "GET /api/admin/dictionary/wizard/checklist": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const id = Number(url.searchParams.get("id") || 0);
    if (!id) {
      send(res, 400, { error: "Параметр id обязателен" });
      return;
    }
    const data = await getEntryV2Admin(lang, id);
    if (!data) {
      send(res, 404, { error: "Запись не найдена" });
      return;
    }
    const cardsRes = await pool.query(
      `
        SELECT id
        FROM dictionary_form_cards
        WHERE entry_id = $1
      `,
      [id]
    );
    const hasBlock1 =
      Boolean(String(data.entry?.ru || "").trim()) &&
      Boolean(String(data.entry?.example || "").trim()) &&
      Boolean(String(data.entry?.exampleRu || "").trim()) &&
      Boolean(String(data.entry?.ipaUk || "").trim() || String(data.entry?.ipaUs || "").trim()) &&
      Number.isFinite(Number(data.entry?.frequencyRank));
    const senses = Array.isArray(data.senses) ? data.senses : [];
    const hasBlock2 =
      senses.length > 0 &&
      senses.every((s) => String(s.glossRu || "").trim() && Array.isArray(s.examples) && s.examples.length > 0);
    const hasBlock3 = cardsRes.rows.length > 0 || (Array.isArray(data.forms) && data.forms.length > 0);
    send(res, 200, {
      block1: { ready: hasBlock1, label: "Карточка слова" },
      block2: { ready: hasBlock2, label: "Смыслы и примеры" },
      block3: { ready: hasBlock3, label: "Формы слова" },
      warnings: [
        ...(hasBlock1 ? [] : ["Блок 1: заполните ru/frequency/IPA/пример"]),
        ...(hasBlock2 ? [] : ["Блок 2: добавьте смыслы с примерами"]),
        ...(hasBlock3 ? [] : ["Блок 3: добавьте формы или карточки форм"]),
      ],
    });
  },

  "GET /api/admin/dictionary/block1": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const id = Number(url.searchParams.get("id") || 0);
    if (!id) {
      send(res, 400, { error: "Параметр id обязателен" });
      return;
    }
    const entry = await getDictionaryEntryById(lang, id);
    const v2 = await getEntryV2Admin(lang, id);
    if (!entry || !v2) {
      send(res, 404, { error: "Запись не найдена" });
      return;
    }
    send(res, 200, { entry, lemma: v2.lemma });
  },

  "PATCH /api/admin/dictionary/block1": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const id = Number(body?.entryId || 0);
    if (!id) {
      send(res, 400, { error: "Поле entryId обязательно" });
      return;
    }
    const updated = await patchDictionaryEntry(lang, id, body?.patch || {});
    if (!updated) {
      send(res, 404, { error: "Запись не найдена" });
      return;
    }
    await updateDictionaryVersion(lang);
    send(res, 200, { ok: true, entry: updated });
  },

  "GET /api/admin/dictionary/block2": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = url.searchParams.get("lang") || "en";
    const id = Number(url.searchParams.get("id") || 0);
    if (!id) {
      send(res, 400, { error: "Параметр id обязателен" });
      return;
    }
    const v2 = await getEntryV2Admin(lang, id);
    if (!v2) {
      send(res, 404, { error: "Запись не найдена" });
      return;
    }
    send(res, 200, { senses: v2.senses || [] });
  },

  "PATCH /api/admin/dictionary/block2": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    let updated = 0;
    for (const item of updates) {
      if (!item?.senseId || !item?.patch) continue;
      const out = await patchSenseAdmin(lang, Number(item.senseId), item.patch, auth.user.username);
      if (out) updated++;
    }
    send(res, 200, { ok: true, updated });
  },

  "GET /api/admin/dictionary/block3": async (req, res, body, url) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const id = Number(url.searchParams.get("id") || 0);
    if (!id) {
      send(res, 400, { error: "Параметр id обязателен" });
      return;
    }
    const cardsRes = await pool.query(
      `
        SELECT id, entry_id AS "entryId", lemma_id AS "lemmaId", source_form_id AS "sourceFormId",
               en, ru, level, accent, frequency_rank AS "frequencyRank", rarity, register,
               ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu",
               pos, sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM dictionary_form_cards
        WHERE entry_id = $1
        ORDER BY sort_order ASC, id ASC
      `,
      [id]
    );
    send(res, 200, { cards: cardsRes.rows || [] });
  },

  "POST /api/admin/dictionary/block3/save": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const entryId = Number(body?.entryId || 0);
    const cards = Array.isArray(body?.cards) ? body.cards : [];
    if (!entryId) {
      send(res, 400, { error: "Поле entryId обязательно" });
      return;
    }
    const keepIds = cards
      .map((c) => Number(c?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0);
    await pool.query("BEGIN");
    try {
      if (keepIds.length > 0) {
        await pool.query(
          `DELETE FROM dictionary_form_cards WHERE entry_id = $1 AND id <> ALL($2::int[])`,
          [entryId, keepIds]
        );
      } else {
        await pool.query(`DELETE FROM dictionary_form_cards WHERE entry_id = $1`, [entryId]);
      }
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i] || {};
        const payload = [
          entryId,
          Number(c.lemmaId || 0) || null,
          Number(c.sourceFormId || 0) || null,
          String(c.en || "").trim(),
          String(c.ru || ""),
          String(c.level || "A0"),
          String(c.accent || "both"),
          Math.max(1, Number(c.frequencyRank || 15000) || 15000),
          String(c.rarity || "редкое"),
          String(c.register || "разговорная"),
          String(c.ipaUk || ""),
          String(c.ipaUs || ""),
          String(c.example || ""),
          String(c.exampleRu || ""),
          String(c.pos || ""),
          i,
        ];
        if (Number(c.id || 0) > 0) {
          await pool.query(
            `
              UPDATE dictionary_form_cards
              SET lemma_id = $2, source_form_id = $3, en = $4, ru = $5, level = $6, accent = $7,
                  frequency_rank = $8, rarity = $9, register = $10, ipa_uk = $11, ipa_us = $12,
                  example = $13, example_ru = $14, pos = $15, sort_order = $16, updated_at = NOW()
              WHERE id = $17 AND entry_id = $1
            `,
            [...payload, Number(c.id)]
          );
        } else if (String(c.en || "").trim()) {
          await pool.query(
            `
              INSERT INTO dictionary_form_cards (
                entry_id, lemma_id, source_form_id, en, ru, level, accent, frequency_rank, rarity, register,
                ipa_uk, ipa_us, example, example_ru, pos, sort_order, updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
              ON CONFLICT (entry_id, en) DO UPDATE
              SET ru = EXCLUDED.ru, level = EXCLUDED.level, accent = EXCLUDED.accent, frequency_rank = EXCLUDED.frequency_rank,
                  rarity = EXCLUDED.rarity, register = EXCLUDED.register, ipa_uk = EXCLUDED.ipa_uk, ipa_us = EXCLUDED.ipa_us,
                  example = EXCLUDED.example, example_ru = EXCLUDED.example_ru, pos = EXCLUDED.pos, sort_order = EXCLUDED.sort_order, updated_at = NOW()
            `,
            payload
          );
        }
      }
      await pool.query("COMMIT");
      send(res, 200, { ok: true });
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  },

  /**
   * Удалить одну карточку формы (form_card) сразу из БД (Block 3).
   * Нужно, чтобы удалённые формы не оставались в списке «Все слова».
   */
  "POST /api/admin/dictionary/form-card/delete": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const entryId = Number(body?.entryId || 0);
    const formCardId = Number(body?.formCardId || 0);
    if (!entryId || !formCardId) {
      send(res, 400, { error: "Поля entryId и formCardId обязательны" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fcRes = await client.query(
        `
          SELECT id, entry_id AS "entryId", lemma_id AS "lemmaId", en
          FROM dictionary_form_cards
          WHERE id = $1 AND entry_id = $2
          LIMIT 1
        `,
        [formCardId, entryId]
      );
      const row = fcRes.rows[0] || null;
      if (!row) {
        await client.query("ROLLBACK");
        send(res, 404, { error: "Карточка формы не найдена" });
        return;
      }

      // user_phrase_progress has no FK, must cleanup manually
      await client.query(`DELETE FROM user_phrase_progress WHERE item_type = 'form_card' AND item_id = $1`, [formCardId]);

      const delRes = await client.query(`DELETE FROM dictionary_form_cards WHERE id = $1 AND entry_id = $2`, [formCardId, entryId]);

      // Optional cleanup: if this form also exists in dictionary_forms, remove it
      const lemmaId = row.lemmaId != null ? Number(row.lemmaId) : null;
      const en = String(row.en || "").trim();
      if (lemmaId && en) {
        await client.query(`DELETE FROM dictionary_forms WHERE lemma_id = $1 AND form = $2`, [lemmaId, en]);
      }

      await client.query("COMMIT");
      send(res, 200, { ok: true, deleted: delRes.rowCount || 0 });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      const msg = e instanceof Error ? e.message : String(e);
      send(res, 500, { error: "Не удалось удалить карточку формы", details: msg });
    } finally {
      client.release();
    }
  },

  /**
   * Полное удаление слова (entry) из словаря (админка).
   * Важно: удаляет entry + (если lemma больше нигде не используется) удаляет и v2 (lemma/senses/...),
   * чтобы слово исчезло из «Все слова» (там показываются и v2-смыслы без entry).
   */
  "POST /api/admin/dictionary/entry/delete": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = Number(body?.entryId || 0);
    if (!entryId) {
      send(res, 400, { error: "Поле entryId обязательно" });
      return;
    }

    const langRes = await pool.query("SELECT id FROM languages WHERE code = $1", [lang]);
    if (langRes.rows.length === 0) {
      send(res, 400, { error: "Неизвестный язык", details: `lang=${lang}` });
      return;
    }
    const languageId = langRes.rows[0].id;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const linkRes = await client.query(`SELECT lemma_id AS "lemmaId" FROM dictionary_entry_links WHERE entry_id = $1 LIMIT 1`, [entryId]);
      const lemmaId = linkRes.rows[0]?.lemmaId != null ? Number(linkRes.rows[0].lemmaId) : null;

      // Cleanup user progress for form cards under this entry (no FK)
      const fcIdsRes = await client.query(`SELECT id FROM dictionary_form_cards WHERE entry_id = $1`, [entryId]);
      const formCardIds = (fcIdsRes.rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
      if (formCardIds.length > 0) {
        await client.query(`DELETE FROM user_phrase_progress WHERE item_type = 'form_card' AND item_id = ANY($1::int[])`, [formCardIds]);
      }

      const delEntryRes = await client.query(`DELETE FROM dictionary_entries WHERE language_id = $1 AND id = $2`, [languageId, entryId]);
      if ((delEntryRes.rowCount || 0) === 0) {
        await client.query("ROLLBACK");
        send(res, 404, { error: "Запись словаря не найдена" });
        return;
      }

      if (lemmaId) {
        const stillUsed = await client.query(`SELECT 1 FROM dictionary_entry_links WHERE lemma_id = $1 LIMIT 1`, [lemmaId]);
        if ((stillUsed.rows || []).length === 0) {
          // Collect ids for manual cleanup in user_phrase_progress (no FK) before cascade delete
          const collRes = await client.query(`SELECT id FROM dictionary_collocations WHERE lemma_id = $1`, [lemmaId]);
          const collocationIds = (collRes.rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);

          const patternRes = await client.query(
            `
              SELECT p.id
              FROM dictionary_usage_patterns p
              JOIN dictionary_senses s ON s.id = p.sense_id
              WHERE s.lemma_id = $1
            `,
            [lemmaId]
          );
          const patternIds = (patternRes.rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);

          if (collocationIds.length > 0) {
            await client.query(`DELETE FROM user_phrase_progress WHERE item_type = 'collocation' AND item_id = ANY($1::int[])`, [collocationIds]);
          }
          if (patternIds.length > 0) {
            await client.query(`DELETE FROM user_phrase_progress WHERE item_type = 'pattern' AND item_id = ANY($1::int[])`, [patternIds]);
          }

          // This cascades senses/examples/forms/collocations/patterns
          await client.query(`DELETE FROM dictionary_lemmas WHERE id = $1`, [lemmaId]);
        }
      }

      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      const msg = e instanceof Error ? e.message : String(e);
      send(res, 500, { error: "Не удалось удалить слово", details: msg });
      return;
    } finally {
      client.release();
    }

    try {
      await updateDictionaryVersion(lang);
    } catch (e) {
      console.warn("entry/delete: updateDictionaryVersion failed:", e);
    }
    send(res, 200, { ok: true });
  },

  "POST /api/admin/dictionary/ai-draft-block1": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const endpoint = `http://127.0.0.1:${PORT}/api/admin/dictionary/ai-draft`;
    const rsp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: req.headers.authorization || "",
      },
      body: JSON.stringify({ ...body, mode: "full" }),
    });
    const data = await rsp.json();
    if (!rsp.ok) {
      send(res, rsp.status, data);
      return;
    }
    send(res, 200, { draft: { entryPatch: data?.draft?.entryPatch || {}, lemmaPatch: data?.draft?.lemmaPatch || {}, warnings: data?.draft?.warnings || [] } });
  },

  "POST /api/admin/dictionary/ai-draft-block2": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const endpoint = `http://127.0.0.1:${PORT}/api/admin/dictionary/ai-draft`;
    const rsp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: req.headers.authorization || "",
      },
      body: JSON.stringify({ ...body, mode: "full" }),
    });
    const data = await rsp.json();
    if (!rsp.ok) {
      send(res, rsp.status, data);
      return;
    }
    send(res, 200, { draft: { senses: data?.draft?.senses || [], warnings: data?.draft?.warnings || [] } });
  },

  "POST /api/admin/dictionary/ai-draft-block3": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const lang = String(body?.lang || "en").trim() || "en";
    const entryId = Number(body?.entryId || 0);
    const endpoint = `http://127.0.0.1:${PORT}/api/admin/dictionary/ai-draft`;
    const rsp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: req.headers.authorization || "",
      },
      body: JSON.stringify({ ...body, mode: "forms_only" }),
    });
    const data = await rsp.json();
    if (!rsp.ok) {
      send(res, rsp.status, data);
      return;
    }
    const formsRaw = Array.isArray(data?.draft?.forms) ? data.draft.forms : [];
    const warnings = Array.isArray(data?.draft?.warnings) ? data.draft.warnings : [];
    // Dedupe AI forms by form (case-insensitive) so we don't create duplicates in UI/draft.
    const seenForms = new Set();
    const forms = [];
    for (const f of formsRaw) {
      const en = String(f?.form || "").trim();
      const key = en.toLowerCase();
      if (!key) continue;
      if (seenForms.has(key)) {
        warnings.push(`AI forms: duplicate removed "${en}"`);
        continue;
      }
      seenForms.add(key);
      forms.push(f);
    }
    let baseEntry = null;
    let basePos = "";
    let lemmaId = null;
    const existingCardsByEn = new Map();
    if (entryId > 0) {
      const v2 = await getEntryV2Admin(lang, entryId);
      baseEntry = v2?.entry || null;
      basePos = String(v2?.lemma?.pos || "");
      lemmaId = v2?.lemma?.id ?? null;
      const cardsRes = await pool.query(
        `
          SELECT id, en, ru, level, accent, frequency_rank AS "frequencyRank", rarity, register,
                 ipa_uk AS "ipaUk", ipa_us AS "ipaUs", example, example_ru AS "exampleRu", pos
          FROM dictionary_form_cards
          WHERE entry_id = $1
        `,
        [entryId]
      );
      for (const row of cardsRes.rows || []) {
        const key = String(row.en || "").trim().toLowerCase();
        if (key) existingCardsByEn.set(key, row);
      }
    }
    // Для каждой формы делаем отдельный AI-драфт (word=form), чтобы поля были релевантны именно форме.
    const limitedForms = forms.slice(0, 16);
    const formCardsDraft = await Promise.all(
      limitedForms.map(async (f, idx) => {
        const en = String(f?.form || "").trim();
        const prev = existingCardsByEn.get(en.toLowerCase()) || null;
        if (prev?.id && en) {
          warnings.push(`Form card already exists: "${en}" (id=${prev.id}) — reused.`);
        }
        let aiEntryPatch = {};
        if (en) {
          try {
            const enrichRsp = await fetch(endpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: req.headers.authorization || "",
              },
              body: JSON.stringify({ lang, word: en, mode: "full" }),
            });
            const enrichData = await enrichRsp.json();
            if (enrichRsp.ok) {
              aiEntryPatch = enrichData?.draft?.entryPatch && typeof enrichData.draft.entryPatch === "object"
                ? enrichData.draft.entryPatch
                : {};
            } else {
              warnings.push(`AI detail draft failed for "${en}": ${String(enrichData?.error || enrichRsp.status)}`);
            }
          } catch (e) {
            warnings.push(`AI detail draft exception for "${en}": ${e instanceof Error ? e.message : "unknown error"}`);
          }
        }
        return {
          id: prev?.id,
          entryId: entryId || undefined,
          lemmaId: lemmaId,
          sourceFormId: null,
          en,
          ru: String(prev?.ru ?? aiEntryPatch?.ru ?? baseEntry?.ru ?? ""),
          level: String(prev?.level ?? aiEntryPatch?.level ?? baseEntry?.level ?? "A0"),
          accent: String(prev?.accent ?? aiEntryPatch?.accent ?? baseEntry?.accent ?? "both"),
          frequencyRank: Math.max(1, Number(prev?.frequencyRank ?? aiEntryPatch?.frequencyRank ?? baseEntry?.frequencyRank ?? 15000) || 15000),
          rarity: String(prev?.rarity ?? aiEntryPatch?.rarity ?? baseEntry?.rarity ?? "редкое"),
          register: String(prev?.register ?? aiEntryPatch?.register ?? baseEntry?.register ?? "разговорная"),
          ipaUk: String(prev?.ipaUk ?? aiEntryPatch?.ipaUk ?? baseEntry?.ipaUk ?? ""),
          ipaUs: String(prev?.ipaUs ?? aiEntryPatch?.ipaUs ?? baseEntry?.ipaUs ?? ""),
          example: String(prev?.example ?? aiEntryPatch?.example ?? baseEntry?.example ?? ""),
          exampleRu: String(prev?.exampleRu ?? aiEntryPatch?.exampleRu ?? baseEntry?.exampleRu ?? ""),
          pos: String(prev?.pos ?? aiEntryPatch?.pos ?? basePos ?? ""),
          sortOrder: idx,
        };
      })
    );
    if (forms.length > limitedForms.length) {
      warnings.push(`Forms truncated for AI-detail enrichment: ${forms.length} -> ${limitedForms.length}`);
    }
    send(res, 200, { draft: { formCardsDraft, warnings } });
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
   * AI-импорт: предпросмотр списка слов/лемм для добавления в словарь.
   * Генерирует только EN-леммы/фразы. Дубликаты помечаются (exists=true).
   */
  "POST /api/admin/dictionary/ai-import/preview": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const apiKey = sanitizeOpenAiKey(process.env.OPENAI_API_KEY);
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
    const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

    const lang = String(body?.lang || "en").trim() || "en";
    const level = normalizeImportLevel(body?.level);
    const topic = String(body?.topic || "").trim();
    const register = normalizeImportRegister(body?.register) || "разговорная";
    const countRaw = body?.count;
    const count = Math.max(1, Math.min(200, Number(countRaw) || 0));

    if (!apiKey) {
      send(res, 400, { error: "OPENAI_API_KEY не задан на сервере" });
      return;
    }
    if (!level) {
      send(res, 400, { error: "Поле level обязательно (A0..C2)" });
      return;
    }
    if (!Number.isFinite(count) || count <= 0) {
      send(res, 400, { error: "Поле count обязательно (1..200)" });
      return;
    }

    const langRes = await pool.query("SELECT id FROM languages WHERE code = $1", [lang]);
    if (langRes.rows.length === 0) {
      send(res, 400, { error: "Неизвестный язык", details: `lang=${lang}` });
      return;
    }
    const languageId = langRes.rows[0].id;

    // Build avoid-list from existing words in the requested level group
    const avoidLimit = 600;
    const avoidRes = await pool.query(
      `
        SELECT LOWER(TRIM(e.en)) AS lemma_key
        FROM dictionary_entries e
        LEFT JOIN dictionary_entry_links el ON el.entry_id = e.id
        LEFT JOIN dictionary_senses s ON s.id = el.sense_id
        WHERE e.language_id = $1
          AND COALESCE(s.level, e.level) = $2
          AND TRIM(COALESCE(e.en, '')) <> ''
        ORDER BY e.frequency_rank ASC, e.id ASC
        LIMIT $3
      `,
      [languageId, level, avoidLimit]
    );
    const avoidLemmaKeys = avoidRes.rows.map((r) => String(r.lemma_key || "")).filter(Boolean);

    const inputJson = { lang, level, topic, count, register, avoidLemmaKeys };
    let words = [];
    try {
      const prompt = [
        "Ты помощник администратора словаря английских слов.",
        "Твоя задача: сгенерировать список EN-слов (только ОДНО слово в каждой строке) для добавления в словарь.",
        `Верни СТРОГО JSON-массив строк длины ${count}. Без markdown, без пояснений, без нумерации.`,
        "Правила:",
        "- Только английский (ASCII), без переводов, без транскрипций.",
        "- Каждая строка: ровно ОДНО слово, без пробелов.",
        "- Допустимые символы: A-Z, a-z, а также дефис/апостроф внутри слова (например: re-enter, don't).",
        "- Не используй собственные имена, бренды, аббревиатуры-одноразки, сленг и токсичные слова.",
        "- Слова должны соответствовать уровню CEFR и тематике, если она задана.",
        "- Избегай дублей и слишком похожих вариантов (plural/singular и т.п.).",
        "- Если в input_json есть avoidLemmaKeys — НЕ возвращай ни одного слова из этого списка (сравнивай без учета регистра).",
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
      const arr = safeParseJsonArray(content);
      words = arr;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      send(res, 500, { error: "Не удалось сгенерировать список слов", details: msg });
      return;
    }

    // Normalize + dedupe
    const normalized = [];
    const seen = new Set();
    for (const w of words) {
      const n = normalizeImportWord(w);
      if (!n) continue;
      if (seen.has(n.lemmaKey)) continue;
      seen.add(n.lemmaKey);
      normalized.push(n);
      if (normalized.length >= count) break;
    }

    const lemmaKeys = normalized.map((x) => x.lemmaKey);
    const existing = new Set();
    if (lemmaKeys.length > 0) {
      const exRes = await pool.query(
        `SELECT lemma_key FROM dictionary_lemmas WHERE language_id = $1 AND lemma_key = ANY($2::text[])`,
        [languageId, lemmaKeys]
      );
      for (const row of exRes.rows) existing.add(String(row.lemma_key || ""));
    }

    const items = normalized.map((x) => ({
      word: x.word,
      lemmaKey: x.lemmaKey,
      exists: existing.has(x.lemmaKey),
    }));

    const missing = Math.max(0, count - items.length);
    const status =
      missing === 0
        ? { ok: true, missing: 0, message: "OK" }
        : {
            ok: false,
            missing,
            message: `Не удалось сгенерировать достаточно уникальных слов: ${items.length} из ${count}. Попробуйте уменьшить количество или изменить тему.`,
          };

    send(res, 200, {
      items,
      status,
      stats: {
        requested: count,
        unique: items.length,
        duplicates: items.filter((i) => i.exists).length,
      },
    });
  },

  /**
   * AI-импорт: сохранить список слов/лемм в БД.
   * Вставляет только новые слова (дубли auto-skip).
   */
  "POST /api/admin/dictionary/ai-import/commit": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const lang = String(body?.lang || "en").trim() || "en";
    const level = normalizeImportLevel(body?.level);
    const register = normalizeImportRegister(body?.register) || "разговорная";
    const wordsRaw = Array.isArray(body?.words) ? body.words : [];

    if (!level) {
      send(res, 400, { error: "Поле level обязательно (A0..C2)" });
      return;
    }
    if (!Array.isArray(wordsRaw) || wordsRaw.length === 0) {
      send(res, 400, { error: "Поле words обязательно (непустой массив строк)" });
      return;
    }

    const langRes = await pool.query("SELECT id FROM languages WHERE code = $1", [lang]);
    if (langRes.rows.length === 0) {
      send(res, 400, { error: "Неизвестный язык", details: `lang=${lang}` });
      return;
    }
    const languageId = langRes.rows[0].id;

    // Normalize + dedupe
    const normalized = [];
    const seen = new Set();
    for (const w of wordsRaw) {
      const n = normalizeImportWord(w);
      if (!n) continue;
      if (seen.has(n.lemmaKey)) continue;
      seen.add(n.lemmaKey);
      normalized.push(n);
      if (normalized.length >= 500) break; // hard safety cap
    }
    if (normalized.length === 0) {
      send(res, 400, { error: "Список words пуст после нормализации" });
      return;
    }

    // Skip duplicates by lemma_key (fast indexed lookup)
    const lemmaKeys = normalized.map((x) => x.lemmaKey);
    const existing = new Set();
    const exRes = await pool.query(
      `SELECT lemma_key FROM dictionary_lemmas WHERE language_id = $1 AND lemma_key = ANY($2::text[])`,
      [languageId, lemmaKeys]
    );
    for (const row of exRes.rows) existing.add(String(row.lemma_key || ""));

    const toInsert = normalized.filter((x) => !existing.has(x.lemmaKey)).map((x) => x.word);
    const skippedExisting = existing.size;

    let inserted = 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (toInsert.length > 0) {
        const ins = await client.query(
          `
            WITH input AS (
              SELECT UNNEST($2::text[]) AS en
            )
            INSERT INTO dictionary_entries
              (language_id, en, ru, accent, level, frequency_rank, rarity, register, ipa_uk, ipa_us, example, example_ru)
            SELECT
              $1,
              en,
              '',
              'both',
              $3,
              15000,
              'не редкое',
              $4,
              '',
              '',
              '',
              ''
            FROM input
            ON CONFLICT (language_id, en) DO NOTHING
            RETURNING id
          `,
          [languageId, toInsert, level, register]
        );
        inserted = ins.rows.length;
      }
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      const msg = e instanceof Error ? e.message : String(e);
      send(res, 500, { error: "Не удалось сохранить слова", details: msg });
      return;
    } finally {
      client.release();
    }

    // Sync v2 + bump version (outside transaction, but deterministic/idempotent)
    try {
      await syncDictionaryV2FromEntries(lang);
      await updateDictionaryVersion(lang);
    } catch (e) {
      console.warn("ai-import commit: post-sync failed:", e);
    }

    const attempted = toInsert.length;
    const skippedConflicts = Math.max(0, attempted - inserted);
    send(res, 200, { ok: true, inserted, skippedDuplicates: skippedExisting + skippedConflicts });
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
    const mode = String(body?.mode || "full").trim().toLowerCase() === "forms_only" ? "forms_only" : "full";

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

      const normalizeRuForCompare = (v) =>
        String(v ?? "")
          .toLowerCase()
          .replace(/[ё]/g, "е")
          .replace(/[^a-zа-я0-9\s-]/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      const normalizeFormType = (v) => {
        const s = String(v ?? "").trim().toLowerCase();
        if (!s) return null;
        const m = {
          ing: "ing",
          gerund: "ing",
          present_participle: "ing",
          past: "past",
          past_simple: "past",
          past_participle: "past_participle",
          participle: "past_participle",
          third_person_singular: "third_person_singular",
          third_person: "third_person_singular",
          third_person_sg: "third_person_singular",
          plural: "plural",
          comparative: "comparative",
          superlative: "superlative",
          other: "other",
        };
        return m[s] || null;
      };
      const pluralizeNoun = (w) => {
        const s = String(w || "").trim().toLowerCase();
        if (!s) return "";
        if (/(s|x|z|ch|sh)$/.test(s)) return `${s}es`;
        if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ies`;
        return `${s}s`;
      };
      const verb3rd = (w) => {
        const s = String(w || "").trim().toLowerCase();
        if (!s) return "";
        if (/(s|x|z|ch|sh|o)$/.test(s)) return `${s}es`;
        if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ies`;
        return `${s}s`;
      };
      const verbIng = (w) => {
        const s = String(w || "").trim().toLowerCase();
        if (!s) return "";
        if (/ie$/.test(s)) return `${s.slice(0, -2)}ying`;
        if (/[^e]e$/.test(s)) return `${s.slice(0, -1)}ing`;
        return `${s}ing`;
      };
      const verbPast = (w) => {
        const s = String(w || "").trim().toLowerCase();
        if (!s) return "";
        if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ied`;
        if (/e$/.test(s)) return `${s}d`;
        return `${s}ed`;
      };
      const adjComparative = (w) => {
        const s = String(w || "").trim().toLowerCase();
        if (!s) return "";
        if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ier`;
        if (/e$/.test(s)) return `${s}r`;
        return `${s}er`;
      };
      const adjSuperlative = (w) => {
        const s = String(w || "").trim().toLowerCase();
        if (!s) return "";
        if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}iest`;
        if (/e$/.test(s)) return `${s}st`;
        return `${s}est`;
      };
      const IRREGULAR_VERB_FORMS = {
        be: { third_person_singular: "is", ing: "being", past: "was", past_participle: "been" },
        do: { third_person_singular: "does", ing: "doing", past: "did", past_participle: "done" },
        go: { third_person_singular: "goes", ing: "going", past: "went", past_participle: "gone" },
        have: { third_person_singular: "has", ing: "having", past: "had", past_participle: "had" },
        make: { third_person_singular: "makes", ing: "making", past: "made", past_participle: "made" },
        take: { third_person_singular: "takes", ing: "taking", past: "took", past_participle: "taken" },
        come: { third_person_singular: "comes", ing: "coming", past: "came", past_participle: "come" },
        run: { third_person_singular: "runs", ing: "running", past: "ran", past_participle: "run" },
        write: { third_person_singular: "writes", ing: "writing", past: "wrote", past_participle: "written" },
        read: { third_person_singular: "reads", ing: "reading", past: "read", past_participle: "read" },
        eat: { third_person_singular: "eats", ing: "eating", past: "ate", past_participle: "eaten" },
        drink: { third_person_singular: "drinks", ing: "drinking", past: "drank", past_participle: "drunk" },
        speak: { third_person_singular: "speaks", ing: "speaking", past: "spoke", past_participle: "spoken" },
        see: { third_person_singular: "sees", ing: "seeing", past: "saw", past_participle: "seen" },
        get: { third_person_singular: "gets", ing: "getting", past: "got", past_participle: "gotten" },
        know: { third_person_singular: "knows", ing: "knowing", past: "knew", past_participle: "known" },
      };

      if (mode !== "forms_only") {
        const required = ["en", "ru", "level", "accent", "frequencyRank", "rarity", "register", "ipaUk", "ipaUs", "example", "exampleRu"];
        const missing = required.filter((k) => {
          const v = mergedEntryPatch[k];
          return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
        });
        if (missing.length > 0) {
          draftObj.warnings = [...draftObj.warnings, `entryPatch missing: ${missing.join(", ")}`];
        }
      }

      if (mode !== "forms_only") {
        const senseOne =
          draftObj.senses.find((s) => Number(s?.senseNo) === 1) ||
          draftObj.senses[0] ||
          null;
        const entryRuNorm = normalizeRuForCompare(mergedEntryPatch.ru);
        const senseOneGlossNorm = normalizeRuForCompare(senseOne?.glossRu);
        if (entryRuNorm && senseOneGlossNorm && entryRuNorm === senseOneGlossNorm) {
          draftObj.warnings = [...draftObj.warnings, "sense#1 duplicates entryPatch.ru"];
        }
      }

      // Normalize/dedupe forms + validate by POS + lightweight fallback for obvious regular forms.
      const normalizedForms = [];
      const seenForms = new Set();
      for (const raw of draftObj.forms) {
        const f = raw && typeof raw === "object" ? raw : {};
        const form = String(f.form || "").trim().toLowerCase();
        const formType = normalizeFormType(f.formType);
        if (!form || !formType) continue;
        const key = `${formType}|${form}`;
        if (seenForms.has(key)) {
          draftObj.warnings = [...draftObj.warnings, `duplicate form removed: ${form} (${formType})`];
          continue;
        }
        seenForms.add(key);
        normalizedForms.push({
          form,
          formType,
          isIrregular: Boolean(f.isIrregular),
          notes: String(f.notes || ""),
        });
      }

      const lemmaEn = String(mergedEntryPatch.en || word || existing?.entry?.en || existing?.lemma?.lemma || "").trim().toLowerCase();
      const posRaw = String(existing?.lemma?.pos || "").trim().toLowerCase();
      const looksVerb = /(verb|глагол)/.test(posRaw);
      const looksNoun = /(noun|существ)/.test(posRaw);
      const looksAdjective = /(adjective|adj|прилаг)/.test(posRaw);
      const formTypesSet = new Set(normalizedForms.map((f) => String(f.formType)));

      const ensureForm = (formType, generator, opts = {}) => {
        if (!lemmaEn || formTypesSet.has(formType)) return false;
        const generated = String(generator(lemmaEn) || "").trim().toLowerCase();
        if (!generated || generated === lemmaEn) return false;
        const key = `${formType}|${generated}`;
        if (seenForms.has(key)) return false;
        seenForms.add(key);
        formTypesSet.add(formType);
        normalizedForms.push({
          form: generated,
          formType,
          isIrregular: Boolean(opts.isIrregular),
          notes: opts.notes ? String(opts.notes) : "auto-filled (regular fallback)",
        });
        const source = opts.isIrregular ? "irregular fallback" : "regular fallback";
        draftObj.warnings = [...draftObj.warnings, `forms auto-filled: ${generated} (${formType}, ${source})`];
        return true;
      };

      if (looksVerb) {
        const expectedVerb = ["third_person_singular", "ing", "past", "past_participle"];
        const missingVerb = expectedVerb.filter((t) => !formTypesSet.has(t));
        if (missingVerb.length > 0) {
          draftObj.warnings = [...draftObj.warnings, `forms missing for verb: ${missingVerb.join(", ")}`];
        }
        const irregular = IRREGULAR_VERB_FORMS[lemmaEn] || null;
        const fromIrregular = (formType) => (irregular ? irregular[formType] || "" : "");
        ensureForm("third_person_singular", (w) => fromIrregular("third_person_singular") || verb3rd(w), {
          isIrregular: Boolean(irregular),
          notes: irregular ? "auto-filled (irregular fallback)" : "auto-filled (regular fallback)",
        });
        ensureForm("ing", (w) => fromIrregular("ing") || verbIng(w), {
          isIrregular: Boolean(irregular),
          notes: irregular ? "auto-filled (irregular fallback)" : "auto-filled (regular fallback)",
        });
        ensureForm("past", (w) => fromIrregular("past") || verbPast(w), {
          isIrregular: Boolean(irregular),
          notes: irregular ? "auto-filled (irregular fallback)" : "auto-filled (regular fallback)",
        });
        ensureForm("past_participle", (w) => fromIrregular("past_participle") || verbPast(w), {
          isIrregular: Boolean(irregular),
          notes: irregular ? "auto-filled (irregular fallback)" : "auto-filled (regular fallback)",
        });
      } else if (looksNoun) {
        if (!formTypesSet.has("plural")) {
          draftObj.warnings = [...draftObj.warnings, "forms missing for noun: plural"];
        }
        ensureForm("plural", pluralizeNoun);
      } else if (looksAdjective) {
        const missingAdj = ["comparative", "superlative"].filter((t) => !formTypesSet.has(t));
        if (missingAdj.length > 0) {
          draftObj.warnings = [...draftObj.warnings, `forms missing for adjective: ${missingAdj.join(", ")}`];
        }
        // avoid noisy fallback for long adjectives where periphrastic forms are common
        if (lemmaEn && lemmaEn.length <= 8 && !lemmaEn.includes(" ")) {
          ensureForm("comparative", adjComparative);
          ensureForm("superlative", adjSuperlative);
        }
      }

      draftObj.forms = normalizedForms;
      draftObj.warnings = Array.from(new Set((draftObj.warnings || []).map((x) => String(x))));

      if (mode === "forms_only") {
        draftObj.senses = [];
        // Keep entryPatch untouched in UI editor.
        draftObj.warnings = Array.from(new Set([...(draftObj.warnings || []), "mode: forms_only (senses omitted)"]));
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
        mode === "forms_only"
          ? "РЕЖИМ: forms_only. Сгенерируй только forms + warnings. Не генерируй senses."
          : "РЕЖИМ: full. Генерируй карточку, смыслы, формы и warnings.",
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
        "- Смыслы (senses): 1–4 реально разных значения, glossRu — один вариант на смысл. Для senseNo=1 не дублируй дословно entryPatch.ru; если рядом по смыслу, уточни через definitionRu/usageNote и другой пример. Примеры короткие и естественные.",
        "- Формы (forms): НЕ пропускай, если их можно определить. Без дублей.",
        "- Для глагола дай минимум: third_person_singular, ing, past, past_participle.",
        "- Для существительного дай plural (если исчисляемое).",
        "- Для прилагательного добавляй comparative/superlative только если форма естественная (short adjective), иначе можно не добавлять.",
        "- formType только из списка: ing|past|past_participle|third_person_singular|plural|comparative|superlative|other.",
        "",
        mode === "forms_only"
          ? "Выход (forms_only): СТРОГО JSON вида { \"forms\": [...], \"warnings\": [...] } без markdown."
          : "Выход: СТРОГО один JSON без markdown. Формат:",
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
    console.error(path, e);
    send(res, 500, { error: "Internal server error", details: e?.message || String(e) });
  }
});

/** Одноразовая миграция: перенос users.personal_dictionary в user_saved_senses и удаление колонки. Запускается при каждом старте (идемпотентно). */
async function runPersonalDictionaryMigration() {
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'personal_dictionary'`
  );
  if (col.rows.length === 0) return;
  const users = await pool.query("SELECT username FROM users");
  for (const row of users.rows) {
    await ensureUserDictionaryBackfilled(row.username, "en");
  }
  await pool.query("ALTER TABLE users DROP COLUMN IF EXISTS personal_dictionary");
  invalidatePersonalDictionaryColumnCache();
  console.log("Migration: users.personal_dictionary dropped (data in user_saved_senses).");
}

async function start() {
  await initDb();
  try {
    await runPersonalDictionaryMigration();
  } catch (e) {
    console.warn("Personal dictionary migration skipped or failed:", e.message);
  }
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
