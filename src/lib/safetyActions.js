// Only a confirmed RPC result may change local block state or announce success.
// report_content already creates the report and personal block atomically.
export async function completeSafetyAction(request, onSuccess) {
  const result = await request();
  if (result?.error) throw result.error;
  onSuccess();
}

export function withoutBlockedPlayer(players, userId) {
  return players.filter(player => player.user_id !== userId);
}
