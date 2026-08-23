import React, { useEffect, useMemo, useState } from "react";
import { COUNTRIES } from "../geo/geoData.js";
import { SUBREGIONS_BY_CONTINENT } from "../geo/geoSubregions.js";

// 50m keeps real Natural Earth geometry while retaining smaller islands.
const MAP_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";
const OPTION_STYLES = [
  { fill: "#93c5fd", stroke: "#3b82f6", text: "#1e3a8a" },
  { fill: "#fcd34d", stroke: "#f59e0b", text: "#92400e" },
];
const NEUTRAL = { fill: "#e5e7eb", stroke: "#cbd5e1", text: "#94a3b8" };
const WIDTH = 360;
const HEIGHT = 210;
const PADDING_X = 8;
const PADDING_Y = 7;

// Region questions should always preserve the whole continent for orientation.
// The candidate regions are highlighted inside this stable continent view.
const CONTINENT_BOUNDS = {
  Europe: { minLon: -25, maxLon: 45, minLat: 34, maxLat: 72 },
  Africa: { minLon: -20, maxLon: 55, minLat: -36, maxLat: 38 },
  Asia: { minLon: 25, maxLon: 150, minLat: -12, maxLat: 78 },
  "North America": { minLon: -170, maxLon: -50, minLat: 5, maxLat: 84 },
  "South America": { minLon: -85, maxLon: -32, minLat: -58, maxLat: 15 },
  Oceania: { minLon: 110, maxLon: 205, minLat: -50, maxLat: 12 },
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

function appCountryForFeature(feature) {
  const iso2 = featureIso2(feature);
  return iso2 ? COUNTRY_BY_ISO2.get(iso2) : null;
}

function naturalContinentForFeature(feature) {
  const value = feature?.properties?.CONTINENT;
  return ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"].includes(value)
    ? value
    : null;
}

function continentForFeature(feature) {
  return appCountryForFeature(feature)?.continent || naturalContinentForFeature(feature);
}

function regionForFeature(feature, continent) {
  const appCountry = appCountryForFeature(feature);
  return appCountry?.continent === continent ? appCountry.subregion : null;
}

function wrappedLongitude(lon, continent) {
  if (continent === "Oceania" && lon < 60) return lon + 360;
  return lon;
}

// A simple geographic fit gives players the familiar atlas-like continent
// silhouette and avoids Mercator shrinking/distorting high-latitude regions.
function makeProjection(continent) {
  const bounds = CONTINENT_BOUNDS[continent];
  if (!bounds) return null;

  const minX = wrappedLongitude(bounds.minLon, continent);
  const maxX = wrappedLongitude(bounds.maxLon, continent);
  const minY = bounds.minLat;
  const maxY = bounds.maxLat;
  const usableWidth = WIDTH - PADDING_X * 2;
  const usableHeight = HEIGHT - PADDING_Y * 2;
  const scale = Math.min(usableWidth / (maxX - minX), usableHeight / (maxY - minY));
  const drawnWidth = (maxX - minX) * scale;
  const drawnHeight = (maxY - minY) * scale;
  const offsetX = (WIDTH - drawnWidth) / 2;
  const offsetY = (HEIGHT - drawnHeight) / 2;

  return ([lon, lat]) => [
    offsetX + (wrappedLongitude(lon, continent) - minX) * scale,
    offsetY + (maxY - lat) * scale,
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

function regionStyle(region, optionRegions, answered, selectedRegion, correctRegion) {
  const optionIndex = optionRegions.indexOf(region);
  const selectedWrong = answered && selectedRegion === region && selectedRegion !== correctRegion;
  const correct = answered && correctRegion === region;

  if (correct) return { fill: "#86efac", stroke: "#16a34a", text: "#166534", option: true };
  if (selectedWrong) return { fill: "#fca5a5", stroke: "#dc2626", text: "#991b1b", option: true };
  if (answered) return { ...NEUTRAL, option: false };
  if (optionIndex >= 0) return { ...OPTION_STYLES[optionIndex % OPTION_STYLES.length], option: true };
  return { ...NEUTRAL, option: false };
}

function islandMarker(feature, project, continent) {
  if (continent !== "Oceania" || !project) return null;
  const props = feature?.properties || {};
  const lon = Number(props.LABEL_X);
  const lat = Number(props.LABEL_Y);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const country = appCountryForFeature(feature);
  if (!country || ["AU", "PG", "NZ"].includes(country.iso2?.toUpperCase())) return null;

  return project([lon, lat]);
}

export default function ZoomRegionMap({
  continent,
  optionRegions = [],
  answered = false,
  selectedRegion,
  correctRegion,
  labelFor = (value) => value,
  compact = false,
}) {
  const [geoJson, setGeoJson] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const allRegions = SUBREGIONS_BY_CONTINENT[continent] || [];
  const visibleOptions = optionRegions.filter((region) => allRegions.includes(region));

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

  const mapFeatures = useMemo(() => {
    if (!geoJson?.features) return [];
    // Use Natural Earth's continent membership as the fallback so countries
    // that are not quiz targets still appear and the continent never has holes.
    return geoJson.features.filter((feature) => continentForFeature(feature) === continent);
  }, [geoJson, continent]);

  const project = useMemo(() => makeProjection(continent), [continent]);

  if (!allRegions.length) return null;

  return (
    <div
      className="zoom-region-map"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        background: "linear-gradient(180deg, #f6fbff 0%, #eaf5ff 100%)",
        padding: compact ? "5px" : "6px 8px 9px",
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
        <div style={{ height: compact ? 118 : 178, display: "grid", placeItems: "center", color: "var(--color-text-muted)", fontSize: 11 }}>
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
          aria-label={`${labelFor(continent)} regions`}
          style={{ width: "100%", height: compact ? 126 : 194, display: "block", overflow: "hidden" }}
        >
          <g>
            {mapFeatures.map((feature, index) => {
              const iso2 = featureIso2(feature) || `feature-${index}`;
              const region = regionForFeature(feature, continent);
              const style = regionStyle(region, visibleOptions, answered, selectedRegion, correctRegion);
              const marker = islandMarker(feature, project, continent);

              return (
                <React.Fragment key={`${iso2}-${index}`}>
                  <path
                    d={geometryToPath(feature.geometry, project)}
                    fill={style.fill}
                    stroke={style.option ? "rgba(255,255,255,0.62)" : "rgba(203,213,225,0.55)"}
                    strokeWidth={style.option ? 0.48 : 0.34}
                    strokeLinejoin="round"
                    fillRule="evenodd"
                    vectorEffect="non-scaling-stroke"
                    style={{ transition: "fill 180ms ease" }}
                  />
                  {marker && (
                    <circle
                      cx={marker[0]}
                      cy={marker[1]}
                      r={compact ? 1.7 : 2.5}
                      fill={style.fill}
                      stroke={style.option ? style.stroke : "#cbd5e1"}
                      strokeWidth={0.8}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </React.Fragment>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
