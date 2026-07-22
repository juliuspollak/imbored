import { useState, useEffect } from "react";
import { Lock, Unlock, Users, ArrowLeft } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { PROFILE_ICONS } from "./lib/icons.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

// Used both as the mandatory first-login screen (no `onDone`/`onBack`
// passed — nothing to go back to yet) and later as an editable "my
// profile" screen reached from the home page.
export default function ProfileSetup({ onDone, onOpenTeams }) {
  const { profile, user, saveProfile, leaveTeam } = useAuth();
  const isFirstTime = !profile;

  const [name, setName] = useState(profile?.name || "");
  const [icon, setIcon] = useState(profile?.icon || "🙂");
  const [isPrivate, setIsPrivate] = useState(profile?.is_private || false);
  const [mood, setMood] = useState(profile?.mood || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setIcon(profile.icon || "🙂");
      setIsPrivate(profile.is_private || false);
      setMood(profile.mood || "");
    }
  }, [profile]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const { error } = await saveProfile({ name: name.trim(), icon, is_private: isPrivate, mood: mood.trim() || null });
    setSaving(false);
    if (error) setError(error.message);
    else if (onDone) onDone();
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center p-4">
      <div
        className="w-full max-w-sm rounded-2xl p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        {onDone && (
          <button onClick={onDone} style={{ color: INK, opacity: 0.4 }} className="absolute top-5 left-5">
            <ArrowLeft size={18} />
          </button>
        )}

        <div className="text-center mb-6">
          <div
            className="mx-auto mb-2 flex items-center justify-center rounded-full"
            style={{ width: 56, height: 56, background: "rgba(47,111,237,0.1)", fontSize: 28 }}
          >
            {icon}
          </div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontWeight: 600, color: INK }} className="text-2xl">
            {isFirstTime ? "Welcome" : "My Profile"}
          </h1>
          <p style={{ color: INK, opacity: 0.5 }} className="text-xs mt-1">
            {isFirstTime ? `${user?.email} — just need a name to get started` : user?.email}
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
            className="w-full rounded-lg px-3 py-2.5 text-sm mb-4 outline-none"
            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
          />

          <label style={{ color: INK, opacity: 0.6 }} className="text-xs font-medium block mb-1.5">
            Icon
          </label>
          <div className="grid grid-cols-8 gap-1.5 mb-4">
            {PROFILE_ICONS.map((ic) => (
              <button
                type="button"
                key={ic}
                onClick={() => setIcon(ic)}
                className="flex items-center justify-center rounded-lg"
                style={{
                  width: 32,
                  height: 32,
                  fontSize: 16,
                  background: icon === ic ? "rgba(47,111,237,0.15)" : "transparent",
                  border: icon === ic ? "1.5px solid #2F6FED" : "1px solid rgba(16,24,40,0.08)",
                }}
              >
                {ic}
              </button>
            ))}
          </div>

          <label style={{ color: INK, opacity: 0.6 }} className="text-xs font-medium block mb-1.5">
            Mood <span style={{ opacity: 0.5 }}>(visible to everyone)</span>
          </label>
          <input
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            placeholder="e.g. 😴 tired but ready"
            maxLength={40}
            className="w-full rounded-lg px-3 py-2.5 text-sm mb-4 outline-none"
            style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
          />

          <button
            type="button"
            onClick={() => setIsPrivate((p) => !p)}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-4 text-left"
            style={{ border: "1px solid rgba(16,24,40,0.14)" }}
          >
            {isPrivate ? <Lock size={15} style={{ color: INK }} /> : <Unlock size={15} style={{ color: INK, opacity: 0.4 }} />}
            <div className="flex-1">
              <div style={{ color: INK }} className="text-xs font-medium">Private profile</div>
              <div style={{ color: INK, opacity: 0.5 }} className="text-[11px]">
                {isPrivate ? "Hidden from team invites — nobody can add you" : "Visible — anyone can add you to their team"}
              </div>
            </div>
            <div
              className="rounded-full flex-shrink-0"
              style={{ width: 32, height: 18, background: isPrivate ? ACCENT : "rgba(16,24,40,0.15)", position: "relative", transition: "background 0.15s" }}
            >
              <div
                className="rounded-full absolute"
                style={{ width: 14, height: 14, top: 2, left: isPrivate ? 16 : 2, background: "#FFFFFF", transition: "left 0.15s" }}
              />
            </div>
          </button>

          {!isFirstTime && (
            <button
              type="button"
              onClick={onOpenTeams}
              className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold mb-3"
              style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
            >
              <Users size={15} />
              Teams
            </button>
          )}

          {error && <p className="text-xs mb-3" style={{ color: "#B5433A" }}>{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg py-2.5 text-sm font-semibold"
            style={{ background: ACCENT, color: "#FFFFFF", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : isFirstTime ? "Start playing" : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
