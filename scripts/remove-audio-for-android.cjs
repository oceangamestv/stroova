/**
 * Удаляет dist/audio перед копированием в Android, чтобы APK не раздувался
 * на ~500 МБ предгенерированными WAV. Озвучка в приложении будет по запросу с сервера
 * или через fallback (если добавите endpoint).
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(process.cwd(), "dist", "audio");
if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true });
  console.log("Removed dist/audio (not bundled into APK).");
}
