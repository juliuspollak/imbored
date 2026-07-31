import { useCallback, useEffect, useState } from "react";
import { Gift, Plus, ThumbsUp, ThumbsDown, ClipboardCheck } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import Page from "./components/Page.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

const REWARD_TYPE_LABEL = { one_time: "One-time", limited: "Limited", reusable: "Reusable" };
const TABS = [["available", "Available rewards"], ["ideas", "Ideas"], ["mine", "My rewards"]];

function myRewardStatus(row) {
  if (row.status === "requested" || row.status === "approved") {
    return row.cancellation_requested_at ? { text: "Cancellation requested", color: "var(--color-warning-text)", bg: "var(--color-warning-bg)" } : { text: "In progress", color: "var(--color-primary)", bg: "var(--color-primary-subtle)" };
  }
  if (row.status === "fulfilled") return { text: "You got it", color: "var(--color-success-text)", bg: "var(--color-success-bg)" };
  if (row.status === "disputed") return { text: "Something wrong? — waiting", color: "var(--color-danger-text)", bg: "var(--color-danger-bg)" };
  return { text: "Cancelled — points returned", color: "var(--color-text-secondary)", bg: "var(--color-surface-elevated)" };
}

function ideaStatus(row) {
  if (row.status === "suggested") return { text: "Needs a price", color: "var(--color-primary)", bg: "var(--color-primary-subtle)" };
  if (row.status === "pending") return { text: `${row.approve_count}/${row.required_count} votes`, color: "var(--color-warning-text)", bg: "var(--color-warning-bg)" };
  if (row.status === "rejected") return { text: "Not this time", color: "var(--color-text-secondary)", bg: "var(--color-surface-elevated)" };
  return { text: "Available", color: "var(--color-success-text)", bg: "var(--color-success-bg)" };
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
    setProgress(p); setAvailable(avail || []); setMyProposals(mine || []); setVotable(vote || []); setMyRequests((requests || []).filter((r) => r.player_id === user.id)); setCircles(c || []); setLoading(false);
  }, [user.id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("user_section_views").upsert({ user_id: user.id, section: "rewardrequests", viewed_at: new Date().toISOString() }).then(({ error }) => { if (error) console.error("Unable to mark Rewards as viewed:", error); else window.dispatchEvent(new CustomEvent("rewardrequests-section-seen")); });
  }, [user?.id]);

  const pointsSetAside = myRequests.filter((r) => r.status === "requested" || r.status === "approved").reduce((sum, r) => sum + Number(r.points_cost || 0), 0);

  async function submitProposal(e) {
    e.preventDefault(); if (!proposal.circle_id || !proposal.name.trim()) return;
    setProposing(true);
    const { error } = await supabase.rpc("propose_reward", { target_circle_id: Number(proposal.circle_id), reward_name: proposal.name, reward_description: proposal.description || null, reward_image_url: null, reward_type: proposal.reward_type, reward_is_physical: proposal.is_physical });
    setProposing(false); setMessage(error?.message || "Idea added");
    if (!error) { setProposal((c) => ({ ...c, name: "", description: "" })); setProposeOpen(false); } refresh();
  }

  async function vote(rewardId, approve) { setWorking(`vote-${rewardId}`); const { error } = await supabase.rpc("vote_on_reward", { target_reward_id: rewardId, approve }); setWorking(""); if (error) setMessage(error.message); refresh(); }
  async function confirmRedeem() { if (!redeemTarget) return; setRedeeming(true); const { error } = await supabase.rpc("redeem_reward", { target_reward_id: redeemTarget.id, note: null }); setRedeeming(false); setRedeemTarget(null); setMessage(error?.message || "Reward in progress"); refresh(); }
  async function askToCancel(id) { setWorking(`cancel-${id}`); const { error } = await supabase.rpc("request_cancel_redemption", { target_id: id }); setWorking(""); setMessage(error?.message || "Cancellation requested"); refresh(); }
  async function submitDispute() { if (!disputeReason.trim() || !disputeTarget) return; const { error } = await supabase.rpc("dispute_redemption", { target_id: disputeTarget.id, reason: disputeReason.trim() }); setMessage(error?.message || "Sent to the organiser"); if (!error) { setDisputeTarget(null); setDisputeReason(""); } refresh(); }

  if (loading) return <Page><p style={{ textAlign: "center", padding: "var(--space-8) 0", color: "var(--color-text-secondary)" }}>Loading…</p></Page>;

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}><BackButton onClick={onBack} /><h1 style={{ fontSize: "var(--text-page-title-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>Rewards</h1></div>
      <section style={{ borderRadius: "var(--radius-xl)", padding: "var(--space-4)", marginBottom: "var(--space-4)", background: "var(--color-primary)", color: "var(--color-primary-text)", boxShadow: "var(--shadow-primary)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div><span style={{ fontSize: "1.5rem", fontWeight: 700 }}>{Number(progress?.available_points || 0).toLocaleString()}</span> <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", opacity: .7 }}>points</span></div>
          {pointsSetAside > 0 && <div style={{ fontSize: 11, textAlign: "right", opacity: .75 }}>{pointsSetAside.toLocaleString()} points<br />set aside</div>}
        </div>
      </section>
      {message && <div style={{ marginBottom: "var(--space-3)" }}><StatusBanner variant="info" dismissible onDismiss={() => setMessage("")}>{message}</StatusBanner></div>}

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
        {TABS.map(([id, label]) => <Button key={id} variant={tab === id ? "primary" : "secondary"} size="sm" onClick={() => setTab(id)} style={{ flex: 1 }}>{label}</Button>)}
      </div>

      {tab === "available" && <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {available.length === 0 ? <Card style={{ textAlign: "center", padding: "var(--space-6)" }}><Gift size={22} style={{ color: "var(--color-primary)", margin: "0 auto 8px" }} /><div style={{ fontSize: "var(--text-body-size)", fontWeight: 600 }}>Nothing available yet</div></Card>
          : available.map((r) => {
            const affordable = Number(progress?.available_points || 0) >= r.points_cost;
            const pct = Math.max(0, Math.min(100, (Number(progress?.available_points || 0) / r.points_cost) * 100));
            const short = r.points_cost - Number(progress?.available_points || 0);
            return <Card key={r.id} style={{ padding: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "var(--color-warning-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  {r.image_url ? <img src={r.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "var(--radius-md)" }} /> : <Gift size={20} style={{ color: "var(--color-warning-gold)" }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{r.name}</div>
                  <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: 2 }}>{r.points_cost.toLocaleString()} points{r.stock_quantity != null ? ` · ${r.stock_quantity} left` : ""}</div>
                  {!affordable && <div style={{ height: 6, borderRadius: "var(--radius-full)", overflow: "hidden", marginTop: 6, background: "var(--color-border)" }}><div style={{ height: "100%", borderRadius: "var(--radius-full)", width: `${pct}%`, background: "var(--color-primary)" }} /></div>}
                </div>
                {affordable ? <Button variant="primary" size="sm" onClick={() => setRedeemTarget(r)}>Get it</Button> : <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", flexShrink: 0 }}>{short.toLocaleString()} to go</span>}
              </div>
            </Card>;
          })}
      </div>}

      {tab === "ideas" && <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <button onClick={() => setProposeOpen((v) => !v)} style={{ width: "100%", borderRadius: "var(--radius-lg)", padding: "var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-3)", textAlign: "left", background: "var(--color-surface)", border: "1px solid var(--color-border)", cursor: "pointer", color: "inherit" }}>
          <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--color-info-bg)", color: "var(--color-primary)", display: "grid", placeItems: "center", flexShrink: 0 }}><Plus size={16} /></span>
          <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Add an idea</span>
        </button>
        {proposeOpen && circles.length === 0 && <StatusBanner variant="warning">You're not on a circle yet — join or create one to add an idea.</StatusBanner>}
        {proposeOpen && circles.length > 0 && <form onSubmit={submitProposal}><Card style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <select value={proposal.circle_id} onChange={(e) => setProposal({ ...proposal, circle_id: e.target.value })} required style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-body-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }}><option value="">Choose circle</option>{circles.map((c) => <option key={c.circle_id} value={c.circle_id}>{c.circle_name}</option>)}</select>
          <input value={proposal.name} onChange={(e) => setProposal({ ...proposal, name: e.target.value })} placeholder="What's the idea?" required style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-body-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }} />
          <textarea value={proposal.description} onChange={(e) => setProposal({ ...proposal, description: e.target.value })} placeholder="Add a note (optional)" style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-body-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box" }} />
          <select value={proposal.reward_type} onChange={(e) => setProposal({ ...proposal, reward_type: e.target.value })} style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-body-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }}><option value="reusable">Reusable</option><option value="limited">Limited quantity</option><option value="one_time">One-time</option></select>
          <label style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}><input type="checkbox" checked={proposal.is_physical} onChange={(e) => setProposal({ ...proposal, is_physical: e.target.checked })} /> This is a physical item</label>
          <Button variant="primary" fullWidth type="submit" loading={proposing}>Submit idea</Button>
        </Card></form>}
        {votable.length === 0 ? <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>No ideas to vote on.</p>
          : votable.map((r) => {
            const s = ideaStatus(r);
            return <Card key={r.id} style={{ padding: "var(--space-3)" }}>
              <div style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{r.name}</div>
              <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: 2 }}>{r.circle_name} · <span style={{ background: s.bg, color: s.color, borderRadius: "var(--radius-full)", padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>{s.text}</span></div>
              {r.status === "pending" && <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                <Button size="sm" variant="ghost" loading={working === `vote-${r.id}`} before={<ThumbsUp size={12} />} onClick={() => vote(r.id, true)}>Approve</Button>
                <Button size="sm" variant="ghost" loading={working === `vote-${r.id}`} before={<ThumbsDown size={12} />} onClick={() => vote(r.id, false)}>Reject</Button>
              </div>}
            </Card>;
          })}
      </div>}

      {tab === "mine" && <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {myProposals.length > 0 && <div>
          <div style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "var(--space-2)", padding: "0 var(--space-1)" }}>My ideas</div>
          {myProposals.map((r) => { const s = ideaStatus(r); return <Card key={r.id} style={{ padding: "var(--space-3)", marginBottom: "var(--space-2)" }}><div style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{r.name}</div><div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: 2 }}>{r.circle_name} · <span style={{ background: s.bg, color: s.color, borderRadius: "var(--radius-full)", padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>{s.text}</span></div></Card>; })}
        </div>}
        {myRequests.length === 0 ? <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>No requests yet.</p>
          : myRequests.map((r) => {
            const s = myRewardStatus(r);
            return <Card key={r.id} style={{ padding: "var(--space-3)" }}>
              <div style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{r.reward_name}</div>
              <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: 2 }}>{r.points_cost.toLocaleString()} pts · <span style={{ background: s.bg, color: s.color, borderRadius: "var(--radius-full)", padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>{s.text}</span></div>
              {(r.status === "requested" || r.status === "approved") && !r.cancellation_requested_at && <Button size="sm" variant="ghost" loading={working === `cancel-${r.id}`} onClick={() => askToCancel(r.id)} style={{ marginTop: "var(--space-2)" }}>Cancel</Button>}
              {r.status === "fulfilled" && <Button size="sm" variant="ghost" before={<ClipboardCheck size={12} />} onClick={() => { setDisputeTarget(r); setDisputeReason(""); }} style={{ marginTop: "var(--space-2)", color: "var(--color-danger-text)" }}>Something wrong?</Button>}
            </Card>;
          })}
      </div>}

      {redeemTarget && <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)", background: "var(--color-overlay)" }}>
        <Card style={{ maxWidth: 400, width: "100%", padding: "var(--space-5)" }}>
          <div style={{ fontWeight: 700, marginBottom: "var(--space-1)" }}>Get this reward?</div>
          <div style={{ fontSize: "var(--text-body-size)", marginBottom: "var(--space-2)" }}>{redeemTarget.name}</div>
          <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>{redeemTarget.points_cost.toLocaleString()} points will be set aside until a circle organiser gives it to you.</div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="ghost" fullWidth onClick={() => setRedeemTarget(null)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={redeeming} onClick={confirmRedeem}>Get it</Button>
          </div>
        </Card>
      </div>}

      {disputeTarget && <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)", background: "var(--color-overlay)" }}>
        <Card style={{ maxWidth: 400, width: "100%", padding: "var(--space-5)" }}>
          <div style={{ fontWeight: 700, marginBottom: "var(--space-1)" }}>What went wrong?</div>
          <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginBottom: "var(--space-3)" }}>The organiser will be notified.</div>
          <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} rows={3} placeholder="Describe the issue…" style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2)", fontSize: "var(--text-body-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", resize: "none", marginBottom: "var(--space-3)", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="ghost" fullWidth onClick={() => setDisputeTarget(null)}>Cancel</Button>
            <Button variant="danger" fullWidth disabled={!disputeReason.trim()} onClick={submitDispute}>Report issue</Button>
          </div>
        </Card>
      </div>}
    </Page>
  );
}
