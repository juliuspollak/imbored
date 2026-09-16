import { TERMS_VERSION } from "./lib/terms.js";

export default function PublicTerms() {
  return (
    <main className="public-terms">
      <article className="public-terms__content">
        <header className="public-terms__header">
          <img className="public-terms__icon" src="/assets/app-icon-source.png" alt="" />
          <h1>Terms of Use</h1>
          <p className="public-terms__updated">Last updated: <time dateTime={TERMS_VERSION}>16 September 2026</time></p>
          <p className="public-terms__subtitle">imBored · Terms of Use / EULA</p>
        </header>

        <TermsSection title="Using imBored">
          <p>By agreeing to these Terms, you agree to follow these rules when using imBored.</p>
        </TermsSection>

        <TermsSection title="Zero tolerance for abuse and objectionable content">
          <p>imBored has zero tolerance for objectionable content and abusive users, including harassment, bullying, threats, hate speech, sexually explicit content, sexual abuse content, spam or malicious behaviour.</p>
        </TermsSection>

        <TermsSection title="Acceptable use">
          <p>Do not post or send this material through messages, profiles, Circles, Challenges, rewards or feedback.</p>
          <p>We filter text before posting.</p>
        </TermsSection>

        <TermsSection title="Reporting content or users">
          <p>Use the three-dot menu beside a chat message or in the chat header to Report &amp; Block. Choose a reason and add any relevant details.</p>
          <p>This sends a safety report to the developer’s moderation queue and immediately blocks the player and hides their chat.</p>
        </TermsSection>

        <TermsSection title="Blocking users">
          <p>You can also use Block without a report. Manage blocked players in Safety &amp; account.</p>
        </TermsSection>

        <TermsSection title="Moderation and enforcement">
          <p>We review valid safety reports as quickly as possible, targeting within 24 hours. We act on violations by removing offending content and suspending or removing offending users.</p>
        </TermsSection>

        <TermsSection title="Account suspension or removal">
          <p>Content that violates these Terms may be removed, and violating users may be suspended or removed from imBored.</p>
        </TermsSection>

        <TermsSection title="Contact us">
          <p>For safety concerns or support, email <a href="mailto:support@imbored.au">support@imbored.au</a>.</p>
        </TermsSection>

        <nav className="public-terms__nav" aria-label="Public pages">
          <a href="/privacy">Privacy Policy</a>
          <a href="/support">Support</a>
          <a href="/">Home</a>
        </nav>
      </article>
      <style>{`
        .public-terms {
          min-height:100dvh;
          padding:max(32px,env(safe-area-inset-top)) max(22px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(22px,env(safe-area-inset-left));
          background:radial-gradient(circle at 50% 5%,color-mix(in srgb,var(--color-primary) 10%,transparent),transparent 28%),var(--color-page-bg);
          color:var(--color-text-primary);
        }
        .public-terms__content { width:min(100%,680px); margin:0 auto; }
        .public-terms__header { text-align:center; margin-bottom:36px; }
        .public-terms__icon { display:block; margin:0 auto; width:72px; height:72px; border-radius:18px; box-shadow:var(--shadow-card); }
        .public-terms h1 { margin:20px 0 0; font-family:"Fredoka",sans-serif; font-size:clamp(34px,10vw,46px); font-weight:600; line-height:1.12; letter-spacing:-.025em; }
        .public-terms p { margin:10px 0 0; color:var(--color-text-secondary); font-size:16px; line-height:1.75; overflow-wrap:anywhere; }
        .public-terms .public-terms__updated { margin-top:12px; font-size:14px; color:var(--color-text-secondary); }
        .public-terms .public-terms__subtitle { margin-top:6px; font-size:14px; color:var(--color-text-secondary); }
        .public-terms section { margin-top:30px; }
        .public-terms h2 { margin:0 0 10px; font-family:"Fredoka",sans-serif; font-size:22px; font-weight:600; line-height:1.35; }
        .public-terms a { display:inline-flex; align-items:center; min-height:44px; max-width:100%; color:var(--color-primary); font-weight:600; text-decoration:underline; text-decoration-thickness:1.5px; text-underline-offset:4px; overflow-wrap:anywhere; }
        .public-terms a:hover { text-decoration-thickness:2.5px; }
        .public-terms a:focus-visible { outline:3px solid var(--color-primary-ring); outline-offset:4px; border-radius:4px; }
        .public-terms__nav { display:flex; flex-wrap:wrap; justify-content:center; column-gap:28px; row-gap:8px; margin-top:40px; padding-top:24px; border-top:1px solid var(--color-border); }
      `}</style>
    </main>
  );
}

function TermsSection({ title, children }) {
  return <section><h2>{title}</h2>{children}</section>;
}
