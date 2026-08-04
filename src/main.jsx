import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import InvitedApprovalNotice from "./InvitedApprovalNotice.jsx";
import { I18nProvider } from "./lib/i18n.jsx";
import { enableAutomaticAppUpdates } from "./lib/appUpdate.js";
import { applyThemePreference, getCachedThemePreference } from "./lib/theme.js";
// Fonts are bundled rather than fetched from Google's CDN. A packaged app
// should render its own type with no network at all, and shipping them removes
// a third-party request on every launch that would otherwise need declaring in
// the App Store privacy questionnaire.
// latin + latin-ext only: the app ships English and Slovak, and latin-ext
// carries the Slovak diacritics. The unscoped imports would bundle cyrillic,
// greek, hebrew and vietnamese too — 68 font files instead of 20.
import "@fontsource/fredoka/latin-500.css";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/fredoka/latin-700.css";
import "@fontsource/fredoka/latin-ext-500.css";
import "@fontsource/fredoka/latin-ext-600.css";
import "@fontsource/fredoka/latin-ext-700.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-ext-500.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/inter/latin-ext-700.css";
import "./index.css";
import "./theme.css";
import "./game-solved-panel.css";
import "./board-review-toggle.css";
import "./circle-portal.css";
import "./hive-branding.css";
import "./gridly-branding.css";
import "./game-tile-artwork.css";

enableAutomaticAppUpdates();

// Apply the last-known theme preference immediately, before auth resolves -
// otherwise the pre-login screen (and any screen loaded before the profile
// fetch completes) falls back to the raw system theme, flashing dark even
// when the signed-in profile is set to light.
applyThemePreference(getCachedThemePreference());

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary onReset={() => window.location.reload()}>
        <App />
        <InvitedApprovalNotice />
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>
);
