import React, { useEffect } from "react";
import { useRoutes, useLocation, Navigate } from "react-router-dom";
import ExercisesPage from "../pages/ExercisesPage";
import DictionaryPage from "../pages/DictionaryPage";
import ProfilePage from "../pages/ProfilePage";
import LoginPage from "../pages/LoginPage";
import RatingsPage from "../pages/RatingsPage";
import { AuthProvider, useAuth } from "../features/auth/AuthContext";
import ThemeProvider from "../features/theme/ThemeProvider";
import { authAdapter } from "../data/adapters/authAdapter";

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
  { path: "/", element: <ExercisesPage /> },
  { path: "/pairs", element: <ExercisesPage /> },
  { path: "/puzzle", element: <ExercisesPage /> },
  { path: "/danetka", element: <ExercisesPage /> },
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

  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
