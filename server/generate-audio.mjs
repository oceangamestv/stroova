/**
 * Предгенерация WAV для всего словаря: только Bella (женский) и Michael (мужской).
 * Файлы: public/audio/female/{slug}.wav и public/audio/male/{slug}.wav
 * Привязка по английскому слову (slug), не по id.
 *
 * Запуск: npm run generate-audio
 * Требует: DATABASE_URL в .env, словарь заполнен (npm run seed).
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { getWordsByLanguage } from "./dictionaryRepo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const AUDIO_DIR = path.join(PROJECT_ROOT, "public", "audio");

/** Bella (женский), Michael (мужской) — голоса Kokoro по именам */
const VOICES = [
  { id: "af_bella", folder: "female", name: "Bella" },
  { id: "am_michael", folder: "male", name: "Michael" },
];

/** Слово → безопасное имя файла (совпадает с логикой в sounds.ts) */
function wordToSlug(en) {
  return String(en)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  await initDb();
  const words = await getWordsByLanguage("en");
  if (words.length === 0) {
    console.error("Словарь пуст. Запустите: npm run seed");
    process.exit(1);
  }

  const { KokoroTTS } = await import("kokoro-js");
  console.log("Голоса: Bella (female), Michael (male)");
  console.log("Слов в словаре:", words.length);

  ensureDir(AUDIO_DIR);

  for (const { id: voiceId, folder, name } of VOICES) {
    const voiceDir = path.join(AUDIO_DIR, folder);
    ensureDir(voiceDir);

    const tts = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      { dtype: "q8", device: "cpu" }
    );

    let done = 0;
    for (const word of words) {
      const slug = wordToSlug(word.en);
      const wavPath = path.join(voiceDir, `${slug}.wav`);
      if (fs.existsSync(wavPath)) {
        done++;
        if (done % 100 === 0) process.stdout.write(`\r[${name}] ${done}/${words.length}`);
        continue;
      }
      try {
        const audio = await tts.generate(word.en, { voice: voiceId });
        audio.save(wavPath);
      } catch (err) {
        console.error(`\n[${name}] en="${word.en}" (${slug}):`, err.message);
      }
      done++;
      if (done % 50 === 0) process.stdout.write(`\r[${name}] ${done}/${words.length}`);
    }
    console.log(`\r[${name}] ${words.length}/${words.length} готово.`);
  }

  console.log("Готово. Файлы: public/audio/female/{slug}.wav, public/audio/male/{slug}.wav");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
