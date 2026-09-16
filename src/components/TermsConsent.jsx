import { useId, useState } from "react";
import { Browser } from "@capacitor/browser";
import { isNativePlatform } from "../lib/platform.js";
import { TERMS_URL, PRIVACY_URL } from "../lib/terms.js";
export default function TermsConsent({ checked, onChange }) {
  const checkboxId = useId();
  const [error, setError] = useState("");
  async function openLink(event, url) {
    if (!isNativePlatform()) return;
    event.preventDefault();
    try { await Browser.open({ url }); setError(""); }
    catch { setError("Could not open this page. Please try again."); }
  }
  return <div className="terms-consent">
    <div className="terms-consent__row">
      <label className="terms-consent__checkbox" htmlFor={checkboxId}>
        <input id={checkboxId} type="checkbox" aria-label="I agree to the Terms of Use and Privacy Policy" checked={checked} onChange={e => onChange(e.target.checked)} />
      </label>
      <div className="terms-consent__sentence">
        <label htmlFor={checkboxId}>I agree to the </label>
        <a href={TERMS_URL} onClick={e => openLink(e, TERMS_URL)} target="_blank" rel="noopener noreferrer">Terms of Use</a>{" and "}
        <a href={PRIVACY_URL} onClick={e => openLink(e, PRIVACY_URL)} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="terms-consent__note">Zero tolerance for objectionable content and abusive users.</p>
    <style>{`
      .terms-consent { text-align:left; margin-bottom:20px; color:var(--color-text-primary); line-height:1.6; }
      .terms-consent__row { display:flex; align-items:flex-start; gap:4px; }
      .terms-consent__checkbox { display:flex; align-items:center; justify-content:center; min-width:44px; min-height:44px; cursor:pointer; flex-shrink:0; }
      .terms-consent__checkbox input { width:20px; height:20px; margin:0; accent-color:var(--color-primary); cursor:pointer; }
      .terms-consent__sentence { flex:1; min-width:0; font-size:14px; }
      .terms-consent__sentence label { cursor:pointer; }
      .terms-consent a { display:inline-flex; align-items:center; min-height:44px; color:var(--color-primary); font-weight:600; text-decoration:underline; text-decoration-thickness:1.5px; text-underline-offset:4px; }
      .terms-consent a:hover { text-decoration-thickness:2.5px; }
      .terms-consent a:focus-visible, .terms-consent input:focus-visible { outline:3px solid var(--color-primary); outline-offset:3px; border-radius:4px; }
      .terms-consent__note { margin:8px 0 0; font-size:12px; color:var(--color-text-secondary); }
    `}</style>
  </div>;
}
