import React, { useEffect, useMemo, useState } from "react";
import { COUNTRIES } from "../geo/geoData.js";
import { SUBREGIONS_BY_CONTINENT } from "../geo/geoSubregions.js";

const MAP_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const REGION_FILLS = ["#dbeafe", "#dcfce7", "#ede9fe", "#fef3c7", "#fee2e2"];
const WIDTH = 360;
const HEIGHT = 210;
const PADDING = 10;

// Use the visible geographic extent of each continent rather than the full
// bounds of every MultiPolygon in a country. This prevents overseas pieces
// (for example French Guiana on France's Natural Earth geometry) from making
// the mainland map tiny.
const CONTINENT_BOUNDS = {
  Europe: { minLon: -25, maxLon: 45, minLat: 34, maxLat: 72 },
  Africa: { minLon: -20, maxLon: 55, minLat: -36, maxLat: 38 },
  Asia: { minLon: 25, maxLon: 150, minLat: -12, maxLat: 78 },
  "North America": { minLon: -170, maxLon: -50, minLat: 5, maxLat: 84 },
  "South America": { minLon: -85, maxLon: -32, minLat: -58, maxLat: 15 },
  Oceania: { minLon: 110, maxLon: 205, minLat: -50, maxLat: 10 },
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

function regionForFeature(feature, continent) {
  const iso2 = featureIso2(feature);
  const appCountry = iso2 ? COUNTRY_BY_ISO2.get(iso2) : null;
  return appCountry?.continent === continent ? appCountry.subregion : null;
}

function featureBelongsToContinent(feature, continent) {
  const iso2 = featureIso2(feature);
  const appCountry = iso2 ? COUNTRY_BY_ISO2.get(iso2) : null;
  return appCountry?.continent === continent;
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

function makeProjection(continent) {
  const bounds = CONTINENT_BOUNDS[continent];
  if (!bounds) return null;

  const minX = wrappedLongitude(bounds.minLon, continent);
  const maxX = wrappedLongitude(bounds.maxLon, continent);
  const minY = mercatorY(bounds.minLat);
  const maxY = mercatorY(bounds.maxLat);
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

function regionStyle(region, index, answered, selectedRegion, correctRegion) {
  const selectedWrong = answered && selectedRegion === region && selectedRegion !== correctRegion;
  const correct = answered && correctRegion === region;

  if (correct) return { fill: "#bbf7d0", stroke: "#16a34a", text: "#166534" };
  if (selectedWrong) return { fill: "#fecaca", stroke: "#ef4444", text: "#991b1b" };
  if (answered) return { fill: "#e5edf5", stroke: "#cbd5e1", text: "#64748b" };
  return { fill: REGION_FILLS[index % REGION_FILLS.length], stroke: "#ffffff", text: "#334155" };
}

export default function ZoomRegionMap({
  continent,
  answered = false,
  selectedRegion,
  correctRegion,
  labelFor = (value) => value,
  compact = false,
}) {
  const [geoJson, setGeoJson] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const regions = SUBREGIONS_BY_CONTINENT[continent] || [];

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
    return geoJson.features.filter((feature) => featureBelongsToContinent(feature, continent));
  }, [geoJson, continent]);

  const project = useMemo(() => makeProjection(continent), [continent]);

  if (!regions.length) return null;

  return (
    <div
      className="zoom-region-map"
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
          aria-label={`${labelFor(continent)} regions`}
          style={{ width: "100%", height: compact ? 122 : 184, display: "block", overflow: "hidden" }}
        >
          <g>
            {mapFeatures.map((feature, index) => {
              const iso2 = featureIso2(feature) || `feature-${index}`;
              const region = regionForFeature(feature, continent);
              const regionIndex = Math.max(0, regions.indexOf(region));
              const style = regionStyle(region, regionIndex, answered, selectedRegion, correctRegion);

              return (
                <path
                  key={`${iso2}-${index}`}
                  d={geometryToPath(feature.geometry, project)}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={answered && (region === correctRegion || region === selectedRegion) ? 1.6 : 0.8}
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
            gridTemplateColumns: regions.length <= 3 ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))",
            gap: 6,
            padding: "2px 2px 0",
          }}
        >
          {regions.map((region, index) => {
            const style = regionStyle(region, index, answered, selectedRegion, correctRegion);
            return (
              <div
                key={region}
                style={{
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 7px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.72)",
                  border: "1px solid rgba(148,163,184,0.22)",
                  color: style.text,
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 999, flex: "0 0 auto", background: style.fill, border: `1px solid ${style.stroke}` }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{labelFor(region)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
