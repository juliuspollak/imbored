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
    try {
      await Browser.open({ url });
      setError("");
    } catch {
      setError("Could not open this page. Please try again.");
    }
  }

  return (
    <div className={`terms-consent${checked ? " terms-consent--checked" : ""}`}>
      <div className="terms-consent__row">
        <label className="terms-consent__checkbox" htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            aria-label="I agree to the Terms of Use and Privacy Policy"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="terms-consent__checkmark" aria-hidden="true">✓</span>
        </label>

        <p className="terms-consent__sentence">
          I agree to the{" "}
          <a href={TERMS_URL} onClick={(event) => openLink(event, TERMS_URL)} target="_blank" rel="noopener noreferrer">Terms of Use</a>
          {" and "}
          <a href={PRIVACY_URL} onClick={(event) => openLink(event, PRIVACY_URL)} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        </p>
      </div>

      <div className="terms-consent__safety-note">
        <span aria-hidden="true">✓</span>
        <span>Zero tolerance for objectionable content and abusive users.</span>
      </div>

      {error && <p className="terms-consent__error" role="alert">{error}</p>}

      <style>{`
        .terms-consent {
          margin-bottom:24px;
          padding:14px 16px 13px;
          border:1px solid var(--color-border);
          border-radius:var(--radius-md);
          background:var(--color-surface-elevated);
          color:var(--color-text-primary);
          text-align:left;
          transition:border-color var(--transition-fast),background var(--transition-fast),box-shadow var(--transition-fast);
        }
        .terms-consent--checked {
          border-color:var(--color-primary-subtle-border);
          background:var(--color-primary-subtle);
          box-shadow:0 0 0 1px color-mix(in srgb,var(--color-primary) 7%,transparent);
        }
        .terms-consent__row { display:flex; align-items:center; gap:12px; }
        .terms-consent__checkbox {
          position:relative;
          display:grid;
          place-items:center;
          width:32px;
          height:32px;
          margin-left:-4px;
          flex:0 0 32px;
          cursor:pointer;
          -webkit-tap-highlight-color:transparent;
        }
        .terms-consent__checkbox input {
          appearance:none;
          -webkit-appearance:none;
          width:24px;
          height:24px;
          margin:0;
          border:2px solid var(--color-border-strong);
          border-radius:8px;
          background:var(--color-surface);
          cursor:pointer;
          transition:background var(--transition-fast),border-color var(--transition-fast),transform var(--transition-fast);
        }
        .terms-consent__checkbox input:checked {
          border-color:var(--color-primary);
          background:var(--color-primary);
        }
        .terms-consent__checkbox:active input { transform:scale(.92); }
        .terms-consent__checkmark {
          position:absolute;
          top:50%;
          left:50%;
          transform:translate(-50%,-52%) scale(.7);
          color:#fff;
          font-size:15px;
          font-weight:800;
          line-height:1;
          opacity:0;
          pointer-events:none;
          transition:opacity var(--transition-fast),transform var(--transition-fast);
        }
        .terms-consent__checkbox input:checked + .terms-consent__checkmark {
          opacity:1;
          transform:translate(-50%,-52%) scale(1);
        }
        .terms-consent__sentence {
          flex:1;
          min-width:0;
          margin:0;
          color:var(--color-text-primary);
          font-size:14px;
          line-height:1.55;
        }
        .terms-consent__sentence a {
          color:var(--color-primary);
          font-weight:700;
          text-decoration:none;
          border-bottom:1.5px solid color-mix(in srgb,var(--color-primary) 65%,transparent);
          padding:3px 1px 2px;
          -webkit-tap-highlight-color:transparent;
        }
        .terms-consent__sentence a:hover { border-bottom-color:var(--color-primary); }
        .terms-consent__sentence a:focus-visible,
        .terms-consent__checkbox input:focus-visible {
          outline:3px solid var(--color-primary-ring);
          outline-offset:3px;
          border-radius:5px;
        }
        .terms-consent__safety-note {
          display:flex;
          align-items:flex-start;
          gap:7px;
          margin:10px 0 0 40px;
          color:var(--color-text-secondary);
          font-size:11px;
          line-height:1.45;
        }
        .terms-consent__safety-note > span:first-child {
          color:var(--color-success-text);
          font-weight:800;
          line-height:1.4;
        }
        .terms-consent__error {
          margin:10px 0 0 40px;
          color:var(--color-danger-text);
          font-size:12px;
          line-height:1.45;
        }
        @media (max-width:380px) {
          .terms-consent { padding-left:13px; padding-right:13px; }
          .terms-consent__row { gap:9px; }
          .terms-consent__sentence { font-size:13px; }
          .terms-consent__safety-note,.terms-consent__error { margin-left:37px; }
        }
      `}</style>
    </div>
  );
}
