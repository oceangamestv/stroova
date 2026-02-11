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

const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
/** Список разрешённых origin (сайт + Capacitor Android/iOS) */
const CORS_ORIGINS = CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);

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

async function requireAuthUser(req, res) {
  const token = getAuthToken(req);
  if (!token) {
    send(res, 401, { error: "Требуется авторизация" });
    return null;
  }
  const session = await getSessionByToken(token);
  if (!session) {
    send(res, 401, { error: "Требуется авторизация" });
    return null;
  }
  const user = await getUser(session.username);
  if (!user) {
    send(res, 401, { error: "Пользователь не найден" });
    return null;
  }
  return { user, session };
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
   * AI-подсказка по слову для админки. Требует OPENAI_API_KEY.
   * Возвращает suggestion в формате полей dictionary_entries.
   */
  "POST /api/admin/dictionary/ai-suggest": async (req, res, body) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
        "en, ru, level, accent, frequencyRank, rarity, register, example, exampleRu",
        "Требования:",
        "- en: исходное слово/выражение (как в запросе)",
        "- ru: короткий, самый частотный перевод (1 вариант, без скобок и перечислений)",
        "- level: A0|A1|A2|B1|B2|C1|C2 (примерно, по сложности)",
        "- rarity: 'не редкое'|'редкое'|'очень редкое'",
        "- register: 'официальная'|'разговорная'",
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
    console.log(`CORS_ORIGIN: ${CORS_ORIGIN}`);
    console.log(`CORS origins (${CORS_ORIGINS.length}): ${CORS_ORIGINS.join(", ")}`);
    console.log(`DB: PostgreSQL`);
  });
}

start().catch((err) => {
  console.error("Ошибка запуска:", err);
  process.exit(1);
});
