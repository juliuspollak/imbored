import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronUp, ChevronDown, Wrench, Eraser, RotateCcw, ChevronRight } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { GAME_META } from "./Home.jsx";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import TextInput from "./components/TextInput.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

// Must match the phrase admin_reset_all_stats() checks server-side, so the
// database refuses the call even if this guard is ever bypassed.
const RESET_ALL_PHRASE = "RESET ALL STATS";

const GRIDLY_DEFAULTS = {
  zip_grid_sizes: [7, 7, 7, 7, 7, 7, 7],
  zip_checkpoint_counts: [4, 6, 8, 10, 12, 14, 16],
  zip_wall_counts: [0, 1, 2, 3, 5, 6, 7],
  zip_black_hole_counts: [0, 0, 0, 0, 0, 0, 0],
  zip_tunnel_pair_counts: [0, 0, 0, 0, 0, 1, 1],
};
const GRIDLY_FIELDS = [
  ["zip_grid_sizes", "Grid size", 4, 9],
  ["zip_checkpoint_counts", "Checkpoints", 2, 30],
  ["zip_wall_counts", "Walls", 0, 30],
  ["zip_black_hole_counts", "Black holes", 0, 20],
  ["zip_tunnel_pair_counts", "Tunnel pairs", 0, 4],
];

function patchGridlyDay(row, field, dayIndex, value) {
  const values = [...(row[field] || GRIDLY_DEFAULTS[field])];
  values[dayIndex] = value;
  return { [field]: values };
}

function gridlyConfigPayload(row) {
  if (row.game_id !== "gridly") return {};
  const out = {};
  for (const [field] of GRIDLY_FIELDS) out[field] = row[field] || GRIDLY_DEFAULTS[field];
  return out;
}

/** Shared Switch component for binary on/off controls. */
function Switch({ checked, loading, disabled, onChange, ariaLabel }) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={isDisabled}
      onClick={onChange}
      style={{
        position: "relative",
        width: 44,
        height: 24,
        borderRadius: 12,
        border: "none",
        background: checked ? "var(--color-primary)" : "var(--color-border-strong)",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.5 : 1,
        transition: "background var(--transition-fast)",
        flexShrink: 0,
      }}
    >
      {loading && (
        <span style={{ position: "absolute", left: checked ? "calc(100% - 19px)" : 3, top: 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: 10, height: 10, border: "1.5px solid rgba(0,0,0,0.2)", borderTopColor: "var(--color-primary)", borderRadius: "50%", animation: "ds-switch-spin 0.5s linear infinite" }} />
        </span>
      )}
      {!loading && (
        <span style={{ position: "absolute", left: checked ? "calc(100% - 19px)" : 3, top: 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left var(--transition-fast)" }} />
      )}
      <style>{`@keyframes ds-switch-spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}

/** Setting row with label + Switch. */
function SettingRow({ label, checked, loading, disabled, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-primary)" }}>{label}</span>
      <Switch checked={checked} loading={loading} disabled={disabled} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

export default function AdminGames({ onBack }) {
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [saving, setSaving] = useState(null); // { gameId, field } or "reorder"
  const [message, setMessage] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [drafts, setDrafts] = useState({});
  const [savedFields, setSavedFields] = useState({}); // temporary "Saved" indicators
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) { setLoading(false); return; }
    setLoading(true); setLoadError(null);
    const { data, error } = await supabase.from("game_config").select("*").order("sort_order", { ascending: true });
    if (error) { setLoadError(error.message); setLoading(false); return; }
    const known = new Set((data || []).map((r) => r.game_id));
    const missing = GAME_META.filter((g) => !known.has(g.id)).map((g, i) => ({
      game_id: g.id, visible: true, available: g.available,
      challenge_enabled: g.challenge === true, sort_order: (data?.length || 0) + i,
      hint_cooldown_base: 0, hint_cooldown_per_day: 0, zip_path_style: "solid", rush_spin_seconds: 14,
      ...(g.id === "gridly" ? GRIDLY_DEFAULTS : {}),
    }));
    setRows([...(data || []), ...missing]); setLoading(false);
  }, [isAdmin]);
  useEffect(() => { refresh(); }, [refresh]);

  function getDraft(gameId, field, fallback) { return drafts[`${gameId}:${field}`] ?? fallback; }
  function setDraft(gameId, field, value) { setDrafts((d) => ({ ...d, [`${gameId}:${field}`]: value })); }

  async function updateRow(gameId, patch, savingField) {
    setSaving({ gameId, field: savingField });
    const currentRow = rowsRef.current.find((r) => r.game_id === gameId);
    if (!currentRow) { setSaving(null); return; }
    const updated = { ...currentRow, ...patch };
    setRows((prev) => prev.map((r) => (r.game_id === gameId ? updated : r)));
    const payload = {
      game_id: gameId, visible: updated.visible, available: updated.available,
      sort_order: updated.sort_order,
      hint_cooldown_base: updated.hint_cooldown_base ?? 0,
      hint_cooldown_per_day: updated.hint_cooldown_per_day ?? 0,
      zip_path_style: updated.zip_path_style || "solid",
      // This is an upsert of the whole row, so every configurable column has
      // to be present — omitting one silently resets it to its default the
      // next time any other setting on the same game is saved.
      rush_spin_seconds: updated.rush_spin_seconds ?? 14,
      ...gridlyConfigPayload(updated),
    };
    if (Object.prototype.hasOwnProperty.call(updated, "challenge_enabled")) {
      payload.challenge_enabled = updated.challenge_enabled;
    }
    const { error } = await supabase.from("game_config").upsert(payload);
    setSaving(null);
    if (error) {
      // Roll back only the field(s) that failed
      setRows((prev) => prev.map((r) => (r.game_id === gameId ? currentRow : r)));
      setMessage({ type: "error", text: `Couldn't save: ${error.message}` });
    } else {
      // Show brief "Saved" indicator
      const key = `${gameId}:${savingField}`;
      setSavedFields((s) => ({ ...s, [key]: true }));
      setTimeout(() => setSavedFields((s) => { const n = { ...s }; delete n[key]; return n; }), 1500);
    }
  }

  function confirmResetTodayChallenge(gameId, label) { setConfirmTarget({ type: "resetToday", gameId, label }); }
  // Named admin_reset_my_challenge() server-side, but the "my" is a misnomer:
  // it filters on challenge_date only, so it clears today's personal challenge
  // for every player. The wording here says so rather than inheriting it.
  function confirmResetPersonalChallengeToday() { setConfirmTarget({ type: "resetPersonalToday" }); }

  // The phrase has to be typed rather than clicked. This is unrecoverable, and
  // it sits next to two much narrower reset buttons — a plain confirm would be
  // one mis-tap away from wiping every player's history.
  async function executeResetAllStats() {
    if (confirmPhrase !== RESET_ALL_PHRASE) return;
    setConfirmTarget(null); setResetting("everything"); setMessage(null);
    const { data, error } = await supabase.rpc("admin_reset_all_stats", {
      confirmation: RESET_ALL_PHRASE,
      target_player: null,
      reset_benchmarks: true,
    });
    setResetting(null); setConfirmPhrase("");
    if (error) { setMessage({ type: "error", text: `Reset failed: ${error.message}` }); return; }
    const results = Number(data?.results_removed) || 0;
    const players = Number(data?.players_reset) || 0;
    const reopened = Number(data?.challenges_reopened) || 0;
    setMessage({ type: "success", text: `Reset complete. Removed ${results} result${results === 1 ? "" : "s"}, cleared ${players} player${players === 1 ? "" : "s"}, reopened ${reopened} challenge${reopened === 1 ? "" : "s"}.` });
  }

  async function executeResetTodayChallenge() {
    if (!confirmTarget || confirmTarget.type !== "resetToday") return;
    const { gameId, label } = confirmTarget;
    setConfirmTarget(null); setResetting(gameId); setMessage(null);
    const localDate = new Date().toLocaleDateString("en-CA");
    const { data, error } = await supabase.rpc("admin_reset_daily_challenge", { p_game: gameId, p_challenge_date: localDate });
    setResetting(null);
    setMessage(error ? { type: "error", text: `Reset failed: ${error.message}` } : { type: "success", text: `${label}: removed ${data ?? 0} result${data === 1 ? "" : "s"} from today's personal challenge, across all players.` });
  }

  async function executeResetPersonalChallengeToday() {
    setConfirmTarget(null); setResetting("all"); setMessage(null);
    const { data, error } = await supabase.rpc("admin_reset_my_challenge");
    setResetting(null);
    if (error) { setMessage({ type: "error", text: `Reset failed: ${error.message}` }); return; }
    const r = Number(data?.results_removed) || 0, rw = Number(data?.rewards_reversed) || 0, rp = Number(data?.points_reversed) || 0;
    const clocks = Number(data?.attempt_clocks_cleared) || 0;
    setMessage({ type: "success", text: `Today's personal challenge is clear. Removed ${r} result${r === 1 ? "" : "s"} and took back ${rw} award${rw === 1 ? "" : "s"} (${rp} points), across all players. Reset ${clocks} attempt clock${clocks === 1 ? "" : "s"}, so replays start from zero.` });
  }

  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const prev = rowsRef.current;
    const next = [...prev];
    [next[index], next[target]] = [next[target], next[index]];
    const reordered = next.map((r, i) => ({ ...r, sort_order: i }));
    setRows(reordered);
    setSaving("reorder");
    const results = await Promise.all(reordered.map((r) => supabase.from("game_config").upsert({
      game_id: r.game_id, visible: r.visible, available: r.available, challenge_enabled: r.challenge_enabled,
      sort_order: r.sort_order, hint_cooldown_base: r.hint_cooldown_base ?? 0, hint_cooldown_per_day: r.hint_cooldown_per_day ?? 0,
      zip_path_style: r.zip_path_style || "solid", rush_spin_seconds: r.rush_spin_seconds ?? 14, ...gridlyConfigPayload(r),
    })));
    setSaving(null);
    const failed = results.find((r) => r.error);
    if (failed) { setRows(prev); setMessage({ type: "error", text: `Couldn't save order: ${failed.error.message}` }); }
  }

  // Keyboard: Escape closes modal
  useEffect(() => {
    if (!confirmTarget) return;
    function onKey(e) { if (e.key === "Escape") setConfirmTarget(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmTarget]);

  const isBusy = (gameId) => saving === "reorder" || (saving?.gameId === gameId) || resetting === gameId || resetting === "all";
  const anythingBusy = saving === "reorder" || saving?.gameId || resetting;
  const isSavingField = (gameId, field) => saving?.gameId === gameId && saving?.field === field;
  const challengeEnabled = (r) => typeof r.challenge_enabled === "boolean" ? r.challenge_enabled : (GAME_META.find((g) => g.id === r.game_id)?.challenge === true);
  const isFieldSaved = (gameId, field) => !!savedFields[`${gameId}:${field}`];

  if (authLoading) {
    return <Page><PageHeader title="Games" onBack={onBack} /><div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>{[0,1,2].map((i) => <div key={i} style={{ height: 96, borderRadius: "var(--radius-lg)", background: "linear-gradient(90deg, var(--color-surface-elevated), var(--color-surface), var(--color-surface-elevated))", animation: "pulse 1.5s ease-in-out infinite" }} />)}</div></Page>;
  }

  if (!isAdmin) {
    return <Page><PageHeader title="Games" onBack={onBack} /><Card style={{ textAlign: "center", padding: "var(--space-8)" }}><div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Admin access required</div></Card></Page>;
  }

  return (
    <Page>
      <PageHeader title="Games" subtitle="Changes save as you make them — number fields save when you tap away" onBack={onBack} />
      {message && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant={message.type} dismissible onDismiss={() => setMessage(null)}>{message.text}</StatusBanner></div>}
      {loadError && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant="error" dismissible onDismiss={() => setLoadError(null)}>{loadError}</StatusBanner></div>}

      {!supabaseReady ? <StatusBanner variant="error">Supabase isn't configured yet.</StatusBanner>
        : loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ height: 96, borderRadius: "var(--radius-lg)", background: "linear-gradient(90deg, var(--color-surface-elevated), var(--color-surface), var(--color-surface-elevated))", animation: "pulse 1.5s ease-in-out infinite" }} />)}
          </div>
        ) : loadError ? null : rows.length === 0 ? (
          <Card style={{ textAlign: "center", padding: "var(--space-8)" }}>
            <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-2)" }}>No games are currently configured</div>
            <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)" }}>Game definitions are loaded from the application configuration.</div>
            <Button variant="secondary" size="sm" onClick={refresh} style={{ marginTop: "var(--space-3)" }}>Retry</Button>
          </Card>
        ) : (
          <>
            {loadError && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant="error" dismissible onDismiss={() => setLoadError(null)}>{loadError} <Button variant="ghost" size="sm" onClick={refresh} style={{ marginLeft: 8 }}>Retry</Button></StatusBanner></div>}

            {/* Game cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--section-gap)" }}>
              {rows.map((r, i) => {
                const meta = GAME_META.find((g) => g.id === r.game_id);
                if (!meta) return null;
                const Icon = meta.icon;
                const isExpanded = expanded === r.game_id;
                const ce = challengeEnabled(r);
                const busy = isBusy(r.game_id);

                return (
                  <Card key={r.game_id} style={{ padding: "var(--space-4)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                        <Button variant="icon" disabled={i === 0 || busy} onClick={() => move(i, -1)} aria-label={`Move ${meta.label} up`}><ChevronUp size={15} /></Button>
                        <Button variant="icon" disabled={i === rows.length - 1 || busy} onClick={() => move(i, 1)} aria-label={`Move ${meta.label} down`}><ChevronDown size={15} /></Button>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: `${meta.accent}22`, display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <Icon size={21} style={{ color: meta.accent }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "var(--text-body-size)", fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.3 }} className="truncate">{meta.label}</div>
                        <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{meta.desc}</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                      <SettingRow label="Show on Home" checked={r.visible} loading={isSavingField(r.game_id, "visible")} disabled={busy} onChange={() => updateRow(r.game_id, { visible: !r.visible }, "visible")} />
                      <SettingRow label="Playable" checked={r.available} loading={isSavingField(r.game_id, "available")} disabled={busy} onChange={() => updateRow(r.game_id, { available: !r.available }, "available")} />
                      {!meta.live && <SettingRow label="Available in Challenges" checked={ce} loading={isSavingField(r.game_id, "challenge_enabled")} disabled={busy || !meta.challenge || !r.available} onChange={() => updateRow(r.game_id, { challenge_enabled: !ce }, "challenge_enabled")} />}
                      {["visible", "available", "challenge_enabled"].some((f) => isFieldSaved(r.game_id, f)) && <SavedIndicator />}
                    </div>

                    <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                      <Button variant="secondary" size="sm" before={<Wrench size={14} />} after={isExpanded ? <ChevronRight size={14} style={{ transform: "rotate(90deg)", transition: "transform var(--transition-fast)" }} /> : <ChevronRight size={14} style={{ transition: "transform var(--transition-fast)" }} />} disabled={saving === "reorder" || !!resetting} onClick={() => setExpanded(isExpanded ? null : r.game_id)} aria-expanded={isExpanded} aria-controls={`settings-${r.game_id}`}>
                        {isExpanded ? "Hide" : "Settings"}
                      </Button>
                      <Button variant="ghost" size="sm" before={<Eraser size={14} />} loading={resetting === r.game_id} disabled={!r.available || anythingBusy} onClick={() => confirmResetTodayChallenge(r.game_id, meta.label)} style={{ color: "var(--color-danger-text)" }}>
                        Reset today
                      </Button>
                    </div>

                    {isExpanded && (
                      <div id={`settings-${r.game_id}`} role="region" aria-label={`${meta.label} game settings`} style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                        <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-3)" }}>Hint cooldowns</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                          <label>
                            <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Base (sec)</span>
                            <TextInput type="number" min={0} disabled={isSavingField(r.game_id, "hint_cooldown_base")} value={getDraft(r.game_id, "hint_cooldown_base", r.hint_cooldown_base || 0)} onChange={(e) => { const p = Number.parseInt(e.target.value, 10); setDraft(r.game_id, "hint_cooldown_base", Number.isFinite(p) ? p : ""); }} onBlur={() => { const v = getDraft(r.game_id, "hint_cooldown_base", r.hint_cooldown_base || 0); const resolved = v === "" || !Number.isFinite(v) ? 0 : v; if (resolved !== (r.hint_cooldown_base || 0)) updateRow(r.game_id, { hint_cooldown_base: resolved }, "hint_cooldown_base"); setDrafts((d) => { const n = { ...d }; delete n[`${r.game_id}:hint_cooldown_base`]; return n; }); }} />
                            {isFieldSaved(r.game_id, "hint_cooldown_base") && <SavedIndicator />}
                          </label>
                          <label>
                            <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Per day (sec)</span>
                            <TextInput type="number" min={0} disabled={isSavingField(r.game_id, "hint_cooldown_per_day")} value={getDraft(r.game_id, "hint_cooldown_per_day", r.hint_cooldown_per_day || 0)} onChange={(e) => { const p = Number.parseInt(e.target.value, 10); setDraft(r.game_id, "hint_cooldown_per_day", Number.isFinite(p) ? p : ""); }} onBlur={() => { const v = getDraft(r.game_id, "hint_cooldown_per_day", r.hint_cooldown_per_day || 0); const resolved = v === "" || !Number.isFinite(v) ? 0 : v; if (resolved !== (r.hint_cooldown_per_day || 0)) updateRow(r.game_id, { hint_cooldown_per_day: resolved }, "hint_cooldown_per_day"); setDrafts((d) => { const n = { ...d }; delete n[`${r.game_id}:hint_cooldown_per_day`]; return n; }); }} />
                            {isFieldSaved(r.game_id, "hint_cooldown_per_day") && <SavedIndicator />}
                          </label>
                        </div>

                        {r.game_id === "animalrush" && (
                          <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                            <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-3)" }}>Hard mode spin</div>
                            <label>
                              <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Seconds per full turn</span>
                              <TextInput
                                type="number"
                                min={0}
                                max={120}
                                disabled={isSavingField(r.game_id, "rush_spin_seconds")}
                                value={getDraft(r.game_id, "rush_spin_seconds", r.rush_spin_seconds ?? 14)}
                                onChange={(e) => { const p = Number.parseInt(e.target.value, 10); setDraft(r.game_id, "rush_spin_seconds", Number.isFinite(p) ? p : ""); }}
                                onBlur={() => {
                                  const v = getDraft(r.game_id, "rush_spin_seconds", r.rush_spin_seconds ?? 14);
                                  const resolved = v === "" || !Number.isFinite(v) ? 14 : Math.max(0, Math.min(120, v));
                                  if (resolved !== (r.rush_spin_seconds ?? 14)) updateRow(r.game_id, { rush_spin_seconds: resolved }, "rush_spin_seconds");
                                  setDrafts((d) => { const n = { ...d }; delete n[`${r.game_id}:rush_spin_seconds`]; return n; });
                                }}
                              />
                              <span style={{ display: "block", marginTop: 6, fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                                Lower spins faster — 8 is mean, 14 is steady, 20 is gentle. Set 0 to stop the spin and leave hard mode on fixed card angles.
                              </span>
                              {isFieldSaved(r.game_id, "rush_spin_seconds") && <SavedIndicator />}
                            </label>
                          </div>
                        )}

                        {r.game_id === "gridly" && (
                          <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                            <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-3)" }}>Snake appearance</div>
                            <select value={r.zip_path_style || "solid"} onChange={(e) => updateRow(r.game_id, { zip_path_style: e.target.value }, "zip_path_style")} disabled={busy}
                              style={{ width: "100%", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border-strong)", padding: "8px 12px", fontSize: "var(--text-input-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box", fontFamily: "inherit" }}>
                              <option value="solid">Thick solid green</option>
                              <option value="rainbow">Original rainbow</option>
                            </select>
                            <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: 4 }}>Both styles keep tunnel jumps visually disconnected.</div>

                            <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                              <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>Daily puzzle complexity</div>
                              <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginBottom: "var(--space-3)" }}>Changes apply to newly generated puzzles.</div>
                              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, di) => {
                                const dayBusy = isSavingField(r.game_id, `gridly:${di}:any`);
                                return (
                                  <div key={day} style={{ marginBottom: "var(--space-3)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)", border: "1px solid var(--color-border)" }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-2)" }}>{day}</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                                      {GRIDLY_FIELDS.map(([field, label, min, max]) => {
                                        const currentVal = (r[field] || GRIDLY_DEFAULTS[field])[di];
                                        const draftKey = `${field}:${di}`;
                                        const fieldSavingKey = `${field}:${di}`;
                                        return (
                                          <label key={field} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{label} ({min}–{max})</span>
                                            <TextInput type="number" min={min} max={max} disabled={isSavingField(r.game_id, fieldSavingKey)}
                                              value={getDraft(r.game_id, draftKey, currentVal)}
                                              onChange={(e) => { const p = Number.parseInt(e.target.value, 10); setDraft(r.game_id, draftKey, Number.isFinite(p) ? p : ""); }}
                                              onBlur={() => {
                                                const raw = getDraft(r.game_id, draftKey, currentVal);
                                                const v = raw === "" || !Number.isFinite(raw) ? currentVal : Math.min(max, Math.max(min, raw));
                                                if (v !== currentVal) {
                                                  if (v !== raw) setMessage({ type: "info", text: `${day} ${label} adjusted to ${v} (allowed: ${min}–${max}).` });
                                                  updateRow(r.game_id, patchGridlyDay(r, field, di, v), fieldSavingKey);
                                                }
                                                setDrafts((d) => { const n = { ...d }; delete n[`${r.game_id}:${draftKey}`]; return n; });
                                              }}
                                              aria-label={`${day} ${label}`}
                                              style={{ textAlign: "center" }} />
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Maintenance */}
            <Card variant="danger" style={{ borderLeft: "3px solid var(--color-danger-text)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Reset today&rsquo;s personal challenge</div>
                  <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>
                    Every game, <strong>every player</strong> &mdash; not only your own results. Removes today&rsquo;s personal-challenge results and ratings and takes back the points they earned. Circle challenges are left alone.
                  </div>
                </div>
                <Button variant="danger" size="sm" loading={resetting === "all"} disabled={anythingBusy && resetting !== "all"} before={<RotateCcw size={14} />} onClick={confirmResetPersonalChallengeToday}>
                  {resetting === "all" ? "Resetting…" : "Reset for everyone"}
                </Button>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap", marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                <div>
                  <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Reset every player&rsquo;s statistics, all time</div>
                  <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>
                    Not just today: wipes all results, points, levels and streaks for everybody, reopens closed circle challenges and clears the time benchmarks. Accounts, circles and reward items are kept. This cannot be undone.
                  </div>
                </div>
                <Button variant="danger" size="sm" loading={resetting === "everything"} disabled={anythingBusy && resetting !== "everything"} before={<Eraser size={14} />} onClick={() => { setConfirmPhrase(""); setConfirmTarget({ type: "resetAll" }); }}>
                  {resetting === "everything" ? "Resetting…" : "Reset everything"}
                </Button>
              </div>
            </Card>
          </>
        )}

      {/* Confirmation modal — no backdrop dismissal for destructive actions */}
      {confirmTarget && (
        <div role="dialog" aria-modal="true" aria-labelledby="ag-confirm-title" aria-describedby="ag-confirm-desc" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)", background: "var(--color-overlay)" }}>
          <Card style={{ maxWidth: 400, width: "100%", padding: "var(--space-5)" }}>
            <div id="ag-confirm-title" style={{ fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "var(--space-1)" }}>
              {confirmTarget.type === "resetToday"
                ? `Reset today's ${confirmTarget.label} for every player?`
                : confirmTarget.type === "resetAll"
                  ? "Reset every player's statistics, all time?"
                  : "Reset today's personal challenge for every player?"}
            </div>
            <div id="ag-confirm-desc" style={{ fontSize: "var(--text-body-size)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
              {confirmTarget.type === "resetToday"
                ? `Removes today's personal-challenge results and ratings for ${confirmTarget.label} and takes back the points they earned — for every player, not only you. Other games and all circle challenges are untouched.`
                : confirmTarget.type === "resetAll"
                  ? "Every player loses their results, points, level and streaks, for every day on record. Closed circle challenges reopen and the time benchmarks go back to their starting values. Accounts, circles and reward items are kept. This cannot be undone."
                  : "Removes today's personal-challenge results and ratings in every game and takes back the points they earned — for every player, not only you. Circle challenges and every earlier day are untouched. Stops without changing anything if a player has already spent or sent points earned today."}
            </div>
            {confirmTarget.type === "resetAll" && (
              <label style={{ display: "block", marginBottom: "var(--space-4)" }}>
                <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-1)" }}>
                  Type <code>{RESET_ALL_PHRASE}</code> to confirm
                </span>
                <TextInput
                  value={confirmPhrase}
                  onChange={(event) => setConfirmPhrase(event.target.value)}
                  placeholder={RESET_ALL_PHRASE}
                  autoFocus
                />
              </label>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button variant="ghost" fullWidth onClick={() => { setConfirmTarget(null); setConfirmPhrase(""); }}>Cancel</Button>
              <Button
                variant="danger"
                fullWidth
                loading={resetting !== null}
                disabled={confirmTarget.type === "resetAll" && confirmPhrase !== RESET_ALL_PHRASE}
                onClick={confirmTarget.type === "resetToday"
                  ? executeResetTodayChallenge
                  : confirmTarget.type === "resetAll"
                    ? executeResetAllStats
                    : executeResetPersonalChallengeToday}
              >
                {resetting !== null ? "Resetting…" : "Reset"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}

function SavedIndicator() {
  return <div style={{ fontSize: 11, color: "var(--color-success-text)", fontWeight: 500, marginTop: -2 }}>✓ Saved</div>;
}
