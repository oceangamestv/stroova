/**
 * HTTP-клиент для запросов к бэкенду.
 * Подставляет Authorization: Bearer <token> из sessionStorage (или localStorage).
 */

import { API_BASE_URL } from "./config";

const SESSION_TOKEN_KEY = "stroova_api_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

type RequestInitWithBody = RequestInit & { body?: object };

async function request<T>(
  path: string,
  options: RequestInitWithBody = {}
): Promise<T> {
  const { body, ...rest } = options;
  // Если VITE_API_URL не задан — используем относительный /api (тот же домен, что и сайт)
  const base = (API_BASE_URL || "").trim() || "/api";
  const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...((rest.headers as Record<string, string>) || {}),
  };
  const token = getStoredToken();
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : rest.body,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    let details: Record<string, unknown> | undefined;
    try {
      const json = JSON.parse(text) as { error?: string; message?: string; retryAfterSeconds?: number };
      message = json.error ?? json.message ?? text;
      if (json.retryAfterSeconds !== undefined) {
        details = { retryAfterSeconds: json.retryAfterSeconds };
      }
    } catch {
      // leave message as text
    }
    throw new ApiError(res.status, message, details);
  }
  const contentType = res.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return undefined as unknown as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),

  post: <T>(path: string, body?: object) =>
    request<T>(path, { method: "POST", body }),

  patch: <T>(path: string, body?: object) =>
    request<T>(path, { method: "PATCH", body }),

  put: <T>(path: string, body?: object) =>
    request<T>(path, { method: "PUT", body }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
