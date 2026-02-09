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
    setError(null);

    // Если не принудительная загрузка и есть кэш - показываем кэш сразу
    if (!force) {
      const cachedWords = getCachedWords(lang);
      const cachedVersion = getCachedVersion(lang);
      
      if (cachedWords && cachedWords.length > 0) {
        // Показываем кэш сразу для мгновенного отображения
        setWords(cachedWords);
        setLoading(false);
        
        // Проверяем версию параллельно (не блокируем UI)
        if (cachedVersion) {
          dictionaryApi.getVersion(lang)
            .then(({ version: serverVersion }) => {
              if (serverVersion !== cachedVersion) {
                // Версия изменилась - загружаем новые слова
                setLoading(true);
                return Promise.all([
                  dictionaryApi.getWords({ lang }),
                  dictionaryApi.getVersion(lang),
                ]);
              }
              return null;
            })
            .then((results) => {
              if (results) {
                const [data, versionData] = results;
                if (Array.isArray(data) && data.length > 0) {
                  setWords(data);
                  setCachedWords(lang, data);
                  setCachedVersion(lang, versionData.version);
                }
              }
            })
            .catch((versionError) => {
              // Если проверка версии не удалась, оставляем кэш
              console.warn("Не удалось проверить версию словаря:", versionError);
            })
            .finally(() => {
              setLoading(false);
            });
        } else {
          // Если версии нет в кэше, загружаем слова и версию
          setLoading(true);
          try {
            const [data, versionData] = await Promise.all([
              dictionaryApi.getWords({ lang }),
              dictionaryApi.getVersion(lang),
            ]);
            
            if (Array.isArray(data) && data.length > 0) {
              setWords(data);
              setCachedWords(lang, data);
              setCachedVersion(lang, versionData.version);
            }
          } catch (fetchError) {
            console.warn("Не удалось загрузить словарь:", fetchError);
          } finally {
            setLoading(false);
          }
        }
        return;
      }
    }

    // Если нет кэша или принудительная загрузка - загружаем с сервера
    setLoading(true);
    try {
      const [data, versionData] = await Promise.all([
        dictionaryApi.getWords({ lang }),
        dictionaryApi.getVersion(lang),
      ]);
      
      if (Array.isArray(data) && data.length > 0) {
        setWords(data);
        setCachedWords(lang, data);
        setCachedVersion(lang, versionData.version);
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
