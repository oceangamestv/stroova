import React, { useEffect } from "react";
import { useRoutes, useLocation, Navigate } from "react-router-dom";
import DictionaryPage from "../pages/DictionaryPage";
import ProfilePage from "../pages/ProfilePage";
import LoginPage from "../pages/LoginPage";
import RatingsPage from "../pages/RatingsPage";
import AboutPage from "../pages/AboutPage";
import { AuthProvider, useAuth } from "../features/auth/AuthContext";
import ThemeProvider from "../features/theme/ThemeProvider";
import { authAdapter } from "../data/adapters/authAdapter";
import { HomeOrHub, GameRoute } from "./RouteWrappers";
import { initializeVoices, pregenerateDictionaryAudio, VOICE_STORAGE_KEY_PREFIX } from "../utils/sounds";
import { dictionaryApi } from "../api/endpoints";
import { A0_DICTIONARY } from "../data/dictionary";

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const routeConfig = [
  { path: "/login", element: <LoginPage /> },
  { path: "/dictionary", element: <DictionaryPage /> },
  {
    path: "/profile",
    element: (
      <ProtectedRoute>
        <ProfilePage />
      </ProtectedRoute>
    ),
  },
  { path: "/settings", element: <Navigate to="/profile" replace /> },
  { path: "/rating", element: <RatingsPage /> },
  { path: "/about", element: <AboutPage /> },
  { path: "/", element: <HomeOrHub /> },
  { path: "/pairs", element: <GameRoute /> },
  { path: "/puzzle", element: <GameRoute /> },
  { path: "/danetka", element: <GameRoute /> },
  { path: "/one-of-three", element: <GameRoute /> },
  { path: "*", element: <Navigate to="/" replace /> },
];

const AppRoutes = () => {
  const location = useLocation();
  const element = useRoutes(routeConfig);
  // Ключ по pathname гарантирует размонтирование страницы профиля при переходе на другую страницу
  return <div key={location.pathname}>{element}</div>;
};

const App = () => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset_all_progress") === "1") {
      authAdapter.resetAllUsersProgress();
      window.history.replaceState({}, "", window.location.pathname);
      window.location.reload();
    }
  }, []);

  // Предгенерация аудио для словаря в фоне
  useEffect(() => {
    const startAudioPregeneration = async () => {
      // Инициализируем голоса
      await initializeVoices();
      
      // Проверяем, используется ли Kokoro TTS (проверяем все возможные ключи)
      let useKokoro = false;
      try {
        // Проверяем ключи для всех пользователей в localStorage
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(VOICE_STORAGE_KEY_PREFIX)) {
            const voice = localStorage.getItem(key);
            if (voice && voice.startsWith("kokoro:")) {
              useKokoro = true;
              break;
            }
          }
        }
      } catch {
        // Игнорируем ошибки
      }
      
      // Проверяем, есть ли системные голоса
      const hasSystemVoices = window.speechSynthesis && window.speechSynthesis.getVoices().length > 0;
      
      // Если не используется Kokoro и есть системные голоса - предгенерация не нужна
      if (!useKokoro && hasSystemVoices) {
        return;
      }
      
      // Загружаем словарь
      try {
        const words = await dictionaryApi.getWords({ lang: "en" }).catch(() => A0_DICTIONARY);
        if (words && words.length > 0) {
          // Запускаем предгенерацию в фоне (не блокируем UI)
          pregenerateDictionaryAudio(words, (current, total) => {
            if (current % 50 === 0 || current === total) {
              console.log(`Audio pregeneration: ${current}/${total} words`);
            }
          }).catch((error) => {
            console.warn("Audio pregeneration failed:", error);
          });
        }
      } catch (error) {
        console.warn("Failed to start audio pregeneration:", error);
      }
    };
    
    // Запускаем через небольшую задержку, чтобы не блокировать загрузку приложения
    setTimeout(startAudioPregeneration, 2000);
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
