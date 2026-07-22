import { useState, useEffect, useCallback } from "react";
import { Home, Plus, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ReleaseNotes({ onBack }) {
  const { user, profile } = useAuth();
  const isAdmin = !!profile?.is_admin;

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase.from("release_notes").select("*").order("created_at", { ascending: false });
    setNotes(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    await supabase.from("release_notes").insert({ title: title.trim(), body: body.trim() || null, created_by: user.id });
    setSubmitting(false);
    setTitle("");
    setBody("");
    setShowForm(false);
    refresh();
  }

  async function handleDelete(id) {
    await supabase.from("release_notes").delete().eq("id", id);
    refresh();
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
        ) : (
          <>
            {isAdmin && (
              <>
                <button
                  onClick={() => setShowForm((s) => !s)}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold mb-4"
                  style={{ background: showForm ? "rgba(16,24,40,0.06)" : ACCENT, color: showForm ? INK : "#FFFFFF" }}
                >
                  <Plus size={15} />
                  {showForm ? "Cancel" : "Post an update"}
                </button>
                {showForm && (
                  <form onSubmit={handleSubmit} className="rounded-2xl p-4 mb-4" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)" }}>
                    <input
                      required
                      autoFocus
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="What changed?"
                      maxLength={100}
                      className="w-full rounded-lg px-3 py-2 text-sm mb-2 outline-none"
                      style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
                    />
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Details (optional)"
                      rows={3}
                      maxLength={500}
                      className="w-full rounded-lg px-3 py-2 text-sm mb-3 outline-none resize-none"
                      style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-lg py-2 text-sm font-semibold"
                      style={{ background: ACCENT, color: "#FFFFFF", opacity: submitting ? 0.7 : 1 }}
                    >
                      {submitting ? "Posting…" : "Post"}
                    </button>
                  </form>
                )}
              </>
            )}

            {loading ? (
              <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
            ) : notes.length === 0 ? (
              <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Nothing posted yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-2xl p-4" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <Sparkles size={14} style={{ color: ACCENT, marginTop: 2, flexShrink: 0 }} />
                        <div style={{ color: INK, fontWeight: 600 }} className="text-sm">{n.title}</div>
                      </div>
                      {isAdmin && (
                        <button onClick={() => handleDelete(n.id)} style={{ color: "#B5433A", opacity: 0.5, flexShrink: 0 }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    {n.body && <p style={{ color: INK, opacity: 0.6 }} className="text-xs mt-1.5 ml-5">{n.body}</p>}
                    <p style={{ color: INK, opacity: 0.35 }} className="text-[10px] mt-2 ml-5">{fmtDate(n.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
