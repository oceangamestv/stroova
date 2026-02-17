import React from "react";
import type { FillGapTask as FillGapTaskType } from "../../../domain/exercises/gates/types";

type FillGapTaskProps = {
  task: FillGapTaskType;
  disabled?: boolean;
  onSubmit: (value: string) => void;
};

const FillGapTask: React.FC<FillGapTaskProps> = ({ task, disabled = false, onSubmit }) => {
  return (
    <div className="gates-task-card">
      <h3 className="gates-task-title">Подставь слово</h3>
      <p className="gates-task-subtitle gates-task-sentence">{task.sentence}</p>
      <div className="gates-options-grid" role="group" aria-label="Варианты ответа">
        {task.options.map((option) => (
          <button
            key={option}
            type="button"
            className="gates-option-btn"
            disabled={disabled}
            onClick={() => onSubmit(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FillGapTask;
