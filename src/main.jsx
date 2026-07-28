import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import InvitedApprovalNotice from "./InvitedApprovalNotice.jsx";
import { I18nProvider } from "./lib/i18n.jsx";
import { enableAutomaticAppUpdates } from "./lib/appUpdate.js";
import "./index.css";
import "./challenge-card-fix.css";
import "./mode-switch-contrast.css";
import "./theme.css";
import "./game-solved-panel.css";
import "./dark-mode-contrast.css";
import "./profile-dark-fix.css";
import "./game-control-contrast.css";
import "./queens-dark-fix.css";

enableAutomaticAppUpdates();

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
