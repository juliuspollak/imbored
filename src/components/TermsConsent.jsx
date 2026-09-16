import { useState } from "react";
import { Browser } from "@capacitor/browser";
import { isNativePlatform } from "../lib/platform.js";
import { TERMS_URL, PRIVACY_URL } from "../lib/terms.js";
export default function TermsConsent({ checked, onChange }) {
  const [error, setError] = useState("");
  async function openLink(event, url) {
    if (!isNativePlatform()) return;
    event.preventDefault();
    try { await Browser.open({ url }); setError(""); }
    catch { setError("Could not open this page. Please try again."); }
  }
  return <div style={{ textAlign: "left", marginBottom: 20, lineHeight: 1.6 }}>
    <label><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /> I agree to the </label>
    <a href={TERMS_URL} onClick={e => openLink(e, TERMS_URL)} target="_blank" rel="noopener noreferrer">Terms of Use</a> and <a href={PRIVACY_URL} onClick={e => openLink(e, PRIVACY_URL)} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
    {error && <p role="alert">{error}</p>}
    <p style={{ fontSize: 12 }}>Zero tolerance for objectionable content and abusive users.</p>
  </div>;
}
