import { useState, useEffect } from "react";
import { Lock, Unlock, Users, Fingerprint, Trash2, Plus, Link2, Unlink, Mail, Languages, Monitor, Sun, Moon } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { PROFILE_ICONS } from "./lib/icons.js";
import { useI18n } from "./lib/i18n.jsx";
import { applyThemePreference } from "./lib/theme.js";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import TextInput from "./components/TextInput.jsx";
import StatusBanner from "./components/StatusBanner.jsx";
import AccountSafety from "./AccountSafety.jsx";

const passkeySupported = typeof window !== "undefined" && !!window.PublicKeyCredential;

// Used both as the mandatory first-login screen (no `onDone`/`onBack`
// passed — nothing to go back to yet) and later as an editable "my
// profile" screen reached from the home page.
export default function ProfileSetup({ onDone, onOpenCircles }) {
  const { t, language, setLanguage } = useI18n();
  const { profile, user, saveProfile, registerPasskey, listPasskeys, deletePasskey, listIdentities, linkGoogleIdentity, unlinkIdentity } = useAuth();
  const isFirstTime = !profile;

  const [name, setName] = useState(profile?.name || "");
  const [icon, setIcon] = useState(profile?.icon || "🙂");
  const [isPrivate, setIsPrivate] = useState(profile?.is_private || false);
  const [mood, setMood] = useState(profile?.mood || "");
  const [defaultMode, setDefaultMode] = useState(profile?.default_mode || "challenge");
  const [showStatsToOthers, setShowStatsToOthers] = useState(profile?.show_stats_to_others ?? true);
  const [weekStartsOn, setWeekStartsOn] = useState(profile?.week_starts_on ?? 1);
  const [themePreference, setThemePreference] = useState(profile?.theme_preference || "system");
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState(null);
  const [identities, setIdentities] = useState([]);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState(null);

  function friendlyIdentityError(message) {
    const text = decodeURIComponent(String(message || "").replace(/\+/g, " "));
    if (!text.toLowerCase().includes("identity is already linked to another user")) return text;
    if (profile?.is_admin) {
      return "This Google sign-in still belongs to the previous player account. Open Admin tools → Players, find the historical account, choose Finish Auth deletion, then try Connect Google again.";
    }
    return "This Google sign-in already belongs to another player. Sign in with Google to use that player, or ask an admin to remove the old account before linking it here.";
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const callbackError =
      query.get("error_description") ||
      hash.get("error_description") ||
      query.get("error") ||
      hash.get("error");

    if (callbackError) {
      setIdentityError(friendlyIdentityError(callbackError));
    }

    if (query.has("auth_return") || callbackError) {
      query.delete("auth_return");
      query.delete("error");
      query.delete("error_code");
      query.delete("error_description");
      const cleanQuery = query.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}`);
    }
  }, []);

  async function refreshIdentities() {
    const { data, error } = await listIdentities();
    if (!error) setIdentities(data?.identities || []);
  }

  async function handleLinkGoogle() {
    setIdentityBusy(true); setIdentityError(null);
    const { error } = await linkGoogleIdentity();
    setIdentityBusy(false);
    if (error) setIdentityError(friendlyIdentityError(error.message));
  }

  async function handleUnlinkIdentity(identity) {
    if (identities.length <= 1) { setIdentityError("Keep at least one sign-in method connected."); return; }
    setIdentityBusy(true); setIdentityError(null);
    const { error } = await unlinkIdentity(identity);
    setIdentityBusy(false);
    if (error) setIdentityError(error.message); else refreshIdentities();
  }

  async function refreshPasskeys() {
    const { data } = await listPasskeys();
    setPasskeys(data || []);
  }

  useEffect(() => {
    if (!isFirstTime) { refreshIdentities(); if (passkeySupported) refreshPasskeys(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstTime]);

  async function handleAddPasskey() {
    setPasskeyError(null);
    setPasskeyBusy(true);
    const { error } = await registerPasskey();
    setPasskeyBusy(false);
    if (error) setPasskeyError(error.message);
    else refreshPasskeys();
  }

  async function handleDeletePasskey(id) {
    await deletePasskey(id);
    refreshPasskeys();
  }

  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setIcon(profile.icon || "🙂");
      setIsPrivate(profile.is_private || false);
      setMood(profile.mood || "");
      setDefaultMode(profile.default_mode || "challenge");
      setShowStatsToOthers(profile.show_stats_to_others ?? true);
      setWeekStartsOn(profile.week_starts_on ?? 1);
      setThemePreference(profile.theme_preference || "system");
    }
  }, [profile]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const { error } = await saveProfile({ name: name.trim(), icon, is_private: isPrivate, mood: mood.trim() || null, default_mode: defaultMode, show_stats_to_others: showStatsToOthers, week_starts_on: weekStartsOn, theme_preference: themePreference });
    setSaving(false);
    if (error) setError(error.message);
    else if (onDone) onDone();
  }

  const themeOptions = [
    { value: "system", label: t("profile.themeSystem"), Icon: Monitor },
    { value: "light", label: t("profile.themeLight"), Icon: Sun },
    { value: "dark", label: t("profile.themeDark"), Icon: Moon },
  ];

  return (
    <Page>
      <PageHeader
        title={isFirstTime ? t("profile.welcome") : t("profile.title")}
        subtitle={isFirstTime ? t("profile.firstHint", { email: user?.email || "" }) : user?.email}
        onBack={onDone}
        backAriaLabel="Back to home"
        action={
          <button
            type="button"
            onClick={() => setShowIconPicker((value) => !value)}
            aria-label={showIconPicker ? "Close avatar picker" : "Change avatar"}
            aria-expanded={showIconPicker}
            className="profile-avatar-button"
            style={{ width: 46, height: 46, display: "grid", placeItems: "center", borderRadius: "50%", border: showIconPicker ? "2px solid var(--color-primary)" : "1px solid var(--color-border)", background: showIconPicker ? "var(--color-primary-subtle)" : "var(--color-surface)", boxShadow: "var(--shadow-control)", color: "var(--color-text-primary)", fontSize: 23, cursor: "pointer" }}
          >
            {icon}
          </button>
        }
      />

      <form onSubmit={handleSubmit} style={{ paddingBottom: "var(--space-8)" }}>
        <Card style={{ marginBottom: "var(--space-3)" }}>
          <FormField label={t("profile.name")}>
            <TextInput required value={name} onChange={(event) => setName(event.target.value)} placeholder={t("profile.namePlaceholder")} autoComplete="name" />
          </FormField>

          {showIconPicker && (
            <div role="group" aria-label="Choose avatar" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "var(--space-2)", marginBottom: "var(--space-4)", padding: "var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)" }}>
              {PROFILE_ICONS.map((candidate) => (
                <button
                  type="button"
                  key={candidate}
                  onClick={() => { setIcon(candidate); setShowIconPicker(false); }}
                  aria-label={`Use ${candidate} as avatar`}
                  aria-pressed={icon === candidate}
                  className="profile-avatar-option"
                  style={{ width: 40, height: 40, display: "grid", placeItems: "center", justifySelf: "center", borderRadius: "50%", border: icon === candidate ? "2px solid var(--color-primary)" : "1px solid var(--color-border)", background: icon === candidate ? "var(--color-primary-subtle)" : "var(--color-surface)", color: "var(--color-text-primary)", boxShadow: "var(--shadow-control)", fontSize: 20, cursor: "pointer" }}
                >
                  {candidate}
                </button>
              ))}
            </div>
          )}

          <FormField label={t("profile.mood")}>
            <TextInput value={mood} onChange={(event) => setMood(event.target.value)} placeholder={t("profile.moodPlaceholder")} maxLength={40} />
          </FormField>

          <FormField label={t("profile.defaultMode")}>
            <SegmentedControl
              value={defaultMode}
              onChange={setDefaultMode}
              options={[
                { value: "challenge", label: t("common.challenge") },
                { value: "practice", label: t("common.practice") },
              ]}
            />
          </FormField>

          <FormField label={t("profile.theme")}>
            <SegmentedControl
              value={themePreference}
              onChange={(value) => { setThemePreference(value); applyThemePreference(value); }}
              options={themeOptions}
            />
          </FormField>

          <FormField label={t("profile.weekStarts")} last>
            <SegmentedControl
              value={weekStartsOn}
              onChange={setWeekStartsOn}
              options={[
                { value: 1, label: t("profile.monday") },
                { value: 0, label: t("profile.sunday") },
              ]}
            />
          </FormField>
        </Card>

        <Card style={{ marginBottom: "var(--space-3)", padding: 0, overflow: "hidden" }}>
          <ToggleRow icon={showStatsToOthers ? Unlock : Lock} label={t("profile.showStats")} description={showStatsToOthers ? t("profile.statsPublic") : t("profile.statsPrivate")} checked={showStatsToOthers} onChange={setShowStatsToOthers} />
          <ToggleRow icon={isPrivate ? Lock : Unlock} label={t("profile.private")} description={isPrivate ? t("profile.privateOn") : t("profile.privateOff")} checked={isPrivate} onChange={setIsPrivate} divided />
        </Card>

        <Card style={{ marginBottom: "var(--space-3)" }}>
          <SectionTitle icon={Languages}>{t("language.label")}</SectionTitle>
          <SegmentedControl
            value={language}
            onChange={setLanguage}
            options={[
              { value: "en", label: `🇬🇧 ${t("language.english")}` },
              { value: "sk", label: `🇸🇰 ${t("language.slovak")}` },
            ]}
          />
          <p style={{ margin: "var(--space-2) 0 0", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", lineHeight: "var(--text-body-line)" }}>{t("language.autoHint")}</p>
        </Card>

        {!isFirstTime && (
          <Card style={{ marginBottom: "var(--space-3)" }}>
            <SectionTitle icon={Link2}>Sign-in methods</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {identities.map((identity) => {
                const provider = identity.provider || identity.identity_data?.provider || "email";
                const label = provider === "google" ? "Google" : "Email";
                const detail = identity.identity_data?.email || user?.email || "Connected";
                return (
                  <div key={identity.id} style={{ minHeight: 52, display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)" }}>
                    {provider === "email" ? <Mail size={17} style={{ color: "var(--color-icon-subtle)" }} /> : <span aria-hidden="true" style={{ fontWeight: 700, color: "var(--color-primary)" }}>G</span>}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: "block", color: "var(--color-text-primary)", fontSize: "var(--text-body-secondary-size)" }}>{label}</strong>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>{detail}</span>
                    </span>
                    {identities.length > 1 && <Button variant="icon" disabled={identityBusy} onClick={() => handleUnlinkIdentity(identity)} aria-label={`Unlink ${label}`} style={{ color: "var(--color-danger-text)" }}><Unlink size={16} /></Button>}
                  </div>
                );
              })}
            </div>
            {!identities.some((identity) => (identity.provider || identity.identity_data?.provider) === "google") && <Button variant="secondary" fullWidth loading={identityBusy} onClick={handleLinkGoogle} style={{ marginTop: "var(--space-3)" }}>{identityBusy ? "Connecting…" : "Connect Google"}</Button>}
            <p style={{ margin: "var(--space-2) 0 0", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", lineHeight: "var(--text-body-line)" }}>Google can be linked to this player. Changing the primary email is a separate action.</p>
            {identityError && <StatusBanner variant="error" style={{ marginTop: "var(--space-3)" }}>{identityError}</StatusBanner>}
          </Card>
        )}

        {!isFirstTime && passkeySupported && (
          <Card style={{ marginBottom: "var(--space-3)" }}>
            <SectionTitle icon={Fingerprint}>Passkeys</SectionTitle>
            {passkeys.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                {passkeys.map((passkey) => (
                  <div key={passkey.id} style={{ minHeight: 48, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)" }}>
                    <span style={{ color: "var(--color-text-primary)", fontSize: "var(--text-body-secondary-size)" }}>{passkey.friendly_name || "Passkey"}</span>
                    <Button variant="icon" onClick={() => handleDeletePasskey(passkey.id)} aria-label={`Delete ${passkey.friendly_name || "passkey"}`} style={{ color: "var(--color-danger-text)" }}><Trash2 size={16} /></Button>
                  </div>
                ))}
              </div>
            )}
            <Button variant="secondary" before={<Plus size={16} />} loading={passkeyBusy} onClick={handleAddPasskey}>{passkeyBusy ? "Waiting for device…" : "Add a passkey"}</Button>
            {passkeyError && <StatusBanner variant="error" style={{ marginTop: "var(--space-3)" }}>{passkeyError}</StatusBanner>}
          </Card>
        )}

        {!isFirstTime && onOpenCircles && <Button type="button" variant="secondary" fullWidth before={<Users size={17} />} onClick={onOpenCircles} style={{ marginBottom: "var(--space-3)" }}>{t("profile.circles")}</Button>}
        {error && <StatusBanner variant="error" style={{ marginBottom: "var(--space-3)" }}>{error}</StatusBanner>}
        <Button type="submit" fullWidth loading={saving} disabled={!name.trim()}>{saving ? t("profile.saving") : isFirstTime ? t("profile.start") : t("profile.save")}</Button>
      </form>

      {!isFirstTime && <div style={{ marginTop: "var(--space-4)" }}><AccountSafety /></div>}

      <style>{`
        .profile-avatar-button:focus-visible,
        .profile-avatar-option:focus-visible,
        .profile-segment-button:focus-visible,
        .profile-toggle-row:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        @media (max-width: 380px) {
          .profile-segment-label { font-size: 12px !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .profile-switch-thumb { transition: none !important; }
        }
      `}</style>
    </Page>
  );
}

function FormField({ label, children, last = false }) {
  return (
    <label style={{ display: "block", marginBottom: last ? 0 : "var(--space-4)" }}>
      <span style={{ display: "block", marginBottom: "var(--space-2)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)", fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

function SegmentedControl({ value, onChange, options }) {
  return (
    <div role="group" style={{ display: "grid", gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, gap: 2, padding: 3, border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)" }}>
      {options.map(({ value: optionValue, label, Icon }) => {
        const selected = value === optionValue;
        return (
          <button
            type="button"
            key={optionValue}
            onClick={() => onChange(optionValue)}
            aria-pressed={selected}
            className="profile-segment-button"
            style={{ minHeight: "var(--control-height-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0 var(--space-2)", border: selected ? "1px solid var(--color-primary-subtle-border)" : "1px solid transparent", borderRadius: "var(--radius-sm)", background: selected ? "var(--color-surface)" : "transparent", boxShadow: selected ? "var(--shadow-control)" : "none", color: selected ? "var(--color-primary)" : "var(--color-text-secondary)", font: "inherit", fontSize: "var(--text-body-secondary-size)", fontWeight: 600, cursor: "pointer" }}
          >
            {Icon && <Icon size={15} />}
            <span className="profile-segment-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({ icon: Icon, label, description, checked, onChange, divided = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="profile-toggle-row"
      style={{ width: "100%", minHeight: 68, display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)", border: 0, borderTop: divided ? "1px solid var(--color-border)" : 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
    >
      <Icon size={18} style={{ flexShrink: 0, color: checked ? "var(--color-primary)" : "var(--color-icon-subtle)" }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: "block", color: "var(--color-text-primary)", fontSize: "var(--text-body-size)", fontWeight: 600 }}>{label}</strong>
        <span style={{ display: "block", marginTop: 2, color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", lineHeight: 1.4 }}>{description}</span>
      </span>
      <span aria-hidden="true" style={{ width: 42, height: 24, position: "relative", flexShrink: 0, borderRadius: "var(--radius-full)", background: checked ? "var(--color-primary)" : "var(--color-disabled-bg)", transition: "background var(--transition-fast)" }}>
        <span className="profile-switch-thumb" style={{ width: 20, height: 20, position: "absolute", top: 2, left: checked ? 20 : 2, borderRadius: "50%", background: "var(--color-primary-text)", boxShadow: "var(--shadow-control)", transition: "left var(--transition-fast)" }} />
      </span>
    </button>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h2 style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", margin: "0 0 var(--space-3)", color: "var(--color-text-primary)", fontSize: "var(--text-section-title-size)", fontWeight: "var(--text-section-title-weight)" }}>
      <Icon size={18} style={{ color: "var(--color-primary)" }} />
      {children}
    </h2>
  );
}
