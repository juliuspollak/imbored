import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Clock3, LockKeyhole, Trophy } from "lucide-react";
import { useI18n } from "./lib/i18n.jsx";

const INK = "#1B2129";

function formatDuration(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

export default function ChallengeStandings({ rows = [], roster = [], games = [], isTeam = false, userId, loading = false, refreshing = false }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);
  const gameIds = useMemo(() => games.map((game) => game.id), [games]);

  const standings = useMemo(() => {
    const rowsByPlayer = rows.reduce((grouped, row) => {
      (grouped[row.user_id] ||= []).push(row);
      return grouped;
    }, {});
    const ranked = roster
      .map((member) => {
        const privateStats = isTeam && member.id !== userId && member.show_stats_to_others === false;
        const playerRows = (rowsByPlayer[member.id] || []).filter((row) => gameIds.includes(row.game));
        return {
          ...member,
          rows: playerRows,
          privateStats,
          completed: playerRows.length,
          totalSeconds: playerRows.reduce((total, row) => total + (Number(row.seconds) || 0), 0),
          mistakes: playerRows.reduce((total, row) => total + (Number(row.mistakes) || 0), 0),
        };
      })
      .sort((a, b) => {
        if (a.privateStats !== b.privateStats) return a.privateStats ? 1 : -1;
        if (a.completed !== b.completed) return b.completed - a.completed;
        if (a.totalSeconds !== b.totalSeconds) return a.totalSeconds - b.totalSeconds;
        if (a.mistakes !== b.mistakes) return a.mistakes - b.mistakes;
        return (a.name || "").localeCompare(b.name || "");
      });
    let visibleRank = 0;
    return ranked.map((standing) => ({
      ...standing,
      rank: !standing.privateStats && standing.completed > 0 ? ++visibleRank : null,
    }));
  }, [gameIds, isTeam, roster, rows, userId]);

  const playedCount = standings.filter((standing) => standing.completed > 0).length;
  const leader = standings.find((standing) => standing.rank === 1);

  return (
    <div className="rounded-3xl mt-3 overflow-hidden" style={{ background:"#fff",border:"1px solid rgba(16,24,40,.09)",boxShadow:"0 10px 28px rgba(16,24,40,.06)" }}>
      <button type="button" onClick={() => setOpen((value) => !value)} className="w-full flex items-center gap-3 p-4 text-left" aria-expanded={open}>
        <span className="grid place-items-center rounded-2xl shrink-0" style={{ width:42,height:42,background:"rgba(217,174,88,.13)",color:"#9A721F" }}><Trophy size={19}/></span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-bold">{t("standings.title")}</span>
            {(loading || refreshing) && <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color:"rgba(27,33,41,.42)" }}><span className="inline-block rounded-full animate-pulse" style={{ width:6,height:6,background:"#2F6FED" }}/>{t(refreshing ? "standings.updating" : "standings.loadingShort")}</span>}
            {!loading && leader && <span className="truncate text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background:"rgba(217,174,88,.13)",color:"#80601D" }}>{leader.icon || "🙂"} {t("standings.leads", { name:leader.name })}</span>}
          </span>
          <span className="block text-[11px] mt-0.5" style={{ color:"rgba(27,33,41,.48)" }}>
            {isTeam
              ? t("standings.teamSummary", { played:playedCount, players:roster.length, games:games.length })
              : t("standings.personalSummary", { players:playedCount, games:games.length })}
          </span>
        </span>
        {open ? <ChevronUp size={16} style={{ opacity:.35 }}/> : <ChevronDown size={16} style={{ opacity:.35 }}/>}
      </button>

      {open && (
        <div className="px-3 pb-3">
          {loading ? (
            <div className="space-y-2" role="status" aria-label={t("standings.loading")}>
              {[0,1,2].map((item) => <div key={item} className="h-[58px] rounded-2xl animate-pulse" style={{ background:"linear-gradient(90deg,#F4F5F8,#FAFAFC,#F4F5F8)" }}/>)}
            </div>
          ) : standings.length === 0 ? (
            <div className="rounded-2xl py-5 px-4 text-center" style={{ background:"#F7F8FB" }}>
              <div className="text-sm font-semibold">{t("standings.emptyTitle")}</div>
              <div className="text-[11px] mt-1" style={{ color:"rgba(27,33,41,.48)" }}>{t("standings.emptyBody")}</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {standings.map((standing) => {
                const isExpanded = expandedPlayerId === standing.id;
                const progress = games.length ? Math.round((standing.completed / games.length) * 100) : 0;
                const finished = games.length > 0 && standing.completed === games.length;
                return (
                  <button
                    type="button"
                    key={standing.id}
                    onClick={() => !standing.privateStats && setExpandedPlayerId(isExpanded ? null : standing.id)}
                    className="w-full rounded-2xl p-3 text-left"
                    style={{ background:standing.id === userId ? "rgba(47,111,237,.07)" : "#F7F8FB",border:standing.rank === 1 ? "1px solid rgba(217,174,88,.35)" : "1px solid transparent" }}
                    aria-expanded={isExpanded}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="w-5 text-center text-xs font-bold" style={{ color:standing.rank === 1 ? "#9A721F" : "rgba(27,33,41,.35)" }}>{standing.rank || "—"}</span>
                      <span className="grid place-items-center rounded-full text-sm shrink-0" style={{ width:32,height:32,background:"#fff" }}>{standing.icon || "🙂"}</span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold truncate">{standing.name || t("common.player")}{standing.id === userId ? ` · ${t("standings.you")}` : ""}</span>
                          {finished && <Check size={12} strokeWidth={3} style={{ color:"#12946A" }}/>}
                        </span>
                        {standing.privateStats ? (
                          <span className="flex items-center gap-1 text-[10px] mt-0.5" style={{ color:"rgba(27,33,41,.42)" }}><LockKeyhole size={10}/>{t("standings.private")}</span>
                        ) : (
                          <span className="block h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background:"rgba(16,24,40,.08)" }}>
                            <span className="block h-full rounded-full" style={{ width:`${progress}%`,background:finished ? "#12946A" : "#2F6FED" }}/>
                          </span>
                        )}
                      </span>
                      {!standing.privateStats && (
                        <span className="text-right shrink-0">
                          <span className="block text-xs font-bold">{standing.completed}/{games.length}</span>
                          <span className="flex items-center justify-end gap-1 text-[10px] mt-0.5" style={{ color:"rgba(27,33,41,.48)" }}>
                            {standing.completed > 0 ? <><Clock3 size={10}/>{formatDuration(standing.totalSeconds)}</> : t("standings.notStarted")}
                          </span>
                        </span>
                      )}
                    </span>

                    {isExpanded && (
                      <span className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-3 pt-3" style={{ borderTop:"1px solid rgba(16,24,40,.07)" }}>
                        {games.map((game) => {
                          const result = standing.rows.find((row) => row.game === game.id);
                          const GameIcon = game.icon;
                          return (
                            <span key={game.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background:"#fff" }}>
                              <GameIcon size={13} style={{ color:game.accent }}/>
                              <span className="text-[11px] font-medium flex-1">{game.label}</span>
                              <span className="text-[10px] font-semibold" style={{ color:result ? INK : "rgba(27,33,41,.32)" }}>{result ? formatDuration(result.seconds) : t("standings.notPlayed")}</span>
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="px-2 pt-1 text-[10px] text-center" style={{ color:"rgba(27,33,41,.38)" }}>{t("standings.rankingRule")}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
