import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ThumbsUp, Check, X, Plus, MessageSquare, Home } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const GREEN = "#16A34A";

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
  const [closingId, setClosingId] = useState(null);
  const [closeComment, setCloseComment] = useState("");
  const [filter, setFilter] = useState("open"); // 'open' | 'closed' | 'all'

  const refresh = useCallback(async () => {
    if (!supabaseReady) return;
    setLoading(true);
    const [{ data: feedbackData }, { data: votesData }, { data: profilesData }] = await Promise.all([
      supabase.from("feedback").select("*").order("created_at", { ascending: false }),
      supabase.from("feedback_votes").select("feedback_id, user_id"),
      supabase.from("profiles").select("id, name, icon"),
    ]);
    setItems(feedbackData || []);
    setVotes(votesData || []);
    setProfiles(Object.fromEntries((profilesData || []).map((p) => [p.id, p])));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    await supabase.from("feedback").insert({ user_id: user.id, title: title.trim() });
    setSubmitting(false);
    setTitle("");
    setShowForm(false);
    refresh();
  }

  async function toggleVote(feedbackId, alreadyVoted) {
    if (alreadyVoted) {
      await supabase.from("feedback_votes").delete().eq("feedback_id", feedbackId).eq("user_id", user.id);
    } else {
      await supabase.from("feedback_votes").insert({ feedback_id: feedbackId, user_id: user.id });
    }
    refresh();
  }

  async function handleClose(feedbackId) {
    await supabase
      .from("feedback")
      .update({ status: "closed", admin_comment: closeComment.trim() || null, closed_at: new Date().toISOString() })
      .eq("id", feedbackId);
    setClosingId(null);
    setCloseComment("");
    refresh();
  }

  async function handleReopen(feedbackId) {
    await supabase.from("feedback").update({ status: "open", admin_comment: null, closed_at: null }).eq("id", feedbackId);
    refresh();
  }

  const visible = items.filter((it) => filter === "all" || it.status === filter);
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
            className="nav-btn flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1.5"
            style={{ "--nav-glow": "rgba(47,111,237,0.3)", "--nav-border": "rgba(47,111,237,0.4)", color: INK, background: "rgba(16,24,40,0.05)" }}
          >
            <Home size={15} />
            <span className="text-xs font-medium">Home</span>
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
              {["open", "closed", "all"].map((f) => (
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
                          <span style={{ color: INK, fontWeight: 600 }} className="text-sm">{it.title}</span>
                          {it.status === "closed" && (
                            <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5" style={{ background: "rgba(22,163,74,0.12)", color: GREEN }}>
                              <Check size={9} />
                              <span className="text-[9px] font-semibold uppercase">Done</span>
                            </span>
                          )}
                        </div>
                        {it.description && (
                          <p style={{ color: INK, opacity: 0.6 }} className="text-xs mt-0.5">{it.description}</p>
                        )}
                        <p style={{ color: INK, opacity: 0.35 }} className="text-[10px] mt-1">
                          {author?.icon || "🙂"} {author?.name || "Someone"}
                        </p>

                        {it.admin_comment && (
                          <div className="flex items-start gap-1.5 rounded-lg px-2 py-1.5 mt-2" style={{ background: "rgba(22,163,74,0.06)" }}>
                            <MessageSquare size={11} style={{ color: GREEN, marginTop: 2, flexShrink: 0 }} />
                            <span style={{ color: INK, opacity: 0.7 }} className="text-xs">{it.admin_comment}</span>
                          </div>
                        )}

                        {isAdmin && (
                          <div className="mt-2">
                            {it.status === "open" ? (
                              closingId === it.id ? (
                                <div className="flex flex-col gap-1.5">
                                  <input
                                    value={closeComment}
                                    onChange={(e) => setCloseComment(e.target.value)}
                                    placeholder="Optional comment"
                                    className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                                    style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
                                  />
                                  <div className="flex gap-2">
                                    <button onClick={() => handleClose(it.id)} className="text-xs font-medium" style={{ color: GREEN }}>
                                      Confirm close
                                    </button>
                                    <button onClick={() => setClosingId(null)} style={{ color: INK, opacity: 0.4 }} className="text-xs">
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setClosingId(it.id)}
                                  className="flex items-center gap-1 text-xs font-medium"
                                  style={{ color: GREEN }}
                                >
                                  <Check size={12} /> Mark done
                                </button>
                              )
                            ) : (
                              <button onClick={() => handleReopen(it.id)} className="flex items-center gap-1 text-xs font-medium" style={{ color: INK, opacity: 0.5 }}>
                                <X size={12} /> Reopen
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
