/**
 * Хук загрузки словаря из API (слова хранятся в БД).
 * При ошибке или пустом ответе — fallback на статический A0_DICTIONARY.
 * Оптимизирован: использует кэширование в localStorage и проверку версии словаря.
 */

import { useEffect, useState } from "react";
import { dictionaryApi } from "../../api/endpoints";
import { A0_DICTIONARY } from "../../data/dictionary";
import type { Word } from "../../data/contracts/types";

type UseDictionaryResult = {
  words: Word[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

const CACHE_PREFIX = "dictionary_cache_";
const VERSION_PREFIX = "dictionary_version_";

function getCacheKey(lang: string): string {
  return `${CACHE_PREFIX}${lang}`;
}

function getVersionKey(lang: string): string {
  return `${VERSION_PREFIX}${lang}`;
}

function getCachedWords(lang: string): Word[] | null {
  try {
    const cached = localStorage.getItem(getCacheKey(lang));
    if (!cached) return null;
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

function getCachedVersion(lang: string): string | null {
  try {
    return localStorage.getItem(getVersionKey(lang));
  } catch {
    return null;
  }
}

function setCachedWords(lang: string, words: Word[]): void {
  try {
    localStorage.setItem(getCacheKey(lang), JSON.stringify(words));
  } catch (error) {
    console.warn("Не удалось сохранить словарь в кэш:", error);
  }
}

function setCachedVersion(lang: string, version: string): void {
  try {
    localStorage.setItem(getVersionKey(lang), version);
  } catch (error) {
    console.warn("Не удалось сохранить версию словаря в кэш:", error);
  }
}

export function useDictionary(lang = "en"): UseDictionaryResult {
  const [words, setWords] = useState<Word[]>(() => {
    // Инициализируем из кэша, если есть
    const cached = getCachedWords(lang);
    return cached || [];
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWords = async (force = false) => {
    setLoading(true);
    setError(null);

    try {
      // Если не принудительная загрузка, проверяем версию
      if (!force) {
        const cachedVersion = getCachedVersion(lang);
        const cachedWords = getCachedWords(lang);

        if (cachedVersion && cachedWords && cachedWords.length > 0) {
          try {
            // Проверяем версию на сервере
            const { version: serverVersion } = await dictionaryApi.getVersion(lang);
            
            if (serverVersion === cachedVersion) {
              // Версия совпадает - используем кэш
              setWords(cachedWords);
              setLoading(false);
              return;
            }
            // Версия изменилась - загружаем новые слова
          } catch (versionError) {
            // Если проверка версии не удалась, используем кэш как fallback
            console.warn("Не удалось проверить версию словаря, используем кэш:", versionError);
            if (cachedWords && cachedWords.length > 0) {
              setWords(cachedWords);
              setLoading(false);
              return;
            }
          }
        }
      }

      // Загружаем слова с сервера
      const data = await dictionaryApi.getWords({ lang });
      
      if (Array.isArray(data) && data.length > 0) {
        setWords(data);
        setCachedWords(lang, data);
        
        // Получаем и сохраняем версию параллельно (не блокируем UI)
        dictionaryApi.getVersion(lang)
          .then(({ version }) => {
            setCachedVersion(lang, version);
          })
          .catch((versionError) => {
            console.warn("Не удалось получить версию словаря:", versionError);
          });
      } else {
        setWords(A0_DICTIONARY);
      }
    } catch (fetchError) {
      // При ошибке используем кэш, если есть
      const cachedWords = getCachedWords(lang);
      if (cachedWords && cachedWords.length > 0) {
        setWords(cachedWords);
        setError("Словарь загружен из кэша (нет подключения к серверу).");
      } else {
        setWords(A0_DICTIONARY);
        setError("Словарь загружен из резерва (запустите seed на сервере).");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return { words, loading, error, refetch: () => fetchWords(true) };
}
