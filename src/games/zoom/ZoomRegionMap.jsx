import React from "react";

const MAPS = {
  "North America": {
    viewBox: "0 0 320 190",
    regions: [
      { name: "Northern America", points: "35,38 92,20 176,28 236,52 224,92 165,103 103,92 56,72" },
      { name: "Central America", points: "142,104 184,99 209,113 197,132 172,139 151,126" },
      { name: "Caribbean", points: "205,111 231,106 257,113 275,125 253,135 224,129" },
    ],
  },
  "South America": {
    viewBox: "0 0 320 190",
    regions: [
      { name: "Andean South America", points: "118,28 145,38 151,66 143,94 151,124 139,158 122,171 108,147 111,112 101,82 108,52" },
      { name: "Atlantic South America", points: "145,38 192,34 231,55 239,83 224,112 204,136 177,154 139,158 151,124 143,94 151,66" },
    ],
  },
  Europe: {
    viewBox: "0 0 320 190",
    regions: [
      { name: "Northern Europe", points: "78,36 127,22 177,29 181,58 142,70 98,62" },
      { name: "Western Europe", points: "66,66 117,61 142,75 130,107 91,111 62,92" },
      { name: "Eastern Europe", points: "142,67 214,53 253,71 245,107 198,119 143,105" },
      { name: "Southern Europe", points: "91,113 145,108 193,121 185,145 137,154 98,143" },
    ],
  },
  Africa: {
    viewBox: "0 0 320 190",
    regions: [
      { name: "Northern Africa", points: "78,31 133,24 196,28 235,48 220,70 157,68 96,67 67,50" },
      { name: "Western Africa", points: "66,62 111,67 125,95 107,121 70,109 53,87" },
      { name: "Middle Africa", points: "119,70 164,69 181,96 165,125 125,119 111,93" },
      { name: "Eastern Africa", points: "166,69 218,70 242,97 214,127 172,123 182,96" },
      { name: "Southern Africa", points: "126,121 170,125 209,132 184,163 145,170 117,145" },
    ],
  },
  Asia: {
    viewBox: "0 0 320 190",
    regions: [
      { name: "Western Asia", points: "39,83 78,59 112,65 121,92 96,111 58,108" },
      { name: "Southern Asia", points: "102,96 145,84 172,98 162,132 137,153 113,129" },
      { name: "Eastern Asia", points: "151,42 216,39 269,62 257,102 217,112 177,91" },
      { name: "South-eastern Asia", points: "171,105 213,111 244,127 229,154 197,143 179,161 161,136" },
    ],
  },
  Oceania: {
    viewBox: "0 0 320 190",
    regions: [
      { name: "Australia", points: "44,78 101,60 151,72 157,116 126,143 72,135 39,108" },
      { name: "Melanesia", points: "166,78 194,66 218,80 211,104 181,107" },
      { name: "Polynesia", points: "226,55 244,67 259,83 275,103 258,119 243,102 232,84" },
    ],
  },
};

function wrapLabel(label) {
  const words = label.split(" ");
  if (words.length <= 2) return [label];
  const pivot = Math.ceil(words.length / 2);
  return [words.slice(0, pivot).join(" "), words.slice(pivot).join(" ")];
}

function regionCenter(points) {
  const parsed = points.split(" ").map((pair) => pair.split(",").map(Number));
  const x = parsed.reduce((sum, point) => sum + point[0], 0) / parsed.length;
  const y = parsed.reduce((sum, point) => sum + point[1], 0) / parsed.length;
  return { x, y };
}

export default function ZoomRegionMap({
  continent,
  answered = false,
  selectedRegion,
  correctRegion,
  labelFor = (value) => value,
  compact = false,
}) {
  const map = MAPS[continent];
  if (!map) return null;

  return (
    <div
      className="zoom-region-map"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        background: "linear-gradient(180deg, var(--color-primary-subtle) 0%, var(--color-surface-elevated) 58%)",
        padding: compact ? "6px" : "8px",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={map.viewBox}
        role="img"
        aria-label={`${labelFor(continent)} regions`}
        style={{ width: "100%", height: compact ? 126 : 166, display: "block" }}
      >
        <defs>
          <filter id={`zoom-map-shadow-${continent.replace(/\s/g, "-")}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.12" />
          </filter>
        </defs>

        {map.regions.map((region) => {
          const selectedWrong = answered && selectedRegion === region.name && selectedRegion !== correctRegion;
          const correct = answered && correctRegion === region.name;
          const fill = correct
            ? "var(--color-success-bg)"
            : selectedWrong
              ? "var(--color-danger-bg)"
              : "var(--color-surface)";
          const stroke = correct
            ? "var(--color-success-border)"
            : selectedWrong
              ? "var(--color-danger-solid)"
              : "var(--color-border-strong)";
          const textColor = correct
            ? "var(--color-success-text)"
            : selectedWrong
              ? "var(--color-danger-text)"
              : "var(--color-text-secondary)";
          const center = regionCenter(region.points);
          const lines = wrapLabel(labelFor(region.name));

          return (
            <g key={region.name}>
              <polygon
                points={region.points}
                fill={fill}
                stroke={stroke}
                strokeWidth={correct || selectedWrong ? 2.5 : 1.4}
                strokeLinejoin="round"
                filter={`url(#zoom-map-shadow-${continent.replace(/\s/g, "-")})`}
              />
              <text
                x={center.x}
                y={center.y - (lines.length - 1) * 6}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={textColor}
                style={{ fontSize: compact ? 8.5 : 9.5, fontWeight: 700, pointerEvents: "none" }}
              >
                {lines.map((line, index) => (
                  <tspan key={line} x={center.x} dy={index === 0 ? 0 : 11}>{line}</tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>

      {!compact && (
        <div style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: 10, lineHeight: 1.35, padding: "0 6px 2px" }}>
          {answered
            ? "The map now shows your choice and the correct region."
            : "Use the map to understand where each region is. It does not show which region the clue belongs to."}
        </div>
      )}
    </div>
  );
}
