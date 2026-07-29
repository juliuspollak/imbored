import { AlertTriangle } from "lucide-react";

const ACCENT = "#2F6FED";

export const REDEMPTION_STATUS_LABEL = {
  requested: { text: "Requested", color: "#B5730E", bg: "rgba(217,148,10,.10)" },
  approved: { text: "Approved", color: "#2F6FED", bg: "rgba(47,111,237,.09)" },
  declined: { text: "Declined", color: "#B5433A", bg: "rgba(181,67,58,.09)" },
  fulfilled: { text: "Delivered", color: "#12946A", bg: "rgba(18,148,106,.09)" },
  disputed: { text: "Disputed", color: "#B5433A", bg: "rgba(181,67,58,.09)" },
  cancelled: { text: "Cancelled", color: "#6B7280", bg: "rgba(107,114,128,.09)" },
};

export function RedemptionStatusPill({ status, fallbackColor = "#1B2129" }) {
  const s = REDEMPTION_STATUS_LABEL[status] || { text: status, color: fallbackColor, bg: "rgba(16,24,40,.06)" };
  return <span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" style={{ color: s.color, background: s.bg }}>{s.text}</span>;
}

export function RedemptionDisputeBanner({ redemption }) {
  if (redemption.status !== "disputed" || !redemption.dispute_reason) return null;
  return (
    <div className="flex items-start gap-1.5 text-xs mb-2 rounded-lg px-2 py-1.5" style={{ background: "rgba(181,67,58,.08)", color: "#B5433A" }}>
      <AlertTriangle size={12} className="shrink-0 mt-0.5" />{redemption.dispute_reason}
    </div>
  );
}

// Approve/decline/deliver/reopen actions for a manager reviewing a
// redemption. onReview(status) should call the review RPC and refresh.
export function RedemptionActions({ status, onReview }) {
  if (status === "requested") {
    return (
      <div className="flex gap-2">
        <button onClick={() => onReview("approved")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(22,163,74,.1)", color: "#166534" }}>Approve</button>
        <button onClick={() => onReview("declined")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(181,67,58,.08)", color: "#B5433A" }}>Decline &amp; refund</button>
      </div>
    );
  }
  if (status === "approved") {
    return <button onClick={() => onReview("fulfilled")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(47,111,237,.09)", color: ACCENT }}>Mark delivered</button>;
  }
  if (status === "disputed") {
    return (
      <div className="flex gap-2">
        <button onClick={() => onReview("fulfilled")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(22,163,74,.1)", color: "#166534" }}>Confirm delivered</button>
        <button onClick={() => onReview("approved")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(47,111,237,.09)", color: ACCENT }}>Reopen for delivery</button>
      </div>
    );
  }
  return null;
}
