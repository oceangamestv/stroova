/**
 * Хук загрузки словаря из API (слова хранятся в БД).
 * При ошибке или пустом ответе — fallback на статический A0_DICTIONARY.
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

export function useDictionary(lang = "en"): UseDictionaryResult {
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWords = () => {
    setLoading(true);
    setError(null);
    dictionaryApi
      .getWords({ lang })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setWords(data);
        } else {
          setWords(A0_DICTIONARY);
        }
      })
      .catch(() => {
        setWords(A0_DICTIONARY);
        setError("Словарь загружен из резерва (запустите seed на сервере).");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchWords();
  }, [lang]);

  return { words, loading, error, refetch: fetchWords };
}
