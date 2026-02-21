import { pool } from "./db.js";
import { syncDictionaryV2FromEntries, updateDictionaryVersion, upsertDictionaryEntriesBatch } from "./dictionaryRepo.js";

const JOB_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  SUCCESS: "success",
  FAILED: "failed",
};

let workerTimer = null;
let workerBusy = false;
let workerLastError = "";
let workerLastRunAt = null;

export async function enqueueInternalDictionarySyncJob({ requestId, source, payload }) {
  const reqId = String(requestId || "").trim();
  if (!reqId) throw new Error("requestId is required");
  const src = String(source || "").trim() || "unknown";
  const payloadObj = payload && typeof payload === "object" ? payload : {};

  const insertRes = await pool.query(
    `
      INSERT INTO internal_dictionary_sync_jobs (request_id, source, status, payload_json)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (request_id) DO NOTHING
      RETURNING id, request_id AS "requestId", source, status, created_at AS "createdAt", updated_at AS "updatedAt"
    `,
    [reqId, src, JOB_STATUS.PENDING, JSON.stringify(payloadObj)]
  );
  if (insertRes.rows[0]) {
    return { created: true, job: insertRes.rows[0] };
  }
  const existing = await getInternalDictionarySyncJobByRequestId(reqId);
  return { created: false, job: existing };
}

export async function getInternalDictionarySyncJobByRequestId(requestId) {
  const reqId = String(requestId || "").trim();
  if (!reqId) return null;
  const res = await pool.query(
    `
      SELECT
        id,
        request_id AS "requestId",
        source,
        status,
        attempt_count AS "attemptCount",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        started_at AS "startedAt",
        finished_at AS "finishedAt",
        result_json AS "result"
      FROM internal_dictionary_sync_jobs
      WHERE request_id = $1
      LIMIT 1
    `,
    [reqId]
  );
  return res.rows[0] || null;
}

export function getInternalDictionarySyncWorkerHealth() {
  return {
    running: !!workerTimer,
    busy: workerBusy,
    lastRunAt: workerLastRunAt,
    lastError: workerLastError || null,
  };
}

export async function getInternalDictionarySyncStats() {
  const totalsRes = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE status = 'success')::int AS success,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM internal_dictionary_sync_jobs
    `
  );
  const recentFailuresRes = await pool.query(
    `
      SELECT id, request_id AS "requestId", source, error_message AS "errorMessage", updated_at AS "updatedAt"
      FROM internal_dictionary_sync_jobs
      WHERE status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 20
    `
  );

  return {
    totals: totalsRes.rows[0] || { total: 0, pending: 0, processing: 0, success: 0, failed: 0 },
    recentFailures: recentFailuresRes.rows || [],
    worker: getInternalDictionarySyncWorkerHealth(),
  };
}

export function startInternalDictionarySyncWorker({ pollMs = 3000 } = {}) {
  if (workerTimer) return;
  const interval = Math.max(1000, Number(pollMs) || 3000);
  workerTimer = setInterval(() => {
    runInternalDictionarySyncWorkerTick().catch((e) => {
      workerLastError = e instanceof Error ? e.message : String(e);
      console.warn("internal sync worker tick failed:", e);
    });
  }, interval);
}

export function stopInternalDictionarySyncWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

export async function runInternalDictionarySyncWorkerTick() {
  if (workerBusy) return;
  workerBusy = true;
  workerLastRunAt = new Date().toISOString();
  try {
    while (true) {
      const claimed = await claimNextPendingJob();
      if (!claimed) break;
      await processInternalDictionarySyncJob(claimed);
    }
  } finally {
    workerBusy = false;
  }
}

async function claimNextPendingJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pickRes = await client.query(
      `
        SELECT id
        FROM internal_dictionary_sync_jobs
        WHERE status = $1
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
      [JOB_STATUS.PENDING]
    );
    const id = pickRes.rows[0]?.id;
    if (!id) {
      await client.query("ROLLBACK");
      return null;
    }
    const claimRes = await client.query(
      `
        UPDATE internal_dictionary_sync_jobs
        SET
          status = $1,
          started_at = NOW(),
          updated_at = NOW(),
          attempt_count = attempt_count + 1
        WHERE id = $2
        RETURNING id, request_id AS "requestId", source, payload_json AS "payload"
      `,
      [JOB_STATUS.PROCESSING, id]
    );
    await client.query("COMMIT");
    return claimRes.rows[0] || null;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function processInternalDictionarySyncJob(job) {
  const payload = job?.payload && typeof job.payload === "object" ? job.payload : {};
  const lang = String(payload.lang || "en").trim() || "en";
  const source = String(payload.source || job?.source || "de").trim() || "de";
  const actor = String(payload.actorUsername || "").trim() || null;
  const entries = Array.isArray(payload.entries) ? payload.entries : [];

  try {
    const upsert = await upsertDictionaryEntriesBatch(lang, entries, actor);
    await syncDictionaryV2FromEntries(lang);
    const version = await updateDictionaryVersion(lang);

    const result = {
      ok: true,
      source,
      lang,
      requestId: job.requestId,
      dictionaryVersion: version,
      stats: upsert,
    };

    await pool.query(
      `
        UPDATE internal_dictionary_sync_jobs
        SET
          status = $1,
          finished_at = NOW(),
          updated_at = NOW(),
          error_message = '',
          result_json = $2::jsonb
        WHERE id = $3
      `,
      [JOB_STATUS.SUCCESS, JSON.stringify(result), Number(job.id)]
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await pool.query(
      `
        UPDATE internal_dictionary_sync_jobs
        SET
          status = $1,
          finished_at = NOW(),
          updated_at = NOW(),
          error_message = $2
        WHERE id = $3
      `,
      [JOB_STATUS.FAILED, message, Number(job.id)]
    );
  }
}
