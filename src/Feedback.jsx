import { useState, useEffect, useCallback } from "react";
import { ThumbsUp, ThumbsDown, Check, X, Plus, MessageSquare, Trash2, RotateCcw, Pencil, Bell } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { markClosedFeedbackSeen } from "./lib/useCompletedFeedbackCount.js";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

function formatCreatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Feedback({ onBack }) {
  const { user, profile } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [items, setItems] = useState([]);
  const [votes, setVotes] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completingId, setCompletingId] = useState(null);
  const [filter, setFilter] = useState("open");
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [message, setMessage] = useState(null);
  const [lastViewedAt, setLastViewedAt] = useState(0);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !user?.id) { setLoading(false); return; }
    setLoading(true); setMessage(null);
    try {
      const [feedbackResult, votesResult, profilesResult, viewResult] = await Promise.all([
        supabase.from("feedback").select("id, user_id, title, description, status, admin_comment, created_at, closed_at, deleted_at, user_seen_at").order("created_at", { ascending: false }),
        supabase.from("feedback_votes").select("feedback_id, user_id"),
        supabase.from("profiles").select("id, name, icon"),
        supabase.from("user_section_views").select("viewed_at").eq("user_id", user.id).eq("section", "feedback").maybeSingle(),
      ]);
      const firstError = feedbackResult.error || votesResult.error || profilesResult.error || viewResult.error;
      if (firstError) { setItems([]); setVotes([]); setProfiles({}); setMessage({ type: "error", text: `Couldn't load feedback: ${firstError.message || "Unknown database error"}` }); return; }
      const feedbackData = feedbackResult.data || [];
      const previousView = viewResult.data?.viewed_at ? new Date(viewResult.data.viewed_at).getTime() : 0;
      setLastViewedAt(previousView);
      setItems(feedbackData);
      setVotes(votesResult.data || []);
      setProfiles(Object.fromEntries((profilesResult.data || []).map((p) => [p.id, p])));
      const unseenClosed = feedbackData.filter((it) => it.user_id === user?.id && it.status === "closed" && !it.user_seen_at);
      if (unseenClosed.length > 0 && !isAdmin) setFilter("closed");
      const { error: seenError } = await supabase.from("user_section_views").upsert({ user_id: user.id, section: "feedback", viewed_at: new Date().toISOString() });
      if (seenError) { console.error("Unable to mark Feedback as viewed:", seenError); }
      else { window.dispatchEvent(new CustomEvent("feedback-section-seen")); }
      const closedIds = unseenClosed.map((it) => it.id);
      if (closedIds.length) { window.setTimeout(() => markClosedFeedbackSeen(user?.id, closedIds), 500); }
    } catch (error) { setItems([]); setVotes([]); setProfiles({}); setMessage({ type: "error", text: `Couldn't load feedback: ${error?.message || "Unexpected error"}` }); }
    finally { setLoading(false); }
  }, [isAdmin, user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSubmit(e) {
    e.preventDefault(); if (!title.trim() || submitting) return;
    setSubmitting(true); setMessage(null);
    const { error } = await supabase.from("feedback").insert({ user_id: user.id, title: title.trim() });
    setSubmitting(false);
    if (error) { setMessage({ type: "error", text: `Couldn't submit that: ${error.message}` }); return; }
    setTitle(""); setShowForm(false); refresh();
  }

  async function handleUpdate(feedbackId) {
    const nextTitle = editTitle.trim(); if (!nextTitle) return;
    setMessage(null);
    let { error } = await supabase.from("feedback").update({ title: nextTitle, updated_at: new Date().toISOString() }).eq("id", feedbackId).eq("user_id", user.id).eq("status", "open");
    if (error && /updated_at.*schema cache|schema cache.*updated_at/i.test(error.message || "")) { ({ error } = await supabase.from("feedback").update({ title: nextTitle }).eq("id", feedbackId).eq("user_id", user.id).eq("status", "open")); }
    if (error) { setMessage({ type: "error", text: `Couldn't save that edit: ${error.message}` }); return; }
    setEditingId(null); setEditTitle(""); refresh();
  }

  async function toggleVote(feedbackId, alreadyVoted) {
    setMessage(null);
    const { error } = alreadyVoted ? await supabase.from("feedback_votes").delete().eq("feedback_id", feedbackId).eq("user_id", user.id) : await supabase.from("feedback_votes").insert({ feedback_id: feedbackId, user_id: user.id });
    if (error) { setMessage({ type: "error", text: `Couldn't update your vote: ${error.message}` }); return; }
    refresh();
  }

  async function handleClose(feedbackId) { setMessage(null); setCompletingId(feedbackId); const { error } = await supabase.rpc("complete_feedback", { target_feedback_id: feedbackId }); setCompletingId(null); if (error) { setMessage({ type: "error", text: `Couldn't close that: ${error.message}` }); return; } refresh(); }
  async function handleReopen(feedbackId) { setMessage(null); const { error } = await supabase.rpc("reopen_feedback_item", { target_feedback_id: feedbackId }); if (error) { setMessage({ type: "error", text: `Couldn't reopen that: ${error.message}` }); return; } refresh(); }

  async function handleSoftDelete(feedbackId, deleted) {
    if (!isAdmin) return; setMessage(null);
    const { error } = await supabase.from("feedback").update({ deleted_at: deleted ? new Date().toISOString() : null }).eq("id", feedbackId);
    if (error) { setMessage({ type: "error", text: `Couldn't ${deleted ? "delete" : "restore"} that: ${error.message}` }); return; }
    refresh();
  }

  const visible = items.filter((it) => {
    if (it.deleted_at) return isAdmin && filter === "deleted";
    if (filter === "deleted") return false;
    return filter === "all" || it.status === filter;
  });
  const voteCounts = {}; const myVotes = new Set();
  votes.forEach((v) => { voteCounts[v.feedback_id] = (voteCounts[v.feedback_id] || 0) + 1; if (v.user_id === user?.id) myVotes.add(v.feedback_id); });
  const sorted = [...visible].sort((a, b) => (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0));

  const FILTERS = [
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
    { id: "all", label: "All" },
    ...(isAdmin ? [{ id: "deleted", label: "Deleted" }] : []),
  ];

  return (
    <Page>
      <PageHeader title="Feedback" subtitle="suggest something, or upvote what others suggested" onBack={onBack} />

      {!supabaseReady ? (
        <StatusBanner variant="error">Supabase isn't configured yet.</StatusBanner>
      ) : (
        <>
          {message && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant={message.type === "error" ? "error" : "success"} dismissible onDismiss={() => setMessage(null)}>{message.text}</StatusBanner></div>}

          <Button variant={showForm ? "ghost" : "primary"} fullWidth before={<Plus size={15} />} onClick={() => setShowForm((s) => !s)} style={{ marginBottom: "var(--section-gap)" }}>
            {showForm ? "Cancel" : "New feedback"}
          </Button>

          {showForm && (
            <Card as="form" onSubmit={handleSubmit} style={{ marginBottom: "var(--section-gap)", padding: "var(--space-4)" }}>
              <textarea required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's on your mind?" rows={3} maxLength={300}
                style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-3)", fontSize: "var(--text-body-size)", color: "var(--color-text-primary)", background: "var(--color-surface-input)", resize: "none", marginBottom: "var(--space-3)", outline: "none", boxSizing: "border-box" }} />
              <Button variant="primary" fullWidth type="submit" loading={submitting}>Submit</Button>
            </Card>
          )}

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--section-gap)", flexWrap: "wrap" }}>
            {FILTERS.map((f) => (
              <Button key={f.id} variant={filter === f.id ? "primary" : "secondary"} size="sm" onClick={() => setFilter(f.id)}>{f.label}</Button>
            ))}
          </div>

          {loading ? <p style={{ textAlign: "center", padding: "var(--space-8) 0", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>Loading…</p> : sorted.length === 0 ? (
            <p style={{ textAlign: "center", padding: "var(--space-8) 0", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>
              {filter === "open" ? "No suggestions yet" : filter === "closed" ? "No completed items" : filter === "deleted" ? "No deleted items" : "No feedback yet"}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {sorted.map((item) => {
                const feedbackAuthor = profiles[item.user_id];
                const isMine = item.user_id === user?.id;
                const count = voteCounts[item.id] || 0;
                const iVoted = myVotes.has(item.id);
                const hasUnseenClosed = isMine && item.status === "closed" && item.closed_at && new Date(item.closed_at).getTime() > (lastViewedAt || 0);

                return (
                  <Card key={item.id} style={{ padding: "var(--space-4)", borderColor: item.status === "closed" ? "var(--color-success-border)" : undefined }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
                      <span style={{ fontSize: 24, flexShrink: 0 }}>{feedbackAuthor?.icon || "🙂"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }} className="truncate">{feedbackAuthor?.name || "Player"}</span>
                          {isMine && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: "var(--radius-full)", padding: "2px 6px", background: "var(--color-info-bg)", color: "var(--color-primary)" }}>YOU</span>}
                          {item.status === "closed" && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: "var(--radius-full)", padding: "2px 6px", background: "var(--color-success-bg)", color: "var(--color-success-text)" }}>Completed</span>}
                          {hasUnseenClosed && <Bell size={11} style={{ color: "var(--color-primary)" }} />}
                          <span style={{ fontSize: 10, color: "var(--color-text-secondary)", marginLeft: "auto" }}>{formatCreatedAt(item.created_at)}</span>
                        </div>

                        {editingId === item.id ? (
                          <div style={{ marginTop: "var(--space-2)" }}>
                            <textarea value={editTitle} onChange={(e) => setEditTitle(e.target.value)} rows={2}
                              style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2)", fontSize: "var(--text-body-size)", color: "var(--color-text-primary)", background: "var(--color-surface-input)", resize: "none", marginBottom: "var(--space-2)", outline: "none", boxSizing: "border-box" }} />
                            <div style={{ display: "flex", gap: "var(--space-2)" }}>
                              <Button size="sm" variant="primary" onClick={() => handleUpdate(item.id)}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditTitle(""); }}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: "var(--text-body-size)", color: "var(--color-text-primary)", marginTop: "var(--space-1)", wordBreak: "break-word" }}>{item.title}</div>
                        )}

                        {item.admin_comment && (
                          <div style={{ marginTop: "var(--space-2)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)", background: "var(--color-info-bg)", fontSize: "var(--text-caption-size)", color: "var(--color-text-primary)" }}>
                            <strong>Admin:</strong> {item.admin_comment}
                          </div>
                        )}

                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                          <button onClick={() => toggleVote(item.id, iVoted)}
                            style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: "var(--radius-full)", padding: "6px 12px", fontSize: "var(--text-caption-size)", fontWeight: 600, background: iVoted ? "var(--color-primary-subtle)" : "var(--color-surface-elevated)", color: iVoted ? "var(--color-primary)" : "var(--color-text-primary)", border: "1px solid var(--color-border)", cursor: "pointer" }}>
                            <ThumbsUp size={14} fill={iVoted ? "var(--color-primary)" : "none"} /> {count}
                          </button>

                          {isAdmin && item.status === "open" && (
                            <Button size="sm" variant="ghost" loading={completingId === item.id} before={<Check size={14} />} onClick={() => handleClose(item.id)}>Close</Button>
                          )}
                          {isAdmin && item.status === "closed" && (
                            <Button size="sm" variant="ghost" before={<RotateCcw size={14} />} onClick={() => handleReopen(item.id)}>Reopen</Button>
                          )}
                          {isMine && item.status === "open" && !editingId && (
                            <Button size="sm" variant="ghost" before={<Pencil size={14} />} onClick={() => { setEditingId(item.id); setEditTitle(item.title); }}>Edit</Button>
                          )}
                          {isAdmin && (
                            <Button size="sm" variant="ghost" before={<Trash2 size={14} />} onClick={() => handleSoftDelete(item.id, !item.deleted_at)} style={{ color: "var(--color-danger-text)" }}>
                              {item.deleted_at ? "Restore" : "Delete"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
