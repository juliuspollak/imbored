import { useCallback, useEffect, useState } from "react";
import { Gift, Check, X, Trash2 } from "lucide-react";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

const TABS = [["ideas", "Ideas"], ["active", "In progress"], ["finished", "Finished"]];

export default function OrganiserRewards({ onBack }) {
  const { user } = useAuth();
  const [tab, setTab] = useState("ideas");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [active, setActive] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [finished, setFinished] = useState([]);
  const [priceTarget, setPriceTarget] = useState(null);
  const [priceValue, setPriceValue] = useState("");
  const [stockValue, setStockValue] = useState("");
  const [working, setWorking] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: i }, { data: a }, { data: cat }, { data: f }] = await Promise.all([
      supabase.rpc("list_organiser_ideas"),
      supabase.rpc("list_organiser_active_requests"),
      supabase.rpc("list_organiser_reward_catalog"),
      supabase.rpc("list_organiser_finished_requests"),
    ]);
    setIdeas(i || []); setActive(a || []); setCatalog(cat || []); setFinished(f || []); setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  function openPrice(reward, mode) { setPriceTarget({ reward, mode }); setPriceValue(""); setStockValue(""); }
  async function submitPrice() {
    if (!priceTarget || !priceValue || working) return;
    setWorking("price");
    const { error } = await supabase.rpc("price_reward", {
      target_reward_id: priceTarget.reward.id,
      points_cost: Number(priceValue),
      mode: priceTarget.mode,
      stock_quantity: priceTarget.mode === "available" && priceTarget.reward.reward_type === "limited" ? Number(stockValue) || null : null,
    });
    setWorking(""); setMessage(error?.message || "Updated"); if (!error) { setPriceTarget(null); refresh(); }
  }
  async function declineIdea(id) { setWorking(id); const { error } = await supabase.rpc("reject_reward", { target_reward_id: id }); setWorking(""); setMessage(error?.message || "Declined"); refresh(); }
  async function markGiven(id) { setWorking(id); const { error } = await supabase.rpc("fulfill_reward", { target_redemption_id: id }); setWorking(""); setMessage(error?.message || "Marked given"); refresh(); }
  async function resolveCancellation(id, approve) { setWorking(id); const { error } = await supabase.rpc("resolve_cancellation", { target_redemption_id: id, approve }); setWorking(""); setMessage(error?.message || (approve ? "Cancelled" : "Kept")); refresh(); }
  async function removeReward(id, hasHistory) {
    setWorking(`remove-${id}`);
    const { error } = await supabase.rpc("force_delete_reward", { target_reward_id: id, remove_history: hasHistory });
    setWorking(""); setRemoveTarget(null); setMessage(error?.message || "Removed"); refresh();
  }

  if (loading) return <Page><p style={{ textAlign: "center", padding: "var(--space-8) 0", color: "var(--color-text-secondary)" }}>Loading…</p></Page>;

  return (
    <Page>
      <PageHeader title="Organise rewards" onBack={onBack} />
      {message && <div style={{ marginBottom: "var(--space-3)" }}><StatusBanner variant="info" dismissible onDismiss={() => setMessage("")}>{message}</StatusBanner></div>}

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
        {TABS.map(([id, label]) => {
          const count = id === "ideas" ? ideas.filter((r) => r.status === "suggested").length : id === "active" ? active.filter((r) => r.cancellation_requested_at).length : 0;
          return <Button key={id} variant={tab === id ? "primary" : "secondary"} size="sm" onClick={() => setTab(id)} style={{ flex: 1 }}>{label}{count > 0 && <span style={{ background: "rgba(255,255,255,.2)", borderRadius: "var(--radius-full)", padding: "0 6px", fontSize: 10, marginLeft: 4 }}>{count}</span>}</Button>;
        })}
      </div>

      {tab === "ideas" && <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {ideas.length === 0 ? <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>No new ideas right now.</p>
          : ideas.map((r) => <Card key={r.id} style={{ padding: "var(--space-3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
              <div style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{r.name}</div>
              <span style={{ fontSize: 10, color: "var(--color-text-secondary)", flexShrink: 0 }}>{r.reward_type}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, marginBottom: "var(--space-2)" }}>{r.circle_name} · suggested by {r.creator_icon} {r.creator_name}{r.status === "pending" ? ` · ${r.approve_count}/${r.required_count} votes` : ""}</div>
            {r.status === "suggested" ? <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
              <Button size="sm" variant="primary" onClick={() => openPrice(r, "available")}>Make available</Button>
              <Button size="sm" variant="secondary" onClick={() => openPrice(r, "vote")}>Put to a vote</Button>
              <Button size="sm" variant="ghost" disabled={!!working} onClick={() => declineIdea(r.id)} style={{ color: "var(--color-danger-text)" }}>Not this time</Button>
              {removeTarget !== r.id && <Button size="sm" variant="ghost" before={<Trash2 size={12} />} disabled={!!working} onClick={() => setRemoveTarget(r.id)} style={{ color: "var(--color-danger-text)" }}>Remove</Button>}
            </div> : <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)" }}>Voting in progress</span>
              {removeTarget !== r.id && <Button size="sm" variant="ghost" before={<Trash2 size={12} />} onClick={() => setRemoveTarget(r.id)} style={{ color: "var(--color-danger-text)" }}>Remove</Button>}
            </div>}
            {removeTarget === r.id && <div style={{ marginTop: "var(--space-3)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)", background: "var(--color-danger-subtle-bg)" }}>
              <div style={{ fontSize: 11, color: "var(--color-danger-text)", marginBottom: "var(--space-2)" }}>{r.has_history ? "This reward has redemption history. Remove it and erase its history?" : "Remove this reward?"}</div>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(null)}>Cancel</Button>
                <Button size="sm" variant="danger" loading={working === `remove-${r.id}`} onClick={() => removeReward(r.id, r.has_history)}>{r.has_history ? "Remove and erase history" : "Remove"}</Button>
              </div>
            </div>}
          </Card>)}
      </div>}

      {tab === "active" && <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {catalog.length > 0 && <div style={{ marginBottom: "var(--space-1)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, padding: "0 var(--space-1)" }}>Reward catalog</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {catalog.map((r) => <Card key={r.id} style={{ padding: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{r.name}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{r.circle_name} · {r.points_cost.toLocaleString()} pts{r.stock_quantity != null ? ` · ${r.stock_quantity} left` : ""}</div>
                </div>
                {removeTarget !== r.id && <Button size="sm" variant="ghost" before={<Trash2 size={12} />} onClick={() => setRemoveTarget(r.id)} style={{ color: "var(--color-danger-text)" }}>Remove</Button>}
              </div>
              {removeTarget === r.id && <div style={{ marginTop: "var(--space-3)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)", background: "var(--color-danger-subtle-bg)" }}>
                <div style={{ fontSize: 11, color: "var(--color-danger-text)", marginBottom: "var(--space-2)" }}>{r.has_history ? "Remove and erase history?" : "Remove?"}</div>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(null)}>Cancel</Button>
                  <Button size="sm" variant="danger" loading={working === `remove-${r.id}`} onClick={() => removeReward(r.id, r.has_history)}>{r.has_history ? "Remove and erase history" : "Remove"}</Button>
                </div>
              </div>}
            </Card>)}
          </div>
        </div>}
        {active.length === 0 ? <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>Nothing in progress.</p>
          : active.map((r) => <Card key={r.id} style={{ padding: "var(--space-3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
              <div style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{r.reward_name}</div>
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)", flexShrink: 0 }}>{r.points_cost.toLocaleString()} pts</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, marginBottom: "var(--space-2)" }}>{r.circle_name} · {r.player_icon} {r.player_name}{r.cancellation_requested_at ? " · cancellation requested" : ""}</div>
            {r.cancellation_requested_at ? <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button size="sm" variant="danger" loading={!!working} onClick={() => resolveCancellation(r.id, true)}>Approve cancellation</Button>
              <Button size="sm" variant="secondary" loading={!!working} onClick={() => resolveCancellation(r.id, false)}>Keep reward</Button>
            </div> : <Button size="sm" variant="primary" before={<Check size={12} />} loading={!!working} onClick={() => markGiven(r.id)}>Mark given</Button>}
          </Card>)}
      </div>}

      {tab === "finished" && <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {finished.length === 0 ? <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>Nothing finished yet.</p>
          : finished.map((r) => <Card key={r.id} style={{ padding: "var(--space-3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
              <div style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{r.reward_name}</div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-secondary)", flexShrink: 0 }}>{r.status === "fulfilled" ? "Given" : r.status === "disputed" ? "Something wrong" : "Cancelled"}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{r.circle_name} · {r.player_icon} {r.player_name}</div>
            {r.dispute_reason && <div style={{ fontSize: "var(--text-caption-size)", marginTop: "var(--space-2)", borderRadius: "var(--radius-sm)", padding: "6px var(--space-2)", background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}>{r.dispute_reason}</div>}
          </Card>)}
      </div>}

      {priceTarget && <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)", background: "var(--color-overlay)" }}>
        <Card style={{ maxWidth: 400, width: "100%", padding: "var(--space-5)", maxHeight: "90dvh", overflowY: "auto" }}>
          <div style={{ fontWeight: 700, marginBottom: "var(--space-1)" }}>{priceTarget.mode === "vote" ? "Send to a vote" : "Make available"}: {priceTarget.reward.name}</div>
          {priceTarget.reward.is_physical && <p style={{ fontSize: "var(--text-caption-size)", color: "var(--color-warning-text)", marginBottom: "var(--space-3)" }}>You're agreeing to provide this reward.</p>}
          <input type="number" inputMode="numeric" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} placeholder="Points cost" style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2)", fontSize: "var(--text-body-size)", marginBottom: "var(--space-2)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }} />
          {priceTarget.mode === "available" && priceTarget.reward.reward_type === "limited" && <input type="number" value={stockValue} onChange={(e) => setStockValue(e.target.value)} placeholder="How many available" style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2)", fontSize: "var(--text-body-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }} />}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
            <Button variant="ghost" fullWidth onClick={() => setPriceTarget(null)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={working === "price"} disabled={!priceValue} onClick={submitPrice}>Confirm</Button>
          </div>
        </Card>
      </div>}
    </Page>
  );
}
