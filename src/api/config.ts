/**
 * Конфигурация API для серверного бэкенда.
 * Для локальной разработки задайте VITE_API_URL в .env (например http://localhost:3000/api).
 */

export const API_BASE_URL =
  (typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL) ||
  "";

export const isServerMode = Boolean(API_BASE_URL);
