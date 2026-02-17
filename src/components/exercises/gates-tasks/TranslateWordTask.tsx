import React, { useState } from "react";
import type { TranslateTask } from "../../../domain/exercises/gates/types";

type TranslateWordTaskProps = {
  task: TranslateTask;
  disabled?: boolean;
  onSubmit: (value: string) => void;
};

const TranslateWordTask: React.FC<TranslateWordTaskProps> = ({ task, disabled = false, onSubmit }) => {
  const [value, setValue] = useState("");

  return (
    <div className="gates-task-card">
      <h3 className="gates-task-title">Напиши перевод</h3>
      <p className="gates-task-subtitle">Слово: <strong>{task.prompt}</strong></p>
      <form
        className="gates-task-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) return;
          onSubmit(value);
          setValue("");
        }}
      >
        <input
          type="text"
          className="gates-task-input"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Введите перевод"
          aria-label="Перевод слова"
        />
        <button type="submit" className="primary-btn" disabled={disabled || value.trim().length === 0}>
          Ударить
        </button>
      </form>
    </div>
  );
};

export default TranslateWordTask;
