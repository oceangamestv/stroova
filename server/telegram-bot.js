/**
 * Telegram-бот для STroova. Приветствие, помощь, ссылка на приложение.
 * Запуск: npm run telegram-bot (из корня проекта).
 * В .env нужен TELEGRAM_BOT_TOKEN (токен от @BotFather).
 */
import "dotenv/config";
import { Telegraf } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL || "https://stroova.ru";

if (!token) {
  console.error("Не задан TELEGRAM_BOT_TOKEN в .env");
  process.exit(1);
}

const bot = new Telegraf(token);

bot.start((ctx) => {
  ctx.reply(
    `Привет! Я бот STroova — приложения для изучения английского.\n\n` +
      `Открой приложение в браузере: ${appUrl}\n\n` +
      `Команды: /help — справка.`
  );
});

bot.help((ctx) => {
  ctx.reply(
    "Команды:\n" +
      "/start — приветствие и ссылка на приложение\n" +
      "/help — эта справка\n\n" +
      `Приложение: ${appUrl}`
  );
});

bot.launch().then(() => {
  console.log("Telegram-бот запущен.");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
