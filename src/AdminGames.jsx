import { useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown, Eye, EyeOff, Lock, Unlock, Wrench, Eraser, RotateCcw, Trophy } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { GAME_META } from "./Home.jsx";

const BG = "#F1F3F7";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const ZIP_DEFAULTS = {
  zip_grid_sizes: [7, 7, 7, 7, 7, 7, 7],
  zip_checkpoint_counts: [4, 6, 8, 10, 12, 14, 16],
  zip_wall_counts: [0, 1, 2, 3, 5, 6, 7],
  zip_black_hole_counts: [0, 0, 0, 0, 0, 0, 0],
  zip_tunnel_pair_counts: [0, 0, 0, 0, 0, 1, 1],
};
const ZIP_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function zipConfigPayload(row) {
  if (row.game_id !== "zip") return {};
  return {
    zip_grid_sizes: row.zip_grid_sizes || ZIP_DEFAULTS.zip_grid_sizes,
    zip_checkpoint_counts: row.zip_checkpoint_counts || ZIP_DEFAULTS.zip_checkpoint_counts,
    zip_wall_counts: row.zip_wall_counts || ZIP_DEFAULTS.zip_wall_counts,
    zip_black_hole_counts: row.zip_black_hole_counts || ZIP_DEFAULTS.zip_black_hole_counts,
    zip_tunnel_pair_counts: row.zip_tunnel_pair_counts || ZIP_DEFAULTS.zip_tunnel_pair_counts,
  };
}

function patchZipDay(row, field, dayIndex, value) {
  const values = [...(row[field] || ZIP_DEFAULTS[field])];
  values[dayIndex] = value;
  return { [field]: values };
}

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
      challenge_enabled: g.challenge === true,
      sort_order: (data?.length || 0) + i,
      hint_cooldown_base: 0,
      hint_cooldown_per_day: 0,
      zip_path_style: "solid",
      ...(g.id === "zip" ? ZIP_DEFAULTS : {}),
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
    const payload = {
      game_id: row.game_id,
      visible: updated.visible,
      available: updated.available,
      sort_order: updated.sort_order,
      hint_cooldown_base: updated.hint_cooldown_base ?? 0,
      hint_cooldown_per_day: updated.hint_cooldown_per_day ?? 0,
      zip_path_style: updated.zip_path_style || "solid",
      ...zipConfigPayload(updated),
    };
    if (Object.prototype.hasOwnProperty.call(updated, "challenge_enabled")) {
      payload.challenge_enabled = updated.challenge_enabled;
    }
    const { error } = await supabase.from("game_config").upsert(payload);
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

  async function resetMyChallengeForEveryone() {
    if (!window.confirm("Hard reset today's My Challenge for every player? Results, ratings and points awarded for today's personal challenge will be removed so the complete flow can be tested again from scratch.")) return;
    setResetting("all");
    setMessage("");
    const { data, error } = await supabase.rpc("admin_reset_my_challenge");
    setResetting(null);
    if (error) {
      setMessage(`Reset failed: ${error.message}`);
      return;
    }
    const removed = Number(data?.results_removed) || 0;
    const reversedRewards = Number(data?.rewards_reversed) || 0;
    const reversedPoints = Number(data?.points_reversed) || 0;
    setMessage(`Hard reset complete. Removed ${removed} result${removed === 1 ? "" : "s"} and reversed ${reversedRewards} reward${reversedRewards === 1 ? "" : "s"} (${reversedPoints} points).`);
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
          ...zipConfigPayload(r),
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
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="admin-games-page flex justify-center p-4 pt-10">
      <style>{`
        .admin-games-page {
          padding-left: max(14px, env(safe-area-inset-left));
          padding-right: max(14px, env(safe-area-inset-right));
          padding-bottom: max(28px, env(safe-area-inset-bottom));
        }
        .admin-game-card {
          overflow: hidden;
          border: 1px solid rgba(16, 24, 40, 0.08);
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 10px 30px rgba(16, 24, 40, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.92);
          transition: opacity 160ms ease, box-shadow 160ms ease;
        }
        .admin-game-card__header {
          display: grid;
          grid-template-columns: 40px 48px minmax(0, 1fr);
          align-items: center;
          gap: 11px;
          padding: 14px 14px 10px;
        }
        .admin-game-order {
          display: grid;
          gap: 4px;
        }
        .admin-game-order button {
          display: grid;
          width: 40px;
          height: 29px;
          place-items: center;
          border-radius: 11px;
          padding: 0;
        }
        .admin-game-icon {
          display: grid;
          width: 48px;
          height: 48px;
          place-items: center;
          border-radius: 16px;
        }
        .admin-game-copy {
          min-width: 0;
        }
        .admin-game-copy h2 {
          overflow: hidden;
          margin: 0;
          color: ${INK};
          font-size: 16px;
          font-weight: 750;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .admin-game-copy p {
          display: -webkit-box;
          overflow: hidden;
          margin: 3px 0 0;
          color: rgba(27, 33, 41, 0.5);
          font-size: 11px;
          line-height: 1.35;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .admin-game-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 7px;
        }
        .admin-game-chip {
          border: 1px solid rgba(16, 24, 40, 0.06);
          border-radius: 999px;
          padding: 3px 7px;
          background: rgba(16, 24, 40, 0.045);
          color: rgba(27, 33, 41, 0.62);
          font-size: 9px;
          font-weight: 700;
          line-height: 1;
          white-space: nowrap;
        }
        .admin-game-chip[data-tone="green"] {
          border-color: rgba(22, 163, 74, 0.1);
          background: rgba(22, 163, 74, 0.08);
          color: #15803d;
        }
        .admin-game-chip[data-tone="blue"] {
          border-color: rgba(47, 111, 237, 0.1);
          background: rgba(47, 111, 237, 0.08);
          color: ${ACCENT};
        }
        .admin-game-actions {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 7px;
          padding: 0 12px 12px;
        }
        .admin-game-action {
          display: flex;
          min-width: 0;
          min-height: 52px;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          border-radius: 15px;
          padding: 6px 2px;
          font-size: 9px;
          font-weight: 700;
          line-height: 1;
        }
        .admin-game-action span {
          display: block;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .admin-game-settings {
          border-top: 1px solid rgba(16, 24, 40, 0.06);
          background: rgba(248, 250, 252, 0.72);
        }
        @media (max-width: 390px) {
          .admin-game-card__header {
            grid-template-columns: 36px 44px minmax(0, 1fr);
            gap: 9px;
            padding: 12px 11px 9px;
          }
          .admin-game-order button {
            width: 36px;
            height: 28px;
          }
          .admin-game-icon {
            width: 44px;
            height: 44px;
            border-radius: 14px;
          }
          .admin-game-actions {
            gap: 5px;
            padding: 0 9px 10px;
          }
          .admin-game-action {
            min-height: 49px;
            border-radius: 13px;
            font-size: 8.5px;
          }
        }
        @media (max-width: 360px) {
          .admin-game-actions {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
      `}</style>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-2">
          <BackButton onClick={onBack} />
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

        {supabaseReady && isAdmin && (
          <div className="admin-reset-card rounded-2xl p-3 mb-4" style={{ background:"rgba(234,88,12,.07)",border:"1px solid rgba(234,88,12,.16)" }}>
            <div className="flex items-center gap-3">
              <span className="grid place-items-center rounded-xl shrink-0" style={{ width:36,height:36,background:"rgba(234,88,12,.12)",color:"#C2410C" }}>
                <RotateCcw size={16} className={resetting === "all" ? "animate-spin" : ""}/>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold" style={{ color:INK }}>Hard reset today’s My Challenge</span>
                <span className="block text-[10px] mt-0.5" style={{ color:"rgba(27,33,41,.48)" }}>Clears personal results and reverses their point awards for complete end-to-end testing.</span>
              </span>
              <button
                type="button"
                className="gloss-button rounded-full px-3 py-2 text-xs font-semibold shrink-0 disabled:opacity-50"
                onClick={resetMyChallengeForEveryone}
                disabled={resetting !== null}
                style={{ background:"#C2410C",color:"#fff" }}
              >
                {resetting === "all" ? "Resetting…" : "Restart"}
              </button>
            </div>
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
              const challengeEnabled = typeof r.challenge_enabled === "boolean"
                ? r.challenge_enabled
                : meta.challenge === true;
              return (
                <div key={r.game_id} className="admin-game-card" style={{ opacity: r.visible ? 1 : 0.68 }}>
                  <div className="admin-game-card__header">
                    <div className="admin-game-order" aria-label={`Change ${meta.label} position`}>
                      <button className="gloss-button" onClick={() => move(i, -1)} disabled={i === 0} style={{ color: INK, opacity: i === 0 ? 0.2 : 0.5 }}>
                        <ChevronUp size={14} />
                      </button>
                      <button className="gloss-button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} style={{ color: INK, opacity: i === rows.length - 1 ? 0.2 : 0.5 }}>
                        <ChevronDown size={14} />
                      </button>
                    </div>

                    <div className="admin-game-icon" style={{ background: `${meta.accent}20` }}>
                      <Icon size={21} style={{ color: meta.accent }} />
                    </div>

                    <div className="admin-game-copy">
                      <h2>{meta.label}</h2>
                      <p>{meta.desc}</p>
                      <div className="admin-game-chips">
                        <span className="admin-game-chip" data-tone={r.visible ? "green" : undefined}>
                          {r.visible ? "Shown" : "Hidden"}
                        </span>
                        <span className="admin-game-chip" data-tone={r.available ? "green" : undefined}>
                          {r.available ? "Playable" : "Locked"}
                        </span>
                        <span className="admin-game-chip" data-tone={challengeEnabled ? "blue" : undefined}>
                          {meta.live ? "Live only" : challengeEnabled ? "Challenges" : "No challenges"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="admin-game-actions">
                    <button
                      onClick={() => resetTodayChallenge(r.game_id, meta.label)}
                      disabled={resetting !== null || !r.available}
                      className="gloss-button admin-game-action"
                      style={{ background: "rgba(234,88,12,0.1)", color: "#C2410C", opacity: !r.available ? 0.35 : 1 }}
                      title="Reset today's challenge results"
                    >
                      <Eraser size={16} className={resetting === r.game_id ? "animate-spin" : ""} />
                      <span>Reset</span>
                    </button>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : r.game_id)}
                      className="gloss-button admin-game-action"
                      style={{ background: hasMaintenance ? "rgba(47,111,237,0.1)" : "rgba(16,24,40,0.05)", color: hasMaintenance ? ACCENT : INK }}
                      title="Maintenance & settings"
                    >
                      <Wrench size={16} />
                      <span>Settings</span>
                    </button>
                    <button
                      type="button"
                      className="gloss-button admin-game-action"
                      onClick={() => updateRow(r, { challenge_enabled: !challengeEnabled })}
                      disabled={!meta.challenge || !r.available}
                      style={{
                        background: challengeEnabled ? "rgba(47,111,237,0.12)" : "rgba(16,24,40,0.05)",
                        color: challengeEnabled ? ACCENT : INK,
                        opacity: !meta.challenge || !r.available ? 0.32 : 1,
                      }}
                      title={meta.live
                        ? "Live only — not compatible with Challenges"
                        : challengeEnabled
                          ? "Available in Challenges"
                          : "Not available in Challenges"}
                      aria-label={meta.live
                        ? `${meta.label} is live only`
                        : `${challengeEnabled ? "Remove" : "Add"} ${meta.label} ${challengeEnabled ? "from" : "to"} Challenges`}
                    >
                      <Trophy size={16} />
                      <span>Challenge</span>
                    </button>
                    <button
                      onClick={() => updateRow(r, { visible: !r.visible })}
                      className="gloss-button admin-game-action"
                      style={{ background: r.visible ? "rgba(16,24,40,0.05)" : "rgba(181,67,58,0.1)", color: r.visible ? INK : "#B5433A" }}
                    >
                      {r.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                      <span>{r.visible ? "Shown" : "Hidden"}</span>
                    </button>
                    <button
                      onClick={() => updateRow(r, { available: !r.available })}
                      className="gloss-button admin-game-action"
                      style={{ background: r.available ? "rgba(22,163,74,0.1)" : "rgba(16,24,40,0.05)", color: r.available ? "#16A34A" : INK }}
                      title={r.available ? "Playable" : "Coming soon (shown, not clickable)"}
                    >
                      {r.available ? <Unlock size={16} /> : <Lock size={16} />}
                      <span>{r.available ? "Playable" : "Locked"}</span>
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="admin-game-settings px-3 pb-3 pt-1">
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
                          <div className="mt-4 pt-3 overflow-x-auto" style={{ borderTop: "1px solid rgba(16,24,40,0.08)" }}>
                            <div className="text-[10px] font-semibold mb-1" style={{ color: INK }}>Daily puzzle complexity</div>
                            <p className="text-[10px] mb-2" style={{ color: INK, opacity: 0.42 }}>
                              Changes apply to newly generated puzzles. If today’s ZIP challenge has started, reset it after changing today’s row so every player receives the same puzzle.
                            </p>
                            <div className="grid gap-1.5" style={{ gridTemplateColumns: "38px repeat(5,minmax(48px,1fr))", minWidth: 340 }}>
                              {["Day", "Grid", "Numbers", "Walls", "Holes", "Tunnels"].map((heading) => (
                                <div key={heading} className="text-[9px] font-semibold text-center" style={{ color: INK, opacity: 0.48 }}>{heading}</div>
                              ))}
                              {ZIP_DAY_LABELS.flatMap((day, dayIndex) => {
                                const fields = [
                                  ["zip_grid_sizes", 4, 9],
                                  ["zip_checkpoint_counts", 2, 30],
                                  ["zip_wall_counts", 0, 30],
                                  ["zip_black_hole_counts", 0, 20],
                                  ["zip_tunnel_pair_counts", 0, 4],
                                ];
                                return [
                                  <div key={`${day}-label`} className="text-[10px] font-semibold flex items-center" style={{ color: INK }}>{day}</div>,
                                  ...fields.map(([field, min, max]) => (
                                    <input
                                      key={`${day}-${field}`}
                                      type="number"
                                      min={min}
                                      max={max}
                                      value={(r[field] || ZIP_DEFAULTS[field])[dayIndex]}
                                      onChange={(event) => {
                                        const parsed = Number.parseInt(event.target.value, 10);
                                        const value = Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
                                        updateRow(r, patchZipDay(r, field, dayIndex, value));
                                      }}
                                      className="w-full rounded-lg px-1 py-1.5 text-[10px] text-center outline-none"
                                      style={{ border: "1px solid rgba(16,24,40,0.12)", color: INK }}
                                      aria-label={`${day} ${field.replace("zip_", "").replaceAll("_", " ")}`}
                                    />
                                  )),
                                ];
                              })}
                            </div>
                          </div>
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
          Challenge controls Challenge availability. Shown controls the Home tile. Playable controls whether the game can be opened.
        </p>
      </div>
    </div>
  );
}
