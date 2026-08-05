import { useCallback, useEffect, useState } from "react";
import { Flag, ShieldBan, Check, X } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

// App Store guideline 1.2 asks for a reporting mechanism *with timely
// responses*. report_content() was already writing reports, but nothing read
// them, so they accumulated unseen — the queue is the half that makes the
// commitment real.
const REASON_LABELS = {
  harassment: "Harassment or bullying",
  abuse: "Abusive or hateful language",
  sexual: "Sexual or inappropriate content",
  spam: "Spam or scam",
  other: "Something else",
};

function timeAgo(value) {
  const ms = Date.now() - new Date(value).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminReports({ onBack }) {
  const { profile, adminAccountAction } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_content_reports");
    setLoading(false);
    if (error) { setMessage({ type: "error", text: error.message || "Reports could not be loaded." }); return; }
    setReports(data || []);
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  async function resolve(id, status) {
    setBusyId(id);
    setMessage(null);
    const { error } = await supabase.rpc("admin_resolve_content_report", { target_report_id: id, new_status: status });
    setBusyId(null);
    if (error) { setMessage({ type: "error", text: error.message || "Could not update that report." }); return; }
    refresh();
  }

  async function blockReported(report) {
    setBusyId(report.id);
    setMessage(null);
    const { error } = await adminAccountAction("block", report.reported_user_id);
    setBusyId(null);
    if (error) { setMessage({ type: "error", text: error.message || "Could not block that player." }); return; }
    setMessage({ type: "success", text: `${report.reported_name || "That player"} is blocked.` });
    resolve(report.id, "actioned");
  }

  if (!isAdmin) {
    return (
      <Page>
        <PageHeader title="Reports" onBack={onBack} />
        <Card style={{ textAlign: "center", padding: "var(--space-8)" }}>
          <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Admin access required</div>
        </Card>
      </Page>
    );
  }

  const open = reports.filter((report) => report.status === "open");
  const closed = reports.filter((report) => report.status !== "open");

  return (
    <Page>
      <PageHeader title="Reports" onBack={onBack} />

      {message && <StatusBanner variant={message.type === "error" ? "error" : "success"} style={{ marginBottom: "var(--space-3)" }}>{message.text}</StatusBanner>}

      {loading && <Card style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--color-text-secondary)" }}>Loading reports…</Card>}

      {!loading && reports.length === 0 && (
        <Card style={{ textAlign: "center", padding: "var(--space-6)" }}>
          <Flag size={22} style={{ color: "var(--color-text-muted)" }} />
          <div style={{ marginTop: "var(--space-2)", fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Nothing reported</div>
          <div style={{ marginTop: "var(--space-1)", fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>
            Reports players send from a chat appear here.
          </div>
        </Card>
      )}

      {!loading && open.length > 0 && (
        <>
          <div style={{ margin: "0 4px var(--space-2)", fontSize: "var(--text-caption-size)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--color-danger-text)" }}>
            Needs review · {open.length}
          </div>
          {open.map((report) => (
            <ReportCard key={report.id} report={report} busy={busyId === report.id} onResolve={resolve} onBlock={blockReported} />
          ))}
        </>
      )}

      {!loading && closed.length > 0 && (
        <>
          <div style={{ margin: "var(--space-5) 4px var(--space-2)", fontSize: "var(--text-caption-size)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--color-text-secondary)" }}>
            Handled
          </div>
          {closed.map((report) => (
            <ReportCard key={report.id} report={report} busy={busyId === report.id} onResolve={resolve} onBlock={blockReported} />
          ))}
        </>
      )}
    </Page>
  );
}

function ReportCard({ report, busy, onResolve, onBlock }) {
  const isOpen = report.status === "open";
  return (
    <Card style={{ marginBottom: "var(--space-3)", borderLeft: isOpen ? "3px solid var(--color-danger-text)" : undefined }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }}>
          {REASON_LABELS[report.reason] || report.reason}
        </strong>
        <span style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>{timeAgo(report.created_at)}</span>
        {!isOpen && (
          <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: report.status === "actioned" ? "var(--color-success-text)" : "var(--color-text-muted)" }}>
            {report.status}
          </span>
        )}
      </div>

      <div style={{ marginTop: "var(--space-1)", fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>
        {report.reporter_name || "Someone"} reported {report.reported_name || "a player"}
      </div>

      {report.message_body && (
        <blockquote style={{ margin: "var(--space-2) 0 0", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-sm)", background: "var(--color-surface-elevated)", fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-primary)" }}>
          {report.message_body}
        </blockquote>
      )}

      {report.details && (
        <div style={{ marginTop: "var(--space-2)", fontSize: "var(--text-caption-size)", fontStyle: "italic", color: "var(--color-text-secondary)" }}>
          “{report.details}”
        </div>
      )}

      {isOpen && (
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
          {report.reported_user_id && (
            <Button variant="danger" size="sm" loading={busy} before={<ShieldBan size={14} />} onClick={() => onBlock(report)}>
              Block player
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} before={<Check size={14} />} onClick={() => onResolve(report.id, "actioned")}>
            Mark handled
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} before={<X size={14} />} onClick={() => onResolve(report.id, "dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
    </Card>
  );
}
