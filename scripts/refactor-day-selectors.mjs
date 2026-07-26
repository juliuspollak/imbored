import fs from "node:fs";

// Idempotent codemod: every game must use the same DaySelector component.
const targets = [
  ["src/games/Queens.jsx", "qp-day-btn"],
  ["src/games/Tango.jsx", "tg-day-btn"],
  ["src/games/Zip.jsx", "zp-day-btn"],
  ["src/games/MiniSudoku.jsx", "ms-day-btn"],
  ["src/games/Geo.jsx", "geo-day-btn"],
  ["src/games/Zoom.jsx", "zoom-day-btn"],
];

for (const [file, legacyClass] of targets) {
  let source = fs.readFileSync(file, "utf8");

  if (!source.includes('import DaySelector from "../DaySelector.jsx";')) {
    const firstImportEnd = source.indexOf("\n");
    if (firstImportEnd < 0 || !source.startsWith("import ")) {
      throw new Error(`${file}: could not locate imports`);
    }
    source = `${source.slice(0, firstImportEnd + 1)}import DaySelector from "../DaySelector.jsx";\n${source.slice(firstImportEnd + 1)}`;
  }

  if (!source.includes("<DaySelector")) {
    const markerIndex = source.indexOf(legacyClass);
    if (markerIndex < 0) throw new Error(`${file}: legacy selector ${legacyClass} not found`);

    const mapIndex = source.lastIndexOf("{days.map", markerIndex);
    if (mapIndex < 0) throw new Error(`${file}: days.map block not found`);

    const start = source.lastIndexOf("<div", mapIndex);
    const close = source.indexOf("</div>", markerIndex);
    if (start < 0 || close < 0) throw new Error(`${file}: selector container not found`);

    const indentationStart = source.lastIndexOf("\n", start) + 1;
    const indentation = source.slice(indentationStart, start);
    const replacement = `${indentation}<DaySelector days={days} value={dayIdx} onChange={setDayIdx} />`;
    source = `${source.slice(0, indentationStart)}${replacement}${source.slice(close + "</div>".length)}`;
  }

  source = source
    .split("\n")
    .filter((line) => !line.includes(`.${legacyClass}:hover`))
    .join("\n");

  if (source.includes(legacyClass)) throw new Error(`${file}: legacy day selector remains`);
  if (!source.includes("<DaySelector days={days} value={dayIdx} onChange={setDayIdx} />")) {
    throw new Error(`${file}: shared DaySelector was not installed`);
  }

  fs.writeFileSync(file, source);
  console.log(`Updated ${file}`);
}
