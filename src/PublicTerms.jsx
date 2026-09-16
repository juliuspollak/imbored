import { TERMS_VERSION } from "./lib/terms.js";
export default function PublicTerms() {
  return <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", lineHeight: 1.7 }}>
    <h1>imBored Terms of Use / EULA</h1><p>Version {TERMS_VERSION}</p>
    <p>By agreeing to these Terms, you agree to follow these rules when using imBored.</p>
    <h2>Community safety</h2>
    <p>imBored has zero tolerance for objectionable content and abusive users, including harassment, bullying, threats, hate speech, sexually explicit content, sexual abuse content, spam or malicious behaviour. Do not post or send this material through messages, profiles, Circles, Challenges, rewards or feedback.</p>
    <p>We filter text before posting. Content that violates these Terms may be removed, and violating users may be suspended or removed from imBored.</p>
    <h2>Report and block</h2>
    <p>Use the three-dot menu beside a chat message or in the chat header to Report &amp; Block. Choose a reason and add any relevant details. This sends a safety report to the developer’s moderation queue and immediately blocks the player and hides their chat. You can also use Block without a report. Manage blocked players in Safety &amp; account.</p>
    <h2>Moderation</h2>
    <p>We review valid safety reports as quickly as possible, targeting within 24 hours. We act on violations by removing offending content and suspending or removing offending users.</p>
    <h2>Contact</h2><p>For safety concerns or support, email <a href="mailto:support@imbored.au">support@imbored.au</a>.</p>
    <nav><a href="/support">Support</a> · <a href="/privacy">Privacy Policy</a> · <a href="/">Home</a></nav>
  </main>;
}
