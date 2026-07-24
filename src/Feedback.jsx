import { useState, useEffect, useCallback } from "react";
import { ThumbsUp, Check, X, Plus, MessageSquare, ArrowLeft, Trash2, RotateCcw, Pencil, Bell } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { markClosedFeedbackSeen } from "./lib/useCompletedFeedbackCount.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const GREEN = "#16A34A";

function formatCreatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Feedback({ onBack }) {
  const { user, profile } = useAuth();
  const isAdmin = !!profile?.is_admin;

  const [items, setItems] = useState([]);
  const [votes, setVotes] = useState([]); // all feedback_votes rows
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completingId, setCompletingId] = useState(null);
  const [filter, setFilter] = useState("open"); // open | closed | all | deleted
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [message, setMessage] = useState(null);
  const [lastViewedAt, setLastViewedAt] = useState(0);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);

    try {
      const [feedbackResult, votesResult, profilesResult, viewResult] = await Promise.all([
        supabase
          .from("feedback")
          .select("id, user_id, title, description, status, admin_comment, created_at, closed_at, deleted_at, user_seen_at")
          .order("created_at", { ascending: false }),
        supabase.from("feedback_votes").select("feedback_id, user_id"),
        supabase.from("profiles").select("id, name, icon"),
        supabase.from("user_section_views").select("viewed_at").eq("user_id", user.id).eq("section", "feedback").maybeSingle(),
      ]);

      const firstError = feedbackResult.error || votesResult.error || profilesResult.error || viewResult.error;
      if (firstError) {
        console.error("Unable to load feedback page:", firstError);
        setItems([]);
        setVotes([]);
        setProfiles({});
        setMessage({ type: "error", text: `Couldn't load feedback: ${firstError.message || "Unknown database error"}` });
        return;
      }

      const feedbackData = feedbackResult.data || [];
      const previousView = viewResult.data?.viewed_at ? new Date(viewResult.data.viewed_at).getTime() : 0;
      setLastViewedAt(previousView);
      setItems(feedbackData);
      setVotes(votesResult.data || []);
      setProfiles(Object.fromEntries((profilesResult.data || []).map((p) => [p.id, p])));

      const unseenClosed = feedbackData.filter(
        (it) => it.user_id === user?.id && it.status === "closed" && !it.user_seen_at
      );
      if (unseenClosed.length > 0 && !isAdmin) setFilter("closed");

      const { error: seenError } = await supabase
        .from("user_section_views")
        .upsert({ user_id: user.id, section: "feedback", viewed_at: new Date().toISOString() });
      if (seenError) {
        console.error("Unable to mark Feedback as viewed:", seenError);
      } else {
        window.dispatchEvent(new CustomEvent("feedback-section-seen"));
      }
      const closedIds = unseenClosed.map((it) => it.id);
      if (closedIds.length) {
        window.setTimeout(() => markClosedFeedbackSeen(user?.id, closedIds), 500);
      }
    } catch (error) {
      console.error("Unexpected feedback loading error:", error);
      setItems([]);
      setVotes([]);
      setProfiles({});
      setMessage({ type: "error", text: `Couldn't load feedback: ${error?.message || "Unexpected error"}` });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setMessage(null);
    const { error } = await supabase.from("feedback").insert({ user_id: user.id, title: title.trim() });
    setSubmitting(false);
    if (error) {
      setMessage({ type: "error", text: `Couldn't submit that: ${error.message}` });
      return;
    }
    setTitle("");
    setShowForm(false);
    refresh();
  }

  async function handleUpdate(feedbackId) {
    const nextTitle = editTitle.trim();
    if (!nextTitle) return;
    setMessage(null);
    let { error } = await supabase
      .from("feedback")
      .update({ title: nextTitle, updated_at: new Date().toISOString() })
      .eq("id", feedbackId)
      .eq("user_id", user.id)
      .eq("status", "open");

    // Older deployments may not have refreshed PostgREST's schema cache yet.
    // The title edit itself does not depend on updated_at, so retry without it
    // rather than blocking the player while the v70 migration is applied.
    if (error && /updated_at.*schema cache|schema cache.*updated_at/i.test(error.message || "")) {
      ({ error } = await supabase
        .from("feedback")
        .update({ title: nextTitle })
        .eq("id", feedbackId)
        .eq("user_id", user.id)
        .eq("status", "open"));
    }
    if (error) {
      setMessage({ type: "error", text: `Couldn't save that edit: ${error.message}` });
      return;
    }
    setEditingId(null);
    setEditTitle("");
    refresh();
  }

  async function toggleVote(feedbackId, alreadyVoted) {
    setMessage(null);
    const { error } = alreadyVoted
      ? await supabase.from("feedback_votes").delete().eq("feedback_id", feedbackId).eq("user_id", user.id)
      : await supabase.from("feedback_votes").insert({ feedback_id: feedbackId, user_id: user.id });
    if (error) {
      setMessage({ type: "error", text: `Couldn't update your vote: ${error.message}` });
      return;
    }
    refresh();
  }

  async function handleClose(feedbackId) {
    setMessage(null);
    setCompletingId(feedbackId);
    const { error } = await supabase
      .from("feedback")
      .update({ status: "closed", admin_comment: null, closed_at: new Date().toISOString() })
      .eq("id", feedbackId);
    setCompletingId(null);
    if (error) {
      setMessage({ type: "error", text: `Couldn't close that: ${error.message}` });
      return;
    }
    refresh();
  }

  async function handleReopen(feedbackId) {
    setMessage(null);
    const { error } = await supabase.from("feedback").update({ status: "open", admin_comment: null, closed_at: null }).eq("id", feedbackId);
    if (error) {
      setMessage({ type: "error", text: `Couldn't reopen that: ${error.message}` });
      return;
    }
    refresh();
  }

  async function handleSoftDelete(feedbackId, deleted) {
    if (!isAdmin) return;
    setMessage(null);
    const { error } = await supabase
      .from("feedback")
      .update({ deleted_at: deleted ? new Date().toISOString() : null })
      .eq("id", feedbackId);
    if (error) {
      setMessage({ type: "error", text: `Couldn't ${deleted ? "delete" : "restore"} that: ${error.message}` });
      return;
    }
    refresh();
  }

  const visible = items.filter((it) => {
    if (it.deleted_at) return isAdmin && filter === "deleted";
    if (filter === "deleted") return false;
    return filter === "all" || it.status === filter;
  });
  const voteCounts = {};
  const myVotes = new Set();
  votes.forEach((v) => {
    voteCounts[v.feedback_id] = (voteCounts[v.feedback_id] || 0) + 1;
    if (v.user_id === user?.id) myVotes.add(v.feedback_id);
  });
  const sorted = [...visible].sort((a, b) => (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0));

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="nav-btn flex items-center justify-center rounded-full"
            style={{ "--nav-glow": "rgba(47,111,237,0.3)", "--nav-border": "rgba(47,111,237,0.4)", color: INK, background: "rgba(16,24,40,0.05)", width: 34, height: 34 }}
            aria-label="Back to home"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK }} className="text-2xl">
            Feedback
          </h1>
        </div>
        <p style={{ color: INK, opacity: 0.45 }} className="text-xs mb-4 ml-9">
          suggest something, or upvote what others suggested
        </p>

        {!supabaseReady ? (
          <div className="text-xs rounded-lg p-3" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            Supabase isn't configured yet.
          </div>
        ) : (
          <>
            {message && (
              <div
                className="text-xs rounded-lg p-3 mb-4 flex items-center justify-between gap-2"
                style={{
                  background: message.type === "error" ? "rgba(217,105,92,0.1)" : "rgba(22,163,74,0.1)",
                  color: message.type === "error" ? "#B5433A" : "#15803D",
                }}
              >
                <span>{message.text}</span>
                <button onClick={() => setMessage(null)} aria-label="Dismiss"><X size={13} /></button>
              </div>
            )}
            <button
              onClick={() => setShowForm((s) => !s)}
              className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold mb-4"
              style={{ background: showForm ? "rgba(16,24,40,0.06)" : ACCENT, color: showForm ? INK : "#FFFFFF" }}
            >
              <Plus size={15} />
              {showForm ? "Cancel" : "New feedback"}
            </button>

            {showForm && (
              <form onSubmit={handleSubmit} className="rounded-2xl p-4 mb-4" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)" }}>
                <textarea
                  required
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={3}
                  maxLength={300}
                  className="w-full rounded-lg px-3 py-2 text-sm mb-3 outline-none resize-none"
                  style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg py-2 text-sm font-semibold"
                  style={{ background: ACCENT, color: "#FFFFFF", opacity: submitting ? 0.7 : 1 }}
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </form>
            )}

            <div className="flex gap-1.5 mb-4">
              {["open", "closed", "all", ...(isAdmin ? ["deleted"] : [])].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="rounded-full px-3 py-1 text-xs font-medium capitalize"
                  style={{
                    background: filter === f ? INK : "rgba(16,24,40,0.06)",
                    color: filter === f ? "#FFFFFF" : INK,
                  }}
                >
                  {f}
                </button>
              ))}
            </div>

            {loading ? (
              <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
            ) : sorted.length === 0 ? (
              <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Nothing here yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sorted.map((it) => {
                  const author = profiles[it.user_id];
                  const count = voteCounts[it.id] || 0;
                  const voted = myVotes.has(it.id);
                  const createdAt = formatCreatedAt(it.created_at);
                  return (
                    <div key={it.id} className="rounded-2xl p-3.5 flex gap-3" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)" }}>
                      <button
                        onClick={() => toggleVote(it.id, voted)}
                        className="flex flex-col items-center justify-center rounded-lg px-2.5 py-1.5 flex-shrink-0"
                        style={{ background: voted ? "rgba(47,111,237,0.12)" : "rgba(16,24,40,0.05)", height: "fit-content" }}
                      >
                        <ThumbsUp size={13} style={{ color: voted ? ACCENT : INK, opacity: voted ? 1 : 0.4 }} />
                        <span style={{ color: voted ? ACCENT : INK, opacity: voted ? 1 : 0.5, fontWeight: 700 }} className="text-xs mt-0.5">{count}</span>
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {editingId === it.id ? (
                            <div className="flex-1 rounded-2xl p-3" style={{background:"rgba(47,111,237,.05)",border:"1px solid rgba(47,111,237,.16)"}}>
                              <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{color:ACCENT}}>Update your feedback</div>
                              <textarea autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} rows={3} maxLength={300} className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none" style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK, background:PANEL }} />
                              <div className="flex justify-end gap-2 mt-2">
                                <button onClick={() => { setEditingId(null); setEditTitle(""); }} className="rounded-lg px-3 py-1.5 text-xs" style={{ color: INK, background:"rgba(16,24,40,.06)" }}>Cancel</button>
                                <button onClick={() => handleUpdate(it.id)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: ACCENT }}>Save changes</button>
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: INK, fontWeight: 600 }} className="text-sm">{it.title}{new Date(it.created_at).getTime() > lastViewedAt && <span className="ml-1 rounded-full px-2 py-0.5 text-[9px]" style={{background:"rgba(47,111,237,.12)",color:ACCENT}}>NEW</span>}</span>
                          )}
                          {it.status === "closed" && !it.deleted_at && (
                            <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5" style={{ background: "rgba(22,163,74,0.12)", color: GREEN }}>
                              <Check size={9} />
                              <span className="text-[9px] font-semibold uppercase">Done</span>
                            </span>
                          )}
                          {it.deleted_at && (
                            <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5" style={{ background: "rgba(181,67,58,0.12)", color: "#B5433A" }}>
                              <Trash2 size={9} />
                              <span className="text-[9px] font-semibold uppercase">Deleted</span>
                            </span>
                          )}
                        </div>
                        {it.description && (
                          <p style={{ color: INK, opacity: 0.6 }} className="text-xs mt-0.5">{it.description}</p>
                        )}
                        <p style={{ color: INK, opacity: 0.35 }} className="text-[10px] mt-1">
                          {author?.icon || "🙂"} {author?.name || "Someone"}
                          {createdAt ? ` · ${createdAt}` : ""}
                        </p>

                        {it.admin_comment && (
                          <div className="flex items-start gap-1.5 rounded-lg px-2 py-1.5 mt-2" style={{ background: "rgba(22,163,74,0.06)" }}>
                            <MessageSquare size={11} style={{ color: GREEN, marginTop: 2, flexShrink: 0 }} />
                            <span style={{ color: INK, opacity: 0.7 }} className="text-xs">{it.admin_comment}</span>
                          </div>
                        )}

                        {it.user_id === user?.id && it.status === "open" && !it.deleted_at && editingId !== it.id && (
                          <button onClick={() => { setEditingId(it.id); setEditTitle(it.title); }} className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ color: ACCENT, background:"rgba(47,111,237,.09)", border:"1px solid rgba(47,111,237,.16)" }}>
                            <Pencil size={12} /> Make changes
                          </button>
                        )}
                        {it.user_id === user?.id && it.status === "closed" && (
                          <div className="mt-2 flex items-center gap-1 text-[10px] font-medium" style={{ color: GREEN }}>
                            <Bell size={11} /> You were notified when this was completed
                          </div>
                        )}

                        {isAdmin && (
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            {it.deleted_at ? (
                              <button onClick={() => handleSoftDelete(it.id, false)} className="flex items-center gap-1 text-xs font-medium" style={{ color: ACCENT }}>
                                <RotateCcw size={12} /> Restore
                              </button>
                            ) : it.status === "open" ? (
                              <button
                                disabled={completingId === it.id}
                                onClick={() => handleClose(it.id)}
                                className="flex items-center gap-1 text-xs font-medium disabled:opacity-45"
                                style={{ color: GREEN }}
                              >
                                <Check size={12} /> {completingId === it.id ? "Marking…" : "Mark done"}
                              </button>
                            ) : (
                              <button onClick={() => handleReopen(it.id)} className="flex items-center gap-1 text-xs font-medium" style={{ color: INK, opacity: 0.5 }}>
                                <X size={12} /> Reopen
                              </button>
                            )}
                            {!it.deleted_at && (
                              <button onClick={() => handleSoftDelete(it.id, true)} className="flex items-center gap-1 text-xs font-medium" style={{ color: "#B5433A" }}>
                                <Trash2 size={12} /> Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
