import { useCallback, useEffect, useState } from "react";
import { Gift, Plus, X, ThumbsUp, ThumbsDown, ClipboardCheck } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG = "#F1F3F7", PANEL = "#fff", INK = "#1B2129", ACCENT = "#2F6FED";
const card = { background: PANEL, border: "1px solid rgba(16,24,40,.09)", borderRadius: 16 };

const REWARD_TYPE_LABEL = { one_time: "One-time", limited: "Limited", reusable: "Reusable" };
const TABS = [["available", "Available rewards"], ["ideas", "Ideas"], ["mine", "My rewards"]];

function myRewardStatus(row) {
  if (row.status === "requested" || row.status === "approved") {
    return row.cancellation_requested_at
      ? { text: "Cancellation requested", color: "#B5730E", bg: "rgba(217,148,10,.10)" }
      : { text: "In progress", color: "#2F6FED", bg: "rgba(47,111,237,.09)" };
  }
  if (row.status === "fulfilled") return { text: "You got it", color: "#12946A", bg: "rgba(18,148,106,.10)" };
  if (row.status === "disputed") return { text: "Something wrong? — waiting", color: "#B5433A", bg: "rgba(181,67,58,.09)" };
  return { text: "Cancelled — points returned", color: "#5B6472", bg: "rgba(16,24,40,.06)" };
}

function ideaStatus(row) {
  if (row.status === "suggested") return { text: "Needs a price", color: "#7C3AED", bg: "rgba(124,58,237,.09)" };
  if (row.status === "pending") return { text: `${row.approve_count}/${row.required_count} votes`, color: "#B5730E", bg: "rgba(217,148,10,.10)" };
  if (row.status === "rejected") return { text: "Not this time", color: "#5B6472", bg: "rgba(16,24,40,.06)" };
  return { text: "Available", color: "#12946A", bg: "rgba(18,148,106,.10)" };
}

export default function Rewards({ onBack }) {
  const { user } = useAuth();
  const [tab, setTab] = useState("available");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(null);
  const [available, setAvailable] = useState([]);
  const [myProposals, setMyProposals] = useState([]);
  const [votable, setVotable] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [circles, setCircles] = useState([]);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposal, setProposal] = useState({ circle_id: "", name: "", description: "", reward_type: "reusable", is_physical: true });
  const [proposing, setProposing] = useState(false);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [redeeming, setRedeeming] = useState(false);
  const [disputeTarget, setDisputeTarget] = useState(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [working, setWorking] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: avail }, { data: mine }, { data: vote }, { data: requests }, { data: c }] = await Promise.all([
      supabase.from("player_progress").select("*").eq("player_id", user.id).single(),
      supabase.rpc("list_my_available_rewards"),
      supabase.rpc("get_my_reward_proposals"),
      supabase.rpc("get_circle_ideas_to_vote_on"),
      supabase.rpc("list_reward_requests"),
      supabase.rpc("get_my_reward_circles"),
    ]);
    setProgress(p);
    setAvailable(avail || []);
    setMyProposals(mine || []);
    setVotable(vote || []);
    setMyRequests((requests || []).filter((r) => r.player_id === user.id));
    setCircles(c || []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("user_section_views").upsert({ user_id: user.id, section: "rewardrequests", viewed_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) console.error("Unable to mark Rewards as viewed:", error);
        else window.dispatchEvent(new CustomEvent("rewardrequests-section-seen"));
      });
  }, [user?.id]);

  const pointsSetAside = myRequests
    .filter((r) => r.status === "requested" || r.status === "approved")
    .reduce((sum, r) => sum + Number(r.points_cost || 0), 0);

  async function submitProposal(e) {
    e.preventDefault();
    if (!proposal.circle_id || !proposal.name.trim()) return;
    setProposing(true);
    const { error } = await supabase.rpc("propose_reward", {
      target_circle_id: Number(proposal.circle_id),
      reward_name: proposal.name,
      reward_description: proposal.description || null,
      reward_image_url: null,
      reward_type: proposal.reward_type,
      reward_is_physical: proposal.is_physical,
    });
    setProposing(false);
    setMessage(error?.message || "Idea added");
    if (!error) { setProposal((cur) => ({ ...cur, name: "", description: "" })); setProposeOpen(false); }
    refresh();
  }

  async function vote(rewardId, approve) {
    setWorking(`vote-${rewardId}`);
    const { error } = await supabase.rpc("vote_on_reward", { target_reward_id: rewardId, approve });
    setWorking("");
    if (error) setMessage(error.message);
    refresh();
  }

  async function confirmRedeem() {
    if (!redeemTarget) return;
    setRedeeming(true);
    const { error } = await supabase.rpc("redeem_reward", { target_reward_id: redeemTarget.id, note: null });
    setRedeeming(false);
    setRedeemTarget(null);
    setMessage(error?.message || "Reward in progress");
    refresh();
  }

  async function askToCancel(id) {
    setWorking(`cancel-${id}`);
    const { error } = await supabase.rpc("request_cancel_redemption", { target_id: id });
    setWorking("");
    setMessage(error?.message || "Cancellation requested");
    refresh();
  }

  async function submitDispute() {
    if (!disputeReason.trim() || !disputeTarget) return;
    const { error } = await supabase.rpc("dispute_redemption", { target_id: disputeTarget.id, reason: disputeReason.trim() });
    setMessage(error?.message || "Sent to the organiser");
    if (!error) { setDisputeTarget(null); setDisputeReason(""); }
    refresh();
  }

  if (loading) return <div style={{ background: BG, minHeight: "100vh" }} className="p-10 text-center text-sm opacity-40">Loading…</div>;

  return <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter',sans-serif" }} className="p-4 pt-10 flex justify-center">
    <div className="w-full max-w-md">
      <div className="flex items-center gap-3 mb-4"><BackButton onClick={onBack} /><h1 className="text-2xl font-bold" style={{ fontFamily: "'Fredoka',sans-serif", color: INK }}>Rewards</h1></div>

      <section className="rounded-3xl p-4 mb-4" style={{ background: "linear-gradient(145deg,#17233E 0%,#243B73 100%)", color: "#fff" }}>
        <div className="flex items-baseline justify-between">
          <div><span className="text-2xl font-bold">{Number(progress?.available_points || 0).toLocaleString()}</span> <span className="text-[10px] uppercase tracking-wide opacity-70">points</span></div>
          {pointsSetAside > 0 && <div className="text-[11px] text-right opacity-75">{pointsSetAside.toLocaleString()} points<br />set aside</div>}
        </div>
      </section>

      {message && <div className="rounded-xl p-3 mb-3 text-xs" style={{ background: "rgba(47,111,237,.08)", color: INK }}>{message}</div>}

      <div className="game-mode-switch mb-4" style={{ width: "100%", justifyContent: "flex-start" }}>
        {TABS.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`gloss-button ${tab === id ? "is-active" : ""}`} style={{ flex: 1 }}>{label}</button>)}
      </div>

      {tab === "available" && <div className="space-y-2">
        {available.length === 0
          ? <div className="p-6 text-center rounded-2xl" style={card}><Gift size={22} style={{ color: ACCENT, margin: "0 auto 8px" }} /><div className="text-sm font-semibold">Nothing available yet</div></div>
          : available.map((r) => {
            const affordable = Number(progress?.available_points || 0) >= r.points_cost;
            const pct = Math.max(0, Math.min(100, (Number(progress?.available_points || 0) / r.points_cost) * 100));
            const short = r.points_cost - Number(progress?.available_points || 0);
            return <div key={r.id} className="p-3" style={card}>
              <div className="flex items-center gap-3">
                <div className="grid place-items-center rounded-xl shrink-0" style={{ width: 44, height: 44, background: "rgba(217,174,88,.14)" }}>{r.image_url ? <img src={r.image_url} alt="" className="w-full h-full object-cover rounded-xl" /> : <Gift size={20} style={{ color: "#D9AE58" }} />}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: INK }}>{r.name}</div>
                  <div className="text-xs opacity-55 mt-0.5">{r.points_cost.toLocaleString()} points{r.stock_quantity != null ? ` · ${r.stock_quantity} left` : ""}</div>
                  {!affordable && <div className="h-1.5 rounded-full overflow-hidden mt-1.5" style={{ background: "rgba(16,24,40,.08)" }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT }} /></div>}
                </div>
                {affordable
                  ? <button onClick={() => setRedeemTarget(r)} className="rounded-full px-3 py-2 text-xs font-bold text-white shrink-0" style={{ background: ACCENT }}>Get it</button>
                  : <span className="text-[11px] font-semibold shrink-0" style={{ color: INK, opacity: .55 }}>{short.toLocaleString()} to go</span>}
              </div>
            </div>;
          })}
      </div>}

      {tab === "ideas" && <div className="space-y-3">
        <button onClick={() => setProposeOpen((v) => !v)} className="w-full rounded-2xl p-3 flex items-center gap-3 text-left" style={card}>
          <span className="grid place-items-center rounded-xl shrink-0" style={{ width: 36, height: 36, background: "rgba(47,111,237,.09)", color: ACCENT }}><Plus size={16} /></span>
          <span className="flex-1 min-w-0 text-sm font-semibold" style={{ color: INK }}>Add an idea</span>
        </button>

        {proposeOpen && circles.length === 0 && <div className="rounded-2xl px-3 py-2.5 text-xs" style={{ background: "rgba(217,148,10,.10)", color: "#8A5C00" }}>You're not on a circle yet — join or create one to add an idea.</div>}
        {proposeOpen && circles.length > 0 && <form onSubmit={submitProposal} className="p-4 space-y-2" style={card}>
          <select value={proposal.circle_id} onChange={(e) => setProposal({ ...proposal, circle_id: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" required>
            <option value="">Choose circle</option>
            {circles.map((c) => <option key={c.circle_id} value={c.circle_id}>{c.circle_name}</option>)}
          </select>
          <input value={proposal.name} onChange={(e) => setProposal({ ...proposal, name: e.target.value })} placeholder="What's the idea?" className="w-full rounded-lg border px-3 py-2 text-sm" required />
          <textarea value={proposal.description} onChange={(e) => setProposal({ ...proposal, description: e.target.value })} placeholder="Add a note (optional)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <select value={proposal.reward_type} onChange={(e) => setProposal({ ...proposal, reward_type: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm">
            <option value="reusable">Reusable — like picking the next game</option>
            <option value="limited">Limited quantity</option>
            <option value="one_time">One-time</option>
          </select>
          <label className="flex items-center gap-2 text-xs" style={{ color: INK }}>
            <input type="checkbox" checked={proposal.is_physical} onChange={(e) => setProposal({ ...proposal, is_physical: e.target.checked })} />
            This is a physical item someone needs to provide
          </label>
          <button disabled={proposing} className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>{proposing ? "Adding…" : "Add idea"}</button>
        </form>}

        {myProposals.length > 0 && <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide opacity-40 px-1">Your ideas</div>
          {myProposals.map((r) => {
            const s = ideaStatus(r);
            return <div key={r.id} className="p-3" style={card}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-sm truncate" style={{ color: INK }}>{r.name}</div>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" style={{ color: s.color, background: s.bg }}>{s.text}</span>
              </div>
              <div className="text-[11px] opacity-45 mt-0.5">{r.circle_name} · {REWARD_TYPE_LABEL[r.reward_type]}</div>
            </div>;
          })}
        </div>}

        {votable.length > 0 && <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide opacity-40 px-1">Open votes</div>
          {votable.map((r) => <div key={r.id} className="p-3" style={card}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm truncate" style={{ color: INK }}>{r.name}</div>
              <span className="text-[11px] font-semibold opacity-60 shrink-0">{r.approve_count}/{r.required_count} votes</span>
            </div>
            <div className="text-[11px] opacity-45 mt-0.5 mb-2">{r.circle_name} · suggested by {r.creator_icon} {r.creator_name}</div>
            <div className="flex gap-2">
              <button onClick={() => vote(r.id, true)} disabled={!!working} className="rounded-full px-3 py-1.5 text-[11px] font-semibold flex items-center gap-1" style={{ background: r.my_vote === "approve" ? "rgba(22,163,74,.18)" : "rgba(22,163,74,.1)", color: "#166534" }}><ThumbsUp size={12} />{r.my_vote === "approve" ? "Voted yes" : "Vote yes"}</button>
              <button onClick={() => vote(r.id, false)} disabled={!!working} className="rounded-full px-3 py-1.5 text-[11px] font-semibold flex items-center gap-1" style={{ background: r.my_vote === "reject" ? "rgba(181,67,58,.16)" : "rgba(181,67,58,.08)", color: "#B5433A" }}><ThumbsDown size={12} />{r.my_vote === "reject" ? "Voted no" : "Vote no"}</button>
            </div>
          </div>)}
        </div>}

        {myProposals.length === 0 && votable.length === 0 && <p className="text-sm text-center opacity-40 py-6">No ideas yet — add one above.</p>}
      </div>}

      {tab === "mine" && <div className="space-y-2">
        {myRequests.length === 0
          ? <div className="p-6 text-center rounded-2xl" style={card}><ClipboardCheck size={22} style={{ color: ACCENT, margin: "0 auto 8px" }} /><div className="text-sm font-semibold">Nothing yet</div></div>
          : myRequests.map((r) => {
            const s = myRewardStatus(r);
            const canAskToCancel = r.status === "requested" && !r.cancellation_requested_at;
            const canDispute = r.status === "fulfilled";
            return <div key={r.id} className="p-3" style={card}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-sm truncate" style={{ color: INK }}>{r.reward_name}</div>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" style={{ color: s.color, background: s.bg }}>{s.text}</span>
              </div>
              <div className="text-xs opacity-50 mt-1 mb-2">{r.points_cost.toLocaleString()} points</div>
              {canAskToCancel && <button onClick={() => askToCancel(r.id)} disabled={!!working} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(16,24,40,.06)", color: INK }}>Ask to cancel</button>}
              {canDispute && <button onClick={() => setDisputeTarget(r)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(181,67,58,.08)", color: "#B5433A" }}>Something wrong?</button>}
            </div>;
          })}
      </div>}
    </div>

    {redeemTarget && <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(16,24,40,.45)" }}>
      <div className="w-full max-w-sm rounded-3xl p-5" style={{ background: "#fff", boxShadow: "0 24px 60px rgba(16,24,40,.22)" }}>
        <h2 className="font-bold mb-1">Get {redeemTarget.name}?</h2>
        <p className="text-xs opacity-55 mb-3">{redeemTarget.points_cost.toLocaleString()} points will be set aside right away. The organiser confirms once it's given.</p>
        <div className="flex gap-2">
          <button onClick={() => setRedeemTarget(null)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{ background: "rgba(16,24,40,.06)" }}>Cancel</button>
          <button disabled={redeeming} onClick={confirmRedeem} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>{redeeming ? "Getting it…" : "Get it"}</button>
        </div>
      </div>
    </div>}

    {disputeTarget && <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(16,24,40,.45)" }}>
      <div className="w-full max-w-sm rounded-3xl p-5" style={{ background: "#fff", boxShadow: "0 24px 60px rgba(16,24,40,.22)" }}>
        <h2 className="font-bold mb-1">Something wrong?</h2>
        <p className="text-xs opacity-55 mb-3">Let the organiser know what happened with "{disputeTarget.reward_name}".</p>
        <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="e.g. This hasn't actually arrived" className="w-full rounded-xl border px-3 py-2 text-sm" rows={3} />
        <div className="flex gap-2 mt-4">
          <button onClick={() => { setDisputeTarget(null); setDisputeReason(""); }} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{ background: "rgba(16,24,40,.06)" }}>Cancel</button>
          <button disabled={!disputeReason.trim()} onClick={submitDispute} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: "#B5433A" }}>Send</button>
        </div>
      </div>
    </div>}
  </div>;
}
