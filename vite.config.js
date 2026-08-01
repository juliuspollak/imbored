import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function replaceStringLiterals(source, replaceValue) {
  let result = "";
  let index = 0;

  while (index < source.length) {
    const quote = source[index];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      result += quote;
      index += 1;
      continue;
    }

    let end = index + 1;
    let escaped = false;
    while (end < source.length) {
      const char = source[end];
      if (!escaped && char === quote) break;
      escaped = !escaped && char === "\\";
      if (char !== "\\") escaped = false;
      end += 1;
    }

    if (end >= source.length) {
      result += source.slice(index);
      break;
    }

    const value = source.slice(index + 1, end);
    result += quote + replaceValue(value) + quote;
    index = end + 1;
  }

  return result;
}

function hiveBranding() {
  return {
    name: "imbored-hive-branding",
    enforce: "pre",
    transform(source, id) {
      const normalisedId = id.replaceAll("\\", "/").split("?")[0];
      if (!normalisedId.includes("/src/") || !/\.[jt]sx?$/.test(normalisedId)) return null;

      let code = replaceStringLiterals(source, (value) => {
        if (value.endsWith("/Queens.jsx") || value.endsWith("Queens.jsx")) return value;
        return value
          .replace(/\bQueens\b/g, "Hive")
          .replace("One crown per row, column & region", "One bee per row, column & region");
      });

      if (normalisedId.endsWith("/src/games/Queens.jsx")) {
        code = code.replace("import { Crown, ", "import { ");
        if (!code.includes('import BeeIcon from "../components/BeeIcon.jsx";')) {
          code = code.replace(
            'import Button from "../components/Button.jsx";',
            'import Button from "../components/Button.jsx";\nimport BeeIcon from "../components/BeeIcon.jsx";'
          );
        }
        code = code.replaceAll("<Crown", "<BeeIcon");
        code = replaceStringLiterals(code, (value) => {
          if (value.includes("${") || ["queen", "queens", "crown", "crown-elim"].includes(value)) return value;
          return value
            .replace(/\bQueens\b/g, "Hive")
            .replace(/\bqueens\b/g, "bees")
            .replace(/\bQueen\b/g, "Bee")
            .replace(/\bqueen\b/g, "bee")
            .replace(/\bCrowns\b/g, "Bees")
            .replace(/\bcrowns\b/g, "bees")
            .replace(/\bCrown\b/g, "Bee")
            .replace(/\bcrown\b/g, "bee");
        });
      }

      if (normalisedId.endsWith("/src/Home.jsx")) {
        if (!code.includes('import HiveTileIcon from "./components/HiveTileIcon.jsx";')) {
          code = code.replace(
            'import AvatarGroup from "./components/AvatarGroup.jsx";',
            'import AvatarGroup from "./components/AvatarGroup.jsx";\nimport HiveTileIcon from "./components/HiveTileIcon.jsx";'
          );
        }
        code = code.replace(
          /(\{ id: "queens"[^\n]*icon: )Crown/,
          "$1HiveTileIcon"
        );
      }

      return code === source ? null : { code, map:null };
    },
  };
}

export default defineConfig({
  plugins: [hiveBranding(), react(), tailwindcss()],
});
