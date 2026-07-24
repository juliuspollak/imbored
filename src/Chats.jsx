import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageCircle, Search, Sparkles } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

export default function Chats({ currentUser, currentProfile, onBack, onOpenChat }) {
  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [presence, setPresence] = useState(new Set());
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
    else setMessages(messageResult.data || []);
    if (!profileResult.error) {
      setProfiles((profileResult.data || []).filter((p) => (
        !p.account_deleted_at
        && !p.is_blocked
        && (p.is_admin || p.is_approved !== false)
        && (currentProfile?.is_admin || (!p.hidden_from_others && !p.is_private))
      )));
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

  const filteredProfiles = profiles.filter((p) => `${p.name || ""} ${p.mood || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const conversationIds = new Set(conversations.map((c) => c.peerId));
  const newPeople = filteredProfiles.filter((p) => !conversationIds.has(p.id));

  function open(profile) {
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
        .chat-section-title{display:flex;align-items:center;gap:7px;margin:22px 4px 10px;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:rgba(27,33,41,.48)}
        .conversation{width:100%;display:flex;align-items:center;gap:12px;border:0;text-align:left;background:rgba(255,255,255,.88);padding:12px;border-radius:22px;margin:8px 0;box-shadow:0 9px 26px rgba(27,33,41,.08);transition:.16s ease}
        .conversation:active{transform:scale(.985)}
        .conversation-avatar{position:relative;width:52px;height:52px;flex:0 0 auto;border-radius:19px;display:grid;place-items:center;font-size:29px;background:linear-gradient(145deg,#fff,#e9e5ff)}
        .online-dot{position:absolute;right:-1px;bottom:-1px;width:13px;height:13px;border:3px solid white;border-radius:50%;background:#24c27a}
        .unread-pill{min-width:22px;height:22px;padding:0 6px;border-radius:999px;display:grid;place-items:center;background:#6d5dfc;color:#fff;font-size:11px;font-weight:900}
        .people-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:10px}
        .person-card{border:0;background:rgba(255,255,255,.82);border-radius:22px;padding:16px 12px;text-align:center;box-shadow:0 8px 22px rgba(27,33,41,.07)}
        .person-avatar{width:58px;height:58px;border-radius:21px;margin:0 auto 9px;display:grid;place-items:center;font-size:32px;background:linear-gradient(145deg,#fff,#ece8ff)}
      `}</style>
      <div className="chats-shell">
        <header className="chats-head">
          <button type="button" onClick={onBack} className="nav-btn" style={{width:40,height:40,borderRadius:999,border:"1px solid rgba(27,33,41,.08)",background:"#fff",display:"grid",placeItems:"center"}}><ArrowLeft size={18}/></button>
          <div><div className="chats-title">Chats</div><div style={{fontSize:12,color:"rgba(27,33,41,.5)"}}>Messages wait here, even when friends are offline.</div></div>
        </header>
        <label className="chat-search"><Search size={18} color="#7665ef"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Find a player…" /></label>
        {error && <div style={{marginTop:12,padding:12,borderRadius:14,background:"#fff0f0",color:"#a12b2b",fontSize:12}}>{error}</div>}
        <div className="chat-section-title"><MessageCircle size={14}/>Recent conversations</div>
        {loading && <div style={{padding:24,textAlign:"center",opacity:.55}}>Loading chats…</div>}
        {!loading && conversations.length===0 && <div style={{padding:26,textAlign:"center",background:"rgba(255,255,255,.65)",borderRadius:22}}><div style={{fontSize:38}}>💬✨</div><strong>No chats yet</strong><div style={{fontSize:13,opacity:.55,marginTop:5}}>Choose someone below and say hello.</div></div>}
        {conversations.filter(c => (c.profile.name||"").toLowerCase().includes(query.toLowerCase())).map(({peerId,profile,latest,unread}) => (
          <button type="button" className="conversation" key={peerId} onClick={()=>open(profile)}>
            <div className="conversation-avatar">{profile.icon||"🙂"}{presence.has(peerId)&&<span className="online-dot"/>}</div>
            <div style={{flex:1,minWidth:0}}><div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.name||"Player"}</strong><span style={{fontSize:10,opacity:.45}}>{formatWhen(latest.created_at)}</span></div><div style={{fontSize:12,opacity:unread?.85:.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:unread?700:400}}>{latest.system_generated ? "Team update · " : latest.sender_id===currentUser.id?"You: ":""}{latest.body}</div></div>
            {unread>0&&<span className="unread-pill">{unread}</span>}
          </button>
        ))}
        <div className="chat-section-title"><Sparkles size={14}/>Start a new chat</div>
        <div className="people-grid">
          {newPeople.map((profile)=><button type="button" className="person-card" key={profile.id} onClick={()=>open(profile)}><div className="person-avatar" style={{position:"relative"}}>{profile.icon||"🙂"}{presence.has(profile.id)&&<span className="online-dot"/>}</div><strong>{profile.name||"Player"}</strong><div style={{fontSize:11,opacity:.48,marginTop:3}}>{presence.has(profile.id)?"Online now":"Offline · message anyway"}</div></button>)}
        </div>
      </div>
    </div>
  );
}
