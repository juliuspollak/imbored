import { useState } from "react";
import { ArrowLeft, LogOut, User } from "lucide-react";
import Home from "./Home.jsx";
import QueensGame from "./games/Queens.jsx";
import TangoGame from "./games/Tango.jsx";
import ZipGame from "./games/Zip.jsx";
import Login from "./Login.jsx";
import ProfileSetup from "./ProfileSetup.jsx";
import { AuthProvider, useAuth } from "./lib/AuthContext.jsx";
import { saveStats } from "./lib/saveStats.js";
import { supabaseReady } from "./lib/supabase.js";

const GAME_COMPONENTS = {
  queens: QueensGame,
  tango: TangoGame,
  zip: ZipGame,
};

function AppShell() {
  const [active, setActive] = useState(null); // null = home
  const { loading, user, profile, profileLoading, signOut } = useAuth();

  // Games work standalone without accounts configured — only gate behind
  // login once Supabase is actually set up.
  if (supabaseReady) {
    if (loading) return <FullScreenMessage text="Loading…" />;
    if (!user) return <Login />;
    if (profileLoading) return <FullScreenMessage text="Loading your profile…" />;
    if (!profile) return <ProfileSetup />;
  }

  if (!active) {
    return (
      <>
        <Home onSelect={setActive} />
        {supabaseReady && profile && <AccountBadge profile={profile} onSignOut={signOut} />}
      </>
    );
  }

  const Current = GAME_COMPONENTS[active];

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setActive(null)}
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 50,
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(16,24,40,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#1B2129",
        }}
        aria-label="Back to all games"
      >
        <ArrowLeft size={18} />
      </button>
      <Current
        userId={user?.id}
        onSolved={(stats) => saveStats(stats)}
      />
    </div>
  );
}

function AccountBadge({ profile, onSignOut }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(16,24,40,0.12)",
        borderRadius: 999,
        padding: "6px 12px",
        fontSize: 12,
        color: "#1B2129",
      }}
    >
      <User size={13} />
      <span style={{ fontWeight: 600 }}>{profile.name}</span>
      <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", opacity: 0.5 }} aria-label="Sign out">
        <LogOut size={13} />
      </button>
    </div>
  );
}

function FullScreenMessage({ text }) {
  return (
    <div style={{ background: "#F1F3F7", minHeight: "100vh" }} className="flex items-center justify-center">
      <span style={{ color: "#1B2129", opacity: 0.5 }} className="text-sm">{text}</span>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
