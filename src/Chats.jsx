import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Search, Sparkles, Users } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Card from "./components/Card.jsx";
import TextInput from "./components/TextInput.jsx";
import Button from "./components/Button.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

export default function Chats({ currentUser, currentProfile, onBack, onOpenChat, onOpenFeedback, onOpenCircles }) {
  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [presence, setPresence] = useState(new Set());
  const [view, setView] = useState("recent");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    if (!supabaseReady || !currentUser?.id) return;
    const cutoff = new Date(Date.now() - 45000).toISOString();
    const [messageResult, profileResult, presenceResult] = await Promise.all([
      supabase.from("direct_messages").select("id,sender_id,recipient_id,body,created_at,read_at,system_generated,activity_type,source_stat_id").or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`).order("created_at", { ascending: false }).limit(500),
      // Who you may message is a server rule (circle-mates plus admins, minus
      // blocks) shared with send_direct_message, so the list can never offer
      // someone the send would refuse.
      supabase.rpc("get_messageable_players"),
      supabase.from("presence").select("user_id").gte("last_seen", cutoff),
    ]);
    if (messageResult.error) setError(messageResult.error.message || "Couldn’t load chats.");
    else setMessages((messageResult.data || []).filter(
      (message) => !(message.system_generated && message.sender_id === currentUser.id && message.recipient_id !== currentUser.id)
    ));
    if (!profileResult.error) {
      setProfiles([
        { ...currentProfile, id: currentUser.id, name: "Challenge results", icon: "🏆" },
        ...(profileResult.data || []),
      ]);
    }
    setPresence(new Set((presenceResult.data || []).map((p) => p.user_id)));
    setLoading(false);
  }

  useEffect(() => {
    load();
    return attachRealtimeRefresh({
      channelName: `chats-${currentUser?.id}`,
      tables: [{ name: "direct_messages" }, { name: "profiles" }],
      refresh: load,
      fallbackMs: 60000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const conversations = useMemo(() => {
    const grouped = new Map();
    for (const message of messages) {
      const peerId = message.sender_id === currentUser.id ? message.recipient_id : message.sender_id;
      if (!grouped.has(peerId)) grouped.set(peerId, { peerId, latest: message, unread: 0 });
      if (message.recipient_id === currentUser.id && !message.read_at) grouped.get(peerId).unread += 1;
    }
    return [...grouped.values()]
      .filter((item) => profileMap[item.peerId])
      .map((item) => ({ ...item, profile: profileMap[item.peerId] }));
  }, [messages, profileMap, currentUser.id]);

  const normalisedQuery = query.trim().toLowerCase();
  const filteredConversations = conversations.filter((conversation) => (
    !normalisedQuery
    || `${conversation.profile.name || ""} ${conversation.latest.body || ""}`.toLowerCase().includes(normalisedQuery)
  ));
  // Existing conversations stay visible with anyone in the list, but a NEW one
  // can only be started with someone can_message allows — the same rule
  // send_direct_message enforces, so search never offers a chat that would be
  // refused on send.
  const findResults = normalisedQuery.length < 2
    ? []
    : profiles
      .filter((profile) => (
        profile.id !== currentUser.id
        && profile.can_message !== false
        && `${profile.name || ""} ${profile.mood || ""}`.toLowerCase().includes(normalisedQuery)
      ))
      .slice(0, 20);

  function changeView(nextView) {
    setView(nextView);
    setQuery("");
  }

  async function open(profile, latest = null) {
    if (latest?.activity_type === "circle_invitation") {
      onOpenCircles?.();
      return;
    }
    if (latest?.activity_type === "feedback_completed") {
      await supabase
        .from("direct_messages")
        .update({ read_at: new Date().toISOString() })
        .eq("id", latest.id)
        .eq("recipient_id", currentUser.id);
      onOpenFeedback?.();
      return;
    }
    onOpenChat({ ...profile, user_id: profile.id, profiles: profile, is_online: presence.has(profile.id) });
  }

  return (
    <Page>
      <PageHeader
        title="Chats"
        subtitle="Your conversations, all in one place."
        onBack={onBack}
        backAriaLabel="Back to home"
      />

      <div role="tablist" aria-label="Chat views" className="chats-tabs">
        <button type="button" role="tab" aria-selected={view === "recent"} className={`chats-tab${view === "recent" ? " active" : ""}`} onClick={() => changeView("recent")}>
          <MessageCircle size={15} />Recent
        </button>
        <button type="button" role="tab" aria-selected={view === "find"} className={`chats-tab${view === "find" ? " active" : ""}`} onClick={() => changeView("find")}>
          <Users size={15} />Find people
        </button>
      </div>

      {error && <StatusBanner variant="error" style={{ marginBottom: "var(--space-3)" }}>{error}</StatusBanner>}

      {view === "recent" ? (
        <>
          {conversations.length > 6 && (
            <div className="chats-search">
              <Search size={18} className="chats-search-icon" />
              <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations…" style={{ paddingLeft: 40, border: "none", boxShadow: "none", background: "transparent" }} />
            </div>
          )}
          <div className="chats-section-title">Recent conversations</div>

          {loading && <div className="chats-status">Loading chats…</div>}

          {!loading && conversations.length === 0 && (
            <Card className="chats-empty">
              <div style={{ fontSize: 38 }}>💬✨</div>
              <strong>No chats yet</strong>
              <p>Find someone and say hello.</p>
              <Button variant="secondary" onClick={() => changeView("find")} style={{ marginTop: "var(--space-3)" }}>Find people</Button>
            </Card>
          )}

          {!loading && conversations.length > 0 && filteredConversations.length === 0 && (
            <div className="chats-status">No conversations match that search.</div>
          )}

          <div className="chats-conversation-list">
          {filteredConversations.map(({ peerId, profile, latest, unread }) => (
            <button type="button" className="chats-conversation" key={peerId} onClick={() => open(profile, latest)}>
              <div className="chats-avatar">
                {profile.icon || "🙂"}
                {presence.has(peerId) && <span className="chats-online-dot" />}
              </div>
              <div className="chats-conversation-content">
                <div className="chats-conversation-heading">
                  <strong className="chats-truncate">{profile.name || "Player"}</strong>
                  <span className="chats-timestamp">{formatWhen(latest.created_at)}</span>
                </div>
                <div className="chats-conversation-bottom">
                <div className={`chats-preview chats-truncate${unread ? " unread" : ""}`}>
                  {latest.activity_type === "feedback_completed" ? "Feedback update · " : latest.activity_type === "circle_invitation" ? "Circle invitation · " : latest.activity_type === "score_challenge" ? "Beat my score · " : latest.activity_type === "score_challenge_result" || latest.activity_type === "circle_challenge_winner" ? "Challenge result · " : latest.system_generated ? "Circle update · " : latest.sender_id === currentUser.id ? "You: " : ""}
                  {latest.body}
                </div>
                {latest.activity_type === "score_challenge"
                  ? <span className="chats-review-pill">Play</span>
                  : unread > 0 && <span className="chats-unread-pill">{unread}</span>}
                </div>
              </div>
            </button>
          ))}
          </div>
        </>
      ) : (
        <>
          <div className="chats-search">
            <Search size={18} className="chats-search-icon" />
            <TextInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name…" style={{ paddingLeft: 40, border: "none", boxShadow: "none", background: "transparent" }} />
          </div>
          <div className="chats-section-title"><Sparkles size={14} />Find someone</div>

          {normalisedQuery.length < 2 ? (
            <Card className="chats-empty">
              <Search size={28} style={{ color: "var(--color-text-muted)" }} />
              <strong style={{ fontSize: "var(--text-body-secondary-size)" }}>Search for a player</strong>
              <p>Enter at least two characters. The full player directory stays out of view.</p>
            </Card>
          ) : (
            <div className="chats-people-list">
              {findResults.map((profile) => {
                const existing = conversations.find((conversation) => conversation.peerId === profile.id);
                return (
                  <button type="button" className="chats-person-card" key={profile.id} onClick={() => open(profile, existing?.latest)}>
                    <div className="chats-avatar chats-avatar-sm">
                      {profile.icon || "🙂"}
                      {presence.has(profile.id) && <span className="chats-online-dot" />}
                    </div>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong className="chats-truncate" style={{ display: "block" }}>{profile.name || "Player"}</strong>
                      <span className="chats-person-hint">{existing ? "Open recent conversation" : presence.has(profile.id) ? "Online now" : "Offline · message anyway"}</span>
                    </span>
                    <MessageCircle size={17} style={{ color: "var(--color-text-muted)" }} aria-hidden="true" />
                  </button>
                );
              })}
              {!loading && findResults.length === 0 && (
                <div className="chats-status">No players match “{query.trim()}”.</div>
              )}
            </div>
          )}
        </>
      )}

      <style>{`
        .chats-tabs { display:grid; grid-template-columns:1fr 1fr; gap:5px; padding:5px; background:var(--color-surface-elevated); border:1px solid var(--color-border); border-radius:var(--radius-lg); margin-bottom:var(--space-4); }
        .chats-tab { display:flex; align-items:center; justify-content:center; gap:7px; border:0; border-radius:var(--radius-md); padding:10px 12px; background:transparent; color:var(--color-text-secondary); font-size:12px; font-weight:800; cursor:pointer; transition:background var(--transition-fast), color var(--transition-fast); }
        .chats-tab.active { background:var(--color-surface); color:var(--color-primary); box-shadow:var(--shadow-control); }
        .chats-tab:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }

        .chats-search { position:relative; background:var(--color-surface-input); border:1px solid var(--color-border-strong); border-radius:var(--radius-md); margin-bottom:var(--space-3); }
        .chats-search-icon { position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--color-text-muted); pointer-events:none; }
        .chats-search:focus-within { border-color:var(--color-primary); box-shadow:0 0 0 3px var(--color-primary-ring); }

        .chats-section-title { display:flex; align-items:center; gap:7px; margin:var(--space-3) 4px var(--space-2); font-size:var(--text-caption-size); font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--color-text-muted); }

        .chats-status { padding:var(--space-6) 0; text-align:center; color:var(--color-text-secondary); font-size:var(--text-body-secondary-size); }

        .chats-empty { text-align:center; padding:var(--space-6); display:flex; flex-direction:column; align-items:center; gap:4px; }
        .chats-empty strong { color:var(--color-text-primary); }
        .chats-empty p { margin:0; color:var(--color-text-secondary); font-size:var(--text-body-secondary-size); }

        /* Compact, calm inbox: one grouped list rather than isolated cards. */
        .chats-conversation-list { background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-lg); overflow:hidden; box-shadow:none; }
        .chats-conversation-list:empty { display:none; }
        .chats-conversation { width:100%; display:flex; align-items:center; gap:11px; border:0; border-bottom:1px solid var(--color-border); text-align:left; background:transparent; padding:10px 12px; min-height:68px; margin:0; box-shadow:none; cursor:pointer; transition:background var(--transition-fast); }
        .chats-conversation:last-child { border-bottom:0; }
        .chats-conversation:hover { background:var(--color-surface-elevated); }
        .chats-conversation:active { background:var(--color-primary-subtle); }
        .chats-conversation:focus-visible { outline:2px solid var(--color-primary); outline-offset:-2px; position:relative; z-index:1; }
        .chats-avatar { position:relative; width:44px; height:44px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center; font-size:23px; background:var(--color-surface-elevated); border:1px solid var(--color-primary-subtle-border); }
        .chats-avatar-sm { width:44px; height:44px; font-size:23px; }
        .chats-online-dot { position:absolute; right:-1px; bottom:-1px; width:12px; height:12px; border:2px solid var(--color-surface); border-radius:50%; background:var(--color-success-text); }
        .chats-conversation-content { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
        .chats-conversation-heading { display:flex; justify-content:space-between; align-items:baseline; gap:8px; min-width:0; }
        .chats-conversation-heading strong { color:var(--color-text-primary); font-size:var(--text-body-size); font-weight:700; min-width:0; }
        .chats-conversation-bottom { display:flex; align-items:center; gap:8px; min-width:0; }
        .chats-truncate { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .chats-timestamp { flex:0 0 auto; font-size:var(--text-caption-size); color:var(--color-text-muted); font-weight:500; }
        .chats-preview { flex:1; min-width:0; font-size:var(--text-body-secondary-size); color:var(--color-text-secondary); }
        .chats-preview.unread { color:var(--color-text-primary); font-weight:700; }
        .chats-unread-pill { flex:0 0 auto; min-width:20px; height:20px; padding:0 6px; border-radius:var(--radius-full); display:grid; place-items:center; background:var(--color-primary); color:var(--color-primary-text); font-size:11px; font-weight:800; }
        .chats-review-pill { flex:0 0 auto; border-radius:var(--radius-full); padding:3px 8px; font-size:10px; font-weight:750; background:var(--color-warning-bg); color:var(--color-warning-text); }
        @media (max-width:360px) {
          .chats-conversation { padding:10px; gap:10px; min-height:70px; }
          .chats-avatar { width:42px; height:42px; font-size:23px; }
        }

        .chats-people-list { display:flex; flex-direction:column; gap:var(--space-2); }
        .chats-person-card { width:100%; display:flex; align-items:center; gap:var(--space-3); border:1px solid var(--color-border); background:var(--color-surface); border-radius:var(--radius-lg); padding:var(--space-2) var(--space-3); text-align:left; box-shadow:var(--shadow-card); cursor:pointer; transition:transform var(--transition-fast), box-shadow var(--transition-fast); }
        .chats-person-card:hover { box-shadow:var(--shadow-card-hover); }
        .chats-person-card:active { transform:scale(.985); }
        .chats-person-card:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }
        .chats-person-hint { display:block; font-size:var(--text-caption-size); color:var(--color-text-muted); margin-top:2px; }

        @media (prefers-reduced-motion: reduce) {
          .chats-conversation, .chats-person-card { transition:none !important; }
        }
      `}</style>
    </Page>
  );
}
