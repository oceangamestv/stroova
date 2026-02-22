/**
 * Telegram-бот для STroova. Открывает приложение как Mini App (Web App) в Telegram.
 * Запуск: npm run telegram-bot (из корня проекта).
 * В .env нужен TELEGRAM_BOT_TOKEN (токен от @BotFather).
 */
import "dotenv/config";
import { Telegraf, Markup } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL || "https://stroova.ru";

if (!token) {
  console.error("Не задан TELEGRAM_BOT_TOKEN в .env");
  process.exit(1);
}

// Ошибка 409 = второй экземпляр getUpdates (только один polling на токен).
// При мгновенном рестарте PM2 старый сеанс ещё не закрыт → снова 409 → цикл.
const CONFLICT_409_EXIT_DELAY_MS = 15_000;

function is409Conflict(err) {
  return err?.response?.error_code === 409 || (err?.message && String(err.message).includes("409"));
}

// Логирование необработанных ошибок (причина перезапусков PM2)
process.on("uncaughtException", (err) => {
  console.error("[telegram-bot] uncaughtException:", err?.message || err);
  console.error(err?.stack || err);
  if (is409Conflict(err)) {
    console.error("[telegram-bot] 409 Conflict: выход через", CONFLICT_409_EXIT_DELAY_MS / 1000, "с, чтобы PM2 перезапустил один экземпляр.");
    setTimeout(() => process.exit(1), CONFLICT_409_EXIT_DELAY_MS);
    return;
  }
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[telegram-bot] unhandledRejection:", reason?.message || reason);
  if (reason?.stack) console.error(reason.stack);
  if (is409Conflict(reason)) {
    console.error("[telegram-bot] 409 Conflict (getUpdates): только один экземпляр бота. Выход через", CONFLICT_409_EXIT_DELAY_MS / 1000, "с.");
    setTimeout(() => process.exit(1), CONFLICT_409_EXIT_DELAY_MS);
    return;
  }
});

const bot = new Telegraf(token);

// Ошибки в обработчиках команд — логируем, не роняем процесс
bot.catch((err, ctx) => {
  console.error("[telegram-bot] Ошибка в обработчике:", err?.message || err);
  console.error("Update:", ctx?.update?.update_id);
});

// Кнопка «Открыть приложение» — открывает STroova как Mini App внутри Telegram
const openAppKeyboard = Markup.inlineKeyboard([
  [Markup.button.webApp("Открыть STroova", appUrl)],
]);

bot.start(async (ctx) => {
  // Кнопка меню рядом с полем ввода — тоже открывает приложение
  await ctx.setChatMenuButton({
    type: "web_app",
    text: "Открыть STroova",
    web_app: { url: appUrl },
  });
  await ctx.reply(
    "Привет! Я бот STroova — приложения для изучения английского.\n\n" +
      "Нажми кнопку ниже, чтобы открыть приложение прямо в Telegram:",
    openAppKeyboard
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    "Нажми кнопку «Открыть STroova» — приложение откроется в Telegram.\n\n" +
      "Команды: /start — приветствие и кнопка приложения.",
    openAppKeyboard
  );
});

bot.launch().then(() => {
  console.log("Telegram-бот запущен.");
}).catch((err) => {
  console.error("[telegram-bot] Ошибка запуска (launch):", err?.message || err);
  console.error(err?.stack || err);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
