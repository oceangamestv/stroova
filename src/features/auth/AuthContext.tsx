import React, { useEffect, useMemo, useState } from "react";
import type { User } from "../../data/contracts/types";
import { authService } from "../../services/authService";
import { hydrateUser } from "../../data/adapters/serverAuthAdapter";

type AuthContextValue = {
  user: User | null;
  /** В серверном режиме — асинхронный. */
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refresh: () => void;
  /** Смена отображаемого имени (никнейма). Логин не меняется. */
  updateDisplayName: (displayName: string) => Promise<{ success: boolean; error?: string }>;
  isUsernameAvailable: (username: string, excludeUsername?: string | null) => Promise<boolean>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  const refresh = () => {
    setUser(authService.getCurrentUser());
  };

  useEffect(() => {
    hydrateUser().then(() => refresh());
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      login: async (username, password) => {
        const result = await authService.login(username, password);
        if (result.success) refresh();
        return result;
      },
      register: async (username, password) => {
        const result = await authService.register(username, password);
        if (result.success) refresh();
        return result;
      },
      logout: () => {
        authService.logout();
        setUser(null);
      },
      refresh,
      updateDisplayName: async (displayName) => {
        const result = await authService.updateDisplayName(displayName);
        if (result.success) refresh();
        return result;
      },
      isUsernameAvailable: (username, excludeUsername) =>
        authService.isUsernameAvailable(username, excludeUsername),
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
