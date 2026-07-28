import { animalColour } from "./engine.js";

const UNIFORM_PALETTES = {
  fox: { dark: "#246B5A", primary: "#3B9A80", mid: "#6ABAA2", light: "#A9DDCD", accent: "#A9DDCD" },
  panda: { dark: "#246B5A", primary: "#3B9A80", mid: "#3B9A80", light: "#A9DDCD", accent: "#8FD6C0" },
  owl: { dark: "#246B5A", primary: "#246B5A", mid: "#3B9A80", light: "#6ABAA2", accent: "#8FD6C0" },
  rabbit: { dark: "#246B5A", primary: "#3B9A80", mid: "#3B9A80", light: "#A9DDCD", accent: "#246B5A" },
  lion: { dark: "#246B5A", primary: "#3B9A80", mid: "#8FD6C0", light: "#A9DDCD", accent: "#8FD6C0" },
  frog: { dark: "#246B5A", primary: "#3B9A80", mid: "#2F806B", light: "#8FD6C0", accent: "#78AFA0" },
};

const INDIVIDUAL_PALETTES = {
  fox: {
    dark: "#5B2B42",
    primary: "#C9863F",
    mid: "#DCA861",
    light: "#F0C47F",
    accent: "#F2C47D",
  },
  panda: {
    dark: "#389B4B",
    primary: "#70C754",
    mid: "#70C754",
    light: "#BCE479",
    accent: "#A9DE6F",
  },
  owl: {
    dark: "#8E247D",
    primary: "#A82E91",
    mid: "#B73B9D",
    light: "#C94AB0",
    accent: "#E983C9",
  },
  rabbit: {
    dark: "#168EA4",
    primary: "#25AEC0",
    mid: "#25AEC0",
    light: "#B8E6ED",
    accent: "#11798E",
  },
  lion: {
    dark: "#783E32",
    primary: "#D99438",
    mid: "#F1B557",
    light: "#E9B966",
    accent: "#F1B557",
  },
  frog: {
    dark: "#30223F",
    primary: "#5D3B76",
    mid: "#4A315F",
    light: "#81639A",
    accent: "#9B89B0",
  },
};

function coloursFor(animalId, colourMode) {
  return colourMode === "individual"
    ? INDIVIDUAL_PALETTES[animalId]
    : UNIFORM_PALETTES[animalId];
}

function Eye({ cx, cy, rotate = 0, iris = "#E9852D" }) {
  return (
    <g transform={`rotate(${rotate} ${cx} ${cy})`}>
      <ellipse cx={cx} cy={cy} rx="8" ry="10" fill="#FFFEF8" />
      <circle cx={cx + 1} cy={cy + 1} r="4.3" fill={iris} stroke="none" />
      <circle cx={cx + 1.5} cy={cy + 1.5} r="2.3" fill="#211B24" stroke="none" />
      <circle cx={cx} cy={cy} r="1" fill="#FFFFFF" stroke="none" />
    </g>
  );
}

function FaceFrame({ animalId, colourMode, size, children }) {
  const colour = animalColour(animalId, colourMode);
  const backgroundId = `rush-animal-bg-${animalId}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={backgroundId} cx="34%" cy="24%" r="76%">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".92" />
          <stop offset=".62" stopColor={colour} stopOpacity=".14" />
          <stop offset="1" stopColor={colour} stopOpacity=".25" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="45" fill={`url(#${backgroundId})`} />
      <g stroke="#342532" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

function Monkey({ colourMode, size }) {
  const colours = coloursFor("fox", colourMode);
  return (
    <FaceFrame animalId="fox" colourMode={colourMode} size={size}>
      <circle cx="22" cy="48" r="13" fill={colours.primary} />
      <circle cx="78" cy="48" r="13" fill={colours.primary} />
      <circle cx="22" cy="48" r="7" fill={colours.accent} strokeWidth="2.4" />
      <circle cx="78" cy="48" r="7" fill={colours.accent} strokeWidth="2.4" />
      <path fill={colours.dark} d="M26 51c0-24 11-37 25-37 17 0 26 14 24 39-1 21-11 32-25 32S26 73 26 51Z" />
      <path fill={colours.mid} d="M32 49c2-18 9-26 19-26 11 0 18 9 18 27 0 19-8 29-19 29S30 68 32 49Z" />
      <Eye cx="43" cy="43" rotate="-5" />
      <Eye cx="59" cy="43" rotate="5" />
      <path fill={colours.light} d="M30 61c6-9 12-12 20-12 10 0 17 4 21 13-3 14-10 20-21 20-10 0-17-7-20-21Z" />
      <path d="M43 61q7 4 14 0" />
      <path fill="#D94C3F" d="M40 68q10 10 20 0-2 12-10 12t-10-12Z" />
      <path d="M33 24q14-12 32-2" />
    </FaceFrame>
  );
}

function Snake({ colourMode, size }) {
  const colours = coloursFor("panda", colourMode);
  return (
    <FaceFrame animalId="panda" colourMode={colourMode} size={size}>
      <path fill={colours.dark} d="M22 77c2-14 13-20 27-17 9 2 18 0 18-6 0-5-5-6-12-5l-5-15c18-6 34 1 34 17 0 21-20 28-39 23-7-2-10 0-11 7l-12-4Z" />
      <path fill={colours.primary} d="M39 32c0-13 8-21 20-21 15 0 24 10 22 23-2 12-11 19-23 18-12-1-19-9-19-20Z" />
      <path fill={colours.light} d="M54 37c7-7 18-8 25-3-3 11-11 17-21 16-4 0-7-2-10-4l6-9Z" strokeWidth="2.5" />
      <Eye cx="53" cy="25" rotate="-8" />
      <Eye cx="68" cy="24" rotate="7" />
      <circle cx="73" cy="39" r="1.5" fill="#342532" stroke="none" />
      <path d="M72 45q-8 5-15 1" />
      <path d="m44 67 9 2m-17 3 9 2" stroke={colours.accent} strokeWidth="3" />
      <path d="M48 45 37 49m0 0-6-4m6 4-5 5" stroke="#DE3B79" />
    </FaceFrame>
  );
}

function Octopus({ colourMode, size }) {
  const colours = coloursFor("owl", colourMode);
  return (
    <FaceFrame animalId="owl" colourMode={colourMode} size={size}>
      <path fill={colours.primary} d="M31 49c0-23 8-36 21-36 15 0 23 14 22 36-1 18-9 26-22 26-13 0-21-9-21-26Z" />
      <path d="M37 63C25 68 27 82 16 82c-6 0-7-6-2-11" stroke={colours.dark} strokeWidth="9" />
      <path d="M44 69c-7 8-3 17-11 21-6 3-10-2-7-8" stroke={colours.mid} strokeWidth="9" />
      <path d="M57 69c7 8 3 17 11 21 6 3 10-2 7-8" stroke={colours.dark} strokeWidth="9" />
      <path d="M66 63c12 5 10 19 21 19 6 0 7-6 2-11" stroke={colours.mid} strokeWidth="9" />
      <path fill={colours.light} d="M35 47c1-18 7-28 17-28 11 0 17 11 17 29-8-5-26-5-34-1Z" strokeWidth="2.5" />
      <Eye cx="45" cy="43" rotate="-5" iris="#F0A82E" />
      <Eye cx="61" cy="43" rotate="5" iris="#F0A82E" />
      <path fill="#E45A5D" d="M43 56q10 9 20 0-2 12-10 12t-10-12Z" />
      <circle cx="37" cy="54" r="2" fill={colours.accent} stroke="none" />
      <circle cx="68" cy="54" r="2" fill={colours.accent} stroke="none" />
    </FaceFrame>
  );
}

function Elephant({ colourMode, size }) {
  const colours = coloursFor("rabbit", colourMode);
  return (
    <FaceFrame animalId="rabbit" colourMode={colourMode} size={size}>
      <path fill={colours.dark} d="M19 47c0-18 10-30 26-30 8 0 14 3 19 9 14 0 23 10 22 24-1 15-11 25-24 25H40C27 75 19 64 19 47Z" />
      <path fill={colours.primary} d="M28 49c0-17 9-28 22-28 15 0 24 12 23 31l-3 25c-1 10-7 15-15 13-7-2-9-9-5-15l6-8V50c0-7-4-11-10-11-7 0-11 4-11 10v15c-5-4-7-9-7-15Z" />
      <path d="M55 75c-2 7 0 11 5 11 6 0 9-5 8-11" />
      <Eye cx="43" cy="38" rotate="-4" />
      <Eye cx="59" cy="38" rotate="5" />
      <path d="M57 51q7 3 12-1" />
      <path fill="#FFF8E7" d="M44 58c-5 9-9 12-14 11 4-2 7-8 8-14l6 3Z" strokeWidth="2.2" />
      <path d="m58 58 10 1m-10 5 9 3" stroke={colourMode === "individual" ? colours.accent : colours.dark} strokeWidth="2" />
    </FaceFrame>
  );
}

function Lion({ colourMode, size }) {
  const colours = coloursFor("lion", colourMode);
  return (
    <FaceFrame animalId="lion" colourMode={colourMode} size={size}>
      <path fill={colours.dark} d="m50 9 9 7 11-1 4 10 10 5-2 11 7 9-7 9 2 11-10 5-4 10-11-1-9 7-9-7-11 1-4-10-10-5 2-11-7-9 7-9-2-11 10-5 4-10 11 1 9-7Z" />
      <circle cx="50" cy="50" r="29" fill={colours.primary} />
      <circle cx="28" cy="38" r="8" fill={colours.mid} />
      <circle cx="72" cy="38" r="8" fill={colours.mid} />
      <Eye cx="42" cy="43" rotate="-4" />
      <Eye cx="59" cy="43" rotate="5" />
      <path fill={colours.light} d="M30 62c4-10 11-15 20-15 10 0 17 5 21 15-3 13-10 20-21 20S33 75 30 62Z" />
      <path fill="#352633" d="M43 58q7-7 14 0-1 7-7 7t-7-7Z" />
      <path fill="#DD4A42" d="M41 68q9 8 18 0-2 11-9 11t-9-11Z" />
      <path d="m37 62-9-2m10 7-10 2m35-7 9-2m-10 7 10 2" strokeWidth="2" />
    </FaceFrame>
  );
}

function Spider({ colourMode, size }) {
  const colours = coloursFor("frog", colourMode);
  return (
    <FaceFrame animalId="frog" colourMode={colourMode} size={size}>
      <path d="M13 29 50 13l37 16-8 43-29 16-29-16-8-43Zm0 0 66 43M87 29 21 72M50 13v75M13 29h74M21 72h58" stroke={colours.accent} strokeWidth="1.5" opacity=".45" />
      <path d="M34 48 20 38m15 18-19-2m21 10-16 10m45-26 14-10M65 56l19-2M63 64l16 10" stroke={colours.dark} strokeWidth="7" />
      <ellipse cx="50" cy="57" rx="24" ry="21" fill={colours.mid} />
      <circle cx="50" cy="34" r="16" fill={colours.primary} />
      <Eye cx="44" cy="33" rotate="-5" iris="#F29B2E" />
      <Eye cx="58" cy="33" rotate="5" iris="#F29B2E" />
      <path fill="#E24D57" d="M40 55q10 9 20 0-2 12-10 12T40 55Z" />
      <circle cx="36" cy="48" r="2.2" fill={colours.light} stroke="none" />
      <circle cx="65" cy="48" r="2.2" fill={colours.light} stroke="none" />
    </FaceFrame>
  );
}

export default function AnimalFace({ animalId, colourMode = "uniform", size = 72 }) {
  switch (animalId) {
    case "fox":
      return <Monkey colourMode={colourMode} size={size} />;
    case "panda":
      return <Snake colourMode={colourMode} size={size} />;
    case "owl":
      return <Octopus colourMode={colourMode} size={size} />;
    case "rabbit":
      return <Elephant colourMode={colourMode} size={size} />;
    case "lion":
      return <Lion colourMode={colourMode} size={size} />;
    case "frog":
      return <Spider colourMode={colourMode} size={size} />;
    default:
      return null;
  }
}
