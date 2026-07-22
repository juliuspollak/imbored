import { useState, useEffect, useCallback } from "react";
import { Home, Sparkles, ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const GREEN = "#16A34A";
const RED = "#B5433A";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Mostly read-only — entries come from CHANGELOG.json in the repo, synced
// automatically by a GitHub Action on every push. The one thing anyone can
// do here is react: thumbs up if it's working, thumbs down (with an
// optional note) if it isn't — a thumbs-down automatically creates an
// entry on the Feedback board too, so it's actually actionable instead of
// a silent downvote nobody follows up on.
export default function ReleaseNotes({ onBack }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [reactions, setReactions] = useState([]); // all rows: release_note_id, user_id, reaction
  const [loading, setLoading] = useState(true);
  const [reportingId, setReportingId] = useState(null); // release note currently showing the "what's wrong" box
  const [reportText, setReportText] = useState("");
  const [justReported, setJustReported] = useState(null); // release note id that was just sent to feedback
  const [savingReactionId, setSavingReactionId] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: notesData }, { data: reactionsData }] = await Promise.all([
      supabase.from("release_notes").select("*"),
      supabase.from("release_note_reactions").select("*"),
    ]);
    // sort by version number, not created_at — created_at gets recomputed
    // on every sync run (see the workflow), so it drifts relative to
    // "whenever the Action happened to run" rather than staying fixed at
    // when each entry actually happened. version is a plain integer I set
    // once per entry and it never changes, so it's the reliable ordering.
    const sorted = [...(notesData || [])].sort((a, b) => {
      const va = parseInt((a.version || "v0").replace("v", ""), 10) || 0;
      const vb = parseInt((b.version || "v0").replace("v", ""), 10) || 0;
      return vb - va;
    });
    setNotes(sorted);
    setReactions(reactionsData || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function setReaction(noteId, reaction) {
    if (!user || savingReactionId === noteId) return;

    const previousReactions = reactions;
    const mine = reactions.find((r) => r.release_note_id === noteId && r.user_id === user.id);
    const isUntick = mine?.reaction === reaction;

    // Update immediately while the atomic database function saves the change.
    setReactions((current) => {
      const withoutMine = current.filter(
        (r) => !(r.release_note_id === noteId && r.user_id === user.id),
      );
      if (isUntick) return withoutMine;
      return [...withoutMine, { release_note_id: noteId, user_id: user.id, reaction }];
    });

    if (reaction === "down" && !isUntick) {
      setReportingId(noteId);
      setReportText("");
    } else if (isUntick || reaction === "up") {
      setReportingId((current) => (current === noteId ? null : current));
    }

    setSavingReactionId(noteId);
    const { data, error } = await supabase.rpc("toggle_release_note_reaction", {
      target_release_note_id: noteId,
      target_reaction: reaction,
    });

    if (error) {
      console.error("Unable to save release-note reaction:", error);
      setReactions(previousReactions);
    } else {
      // Use the database result as the final source of truth for this user's vote.
      const savedReaction = data?.[0]?.user_reaction ?? null;
      setReactions((current) => {
        const withoutMine = current.filter(
          (r) => !(r.release_note_id === noteId && r.user_id === user.id),
        );
        if (!savedReaction) return withoutMine;
        return [...withoutMine, {
          release_note_id: noteId,
          user_id: user.id,
          reaction: savedReaction,
        }];
      });
    }
    setSavingReactionId(null);
  }

  async function submitReport(note) {
    if (!user) return;
    await supabase.from("feedback").insert({
      user_id: user.id,
      title: reportText.trim() || `Not working: ${note.title}`,
    });
    setReportingId(null);
    setJustReported(note.id);
    setTimeout(() => setJustReported((id) => (id === note.id ? null : id)), 3000);
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            className="nav-btn flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1.5"
            style={{ "--nav-glow": "rgba(47,111,237,0.3)", "--nav-border": "rgba(47,111,237,0.4)", color: INK, background: "rgba(16,24,40,0.05)" }}
          >
            <Home size={15} />
            <span className="text-xs font-medium">Home</span>
          </button>
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK }} className="text-2xl">
            What's New
          </h1>
        </div>

        {!supabaseReady ? (
          <div className="text-xs rounded-lg p-3" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            Supabase isn't configured yet.
          </div>
        ) : loading ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
        ) : notes.length === 0 ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Nothing posted yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {notes.map((n) => {
              const noteReactions = reactions.filter((r) => r.release_note_id === n.id);
              const upCount = noteReactions.filter((r) => r.reaction === "up").length;
              const downCount = noteReactions.filter((r) => r.reaction === "down").length;
              const mine = noteReactions.find((r) => r.user_id === user?.id)?.reaction;
              const isReporting = reportingId === n.id;

              return (
                <div key={n.id} className="rounded-2xl p-4" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)" }}>
                  <div className="flex items-start gap-2">
                    <Sparkles size={14} style={{ color: ACCENT, marginTop: 2, flexShrink: 0 }} />
                    <div className="flex-1">
                      <div style={{ color: INK, fontWeight: 600 }} className="text-sm">{n.title}</div>
                      {n.body && <p style={{ color: INK, opacity: 0.6 }} className="text-xs mt-1">{n.body}</p>}
                      <div className="flex items-center gap-2 mt-2">
                        {n.version && (
                          <span
                            style={{ background: "rgba(47,111,237,0.1)", color: ACCENT, fontWeight: 700 }}
                            className="text-[10px] rounded-full px-1.5 py-0.5"
                          >
                            {n.version}
                          </span>
                        )}
                        <span style={{ color: INK, opacity: 0.35 }} className="text-[10px]">{fmtDate(n.created_at)}</span>

                        <div className="flex items-center gap-1 ml-auto">
                          <button
                            onClick={() => setReaction(n.id, "up")}
                            disabled={savingReactionId === n.id}
                            aria-pressed={mine === "up"}
                            title={mine === "up" ? "Remove thumbs up" : "Thumbs up"}
                            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 disabled:cursor-wait"
                            style={{ background: mine === "up" ? "rgba(22,163,74,0.12)" : "rgba(16,24,40,0.05)", color: mine === "up" ? GREEN : INK, opacity: mine === "up" ? 1 : 0.5 }}
                          >
                            <ThumbsUp size={11} fill={mine === "up" ? "currentColor" : "none"} />
                            <span className="text-[10px] font-semibold min-w-[8px] text-center">{upCount}</span>
                          </button>
                          <button
                            onClick={() => setReaction(n.id, "down")}
                            disabled={savingReactionId === n.id}
                            aria-pressed={mine === "down"}
                            title={mine === "down" ? "Remove thumbs down" : "Thumbs down"}
                            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 disabled:cursor-wait"
                            style={{ background: mine === "down" ? "rgba(181,67,58,0.12)" : "rgba(16,24,40,0.05)", color: mine === "down" ? RED : INK, opacity: mine === "down" ? 1 : 0.5 }}
                          >
                            <ThumbsDown size={11} fill={mine === "down" ? "currentColor" : "none"} />
                            <span className="text-[10px] font-semibold min-w-[8px] text-center">{downCount}</span>
                          </button>
                        </div>
                      </div>

                      {isReporting && (
                        <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(16,24,40,0.08)" }}>
                          <label style={{ color: INK, opacity: 0.5 }} className="text-[11px] font-medium block mb-1.5">
                            What's not working? (optional — sent to Feedback either way)
                          </label>
                          <textarea
                            autoFocus
                            value={reportText}
                            onChange={(e) => setReportText(e.target.value)}
                            placeholder="Describe what happened…"
                            rows={2}
                            maxLength={300}
                            className="w-full rounded-lg px-2.5 py-2 text-xs outline-none mb-2 resize-none"
                            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
                          />
                          <div className="flex gap-3">
                            <button onClick={() => submitReport(n)} className="text-xs font-semibold" style={{ color: ACCENT }}>
                              Send to Feedback
                            </button>
                            <button onClick={() => setReportingId(null)} style={{ color: INK, opacity: 0.4 }} className="text-xs">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {justReported === n.id && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: GREEN }}>
                          <Check size={12} />
                          Added to Feedback
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
