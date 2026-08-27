import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Send, Smile } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { sendPoke } from "./lib/pokes.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";
import { useI18n } from "./lib/i18n.jsx";
import Button from "./components/Button.jsx";
import StatusBanner from "./components/StatusBanner.jsx";
import ChatSafetyMenu from "./ChatSafetyMenu.jsx";
import BackButton from "./BackButton.jsx";

const QUICK_REACTIONS = ["👍", "👎", "❤️", "😂", "🔥", "👏"];
const MESSAGE_REACTIONS = [
  { id:"like",emoji:"👍",label:"Like" },
  { id:"dislike",emoji:"👎",label:"Dislike" },
  { id:"love",emoji:"❤️",label:"Love" },
];
const MESSAGE_REACTION_EMOJI = Object.fromEntries(MESSAGE_REACTIONS.map((item) => [item.id,item.emoji]));
const EMOJI_PICKER = ["😀","😂","🥰","😍","🤩","😎","🥳","😊","😉","🤔","😮","😢","😭","😡","👍","👎","❤️","🔥","👏","🎉","💯","🙌","🤝","👀","🎮","🏆","⭐","✨"];
const FLUENT_EMOJI_PATHS = {
  "😀":"Grinning face/animated/grinning_face_animated.png",
  "😂":"Face with tears of joy/animated/face_with_tears_of_joy_animated.png",
  "🥰":"Smiling face with hearts/animated/smiling_face_with_hearts_animated.png",
  "😍":"Smiling face with heart-eyes/animated/smiling_face_with_heart-eyes_animated.png",
  "🤩":"Star-struck/animated/star-struck_animated.png",
  "😎":"Smiling face with sunglasses/animated/smiling_face_with_sunglasses_animated.png",
  "🥳":"Partying face/animated/partying_face_animated.png",
  "😊":"Smiling face with smiling eyes/animated/smiling_face_with_smiling_eyes_animated.png",
  "😉":"Winking face/animated/winking_face_animated.png",
  "🤔":"Thinking face/animated/thinking_face_animated.png",
  "😮":"Face with open mouth/animated/face_with_open_mouth_animated.png",
  "😢":"Crying face/animated/crying_face_animated.png",
  "😭":"Loudly crying face/animated/loudly_crying_face_animated.png",
  "😡":"Angry face/animated/angry_face_animated.png",
  "👍":"Thumbs up/Default/animated/thumbs_up_animated_default.png",
  "👎":"Thumbs down/Default/animated/thumbs_down_animated_default.png",
  "❤️":"Red heart/animated/red_heart_animated.png",
  "🔥":"Fire/animated/fire_animated.png",
  "👏":"Clapping hands/Default/animated/clapping_hands_animated_default.png",
  "🎉":"Party popper/animated/party_popper_animated.png",
  "💯":"Hundred points/animated/hundred_points_animated.png",
  "🙌":"Raising hands/Default/animated/raising_hands_animated_default.png",
  "🤝":"Handshake/Default/animated/handshake_animated_default.png",
  "👀":"Eyes/animated/eyes_animated.png",
};
const FLUENT_EMOJI_ROOT = "https://media.githubusercontent.com/media/microsoft/fluentui-emoji-animated/main/assets/";

function FluentEmoji({ emoji,size = 28,animated = false }) {
  const [preview,setPreview] = useState(false);
  const path = FLUENT_EMOJI_PATHS[emoji];
  const showAnimation = path && (animated || preview);
  if (!showAnimation) {
    return (
      <span
        className="fluent-emoji-fallback"
        style={{ width:size,height:size,fontSize:Math.round(size*.68) }}
        onMouseEnter={() => setPreview(true)}
        onFocus={() => setPreview(true)}
      >
        {emoji}
      </span>
    );
  }
  return (
    <img
      className="fluent-emoji"
      src={`${FLUENT_EMOJI_ROOT}${path.split("/").map(encodeURIComponent).join("/")}`}
      width={size}
      height={size}
      alt={emoji}
      onMouseLeave={() => !animated && setPreview(false)}
      draggable="false"
    />
  );
}

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

export default function Chat({ currentUser, currentProfile, peer, onBack, onOpenScoreChallenge }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pokeState, setPokeState] = useState("");
  const { t } = useI18n();
  const [peerAvailable, setPeerAvailable] = useState(true);
  // stat id -> "played" | "unplayed". A missing key means "not looked up yet",
  // which renders no action rather than guessing at one.
  const [challengeStatus, setChallengeStatus] = useState({});
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  const [reactingMessageId, setReactingMessageId] = useState(null);
  const messagesRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const quickPressTimerRef = useRef(null);
  const quickPressOpenedRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const previousMessageCountRef = useRef(0);

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
      if (!peerError) {
        setPeerAvailable(
          !!livePeer
          && !livePeer.account_deleted_at
          && !livePeer.is_blocked
          && (livePeer.is_admin || livePeer.is_approved !== false)
        );
      }

      // Ordered newest-first so the limit keeps the most recent window, then
      // reversed for display. Ordering ascending kept the OLDEST 250 instead,
      // so a long conversation showed a stale window and never displayed — or
      // cleared — anything that arrived after its 250th message.
      let { data,error:loadError } = await supabase
        .from("direct_messages")
        .select("id,sender_id,recipient_id,body,created_at,read_at,system_generated,activity_type,source_stat_id,reactions:direct_message_reactions(user_id,reaction)")
        .or(
          `and(sender_id.eq.${currentUser.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${currentUser.id})`
        )
        .order("created_at",{ ascending:false })
        .limit(250);

      // Keep chat usable during the short deployment window before migration
      // v121 has been applied and PostgREST has discovered the relationship.
      if (loadError) {
        const fallback = await supabase
          .from("direct_messages")
          .select("id,sender_id,recipient_id,body,created_at,read_at,system_generated,activity_type,source_stat_id")
          .or(
            `and(sender_id.eq.${currentUser.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${currentUser.id})`
          )
          .order("created_at",{ ascending:false })
          .limit(250);
        data=fallback.data;
        loadError=fallback.error;
      }

      if (loadError) {
        setError(loadError.message || "Couldn’t load this chat.");
        setLoading(false);
        return;
      }

      const visibleMessages = (data || []).slice().reverse().filter(
        (message) => !(
          message.system_generated
          && message.sender_id === currentUser.id
          && message.recipient_id !== currentUser.id
        )
      );
      setMessages(visibleMessages);
      setError("");
      setLoading(false);

      // Resolve in one batch which "Beat my score" invitations are already
      // played. Status is tracked per stat id rather than as a set of played
      // ones: an id we have not checked yet is "unknown", and an unknown id
      // renders no action at all. Keying a plain set off "not present" made
      // every unchecked invitation look playable for one frame, so opening a
      // chat flashed Play now and then corrected itself.
      const challengeStatIds = [...new Set(
        visibleMessages
          .filter((message) => message.activity_type === "score_challenge" && message.source_stat_id)
          .map((message) => Number(message.source_stat_id))
      )];
      if (challengeStatIds.length > 0) {
        const { data: played, error: playedError } = await supabase.rpc("get_my_played_score_challenges", {
          source_stat_ids: challengeStatIds,
        });
        const playedSet = new Set((played || []).map((row) => Number(row.source_stat_id)));
        setChallengeStatus((previous) => {
          const next = { ...previous };
          for (const statId of challengeStatIds) {
            // If the lookup itself failed, fall back to offering the button:
            // App.jsx still guards the duplicate, and a missing button would
            // strand a player who genuinely has not played yet.
            next[statId] = playedError ? "unplayed" : (playedSet.has(statId) ? "played" : "unplayed");
          }
          return next;
        });
      }

      // Clear the whole conversation, not just the loaded window. Marking only
      // the displayed ids left anything older than the 250-message window
      // unread forever, which the badge kept counting. Self-addressed rows
      // (the Challenge results conversation) are covered by the same filter.
      if (visibleMessages.some((m) => m.recipient_id === currentUser.id && !m.read_at)) {
        await supabase
          .from("direct_messages")
          .update({ read_at: new Date().toISOString() })
          .eq("recipient_id", currentUser.id)
          .eq("sender_id", peerId)
          .is("read_at", null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, peerId]);

  useEffect(() => {
    initialScrollDoneRef.current=false;
    previousMessageCountRef.current=0;
  },[peerId]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container || loading) return;

    if (!initialScrollDoneRef.current) {
      // Position before paint so opening a long conversation never visibly
      // travels from its oldest message to its newest one.
      const previousBehaviour=container.style.scrollBehavior;
      container.style.scrollBehavior="auto";
      container.scrollTop=container.scrollHeight;
      container.style.scrollBehavior=previousBehaviour;
      initialScrollDoneRef.current=true;
      previousMessageCountRef.current=messages.length;
      return;
    }

    if (messages.length > previousMessageCountRef.current) {
      container.scrollTo({ top:container.scrollHeight,behavior:"smooth" });
    }
    previousMessageCountRef.current=messages.length;
  },[messages.length,loading]);

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
      <div className="chat-screen" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--color-page-bg)" }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 320 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
          <div style={{ fontWeight: 800, color: "var(--color-text-primary)", marginBottom: 6 }}>Opening chat…</div>
          <div style={{ color: "var(--color-text-secondary)", fontSize: 13, marginBottom: 16 }}>The chat is still getting ready. If it takes too long, go back and open it again.</div>
          <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-screen">
      <style>{`
        .chat-screen { height: 100dvh; min-height: 0; overflow: hidden; background: var(--color-page-bg); color: var(--color-text-primary); }
        .chat-shell { width: min(100%, 760px); height: 100%; min-height: 0; margin: 0 auto; display: flex; flex-direction: column; overflow: hidden; background: var(--color-page-bg); }
        .chat-header { flex: 0 0 auto; z-index: 20; display:flex; align-items:center; gap:12px; padding: calc(14px + var(--safe-top)) calc(16px + var(--safe-right)) 14px calc(16px + var(--safe-left)); background: var(--color-surface); border-bottom:1px solid var(--color-border); }
        .chat-avatar { width:44px; height:44px; border-radius:var(--radius-md); display:grid; place-items:center; font-size:25px; background:var(--color-primary-subtle); border:1px solid var(--color-primary-subtle-border); }
        .chat-poke { min-width:76px; min-height:44px; border:1px solid var(--color-warning-border); border-radius:var(--radius-full); padding:9px 13px; background:var(--color-warning-bg); color:var(--color-warning-text); font-weight:700; font-size:12px; cursor:pointer; transition:transform var(--transition-fast); }
        .chat-poke:hover { transform:translateY(-1px); }
        .chat-poke:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }
        .chat-body { flex:1 1 auto; min-height:0; padding:18px 14px 20px; overflow-y:auto; overscroll-behavior:contain; overflow-anchor:none; }
        .chat-day { width:max-content; margin:18px auto 12px; padding:5px 10px; border-radius:var(--radius-full); background:var(--color-surface-elevated); color:var(--color-text-secondary); font-size:11px; font-weight:700; }
        .chat-row { display:flex; margin:7px 0; }
        .chat-row.mine { justify-content:flex-end; }
        .chat-bubble { position:relative; max-width:min(78%,520px); padding:10px 13px 7px; border-radius:var(--radius-xl); box-shadow:var(--shadow-card); animation:chatPop .2s ease both; cursor:pointer; }
        .chat-row.has-reaction { margin-bottom:18px; }
        .chat-message-picker { position:absolute; z-index:35; bottom:calc(100% + 7px); display:flex; gap:3px; padding:5px; border-radius:var(--radius-full); background:var(--color-surface); border:1px solid var(--color-border); box-shadow:var(--shadow-menu); }
        .chat-row.mine .chat-message-picker { right:0; }
        .chat-row.theirs .chat-message-picker { left:0; }
        .chat-message-reaction { width:36px; height:34px; border:0; border-radius:50%; background:transparent; font-size:19px; cursor:pointer; transition:transform .13s ease,background .13s ease; }
        .chat-message-reaction:hover,.chat-message-reaction.is-selected { background:var(--color-primary-subtle); transform:scale(1.08); }
        .chat-reaction-badges { position:absolute; bottom:-13px; display:flex; gap:3px; padding:2px 5px; min-height:24px; border-radius:var(--radius-full); background:var(--color-surface); color:var(--color-text-primary); border:1px solid var(--color-border); box-shadow:var(--shadow-control); }
        .chat-row.mine .chat-reaction-badges { right:8px; }
        .chat-row.theirs .chat-reaction-badges { left:8px; }
        .chat-reaction-count { display:flex; align-items:center; gap:2px; font-size:13px; line-height:1; }
        .chat-reaction-count small { font-size:9px; font-weight:800; color:var(--color-text-secondary); }
        .chat-row.mine .chat-bubble { background:var(--color-primary); color:var(--color-primary-text); border-bottom-right-radius:6px; }
        .chat-row.theirs .chat-bubble { background:var(--color-surface); color:var(--color-text-primary); border:1px solid var(--color-border); border-bottom-left-radius:6px; }
        .chat-bubble.system { max-width:min(90%,620px); background:var(--color-warning-bg) !important; color:var(--color-warning-text) !important; border:1px solid var(--color-warning-border); border-radius:var(--radius-lg) !important; box-shadow:var(--shadow-card); }
        .chat-text { white-space:pre-wrap; overflow-wrap:anywhere; font-size:15px; line-height:1.42; }
        .chat-text.emoji-only { min-width:62px; display:grid; place-items:center; padding:3px 0; }
        .fluent-emoji,.fluent-emoji-fallback { display:inline-grid; place-items:center; object-fit:contain; vertical-align:middle; flex:0 0 auto; }
        .fluent-emoji { max-width:none; }
        .chat-meta { margin-top:4px; display:flex; gap:5px; justify-content:flex-end; font-size:9px; color:currentColor; }
        .chat-row.theirs .chat-meta { color:var(--color-text-secondary); }
        .chat-empty { text-align:center; margin:54px auto; max-width:300px; color:var(--color-text-secondary); }
        .chat-error { margin:14px auto; max-width:520px; }
        .chat-composer-wrap { position:relative; flex:0 0 auto; z-index:25; width:100%; padding:8px 12px max(12px,env(safe-area-inset-bottom)); background:var(--color-surface); border-top:1px solid var(--color-border); }
        .chat-notice { padding:12px 14px; border-radius:var(--radius-lg); background:var(--color-surface-elevated); color:var(--color-text-secondary); font-size:13px; text-align:center; border:1px solid var(--color-border); }
        .chat-composer { display:flex; align-items:flex-end; gap:6px; padding:7px 8px; border-radius:var(--radius-xl); background:var(--color-surface-input); border:1px solid var(--color-border); box-shadow:var(--shadow-control); }
        .chat-input { flex:1; min-width:0; min-height:40px; max-height:112px; resize:none; border:0; outline:0; padding:9px 6px; background:transparent; font:inherit; color:var(--color-text-primary); }
        .chat-input::placeholder { color:var(--color-text-muted); }
        .chat-tool,.chat-send,.chat-quick { width:40px; height:40px; flex:0 0 auto; border:0; border-radius:50%; display:grid; place-items:center; cursor:pointer; }
        .chat-tool { background:transparent; color:var(--color-primary); }
        .chat-tool.is-open { background:var(--color-primary-subtle); }
        .chat-tool:focus-visible,.chat-send:focus-visible,.chat-quick:focus-visible,.chat-message-reaction:focus-visible,.chat-picker-button:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }
        .chat-send { background:var(--color-primary); color:var(--color-primary-text); box-shadow:var(--shadow-primary); }
        .chat-send:disabled { background:var(--color-disabled-bg); color:var(--color-disabled-text); box-shadow:none; cursor:not-allowed; }
        .chat-quick { background:var(--color-primary-subtle); font-size:19px; touch-action:none; user-select:none; -webkit-user-select:none; }
        .chat-picker { position:absolute; z-index:40; bottom:calc(100% + 7px); padding:8px; border-radius:var(--radius-lg); background:var(--color-surface); border:1px solid var(--color-border); box-shadow:var(--shadow-menu); }
        .chat-emoji-picker { left:14px; width:min(310px,calc(100% - 28px)); display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
        .chat-quick-picker { right:14px; display:flex; gap:3px; border-radius:var(--radius-full); }
        .chat-picker-button { width:36px; height:34px; border:0; border-radius:var(--radius-sm); background:transparent; font-size:19px; cursor:pointer; transition:transform .13s ease,background .13s ease; }
        .chat-picker-button:hover { background:var(--color-primary-subtle); transform:scale(1.08); }
        @media (max-width: 520px) {
          .chat-header { padding:calc(10px + var(--safe-top)) calc(10px + var(--safe-right)) 10px calc(10px + var(--safe-left)); gap:9px; }
          .chat-avatar { width:40px; height:40px; border-radius:var(--radius-sm); font-size:22px; }
          .chat-poke { min-width:70px; padding:8px 10px; }
          .chat-body { padding:12px 10px 16px; }
          .chat-composer-wrap { padding-left:8px; padding-right:8px; }
          .chat-emoji-picker { grid-template-columns:repeat(7,1fr); }
        }
        @media (prefers-reduced-motion: reduce) {
          .chat-bubble { animation:none !important; }
          .chat-poke, .chat-message-reaction, .chat-picker-button { transition:none !important; }
        }
        @keyframes chatPop { from { transform:scale(.96) translateY(4px); opacity:.3; } to { transform:none; opacity:1; } }
      `}</style>

      <div className="chat-shell">
        <header className="chat-header">
          <BackButton onClick={onBack} ariaLabel="Back" />
          <div className="chat-avatar">{peerAvailable ? (peerProfile?.icon || "🙂") : "🙂"}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{peerAvailable ? (peerProfile?.name || "Player") : "Unavailable player"}</div>
            <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>
              {isSystemConversation ? "challenge notifications" : `private chat · ${peer?.is_online ? "online now" : "offline"}`}
            </div>
          </div>
          {!isSystemConversation && (
            <ChatSafetyMenu
              peerId={peerId}
              peerName={peerProfile?.name}
              onBlocked={() => { setPeerAvailable(false); onBack?.(); }}
            />
          )}
        </header>
        {!isSystemConversation && <div style={{ flex:"0 0 auto", display:"flex", justifyContent:"flex-end", padding:"8px calc(16px + var(--safe-right))", background:"var(--color-page-bg)", borderBottom:"1px solid var(--color-border)" }}><button type="button" disabled={!peerAvailable} onClick={handlePoke} className="chat-poke" style={{ opacity:peerAvailable ? 1 : .4 }}>{pokeState === "sending" ? "Poking…" : pokeState === "sent" ? "Poked! 👋" : pokeState === "error" ? "Try again" : "👋 Poke"}</button></div>}

        <main className="chat-body" ref={messagesRef}>
          {loading && <div className="chat-empty">Loading your chat…</div>}
          {!loading && messages.length === 0 && (
            <div className="chat-empty">
              <div style={{ fontSize:44, marginBottom:10 }}>💬✨</div>
              <div style={{ fontWeight:800, color:"var(--color-text-primary)", marginBottom:6 }}>Start something fun</div>
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
                          <FluentEmoji emoji={reaction.emoji} size={27}/>
                        </button>
                      ))}
                    </div>
                  )}
                  {FLUENT_EMOJI_PATHS[item.body] && !item.system_generated ? (
                    <div className="chat-text emoji-only">
                      <FluentEmoji emoji={item.body} size={58} animated/>
                    </div>
                  ) : (
                    <div className="chat-text">{item.body}</div>
                  )}
                  {item.activity_type === "score_challenge" && item.source_stat_id && (() => {
                    const status = challengeStatus[Number(item.source_stat_id)];
                    if (status === "played") {
                      return (
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:8, fontSize:"var(--text-caption-size)", fontWeight:600, color:"var(--color-text-secondary)" }}>
                          <Check size={13} /> {t("chat.alreadyPlayed")}
                        </div>
                      );
                    }
                    if (status === "unplayed") {
                      return (
                        <Button
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenScoreChallenge?.(item.source_stat_id);
                          }}
                          style={{ marginTop:8 }}
                        >
                          {t("chat.playNow")}
                        </Button>
                      );
                    }
                    // Reserves the row's height while the status resolves, so
                    // the bubble does not jump when the control appears.
                    return <div aria-hidden="true" style={{ height:32, marginTop:8 }} />;
                  })()}
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
          {error && <div className="chat-error"><StatusBanner variant="error">{error}</StatusBanner></div>}
          <div ref={bottomRef} />
        </main>

        {isSystemConversation ? (
          <div className="chat-composer-wrap">
            <div className="chat-notice">Challenge results are posted here automatically.</div>
          </div>
        ) : !peerAvailable ? (
          <div className="chat-composer-wrap">
            <div className="chat-notice">This account is no longer available for messages.</div>
          </div>
        ) : <div className="chat-composer-wrap">
          {emojiPickerOpen && (
            <div className="chat-picker chat-emoji-picker" role="dialog" aria-label="Choose an emoji">
              {EMOJI_PICKER.map((emoji) => (
                <button type="button" className="chat-picker-button" onClick={() => addEmoji(emoji)} key={emoji} aria-label={`Add ${emoji}`}>
                  <FluentEmoji emoji={emoji} size={28}/>
                </button>
              ))}
            </div>
          )}
          {quickPickerOpen && (
            <div className="chat-picker chat-quick-picker" role="dialog" aria-label="Choose a quick reaction">
              {QUICK_REACTIONS.map((emoji) => (
                <button type="button" className="chat-picker-button" onClick={() => sendQuickReaction(emoji)} key={emoji} aria-label={`Send ${emoji}`}>
                  <FluentEmoji emoji={emoji} size={28}/>
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
              <FluentEmoji emoji="👍" size={27}/>
            </button>
          </form>
        </div>}
      </div>
    </div>
  );
}
