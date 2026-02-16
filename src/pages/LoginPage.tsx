import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";

type Mode = "login" | "register";

const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [agreementHighlight, setAgreementHighlight] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState<number | null>(null);
  const { user, login, register } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    setError("");
    setLockoutUntil(null);
    setLockoutSecondsLeft(null);
    if (mode === "login") {
      setConfirmPassword("");
      setAgreedToTerms(false);
      setAgreedToPrivacy(false);
    }
  }, [mode]);

  useEffect(() => {
    if (lockoutUntil == null) return;
    const tick = () => {
      const left = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (left <= 0) {
        setLockoutUntil(null);
        setLockoutSecondsLeft(null);
        setError("");
        return;
      }
      setLockoutSecondsLeft(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutUntil != null) return;
    setError("");
    setLoading(true);
    const name = username.trim();

    try {
      if (mode === "register") {
        if (!agreedToTerms || !agreedToPrivacy) {
          setError("Необходимо согласиться с Пользовательским соглашением и Политикой конфиденциальности");
          setAgreementHighlight(true);
          return;
        }
        setAgreementHighlight(false);
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
        if (result.retryAfterSeconds != null) {
          setLockoutUntil(Date.now() + result.retryAfterSeconds * 1000);
          setLockoutSecondsLeft(result.retryAfterSeconds);
        }
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

          {mode === "register" && (
            <div
              className={`auth-legal${agreementHighlight ? " auth-legal--highlight" : ""}`}
              role="group"
              aria-label="Согласия"
            >
              <div className="auth-legal-title">Перед регистрацией подтвердите:</div>

              <div className={`auth-legal-item${agreementHighlight && !agreedToTerms ? " auth-legal-item--highlight" : ""}`}>
                <input
                  type="checkbox"
                  id="terms"
                  checked={agreedToTerms}
                  onChange={(e) => {
                    setAgreedToTerms(e.target.checked);
                    if (e.target.checked) setAgreementHighlight(false);
                  }}
                />
                <label htmlFor="terms">
                  <span className="auth-legal-prefix">Я согласен с</span>
                  <Link
                    to="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="auth-legal-link"
                    title="Пользовательским соглашением"
                  >
                    Пользовательским соглашением
                  </Link>
                </label>
              </div>

              <div className={`auth-legal-item${agreementHighlight && !agreedToPrivacy ? " auth-legal-item--highlight" : ""}`}>
                <input
                  type="checkbox"
                  id="privacy"
                  checked={agreedToPrivacy}
                  onChange={(e) => {
                    setAgreedToPrivacy(e.target.checked);
                    if (e.target.checked) setAgreementHighlight(false);
                  }}
                />
                <label htmlFor="privacy">
                  <span className="auth-legal-prefix">Я согласен с</span>
                  <Link
                    to="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="auth-legal-link"
                    title="Политикой конфиденциальности"
                  >
                    Политикой конфиденциальности
                  </Link>
                </label>
              </div>

              <div className="auth-legal-hint">
                Важно: не используйте ФИО и другие персональные данные в логине — аккаунт может быть заблокирован.
              </div>
            </div>
          )}

          {error && (
            <div className="form-error">
              {error}
              {lockoutSecondsLeft != null && (
                <span className="form-error-lockout"> Повторите через {lockoutSecondsLeft} с.</span>
              )}
            </div>
          )}

          <button
            type="submit"
            className="primary-btn auth-submit-btn"
            disabled={loading || lockoutUntil != null}
          >
            {loading
              ? "…"
              : lockoutSecondsLeft != null
                ? `Подождите ${lockoutSecondsLeft} с`
                : mode === "login"
                  ? "Войти"
                  : "Зарегистрироваться"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
