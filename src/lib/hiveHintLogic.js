const BLANK = 0;
const CROSS = 1;
const BEE = 2;

function openCount(board, cells) {
  return cells.reduce((count, [r, c]) => count + (board[r][c] === BLANK ? 1 : 0), 0);
}

// Find a move that is true in every completion of the player's current board.
// Eliminations deliberately come first: a hint should advance the same
// deduction chain a player would follow, not expose a bee from the saved
// answer merely because the generated puzzle has one final solution.
export function findCompletionForcedStep(board, regionGrid, maxSolutions = 5000) {
  const n = board.length;
  if (!n || regionGrid.length !== n) return null;

  const beeCounts = Array.from({ length: n }, () => Array(n).fill(0));
  const forcedCols = Array(n).fill(null);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== BEE) continue;
      if (forcedCols[r] !== null) return null;
      forcedCols[r] = c;
    }
  }

  let solutionCount = 0;
  let truncated = false;
  const placement = Array(n).fill(-1);
  const usedCols = new Set();
  const usedRegions = new Set();

  function search(row, previousCol) {
    if (truncated) return;
    if (row === n) {
      solutionCount += 1;
      for (let r = 0; r < n; r++) beeCounts[r][placement[r]] += 1;
      if (solutionCount >= maxSolutions) truncated = true;
      return;
    }

    const onlyCol = forcedCols[row];
    for (let c = 0; c < n; c++) {
      if (onlyCol !== null && c !== onlyCol) continue;
      if (board[row][c] === CROSS || usedCols.has(c)) continue;
      if (previousCol !== null && Math.abs(c - previousCol) <= 1) continue;
      const region = regionGrid[row][c];
      if (usedRegions.has(region)) continue;
      placement[row] = c;
      usedCols.add(c);
      usedRegions.add(region);
      search(row + 1, c);
      usedCols.delete(c);
      usedRegions.delete(region);
      placement[row] = -1;
    }
  }

  search(0, null);
  if (truncated || solutionCount === 0) return null;

  const regions = new Map();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const region = regionGrid[r][c];
      if (!regions.has(region)) regions.set(region, []);
      regions.get(region).push([r, c]);
    }
  }

  const forcedCrosses = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== BLANK || beeCounts[r][c] !== 0) continue;
      const rowOpen = openCount(board, Array.from({ length: n }, (_, cc) => [r, cc]));
      const colOpen = openCount(board, Array.from({ length: n }, (_, rr) => [rr, c]));
      const regionOpen = openCount(board, regions.get(regionGrid[r][c]) || []);
      forcedCrosses.push({ r, c, type: "cross", src: "completion-elimination", rank: [Math.min(rowOpen, colOpen, regionOpen), regionOpen, rowOpen + colOpen, r, c] });
    }
  }
  forcedCrosses.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
    return 0;
  });
  if (forcedCrosses.length) {
    const { rank, ...step } = forcedCrosses[0];
    return step;
  }

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === BLANK && beeCounts[r][c] === solutionCount) {
        return { r, c, type: "bee", src: "completion-single" };
      }
    }
  }
  return null;
}
