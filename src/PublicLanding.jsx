import { configuredAppStoreUrl } from "./lib/publicLanding.js";

export default function PublicLanding() {
  const appStoreUrl = configuredAppStoreUrl();
  return (
    <main className="public-landing">
      <div className="public-landing__content">
        <img className="public-landing__icon" src="/assets/app-icon-source.png" alt="" />
        <h1>imBored</h1>
        <p className="public-landing__promise">One attempt a day.<br />Same puzzle for everyone.<br />Today only.</p>
        <p className="public-landing__secondary">Daily puzzle games with friends.</p>
        <p className="public-landing__available">Available on the App Store</p>
        {appStoreUrl
          ? <a className="public-landing__store-button" href={appStoreUrl} rel="noopener noreferrer">Download on the App Store</a>
          : <span className="public-landing__store-button public-landing__store-button--pending" aria-label="App Store link coming soon">App Store link coming soon</span>}
      </div>
      <style>{`
        .public-landing { min-height:100dvh; display:grid; place-items:center; padding:max(32px,env(safe-area-inset-top)) 24px max(32px,env(safe-area-inset-bottom)); background:radial-gradient(circle at 50% 18%,color-mix(in srgb,var(--color-primary) 10%,transparent),transparent 42%),var(--color-page-bg); color:var(--color-text-primary); text-align:center; }
        .public-landing__content { width:min(100%,420px); display:flex; flex-direction:column; align-items:center; }
        .public-landing__icon { width:88px; height:88px; border-radius:22px; box-shadow:var(--shadow-card); }
        .public-landing h1 { margin:20px 0 0; font-family:"Fredoka",sans-serif; font-size:clamp(42px,14vw,60px); line-height:1; letter-spacing:-.035em; }
        .public-landing__promise { margin:24px 0 0; font-size:clamp(20px,6vw,25px); line-height:1.42; font-weight:650; }
        .public-landing__secondary { margin:16px 0 0; color:var(--color-text-secondary); font-size:14px; }
        .public-landing__available { margin:36px 0 10px; color:var(--color-text-secondary); font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
        .public-landing__store-button { min-height:48px; display:inline-flex; align-items:center; justify-content:center; padding:0 22px; border-radius:13px; background:#111; color:#fff; font-size:15px; font-weight:700; text-decoration:none; box-shadow:var(--shadow-control); }
        .public-landing__store-button:focus-visible { outline:3px solid var(--color-primary-ring); outline-offset:3px; }
        .public-landing__store-button--pending { opacity:.58; cursor:default; }
      `}</style>
    </main>
  );
}
