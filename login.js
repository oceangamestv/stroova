// Логика страницы входа/регистрации

let currentMode = "login";

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const submitBtn = document.getElementById("submit-btn");
const confirmPasswordGroup = document.getElementById("confirm-password-group");
const confirmPasswordInput = document.getElementById("confirm-password");
const formError = document.getElementById("form-error");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

// Переключение между режимами входа и регистрации
function switchMode(mode) {
  currentMode = mode;

  tabLogin.classList.toggle("active", mode === "login");
  tabRegister.classList.toggle("active", mode === "register");

  if (mode === "login") {
    authTitle.textContent = "Вход";
    authSubtitle.textContent = "Войди в свой аккаунт, чтобы продолжить обучение";
    submitBtn.textContent = "Войти";
    confirmPasswordGroup.style.display = "none";
    confirmPasswordInput.removeAttribute("required");
  } else {
    authTitle.textContent = "Регистрация";
    authSubtitle.textContent = "Создай новый аккаунт, чтобы начать обучение";
    submitBtn.textContent = "Зарегистрироваться";
    confirmPasswordGroup.style.display = "block";
    confirmPasswordInput.setAttribute("required", "required");
  }

  formError.textContent = "";
  authForm.reset();
}

tabLogin.addEventListener("click", () => switchMode("login"));
tabRegister.addEventListener("click", () => switchMode("register"));

// Обработка отправки формы
authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  formError.textContent = "";

  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (currentMode === "register") {
    // Регистрация
    if (password !== confirmPassword) {
      formError.textContent = "Пароли не совпадают";
      return;
    }

    const result = registerUser(username, password);
    if (result.success) {
      // Автоматически входим после регистрации
      const loginResult = loginUser(username, password);
      if (loginResult.success) {
        window.location.href = "index.html";
      } else {
        formError.textContent = loginResult.error;
      }
    } else {
      formError.textContent = result.error;
    }
  } else {
    // Вход
    const result = loginUser(username, password);
    if (result.success) {
      window.location.href = "index.html";
    } else {
      formError.textContent = result.error;
    }
  }
});

// Проверка, не авторизован ли уже пользователь
window.addEventListener("DOMContentLoaded", () => {
  const currentUser = getCurrentUser();
  if (currentUser) {
    // Если уже авторизован, перенаправляем на главную
    window.location.href = "index.html";
  }
});
