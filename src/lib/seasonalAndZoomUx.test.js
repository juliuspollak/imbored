import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const zoom = readFileSync(new URL("../games/Zoom.jsx", import.meta.url), "utf8");
const continent = readFileSync(new URL("../games/zoom/ZoomContinentMap.jsx", import.meta.url), "utf8");
const region = readFileSync(new URL("../games/zoom/ZoomRegionMap.jsx", import.meta.url), "utf8");
const country = readFileSync(new URL("../games/zoom/ZoomCountryMap.jsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../AdminGames.jsx", import.meta.url), "utf8");
const seasonal = readFileSync(new URL("./seasonalTheme.js", import.meta.url), "utf8");
const seasonalCss = readFileSync(new URL("../seasonal-theme.css", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/202610080700_seasonal_theme_settings.sql", import.meta.url), "utf8");

test("Zoom passes the existing answer handler into every map level", () => {
  assert.equal((zoom.match(/onSelect=\{pick\}/g) || []).length, 3);
});

test("Zoom map paths only answer when the highlighted option is still active", () => {
  assert.match(continent, /onClick=\{!answered && visibleOptions\.includes\(continent\) && onSelect/);
  assert.match(region, /onClick=\{!answered && style\.option && region && onSelect/);
  assert.match(country, /onClick=\{!answered && style\.option && onSelect/);
  assert.match(continent, /cursor: !answered/);
  assert.match(region, /cursor: !answered/);
  assert.match(country, /cursor: !answered/);
});

test("seasonal theme is admin controlled and date bounded", () => {
  assert.match(admin, /Seasonal theme/);
  assert.match(admin, /value="halloween"/);
  assert.match(admin, /seasonal_start_date/);
  assert.match(admin, /seasonal_end_date/);
  assert.match(seasonal, /effectiveSeasonalTheme/);
  assert.match(seasonal, /today < settings\.seasonal_start_date/);
  assert.match(seasonal, /today > settings\.seasonal_end_date/);
});

test("Halloween styling is decorative across Home and game cards", () => {
  assert.match(seasonalCss, /data-seasonal-theme="halloween"/);
  assert.match(seasonalCss, /seasonal-home-title::after/);
  assert.match(seasonalCss, /\.hive-bee-halloween/);
  assert.match(seasonalCss, /\.twist-halloween-face/);
  assert.match(seasonalCss, /seasonal-game-accent--gridly/);
  assert.match(seasonalCss, /seasonal-game-accent--minisudoku/);
  assert.match(seasonalCss, /seasonal-game-accent--geo/);
  assert.match(seasonalCss, /seasonal-game-accent--zoom/);
});

test("seasonal settings are publicly readable but admin writable", () => {
  assert.match(migration, /seasonal_theme in \('off', 'halloween'\)/);
  assert.match(migration, /to anon, authenticated/);
  assert.match(migration, /profiles\.is_admin = true/);
});
