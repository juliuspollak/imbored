import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function replaceExactDisplayLabels(source) {
  return source
    .replace(/(["'])Queens\1/g, "$1Hive$1")
    .replace(/(["'])One crown per row, column & region\1/g, "$1One bee per row, column & region$1");
}

function replaceHiveGameCopy(source) {
  return source.replace(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g, (match, quote, value) => {
    // These values are internal game-state identifiers and must stay unchanged.
    if (value.includes("${") || ["queen", "queens", "crown", "crown-elim"].includes(value)) return match;

    const next = value
      .replace(/\bQueens\b/g, "Hive")
      .replace(/\bqueens\b/g, "bees")
      .replace(/\bQueen\b/g, "Bee")
      .replace(/\bqueen\b/g, "bee")
      .replace(/\bCrowns\b/g, "Bees")
      .replace(/\bcrowns\b/g, "bees")
      .replace(/\bCrown\b/g, "Bee")
      .replace(/\bcrown\b/g, "bee");

    return `${quote}${next}${quote}`;
  });
}

function hiveBranding() {
  return {
    name: "imbored-hive-branding",
    enforce: "pre",
    transform(source, id) {
      const normalisedId = id.replaceAll("\\", "/").split("?")[0];
      if (!normalisedId.includes("/src/") || !/\.[jt]sx?$/.test(normalisedId)) return null;

      let code = replaceExactDisplayLabels(source);

      if (normalisedId.endsWith("/src/games/Queens.jsx")) {
        code = code.replace("import { Crown, ", "import { ");
        if (!code.includes('import BeeIcon from "../components/BeeIcon.jsx";')) {
          code = code.replace(
            'import Button from "../components/Button.jsx";',
            'import Button from "../components/Button.jsx";\nimport BeeIcon from "../components/BeeIcon.jsx";'
          );
        }
        code = code.replaceAll("<Crown", "<BeeIcon");
        code = replaceHiveGameCopy(code);
      }

      if (normalisedId.endsWith("/src/Home.jsx")) {
        if (!code.includes('import HiveTileIcon from "./components/HiveTileIcon.jsx";')) {
          code = code.replace(
            'import AvatarGroup from "./components/AvatarGroup.jsx";',
            'import AvatarGroup from "./components/AvatarGroup.jsx";\nimport HiveTileIcon from "./components/HiveTileIcon.jsx";'
          );
        }
        code = code.replace(/(\{ id: "queens"[^\n]*icon: )Crown/, "$1HiveTileIcon");
      }

      return code === source ? null : { code, map:null };
    },
  };
}

export default defineConfig({
  plugins: [hiveBranding(), react(), tailwindcss()],
});
