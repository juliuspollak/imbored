import test from "node:test";
import assert from "node:assert/strict";
import { filterVisibleOnlinePlayers } from "./onlinePlayers.js";

test("online lists never expose hidden or private profiles", () => {
  const visible = filterVisibleOnlinePlayers([
    { user_id: "visible", profiles: { is_private: false, hidden_from_others: false } },
    { user_id: "hidden", profiles: { is_private: false, hidden_from_others: true } },
    { user_id: "private", profiles: { is_private: true, hidden_from_others: false } },
    { user_id: "blocked-by-rls", profiles: null },
  ]);

  assert.deepEqual(visible.map((row) => row.user_id), ["visible"]);
});
