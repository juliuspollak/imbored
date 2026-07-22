import { useState } from "react";
import { useAuth } from "./lib/AuthContext.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

export default function ProfileSetup() {
  const { saveProfile, user } = useAuth();
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const { error } = await saveProfile({ name: name.trim(), team: team.trim() || null });
    setSaving(false);
    if (error) setError(error.message);
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center p-4">
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <div className="text-center mb-6">
          <h1 style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontWeight: 600, color: INK }} className="text-3xl">
            Welcome
          </h1>
          <p style={{ color: INK, opacity: 0.5 }} className="text-xs mt-1">
            {user?.email} — just need a name to get started
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ color: INK, opacity: 0.6 }} className="text-xs font-medium block mb-1.5">
            Your name
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jamie"
            className="w-full rounded-lg px-3 py-2.5 text-sm mb-3 outline-none"
            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
          />

          <label style={{ color: INK, opacity: 0.6 }} className="text-xs font-medium block mb-1.5">
            Team <span style={{ opacity: 0.5 }}>(optional — can add later)</span>
          </label>
          <input
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="e.g. Marketing"
            className="w-full rounded-lg px-3 py-2.5 text-sm mb-4 outline-none"
            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
          />

          {error && <p className="text-xs mb-3" style={{ color: "#B5433A" }}>{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg py-2.5 text-sm font-semibold"
            style={{ background: ACCENT, color: "#FFFFFF", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : "Start playing"}
          </button>
        </form>
      </div>
    </div>
  );
}
