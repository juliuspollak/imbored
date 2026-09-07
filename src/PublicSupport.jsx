import { SUPPORT_EMAIL } from "./lib/supportContact.js";

export default function PublicSupport() {
  return (
    <main className="public-support">
      <div className="public-support__content">
        <img className="public-support__icon" src="/assets/app-icon-source.png" alt="" />
        <h1>imBored Support</h1>
        <p className="public-support__intro">Need help with imBored?</p>
        <p className="public-support__body">For support, questions or feedback, contact us at:</p>
        <a className="public-support__email" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        <p className="public-support__secondary">Please include a short description of the issue and, if relevant, your device and iOS version.</p>
        <a className="public-support__home" href="/">Home</a>
      </div>
      <style>{`
        .public-support { min-height:100dvh; display:grid; place-items:center; padding:max(32px,env(safe-area-inset-top)) 24px max(32px,env(safe-area-inset-bottom)); background:radial-gradient(circle at 50% 18%,color-mix(in srgb,var(--color-primary) 10%,transparent),transparent 42%),var(--color-page-bg); color:var(--color-text-primary); text-align:center; }
        .public-support__content { width:min(100%,420px); display:flex; flex-direction:column; align-items:center; }
        .public-support__icon { width:72px; height:72px; border-radius:18px; box-shadow:var(--shadow-card); }
        .public-support h1 { margin:20px 0 0; font-family:"Fredoka",sans-serif; font-size:clamp(32px,10vw,44px); line-height:1.08; letter-spacing:-.025em; }
        .public-support__intro { margin:24px 0 0; font-size:clamp(20px,6vw,24px); line-height:1.4; font-weight:650; }
        .public-support__body { margin:18px 0 8px; color:var(--color-text-secondary); font-size:15px; line-height:1.55; }
        .public-support__email { color:var(--color-primary); font-size:18px; font-weight:700; text-underline-offset:3px; }
        .public-support__secondary { margin:22px 0 0; color:var(--color-text-secondary); font-size:13px; line-height:1.55; }
        .public-support__home { margin-top:32px; min-height:44px; display:inline-flex; align-items:center; justify-content:center; padding:0 18px; color:var(--color-primary); font-size:15px; font-weight:700; text-underline-offset:3px; }
        .public-support a:focus-visible { outline:3px solid var(--color-primary-ring); outline-offset:3px; border-radius:6px; }
      `}</style>
    </main>
  );
}
