import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";

type Mode = "login" | "register";

const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { user, login, register } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const name = username.trim();

    try {
      if (mode === "register") {
        if (password !== confirmPassword) {
          setError("Пароли не совпадают");
          return;
        }
        const regResult = await register(name, password);
        if (!regResult.success) {
          setError(regResult.error || "Ошибка регистрации");
          return;
        }
        const loginResult = await login(name, password);
        if (loginResult.success) {
          navigate("/", { replace: true });
        } else {
          setError(loginResult.error || "Ошибка входа");
        }
        return;
      }

      const result = await login(name, password);
      if (result.success) {
        navigate("/", { replace: true });
      } else {
        setError(result.error || "Неверный логин или пароль");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="logo">
            <img src="/logo.png" alt="" className="logo-icon" width={40} height={40} />
            <span className="logo-text">STroova</span>
          </div>
          <h1 className="auth-title">{mode === "login" ? "Вход" : "Регистрация"}</h1>
          <p className="auth-subtitle">
            {mode === "login"
              ? "Войди в свой аккаунт, чтобы продолжить обучение"
              : "Создай новый аккаунт, чтобы начать обучение"}
          </p>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => setMode("login")}
            type="button"
          >
            Вход
          </button>
          <button
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => setMode("register")}
            type="button"
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="form-group">
            <label htmlFor="username">Логин</label>
            <input
              type="text"
              id="username"
              name="username"
              placeholder="Введите логин"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Пароль</label>
            <input
              type="password"
              id="password"
              name="password"
              placeholder="Введите пароль"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === "register" && (
            <div className="form-group">
              <label htmlFor="confirm-password">Подтвердите пароль</label>
              <input
                type="password"
                id="confirm-password"
                name="confirm-password"
                placeholder="Повторите пароль"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="primary-btn auth-submit-btn" disabled={loading}>
            {loading ? "…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
