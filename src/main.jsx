import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import InvitedApprovalNotice from "./InvitedApprovalNotice.jsx";
import { I18nProvider } from "./lib/i18n.jsx";
import { enableAutomaticAppUpdates } from "./lib/appUpdate.js";
import { applyThemePreference, getCachedThemePreference } from "./lib/theme.js";
import "./index.css";
import "./theme.css";
import "./game-solved-panel.css";
import "./board-review-toggle.css";

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
