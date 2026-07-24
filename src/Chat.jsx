import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Send, Sparkles } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { sendPoke } from "./lib/pokes.js";

const QUICK_REACTIONS = ["😂", "❤️", "🔥", "👏", "🎮", "👀"];

function formatMessageTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(date);
}

export default function Chat({ currentUser, currentProfile, peer, onBack }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pokeState, setPokeState] = useState("");
  const messagesRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const peerId = peer?.user_id || peer?.id;
  const peerProfile = peer?.profiles || peer;

  async function loadMessages({ quiet = false } = {}) {
    if (!supabaseReady || !currentUser?.id || !peerId) return;
    if (!quiet) setLoading(true);

    const { data, error: loadError } = await supabase
      .from("direct_messages")
      .select("id, sender_id, recipient_id, body, created_at, read_at, system_generated, activity_type")
      .or(
        `and(sender_id.eq.${currentUser.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${currentUser.id})`
      )
      .order("created_at", { ascending: true })
      .limit(250);

    if (loadError) {
      setError(loadError.message || "Couldn’t load this chat.");
      setLoading(false);
      return;
    }

    setMessages(data || []);
    setError("");
    setLoading(false);

    const unreadIds = (data || [])
      .filter((m) => m.recipient_id === currentUser.id && !m.read_at)
      .map((m) => m.id);

    if (unreadIds.length > 0) {
      await supabase
        .from("direct_messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds)
        .eq("recipient_id", currentUser.id);
    }
  }

  useEffect(() => {
    loadMessages();
    const interval = setInterval(() => loadMessages({ quiet: true }), 3000);
    return () => clearInterval(interval);
  }, [currentUser?.id, peerId]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: loading ? "auto" : "smooth",
      });
    });
  }, [messages.length, loading]);

  const grouped = useMemo(() => {
    const result = [];
    let lastDay = "";
    for (const message of messages) {
      const day = new Date(message.created_at).toDateString();
      if (day !== lastDay) {
        result.push({ type: "day", id: `day-${day}`, label: dayLabel(message.created_at) });
        lastDay = day;
      }
      result.push({ type: "message", ...message });
    }
    return result;
  }, [messages]);

  async function submitMessage(event) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending || !peerId) return;

    setSending(true);
    setError("");
    const optimisticId = `temp-${Date.now()}`;
    const optimistic = {
      id: optimisticId,
      sender_id: currentUser.id,
      recipient_id: peerId,
      body,
      created_at: new Date().toISOString(),
      read_at: null,
      system_generated: false,
      activity_type: null,
    };
    setMessages((items) => [...items, optimistic]);
    setDraft("");

    const { data, error: sendError } = await supabase
      .rpc("send_direct_message", {
        target_recipient_id: peerId,
        message_body: body,
      })
      .single();

    if (sendError) {
      setMessages((items) => items.filter((item) => item.id !== optimisticId));
      setDraft(body);
      setError(sendError.message || "Couldn’t send that message.");
    } else {
      setMessages((items) => items.map((item) => (item.id === optimisticId ? data : item)));
    }
    setSending(false);
    textareaRef.current?.focus();
  }

  function addReaction(emoji) {
    setDraft((value) => `${value}${value ? " " : ""}${emoji}`);
    textareaRef.current?.focus();
  }

  async function handlePoke() {
    if (pokeState === "sending") return;
    setPokeState("sending");
    const { error: pokeError } = await sendPoke(currentUser.id, peerId, currentProfile?.name);
    setPokeState(pokeError ? "error" : "sent");
    setTimeout(() => setPokeState(""), 1600);
  }

  return (
    <div className="chat-screen">
      <style>{`
        .chat-screen { height: 100dvh; min-height: 0; overflow: hidden; background: radial-gradient(circle at top, #e9e6ff 0, #f3f4f8 38%, #eef1f6 100%); color: #1b2129; }
        .chat-shell { width: min(100%, 760px); height: 100%; min-height: 0; margin: 0 auto; display: flex; flex-direction: column; overflow: hidden; background: rgba(255,255,255,.58); backdrop-filter: blur(16px); }
        .chat-header { flex: 0 0 auto; z-index: 20; display:flex; align-items:center; gap:12px; padding: 14px 16px; background: rgba(255,255,255,.82); border-bottom:1px solid rgba(27,33,41,.08); backdrop-filter: blur(18px); }
        .chat-avatar { width:44px; height:44px; border-radius:16px; display:grid; place-items:center; font-size:25px; background:linear-gradient(145deg,#fff,#ebe8ff); box-shadow:0 8px 22px rgba(74,62,140,.16); }
        .chat-poke { border:0; border-radius:999px; padding:9px 13px; background:#fff3cf; color:#805b00; font-weight:700; font-size:12px; box-shadow:0 6px 16px rgba(128,91,0,.12); transition:.18s ease; }
        .chat-poke:hover { transform:translateY(-1px); }
        .chat-body { flex:1 1 auto; min-height:0; padding:18px 14px 20px; overflow-y:auto; overscroll-behavior:contain; overflow-anchor:none; scroll-behavior:smooth; }
        .chat-day { width:max-content; margin:18px auto 12px; padding:5px 10px; border-radius:999px; background:rgba(27,33,41,.07); color:rgba(27,33,41,.55); font-size:11px; font-weight:700; }
        .chat-row { display:flex; margin:7px 0; }
        .chat-row.mine { justify-content:flex-end; }
        .chat-bubble { max-width:min(78%,520px); padding:10px 13px 7px; border-radius:20px; box-shadow:0 7px 18px rgba(27,33,41,.08); animation:chatPop .2s ease both; }
        .chat-row.mine .chat-bubble { background:linear-gradient(135deg,#7657ff,#4b72ff); color:#fff; border-bottom-right-radius:6px; }
        .chat-row.theirs .chat-bubble { background:rgba(255,255,255,.95); color:#1b2129; border-bottom-left-radius:6px; }
        .chat-bubble.system { max-width:min(90%,620px); background:linear-gradient(135deg,#fff7d6,#fff1b5)!important; color:#6f5200!important; border:1px solid rgba(174,128,0,.18); border-radius:18px!important; box-shadow:0 9px 24px rgba(128,91,0,.12); }
        .chat-text { white-space:pre-wrap; overflow-wrap:anywhere; font-size:15px; line-height:1.42; }
        .chat-meta { margin-top:4px; display:flex; gap:5px; justify-content:flex-end; font-size:9px; opacity:.62; }
        .chat-empty { text-align:center; margin:54px auto; max-width:300px; color:rgba(27,33,41,.56); }
        .chat-composer-wrap { flex:0 0 auto; z-index:25; width:100%; padding:8px 12px max(12px,env(safe-area-inset-bottom)); background:rgba(245,247,251,.97); border-top:1px solid rgba(27,33,41,.07); backdrop-filter:blur(18px); }
        .chat-reactions { display:flex; gap:7px; padding:4px 4px 8px; overflow-x:auto; scrollbar-width:none; }
        .chat-reaction { flex:0 0 auto; width:34px; height:30px; border:0; border-radius:999px; background:rgba(255,255,255,.9); box-shadow:0 4px 12px rgba(27,33,41,.08); font-size:16px; }
        .chat-composer { display:flex; align-items:flex-end; gap:8px; padding:8px; border-radius:24px; background:#fff; border:1px solid rgba(27,33,41,.09); box-shadow:0 12px 32px rgba(27,33,41,.13); }
        .chat-input { flex:1; min-height:40px; max-height:112px; resize:none; border:0; outline:0; padding:9px 8px; background:transparent; font:inherit; color:#1b2129; }
        .chat-send { width:42px; height:42px; flex:0 0 auto; border:0; border-radius:50%; display:grid; place-items:center; background:linear-gradient(135deg,#7657ff,#4b72ff); color:#fff; box-shadow:0 8px 18px rgba(75,114,255,.32); }
        .chat-send:disabled { opacity:.4; box-shadow:none; }
        @media (max-width: 520px) {
          .chat-header { padding:10px 10px; gap:9px; }
          .chat-avatar { width:40px; height:40px; border-radius:14px; font-size:22px; }
          .chat-poke { padding:8px 10px; }
          .chat-body { padding:12px 10px 16px; }
          .chat-composer-wrap { padding-left:8px; padding-right:8px; }
          .chat-reactions { padding-bottom:6px; }
        }
        @keyframes chatPop { from { transform:scale(.96) translateY(4px); opacity:.3; } to { transform:none; opacity:1; } }
      `}</style>

      <div className="chat-shell">
        <header className="chat-header">
          <button type="button" onClick={onBack} className="nav-btn" aria-label="Back" style={{ width:38,height:38,borderRadius:999,display:"grid",placeItems:"center",background:"#fff",border:"1px solid rgba(27,33,41,.08)" }}>
            <ArrowLeft size={18} />
          </button>
          <div className="chat-avatar">{peerProfile?.icon || "🙂"}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{peerProfile?.name || "Player"}</div>
            <div style={{ fontSize:11, color:"rgba(27,33,41,.5)" }}>private chat · {peer?.is_online ? "online now" : "offline"}</div>
          </div>
          <button type="button" onClick={handlePoke} className="chat-poke">
            {pokeState === "sending" ? "Poking…" : pokeState === "sent" ? "Poked! 👋" : pokeState === "error" ? "Try again" : "👋 Poke"}
          </button>
        </header>

        <main className="chat-body" ref={messagesRef}>
          {loading && <div className="chat-empty">Loading your chat…</div>}
          {!loading && messages.length === 0 && (
            <div className="chat-empty">
              <div style={{ fontSize:44, marginBottom:10 }}>💬✨</div>
              <div style={{ fontWeight:800, color:"#1b2129", marginBottom:6 }}>Start something fun</div>
              <div>Send a message, drop an emoji, or poke {peerProfile?.name || "them"}.</div>
            </div>
          )}
          {grouped.map((item) => {
            if (item.type === "day") return <div className="chat-day" key={item.id}>{item.label}</div>;
            const mine = item.sender_id === currentUser.id;
            return (
              <div className={`chat-row ${mine ? "mine" : "theirs"}`} key={item.id}>
                <div className={`chat-bubble${item.system_generated ? " system" : ""}`}>
                  <div className="chat-text">{item.body}</div>
                  <div className="chat-meta">
                    <span>{formatMessageTime(item.created_at)}</span>
                    {mine && <span>{item.read_at ? "Seen" : "Sent"}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {error && <div style={{ margin:"14px auto", maxWidth:520, padding:"10px 12px", borderRadius:14, background:"#fff0f0", color:"#a12b2b", fontSize:12 }}>{error}</div>}
          <div ref={bottomRef} />
        </main>

        <div className="chat-composer-wrap">
          <div className="chat-reactions" aria-label="Quick emoji reactions">
            {QUICK_REACTIONS.map((emoji) => <button type="button" className="chat-reaction" onClick={() => addReaction(emoji)} key={emoji}>{emoji}</button>)}
          </div>
          <form className="chat-composer" onSubmit={submitMessage}>
            <Sparkles size={18} style={{ margin:"11px 0 11px 4px", color:"#7657ff" }} />
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={draft}
              maxLength={1000}
              rows={1}
              placeholder={`Message ${peerProfile?.name || "player"}…`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitMessage();
                }
              }}
            />
            <button className="chat-send" type="submit" disabled={!draft.trim() || sending} aria-label="Send message">
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
