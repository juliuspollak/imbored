import { useState } from "react";
import { ArrowLeft, LogOut, Users, BarChart3, PartyPopper, MessageSquare } from "lucide-react";
import Home from "./Home.jsx";
import QueensGame from "./games/Queens.jsx";
import TangoGame from "./games/Tango.jsx";
import ZipGame from "./games/Zip.jsx";
import Login from "./Login.jsx";
import ProfileSetup from "./ProfileSetup.jsx";
import Teams from "./Teams.jsx";
import Stats from "./Stats.jsx";
import Feedback from "./Feedback.jsx";
import ChallengeGate from "./ChallengeGate.jsx";
import OnlineWidget from "./OnlineWidget.jsx";
import DifficultyRating from "./DifficultyRating.jsx";
import { AuthProvider, useAuth } from "./lib/AuthContext.jsx";
import { saveStats, rateDifficulty } from "./lib/saveStats.js";
import { supabaseReady } from "./lib/supabase.js";
import { useOnlinePlayers } from "./lib/useOnlinePlayers.js";

const GAME_COMPONENTS = {
  queens: { Component: QueensGame, label: "Queens" },
  tango: { Component: TangoGame, label: "Tango" },
  zip: { Component: ZipGame, label: "Zip" },
};

function AppShell() {
  const [active, setActive] = useState(null); // null | 'profile' | 'teams' | 'stats' | a game id
  // Challenge mode needs an account to mean anything (once-per-day + history
  // are tied to a user) — default to it when logged in, otherwise practice
  // is the only real option.
  const [playMode, setPlayMode] = useState("challenge");
  const { loading, user, profile, profileLoading, signOut } = useAuth();
  const players = useOnlinePlayers();

  if (supabaseReady) {
    if (loading) return <FullScreenMessage text="Loading…" />;
    if (!user) return <Login />;
    if (profileLoading) return <FullScreenMessage text="Loading your profile…" />;
    if (!profile) return <ProfileSetup />; // mandatory first-time setup, no onDone — nothing to go back to yet
  }

  if (active === "profile") {
    return <ProfileSetup onDone={() => setActive(null)} onOpenTeams={() => setActive("teams")} />;
  }

  if (active === "teams") {
    return <Teams onBack={() => setActive(null)} />;
  }

  if (active === "stats") {
    return <Stats onBack={() => setActive(null)} />;
  }

  if (active === "feedback") {
    return <Feedback onBack={() => setActive(null)} />;
  }

  if (!active) {
    return (
      <>
        <Home
          onSelect={setActive}
          playMode={supabaseReady ? playMode : "practice"}
          onPlayModeChange={supabaseReady ? setPlayMode : undefined}
          players={players}
        />
        {supabaseReady && <OnlineWidget players={players} userId={user?.id} />}
        {supabaseReady && profile && (
          <AccountBadge
            profile={profile}
            onSignOut={signOut}
            onOpenProfile={() => setActive("profile")}
            onOpenTeams={() => setActive("teams")}
            onOpenStats={() => setActive("stats")}
            onOpenFeedback={() => setActive("feedback")}
          />
        )}
      </>
    );
  }

  const { Component: Current, label } = GAME_COMPONENTS[active];

  if (playMode === "challenge" && supabaseReady) {
    return (
      <ChallengeGate
        gameId={active}
        gameLabel={label}
        GameComponent={Current}
        userId={user?.id}
        onExit={() => setActive(null)}
      />
    );
  }

  return <PracticePlay Current={Current} userId={user?.id} onExit={() => setActive(null)} />;
}

function PracticePlay({ Current, userId, onExit }) {
  const [justSolved, setJustSolved] = useState(null);

  async function handleSolved(stats) {
    const res = await saveStats(stats);
    if (res?.data) {
      setJustSolved({ statId: res.data.id, seconds: stats.seconds, mistakes: stats.mistakes, hints: stats.hints });
    }
  }

  if (justSolved) {
    return (
      <div style={{ background: "#F1F3F7", minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl p-6 text-center" style={{ background: "#FFFFFF", boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}>
          <PartyPopper size={28} style={{ color: "#2F6FED", margin: "0 auto 10px" }} />
          <h2 style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontWeight: 600, color: "#1B2129" }} className="text-2xl mb-4">
            Solved!
          </h2>
          <DifficultyRating onRate={(value) => rateDifficulty(justSolved.statId, value)} />
          <button
            onClick={() => setJustSolved(null)}
            className="w-full rounded-lg py-2.5 text-sm font-semibold mt-6"
            style={{ background: "#2F6FED", color: "#FFFFFF" }}
          >
            Keep practicing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onExit}
        className="nav-btn"
        style={{
          "--nav-glow": "rgba(47,111,237,0.35)",
          "--nav-border": "rgba(47,111,237,0.4)",
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
        userId={userId}
        onSolved={handleSolved}
        mode="practice"
      />
    </div>
  );
}

function AccountBadge({ profile, onSignOut, onOpenProfile, onOpenTeams, onOpenStats, onOpenFeedback }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <button
        onClick={onOpenFeedback}
        className="nav-btn"
        style={{
          "--nav-glow": "rgba(139,92,246,0.35)",
          "--nav-border": "rgba(139,92,246,0.4)",
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(16,24,40,0.12)",
          borderRadius: "50%",
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#1B2129",
        }}
        aria-label="Feedback"
      >
        <MessageSquare size={14} />
      </button>
      <button
        onClick={onOpenStats}
        className="nav-btn"
        style={{
          "--nav-glow": "rgba(47,111,237,0.35)",
          "--nav-border": "rgba(47,111,237,0.4)",
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(16,24,40,0.12)",
          borderRadius: "50%",
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#1B2129",
        }}
        aria-label="Stats"
      >
        <BarChart3 size={14} />
      </button>
      <button
        onClick={onOpenTeams}
        className="nav-btn"
        style={{
          "--nav-glow": "rgba(18,148,106,0.35)",
          "--nav-border": "rgba(18,148,106,0.4)",
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(16,24,40,0.12)",
          borderRadius: "50%",
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#1B2129",
        }}
        aria-label="Teams"
      >
        <Users size={14} />
      </button>
      <button
        onClick={onOpenProfile}
        className="nav-btn"
        title={profile.mood || undefined}
        style={{
          "--nav-glow": "rgba(47,111,237,0.3)",
          "--nav-border": "rgba(47,111,237,0.4)",
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
        <span style={{ fontSize: 14 }}>{profile.icon || "🙂"}</span>
        <span style={{ fontWeight: 600 }}>{profile.name}</span>
      </button>
      <button
        onClick={onSignOut}
        className="nav-btn"
        style={{
          "--nav-glow": "rgba(229,72,77,0.35)",
          "--nav-border": "rgba(229,72,77,0.4)",
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(16,24,40,0.12)",
          borderRadius: "50%",
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#1B2129",
          opacity: 0.6,
        }}
        aria-label="Sign out"
      >
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

const NAV_BTN_STYLE = `
  .nav-btn {
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease, background 0.18s ease, border-color 0.18s ease;
  }
  @media (hover: hover) and (pointer: fine) {
    .nav-btn:hover {
      transform: translateY(-2px) scale(1.08);
      box-shadow: 0 8px 18px var(--nav-glow, rgba(16,24,40,0.18));
      border-color: var(--nav-border, rgba(16,24,40,0.12)) !important;
      background: #FFFFFF !important;
    }
  }
  .nav-btn:active {
    transform: scale(0.92);
    transition-duration: 0.08s;
  }
`;

export default function App() {
  return (
    <AuthProvider>
      <style>{NAV_BTN_STYLE}</style>
      <AppShell />
    </AuthProvider>
  );
}
