import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { ArrowLeft, LogOut, Users, User, BarChart3, MessageSquare, Sparkles, Shield, Grid3x3, Star, Gift, MessagesSquare } from "lucide-react";
import Home from "./Home.jsx";
import Login from "./Login.jsx";
import ProfileSetup from "./ProfileSetup.jsx";
import PendingApproval from "./PendingApproval.jsx";
import BlockedAccount from "./BlockedAccount.jsx";
import PointsToast from "./PointsToast.jsx";
import ModePill from "./ModePill.jsx";
import ChallengeGate from "./ChallengeGate.jsx";
import OnlineWidget from "./OnlineWidget.jsx";
import PokeOverlay from "./PokeOverlay.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { AuthProvider, useAuth } from "./lib/AuthContext.jsx";

// Games and the less-frequently-visited screens (teams/stats/admin/etc.) are
// code-split so a first-time visitor's initial bundle only has to include
// Home + Login + auth plumbing, not all five puzzle games and every admin
// tool. Each chunk loads on demand the first time its screen is opened.
const QueensGame = lazy(() => import("./games/Queens.jsx"));
const TangoGame = lazy(() => import("./games/Tango.jsx"));
const ZipGame = lazy(() => import("./games/Zip.jsx"));
const MiniSudokuGame = lazy(() => import("./games/MiniSudoku.jsx"));
const GeoGame = lazy(() => import("./games/Geo.jsx"));
const Teams = lazy(() => import("./Teams.jsx"));
const Stats = lazy(() => import("./Stats.jsx"));
const Feedback = lazy(() => import("./Feedback.jsx"));
const ReleaseNotes = lazy(() => import("./ReleaseNotes.jsx"));
const AdminPlayers = lazy(() => import("./AdminPlayers.jsx"));
const AdminGames = lazy(() => import("./AdminGames.jsx"));
const Progress = lazy(() => import("./Progress.jsx"));
const Chat = lazy(() => import("./Chat.jsx"));
const Chats = lazy(() => import("./Chats.jsx"));
const AdminRewards = lazy(() => import("./AdminRewards.jsx"));
import { saveStats } from "./lib/saveStats.js";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useOnlinePlayers } from "./lib/useOnlinePlayers.js";
import { useGameConfig } from "./lib/useGameConfig.js";
import { usePresence } from "./lib/usePresence.js";
import { useOpenFeedbackCount } from "./lib/useOpenFeedbackCount.js";
import { useCompletedFeedbackCount } from "./lib/useCompletedFeedbackCount.js";
import { useNewTransfersCount } from "./lib/useNewTransfers.js";
import { usePokes } from "./lib/pokes.js";
import { useUnreadMessages } from "./lib/useUnreadMessages.js";

const GAME_COMPONENTS = {
  queens: { Component: QueensGame, label: "Queens" },
  tango: { Component: TangoGame, label: "Tango" },
  zip: { Component: ZipGame, label: "Zip" },
  minisudoku: { Component: MiniSudokuGame, label: "Mini Sudoku" },
  geo: { Component: GeoGame, label: "Geo" },
};

function AppShell() {
  const [active, setActive] = useState(() => {
    if (typeof window === "undefined") return null;
    const query = new URLSearchParams(window.location.search);
    return query.get("auth_return") === "profile" ? "profile" : null;
  }); // null | profile screens | a game id
  const [chatPlayer, setChatPlayer] = useState(null);
  const [chatReturn, setChatReturn] = useState(null);
  // Challenge mode needs an account to mean anything (once-per-day + history
  // are tied to a user) — default to it when logged in, otherwise practice
  // is the only real option.
  const [playMode, setPlayMode] = useState("challenge");
  const [challengeScope, setChallengeScope] = useState({ type: "personal", id: null, name: "My Challenge", gameIds: null });
  const { loading, user, profile, profileLoading, signOut } = useAuth();
  useEffect(() => {
    if (!profile?.account_deleted_at) return;
    // A historical/deleted profile must never render the Login component
    // while its old Auth session is still active. Clear the local session
    // first so a fresh email, Google or passkey sign-in can start cleanly.
    void signOut();
  }, [profile?.account_deleted_at, signOut]);
  // profile.default_mode is a standing preference set in My Profile; it's
  // only meant to seed the FIRST session on a device. Once the player has
  // actually picked a mode here, that choice should survive a refresh
  // rather than snapping back to the profile default every time — so the
  // real last-used mode is cached locally per-user and takes priority.
  const appliedDefaultModeRef = useRef(false);
  useEffect(() => {
    if (appliedDefaultModeRef.current || !user?.id) return;
    let stored = null;
    try {
      stored = window.localStorage.getItem(`queens-play-mode-${user.id}`);
    } catch {
      // localStorage unavailable — fall through to the profile default below
    }
    if (stored === "practice" || stored === "challenge") {
      setPlayMode(stored);
      appliedDefaultModeRef.current = true;
    } else if (profile?.default_mode) {
      setPlayMode(profile.default_mode);
      appliedDefaultModeRef.current = true;
    }
  }, [user?.id, profile]);
  useEffect(() => {
    // Only persist once we've settled on a real initial value — otherwise
    // the very first render's "challenge" placeholder would overwrite a
    // stored preference before the effect above has had a chance to read it.
    if (!user?.id || !appliedDefaultModeRef.current) return;
    try {
      window.localStorage.setItem(`queens-play-mode-${user.id}`, playMode);
    } catch {
      // non-fatal — the choice just won't survive a refresh this time
    }
  }, [playMode, user?.id]);
  const players = useOnlinePlayers({ includeHidden: !!profile?.is_admin });
  const { config: gameConfig, refetch: refetchGameConfig } = useGameConfig();
  usePresence(["queens", "tango", "zip", "minisudoku", "geo"].includes(active) ? active : null, playMode);
  const openFeedbackCount = useOpenFeedbackCount(profile?.is_admin ? user?.id : undefined);
  const completedFeedbackCount = useCompletedFeedbackCount(profile?.is_admin ? undefined : user?.id);
  const newTransfersCount = useNewTransfersCount(user?.id);
  const unreadMessages = useUnreadMessages(user?.id);
  const [sectionSignals, setSectionSignals] = useState({ whatsnew: false, teams: false });

  function openSection(section) {
    setSectionSignals((current) => ({ ...current, [section]: false }));
    setActive(section);
    if (!user?.id || !supabaseReady) return;
    void supabase
      .from("user_section_views")
      .upsert({ user_id: user.id, section, viewed_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) console.error(`Unable to mark ${section} as viewed:`, error);
      });
  }

  useEffect(() => {
    if (!user?.id || !supabaseReady) return;
    let cancelled = false;
    (async () => {
      const [{ data: views }, { data: notes }, { data: requests }] = await Promise.all([
        supabase.from("user_section_views").select("section,viewed_at").eq("user_id", user.id),
        // Keep this bootstrap query compatible with databases that predate the
        // optional release-note visibility and soft-delete columns. The full
        // release-notes screen applies those filters when the columns exist.
        supabase.from("release_notes").select("created_at").order("created_at", { ascending:false }).limit(1),
        // RLS already limits this table to the requester and the team owner.
        // Its schema uses user_id/requested_at (not requester_id/created_at).
        supabase.from("team_join_requests").select("requested_at,decided_at,status,user_id,team_id")
      ]);
      if (cancelled) return;
      const vm = Object.fromEntries((views || []).map(v => [v.section, new Date(v.viewed_at).getTime()]));
      const latestNote = notes?.[0]?.created_at ? new Date(notes[0].created_at).getTime() : 0;
      const latestTeam = Math.max(
        0,
        ...(requests || []).map(r => new Date(r.decided_at || r.requested_at).getTime())
      );
      setSectionSignals({ whatsnew: latestNote > (vm.whatsnew || 0), teams: latestTeam > (vm.teams || 0) });
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  if (supabaseReady) {
    if (loading) return <FullScreenMessage text="Loading…" />;
    if (!user) return <Login />;
    if (profileLoading) return <FullScreenMessage text="Loading your profile…" />;
    if (!profile) return <ProfileSetup />; // mandatory first-time setup, no onDone — nothing to go back to yet
    if (profile.account_deleted_at) return <FullScreenMessage text="Signing out deleted account…" />;
    if (profile.is_blocked) return <BlockedAccount />;
    if (!profile.is_admin && profile.is_approved === false) return <PendingApproval />;
  }


  if (chatPlayer) {
    return (
      <Suspense fallback={<FullScreenMessage text="Opening chat…" />}>
        <Chat
          currentUser={user}
          currentProfile={profile}
          peer={chatPlayer}
          onBack={() => { setChatPlayer(null); if (chatReturn === "chats") setActive("chats"); setChatReturn(null); }}
        />
      </Suspense>
    );
  }


  if (active === "chats") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading chats…" />}>
        <Chats
          currentUser={user}
          currentProfile={profile}
          onBack={() => setActive(null)}
          onOpenChat={(player) => { setChatReturn("chats"); setChatPlayer(player); }}
          onOpenAdminPlayers={() => setActive("adminplayers")}
        />
      </Suspense>
    );
  }

  if (active === "profile") {
    return <ProfileSetup onDone={() => setActive(null)} onOpenTeams={() => openSection("teams")} />;
  }

  if (active === "teams") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <Teams onBack={() => setActive(null)} />
      </Suspense>
    );
  }

  if (active === "stats") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <Stats onBack={() => setActive(null)} />
      </Suspense>
    );
  }

  if (active === "progress") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <Progress onBack={() => setActive(null)} />
      </Suspense>
    );
  }

  if (active === "feedback") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <Feedback onBack={() => setActive(null)} />
      </Suspense>
    );
  }

  if (active === "whatsnew") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <ReleaseNotes onBack={() => setActive(null)} />
      </Suspense>
    );
  }

  if (active === "adminplayers") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <AdminPlayers onBack={() => setActive(null)} />
      </Suspense>
    );
  }

  if (active === "admingames") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <AdminGames onBack={() => setActive(null)} />
      </Suspense>
    );
  }

  if (active === "adminrewards") {
    return (
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <AdminRewards onBack={() => setActive(null)} />
      </Suspense>
    );
  }

  if (!active) {
    return (
      <>
        <Home
          onSelect={(id) => {
            refetchGameConfig();
            setActive(id);
          }}
          playMode={supabaseReady ? playMode : "practice"}
          onPlayModeChange={supabaseReady ? setPlayMode : undefined}
          players={players}
          userId={user?.id}
          onOpenProgress={() => setActive("progress")}
          onOpenTeams={() => openSection("teams")}
          challengeScope={challengeScope}
          onChallengeScopeChange={setChallengeScope}
        />
        {supabaseReady && profile && (
          <AccountBadge
            profile={profile}
            onSignOut={signOut}
            onOpenProfile={() => setActive("profile")}
            onOpenTeams={() => openSection("teams")}
            onOpenChats={() => setActive("chats")}
            onOpenStats={() => setActive("stats")}
            onOpenProgress={() => setActive("progress")}
            onOpenFeedback={() => setActive("feedback")}
            onOpenWhatsNew={() => openSection("whatsnew")}
            onOpenAdminPlayers={() => setActive("adminplayers")}
            onOpenAdminGames={() => setActive("admingames")}
            onOpenAdminRewards={() => setActive("adminrewards")}
            players={players}
            userId={user?.id}
            openFeedbackCount={openFeedbackCount}
            completedFeedbackCount={completedFeedbackCount}
            newTransfersCount={newTransfersCount}
            unreadMessages={unreadMessages}
            sectionSignals={sectionSignals}
            onOpenChat={(player) => { setChatReturn(null); setChatPlayer(player); }}
          />
        )}
      </>
    );
  }

  const { Component: Current, label } = GAME_COMPONENTS[active];
  const cfg = gameConfig?.[active];

  // Puzzle generation/rendering bugs in one game shouldn't be able to take
  // the whole app down — a reset here just drops the player back to Home
  // rather than forcing a full page reload.
  if (playMode === "challenge" && supabaseReady) {
    return (
      <ErrorBoundary key={active} onReset={() => setActive(null)}>
        <Suspense fallback={<FullScreenMessage text="Loading…" />}>
          <ChallengeGate
            gameId={active}
            gameLabel={label}
            GameComponent={Current}
            userId={user?.id}
            onExit={() => setActive(null)}
            onSwitchMode={() => setPlayMode("practice")}
            hintCooldownConfig={cfg}
            weekStartsOn={profile?.week_starts_on ?? 1}
            challengeScope={challengeScope}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary key={active} onReset={() => setActive(null)}>
      <Suspense fallback={<FullScreenMessage text="Loading…" />}>
        <PracticePlay
          Current={Current}
          gameId={active}
          gameLabel={label}
          userId={user?.id}
          onExit={() => setActive(null)}
          onSwitchMode={supabaseReady ? () => setPlayMode("challenge") : undefined}
          challengeScope={challengeScope}
          onChallengeScopeChange={setChallengeScope}
          hintCooldownConfig={cfg}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

function PracticePlay({ Current, gameId, gameLabel, userId, onExit, onSwitchMode, challengeScope, onChallengeScopeChange, hintCooldownConfig }) {
  const [savedStatId, setSavedStatId] = useState(null);
  const [rewardResult, setRewardResult] = useState(null);
  const [showChallengeChoice, setShowChallengeChoice] = useState(false);

  async function handleSolved(stats) {
    setSavedStatId(null);
    const res = await saveStats(stats);
    if (res?.data) {
      setSavedStatId(res.data.id);
      setRewardResult({ ...(res.reward || {}), completed:true, eventId:Date.now() });
    } else {
      setRewardResult({ completed:true, eventId:Date.now() });
    }
  }

  function switchToChallenge() {
    const teamDoesNotIncludeGame = challengeScope?.type === "team"
      && !(challengeScope.gameIds || []).includes(gameId);
    if (teamDoesNotIncludeGame) {
      setShowChallengeChoice(true);
      return;
    }
    onSwitchMode?.();
  }

  function playPersonalChallenge() {
    onChallengeScopeChange?.({ type:"personal", teamId:null, teamName:null, gameIds:null });
    setShowChallengeChoice(false);
    onSwitchMode?.();
  }

  function chooseChallenge() {
    setShowChallengeChoice(false);
    onSwitchMode?.();
    onExit?.();
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
          left: "max(16px, calc((100vw - var(--game-nav-width, 512px)) / 2))",
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
        rewardResult={rewardResult}
      />
      {onSwitchMode && <ModePill mode="practice" onSwitch={switchToChallenge} />}
      <PointsToast reward={rewardResult} />
      {showChallengeChoice && (
        <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center p-4" style={{ background:"rgba(16,24,40,.48)" }}>
          <div className="w-full max-w-sm rounded-3xl p-5" style={{ background:"#fff", boxShadow:"0 24px 70px rgba(16,24,40,.24)" }}>
            <div className="text-3xl mb-2">👑</div>
            <h2 className="text-lg font-bold">{gameLabel} isn’t in this team challenge</h2>
            <p className="text-sm mt-1 mb-4" style={{ color:"rgba(27,33,41,.58)" }}>
              {challengeScope?.teamName || "Your team"} didn’t include this game this week. You can play your personal challenge or choose another team challenge.
            </p>
            <button type="button" onClick={playPersonalChallenge} className="w-full rounded-full py-3 text-sm font-semibold text-white" style={{ background:"#2F6FED" }}>Play my challenge</button>
            <button type="button" onClick={chooseChallenge} className="w-full rounded-full py-3 mt-2 text-sm font-semibold" style={{ background:"rgba(16,24,40,.06)" }}>Choose another challenge</button>
            <button type="button" onClick={() => setShowChallengeChoice(false)} className="w-full py-2.5 mt-1 text-xs" style={{ color:"rgba(27,33,41,.48)" }}>Stay in practice</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountBadge({ sectionSignals = {}, profile, onSignOut, onOpenProfile, onOpenTeams, onOpenChats, onOpenStats, onOpenProgress, onOpenFeedback, onOpenWhatsNew, onOpenAdminPlayers, onOpenAdminGames, onOpenAdminRewards, players, userId, openFeedbackCount = 0, completedFeedbackCount = 0, newTransfersCount = 0, unreadMessages = { total: 0, bySender: {} }, onOpenChat }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const isAdmin = !!profile.is_admin;
  // Admins care about the queue of open tickets; everyone else only cares
  // about their own feedback getting a reply — each role sees its own count,
  // both here and on the bubble badge below (previously the bubble always
  // showed the admin count even for regular players).
  const feedbackBadgeCount = isAdmin ? openFeedbackCount : completedFeedbackCount;
  const totalNotifications = feedbackBadgeCount + newTransfersCount + unreadMessages.total + (sectionSignals.whatsnew ? 1 : 0) + (sectionSignals.teams ? 1 : 0);
  const hasNotifications = totalNotifications > 0;

  const items = [
    { id: "profile", onClick: onOpenProfile, icon: User, label: "My profile", glow: "rgba(47,111,237,0.35)", border: "rgba(47,111,237,0.4)" },
    { id: "whatsnew", onClick: onOpenWhatsNew, icon: Sparkles, label: "What's new", badge: sectionSignals.whatsnew ? 1 : 0, glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" },
    { id: "chats", onClick: onOpenChats, icon: MessagesSquare, label: unreadMessages.total > 0 ? "Chats · new" : "Chats", glow: "rgba(79,70,229,0.35)", border: "rgba(79,70,229,0.4)", badge: unreadMessages.total },
    { id: "feedback", onClick: onOpenFeedback, icon: MessageSquare, label: completedFeedbackCount > 0 ? "Feedback · update" : "Feedback", glow: "rgba(139,92,246,0.35)", border: "rgba(139,92,246,0.4)", badge: feedbackBadgeCount },
    { id: "stats", onClick: onOpenStats, icon: BarChart3, label: "Stats", glow: "rgba(47,111,237,0.35)", border: "rgba(47,111,237,0.4)" },
    { id: "progress", onClick: onOpenProgress, icon: Star, label: newTransfersCount > 0 ? "My progress · new" : "My progress", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)", badge: newTransfersCount },
    { id: "teams", onClick: onOpenTeams, icon: Users, label: "Teams", badge: sectionSignals.teams ? 1 : 0, glow: "rgba(18,148,106,0.35)", border: "rgba(18,148,106,0.4)" },
    { id: "signout", onClick: onSignOut, icon: LogOut, label: "Sign out", glow: "rgba(229,72,77,0.35)", border: "rgba(229,72,77,0.4)" },
  ];

  const adminItems = [
    { id: "adminplayers", onClick: onOpenAdminPlayers, icon: Shield, label: "Players", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" },
    { id: "admingames", onClick: onOpenAdminGames, icon: Grid3x3, label: "Games", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" },
    { id: "adminrewards", onClick: onOpenAdminRewards, icon: Gift, label: "Rewards", glow: "rgba(217,174,88,0.35)", border: "rgba(217,174,88,0.4)" },
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
          onClick={() => { setAdminOpen(false); setMenuOpen((o) => !o); }}
          className={`nav-btn ${hasNotifications ? "feedback-wiggle" : ""}`}
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
        {hasNotifications && (
          <div
            className="dot-pulse flex items-center justify-center rounded-full"
            title={newTransfersCount > 0 ? "You have new points and updates" : "You have updates"}
            style={{
              position: "absolute", top: -3, right: -3, width: 11, height: 11,
              background: "#8B5CF6", color: "#FFFFFF", fontSize: 9, fontWeight: 700, border: "1.5px solid #F1F3F7",
            }}
          >
            {totalNotifications}
          </div>
        )}
      </div>

      {menuOpen && (
        <div className="flex flex-col items-end gap-1.5">
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={() => {
                setMenuOpen(false);
                item.onClick();
              }}
              className="menu-balloon nav-btn flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1.5"
              style={{
                "--nav-glow": item.glow,
                "--nav-border": item.border,
                animationDelay: `${i * 0.04}s`,
                background: item.badge > 0 ? "#F4EEFE" : "#FFFFFF",
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
                  style={{ width: 9, height: 9, background: "#8B5CF6" }}
                >
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

      {isAdmin && (
        <div style={{ position: "relative" }}>
          <button
            onClick={() => { setMenuOpen(false); setAdminOpen((o) => !o); }}
            className="nav-btn relative flex items-center justify-center rounded-full"
            style={{
              "--nav-glow": "rgba(217,174,88,0.35)",
              "--nav-border": "rgba(217,174,88,0.55)",
              width: 34,
              height: 34,
              background: "rgba(255,255,255,0.95)",
              border: "1px solid rgba(217,174,88,0.45)",
              color: "#9A6B12",
              boxShadow: "0 5px 14px rgba(16,24,40,0.10)",
            }}
            aria-label="Admin tools"
            title="Admin tools"
          >
            <Shield size={15} />
          </button>
          {adminOpen && (
            <div className="absolute top-full right-0 mt-2 flex flex-col items-end gap-1.5" style={{ zIndex: 60 }}>
              <div className="menu-balloon text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-1" style={{ background: "#FFF8E7", color: "#9A6B12", border: "1px solid rgba(217,174,88,0.25)" }}>
                Admin
              </div>
              {adminItems.map((item, i) => (
                <button
                  key={item.id}
                  onClick={() => { setAdminOpen(false); item.onClick(); }}
                  className="menu-balloon nav-btn flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1.5"
                  style={{
                    "--nav-glow": item.glow,
                    "--nav-border": item.border,
                    animationDelay: `${i * 0.04}s`,
                    background: "#FFFFFF",
                    boxShadow: "0 6px 16px rgba(16,24,40,0.14)",
                    border: "1px solid rgba(217,174,88,0.22)",
                    color: "#1B2129",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span className="text-xs font-medium">{item.label}</span>
                  <span className="flex items-center justify-center rounded-full" style={{ width: 24, height: 24, background: "rgba(217,174,88,0.14)", color: "#9A6B12" }}>
                    <item.icon size={12} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <OnlineWidget players={players} userId={userId} myName={profile.name} onOpenChat={onOpenChat} unreadBySender={unreadMessages.bySender} unreadTotal={unreadMessages.total} />
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
