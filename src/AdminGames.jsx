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

const ZIP_DEFAULTS = {
  zip_grid_sizes: [7, 7, 7, 7, 7, 7, 7],
  zip_checkpoint_counts: [4, 6, 8, 10, 12, 14, 16],
  zip_wall_counts: [0, 1, 2, 3, 5, 6, 7],
  zip_black_hole_counts: [0, 0, 0, 0, 0, 0, 0],
  zip_tunnel_pair_counts: [0, 0, 0, 0, 0, 1, 1],
};
const ZIP_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ZIP_FIELDS = [
  ["zip_grid_sizes", "Grid size", 4, 9],
  ["zip_checkpoint_counts", "Checkpoints", 2, 30],
  ["zip_wall_counts", "Walls", 0, 30],
  ["zip_black_hole_counts", "Black holes", 0, 20],
  ["zip_tunnel_pair_counts", "Tunnel pairs", 0, 4],
];

function patchZipDay(row, field, dayIndex, value) {
  const values = [...(row[field] || ZIP_DEFAULTS[field])];
  values[dayIndex] = value;
  return { [field]: values };
}

function zipConfigPayload(row) {
  if (row.game_id !== "zip") return {};
  const out = {};
  for (const [field] of ZIP_FIELDS) out[field] = row[field] || ZIP_DEFAULTS[field];
  return out;
}

function T({ id }) { return `var(--${id})`; }

export default function AdminGames({ onBack }) {
  const { profile } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [saving, setSaving] = useState(null); // { gameId, field } or "reorder"
  const [message, setMessage] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [drafts, setDrafts] = useState({}); // local draft values for zip/hint fields
  const saveTimers = useRef({});

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from("game_config").select("*").order("sort_order", { ascending: true });
    if (error) { setLoadError(error.message); setLoading(false); return; }
    const known = new Set((data || []).map((r) => r.game_id));
    const missing = GAME_META.filter((g) => !known.has(g.id)).map((g, i) => ({
      game_id: g.id, visible: true, available: g.available,
      challenge_enabled: g.challenge === true,
      sort_order: (data?.length || 0) + i,
      hint_cooldown_base: 0, hint_cooldown_per_day: 0,
      zip_path_style: "solid",
      ...(g.id === "zip" ? ZIP_DEFAULTS : {}),
    }));
    setRows([...(data || []), ...missing]);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  function getDraft(gameId, field, fallback) {
    return drafts[`${gameId}:${field}`] ?? fallback;
  }
  function setDraft(gameId, field, value) {
    setDrafts((d) => ({ ...d, [`${gameId}:${field}`]: value }));
    // debounced save for numeric fields
    if (saveTimers.current[`${gameId}:${field}`]) clearTimeout(saveTimers.current[`${gameId}:${field}`]);
  }
  function saveDraftBlur(gameId, field, updateFn) {
    const key = `${gameId}:${field}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      const draftVal = drafts[key];
      if (draftVal !== undefined) {
        updateFn(gameId, draftVal, field);
        setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
      }
    }, 400);
  }

  async function updateRow(gameId, patch, savingField) {
    setSaving({ gameId, field: savingField });
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.game_id === gameId);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    const row = rows.find((r) => r.game_id === gameId);
    if (!row) { setSaving(null); return; }
    const updated = { ...row, ...patch };
    const payload = {
      game_id: gameId,
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
      setRows((prev) => prev.map((r) => (r.game_id === gameId ? row : r)));
      setMessage({ type: "error", text: `Couldn't save: ${error.message}` });
    }
  }

  function confirmResetTodayChallenge(gameId, label) { setConfirmTarget({ type: "resetToday", gameId, label }); }
  function confirmResetMyChallenge() { setConfirmTarget({ type: "resetMy" }); }

  async function executeResetTodayChallenge() {
    if (!confirmTarget || confirmTarget.type !== "resetToday") return;
    const { gameId, label } = confirmTarget;
    setConfirmTarget(null); setResetting(gameId); setMessage(null);
    const localDate = new Date().toLocaleDateString("en-CA");
    const { data, error } = await supabase.rpc("admin_reset_daily_challenge", { p_game: gameId, p_challenge_date: localDate });
    setResetting(null);
    setMessage(error ? { type: "error", text: `Reset failed: ${error.message}` } : { type: "success", text: `${label}: removed ${data ?? 0} result${data === 1 ? "" : "s"} for today.` });
  }

  async function executeResetMyChallenge() {
    setConfirmTarget(null); setResetting("all"); setMessage(null);
    const { data, error } = await supabase.rpc("admin_reset_my_challenge");
    setResetting(null);
    if (error) { setMessage({ type: "error", text: `Reset failed: ${error.message}` }); return; }
    const r = Number(data?.results_removed) || 0, rw = Number(data?.rewards_reversed) || 0, rp = Number(data?.points_reversed) || 0;
    setMessage({ type: "success", text: `Reset complete. Removed ${r} result${r === 1 ? "" : "s"}, reversed ${rw} reward${rw === 1 ? "" : "s"} (${rp} points).` });
  }

  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const prev = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    const reordered = next.map((r, i) => ({ ...r, sort_order: i }));
    setRows(reordered);
    setSaving("reorder");
    const results = await Promise.all(reordered.map((r) => supabase.from("game_config").upsert({
      game_id: r.game_id, visible: r.visible, available: r.available, challenge_enabled: r.challenge_enabled,
      sort_order: r.sort_order, hint_cooldown_base: r.hint_cooldown_base ?? 0, hint_cooldown_per_day: r.hint_cooldown_per_day ?? 0,
      zip_path_style: r.zip_path_style || "solid", ...zipConfigPayload(r),
    })));
    setSaving(null);
    const failed = results.find((r) => r.error);
    if (failed) { setRows(prev); setMessage({ type: "error", text: `Couldn't save order: ${failed.error.message}` }); }
  }

  const isBusy = (gameId) => saving === "reorder" || (saving?.gameId === gameId) || resetting === gameId || resetting === "all";
  const isSavingField = (gameId, field) => saving?.gameId === gameId && saving?.field === field;
  const challengeEnabled = (r) => typeof r.challenge_enabled === "boolean" ? r.challenge_enabled : (GAME_META.find((g) => g.id === r.game_id)?.challenge === true);

  if (!profile?.is_admin && !loading) {
    return <Page><PageHeader title="Games" onBack={onBack} /><p style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>Admin access required.</p></Page>;
  }

  return (
    <Page>
      <PageHeader title="Games" subtitle="Visibility, playability, order, maintenance settings and daily resets" onBack={onBack} />
      {message && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant={message.type} dismissible onDismiss={() => setMessage(null)}>{message.text}</StatusBanner></div>}
      {loadError && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant="error">{loadError} <Button variant="ghost" size="sm" onClick={refresh} style={{ marginLeft: 8 }}>Retry</Button></StatusBanner></div>}

      {!supabaseReady ? <StatusBanner variant="error">Supabase isn't configured yet.</StatusBanner>
        : loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ height: 96, borderRadius: "var(--radius-lg)", background: "linear-gradient(90deg, var(--color-surface-elevated), var(--color-surface), var(--color-surface-elevated))", animation: "pulse 1.5s ease-in-out infinite" }} />)}
          </div>
        ) : rows.length === 0 ? (
          <Card style={{ textAlign: "center", padding: "var(--space-8)" }}>
            <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-2)" }}>No games configured</div>
            <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)" }}>Add games to GAME_META in Home.jsx, then return here.</div>
          </Card>
        ) : (
          <>
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
                    {/* Header row */}
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                        <Button variant="icon" disabled={i === 0 || busy} onClick={() => move(i, -1)} aria-label={`Move ${meta.label} up`}>
                          <ChevronUp size={15} />
                        </Button>
                        <Button variant="icon" disabled={i === rows.length - 1 || busy} onClick={() => move(i, 1)} aria-label={`Move ${meta.label} down`}>
                          <ChevronDown size={15} />
                        </Button>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: `${meta.accent}22`, display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <Icon size={21} style={{ color: meta.accent }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "var(--text-body-size)", fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.3 }} className="truncate">{meta.label}</div>
                        <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{meta.desc}</div>
                      </div>
                    </div>

                    {/* Setting rows */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                      <SettingRow label="Show on Home" checked={r.visible} loading={isSavingField(r.game_id, "visible")} busy={busy} onChange={() => updateRow(r.game_id, { visible: !r.visible }, "visible")} />
                      <SettingRow label="Playable" checked={r.available} loading={isSavingField(r.game_id, "available")} busy={busy} onChange={() => updateRow(r.game_id, { available: !r.available }, "available")} />
                      {!meta.live && (
                        <SettingRow label="Available in Challenges" checked={ce} loading={isSavingField(r.game_id, "challenge_enabled")} busy={busy || !meta.challenge || !r.available} onChange={() => updateRow(r.game_id, { challenge_enabled: !ce }, "challenge_enabled")} />
                      )}
                    </div>

                    {/* Expand + Reset */}
                    <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                      <Button variant="secondary" size="sm" before={<Wrench size={14} />} after={isExpanded ? <ChevronRight size={14} style={{ transform: "rotate(90deg)", transition: "transform var(--transition-fast)" }} /> : <ChevronRight size={14} style={{ transition: "transform var(--transition-fast)" }} />} onClick={() => setExpanded(isExpanded ? null : r.game_id)} aria-expanded={isExpanded} aria-controls={`settings-${r.game_id}`}>
                        {isExpanded ? "Hide" : "Settings"}
                      </Button>
                      <Button variant="danger" size="sm" before={<Eraser size={14} />} loading={resetting === r.game_id} disabled={!r.available || resetting !== null} onClick={() => confirmResetTodayChallenge(r.game_id, meta.label)}>
                        Reset today
                      </Button>
                    </div>

                    {/* Settings panel */}
                    {isExpanded && (
                      <div id={`settings-${r.game_id}`} role="region" aria-label={`${meta.label} game settings`} style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                        <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-3)" }}>Hint cooldowns</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                          <label>
                            <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Base (sec)</span>
                            <TextInput type="number" min={0} value={getDraft(r.game_id, "hint_cooldown_base", r.hint_cooldown_base || 0)} onChange={(e) => setDraft(r.game_id, "hint_cooldown_base", Math.max(0, parseInt(e.target.value) || 0))} onBlur={() => { const v = getDraft(r.game_id, "hint_cooldown_base", r.hint_cooldown_base || 0); if (v !== (r.hint_cooldown_base || 0)) updateRow(r.game_id, { hint_cooldown_base: v }, "hint_cooldown_base"); setDrafts((d) => { const n = { ...d }; delete n[`${r.game_id}:hint_cooldown_base`]; return n; }); }} />
                          </label>
                          <label>
                            <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Per day (sec)</span>
                            <TextInput type="number" min={0} value={getDraft(r.game_id, "hint_cooldown_per_day", r.hint_cooldown_per_day || 0)} onChange={(e) => setDraft(r.game_id, "hint_cooldown_per_day", Math.max(0, parseInt(e.target.value) || 0))} onBlur={() => { const v = getDraft(r.game_id, "hint_cooldown_per_day", r.hint_cooldown_per_day || 0); if (v !== (r.hint_cooldown_per_day || 0)) updateRow(r.game_id, { hint_cooldown_per_day: v }, "hint_cooldown_per_day"); setDrafts((d) => { const n = { ...d }; delete n[`${r.game_id}:hint_cooldown_per_day`]; return n; }); }} />
                          </label>
                        </div>

                        {r.game_id === "zip" && (
                          <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                            <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-3)" }}>Snake appearance</div>
                            <select value={r.zip_path_style || "solid"} onChange={(e) => updateRow(r.game_id, { zip_path_style: e.target.value }, "zip_path_style")}
                              style={{ width: "100%", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border-strong)", padding: "8px 12px", fontSize: "var(--text-input-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box", fontFamily: "inherit" }}>
                              <option value="solid">Thick solid green</option>
                              <option value="rainbow">Original rainbow</option>
                            </select>
                            <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: 4 }}>Both styles keep tunnel jumps visually disconnected.</div>

                            <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
                              <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>Daily puzzle complexity</div>
                              <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginBottom: "var(--space-3)" }}>Changes apply to newly generated puzzles.</div>
                              {ZIP_DAY_LABELS.map((day, di) => (
                                <div key={day} style={{ marginBottom: "var(--space-3)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)", border: "1px solid var(--color-border)" }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-2)" }}>{day}</div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                                    {ZIP_FIELDS.map(([field, label, min, max]) => {
                                      const currentVal = (r[field] || ZIP_DEFAULTS[field])[di];
                                      return (
                                        <label key={field} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{label}</span>
                                          <TextInput type="number" min={min} max={max} value={getDraft(r.game_id, `${field}:${di}`, currentVal)}
                                            onChange={(e) => { const p = Number.parseInt(e.target.value, 10); setDraft(r.game_id, `${field}:${di}`, Number.isFinite(p) ? p : ""); }}
                                            onBlur={() => {
                                              const v = getDraft(r.game_id, `${field}:${di}`, currentVal);
                                              if (Number.isFinite(v) && v !== currentVal) updateRow(r.game_id, patchZipDay(r, field, di, Math.min(max, Math.max(min, v))), `${field}:${di}`);
                                              setDrafts((d) => { const n = { ...d }; delete n[`${r.game_id}:${field}:${di}`]; return n; });
                                            }}
                                            aria-label={`${day} ${label}`}
                                            style={{ textAlign: "center" }} />
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Maintenance (below games) */}
            <Card style={{ borderColor: "var(--color-danger-text)", borderLeft: "3px solid var(--color-danger-text)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Hard reset My Challenge</div>
                  <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>Clears personal results and reverses point awards for end-to-end testing.</div>
                </div>
                <Button variant="danger" size="sm" loading={resetting === "all"} before={<RotateCcw size={14} />} onClick={confirmResetMyChallenge}>
                  {resetting === "all" ? "Resetting…" : "Reset all"}
                </Button>
              </div>
            </Card>
          </>
        )}

      {/* Confirmation modal */}
      {confirmTarget && (
        <div role="dialog" aria-modal="true" aria-labelledby="ag-confirm-title" aria-describedby="ag-confirm-desc" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)", background: "var(--color-overlay)" }} onClick={(e) => { if (e.target === e.currentTarget) setConfirmTarget(null); }}>
          <Card style={{ maxWidth: 400, width: "100%", padding: "var(--space-5)" }}>
            <div id="ag-confirm-title" style={{ fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "var(--space-1)" }}>
              {confirmTarget.type === "resetToday" ? `Reset today's ${confirmTarget.label} challenge?` : "Hard reset My Challenge?"}
            </div>
            <div id="ag-confirm-desc" style={{ fontSize: "var(--text-body-size)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
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

/** Binary setting row with left label + right toggle button. */
function SettingRow({ label, checked, loading, busy, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-primary)" }}>{label}</span>
      <Button variant="secondary" size="sm" loading={loading} disabled={busy && !loading} onClick={onChange}>
        {checked ? "On" : "Off"}
      </Button>
    </div>
  );
}