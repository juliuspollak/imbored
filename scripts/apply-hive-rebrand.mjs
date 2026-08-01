import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, value) => {
  const full = path.join(root, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, value);
};

function replaceStringLiterals(source, replacer) {
  return source.replace(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g, (match, quote, value) => {
    const next = replacer(value);
    return next === value ? match : `${quote}${next}${quote}`;
  });
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// Remove the unsafe post-render DOM mutation layer.
let main = read("src/main.jsx")
  .replace(/\nimport "\.\/hive-branding\.css";/g, "")
  .replace(/\nimport "\.\/hive-branding\.js";/g, "");
if (!main.includes('import "./hive.css";')) {
  main = main.replace('import "./circle-portal.css";', 'import "./circle-portal.css";\nimport "./hive.css";');
}
write("src/main.jsx", main);
for (const oldFile of ["src/hive-branding.js", "src/hive-branding.css"]) {
  const full = path.join(root, oldFile);
  if (fs.existsSync(full)) fs.rmSync(full);
}

write("src/components/BeeIcon.jsx", `export default function BeeIcon({ size = 24, className = "", ...props }) {
  return (
    <svg className={\`hive-bee-icon \${className}\`} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <ellipse cx="11" cy="11" rx="5.5" ry="7" fill="rgba(255,255,255,.76)" stroke="currentColor" strokeWidth="1.4" transform="rotate(-28 11 11)" />
      <ellipse cx="21" cy="11" rx="5.5" ry="7" fill="rgba(255,255,255,.76)" stroke="currentColor" strokeWidth="1.4" transform="rotate(28 21 11)" />
      <ellipse cx="16" cy="18" rx="7.2" ry="9" fill="#F7B928" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.2 15.3h11.6M9.2 19.3h13.6M11 23.2h10" stroke="currentColor" strokeWidth="2.1" />
      <circle cx="13.5" cy="11.6" r="1.05" fill="currentColor" />
      <circle cx="18.5" cy="11.6" r="1.05" fill="currentColor" />
      <path d="M13 8.4 10.5 5M19 8.4 21.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
`);

write("src/components/HiveTileIcon.jsx", `import BeeIcon from "./BeeIcon.jsx";

export default function HiveTileIcon({ size = 52, className = "" }) {
  return (
    <span className={\`hive-tile-icon \${className}\`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="hive-tile-icon__cells" />
      <BeeIcon size={Math.round(size * 0.58)} className="hive-tile-icon__bee" />
    </span>
  );
}
`);

write("src/hive.css", `.hive-bee-icon { display:inline-block; overflow:visible; color:#5d3a05; filter:drop-shadow(0 2px 2px rgba(74,45,0,.2)); }
.hive-tile-icon { position:relative; display:inline-grid; place-items:center; border-radius:22%; overflow:hidden; color:#513100; background:linear-gradient(145deg,#ffd766,#eba617); box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 8px 18px rgba(116,70,0,.22); }
.hive-tile-icon__cells { position:absolute; inset:-10%; opacity:.56; background-image:linear-gradient(30deg,rgba(104,59,0,.22) 12%,transparent 12.5%,transparent 87%,rgba(104,59,0,.22) 87.5%),linear-gradient(150deg,rgba(104,59,0,.22) 12%,transparent 12.5%,transparent 87%,rgba(104,59,0,.22) 87.5%),linear-gradient(30deg,rgba(255,255,255,.3) 12%,transparent 12.5%,transparent 87%,rgba(255,255,255,.3) 87.5%),linear-gradient(150deg,rgba(255,255,255,.3) 12%,transparent 12.5%,transparent 87%,rgba(255,255,255,.3) 87.5%); background-size:18px 31px; background-position:0 0,0 0,9px 15.5px,9px 15.5px; transform:rotate(2deg); }
.hive-tile-icon__bee { position:relative; z-index:1; width:auto; height:auto; filter:drop-shadow(0 3px 3px rgba(83,47,0,.28)); }
@media (prefers-color-scheme:dark){.hive-tile-icon{background:linear-gradient(145deg,#efbd3b,#b96f08);}.hive-bee-icon{color:#392100;}}
`);

const sourceFiles = walk(path.join(root, "src")).filter((file) => /\.(jsx|js)$/.test(file));
for (const file of sourceFiles) {
  const rel = path.relative(root, file).replaceAll(path.sep, "/");
  if (["src/components/BeeIcon.jsx", "src/components/HiveTileIcon.jsx"].includes(rel)) continue;
  let source = fs.readFileSync(file, "utf8");
  source = replaceStringLiterals(source, (value) => {
    if (/Queens\.jsx$/.test(value)) return value;
    return value.replace(/\bQueens\b/g, "Hive");
  });

  if (rel === "src/games/Queens.jsx") {
    source = source.replace(/\bCrown,\s*/g, "").replace(/,\s*Crown\b/g, "");
    if (!source.includes('import BeeIcon from "../components/BeeIcon.jsx";')) {
      const marker = 'import Button from "../components/Button.jsx";';
      source = source.replace(marker, `${marker}\nimport BeeIcon from "../components/BeeIcon.jsx";`);
    }
    source = source.replace(/<Crown\b/g, "<BeeIcon");
    source = replaceStringLiterals(source, (value) => {
      if (["queen", "queens", "crown", "crown-elim"].includes(value)) return value;
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

  if (rel === "src/Home.jsx") {
    const crownTags = [...source.matchAll(/<Crown\b/g)];
    if (crownTags.length === 1) {
      source = source.replace(/\bCrown,\s*/g, "").replace(/,\s*Crown\b/g, "").replace(/<Crown\b/g, "<HiveTileIcon");
      if (!source.includes('import HiveTileIcon from "./components/HiveTileIcon.jsx";')) {
        const firstImportEnd = source.indexOf("\n", source.indexOf("import "));
        source = source.slice(0, firstImportEnd + 1) + 'import HiveTileIcon from "./components/HiveTileIcon.jsx";\n' + source.slice(firstImportEnd + 1);
      }
    }
  }

  fs.writeFileSync(file, source);
}

// Verify that the unsafe layer is gone and the game itself no longer renders crown icons.
const queens = read("src/games/Queens.jsx");
if (queens.includes("<Crown")) throw new Error("Queens.jsx still renders Crown");
if (!queens.includes("<BeeIcon")) throw new Error("Queens.jsx does not render BeeIcon");
if (read("src/main.jsx").includes("hive-branding")) throw new Error("Unsafe Hive branding import remains");

console.log("Hive source migration applied successfully.");
