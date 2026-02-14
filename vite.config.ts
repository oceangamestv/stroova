import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  appType: "spa",
  base: "./", // для корректной загрузки в Capacitor (Android/iOS)
  plugins: [
    react(),
    // Гарантируем, что маршруты SPA (/dictionary, /profile и т.д.) отдают index.html,
    // чтобы после F5 показывалось приложение, а не 404.
    {
      name: "spa-fallback-routes",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.method !== "GET" || !req.url) return next();
          const path = req.url.replace(/\?.*$/, "");
          if (path.startsWith("/@") || path.startsWith("/node_modules") || path.includes(".")) return next();
          req.url = "/index.html";
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      // Если фронт ходит по относительному /api (без VITE_API_URL), запросы уходят на бэкенд
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
