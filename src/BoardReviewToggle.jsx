import { useState } from "react";
import { ChevronDown } from "lucide-react";
import "./board-review-toggle.css";

// Once a board game is solved, its board has nothing left to do (every
// handler already no-ops once `solved` is true) but still costs a full
// screen's worth of scroll if always shown. Collapse it behind a toggle so
// the result panel is the first and, for most players, only thing visible -
// while anyone who wants to check their finished board can still open it.
export default function BoardReviewToggle({ children, openLabel = "Review your board", closeLabel = "Hide board" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="board-review">
      <button
        type="button"
        className="board-review-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{open ? closeLabel : openLabel}</span>
        <ChevronDown size={14} />
      </button>
      {open && <div className="board-review-panel">{children}</div>}
    </div>
  );
}
