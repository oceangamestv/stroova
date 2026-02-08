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

const bot = new Telegraf(token);

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
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
