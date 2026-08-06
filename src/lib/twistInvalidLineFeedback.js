const SIZE = 6;
const HALF = SIZE / 2;
const DELAY_MS = 2000;
const boardStates = new WeakMap();

function cellValue(cell) {
  if (cell.querySelector(".tg-symbol-disc--flame")) return 1;
  if (cell.querySelector(".tg-symbol-disc--frost")) return 2;
  return 0;
}

function readEdgeConflict(token, values) {
  const step = 100 / SIZE;
  const left = Number.parseFloat(token.style.left);
  const top = Number.parseFloat(token.style.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;

  const leftUnits = left / step;
  const topUnits = top / step;
  const horizontal = Math.abs(leftUnits - Math.round(leftUnits)) < 0.08;
  const relation = token.textContent?.trim();

  let r1;
  let c1;
  let r2;
  let c2;
  let line;

  if (horizontal) {
    r1 = Math.round(topUnits - 0.5);
    c1 = Math.round(leftUnits) - 1;
    r2 = r1;
    c2 = c1 + 1;
    line = { type: "row", index: r1 };
  } else {
    r1 = Math.round(topUnits) - 1;
    c1 = Math.round(leftUnits - 0.5);
    r2 = r1 + 1;
    c2 = c1;
    line = { type: "col", index: c1 };
  }

  if ([r1, c1, r2, c2].some((value) => value < 0 || value >= SIZE)) return null;
  const first = values[r1][c1];
  const second = values[r2][c2];
  if (!first || !second) return null;

  const invalid = relation === "=" ? first !== second : relation === "≠" ? first === second : false;
  return invalid ? line : null;
}

function calculateInvalidLines(board) {
  const cells = Array.from(board.querySelectorAll(":scope > .tg-cell")).slice(0, SIZE * SIZE);
  if (cells.length !== SIZE * SIZE) return null;

  const values = Array.from({ length: SIZE }, (_, row) =>
    Array.from({ length: SIZE }, (_, column) => cellValue(cells[row * SIZE + column]))
  );
  const rows = new Set();
  const cols = new Set();

  for (let index = 0; index < SIZE; index++) {
    const row = values[index];
    const column = values.map((item) => item[index]);

    if (row.every(Boolean)) {
      const firstCount = row.filter((value) => value === 1).length;
      const hasTriple = row.some((value, offset) => offset <= SIZE - 3 && value === row[offset + 1] && value === row[offset + 2]);
      if (firstCount !== HALF || hasTriple) rows.add(index);
    }

    if (column.every(Boolean)) {
      const firstCount = column.filter((value) => value === 1).length;
      const hasTriple = column.some((value, offset) => offset <= SIZE - 3 && value === column[offset + 1] && value === column[offset + 2]);
      if (firstCount !== HALF || hasTriple) cols.add(index);
    }
  }

  for (const token of board.querySelectorAll(":scope > .tg-edge-token")) {
    const conflict = readEdgeConflict(token, values);
    if (!conflict) continue;
    if (conflict.type === "row" && values[conflict.index].every(Boolean)) rows.add(conflict.index);
    if (conflict.type === "col" && values.every((row) => row[conflict.index] !== 0)) cols.add(conflict.index);
  }

  return { cells, values, rows, cols };
}

function clearLineClasses(cells) {
  for (const cell of cells || []) {
    cell.classList.remove(
      "tg-invalid-row", "tg-invalid-row-start", "tg-invalid-row-end",
      "tg-invalid-col", "tg-invalid-col-start", "tg-invalid-col-end",
    );
  }
}

function applyLineClasses(result) {
  for (const row of result.rows) {
    for (let column = 0; column < SIZE; column++) {
      const cell = result.cells[row * SIZE + column];
      cell.classList.add("tg-invalid-row");
      if (column === 0) cell.classList.add("tg-invalid-row-start");
      if (column === SIZE - 1) cell.classList.add("tg-invalid-row-end");
    }
  }

  for (const column of result.cols) {
    for (let row = 0; row < SIZE; row++) {
      const cell = result.cells[row * SIZE + column];
      cell.classList.add("tg-invalid-col");
      if (row === 0) cell.classList.add("tg-invalid-col-start");
      if (row === SIZE - 1) cell.classList.add("tg-invalid-col-end");
    }
  }
}

function scanBoard(board) {
  const result = calculateInvalidLines(board);
  if (!result) return;

  const signature = `${result.values.flat().join("")}|r:${[...result.rows].join(",")}|c:${[...result.cols].join(",")}`;
  const previous = boardStates.get(board);
  if (previous?.signature === signature) return;

  if (previous?.timer) window.clearTimeout(previous.timer);
  clearLineClasses(previous?.cells || result.cells);

  if (result.rows.size === 0 && result.cols.size === 0) {
    boardStates.set(board, { signature, cells: result.cells, timer: null });
    return;
  }

  const timer = window.setTimeout(() => {
    const latest = calculateInvalidLines(board);
    if (!latest) return;
    const latestSignature = `${latest.values.flat().join("")}|r:${[...latest.rows].join(",")}|c:${[...latest.cols].join(",")}`;
    if (latestSignature !== signature) return;
    applyLineClasses(latest);
    boardStates.set(board, { signature, cells: latest.cells, timer: null });
  }, DELAY_MS);

  boardStates.set(board, { signature, cells: result.cells, timer });
}

function scanAllBoards() {
  document.querySelectorAll(".tg-board-shell").forEach(scanBoard);
}

let scanQueued = false;
function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  window.requestAnimationFrame(() => {
    scanQueued = false;
    scanAllBoards();
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pageshow", queueScan);
  queueScan();
}
