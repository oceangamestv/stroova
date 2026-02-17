import React, { useMemo, useState } from "react";
import type { AssembleTask } from "../../../domain/exercises/gates/types";

type AssembleWordTaskProps = {
  task: AssembleTask;
  disabled?: boolean;
  onSubmit: (value: string) => void;
};

const AssembleWordTask: React.FC<AssembleWordTaskProps> = ({ task, disabled = false, onSubmit }) => {
  const [value, setValue] = useState("");
  const letters = useMemo(() => task.letters.join(" "), [task.letters]);

  return (
    <div className="gates-task-card">
      <h3 className="gates-task-title">Собери слово</h3>
      <p className="gates-task-subtitle">Перевод: <strong>{task.prompt}</strong></p>
      <p className="gates-task-hint">Буквы: {letters}</p>
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
          placeholder="Введите слово"
          aria-label="Собранное слово"
        />
        <button type="submit" className="primary-btn" disabled={disabled || value.trim().length === 0}>
          Ударить
        </button>
      </form>
    </div>
  );
};

export default AssembleWordTask;
