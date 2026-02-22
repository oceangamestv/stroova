/**
 * Предгенерация WAV для всего словаря: только Bella (женский) и Michael (мужской).
 * Файлы: public/audio/female/{slug}.wav и public/audio/male/{slug}.wav
 * Привязка по английскому слову (slug), не по id.
 *
 * Запуск: npm run generate-audio
 * Или с файлом списка: node server/generate-audio.mjs missing-audio.json
 * Требует: DATABASE_URL в .env при работе без файла; словарь заполнен (npm run seed).
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { getWordsByLanguage } from "./dictionaryRepo.js";
import { wordToSlug } from "./audioSlug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const AUDIO_DIR = path.join(PROJECT_ROOT, "public", "audio");

/** Bella (женский), Michael (мужской) — голоса Kokoro по именам */
const VOICES = [
  { id: "af_bella", folder: "female", name: "Bella" },
  { id: "am_michael", folder: "male", name: "Michael" },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Загружает список слов из JSON-файла (формат из админки missing-export).
 * @param {string} filePath
 * @returns {Promise<Array<{ en: string }>>}
 */
async function loadWordsFromFile(filePath) {
  const raw = await fs.promises.readFile(filePath, "utf-8");
  const data = JSON.parse(raw);
  const list = data?.words;
  if (!Array.isArray(list) || list.length === 0) {
    return [];
  }
  return list.map((item) => {
    if (typeof item === "string") return { en: item };
    const en = String(item?.en ?? "").trim();
    return { en: en || String(item?.slug ?? "") };
  }).filter((w) => w.en);
}

async function main() {
  const jsonPath = process.argv[2];
  let words;

  if (jsonPath) {
    const resolved = path.isAbsolute(jsonPath)
      ? jsonPath
      : path.resolve(process.cwd(), jsonPath);
    if (!fs.existsSync(resolved)) {
      console.error("Файл не найден:", resolved);
      process.exit(1);
    }
    words = await loadWordsFromFile(resolved);
    if (words.length === 0) {
      console.error("В файле нет слов (ожидается { \"words\": [ ... ] })");
      process.exit(1);
    }
    console.log("Слов из файла:", words.length);
  } else {
    await initDb();
    words = await getWordsByLanguage("en");
    if (words.length === 0) {
      console.error("Словарь пуст. Запустите: npm run seed");
      process.exit(1);
    }
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
