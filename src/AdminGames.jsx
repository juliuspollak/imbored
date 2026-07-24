import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ChevronUp, ChevronDown, Eye, EyeOff, Lock, Unlock, Wrench, Eraser } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { GAME_META } from "./Home.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

// Admin-only: control which games show on the home screen, whether
// they're clickable ("Coming soon" vs playable), what order they appear
// in, and how long the Hint button locks after each use (with an optional
// per-day ramp, so it can get stricter as difficulty increases through
// the week). Reads/writes the game_config table directly — Home.jsx and
// each game pick up any change on their next load.
export default function AdminGames({ onBack }) {
  const { profile } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // game_id currently showing cooldown controls
  const [resetting, setResetting] = useState(null);
  const [message, setMessage] = useState("");

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
      hint_cooldown_base: 0,
      hint_cooldown_per_day: 0,
      zip_path_style: "solid",
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
    // always send every relevant column explicitly, not just the changed
    // one — avoids any ambiguity about whether an upsert preserves columns
    // left out of the payload
    const { error } = await supabase.from("game_config").upsert({
      game_id: row.game_id,
      visible: updated.visible,
      available: updated.available,
      sort_order: updated.sort_order,
      hint_cooldown_base: updated.hint_cooldown_base ?? 0,
      hint_cooldown_per_day: updated.hint_cooldown_per_day ?? 0,
      zip_path_style: updated.zip_path_style || "solid",
    });
    if (error) {
      // Roll back the optimistic update so the UI doesn't claim a setting
      // is saved when it silently wasn't (e.g. this row never existed yet
      // and an insert-level policy blocked creating it).
      setRows((prev) => prev.map((r) => (r.game_id === row.game_id ? row : r)));
      setMessage(`Couldn't save that setting: ${error.message}`);
    }
  }

  async function resetTodayChallenge(gameId, label) {
    if (!window.confirm(`Reset today's ${label} challenge for every player? This removes today's saved results and ratings.`)) return;
    setResetting(gameId);
    setMessage("");
    const localDate = new Date().toLocaleDateString("en-CA");
    const { data, error } = await supabase.rpc("admin_reset_daily_challenge", { p_game: gameId, p_challenge_date: localDate });
    setResetting(null);
    if (error) {
      setMessage(`Reset failed: ${error.message}`);
      return;
    }
    setMessage(`${label}: removed ${data ?? 0} result${data === 1 ? "" : "s"} for today.`);
  }

  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const previous = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    const reordered = next.map((r, i) => ({ ...r, sort_order: i }));
    setRows(reordered);
    const results = await Promise.all(
      reordered.map((r) =>
        supabase.from("game_config").upsert({
          game_id: r.game_id,
          visible: r.visible,
          available: r.available,
          sort_order: r.sort_order,
          hint_cooldown_base: r.hint_cooldown_base ?? 0,
          hint_cooldown_per_day: r.hint_cooldown_per_day ?? 0,
          zip_path_style: r.zip_path_style || "solid",
        })
      )
    );
    const failed = results.find((r) => r.error);
    if (failed) {
      setRows(previous);
      setMessage(`Couldn't save the new order: ${failed.error.message}`);
    }
  }

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
            Games
          </h1>
        </div>
        <p style={{ color: INK, opacity: 0.45 }} className="text-xs mb-4 ml-9">
          visibility, playability, order, maintenance settings, and daily resets
        </p>
        {message && (
          <div className="text-xs rounded-lg p-3 mb-4" style={{ background: message.startsWith("Reset failed") || message.startsWith("Couldn't") ? "rgba(217,105,92,0.1)" : "rgba(22,163,74,0.1)", color: message.startsWith("Reset failed") || message.startsWith("Couldn't") ? "#B5433A" : "#15803D" }}>
            {message}
          </div>
        )}

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
              const isExpanded = expanded === r.game_id;
              const hasMaintenance = (r.hint_cooldown_base || 0) > 0 || (r.hint_cooldown_per_day || 0) > 0 || (r.game_id === "zip" && (r.zip_path_style || "solid") !== "solid");
              return (
                <div key={r.game_id} className="rounded-xl" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)", opacity: r.visible ? 1 : 0.5 }}>
                  <div className="p-3 flex items-center gap-3">
                    <div className="flex flex-col">
                      <button onClick={() => move(i, -1)} disabled={i === 0} style={{ color: INK, opacity: i === 0 ? 0.2 : 0.5 }}>
                        <ChevronUp size={14} />
                      </button>
                      <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} style={{ color: INK, opacity: i === rows.length - 1 ? 0.2 : 0.5 }}>
                        <ChevronDown size={14} />
                      </button>
                    </div>

                    <div className="flex items-center justify-center rounded-lg flex-shrink-0" style={{ width: 32, height: 32, background: `${meta.accent}22` }}>
                      <Icon size={16} style={{ color: meta.accent }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div style={{ color: INK, fontWeight: 600 }} className="text-sm truncate">{meta.label}</div>
                      <div style={{ color: INK, opacity: 0.4 }} className="text-[11px] truncate">{meta.desc}</div>
                    </div>

                    <button
                      onClick={() => resetTodayChallenge(r.game_id, meta.label)}
                      disabled={resetting === r.game_id || !r.available}
                      className="flex items-center gap-1 rounded-full px-2 py-1 flex-shrink-0"
                      style={{ background: "rgba(234,88,12,0.1)", color: "#C2410C", opacity: !r.available ? 0.35 : 1 }}
                      title="Reset today's challenge results"
                    >
                      <Eraser size={12} className={resetting === r.game_id ? "animate-spin" : ""} />
                    </button>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : r.game_id)}
                      className="flex items-center gap-1 rounded-full px-2 py-1 flex-shrink-0"
                      style={{ background: hasMaintenance ? "rgba(47,111,237,0.1)" : "rgba(16,24,40,0.05)", color: hasMaintenance ? ACCENT : INK }}
                      title="Maintenance & settings"
                    >
                      <Wrench size={12} />
                    </button>
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

                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1" style={{ borderTop: "1px solid rgba(16,24,40,0.06)" }}>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label style={{ color: INK, opacity: 0.5 }} className="text-[10px] font-medium block mb-1 mt-2">
                            Base cooldown (sec)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={r.hint_cooldown_base || 0}
                            onChange={(e) => updateRow(r, { hint_cooldown_base: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
                          />
                        </div>
                        <div className="flex-1">
                          <label style={{ color: INK, opacity: 0.5 }} className="text-[10px] font-medium block mb-1 mt-2">
                            + per day (sec)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={r.hint_cooldown_per_day || 0}
                            onChange={(e) => updateRow(r, { hint_cooldown_per_day: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
                          />
                        </div>
                      </div>
                      {r.game_id === "zip" && (
                        <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(16,24,40,0.08)" }}>
                          <label style={{ color: INK, opacity: 0.6 }} className="text-[10px] font-semibold block mb-1.5">
                            Snake appearance
                          </label>
                          <select
                            value={r.zip_path_style || "solid"}
                            onChange={(e) => updateRow(r, { zip_path_style: e.target.value })}
                            className="w-full rounded-lg px-2 py-2 text-xs outline-none"
                            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK, background: "#FFFFFF" }}
                          >
                            <option value="solid">Thick solid green</option>
                            <option value="rainbow">Original rainbow</option>
                          </select>
                          <p style={{ color: INK, opacity: 0.35 }} className="text-[10px] mt-1.5">
                            Both styles keep tunnel jumps visually disconnected.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p style={{ color: INK, opacity: 0.35 }} className="text-[11px] text-center mt-6">
          Eye = shown on home at all. Lock = playable vs "coming soon". Maintenance = per-game settings such as hint cooldowns and ZIP snake appearance.
        </p>
      </div>
    </div>
  );
}
