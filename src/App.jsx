import { useState, useEffect, useRef } from "react";
import { ArrowLeft, LogOut, Users, User, BarChart3, MessageSquare, Sparkles, Shield, Grid3x3, Star, Gift } from "lucide-react";
import Home from "./Home.jsx";
import QueensGame from "./games/Queens.jsx";
import TangoGame from "./games/Tango.jsx";
import ZipGame from "./games/Zip.jsx";
import MiniSudokuGame from "./games/MiniSudoku.jsx";
import Login from "./Login.jsx";
import ProfileSetup from "./ProfileSetup.jsx";
import Teams from "./Teams.jsx";
import Stats from "./Stats.jsx";
import Feedback from "./Feedback.jsx";
import ReleaseNotes from "./ReleaseNotes.jsx";
import AdminPlayers from "./AdminPlayers.jsx";
import AdminGames from "./AdminGames.jsx";
import Progress from "./Progress.jsx";
import AdminRewards from "./AdminRewards.jsx";
import PointsToast from "./PointsToast.jsx";
import ModePill from "./ModePill.jsx";
import ChallengeGate from "./ChallengeGate.jsx";
import OnlineWidget from "./OnlineWidget.jsx";
import PokeOverlay from "./PokeOverlay.jsx";
import { AuthProvider, useAuth } from "./lib/AuthContext.jsx";
import { saveStats } from "./lib/saveStats.js";
import { supabaseReady } from "./lib/supabase.js";
import { useOnlinePlayers } from "./lib/useOnlinePlayers.js";
import { useGameConfig } from "./lib/useGameConfig.js";
import { usePresence } from "./lib/usePresence.js";
import { useOpenFeedbackCount } from "./lib/useOpenFeedbackCount.js";
import { usePokes } from "./lib/pokes.js";

const GAME_COMPONENTS = {
  queens: { Component: QueensGame, label: "Queens" },
  tango: { Component: TangoGame, label: "Tango" },
  zip: { Component: ZipGame, label: "Zip" },
  minisudoku: { Component: MiniSudokuGame, label: "Mini Sudoku" },
};

function AppShell() {
  const [active, setActive] = useState(null); // null | 'profile' | 'teams' | 'stats' | a game id
  // Challenge mode needs an account to mean anything (once-per-day + history
  // are tied to a user) — default to it when logged in, otherwise practice
  // is the only real option.
  const [playMode, setPlayMode] = useState("challenge");
  const { loading, user, profile, profileLoading, signOut } = useAuth();
  const appliedDefaultModeRef = useRef(false);
  useEffect(() => {
    if (!appliedDefaultModeRef.current && profile?.default_mode) {
      setPlayMode(profile.default_mode);
      appliedDefaultModeRef.current = true;
    }
  }, [profile]);
  const players = useOnlinePlayers();
  const { config: gameConfig } = useGameConfig();
  usePresence(["queens", "tango", "zip", "minisudoku"].includes(active) ? active : null, playMode);
  const openFeedbackCount = useOpenFeedbackCount();

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

  if (active === "progress") {
    return <Progress onBack={() => setActive(null)} />;
  }

  if (active === "feedback") {
    return <Feedback onBack={() => setActive(null)} />;
  }

  if (active === "whatsnew") {
    return <ReleaseNotes onBack={() => setActive(null)} />;
  }

  if (active === "adminplayers") {
    return <AdminPlayers onBack={() => setActive(null)} />;
  }

  if (active === "admingames") {
    return <AdminGames onBack={() => setActive(null)} />;
  }

  if (active === "adminrewards") {
    return <AdminRewards onBack={() => setActive(null)} />;
  }

  if (!active) {
    return (
      <>
        <Home
          onSelect={setActive}
          playMode={supabaseReady ? playMode : "practice"}
          onPlayModeChange={supabaseReady ? setPlayMode : undefined}
          players={players}
          userId={user?.id}
        />
        {supabaseReady && profile && (
          <AccountBadge
            profile={profile}
            onSignOut={signOut}
            onOpenProfile={() => setActive("profile")}
            onOpenTeams={() => setActive("teams")}
            onOpenStats={() => setActive("stats")}
            onOpenProgress={() => setActive("progress")}
            onOpenFeedback={() => setActive("feedback")}
            onOpenWhatsNew={() => setActive("whatsnew")}
            onOpenAdminPlayers={() => setActive("adminplayers")}
            onOpenAdminGames={() => setActive("admingames")}
            onOpenAdminRewards={() => setActive("adminrewards")}
            players={players}
            userId={user?.id}
            openFeedbackCount={openFeedbackCount}
          />
        )}
      </>
    );
  }

  const { Component: Current, label } = GAME_COMPONENTS[active];
  const cfg = gameConfig?.[active];

  if (playMode === "challenge" && supabaseReady) {
    return (
      <ChallengeGate
        gameId={active}
        gameLabel={label}
        GameComponent={Current}
        userId={user?.id}
        onExit={() => setActive(null)}
        onSwitchMode={() => setPlayMode("practice")}
        hintCooldownConfig={cfg}
      />
    );
  }

  return (
    <PracticePlay
      Current={Current}
      userId={user?.id}
      onExit={() => setActive(null)}
      onSwitchMode={supabaseReady ? () => setPlayMode("challenge") : undefined}
      hintCooldownConfig={cfg}
    />
  );
}

function PracticePlay({ Current, userId, onExit, onSwitchMode, hintCooldownConfig }) {
  const [savedStatId, setSavedStatId] = useState(null);
  const [rewardResult, setRewardResult] = useState(null);

  async function handleSolved(stats) {
    setSavedStatId(null);
    const res = await saveStats(stats);
    if (res?.data) {
      setSavedStatId(res.data.id);
      if (res.reward) setRewardResult(res.reward);
    }
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
        hintCooldownConfig={hintCooldownConfig}
        savedStatId={savedStatId}
      />
      {onSwitchMode && <ModePill mode="practice" onSwitch={onSwitchMode} />}
      <PointsToast reward={rewardResult} onDone={() => setRewardResult(null)} />
    </div>
  );
}

function AccountBadge({ profile, onSignOut, onOpenProfile, onOpenTeams, onOpenStats, onOpenProgress, onOpenFeedback, onOpenWhatsNew, onOpenAdminPlayers, onOpenAdminGames, onOpenAdminRewards, players, userId, openFeedbackCount = 0 }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasOpenFeedback = openFeedbackCount > 0;
  const isAdmin = !!profile.is_admin;

  const items = [
    { onClick: onOpenProfile, icon: User, label: "My profile", glow: "rgba(47,111,237,0.35)", border: "rgba(47,111,237,0.4)" },
    { onClick: onOpenWhatsNew, icon: Sparkles, label: "What's new", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" },
    { onClick: onOpenFeedback, icon: MessageSquare, label: "Feedback", glow: "rgba(139,92,246,0.35)", border: "rgba(139,92,246,0.4)", badge: openFeedbackCount },
    { onClick: onOpenStats, icon: BarChart3, label: "Stats", glow: "rgba(47,111,237,0.35)", border: "rgba(47,111,237,0.4)" },
    { onClick: onOpenProgress, icon: Star, label: "My progress", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" },
    { onClick: onOpenTeams, icon: Users, label: "Teams", glow: "rgba(18,148,106,0.35)", border: "rgba(18,148,106,0.4)" },
    ...(isAdmin ? [{ onClick: onOpenAdminPlayers, icon: Shield, label: "Players (admin)", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" }] : []),
    ...(isAdmin ? [{ onClick: onOpenAdminGames, icon: Grid3x3, label: "Games (admin)", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" }] : []),
    ...(isAdmin ? [{ onClick: onOpenAdminRewards, icon: Gift, label: "Rewards (admin)", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" }] : []),
    { onClick: onSignOut, icon: LogOut, label: "Sign out", glow: "rgba(229,72,77,0.35)", border: "rgba(229,72,77,0.4)" },
  ];

  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <style>{`
        @keyframes menuBalloonPop {
          0% { transform: scale(0.3) translateY(-10px); opacity: 0; }
          60% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        .menu-balloon { animation: menuBalloonPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
        @keyframes feedbackWiggle {
          0%, 85%, 100% { transform: rotate(0deg); }
          87% { transform: rotate(-10deg); }
          89% { transform: rotate(10deg); }
          91% { transform: rotate(-7deg); }
          93% { transform: rotate(7deg); }
          95% { transform: rotate(-3deg); }
          97% { transform: rotate(0deg); }
        }
        .feedback-wiggle { animation: feedbackWiggle 4s ease-in-out infinite; }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.7; }
        }
        .dot-pulse { animation: dotPulse 1.4s ease-in-out infinite; }
      `}</style>

      <div style={{ position: "relative" }}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className={`nav-btn ${hasOpenFeedback ? "feedback-wiggle" : ""}`}
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
        {profile.is_admin && (
          <div
            style={{
              position: "absolute", top: -5, left: -5, background: "#D9AE58", color: "#FFFFFF",
              fontSize: 8, fontWeight: 700, borderRadius: 999, padding: "1px 5px", border: "1.5px solid #F1F3F7",
            }}
          >
            ADMIN
          </div>
        )}
        {hasOpenFeedback && (
          <div
            className="dot-pulse flex items-center justify-center rounded-full"
            style={{
              position: "absolute", top: -4, right: -4, minWidth: 15, height: 15, padding: "0 3px",
              background: "#8B5CF6", color: "#FFFFFF", fontSize: 9, fontWeight: 700, border: "1.5px solid #F1F3F7",
            }}
          >
            {openFeedbackCount}
          </div>
        )}
      </div>

      {menuOpen && (
        <div className="flex flex-col items-end gap-1.5">
          {items.map((item, i) => (
            <button
              key={item.label}
              onClick={() => {
                setMenuOpen(false);
                item.onClick();
              }}
              className="menu-balloon nav-btn flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1.5"
              style={{
                "--nav-glow": item.glow,
                "--nav-border": item.border,
                animationDelay: `${i * 0.04}s`,
                background: item.badge > 0 ? "rgba(139,92,246,0.08)" : "#FFFFFF",
                boxShadow: "0 6px 16px rgba(16,24,40,0.14)",
                border: item.badge > 0 ? "1px solid rgba(139,92,246,0.3)" : "1px solid rgba(16,24,40,0.08)",
                color: "#1B2129",
                whiteSpace: "nowrap",
              }}
            >
              <span className="text-xs font-medium">{item.label}</span>
              {item.badge > 0 && (
                <span
                  className="flex items-center justify-center rounded-full"
                  style={{ minWidth: 16, height: 16, padding: "0 4px", background: "#8B5CF6", color: "#FFFFFF", fontSize: 9, fontWeight: 700 }}
                >
                  {item.badge}
                </span>
              )}
              <span
                className="flex items-center justify-center rounded-full"
                style={{ width: 24, height: 24, background: "rgba(16,24,40,0.05)" }}
              >
                <item.icon size={12} />
              </span>
            </button>
          ))}
        </div>
      )}

      <OnlineWidget players={players} userId={userId} myName={profile.name} />
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

function PokeLayer() {
  const { user } = useAuth();
  const { poke, dismiss } = usePokes(supabaseReady ? user?.id : undefined);
  return <PokeOverlay poke={poke} onDismiss={dismiss} />;
}

export default function App() {
  return (
    <AuthProvider>
      <style>{NAV_BTN_STYLE}</style>
      <AppShell />
      <PokeLayer />
    </AuthProvider>
  );
}
