import React from "react";
import "./day-selector.css";

export default function DaySelector({ days, value, onChange, ariaLabel = "Choose practice day" }) {
  return (
    <div className="day-selector" role="group" aria-label={ariaLabel}>
      {days.map((day, index) => {
        const active = index === value;
        return (
          <button
            key={`${day}-${index}`}
            type="button"
            onClick={() => onChange(index)}
            className={`day-selector__button${active ? " is-active" : ""}`}
            aria-pressed={active}
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}
