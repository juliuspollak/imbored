import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import InvitedApprovalNotice from "./InvitedApprovalNotice.jsx";
import { I18nProvider } from "./lib/i18n.jsx";
import "./index.css";
import "./profile-glass.css";
import "./challenge-card-fix.css";
import "./mode-switch-contrast.css";

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
