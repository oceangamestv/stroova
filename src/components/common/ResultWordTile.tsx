import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Word } from "../../data/contracts/types";
import { personalDictionaryService } from "../../services/personalDictionaryService";

const AnimatedProgressBar: React.FC<{
  progressBefore: number;
  progressAfter: number;
  hadError: boolean;
}> = ({ progressBefore, progressAfter, hadError }) => {
  const [displayProgress, setDisplayProgress] = useState(progressBefore);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDisplayProgress(progressAfter));
    });
    return () => cancelAnimationFrame(id);
  }, [progressAfter]);
  return (
    <div className="puzzle-result-progress-track">
      <div
        className={`puzzle-result-progress-fill ${hadError ? "puzzle-result-progress-fill--decrease" : "puzzle-result-progress-fill--increase"}`}
        style={{ width: `${displayProgress}%` }}
      />
    </div>
  );
};

export type ResultWordTileProps = {
  word: Word;
  progressBefore: number;
  progressAfter: number;
  hadError: boolean;
  /** Показывать звёздочку «добавить/удалить из моего словаря» только для авторизованных */
  isLoggedIn: boolean;
  onDictionaryChange?: () => void;
};

export const ResultWordTile: React.FC<ResultWordTileProps> = ({
  word,
  progressBefore,
  progressAfter,
  hadError,
  isLoggedIn,
  onDictionaryChange,
}) => {
  const [inPersonal, setInPersonal] = useState(() =>
    personalDictionaryService.isInPersonal(word.id)
  );
  const enSpanRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (word.en.length <= 10) return;
    const span = enSpanRef.current;
    const container = span?.parentElement;
    if (!span || !container) return;
    const maxScroll = Math.max(0, span.scrollWidth - container.clientWidth);
    span.style.setProperty("--marquee-scroll", `${maxScroll}px`);
  }, [word.en, word.en.length]);

  const handleToggleDictionary = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLoggedIn) return;
    if (inPersonal) {
      personalDictionaryService.removeWord(word.id);
      setInPersonal(false);
    } else {
      personalDictionaryService.addWord(word.id);
      setInPersonal(true);
    }
    onDictionaryChange?.();
  };

  const enLen = word.en.length;
  const ruLen = word.ru.length;
  const enSizeClass =
    enLen >= 17
      ? " puzzle-result-word-tile-en--extra-long"
      : enLen >= 14
        ? " puzzle-result-word-tile-en--very-long"
        : enLen >= 11
          ? " puzzle-result-word-tile-en--long"
          : enLen >= 8
            ? " puzzle-result-word-tile-en--medium"
            : "";
  const ruSizeClass =
    ruLen >= 14
      ? " puzzle-result-word-tile-ru--very-long"
      : ruLen >= 11
        ? " puzzle-result-word-tile-ru--long"
        : ruLen >= 8
          ? " puzzle-result-word-tile-ru--medium"
          : "";

  return (
    <li
      className={`puzzle-result-word-tile ${hadError ? "puzzle-result-word-tile--error" : "puzzle-result-word-tile--success"}`}
    >
      <div className="puzzle-result-word-tile-main">
        <div className="puzzle-result-word-tile-info">
          <span
            ref={enSpanRef}
            className={`puzzle-result-word-tile-en${enSizeClass}${enLen > 10 ? " puzzle-result-word-tile-en--marquee" : ""}`}
          >
            {word.en}
          </span>
          <span className={`puzzle-result-word-tile-ru${ruSizeClass}`}>
            {word.ru}
          </span>
        </div>
        <div className="puzzle-result-word-tile-progress">
          <span className="puzzle-result-word-tile-percent" aria-hidden>
            {progressBefore}% → {progressAfter}%
          </span>
          <AnimatedProgressBar
            progressBefore={progressBefore}
            progressAfter={progressAfter}
            hadError={hadError}
          />
        </div>
        {isLoggedIn && (
          <button
            type="button"
            className="puzzle-result-word-tile-dict-indicator"
            onClick={handleToggleDictionary}
            title={inPersonal ? "Удалить из моего словаря" : "Добавить в мой словарь"}
            aria-label={inPersonal ? "Удалить из моего словаря" : "Добавить в мой словарь"}
          >
            {inPersonal ? "★" : "☆"}
          </button>
        )}
      </div>
    </li>
  );
};
