import React from "react";

const MAPS = {
  "North America": {
    viewBox: "0 0 360 220",
    regions: [
      { name: "Northern America", path: "M58 47 C82 27 123 20 167 26 L213 39 L257 33 L289 49 L280 73 L250 84 L224 96 L183 102 L151 96 L122 83 L89 76 L65 66 Z", label: [169, 61] },
      { name: "Central America", path: "M151 96 L183 102 L208 112 L220 126 L208 136 L192 132 L179 143 L166 136 L160 121 L146 113 Z", label: [183, 119] },
      { name: "Caribbean", path: "M229 111 C245 105 262 107 273 114 C282 120 287 127 282 133 C273 139 263 134 254 131 C244 128 235 130 226 126 Z", label: [256, 121] },
    ],
  },
  "South America": {
    viewBox: "0 0 360 220",
    regions: [
      { name: "Andean South America", path: "M133 28 C124 43 119 60 121 78 C124 96 133 108 132 126 C131 145 126 164 136 187 C143 198 150 196 155 183 C159 166 160 151 163 135 C165 119 161 105 158 89 C154 72 157 57 164 44 L152 32 Z", label: [142, 107] },
      { name: "Atlantic South America", path: "M152 32 L189 29 L222 41 L247 59 L252 79 L242 101 L231 124 L211 143 L188 158 L170 177 L155 183 C159 166 160 151 163 135 C165 119 161 105 158 89 C154 72 157 57 164 44 Z", label: [204, 101] },
    ],
  },
  Europe: {
    viewBox: "0 0 360 220",
    regions: [
      { name: "Northern Europe", path: "M120 45 L142 31 L163 36 L177 28 L193 36 L205 27 L221 35 L229 49 L224 65 L209 72 L197 65 L183 69 L170 61 L155 64 L143 55 L128 58 Z", label: [178, 48] },
      { name: "Western Europe", path: "M112 69 L128 58 L143 55 L155 64 L169 63 L175 80 L171 98 L156 109 L137 109 L123 99 L108 92 L102 79 Z", label: [139, 84] },
      { name: "Eastern Europe", path: "M169 63 L197 65 L224 65 L250 76 L258 92 L251 110 L230 118 L207 119 L184 111 L171 98 L175 80 Z", label: [217, 88] },
      { name: "Southern Europe", path: "M137 109 L156 109 L171 98 L184 111 L207 119 L225 128 L216 140 L198 139 L187 151 L173 145 L163 154 L149 146 L143 133 L129 128 Z", label: [177, 128] },
    ],
  },
  Africa: {
    viewBox: "0 0 360 220",
    regions: [
      { name: "Northern Africa", path: "M105 47 C133 28 175 25 215 32 L251 47 L271 64 L260 81 L224 85 L187 82 L151 80 L121 76 L99 61 Z", label: [184, 57] },
      { name: "Western Africa", path: "M99 61 L121 76 L138 84 L143 107 L130 133 L104 127 L83 111 L76 91 L80 73 Z", label: [107, 101] },
      { name: "Middle Africa", path: "M138 84 L176 82 L194 91 L204 111 L192 139 L154 137 L143 107 Z", label: [171, 111] },
      { name: "Eastern Africa", path: "M176 82 L224 85 L248 96 L261 114 L243 140 L214 143 L192 139 L204 111 L194 91 Z", label: [224, 111] },
      { name: "Southern Africa", path: "M154 137 L192 139 L214 143 L217 158 L202 181 L180 196 L159 188 L145 169 L142 151 Z", label: [181, 161] },
    ],
  },
  Asia: {
    viewBox: "0 0 360 220",
    regions: [
      { name: "Western Asia", path: "M53 95 L72 75 L101 65 L126 68 L143 82 L140 102 L121 115 L94 119 L68 112 Z", label: [99, 91] },
      { name: "Southern Asia", path: "M121 115 L140 102 L164 96 L184 104 L190 123 L180 146 L164 168 L147 153 L137 132 Z", label: [160, 128] },
      { name: "Eastern Asia", path: "M143 82 L158 58 L190 44 L228 43 L262 55 L292 70 L305 88 L295 105 L267 113 L238 113 L210 104 L184 104 L164 96 Z", label: [230, 79] },
      { name: "South-eastern Asia", path: "M190 123 L210 104 L238 113 L258 128 L267 146 L252 159 L234 151 L221 165 L207 154 L198 170 L181 153 L180 146 Z", label: [224, 139] },
    ],
  },
  Oceania: {
    viewBox: "0 0 360 220",
    regions: [
      { name: "Australia", path: "M54 105 C68 80 102 69 137 74 L163 87 L173 112 L164 139 L141 158 L105 163 L73 151 L53 131 Z", label: [113, 119] },
      { name: "Melanesia", path: "M188 91 C201 80 216 80 228 88 L237 99 L230 112 L214 116 L201 108 Z M242 112 C248 107 257 108 262 114 C261 121 253 124 246 121 Z", label: [214, 94] },
      { name: "Polynesia", path: "M270 70 C276 64 282 66 285 72 C283 78 277 80 272 77 Z M293 94 C300 89 306 93 307 100 C303 105 297 104 293 101 Z M278 128 C284 122 291 125 293 131 C289 136 283 136 279 133 Z", label: [291, 112] },
    ],
  },
};

const NEUTRAL_FILLS = [
  "#dbeafe",
  "#e0f2fe",
  "#ede9fe",
  "#dcfce7",
  "#fef3c7",
];

function wrapLabel(label) {
  const words = label.split(" ");
  if (words.length <= 2) return [label];
  const pivot = Math.ceil(words.length / 2);
  return [words.slice(0, pivot).join(" "), words.slice(pivot).join(" ")];
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
  const shadowId = `zoom-map-shadow-${continent.replace(/\s/g, "-")}`;

  return (
    <div
      className="zoom-region-map"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        background: "linear-gradient(180deg, #f7fbff 0%, #eef6ff 100%)",
        padding: compact ? "4px 6px" : "6px 8px 8px",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={map.viewBox}
        role="img"
        aria-label={`${labelFor(continent)} regions`}
        style={{ width: "100%", height: compact ? 118 : 150, display: "block" }}
      >
        <defs>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#64748b" floodOpacity="0.15" />
          </filter>
        </defs>

        <ellipse cx="180" cy="203" rx="112" ry="6" fill="#cbd5e1" opacity="0.22" />

        {map.regions.map((region, index) => {
          const selectedWrong = answered && selectedRegion === region.name && selectedRegion !== correctRegion;
          const correct = answered && correctRegion === region.name;
          const fill = correct
            ? "#bbf7d0"
            : selectedWrong
              ? "#fecaca"
              : answered
                ? "#e5edf5"
                : NEUTRAL_FILLS[index % NEUTRAL_FILLS.length];
          const stroke = correct
            ? "#16a34a"
            : selectedWrong
              ? "#ef4444"
              : "#ffffff";
          const textColor = correct
            ? "#166534"
            : selectedWrong
              ? "#991b1b"
              : "#334155";
          const lines = wrapLabel(labelFor(region.name));
          const [x, y] = region.label;

          return (
            <g key={region.name}>
              <path
                d={region.path}
                fill={fill}
                stroke={stroke}
                strokeWidth={correct || selectedWrong ? 3 : 2.4}
                strokeLinejoin="round"
                filter={`url(#${shadowId})`}
                style={{ transition: "fill 180ms ease, stroke 180ms ease" }}
              />
              <text
                x={x}
                y={y - (lines.length - 1) * 6}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={textColor}
                stroke="#ffffff"
                strokeWidth="3.5"
                paintOrder="stroke"
                strokeLinejoin="round"
                style={{ fontSize: compact ? 8.5 : 9.5, fontWeight: 800, pointerEvents: "none" }}
              >
                {lines.map((line, lineIndex) => (
                  <tspan key={`${region.name}-${lineIndex}`} x={x} dy={lineIndex === 0 ? 0 : 11}>{line}</tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>

      {!compact && answered && (
        <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", paddingBottom: 2, fontSize: 10, color: "var(--color-text-secondary)" }}>
          {selectedRegion && selectedRegion !== correctRegion && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: "#ef4444" }} />
              Your choice
            </span>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#16a34a" }} />
            Correct region
          </span>
        </div>
      )}
    </div>
  );
}
