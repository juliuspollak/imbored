import React, { useEffect, useMemo, useState } from "react";
import { COUNTRIES } from "../geo/geoData.js";

const MAP_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const OPTION_STYLES = [
  { fill: "#93c5fd", stroke: "#3b82f6", text: "#1e3a8a" },
  { fill: "#fcd34d", stroke: "#f59e0b", text: "#92400e" },
];
const WIDTH = 360;
const HEIGHT = 210;
const PADDING = 14;

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

const COUNTRY_BY_NAME = new Map(
  COUNTRIES
    .filter((country) => country.name)
    .map((country) => [country.name.toLowerCase(), country])
);

function featureIso2(feature) {
  const props = feature?.properties || {};
  const values = [props.ISO_A2_EH, props.ISO_A2, props.WB_A2, props.POSTAL];
  return values.find((value) => typeof value === "string" && /^[A-Z]{2}$/.test(value)) || null;
}

function appCountryForFeature(feature) {
  const iso2 = featureIso2(feature);
  return iso2 ? COUNTRY_BY_ISO2.get(iso2) : null;
}

function wrappedLongitude(lon, continent) {
  if (continent === "Oceania" && lon < 60) return lon + 360;
  return lon;
}

function mercatorY(lat) {
  const clamped = Math.max(-82, Math.min(82, lat));
  const radians = clamped * Math.PI / 180;
  return (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function walkCoordinates(geometry, callback) {
  if (!geometry) return;
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];

  polygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach(callback)));
}

function makeProjection(features, continent) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  features.forEach((feature) => {
    walkCoordinates(feature.geometry, ([lon, lat]) => {
      const x = wrappedLongitude(lon, continent);
      const y = mercatorY(lat);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });
  });

  if (!Number.isFinite(minX) || minX === maxX || minY === maxY) return null;

  const xPad = Math.max((maxX - minX) * 0.12, 1.5);
  const yPad = Math.max((maxY - minY) * 0.12, 1.5);
  minX -= xPad;
  maxX += xPad;
  minY -= yPad;
  maxY += yPad;

  const usableWidth = WIDTH - PADDING * 2;
  const usableHeight = HEIGHT - PADDING * 2;
  const scale = Math.min(usableWidth / (maxX - minX), usableHeight / (maxY - minY));
  const drawnWidth = (maxX - minX) * scale;
  const drawnHeight = (maxY - minY) * scale;
  const offsetX = (WIDTH - drawnWidth) / 2;
  const offsetY = (HEIGHT - drawnHeight) / 2;

  return ([lon, lat]) => [
    offsetX + (wrappedLongitude(lon, continent) - minX) * scale,
    offsetY + (maxY - mercatorY(lat)) * scale,
  ];
}

function geometryToPath(geometry, project) {
  if (!geometry || !project) return "";
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];

  return polygons.map((polygon) => (
    polygon.map((ring) => {
      if (!ring?.length) return "";
      const points = ring.map(project);
      return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} Z`;
    }).join(" ")
  )).join(" ");
}

function countryStyle(countryName, optionCountries, answered, selectedCountry, correctCountry) {
  const optionIndex = optionCountries.indexOf(countryName);
  const isOption = optionIndex >= 0;
  const selectedWrong = answered && selectedCountry === countryName && selectedCountry !== correctCountry;
  const correct = answered && correctCountry === countryName;

  if (correct) return { fill: "#86efac", stroke: "#16a34a", text: "#166534" };
  if (selectedWrong) return { fill: "#fca5a5", stroke: "#dc2626", text: "#991b1b" };
  if (answered) return { fill: "#e5e7eb", stroke: "#cbd5e1", text: "#64748b" };
  if (isOption) return OPTION_STYLES[optionIndex % OPTION_STYLES.length];
  return { fill: "#e5e7eb", stroke: "#cbd5e1", text: "#94a3b8" };
}

export default function ZoomCountryMap({
  continent,
  subregion,
  optionCountries = [],
  answered = false,
  selectedCountry,
  correctCountry,
  labelFor = (value) => value,
  compact = false,
}) {
  const [geoJson, setGeoJson] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);

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

  const optionEntries = useMemo(() => (
    optionCountries
      .map((name) => COUNTRY_BY_NAME.get(String(name).toLowerCase()))
      .filter(Boolean)
  ), [optionCountries]);

  const mapFeatures = useMemo(() => {
    if (!geoJson?.features) return [];
    return geoJson.features.filter((feature) => {
      const country = appCountryForFeature(feature);
      return country?.continent === continent && country?.subregion === subregion;
    });
  }, [geoJson, continent, subregion]);

  const focusFeatures = useMemo(() => {
    if (!mapFeatures.length) return [];
    const optionIso2 = new Set(optionEntries.map((country) => country.iso2?.toUpperCase()).filter(Boolean));
    const options = mapFeatures.filter((feature) => optionIso2.has(featureIso2(feature)));
    return options.length ? mapFeatures : options;
  }, [mapFeatures, optionEntries]);

  const project = useMemo(() => makeProjection(focusFeatures.length ? focusFeatures : mapFeatures, continent), [focusFeatures, mapFeatures, continent]);

  if (!optionCountries.length) return null;

  return (
    <div
      className="zoom-country-map"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        background: "linear-gradient(180deg, #f6fbff 0%, #eaf5ff 100%)",
        padding: compact ? "5px" : "8px 8px 10px",
        overflow: "hidden",
      }}
    >
      {!geoJson && !loadFailed && (
        <div style={{ height: compact ? 118 : 170, display: "grid", placeItems: "center", color: "var(--color-text-muted)", fontSize: 11 }}>
          Loading map…
        </div>
      )}

      {loadFailed && (
        <div style={{ height: compact ? 90 : 120, display: "grid", placeItems: "center", color: "var(--color-text-muted)", fontSize: 11 }}>
          Map unavailable
        </div>
      )}

      {geoJson && project && (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${labelFor(subregion)} countries`}
          style={{ width: "100%", height: compact ? 122 : 184, display: "block", overflow: "hidden" }}
        >
          <g>
            {mapFeatures.map((feature, index) => {
              const iso2 = featureIso2(feature) || `feature-${index}`;
              const country = appCountryForFeature(feature);
              const countryName = country?.name || "";
              const style = countryStyle(countryName, optionCountries, answered, selectedCountry, correctCountry);

              return (
                <path
                  key={`${iso2}-${index}`}
                  d={geometryToPath(feature.geometry, project)}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={answered && (countryName === correctCountry || countryName === selectedCountry) ? 1.8 : 0.9}
                  strokeLinejoin="round"
                  fillRule="evenodd"
                  vectorEffect="non-scaling-stroke"
                  style={{ transition: "fill 180ms ease, stroke 180ms ease" }}
                />
              );
            })}
          </g>
        </svg>
      )}

      {!compact && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(optionCountries.length, 2)}, minmax(0, 1fr))`,
            gap: 6,
            padding: "2px 2px 0",
          }}
        >
          {optionCountries.map((countryName) => {
            const style = countryStyle(countryName, optionCountries, answered, selectedCountry, correctCountry);
            return (
              <div
                key={countryName}
                style={{
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 7px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.82)",
                  border: `1px solid ${style.stroke}`,
                  color: style.text,
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 999, flex: "0 0 auto", background: style.fill, border: `1px solid ${style.stroke}` }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{labelFor(countryName)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
