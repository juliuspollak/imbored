import { useState, useEffect, useCallback } from "react";
import { Home, ChevronUp, ChevronDown, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { GAME_META } from "./Home.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";

// Admin-only: control which games show on the home screen, whether
// they're clickable ("Coming soon" vs playable), and what order they
// appear in. Reads/writes the game_config table directly — Home.jsx picks
// up any change on its next load.
export default function AdminGames({ onBack }) {
  const { profile } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase.from("game_config").select("*").order("sort_order", { ascending: true });
    const known = new Set((data || []).map((r) => r.game_id));
    // any game in GAME_META that isn't in game_config yet (e.g. a brand
    // new game just shipped, before its row exists) still shows up here,
    // using sensible defaults, so it's never invisible to admin control
    const missing = GAME_META.filter((g) => !known.has(g.id)).map((g, i) => ({
      game_id: g.id,
      visible: true,
      available: g.available,
      sort_order: (data?.length || 0) + i,
    }));
    setRows([...(data || []), ...missing]);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function updateRow(row, patch) {
    const updated = { ...row, ...patch };
    setRows((prev) => prev.map((r) => (r.game_id === row.game_id ? updated : r)));
    await supabase.from("game_config").upsert({ game_id: row.game_id, visible: updated.visible, available: updated.available, sort_order: updated.sort_order });
  }

  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    // reassign sort_order to match the new array positions
    const reordered = next.map((r, i) => ({ ...r, sort_order: i }));
    setRows(reordered);
    await Promise.all(
      reordered.map((r) => supabase.from("game_config").upsert({ game_id: r.game_id, visible: r.visible, available: r.available, sort_order: r.sort_order }))
    );
  }

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
            Games
          </h1>
        </div>
        <p style={{ color: INK, opacity: 0.45 }} className="text-xs mb-6 ml-9">
          control what shows on the home screen, whether it's playable, and the order
        </p>

        {!supabaseReady ? (
          <div className="text-xs rounded-lg p-3" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            Supabase isn't configured yet.
          </div>
        ) : !isAdmin ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Admin only.</p>
        ) : loading ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => {
              const meta = GAME_META.find((g) => g.id === r.game_id);
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <div
                  key={r.game_id}
                  className="rounded-xl p-3 flex items-center gap-3"
                  style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)", opacity: r.visible ? 1 : 0.5 }}
                >
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      style={{ color: INK, opacity: i === 0 ? 0.2 : 0.5 }}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      style={{ color: INK, opacity: i === rows.length - 1 ? 0.2 : 0.5 }}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>

                  <div
                    className="flex items-center justify-center rounded-lg flex-shrink-0"
                    style={{ width: 32, height: 32, background: `${meta.accent}22` }}
                  >
                    <Icon size={16} style={{ color: meta.accent }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div style={{ color: INK, fontWeight: 600 }} className="text-sm truncate">{meta.label}</div>
                    <div style={{ color: INK, opacity: 0.4 }} className="text-[11px] truncate">{meta.desc}</div>
                  </div>

                  <button
                    onClick={() => updateRow(r, { visible: !r.visible })}
                    className="flex items-center gap-1 rounded-full px-2 py-1 flex-shrink-0"
                    style={{ background: r.visible ? "rgba(16,24,40,0.05)" : "rgba(181,67,58,0.1)", color: r.visible ? INK : "#B5433A" }}
                  >
                    {r.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    onClick={() => updateRow(r, { available: !r.available })}
                    className="flex items-center gap-1 rounded-full px-2 py-1 flex-shrink-0"
                    style={{ background: r.available ? "rgba(22,163,74,0.1)" : "rgba(16,24,40,0.05)", color: r.available ? "#16A34A" : INK }}
                    title={r.available ? "Playable" : "Coming soon (shown, not clickable)"}
                  >
                    {r.available ? <Unlock size={12} /> : <Lock size={12} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ color: INK, opacity: 0.35 }} className="text-[11px] text-center mt-6">
          Eye = shown on the home screen at all. Lock = playable vs "Coming soon" (shown but not clickable).
        </p>
      </div>
    </div>
  );
}
