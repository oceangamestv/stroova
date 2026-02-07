/**
 * Ключи хранилища для системы учётных записей.
 * Все данные хранятся в localStorage (или другом бэкенде через storage).
 */

/** Таблица пользователей: Record<username, User> */
export const USERS_STORAGE_KEY = "linguaMatch_users";

/** Текущая сессия: { username, loginTime } | null */
export const SESSION_STORAGE_KEY = "linguaMatch_session";
