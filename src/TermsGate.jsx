import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { acceptCurrentTerms, loadCurrentTerms } from "./lib/terms.js";
import TermsConsent from "./components/TermsConsent.jsx";
import Page from "./components/Page.jsx";
import Card from "./components/Card.jsx";
import Button from "./components/Button.jsx";

export default function TermsGate({ children }) {
  const { user, signOut, termsAgreed } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const current = await loadCurrentTerms(supabase, user.id, termsAgreed);
        if (!cancelled) setAccepted(current);
      } catch (e) { if (!cancelled) setError(e.message || "Could not load Terms acceptance. Please retry."); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [user.id, termsAgreed]);
  async function accept() {
    if (!checked || busy) return;
    setBusy(true); setError("");
    try {
      await acceptCurrentTerms(supabase);
      setAccepted(true);
    } catch (e) { setError(e.message || "Could not save acceptance. Please try again."); }
    finally { setBusy(false); }
  }
  if (accepted) return children;
  return <Page><Card><h1>Terms of Use</h1>
    {loading ? <p>Checking Terms acceptance…</p> : <>
      <p>Please accept the current Terms to continue using imBored.</p>
      <TermsConsent checked={checked} onChange={setChecked} />
      {error && <p role="alert">{error}</p>}
      <Button disabled={!checked || busy} onClick={accept}>Agree and continue</Button>
    </>}
    <Button variant="ghost" onClick={signOut}>Sign out</Button>
  </Card></Page>;
}
