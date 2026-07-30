import { useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown, Eye, EyeOff, Lock, Unlock, Wrench, Eraser, RotateCcw, Trophy } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { GAME_META } from "./Home.jsx";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import TextInput from "./components/TextInput.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

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

export default function AdminGames({ onBack }) {
  const { profile } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("game_config").select("*").order("sort_order", { ascending: true });
    const known = new Set((data || []).map((r) => r.game_id));
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

  useEffect(() => { refresh(); }, [refresh]);

  async function updateRow(row, patch) {
    const updated = { ...row, ...patch };
    setRows((prev) => prev.map((r) => (r.game_id === row.game_id ? updated : r)));
    setSaving(row.game_id);
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
    setSaving(null);
    if (error) {
      setRows((prev) => prev.map((r) => (r.game_id === row.game_id ? row : r)));
      setMessage({ type: "error", text: `Couldn't save that setting: ${error.message}` });
    }
  }

  function confirmResetTodayChallenge(gameId, label) {
    setConfirmTarget({ type: "resetToday", gameId, label });
  }

  function confirmResetMyChallenge() {
    setConfirmTarget({ type: "resetMy" });
  }

  async function executeResetTodayChallenge() {
    if (!confirmTarget || confirmTarget.type !== "resetToday") return;
    const { gameId, label } = confirmTarget;
    setConfirmTarget(null);
    setResetting(gameId);
    setMessage(null);
    const localDate = new Date().toLocaleDateString("en-CA");
    const { data, error } = await supabase.rpc("admin_reset_daily_challenge", { p_game: gameId, p_challenge_date: localDate });
    setResetting(null);
    if (error) { setMessage({ type: "error", text: `Reset failed: ${error.message}` }); return; }
    setMessage({ type: "success", text: `${label}: removed ${data ?? 0} result${data === 1 ? "" : "s"} for today.` });
  }

  async function executeResetMyChallenge() {
    setConfirmTarget(null);
    setResetting("all");
    setMessage(null);
    const { data, error } = await supabase.rpc("admin_reset_my_challenge");
    setResetting(null);
    if (error) { setMessage({ type: "error", text: `Reset failed: ${error.message}` }); return; }
    const removed = Number(data?.results_removed) || 0;
    const reversedRewards = Number(data?.rewards_reversed) || 0;
    const reversedPoints = Number(data?.points_reversed) || 0;
    setMessage({ type: "success", text: `Hard reset complete. Removed ${removed} result${removed === 1 ? "" : "s"} and reversed ${reversedRewards} reward${reversedRewards === 1 ? "" : "s"} (${reversedPoints} points).` });
  }

  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const previous = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    const reordered = next.map((r, i) => ({ ...r, sort_order: i }));
    setRows(reordered);
    setSaving("reorder");
    const results = await Promise.all(
      reordered.map((r) =>
        supabase.from("game_config").upsert({
          game_id: r.game_id, visible: r.visible, available: r.available,
          sort_order: r.sort_order, hint_cooldown_base: r.hint_cooldown_base ?? 0,
          hint_cooldown_per_day: r.hint_cooldown_per_day ?? 0,
          zip_path_style: r.zip_path_style || "solid",
          ...zipConfigPayload(r),
        })
      )
    );
    setSaving(null);
    const failed = results.find((r) => r.error);
    if (failed) { setRows(previous); setMessage({ type: "error", text: `Couldn't save the new order: ${failed.error.message}` }); }
  }

  const challengeEnabled = (r) => typeof r.challenge_enabled === "boolean" ? r.challenge_enabled : (GAME_META.find((g) => g.id === r.game_id)?.challenge === true);

  return (
    <Page>
      <style>{`
        .ag-zip-table { min-width: 340px; }
        @media (max-width: 420px) {
          .ag-zip-table { display: flex; flex-direction: column; gap: 8px; }
          .ag-zip-table-header { display: none; }
          .ag-zip-table-row { display: grid; grid-template-columns: 40px repeat(2, 1fr); gap: 4px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--color-border); }
          .ag-zip-table-row input { width: 100%; min-width: 44px; }
        }
        @media (min-width: 421px) {
          .ag-zip-table { display: grid; gap: 6px; grid-template-columns: 42px repeat(5, minmax(52px, 1fr)); overflow-x: auto; }
          .ag-zip-table-header { display: contents; }
          .ag-zip-table-row { display: contents; }
        }
      `}</style>

      <PageHeader
        title="Games"
        subtitle="Visibility, playability, order, maintenance settings and daily resets"
        onBack={onBack}
      />

      {message && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant={message.type} dismissible onDismiss={() => setMessage(null)}>{message.text}</StatusBanner></div>}

      {!supabaseReady ? <StatusBanner variant="error">Supabase isn't configured yet.</StatusBanner>
        : !isAdmin ? <p style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-text-secondary)" }}>Admin only.</p>
        : loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>{[0,1,2].map((i) => <div key={i} style={{ height: 96, borderRadius: "var(--radius-lg)", background: "linear-gradient(90deg, #1B2438, #24304A, #1B2438)", animation: "pulse 1.5s ease-in-out infinite" }} />)}</div>
        ) : (
          <>
            {/* Maintenance */}
            <Card style={{ marginBottom: "var(--section-gap)", borderColor: "var(--color-danger-text)", borderLeft: "3px solid var(--color-danger-text)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Hard reset today's My Challenge</div>
                  <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>Clears personal results and reverses their point awards for complete end-to-end testing.</div>
                </div>
                <Button variant="danger" size="sm" loading={resetting === "all"} before={<RotateCcw size={14} />} onClick={confirmResetMyChallenge}>
                  {resetting === "all" ? "Resetting…" : "Reset"}
                </Button>
              </div>
            </Card>

            {/* Game cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {rows.map((r, i) => {
                const meta = GAME_META.find((g) => g.id === r.game_id);
                if (!meta) return null;
                const Icon = meta.icon;
                const isExpanded = expanded === r.game_id;
                const ce = challengeEnabled(r);
                const busy = saving === r.game_id || resetting === r.game_id;

                return (
                  <Card key={r.game_id} style={{ padding: "var(--space-4)", opacity: r.visible ? 1 : 0.72 }}>
                    {/* Header row */}
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      {/* Reorder */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                        <Button variant="icon" size="sm" disabled={i === 0 || busy} onClick={() => move(i, -1)} aria-label={`Move ${meta.label} up`} style={{ width: 36, height: 28, minWidth: 36, borderRadius: "var(--radius-sm)" }}>
                          <ChevronUp size={15} />
                        </Button>
                        <Button variant="icon" size="sm" disabled={i === rows.length - 1 || busy} onClick={() => move(i, 1)} aria-label={`Move ${meta.label} down`} style={{ width: 36, height: 28, minWidth: 36, borderRadius: "var(--radius-sm)" }}>
                          <ChevronDown size={15} />
                        </Button>
                      </div>

                      {/* Game icon */}
                      <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: `${meta.accent}22`, display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <Icon size={21} style={{ color: meta.accent }} />
                      </div>

                      {/* Name + status */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "var(--text-body-size)", fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.3 }} className="truncate">{meta.label}</div>
                        <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: 2 }} className="truncate">{meta.desc}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginTop: "var(--space-1)" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, borderRadius: "var(--radius-full)", padding: "2px 8px", background: r.visible ? "var(--color-success-bg)" : "var(--color-border)", color: r.visible ? "var(--color-success-text)" : "var(--color-text-secondary)" }}>{r.visible ? "Shown" : "Hidden"}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, borderRadius: "var(--radius-full)", padding: "2px 8px", background: r.available ? "var(--color-success-bg)" : "var(--color-border)", color: r.available ? "var(--color-success-text)" : "var(--color-text-secondary)" }}>{r.available ? "Playable" : "Locked"}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, borderRadius: "var(--radius-full)", padding: "2px 8px", background: ce ? "var(--color-info-bg)" : "var(--color-border)", color: ce ? "var(--color-info-text)" : "var(--color-text-secondary)" }}>{meta.live ? "Live only" : ce ? "Challenges" : "No challenges"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Switch rows */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-primary)" }}>Show on Home</span>
                        <Button variant="secondary" size="sm" loading={saving === r.game_id} onClick={() => updateRow(r, { visible: !r.visible })}>{r.visible ? "Shown" : "Hidden"}</Button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-primary)" }}>Playable</span>
                        <Button variant="secondary" size="sm" loading={saving === r.game_id} onClick={() => updateRow(r, { available: !r.available })}>{r.available ? "Playable" : "Locked"}</Button>
                      </div>
                      {!meta.live && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-primary)" }}>Available in Challenges</span>
                          <Button variant="secondary" size="sm" loading={saving === r.game_id} disabled={!meta.challenge || !r.available} onClick={() => updateRow(r, { challenge_enabled: !ce })}>{ce ? "Yes" : "No"}</Button>
                        </div>
                      )}
                    </div>

                    {/* Expand + Reset */}
                    <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                      <Button variant="secondary" size="sm" before={<Wrench size={14} />} onClick={() => setExpanded(isExpanded ? null : r.game_id)} aria-expanded={isExpanded} aria-controls={`settings-${r.game_id}`}>
                        {isExpanded ? "Hide settings" : "Game settings"}
                      </Button>
                      <Button variant="ghost" size="sm" before={<Eraser size={14} />} loading={resetting === r.game_id} disabled={!r.available || resetting !== null} onClick={() => confirmResetTodayChallenge(r.game_id, meta.label)} style={{ color: "var(--color-danger-text)" }}>
                        Reset today
                      </Button>
                    </div>

                    {/* Settings panel */}
                    {isExpanded && (
                      <div id={`settings-${r.game_id}`} style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                        <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-3)" }}>Hint settings</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                          <label>
                            <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Base cooldown (sec)</span>
                            <TextInput type="number" min={0} value={r.hint_cooldown_base || 0} onChange={(e) => updateRow(r, { hint_cooldown_base: Math.max(0, parseInt(e.target.value) || 0) })} />
                          </label>
                          <label>
                            <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>+ per day (sec)</span>
                            <TextInput type="number" min={0} value={r.hint_cooldown_per_day || 0} onChange={(e) => updateRow(r, { hint_cooldown_per_day: Math.max(0, parseInt(e.target.value) || 0) })} />
                          </label>
                        </div>

                        {r.game_id === "zip" && (
                          <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                            <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-3)" }}>ZIP appearance</div>
                            <label>
                              <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Snake appearance</span>
                              <select value={r.zip_path_style || "solid"} onChange={(e) => updateRow(r, { zip_path_style: e.target.value })}
                                style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "8px 12px", fontSize: "var(--text-body-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }}>
                                <option value="solid">Thick solid green</option>
                                <option value="rainbow">Original rainbow</option>
                              </select>
                            </label>
                            <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: 4 }}>Both styles keep tunnel jumps visually disconnected.</div>

                            <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                              <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-1)" }}>Daily puzzle complexity</div>
                              <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginBottom: "var(--space-3)" }}>Changes apply to newly generated puzzles. If today's ZIP challenge has started, reset it after changing today's row so every player receives the same puzzle.</div>

                              <div className="ag-zip-table">
                                <div className="ag-zip-table-header">
                                  {["Day", "Grid size", "Checkpoints", "Walls", "Black holes", "Tunnel pairs"].map((h) => <div key={h} style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textAlign: "center" }}>{h}</div>)}
                                </div>
                                {ZIP_DAY_LABELS.map((day, dayIndex) => {
                                  const fields = [["zip_grid_sizes",4,9],["zip_checkpoint_counts",2,30],["zip_wall_counts",0,30],["zip_black_hole_counts",0,20],["zip_tunnel_pair_counts",0,4]];
                                  return (
                                    <div key={day} className="ag-zip-table-row">
                                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)", display: "flex", alignItems: "center" }}>{day}</div>
                                      {fields.map(([field, min, max]) => {
                                        const value = (r[field] || ZIP_DEFAULTS[field])[dayIndex];
                                        return (
                                          <input key={field} type="number" min={min} max={max} value={value}
                                            onChange={(e) => { const p = Number.parseInt(e.target.value, 10); updateRow(r, patchZipDay(r, field, dayIndex, Math.min(max, Math.max(min, Number.isFinite(p) ? p : min)))); }}
                                            aria-label={`${day} ${field.replace("zip_","").replaceAll("_"," ")}`}
                                            style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "6px 8px", fontSize: 13, textAlign: "center", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }} />
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )}

      {/* Confirmation modal */}
      {confirmTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)", background: "var(--color-overlay)" }}>
          <Card style={{ maxWidth: 400, width: "100%", padding: "var(--space-5)" }}>
            <div style={{ fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "var(--space-1)" }}>
              {confirmTarget.type === "resetToday" ? `Reset today's ${confirmTarget.label} challenge?` : "Hard reset My Challenge?"}
            </div>
            <div style={{ fontSize: "var(--text-body-size)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
              {confirmTarget.type === "resetToday"
                ? `This removes today's saved results and ratings for every player in ${confirmTarget.label}.`
                : "Results, ratings and points awarded for today's personal challenge will be removed so the complete flow can be tested again from scratch."}
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button variant="ghost" fullWidth onClick={() => setConfirmTarget(null)}>Cancel</Button>
              <Button variant="danger" fullWidth loading={resetting !== null} onClick={confirmTarget.type === "resetToday" ? executeResetTodayChallenge : executeResetMyChallenge}>
                {resetting !== null ? "Resetting…" : "Reset"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}