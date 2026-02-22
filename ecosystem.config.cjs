/**
 * PM2 config for production.
 * Usage on server:
 *   pm2 startOrReload ecosystem.config.cjs --update-env
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      name: "stroova-api",
      script: "server/index.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "stroova-telegram-bot",
      script: "server/telegram-bot.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 15000,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

