import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Sparkles, ThumbsUp, ThumbsDown, Check, Eye, EyeOff } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

const APP_VERSION = "v111";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ReleaseNotes({ onBack }) {
  const { user, profile } = useAuth();

  useEffect(() => { if (user?.id && supabaseReady) supabase.from("user_section_views").upsert({ user_id:user.id, section:"whatsnew", viewed_at:new Date().toISOString() }); }, [user?.id]);
  const [notes, setNotes] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reportingId, setReportingId] = useState(null);
  const [reportText, setReportText] = useState("");
  const [justReported, setJustReported] = useState(null);
  const [savingReactionId, setSavingReactionId] = useState(null);
  const [savingVisibilityId, setSavingVisibilityId] = useState(null);
  const [showHidden, setShowHidden] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabaseReady) { setLoading(false); return; }
    setLoading(true);
    const [{ data: notesData }, { data: reactionsData }] = await Promise.all([
      supabase.from("release_notes").select("*"),
      supabase.from("release_note_reactions").select("*"),
    ]);
    const sorted = [...(notesData || [])].sort((a, b) => {
      const va = parseInt((a.version || "v0").replace("v", ""), 10) || 0;
      const vb = parseInt((b.version || "v0").replace("v", ""), 10) || 0;
      return vb - va;
    });
    setNotes(sorted);
    setReactions(reactionsData || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function setReaction(noteId, reaction) {
    if (!user || savingReactionId === noteId) return;
    const previousReactions = reactions;
    const mine = reactions.find((r) => r.release_note_id === noteId && r.user_id === user.id);
    const isUntick = mine?.reaction === reaction;
    setReactions((current) => {
      const withoutMine = current.filter((r) => !(r.release_note_id === noteId && r.user_id === user.id));
      if (isUntick) return withoutMine;
      return [...withoutMine, { release_note_id: noteId, user_id: user.id, reaction }];
    });
    if (reaction === "down" && !isUntick) { setReportingId(noteId); setReportText(""); }
    else if (isUntick || reaction === "up") { setReportingId((c) => (c === noteId ? null : c)); }
    setSavingReactionId(noteId);
    const { data, error } = await supabase.rpc("toggle_release_note_reaction", { target_release_note_id: noteId, target_reaction: reaction });
    if (error) { setReactions(previousReactions); }
    else {
      const savedReaction = data?.[0]?.user_reaction ?? null;
      setReactions((current) => {
        const wm = current.filter((r) => !(r.release_note_id === noteId && r.user_id === user.id));
        if (!savedReaction) return wm;
        return [...wm, { release_note_id: noteId, user_id: user.id, reaction: savedReaction }];
      });
    }
    setSavingReactionId(null);
  }

  async function setNoteHidden(noteId, hidden) {
    if (!profile?.is_admin || savingVisibilityId === noteId) return;
    setSavingVisibilityId(noteId); const prev = notes;
    setNotes((c) => c.map((n) => n.id === noteId ? { ...n, is_hidden: hidden } : n));
    const { error } = await supabase.rpc("set_release_note_hidden", { target_release_note_id: noteId, hidden });
    if (error) { setNotes(prev); }
    setSavingVisibilityId(null);
  }

  async function submitReport(note) {
    if (!user) return;
    await supabase.from("feedback").insert({ user_id: user.id, title: reportText.trim() || `Not working: ${note.title}` });
    setReportingId(null); setJustReported(note.id);
    setTimeout(() => setJustReported((id) => (id === note.id ? null : id)), 3000);
  }

  return (
    <Page>
      <PageHeader title="What's New" subtitle={`Current app version ${APP_VERSION}`} onBack={onBack} />

      {!supabaseReady ? (
        <StatusBanner variant="error">Supabase isn't configured yet.</StatusBanner>
      ) : loading ? (
        <p style={{ textAlign: "center", padding: "var(--space-8) 0", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ textAlign: "center", padding: "var(--space-8) 0", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>Nothing posted yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {profile?.is_admin && (
            <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-3)", marginBottom: "var(--space-1)" }}>
              <div>
                <div style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Admin visibility</div>
                <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>Hidden updates are excluded by default</div>
              </div>
              <Button variant={showHidden ? "primary" : "secondary"} size="sm" onClick={() => setShowHidden((v) => !v)}>{showHidden ? "Showing hidden" : "Show hidden"}</Button>
            </Card>
          )}
          {notes.filter((n) => !n.deleted_at && (!n.is_hidden || (profile?.is_admin && showHidden))).map((n) => {
            const noteReactions = reactions.filter((r) => r.release_note_id === n.id);
            const upCount = noteReactions.filter((r) => r.reaction === "up").length;
            const downCount = noteReactions.filter((r) => r.reaction === "down").length;
            const mine = noteReactions.find((r) => r.user_id === user?.id)?.reaction;
            const isReporting = reportingId === n.id;

            return (
              <Card key={n.id} style={{ opacity: n.is_hidden ? 0.72 : 1, border: n.is_hidden ? "2px dashed var(--color-danger-text)" : undefined, padding: "var(--space-4)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                  <Sparkles size={14} style={{ color: "var(--color-primary)", marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                      <div style={{ color: "var(--color-text-primary)", fontWeight: 600, fontSize: "var(--text-body-size)", flex: 1 }}>{n.title}</div>
                      {profile?.is_admin && (
                        <button onClick={() => setNoteHidden(n.id, !n.is_hidden)} disabled={savingVisibilityId === n.id} title={n.is_hidden ? "Show" : "Hide"}
                          style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: "var(--radius-full)", padding: "2px 8px", fontSize: 10, fontWeight: 600, background: n.is_hidden ? "var(--color-success-bg)" : "var(--color-danger-bg)", color: n.is_hidden ? "var(--color-success-text)" : "var(--color-danger-text)", border: "none", cursor: "pointer" }}>
                          {n.is_hidden ? <Eye size={11} /> : <EyeOff size={11} />}
                          {n.is_hidden ? "Show" : "Hide"}
                        </button>
                      )}
                    </div>
                    {n.is_hidden && profile?.is_admin && <div style={{ marginTop: "var(--space-1)" }}><span style={{ fontSize: 10, borderRadius: "var(--radius-full)", padding: "2px 8px", fontWeight: 700, background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}>Hidden from players</span></div>}
                    {n.body && <p style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>{n.body}</p>}
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                      {n.version && <span style={{ fontSize: 10, borderRadius: "var(--radius-full)", padding: "2px 6px", fontWeight: 700, background: "var(--color-info-bg)", color: "var(--color-primary)" }}>{n.version}</span>}
                      <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{fmtDate(n.created_at)}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", marginLeft: "auto" }}>
                        <button onClick={() => setReaction(n.id, "up")} disabled={savingReactionId === n.id} aria-pressed={mine === "up"} title={mine === "up" ? "Remove thumbs up" : "Thumbs up"}
                          style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: "var(--radius-full)", padding: "2px 6px", fontSize: 10, fontWeight: 600, background: mine === "up" ? "var(--color-success-bg)" : "var(--color-surface-elevated)", color: mine === "up" ? "var(--color-success-text)" : "var(--color-text-secondary)", border: "1px solid var(--color-border)", cursor: "pointer" }}>
                          <ThumbsUp size={11} fill={mine === "up" ? "currentColor" : "none"} />
                          <span>{upCount}</span>
                        </button>
                        <button onClick={() => setReaction(n.id, "down")} disabled={savingReactionId === n.id} aria-pressed={mine === "down"} title={mine === "down" ? "Remove thumbs down" : "Thumbs down"}
                          style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: "var(--radius-full)", padding: "2px 6px", fontSize: 10, fontWeight: 600, background: mine === "down" ? "var(--color-danger-bg)" : "var(--color-surface-elevated)", color: mine === "down" ? "var(--color-danger-text)" : "var(--color-text-secondary)", border: "1px solid var(--color-border)", cursor: "pointer" }}>
                          <ThumbsDown size={11} fill={mine === "down" ? "currentColor" : "none"} />
                          <span>{downCount}</span>
                        </button>
                      </div>
                    </div>
                    {isReporting && (
                      <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                        <label style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>What's not working? (optional — sent to Feedback either way)</label>
                        <textarea autoFocus value={reportText} onChange={(e) => setReportText(e.target.value)} placeholder="Describe what happened…" rows={2} maxLength={300}
                          style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2)", fontSize: "var(--text-caption-size)", color: "var(--color-text-primary)", background: "var(--color-surface-input)", outline: "none", resize: "none", marginBottom: "var(--space-2)", boxSizing: "border-box" }} />
                        <div style={{ display: "flex", gap: "var(--space-3)" }}>
                          <button onClick={() => submitReport(n)} style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-primary)", background: "transparent", border: "none", cursor: "pointer" }}>Send to Feedback</button>
                          <button onClick={() => setReportingId(null)} style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", background: "transparent", border: "none", cursor: "pointer" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {justReported === n.id && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "var(--space-2)", fontSize: "var(--text-caption-size)", color: "var(--color-success-text)" }}>
                        <Check size={12} /> Added to Feedback
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
