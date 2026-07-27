import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Send, Smile } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { sendPoke } from "./lib/pokes.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";

const QUICK_REACTIONS = ["👍", "👎", "❤️", "😂", "🔥", "👏"];
const MESSAGE_REACTIONS = [
  { id:"like",emoji:"👍",label:"Like" },
  { id:"dislike",emoji:"👎",label:"Dislike" },
  { id:"love",emoji:"❤️",label:"Love" },
];
const MESSAGE_REACTION_EMOJI = Object.fromEntries(MESSAGE_REACTIONS.map((item) => [item.id,item.emoji]));
const EMOJI_PICKER = ["😀","😂","🥰","😍","🤩","😎","🥳","😊","😉","🤔","😮","😢","😭","😡","👍","👎","❤️","🔥","👏","🎉","💯","🙌","🤝","👀","🎮","🏆","⭐","✨"];

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
  const [peerAvailable, setPeerAvailable] = useState(true);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  const [reactingMessageId, setReactingMessageId] = useState(null);
  const messagesRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const quickPressTimerRef = useRef(null);
  const quickPressOpenedRef = useRef(false);

  const peerId = peer?.user_id || peer?.id || null;
  const peerProfile = peer?.profiles || peer || null;
  const isSystemConversation = peerId === currentUser?.id;

  async function loadMessages({ quiet = false } = {}) {
    if (!supabaseReady || !currentUser?.id || !peerId) {
      if (!quiet) setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);

    try {
      const { data: livePeer, error: peerError } = await supabase
        .from("profiles")
        .select("id,is_admin,is_approved,is_blocked,account_deleted_at")
        .eq("id", peerId)
        .maybeSingle();
      if (!peerError && livePeer) {
        setPeerAvailable(
          !livePeer.account_deleted_at
          && !livePeer.is_blocked
          && (livePeer.is_admin || livePeer.is_approved !== false)
        );
      }

      let { data,error:loadError } = await supabase
        .from("direct_messages")
        .select("id,sender_id,recipient_id,body,created_at,read_at,system_generated,activity_type,reactions:direct_message_reactions(user_id,reaction)")
        .or(
          `and(sender_id.eq.${currentUser.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${currentUser.id})`
        )
        .order("created_at",{ ascending:true })
        .limit(250);

      // Keep chat usable during the short deployment window before migration
      // v121 has been applied and PostgREST has discovered the relationship.
      if (loadError) {
        const fallback = await supabase
          .from("direct_messages")
          .select("id,sender_id,recipient_id,body,created_at,read_at,system_generated,activity_type")
          .or(
            `and(sender_id.eq.${currentUser.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${currentUser.id})`
          )
          .order("created_at",{ ascending:true })
          .limit(250);
        data=fallback.data;
        loadError=fallback.error;
      }

      if (loadError) {
        setError(loadError.message || "Couldn’t load this chat.");
        setLoading(false);
        return;
      }

      const visibleMessages = (data || []).filter(
        (message) => !(
          message.system_generated
          && message.sender_id === currentUser.id
          && message.recipient_id !== currentUser.id
        )
      );
      setMessages(visibleMessages);
      setError("");
      setLoading(false);

      const unreadIds = visibleMessages
        .filter((m) => m.recipient_id === currentUser.id && !m.read_at)
        .map((m) => m.id);

      if (unreadIds.length > 0) {
        await supabase
          .from("direct_messages")
          .update({ read_at: new Date().toISOString() })
          .in("id", unreadIds)
          .eq("recipient_id", currentUser.id);
      }
    } catch (err) {
      console.error("Chat load failed:", err);
      setError("Couldn’t open this chat just now. Pull back and try again.");
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
    return attachRealtimeRefresh({
      channelName: `chat-${currentUser?.id}-${peerId}`,
      tables: [{ name:"direct_messages" },{ name:"direct_message_reactions" },{ name:"profiles" }],
      refresh: () => loadMessages({ quiet: true }),
      fallbackMs: 60000,
    });
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

  async function sendMessageBody(rawBody, restoreDraftOnError = false) {
    const body = rawBody.trim();
    if (!body || sending || !peerId || !peerAvailable) return;

    setSending(true);
    setError("");
    const optimisticId = `temp-${Date.now()}`;
    const optimistic = {
      id:optimisticId,
      sender_id:currentUser.id,
      recipient_id:peerId,
      body,
      created_at:new Date().toISOString(),
      read_at:null,
      system_generated:false,
      activity_type:null,
    };
    setMessages((items) => [...items,optimistic]);

    const { data,error:sendError } = await supabase
      .rpc("send_direct_message", {
        target_recipient_id:peerId,
        message_body:body,
      })
      .single();

    if (sendError) {
      setMessages((items) => items.filter((item) => item.id !== optimisticId));
      if (restoreDraftOnError) setDraft(body);
      setError(sendError.message || "Couldn’t send that message.");
    } else {
      setMessages((items) => items.map((item) => item.id === optimisticId ? data : item));
    }
    setSending(false);
    textareaRef.current?.focus();
  }

  function submitMessage(event) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    void sendMessageBody(body,true);
  }

  function addEmoji(emoji) {
    setDraft((value) => `${value}${value ? " " : ""}${emoji}`);
    setEmojiPickerOpen(false);
    textareaRef.current?.focus();
  }

  function sendQuickReaction(emoji) {
    setQuickPickerOpen(false);
    setEmojiPickerOpen(false);
    void sendMessageBody(emoji);
  }

  function startQuickPress() {
    if (sending) return;
    quickPressOpenedRef.current = false;
    window.clearTimeout(quickPressTimerRef.current);
    quickPressTimerRef.current = window.setTimeout(() => {
      quickPressOpenedRef.current = true;
      setQuickPickerOpen(true);
      setEmojiPickerOpen(false);
    },450);
  }

  function finishQuickPress() {
    window.clearTimeout(quickPressTimerRef.current);
    if (quickPressOpenedRef.current) {
      quickPressOpenedRef.current = false;
      return;
    }
    sendQuickReaction("👍");
  }

  function cancelQuickPress() {
    window.clearTimeout(quickPressTimerRef.current);
  }

  async function toggleMessageReaction(messageId,reaction) {
    if (!messageId || String(messageId).startsWith("temp-") || sending) return;
    setReactingMessageId(null);
    const previousMessages = messages;
    setMessages((items) => items.map((message) => {
      if (message.id !== messageId) return message;
      const reactions = (message.reactions || []).filter((item) => item.user_id !== currentUser.id);
      const existing = (message.reactions || []).find((item) => item.user_id === currentUser.id)?.reaction;
      if (existing !== reaction) reactions.push({ user_id:currentUser.id,reaction });
      return { ...message,reactions };
    }));

    const { error:reactionError } = await supabase.rpc("toggle_direct_message_reaction", {
      target_message_id:messageId,
      reaction_in:reaction,
    });
    if (reactionError) {
      setMessages(previousMessages);
      setError(reactionError.message || "Couldn’t save that reaction.");
    }
  }

  async function handlePoke() {
    if (pokeState === "sending" || !currentUser?.id || !peerId || !peerAvailable) return;
    setPokeState("sending");
    try {
      const { error: pokeError } = await sendPoke(currentUser.id, peerId, currentProfile?.name);
      setPokeState(pokeError ? "error" : "sent");
    } catch (err) {
      console.error("Poke failed:", err);
      setPokeState("error");
    }
    setTimeout(() => setPokeState(""), 1600);
  }

  if (!currentUser?.id || !peerId) {
    return (
      <div className="chat-screen" style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 320 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
          <div style={{ fontWeight: 800, color: "#1b2129", marginBottom: 6 }}>Opening chat…</div>
          <div style={{ color: "rgba(27,33,41,.6)", fontSize: 13, marginBottom: 16 }}>The chat is still getting ready. If it takes too long, go back and open it again.</div>
          <button type="button" onClick={onBack} className="gloss-button nav-btn" style={{ padding: "10px 16px", borderRadius: 999, background: "#fff", border: "1px solid rgba(27,33,41,.08)" }}>Back</button>
        </div>
      </div>
    );
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
        .chat-bubble { position:relative; max-width:min(78%,520px); padding:10px 13px 7px; border-radius:20px; box-shadow:0 7px 18px rgba(27,33,41,.08); animation:chatPop .2s ease both; cursor:pointer; }
        .chat-row.has-reaction { margin-bottom:18px; }
        .chat-message-picker { position:absolute; z-index:35; bottom:calc(100% + 7px); display:flex; gap:3px; padding:5px; border-radius:999px; background:rgba(255,255,255,.98); border:1px solid rgba(27,33,41,.09); box-shadow:0 12px 30px rgba(27,33,41,.18); }
        .chat-row.mine .chat-message-picker { right:0; }
        .chat-row.theirs .chat-message-picker { left:0; }
        .chat-message-reaction { width:36px; height:34px; border:0; border-radius:50%; background:transparent; font-size:19px; transition:transform .13s ease,background .13s ease; }
        .chat-message-reaction:hover,.chat-message-reaction.is-selected { background:rgba(118,87,255,.11); transform:scale(1.08); }
        .chat-reaction-badges { position:absolute; bottom:-13px; display:flex; gap:3px; padding:2px 5px; min-height:24px; border-radius:999px; background:#fff; color:#1b2129; border:1px solid rgba(27,33,41,.10); box-shadow:0 4px 11px rgba(27,33,41,.13); }
        .chat-row.mine .chat-reaction-badges { right:8px; }
        .chat-row.theirs .chat-reaction-badges { left:8px; }
        .chat-reaction-count { display:flex; align-items:center; gap:2px; font-size:13px; line-height:1; }
        .chat-reaction-count small { font-size:9px; font-weight:800; opacity:.55; }
        .chat-row.mine .chat-bubble { background:linear-gradient(135deg,#7657ff,#4b72ff); color:#fff; border-bottom-right-radius:6px; }
        .chat-row.theirs .chat-bubble { background:rgba(255,255,255,.95); color:#1b2129; border-bottom-left-radius:6px; }
        .chat-bubble.system { max-width:min(90%,620px); background:linear-gradient(135deg,#fff7d6,#fff1b5)!important; color:#6f5200!important; border:1px solid rgba(174,128,0,.18); border-radius:18px!important; box-shadow:0 9px 24px rgba(128,91,0,.12); }
        .chat-text { white-space:pre-wrap; overflow-wrap:anywhere; font-size:15px; line-height:1.42; }
        .chat-meta { margin-top:4px; display:flex; gap:5px; justify-content:flex-end; font-size:9px; opacity:.62; }
        .chat-empty { text-align:center; margin:54px auto; max-width:300px; color:rgba(27,33,41,.56); }
        .chat-composer-wrap { position:relative; flex:0 0 auto; z-index:25; width:100%; padding:8px 12px max(12px,env(safe-area-inset-bottom)); background:rgba(245,247,251,.97); border-top:1px solid rgba(27,33,41,.07); backdrop-filter:blur(18px); }
        .chat-composer { display:flex; align-items:flex-end; gap:6px; padding:7px 8px; border-radius:24px; background:#fff; border:1px solid rgba(27,33,41,.09); box-shadow:0 12px 32px rgba(27,33,41,.13); }
        .chat-input { flex:1; min-width:0; min-height:40px; max-height:112px; resize:none; border:0; outline:0; padding:9px 6px; background:transparent; font:inherit; color:#1b2129; }
        .chat-tool,.chat-send,.chat-quick { width:40px; height:40px; flex:0 0 auto; border:0; border-radius:50%; display:grid; place-items:center; }
        .chat-tool { background:transparent; color:#7657ff; }
        .chat-tool.is-open { background:rgba(118,87,255,.10); }
        .chat-send { background:linear-gradient(135deg,#7657ff,#4b72ff); color:#fff; box-shadow:0 8px 18px rgba(75,114,255,.28); }
        .chat-send:disabled { opacity:.32; box-shadow:none; }
        .chat-quick { background:rgba(118,87,255,.10); font-size:19px; touch-action:none; user-select:none; -webkit-user-select:none; }
        .chat-picker { position:absolute; z-index:40; bottom:calc(100% + 7px); padding:8px; border-radius:18px; background:rgba(255,255,255,.98); border:1px solid rgba(27,33,41,.09); box-shadow:0 16px 38px rgba(27,33,41,.18); backdrop-filter:blur(16px); }
        .chat-emoji-picker { left:14px; width:min(310px,calc(100% - 28px)); display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
        .chat-quick-picker { right:14px; display:flex; gap:3px; border-radius:999px; }
        .chat-picker-button { width:36px; height:34px; border:0; border-radius:11px; background:transparent; font-size:19px; transition:transform .13s ease,background .13s ease; }
        .chat-picker-button:hover { background:rgba(118,87,255,.08); transform:scale(1.08); }
        @media (max-width: 520px) {
          .chat-header { padding:10px 10px; gap:9px; }
          .chat-avatar { width:40px; height:40px; border-radius:14px; font-size:22px; }
          .chat-poke { padding:8px 10px; }
          .chat-body { padding:12px 10px 16px; }
          .chat-composer-wrap { padding-left:8px; padding-right:8px; }
          .chat-emoji-picker { grid-template-columns:repeat(7,1fr); }
        }
        @keyframes chatPop { from { transform:scale(.96) translateY(4px); opacity:.3; } to { transform:none; opacity:1; } }
      `}</style>

      <div className="chat-shell">
        <header className="chat-header">
          <button type="button" onClick={onBack} className="gloss-button nav-btn" aria-label="Back" style={{ width:38,height:38,borderRadius:999,display:"grid",placeItems:"center",background:"#fff",border:"1px solid rgba(27,33,41,.08)" }}>
            <ArrowLeft size={18} />
          </button>
          <div className="chat-avatar">{peerProfile?.icon || "🙂"}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{peerProfile?.name || "Player"}</div>
            <div style={{ fontSize:11, color:"rgba(27,33,41,.5)" }}>
              {isSystemConversation ? "challenge notifications" : `private chat · ${peer?.is_online ? "online now" : "offline"}`}
            </div>
          </div>
          {!isSystemConversation && (
            <button type="button" disabled={!peerAvailable} onClick={handlePoke} className="gloss-button chat-poke" style={{ opacity:peerAvailable ? 1 : .4 }}>
              {pokeState === "sending" ? "Poking…" : pokeState === "sent" ? "Poked! 👋" : pokeState === "error" ? "Try again" : "👋 Poke"}
            </button>
          )}
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
            const reactions = item.reactions || [];
            const reactionCounts = reactions.reduce((counts,reaction) => {
              counts[reaction.reaction]=(counts[reaction.reaction] || 0)+1;
              return counts;
            },{});
            const myReaction = reactions.find((reaction) => reaction.user_id === currentUser.id)?.reaction;
            const pickerOpen = reactingMessageId === item.id;
            const canReact = !item.system_generated && !String(item.id).startsWith("temp-");
            return (
              <div className={`chat-row ${mine ? "mine" : "theirs"}${reactions.length ? " has-reaction" : ""}`} key={item.id}>
                <div
                  className={`chat-bubble${item.system_generated ? " system" : ""}`}
                  onClick={() => canReact && setReactingMessageId(pickerOpen ? null : item.id)}
                  role={canReact ? "button" : undefined}
                  tabIndex={canReact ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (canReact && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      setReactingMessageId(pickerOpen ? null : item.id);
                    }
                  }}
                  aria-label={canReact ? "Message. Activate to react." : undefined}
                >
                  {pickerOpen && (
                    <div className="chat-message-picker" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="React to message">
                      {MESSAGE_REACTIONS.map((reaction) => (
                        <button
                          type="button"
                          className={`chat-message-reaction${myReaction === reaction.id ? " is-selected" : ""}`}
                          key={reaction.id}
                          onClick={() => toggleMessageReaction(item.id,reaction.id)}
                          aria-label={myReaction === reaction.id ? `Remove ${reaction.label}` : reaction.label}
                        >
                          {reaction.emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="chat-text">{item.body}</div>
                  <div className="chat-meta">
                    <span>{formatMessageTime(item.created_at)}</span>
                    {mine && <span>{item.read_at ? "Seen" : "Sent"}</span>}
                  </div>
                  {Object.keys(reactionCounts).length > 0 && (
                    <div className="chat-reaction-badges" aria-label={`${reactions.length} message reaction${reactions.length === 1 ? "" : "s"}`}>
                      {Object.entries(reactionCounts).map(([reaction,count]) => (
                        <span className="chat-reaction-count" key={reaction}>
                          {MESSAGE_REACTION_EMOJI[reaction] || "🙂"}{count > 1 && <small>{count}</small>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {error && <div style={{ margin:"14px auto", maxWidth:520, padding:"10px 12px", borderRadius:14, background:"#fff0f0", color:"#a12b2b", fontSize:12 }}>{error}</div>}
          <div ref={bottomRef} />
        </main>

        {isSystemConversation ? (
          <div className="chat-composer-wrap">
            <div style={{ padding:"11px 14px", borderRadius:18, background:"rgba(255,255,255,.9)", color:"rgba(27,33,41,.56)", fontSize:12, textAlign:"center", border:"1px solid rgba(27,33,41,.08)" }}>
              Challenge results are posted here automatically.
            </div>
          </div>
        ) : !peerAvailable ? (
          <div className="chat-composer-wrap">
            <div style={{ padding:"12px 14px", borderRadius:18, background:"#fff", color:"rgba(27,33,41,.62)", fontSize:13, textAlign:"center", border:"1px solid rgba(27,33,41,.08)" }}>
              This account is no longer available for messages.
            </div>
          </div>
        ) : <div className="chat-composer-wrap">
          {emojiPickerOpen && (
            <div className="chat-picker chat-emoji-picker" role="dialog" aria-label="Choose an emoji">
              {EMOJI_PICKER.map((emoji) => (
                <button type="button" className="chat-picker-button" onClick={() => addEmoji(emoji)} key={emoji} aria-label={`Add ${emoji}`}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {quickPickerOpen && (
            <div className="chat-picker chat-quick-picker" role="dialog" aria-label="Choose a quick reaction">
              {QUICK_REACTIONS.map((emoji) => (
                <button type="button" className="chat-picker-button" onClick={() => sendQuickReaction(emoji)} key={emoji} aria-label={`Send ${emoji}`}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <form className="chat-composer" onSubmit={submitMessage}>
            <button
              type="button"
              className={`chat-tool${emojiPickerOpen ? " is-open" : ""}`}
              onClick={() => {
                setEmojiPickerOpen((value) => !value);
                setQuickPickerOpen(false);
              }}
              aria-label="Choose emoji"
              aria-expanded={emojiPickerOpen}
            >
              <Smile size={21}/>
            </button>
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
              <Send size={18}/>
            </button>
            <button
              className="chat-quick"
              type="button"
              disabled={sending}
              onPointerDown={startQuickPress}
              onPointerUp={finishQuickPress}
              onPointerCancel={cancelQuickPress}
              onPointerLeave={cancelQuickPress}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  sendQuickReaction("👍");
                }
              }}
              aria-label="Send thumbs up. Press and hold for more reactions."
              aria-expanded={quickPickerOpen}
            >
              👍
            </button>
          </form>
        </div>}
      </div>
    </div>
  );
}
