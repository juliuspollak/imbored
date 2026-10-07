import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { attachRealtimeRefresh } from "./realtimeRefresh.js";

export const SEASONAL_THEMES = {
  off: { id: "off", label: "Off" },
  halloween: { id: "halloween", label: "Halloween" },
};

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function effectiveSeasonalTheme(settings, today = localDateString()) {
  const theme = settings?.seasonal_theme || "off";
  if (!SEASONAL_THEMES[theme] || theme === "off") return "off";
  if (settings?.seasonal_start_date && today < settings.seasonal_start_date) return "off";
  if (settings?.seasonal_end_date && today > settings.seasonal_end_date) return "off";
  return theme;
}

export async function fetchSeasonalSettings() {
  if (!supabaseReady) return null;
  const { data, error } = await supabase
    .from("app_settings")
    .select("seasonal_theme,seasonal_start_date,seasonal_end_date")
    .eq("id", true)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

export function SeasonalThemeSync() {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const next = await fetchSeasonalSettings();
      if (!cancelled) setSettings(next);
    }

    void refresh();
    if (!supabaseReady) return () => { cancelled = true; };

    const detach = attachRealtimeRefresh({
      channelName: "app-seasonal-theme",
      tables: [{ name: "app_settings" }],
      refresh,
      fallbackMs: 60000,
    });

    return () => {
      cancelled = true;
      detach();
    };
  }, []);

  useEffect(() => {
    const theme = effectiveSeasonalTheme(settings);
    document.documentElement.dataset.seasonalTheme = theme;
    return () => {
      if (document.documentElement.dataset.seasonalTheme === theme) {
        document.documentElement.dataset.seasonalTheme = "off";
      }
    };
  }, [settings]);

  return null;
}
