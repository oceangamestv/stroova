#!/usr/bin/env node
import "dotenv/config";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

function parseArgs(argv) {
  const out = { wait: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wait") out.wait = true;
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--request-id") out.requestId = argv[++i];
    else if (a === "--source") out.source = argv[++i];
    else if (a === "--url") out.url = argv[++i];
  }
  return out;
}

function buildBodyHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload || {}), "utf8").digest("hex");
}

function signPayload(timestampSec, requestId, payload, secret) {
  const bodyHash = buildBodyHash(payload);
  const sig = crypto.createHmac("sha256", secret).update(`${timestampSec}.${requestId}.${bodyHash}`, "utf8").digest("hex");
  return `sha256=${sig}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  const endpoint = String(args.url || process.env.RF_SYNC_URL || "").trim();
  const sharedSecret = String(process.env.RF_SYNC_SHARED_SECRET || "").trim();
  const source = String(args.source || process.env.RF_SYNC_SOURCE || "de-ai-worker").trim();
  const retries = Math.max(1, Number(process.env.RF_SYNC_RETRIES || 4));

  if (!endpoint) throw new Error("RF_SYNC_URL is required");
  if (!sharedSecret) throw new Error("RF_SYNC_SHARED_SECRET is required");
  if (!args.file) throw new Error("Use --file <payload.json>");

  const payloadPath = path.resolve(process.cwd(), args.file);
  const raw = await fs.readFile(payloadPath, "utf8");
  const parsed = JSON.parse(raw);
  const requestId = String(args.requestId || parsed?.requestId || crypto.randomUUID()).trim();

  const body = {
    requestId,
    source,
    payloadVersion: String(parsed?.payloadVersion || "1"),
    lang: String(parsed?.lang || "en"),
    actorUsername: String(parsed?.actorUsername || "").trim() || null,
    entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
  };
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    throw new Error("Payload must include non-empty entries[]");
  }

  let response = null;
  let responseJson = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = signPayload(ts, requestId, body, sharedSecret);
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-timestamp": ts,
          "x-sync-request-id": requestId,
          "x-sync-signature": signature,
        },
        body: JSON.stringify(body),
      });
      responseJson = await response.json().catch(() => ({}));
      if (response.ok) break;
      if (response.status < 500 || attempt === retries) {
        throw new Error(`RF sync failed: ${response.status} ${JSON.stringify(responseJson)}`);
      }
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  console.log(JSON.stringify({ ok: true, requestId, accepted: true, response: responseJson }, null, 2));

  if (!args.wait) return;
  const statusEndpoint = new URL(endpoint);
  statusEndpoint.pathname = "/api/internal/dictionary-upserts/status";
  statusEndpoint.searchParams.set("requestId", requestId);

  for (let i = 0; i < 60; i++) {
    const ts = String(Math.floor(Date.now() / 1000));
    const statusPayload = { requestId };
    const signature = signPayload(ts, requestId, statusPayload, sharedSecret);
    const statusRes = await fetch(statusEndpoint, {
      headers: {
        "x-sync-timestamp": ts,
        "x-sync-request-id": requestId,
        "x-sync-signature": signature,
      },
    });
    const statusJson = await statusRes.json().catch(() => ({}));
    const st = statusJson?.status;
    if (st === "success" || st === "failed") {
      console.log(JSON.stringify({ ok: st === "success", requestId, status: st, result: statusJson?.job?.result, error: statusJson?.job?.errorMessage || "" }, null, 2));
      return;
    }
    await sleep(2000);
  }
  throw new Error("Timed out while waiting for RF sync job completion");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
