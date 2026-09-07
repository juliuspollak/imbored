import { SUPPORT_EMAIL } from "./lib/supportContact.js";

export default function PublicPrivacy() {
  return (
    <main className="public-privacy">
      <article className="public-privacy__content">
        <header>
          <img className="public-privacy__icon" src="/assets/app-icon-source.png" alt="" />
          <h1>Privacy Policy</h1>
          <p className="public-privacy__updated">Last updated: 7 September 2026</p>
        </header>

        <PolicySection title="Information we collect">
          <p>When you create or use an imBored account, we process account identifiers and an email address provided through email sign-in, Sign in with Apple, or Google sign-in. If you add a passkey, authentication information needed to use that passkey is also associated with your account.</p>
          <p>We store the profile details and preferences you choose, such as your player name, icon, mood, privacy settings, time zone, theme, and game preferences. We also store app activity needed to provide imBored, including game and Challenge results, scores, timing, mistakes, hints, Circle membership and activity, standings, points, rewards and redemptions.</p>
          <p>If you use social or support features, we process the content and related activity you provide, including direct messages and reactions, feedback, reports, blocks, Circle invitations, and email addresses entered for app invitations.</p>
          <p>If you enable notifications, we store your notification preferences and technical information needed for delivery, including an installation identifier, iOS device token, platform, and time zone.</p>
        </PolicySection>

        <PolicySection title="How we use information">
          <p>We use this information to authenticate accounts; operate games, Challenges, Circles, standings, rewards, chat, invitations, safety tools, and notifications; remember your settings; provide support; prevent abuse; and maintain and secure the service.</p>
        </PolicySection>

        <PolicySection title="Social features and other users">
          <p>imBored is a social puzzle app. Your player name, icon, mood, Circle membership, game activity, scores, standings, messages, reactions, feedback, and reward activity may be visible to other players where the feature is designed to share them. Available privacy, statistics-visibility, blocking, and account-visibility controls can limit some sharing. Reports and moderation information are available only as needed to operate safety features.</p>
        </PolicySection>

        <PolicySection title="Notifications">
          <p>If you allow notifications, imBored may send Challenge reminders, competition updates, chat or social activity, and other service notifications according to your settings. You can change notification choices in the app or in iOS Settings.</p>
        </PolicySection>

        <PolicySection title="Third-party services">
          <p>Supabase provides authentication, database, real-time, and server-function infrastructure. Apple and Google provide sign-in when you choose those methods. Apple Push Notification service delivers iOS notifications. Resend sends invitation and account-related emails. The public website is configured for Vercel hosting. Some game maps, flags, and emoji artwork are loaded from GitHub-hosted sources and FlagCDN. These providers may process information such as identifiers, email addresses, device or network information, and requested content as needed to provide their services.</p>
        </PolicySection>

        <PolicySection title="Data retention">
          <p>We keep information while it is needed to operate your account and the features you use, and as reasonably necessary for security, dispute resolution, and legal obligations. When you delete your account, imBored’s in-app deletion process removes the active authentication account and associated app data. Limited copies may remain temporarily in provider backups or operational logs under the providers’ retention processes.</p>
        </PolicySection>

        <PolicySection title="Your choices and account deletion">
          <p>You can edit profile and privacy preferences, control whether statistics are shared, manage notification preferences, block players, and disconnect eligible sign-in methods in the app. You can request deletion from the account safety settings. For privacy questions or help with these choices, contact us using the address below.</p>
        </PolicySection>

        <PolicySection title="Children">
          <p>imBored is not intended for children under the minimum age required to use the service in their jurisdiction without appropriate parental consent.</p>
        </PolicySection>

        <PolicySection title="Security">
          <p>We use technical and organisational safeguards intended to protect information, including authenticated access and database access controls. No online service can guarantee absolute security.</p>
        </PolicySection>

        <PolicySection title="Changes to this policy">
          <p>We may update this policy as imBored changes. We will update the date above when we make changes.</p>
        </PolicySection>

        <PolicySection title="Contact us">
          <p>For privacy questions, requests, or concerns, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
        </PolicySection>

        <nav className="public-privacy__nav" aria-label="Public pages"><a href="/">Home</a><a href="/support">Support</a></nav>
      </article>
      <style>{`
        .public-privacy { min-height:100dvh; padding:max(32px,env(safe-area-inset-top)) 22px max(40px,env(safe-area-inset-bottom)); background:radial-gradient(circle at 50% 5%,color-mix(in srgb,var(--color-primary) 10%,transparent),transparent 28%),var(--color-page-bg); color:var(--color-text-primary); }
        .public-privacy__content { width:min(100%,680px); margin:0 auto; }
        .public-privacy header { text-align:center; margin-bottom:36px; }
        .public-privacy__icon { width:72px; height:72px; border-radius:18px; box-shadow:var(--shadow-card); }
        .public-privacy h1 { margin:20px 0 0; font-family:"Fredoka",sans-serif; font-size:clamp(34px,10vw,46px); line-height:1.08; letter-spacing:-.025em; }
        .public-privacy__updated { margin:10px 0 0; color:var(--color-text-secondary); font-size:13px; }
        .public-privacy section { margin-top:28px; }
        .public-privacy h2 { margin:0 0 9px; font-family:"Fredoka",sans-serif; font-size:21px; line-height:1.25; }
        .public-privacy p { margin:9px 0 0; color:var(--color-text-secondary); font-size:15px; line-height:1.7; }
        .public-privacy a { color:var(--color-primary); font-weight:700; text-underline-offset:3px; }
        .public-privacy a:focus-visible { outline:3px solid var(--color-primary-ring); outline-offset:3px; border-radius:4px; }
        .public-privacy__nav { display:flex; justify-content:center; gap:28px; margin-top:40px; padding-top:24px; border-top:1px solid var(--color-border); }
        .public-privacy__nav a { min-height:44px; display:inline-flex; align-items:center; }
      `}</style>
    </main>
  );
}

function PolicySection({ title, children }) {
  return <section><h2>{title}</h2>{children}</section>;
}
