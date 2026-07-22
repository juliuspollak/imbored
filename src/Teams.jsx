import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Plus, UserPlus, LogOut, Crown } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

export default function Teams({ onBack }) {
  const { user, createTeam, joinTeam, leaveTeam, addPlayerToTeam } = useAuth();
  const [teams, setTeams] = useState([]);
  const [profiles, setProfiles] = useState([]); // all profiles: id, name, icon, is_private
  const [memberships, setMemberships] = useState([]); // all team_members rows: team_id, user_id
  const [loading, setLoading] = useState(true);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [addingToTeam, setAddingToTeam] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady) return;
    setLoading(true);
    const [{ data: teamsData }, { data: profilesData }, { data: membersData }] = await Promise.all([
      supabase.from("teams").select("*").order("created_at", { ascending: true }),
      supabase.from("profiles").select("id, name, icon, mood, is_private"),
      supabase.from("team_members").select("team_id, user_id"),
    ]);
    setTeams(teamsData || []);
    setProfiles(profilesData || []);
    setMemberships(membersData || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const myTeamIds = new Set(memberships.filter((m) => m.user_id === user?.id).map((m) => m.team_id));

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTeamName.trim() || creating) return;
    setCreating(true);
    setError(null);
    const { error } = await createTeam(newTeamName.trim());
    setCreating(false);
    if (error) setError(error.message);
    else {
      setNewTeamName("");
      refresh();
    }
  }

  async function handleJoin(teamId) {
    setError(null);
    const { error } = await joinTeam(teamId);
    if (error) setError(error.message);
    else refresh();
  }

  async function handleLeave(teamId) {
    setError(null);
    const { error } = await leaveTeam(teamId);
    if (error) setError(error.message);
    else refresh();
  }

  async function handleAdd(targetUserId, teamId) {
    setError(null);
    const { error } = await addPlayerToTeam(targetUserId, teamId);
    if (error) setError(error.message);
    else {
      setAddingToTeam(null);
      refresh();
    }
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={onBack} style={{ color: INK, opacity: 0.5 }}>
            <ArrowLeft size={18} />
          </button>
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK }} className="text-2xl">
            Teams
          </h1>
        </div>
        <p style={{ color: INK, opacity: 0.45 }} className="text-xs mb-6 ml-9">
          {myTeamIds.size === 0 ? "You're not on any team yet" : `You're on ${myTeamIds.size} team${myTeamIds.size === 1 ? "" : "s"}`}
        </p>

        {!supabaseReady && (
          <div className="text-xs rounded-lg p-3 mb-4" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            Supabase isn't configured yet.
          </div>
        )}

        <form onSubmit={handleCreate} className="flex gap-2 mb-6">
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="New team name"
            className="flex-1 rounded-lg px-3 py-2.5 text-sm outline-none"
            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK, background: PANEL }}
          />
          <button
            type="submit"
            disabled={creating}
            className="flex items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold"
            style={{ background: ACCENT, color: "#FFFFFF", opacity: creating ? 0.7 : 1 }}
          >
            <Plus size={15} />
            Create
          </button>
        </form>

        {error && <p className="text-xs mb-4" style={{ color: "#B5433A" }}>{error}</p>}

        {loading ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
        ) : teams.length === 0 ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">No teams yet — start one above.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {teams.map((team) => {
              const rosterIds = memberships.filter((m) => m.team_id === team.id).map((m) => m.user_id);
              const roster = rosterIds.map((id) => profileById[id]).filter(Boolean);
              const isMine = myTeamIds.has(team.id);
              const addablePlayers = profiles.filter((p) => !p.is_private && p.id !== user?.id && !rosterIds.includes(p.id));

              return (
                <div key={team.id} className="rounded-2xl p-4" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)", boxShadow: "0 6px 20px rgba(16,24,40,0.06)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span style={{ color: INK, fontWeight: 700 }} className="text-sm">{team.name}</span>
                      {team.created_by === user?.id && <Crown size={13} style={{ color: "#D9AE58" }} />}
                    </div>
                    {isMine ? (
                      <button onClick={() => handleLeave(team.id)} className="flex items-center gap-1 text-xs font-medium" style={{ color: "#B5433A" }}>
                        <LogOut size={12} /> Leave
                      </button>
                    ) : (
                      <button onClick={() => handleJoin(team.id)} className="text-xs font-medium" style={{ color: ACCENT }}>
                        Join
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {roster.length === 0 ? (
                      <span style={{ color: INK, opacity: 0.35 }} className="text-xs">No members yet</span>
                    ) : (
                      roster.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-1 rounded-full pl-1 pr-2 py-0.5"
                          style={{ background: "rgba(16,24,40,0.05)" }}
                          title={m.mood || undefined}
                        >
                          <span style={{ fontSize: 13 }}>{m.icon || "🙂"}</span>
                          <span style={{ color: INK }} className="text-xs">{m.name}</span>
                          {m.mood && <span style={{ fontSize: 11 }}>· {m.mood}</span>}
                        </div>
                      ))
                    )}
                  </div>

                  {isMine && (
                    <div>
                      {addingToTeam === team.id ? (
                        <div className="mt-2">
                          {addablePlayers.length === 0 ? (
                            <p style={{ color: INK, opacity: 0.4 }} className="text-xs">No eligible players to add.</p>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {addablePlayers.map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => handleAdd(p.id, team.id)}
                                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left"
                                  style={{ border: "1px solid rgba(16,24,40,0.08)" }}
                                >
                                  <span style={{ fontSize: 14 }}>{p.icon || "🙂"}</span>
                                  <span style={{ color: INK }} className="text-xs flex-1">{p.name}</span>
                                  <UserPlus size={13} style={{ color: ACCENT }} />
                                </button>
                              ))}
                            </div>
                          )}
                          <button onClick={() => setAddingToTeam(null)} style={{ color: INK, opacity: 0.4 }} className="text-[11px] mt-1.5">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setAddingToTeam(team.id)} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: ACCENT }}>
                          <UserPlus size={13} /> Add player
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p style={{ color: INK, opacity: 0.35 }} className="text-[11px] text-center mt-6">
          Private profiles never appear in the "add player" list — they can only join a team themselves. You can belong to as many teams as you like.
        </p>
      </div>
    </div>
  );
}
