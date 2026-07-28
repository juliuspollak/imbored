export function filterVisibleOnlinePlayers(rows = []) {
  return rows.filter((row) =>
    row?.profiles
    && row.profiles.is_private !== true
    && row.profiles.hidden_from_others !== true
  );
}
