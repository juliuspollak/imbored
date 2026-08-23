import React, { useEffect, useMemo, useState } from "react";
import { COUNTRIES } from "../geo/geoData.js";

const MAP_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const OPTION_STYLES = [
  { fill: "#93c5fd", stroke: "#3b82f6", text: "#1e3a8a" },
  { fill: "#fcd34d", stroke: "#f59e0b", text: "#92400e" },
];
const NEUTRAL = { fill: "#e5e7eb", stroke: "#cbd5e1", text: "#94a3b8" };
const WIDTH = 360;
const HEIGHT = 230;
const PADDING_X = 10;
const PADDING_Y = 10;

const CONTINENT_BOUNDS = {
  Africa: { minLon: -20, maxLon: 55, minLat: -36, maxLat: 38 },
  Asia: { minLon: 25, maxLon: 150, minLat: -12, maxLat: 78 },
  Europe: { minLon: -25, maxLon: 45, minLat: 34, maxLat: 72 },
  "North America": { minLon: -170, maxLon: -50, minLat: 5, maxLat: 84 },
  "South America": { minLon: -85, maxLon: -32, minLat: -58, maxLat: 15 },
  Oceania: { minLon: 110, maxLon: 180, minLat: -50, maxLat: 10 },
};

let geoJsonPromise;

function loadGeoJson() {
  if (!geoJsonPromise) {
    geoJsonPromise = fetch(MAP_URL).then((response) => {
      if (!response.ok) throw new Error(`Map request failed: ${response.status}`);
      return response.json();
    });
  }
  return geoJsonPromise;
}

const COUNTRY_BY_ISO2 = new Map(
  COUNTRIES
    .filter((country) => country.iso2)
    .map((country) => [country.iso2.toUpperCase(), country])
);

function featureIso2(feature) {
  const props = feature?.properties || {};
  const values = [props.ISO_A2_EH, props.ISO_A2, props.WB_A2, props.POSTAL];
  return values.find((value) => typeof value === "string" && /^[A-Z]{2}$/.test(value)) || null;
}

function continentForFeature(feature) {
  // At continent level use Natural Earth's atlas classification first. This
  // avoids painting all of transcontinental countries (most visibly Russia)
  // as one continent just because the quiz-country record has one continent
  // value. It also prevents Russia wrapping across the dateline as a stray
  // piece of "Europe" on the far-left edge of the world map.
  const natural = feature?.properties?.CONTINENT;
  if (["Africa", "Asia", "Europe", "North America", "South America", "Oceania"].includes(natural)) {
    return natural;
  }

  const iso2 = featureIso2(feature);
  const appCountry = iso2 ? COUNTRY_BY_ISO2.get(iso2) : null;
  return appCountry?.continent || null;
}

function mercatorY(lat) {
  const clamped = Math.max(-60, Math.min(82, lat));
  const radians = clamped * Math.PI / 180;
  return (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

const WORLD_MIN_Y = mercatorY(-60);
const WORLD_MAX_Y = mercatorY(82);

function worldProject([lon, lat]) {
  return [
    PADDING_X + ((lon + 180) / 360) * (WIDTH - PADDING_X * 2),
    PADDING_Y + ((WORLD_MAX_Y - mercatorY(lat)) / (WORLD_MAX_Y - WORLD_MIN_Y)) * (HEIGHT - PADDING_Y * 2),
  ];
}

function focusBoundsFor(options) {
  if (options.length !== 2) return null;
  const first = CONTINENT_BOUNDS[options[0]];
  const second = CONTINENT_BOUNDS[options[1]];
  if (!first || !second) return null;

  const combined = {
    minLon: Math.min(first.minLon, second.minLon),
    maxLon: Math.max(first.maxLon, second.maxLon),
    minLat: Math.min(first.minLat, second.minLat),
    maxLat: Math.max(first.maxLat, second.maxLat),
  };

  const lonSpan = combined.maxLon - combined.minLon;
  const latSpan = combined.maxLat - combined.minLat;

  if (lonSpan > 190 || latSpan > 145) return null;

  const lonPad = Math.max(5, lonSpan * 0.045);
  const latPad = Math.max(4, latSpan * 0.045);
  return {
    minLon: Math.max(-180, combined.minLon - lonPad),
    maxLon: Math.min(180, combined.maxLon + lonPad),
    minLat: Math.max(-60, combined.minLat - latPad),
    maxLat: Math.min(82, combined.maxLat + latPad),
  };
}

function makeFocusedProject(bounds) {
  if (!bounds) return worldProject;

  const usableWidth = WIDTH - PADDING_X * 2;
  const usableHeight = HEIGHT - PADDING_Y * 2;
  const xSpan = bounds.maxLon - bounds.minLon;
  const ySpan = bounds.maxLat - bounds.minLat;
  const scale = Math.min(usableWidth / xSpan, usableHeight / ySpan);
  const drawnWidth = xSpan * scale;
  const drawnHeight = ySpan * scale;
  const offsetX = (WIDTH - drawnWidth) / 2;
  const offsetY = (HEIGHT - drawnHeight) / 2;

  return ([lon, lat]) => [
    offsetX + (lon - bounds.minLon) * scale,
    offsetY + (bounds.maxLat - lat) * scale,
  ];
}

function ringToPath(ring, project) {
  if (!ring?.length) return "";

  let path = "";
  let previousLon = null;
  ring.forEach((point) => {
    const [lon] = point;
    const [x, y] = project(point);
    const startNew = previousLon !== null && Math.abs(lon - previousLon) > 180;
    path += `${path === "" || startNew ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
    previousLon = lon;
  });
  return `${path}Z`;
}

function geometryToPath(geometry, project) {
  if (!geometry) return "";
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];

  return polygons
    .map((polygon) => polygon.map((ring) => ringToPath(ring, project)).join(" "))
    .join(" ");
}

function continentStyle(continent, options, answered, selectedContinent, correctContinent) {
  const optionIndex = options.indexOf(continent);
  const selectedWrong = answered && selectedContinent === continent && selectedContinent !== correctContinent;
  const correct = answered && correctContinent === continent;

  if (correct) return { fill: "#86efac", stroke: "#16a34a", text: "#166534" };
  if (selectedWrong) return { fill: "#fca5a5", stroke: "#dc2626", text: "#991b1b" };
  if (answered) return NEUTRAL;
  if (optionIndex >= 0) return OPTION_STYLES[optionIndex % OPTION_STYLES.length];
  return NEUTRAL;
}

export default function ZoomContinentMap({
  optionContinents = [],
  answered = false,
  selectedContinent,
  correctContinent,
  compact = false,
}) {
  const [geoJson, setGeoJson] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const visibleOptions = optionContinents.filter(Boolean).slice(0, 2);

  useEffect(() => {
    let cancelled = false;
    loadGeoJson()
      .then((data) => {
        if (!cancelled) setGeoJson(data);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  const focusBounds = useMemo(() => focusBoundsFor(visibleOptions), [visibleOptions.join("|")]);
  const isFocused = Boolean(focusBounds);

  const features = useMemo(() => {
    if (!geoJson?.features) return [];
    return geoJson.features.filter((feature) => {
      const continent = continentForFeature(feature);
      if (!continent) return false;
      return !isFocused || visibleOptions.includes(continent);
    });
  }, [geoJson, isFocused, visibleOptions.join("|")]);

  const project = useMemo(() => makeFocusedProject(focusBounds), [focusBounds]);

  return (
    <div
      className="zoom-continent-map"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        background: "linear-gradient(180deg, #f6fbff 0%, #eaf5ff 100%)",
        padding: compact ? "5px" : "8px 8px 10px",
        overflow: "hidden",
      }}
    >
      {!answered && (
        <style>{`
          .zoom-answer-grid .zoom-option:nth-child(1):not(:disabled) {
            background: ${OPTION_STYLES[0].fill} !important;
            border-color: ${OPTION_STYLES[0].stroke} !important;
            color: ${OPTION_STYLES[0].text} !important;
          }
          .zoom-answer-grid .zoom-option:nth-child(2):not(:disabled) {
            background: ${OPTION_STYLES[1].fill} !important;
            border-color: ${OPTION_STYLES[1].stroke} !important;
            color: ${OPTION_STYLES[1].text} !important;
          }
        `}</style>
      )}

      {!geoJson && !loadFailed && (
        <div style={{ height: compact ? 104 : 188, display: "grid", placeItems: "center", color: "var(--color-text-muted)", fontSize: 11 }}>
          Loading map…
        </div>
      )}

      {loadFailed && (
        <div style={{ height: compact ? 82 : 120, display: "grid", placeItems: "center", color: "var(--color-text-muted)", fontSize: 11 }}>
          Map unavailable
        </div>
      )}

      {geoJson && (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={isFocused ? "Map showing the two continent choices" : "World map showing the two continent choices"}
          style={{ width: "100%", height: compact ? 120 : 198, display: "block", overflow: "hidden" }}
        >
          {features.map((feature, index) => {
            const continent = continentForFeature(feature);
            const style = continentStyle(continent, visibleOptions, answered, selectedContinent, correctContinent);
            const iso2 = featureIso2(feature) || `feature-${index}`;
            return (
              <path
                key={`${iso2}-${index}`}
                d={geometryToPath(feature.geometry, project)}
                fill={style.fill}
                stroke="none"
                strokeLinejoin="round"
                fillRule="evenodd"
                style={{ transition: "fill 180ms ease" }}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
