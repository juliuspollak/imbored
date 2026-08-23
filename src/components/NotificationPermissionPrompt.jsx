import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { isNativePlatform } from "../lib/platform.js";
import { enableNativeNotifications, nativePermissionStatus } from "../lib/nativeNotifications.js";
import Button from "./Button.jsx";

export default function NotificationPermissionPrompt({ userId }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dismissedKey = `imbored-notification-prompt-dismissed-${userId}`;

  useEffect(() => {
    if (!userId || !isNativePlatform()) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      let dismissed = false;
      try { dismissed = window.localStorage.getItem(dismissedKey) === "true"; } catch { /* session-only prompt */ }
      const status = await nativePermissionStatus();
      if (!cancelled && !dismissed && status.receive === "prompt") setVisible(true);
    }, 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [dismissedKey, userId]);

  function dismiss() {
    try { window.localStorage.setItem(dismissedKey, "true"); } catch { /* do not nag again this session */ }
    setVisible(false);
  }

  async function enable() {
    setBusy(true); setMessage("");
    const result = await enableNativeNotifications();
    setBusy(false);
    if (result.granted) dismiss();
    else setMessage(result.reason === "denied" ? "Notifications are disabled in iPhone Settings." : "Notifications were not enabled.");
  }

  if (!visible) return null;
  return <div role="dialog" aria-labelledby="notification-prompt-title" style={{ position:"fixed", zIndex:220, left:"var(--space-4)", right:"var(--space-4)", bottom:"calc(var(--space-4) + env(safe-area-inset-bottom, 0px))", maxWidth:420, margin:"0 auto", padding:"var(--space-4)", borderRadius:"var(--radius-lg)", background:"var(--color-surface)", border:"1px solid var(--color-border)", boxShadow:"var(--shadow-menu)" }}>
    <div style={{ display:"flex", alignItems:"flex-start", gap:"var(--space-3)" }}>
      <span style={{ width:40, height:40, borderRadius:"var(--radius-md)", display:"grid", placeItems:"center", flexShrink:0, color:"var(--color-primary)", background:"var(--color-primary-subtle)" }}><Bell size={19}/></span>
      <div style={{ flex:1 }}><strong id="notification-prompt-title" style={{ color:"var(--color-text-primary)" }}>Stay in the game</strong><p style={{ margin:"4px 0 0", fontSize:"var(--text-caption-size)", lineHeight:1.5, color:"var(--color-text-secondary)" }}>Get notified about new Circle challenges, today’s challenge, and score updates.</p></div>
      <button type="button" onClick={dismiss} aria-label="Not now" style={{ border:0, padding:4, background:"transparent", color:"var(--color-text-secondary)" }}><X size={17}/></button>
    </div>
    {message && <p style={{ margin:"var(--space-2) 0 0", fontSize:11, color:"var(--color-warning-text)" }}>{message}</p>}
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"var(--space-2)", marginTop:"var(--space-3)" }}><Button variant="ghost" onClick={dismiss}>Not now</Button><Button variant="primary" loading={busy} onClick={enable}>Enable notifications</Button></div>
  </div>;
}
