/**
 * IndexedDB хранилище для предгенерированных аудио файлов
 * Ключ: `${word.toLowerCase()}|${voice}|${accent}`
 * Значение: ArrayBuffer аудио данных
 */

const DB_NAME = "stroova_audio_db";
const DB_VERSION = 1;
const STORE_NAME = "audio_cache";

let db: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase> | null = null;

/** Инициализация IndexedDB */
const initDB = (): Promise<IDBDatabase> => {
  if (db) return Promise.resolve(db);
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not supported"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbInitPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });

  return dbInitPromise;
};

/** Сохранение аудио в IndexedDB */
export const saveAudio = async (
  word: string,
  voice: string,
  accent: string,
  audioBuffer: ArrayBuffer
): Promise<void> => {
  try {
    const database = await initDB();
    const key = `${word.toLowerCase()}|${voice}|${accent}`;
    const transaction = database.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.put(audioBuffer, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to save audio to IndexedDB:", error);
  }
};

/** Загрузка аудио из IndexedDB */
export const loadAudio = async (
  word: string,
  voice: string,
  accent: string
): Promise<ArrayBuffer | null> => {
  try {
    const database = await initDB();
    const key = `${word.toLowerCase()}|${voice}|${accent}`;
    const transaction = database.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    return new Promise<ArrayBuffer | null>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to load audio from IndexedDB:", error);
    return null;
  }
};

/** Проверка наличия аудио в IndexedDB */
export const hasAudio = async (
  word: string,
  voice: string,
  accent: string
): Promise<boolean> => {
  const audio = await loadAudio(word, voice, accent);
  return audio !== null;
};

/** Получение статистики кэша */
export const getCacheStats = async (): Promise<{ total: number }> => {
  try {
    const database = await initDB();
    const transaction = database.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => {
        resolve({ total: request.result });
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to get cache stats:", error);
    return { total: 0 };
  }
};

/** Очистка всего кэша */
export const clearCache = async (): Promise<void> => {
  try {
    const database = await initDB();
    const transaction = database.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to clear cache:", error);
  }
};
