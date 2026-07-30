import { useCallback, useEffect, useState } from "react";
import { Gift, Check, X } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";

const BG = "#F1F3F7", PANEL = "#fff", INK = "#1B2129", ACCENT = "#2F6FED";
const card = { background: PANEL, border: "1px solid rgba(16,24,40,.09)", borderRadius: 16 };
const TABS = [["ideas", "New ideas"], ["active", "Active rewards"], ["finished", "Finished"]];

export default function OrganiserRewards({ onBack }) {
  const [tab, setTab] = useState("ideas");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [active, setActive] = useState([]);
  const [finished, setFinished] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [priceTarget, setPriceTarget] = useState(null); // { reward, mode: "available" | "vote" }
  const [priceValue, setPriceValue] = useState("");
  const [stockValue, setStockValue] = useState("");
  const [working, setWorking] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: i }, { data: a }, { data: f }, { data: c }] = await Promise.all([
      supabase.rpc("get_organiser_new_ideas"),
      supabase.rpc("get_organiser_active_rewards"),
      supabase.rpc("get_organiser_finished"),
      supabase.rpc("get_organiser_reward_catalog"),
    ]);
    setIdeas(i || []);
    setActive(a || []);
    setFinished(f || []);
    setCatalog(c || []);
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  function openPrice(reward, mode) { setPriceTarget({ reward, mode }); setPriceValue(""); setStockValue(""); }

  async function submitPrice() {
    if (!priceTarget || !priceValue) return;
    setWorking("price");
    const rpc = priceTarget.mode === "vote" ? "organiser_start_vote" : "organiser_make_reward_available";
    const args = priceTarget.mode === "vote"
      ? { target_reward_id: priceTarget.reward.id, price_points_cost: Number(priceValue) }
      : { target_reward_id: priceTarget.reward.id, price_points_cost: Number(priceValue), stock_quantity_in: priceTarget.reward.reward_type === "limited" ? Number(stockValue) : null };
    const { error } = await supabase.rpc(rpc, args);
    setWorking("");
    setMessage(error?.message || (priceTarget.mode === "vote" ? "Sent to a vote" : "Made available"));
    if (!error) setPriceTarget(null);
    refresh();
  }

  async function declineIdea(id) {
    setWorking(`decline-${id}`);
    const { error } = await supabase.rpc("organiser_decline_idea", { target_reward_id: id });
    setWorking("");
    setMessage(error?.message || "Marked \"Not this time\"");
    refresh();
  }

  async function markGiven(id) {
    setWorking(`given-${id}`);
    const { error } = await supabase.rpc("review_redemption", { target_id: id, new_status: "fulfilled", admin_note_in: null });
    setWorking("");
    setMessage(error?.message || "Marked given");
    refresh();
  }

  async function removeReward(id) {
    setConfirmRemove(null);
    setWorking(`remove-${id}`);
    const { error } = await supabase.rpc("delete_reward", { target_reward_id: id });
    setWorking("");
    setMessage(error?.message || "Reward removed");
    refresh();
  }

  async function resolveCancellation(id, approve) {
    setWorking(`cancel-${id}`);
    const { error } = await supabase.rpc("resolve_cancellation", { target_id: id, approve });
    setWorking("");
    setMessage(error?.message || (approve ? "Cancellation approved" : "Reward kept in progress"));
    refresh();
  }

  function RemoveButton({ id }) {
    if (confirmRemove === id) return <div className="flex gap-2 shrink-0">
      <button onClick={() => setConfirmRemove(null)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(16,24,40,.06)", color: INK }}>Cancel</button>
      <button onClick={() => removeReward(id)} disabled={!!working} className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background: "#B5433A" }}>Confirm remove</button>
    </div>;
    return <button onClick={() => setConfirmRemove(id)} disabled={!!working} className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(181,67,58,.08)", color: "#B5433A" }}>Remove</button>;
  }

  if (loading) return <div style={{ background: BG, minHeight: "100vh" }} className="p-10 text-center text-sm opacity-40">Loading…</div>;

  return <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter',sans-serif" }} className="p-4 pt-10 flex justify-center">
    <div className="w-full max-w-md">
      <div className="flex items-center gap-3 mb-4"><BackButton onClick={onBack} /><h1 className="text-2xl font-bold" style={{ fontFamily: "'Fredoka',sans-serif", color: INK }}>Organise rewards</h1></div>
      {message && <div className="rounded-xl p-3 mb-3 text-xs" style={{ background: "rgba(47,111,237,.08)", color: INK }}>{message}</div>}

      <div className="game-mode-switch mb-4" style={{ width: "100%", justifyContent: "flex-start" }}>
        {TABS.map(([id, label]) => {
          const count = id === "ideas" ? ideas.filter((r) => r.status === "suggested").length : id === "active" ? active.filter((r) => r.cancellation_requested_at).length : 0;
          return <button key={id} onClick={() => setTab(id)} className={`gloss-button ${tab === id ? "is-active" : ""}`} style={{ flex: 1 }}>
            {label}
            {count > 0 && <span className="mode-count">{count}</span>}
          </button>;
        })}
      </div>

      {tab === "ideas" && <div className="space-y-2">
        {ideas.length === 0 ? <p className="text-sm text-center opacity-40 py-6">No new ideas right now.</p> : ideas.map((r) => <div key={r.id} className="p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm truncate" style={{ color: INK }}>{r.name}</div>
            <span className="text-[10px] opacity-45 shrink-0">{r.reward_type}</span>
          </div>
          <div className="text-[11px] opacity-45 mt-0.5 mb-2">{r.circle_name} · suggested by {r.creator_icon} {r.creator_name}{r.status === "pending" ? ` · ${r.approve_count}/${r.required_count} votes` : ""}</div>
          {r.status === "suggested" ? <div className="flex flex-wrap gap-2">
            <button onClick={() => openPrice(r, "available")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background: ACCENT }}>Make available</button>
            <button onClick={() => openPrice(r, "vote")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(16,24,40,.06)", color: INK }}>Put to a vote</button>
            <button onClick={() => declineIdea(r.id)} disabled={!!working} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(181,67,58,.08)", color: "#B5433A" }}>Not this time</button>
            <RemoveButton id={r.id} />
          </div> : <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold opacity-55">Voting in progress</span>
            <RemoveButton id={r.id} />
          </div>}
        </div>)}
      </div>}

      {tab === "active" && <div className="space-y-2">
        {catalog.length > 0 && <div className="mb-1">
          <div className="text-[11px] font-semibold opacity-45 mb-1.5 px-1">Reward catalog</div>
          <div className="space-y-2">
            {catalog.map((r) => <div key={r.id} className="p-3 flex items-center justify-between gap-2" style={card}>
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate" style={{ color: INK }}>{r.name}</div>
                <div className="text-[11px] opacity-45">{r.circle_name} · {r.points_cost.toLocaleString()} pts{r.stock_quantity != null ? ` · ${r.stock_quantity} left` : ""}</div>
              </div>
              <RemoveButton id={r.id} />
            </div>)}
          </div>
        </div>}
        {active.length === 0 ? <p className="text-sm text-center opacity-40 py-6">Nothing in progress.</p> : active.map((r) => <div key={r.id} className="p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm truncate" style={{ color: INK }}>{r.reward_name}</div>
            <span className="text-[11px] opacity-55 shrink-0">{r.points_cost.toLocaleString()} pts</span>
          </div>
          <div className="text-[11px] opacity-45 mt-0.5 mb-2">{r.circle_name} · {r.player_icon} {r.player_name}{r.cancellation_requested_at ? " · cancellation requested" : ""}</div>
          {r.cancellation_requested_at ? <div className="flex gap-2">
            <button onClick={() => resolveCancellation(r.id, true)} disabled={!!working} className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background: "#B5433A" }}>Approve cancellation</button>
            <button onClick={() => resolveCancellation(r.id, false)} disabled={!!working} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(16,24,40,.06)", color: INK }}>Keep reward</button>
          </div> : <button onClick={() => markGiven(r.id)} disabled={!!working} className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white flex items-center gap-1" style={{ background: ACCENT }}><Check size={12} />Mark given</button>}
        </div>)}
      </div>}

      {tab === "finished" && <div className="space-y-2">
        {finished.length === 0 ? <p className="text-sm text-center opacity-40 py-6">Nothing finished yet.</p> : finished.map((r) => <div key={r.id} className="p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm truncate" style={{ color: INK }}>{r.reward_name}</div>
            <span className="text-[10px] font-bold opacity-55 shrink-0">{r.status === "fulfilled" ? "Given" : r.status === "disputed" ? "Something wrong" : "Cancelled"}</span>
          </div>
          <div className="text-[11px] opacity-45 mt-0.5">{r.circle_name} · {r.player_icon} {r.player_name}</div>
          {r.dispute_reason && <div className="text-xs mt-2 rounded-lg px-2 py-1.5" style={{ background: "rgba(181,67,58,.08)", color: "#B5433A" }}>{r.dispute_reason}</div>}
        </div>)}
      </div>}
    </div>

    {priceTarget && <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ background: "rgba(16,24,40,.45)" }}>
      <div className="w-full max-w-sm rounded-3xl p-5 my-auto max-h-[90dvh] overflow-y-auto" style={{ background: "#fff", boxShadow: "0 24px 60px rgba(16,24,40,.22)" }}>
        <h2 className="font-bold mb-1">{priceTarget.mode === "vote" ? "Send to a vote" : "Make available"}: {priceTarget.reward.name}</h2>
        {priceTarget.reward.is_physical && <p className="text-xs mb-3" style={{ color: "#8A5C00" }}>You're agreeing to provide this reward. Members may have earned their points in other circles.</p>}
        <input type="number" inputMode="numeric" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} placeholder="Points cost" className="w-full rounded-xl border px-3 py-2 text-sm mb-2" />
        {priceTarget.mode === "available" && priceTarget.reward.reward_type === "limited" && <input type="number" value={stockValue} onChange={(e) => setStockValue(e.target.value)} placeholder="How many available" className="w-full rounded-xl border px-3 py-2 text-sm" />}
        <div className="flex gap-2 mt-4">
          <button onClick={() => setPriceTarget(null)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{ background: "rgba(16,24,40,.06)" }}>Cancel</button>
          <button disabled={!priceValue || working === "price"} onClick={submitPrice} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>Confirm</button>
        </div>
      </div>
    </div>}
  </div>;
}
