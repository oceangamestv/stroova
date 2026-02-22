/**
 * AI Story Trainer: сессии (история + пересказ), лимит раз в день.
 */
import { pool } from "./db.js";

export async function createSession(username, langCode, storyText, wordSenseIds, db = pool) {
  const res = await db.query(
    `INSERT INTO user_story_trainer_sessions (username, lang_code, story_text, word_sense_ids)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id AS "sessionId", story_text AS "storyText", word_sense_ids AS "wordSenseIds"`,
    [String(username), String(langCode || "en"), String(storyText), JSON.stringify(wordSenseIds || [])]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    storyText: row.storyText,
    wordSenseIds: row.wordSenseIds,
  };
}

export async function getSessionById(sessionId, db = pool) {
  const res = await db.query(
    `SELECT id, username, lang_code, story_text, word_sense_ids, created_at, submitted_at,
            retelling_text, retelling_language, semantic_score, xp_granted
     FROM user_story_trainer_sessions WHERE id = $1`,
    [sessionId]
  );
  return res.rows[0] || null;
}

/** Количество сессий пользователя за сегодня (по created_at, серверная дата). */
export async function countSessionsToday(username, db = pool) {
  const res = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM user_story_trainer_sessions
     WHERE username = $1 AND created_at::date = CURRENT_DATE`,
    [String(username)]
  );
  return res.rows[0]?.cnt ?? 0;
}

export async function updateSessionSubmit(sessionId, username, retellingText, retellingLanguage, semanticScore, xpGranted, db = pool) {
  const res = await db.query(
    `UPDATE user_story_trainer_sessions
     SET submitted_at = NOW(), retelling_text = $3, retelling_language = $4, semantic_score = $5, xp_granted = $6
     WHERE id = $1 AND username = $2 AND submitted_at IS NULL
     RETURNING id`,
    [sessionId, String(username), String(retellingText), String(retellingLanguage || "ru"), semanticScore, xpGranted]
  );
  return res.rowCount > 0;
}
