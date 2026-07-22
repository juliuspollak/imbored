import { useState, useEffect, useCallback } from "react";
import { Home, Sparkles } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Purely a read-only board — every entry here comes from CHANGELOG.json in
// the repo, synced automatically by a GitHub Action on every push. No
// manual posting or deleting from the app: the changelog file is the one
// source of truth, so admin edits happen there instead, not here.
export default function ReleaseNotes({ onBack }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

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
            {notes.map((n) => (
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
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
