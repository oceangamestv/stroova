import React from "react";

type ResultModalProps = {
  isOpen: boolean;
  title: string;
  text: string;
  onClose: () => void;
};

const ResultModal: React.FC<ResultModalProps> = ({ isOpen, title, text, onClose }) => {
  if (!isOpen) return null;
  return (
    <div className="modal">
      <div className="modal-content">
        <h2>{title}</h2>
        <p>{text}</p>
        <button className="primary-btn" onClick={onClose} type="button">
          Продолжить
        </button>
      </div>
    </div>
  );
};

export default ResultModal;
