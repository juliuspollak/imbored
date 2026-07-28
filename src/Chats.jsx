import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageCircle, Search, Sparkles, Users } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";
import { canDiscoverProfile } from "./lib/profileVisibility.js";

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

export default function Chats({ currentUser, currentProfile, onBack, onOpenChat, onOpenAdminPlayers, onOpenFeedback, onOpenTeams }) {
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
      supabase.from("direct_messages").select("id,sender_id,recipient_id,body,created_at,read_at,system_generated,activity_type").or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`).order("created_at", { ascending: false }).limit(500),
      supabase.from("profiles").select("id,name,icon,mood,is_private,hidden_from_others,is_admin,is_approved,is_blocked,account_deleted_at").neq("id", currentUser.id).order("name"),
      supabase.from("presence").select("user_id").gte("last_seen", cutoff),
    ]);
    if (messageResult.error) setError(messageResult.error.message || "Couldn’t load chats.");
    else setMessages((messageResult.data || []).filter(
      (message) => !(message.system_generated && message.sender_id === currentUser.id && message.recipient_id !== currentUser.id)
    ));
    if (!profileResult.error) {
      const visibleProfiles = (profileResult.data || []).filter((p) => {
        const active = !p.account_deleted_at && !p.is_blocked && (p.is_admin || p.is_approved !== false);
        const pendingForAdmin = !!currentProfile?.is_admin
          && !p.account_deleted_at
          && !p.is_blocked
          && !p.is_admin
          && p.is_approved === false;
        return (active || pendingForAdmin)
          && canDiscoverProfile(p, { isAdmin: !!currentProfile?.is_admin });
      });
      setProfiles([{ ...currentProfile, id:currentUser.id, name:"Challenge results", icon:"🏆" }, ...visibleProfiles]);
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
  const conversationIds = new Set(conversations.map((c) => c.peerId));
  const findResults = normalisedQuery.length < 2
    ? []
    : profiles
      .filter((profile) => (
        profile.id !== currentUser.id
        && (profile.is_admin || profile.is_approved !== false)
        && `${profile.name || ""} ${profile.mood || ""}`.toLowerCase().includes(normalisedQuery)
      ))
      .slice(0, 20);

  function changeView(nextView) {
    setView(nextView);
    setQuery("");
  }

  async function open(profile, latest = null) {
    if (latest?.activity_type === "team_invitation") {
      onOpenTeams?.();
      return;
    }
    if (latest?.activity_type === "feedback_completed") {
      await supabase
        .from("direct_messages")
        .update({ read_at:new Date().toISOString() })
        .eq("id", latest.id)
        .eq("recipient_id", currentUser.id);
      onOpenFeedback?.();
      return;
    }
    if (currentProfile?.is_admin && latest?.activity_type === "user_approval_required") {
      await supabase
        .from("direct_messages")
        .update({ read_at:new Date().toISOString() })
        .eq("id", latest.id)
        .eq("recipient_id", currentUser.id);
      onOpenAdminPlayers?.();
      return;
    }
    onOpenChat({ ...profile, user_id: profile.id, profiles: profile, is_online: presence.has(profile.id) });
  }

  return (
    <div className="chats-page">
      <style>{`
        .chats-page{min-height:100vh;background:radial-gradient(circle at 20% 0,#e8e4ff 0,#f3f5fa 42%,#edf1f7 100%);color:#1b2129;padding-bottom:40px}
        .chats-shell{width:min(100%,760px);margin:0 auto;padding:16px}
        .chats-head{display:flex;align-items:center;gap:12px;margin-bottom:18px}
        .chats-title{font-size:28px;font-weight:900;letter-spacing:-.04em}
        .chat-search{display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.86);border:1px solid rgba(27,33,41,.08);border-radius:18px;padding:12px 14px;box-shadow:0 10px 30px rgba(50,45,90,.08)}
        .chat-search input{width:100%;border:0;outline:0;background:transparent;font:inherit}
        .chat-tabs{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:5px;background:rgba(27,33,41,.055);border-radius:17px;margin-bottom:14px}
        .chat-tab{display:flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:13px;padding:10px 12px;background:transparent;color:rgba(27,33,41,.55);font-size:12px;font-weight:800;transition:.16s ease}
        .chat-tab.active{background:#fff;color:#5f4fe0;box-shadow:0 5px 16px rgba(50,45,90,.09)}
        .chat-section-title{display:flex;align-items:center;gap:7px;margin:22px 4px 10px;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:rgba(27,33,41,.48)}
        .conversation{width:100%;display:flex;align-items:center;gap:12px;border:0;text-align:left;background:rgba(255,255,255,.88);padding:12px;border-radius:22px;margin:8px 0;box-shadow:0 9px 26px rgba(27,33,41,.08);transition:.16s ease}
        .conversation:active{transform:scale(.985)}
        .conversation-avatar{position:relative;width:52px;height:52px;flex:0 0 auto;border-radius:19px;display:grid;place-items:center;font-size:29px;background:linear-gradient(145deg,#fff,#e9e5ff)}
        .online-dot{position:absolute;right:-1px;bottom:-1px;width:13px;height:13px;border:3px solid white;border-radius:50%;background:#24c27a}
        .unread-pill{min-width:22px;height:22px;padding:0 6px;border-radius:999px;display:grid;place-items:center;background:#6d5dfc;color:#fff;font-size:11px;font-weight:900}
        .people-list{display:flex;flex-direction:column;gap:8px}
        .person-card{width:100%;display:flex;align-items:center;gap:12px;border:0;background:rgba(255,255,255,.82);border-radius:18px;padding:10px 12px;text-align:left;box-shadow:0 8px 22px rgba(27,33,41,.07);transition:.16s ease}.person-card:active{transform:scale(.985)}
        .person-avatar{position:relative;width:46px;height:46px;flex:0 0 auto;border-radius:16px;display:grid;place-items:center;font-size:26px;background:linear-gradient(145deg,#fff,#ece8ff)}
      `}</style>
      <div className="chats-shell">
        <header className="chats-head">
          <button type="button" onClick={onBack} className="nav-btn" style={{width:40,height:40,borderRadius:999,border:"1px solid rgba(27,33,41,.08)",background:"#fff",display:"grid",placeItems:"center"}}><ArrowLeft size={18}/></button>
          <div><div className="chats-title">Chats</div><div style={{fontSize:12,color:"rgba(27,33,41,.5)"}}>Messages wait here, even when friends are offline.</div></div>
        </header>
        <div className="chat-tabs" role="tablist" aria-label="Chat views">
          <button type="button" role="tab" aria-selected={view==="recent"} className={`chat-tab ${view==="recent"?"active":""}`} onClick={()=>changeView("recent")}><MessageCircle size={15}/>Recent</button>
          <button type="button" role="tab" aria-selected={view==="find"} className={`chat-tab ${view==="find"?"active":""}`} onClick={()=>changeView("find")}><Users size={15}/>Find people</button>
        </div>
        {error && <div style={{marginTop:12,padding:12,borderRadius:14,background:"#fff0f0",color:"#a12b2b",fontSize:12}}>{error}</div>}
        {view==="recent" ? (
          <>
            {conversations.length>6&&<label className="chat-search"><Search size={18} color="#7665ef"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search conversations…" /></label>}
            <div className="chat-section-title"><MessageCircle size={14}/>Recent conversations</div>
            {loading && <div style={{padding:24,textAlign:"center",opacity:.55}}>Loading chats…</div>}
            {!loading && conversations.length===0 && <div style={{padding:26,textAlign:"center",background:"rgba(255,255,255,.65)",borderRadius:22}}><div style={{fontSize:38}}>💬✨</div><strong>No chats yet</strong><div style={{fontSize:13,opacity:.55,marginTop:5}}>Find someone and say hello.</div><button type="button" className="find-people-cta" onClick={()=>changeView("find")} style={{marginTop:14,border:0,borderRadius:999,padding:"9px 15px",background:"#6d5dfc",color:"#fff",fontSize:12,fontWeight:800}}>Find people</button></div>}
            {!loading && conversations.length>0 && filteredConversations.length===0 && <div style={{padding:24,textAlign:"center",fontSize:12,opacity:.55}}>No conversations match that search.</div>}
            {filteredConversations.map(({peerId,profile,latest,unread}) => (
              <button type="button" className="conversation" key={peerId} onClick={()=>open(profile,latest)}>
                <div className="conversation-avatar">{profile.icon||"🙂"}{presence.has(peerId)&&<span className="online-dot"/>}</div>
                <div style={{flex:1,minWidth:0}}><div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.name||"Player"}</strong><span style={{fontSize:10,opacity:.45}}>{formatWhen(latest.created_at)}</span></div><div style={{fontSize:12,opacity:unread?.85:.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:unread?700:400}}>{latest.activity_type==="user_approval_required" ? "" : latest.activity_type==="feedback_completed" ? "Feedback update · " : latest.activity_type==="team_invitation" ? "Team invitation · " : latest.activity_type==="team_challenge_winner" ? "Challenge result · " : latest.system_generated ? "Team update · " : latest.sender_id===currentUser.id?"You: ":""}{latest.body}</div></div>
                {latest.activity_type==="user_approval_required"
                  ? <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{background:"#FFF0C2",color:"#8A5C00"}}>Review</span>
                  : unread>0&&<span className="unread-pill">{unread}</span>}
              </button>
            ))}
          </>
        ) : (
          <>
            <label className="chat-search"><Search size={18} color="#7665ef"/><input autoFocus value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search by name…" /></label>
            <div className="chat-section-title"><Sparkles size={14}/>Find someone</div>
            {normalisedQuery.length<2 ? (
              <div style={{padding:28,textAlign:"center",background:"rgba(255,255,255,.65)",borderRadius:22}}><Search size={28} style={{margin:"0 auto 9px",opacity:.24}}/><strong style={{fontSize:13}}>Search for a player</strong><div style={{fontSize:12,opacity:.48,marginTop:4}}>Enter at least two characters. The full player directory stays out of view.</div></div>
            ) : (
              <div className="people-list">
                {findResults.map((profile)=>{
                  const existing=conversations.find((conversation)=>conversation.peerId===profile.id);
                  return <button type="button" className="person-card" key={profile.id} onClick={()=>open(profile,existing?.latest)}><div className="person-avatar">{profile.icon||"🙂"}{presence.has(profile.id)&&<span className="online-dot"/>}</div><span style={{flex:1,minWidth:0}}><strong style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.name||"Player"}</strong><span style={{display:"block",fontSize:11,opacity:.48,marginTop:2}}>{existing?"Open recent conversation":presence.has(profile.id)?"Online now":"Offline · message anyway"}</span></span><MessageCircle size={17} style={{opacity:.35}} aria-hidden="true"/></button>;
                })}
                {!loading && findResults.length===0&&<div style={{padding:22,textAlign:"center",fontSize:12,opacity:.55}}>No players match “{query.trim()}”.</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
