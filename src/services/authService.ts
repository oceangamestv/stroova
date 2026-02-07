import type { User, UserGameSettings, UserStats } from "../data/contracts/types";
import { authAdapter } from "../data/adapters/authAdapter";
import { serverAuthAdapter } from "../data/adapters/serverAuthAdapter";

export const authService = {
  async register(username: string, password: string): Promise<{ success: boolean; error?: string }> {
    const trimmed = username.trim();
    if (trimmed.length < 3) {
      return { success: false, error: "Логин должен содержать минимум 3 символа" };
    }
    const available = await this.isUsernameAvailable(trimmed);
    if (!available) {
      return { success: false, error: "Пользователь с таким логином уже существует" };
    }
    if (password.length < 4) {
      return { success: false, error: "Пароль должен содержать минимум 4 символа" };
    }
    return serverAuthAdapter.register(trimmed, password);
  },

  async login(username: string, password: string): Promise<{ success: boolean; error?: string }> {
    return serverAuthAdapter.login(username, password);
  },
  logout() {
    authAdapter.clearSession();
  },
  getCurrentUser(): User | null {
    const session = authAdapter.getSession();
    if (!session) return null;
    const users = authAdapter.getUsers();
    return users[session.username] || null;
  },
  getCurrentUsername(): string | null {
    const session = authAdapter.getSession();
    return session?.username || null;
  },
  /** Проверка уникальности логина (только для регистрации). */
  async isUsernameAvailable(username: string, excludeUsername?: string | null): Promise<boolean> {
    const trimmed = username.trim();
    return serverAuthAdapter.isUsernameAvailable(trimmed, excludeUsername ?? null);
  },

  /** Смена отображаемого имени (никнейм). Логин не меняется. */
  async updateDisplayName(displayName: string): Promise<{ success: boolean; error?: string }> {
    const trimmed = displayName.trim();
    if (trimmed.length < 1) {
      return { success: false, error: "Введите никнейм" };
    }
    return serverAuthAdapter.updateDisplayName(trimmed);
  },
  updateUserStats(
    statsUpdate: Partial<UserStats>,
    options?: { xpEarnedToday?: number }
  ) {
    const username = this.getCurrentUsername();
    if (!username) return;
    const users = authAdapter.getUsers();
    const user = users[username];
    if (!user) return;

    user.stats = {
      ...user.stats,
      ...statsUpdate,
    };
    if (statsUpdate.totalXp !== undefined) {
      user.stats.totalXp = statsUpdate.totalXp;
    }
    if (statsUpdate.bestScore !== undefined) {
      user.stats.bestScore = Math.max(user.stats.bestScore ?? 0, statsUpdate.bestScore);
    }
    if (options?.xpEarnedToday != null && options.xpEarnedToday > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const xpByDate = user.stats.xpByDate ?? {};
      xpByDate[today] = (xpByDate[today] ?? 0) + options.xpEarnedToday;
      user.stats.xpByDate = xpByDate;
    }
    authAdapter.saveUsers(users);
  },

  /** Обновить настройки игр (источник словаря и т.д.). */
  updateGameSettings(patch: Partial<UserGameSettings>) {
    const username = this.getCurrentUsername();
    if (!username) return;
    const users = authAdapter.getUsers();
    const user = users[username];
    if (!user) return;
    user.gameSettings = { ...user.gameSettings, ...patch };
    authAdapter.saveUsers(users);
  },
};
