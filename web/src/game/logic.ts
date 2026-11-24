export const COLORS = ["red", "blue", "yellow", "green", "purple", "orange"] as const;

export type DotColor = (typeof COLORS)[number];

export type Cell = DotColor | null;

export type Grid = Cell[][];

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

export function isEdge(grid: Grid, row: number, col: number): boolean {
  if (grid[row]?.[col] == null) return false;
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  for (const [dr, dc] of NEIGHBORS) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nc < 0 || nr >= height || nc >= width || grid[nr][nc] == null) return true;
  }
  return false;
}

export function remainingCount(grid: Grid): number {
  let count = 0;
  for (const row of grid) for (const cell of row) if (cell) count += 1;
  return count;
}

export function colorsOnBoard(grid: Grid): DotColor[] {
  const found = new Set<DotColor>();
  for (const row of grid) for (const cell of row) if (cell) found.add(cell);
  return COLORS.filter((color) => found.has(color));
}

export function hammer(
  grid: Grid,
  colors: readonly DotColor[],
): { grid: Grid; removed: { row: number; col: number; color: DotColor }[] } {
  const wanted = new Set(colors);
  const next = cloneGrid(grid);
  const removed: { row: number; col: number; color: DotColor }[] = [];
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      const color = grid[row][col];
      if (color && wanted.has(color) && isEdge(grid, row, col)) {
        next[row][col] = null;
        removed.push({ row, col, color });
      }
    }
  }
  return { grid: next, removed };
}

export function wipeColor(grid: Grid, color: DotColor): { grid: Grid; removed: number } {
  const next = cloneGrid(grid);
  let removed = 0;
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      if (next[row][col] === color) {
        next[row][col] = null;
        removed += 1;
      }
    }
  }
  return { grid: next, removed };
}

/** A valid send-order. Each step clears every current edge of one color. */
export function solve(grid: Grid): DotColor[] {
  const working = cloneGrid(grid);
  const sequence: DotColor[] = [];
  for (let guard = 0; guard < 500; guard += 1) {
    if (remainingCount(working) === 0) return sequence;
    let best: DotColor | null = null;
    let bestCount = 0;
    for (const color of COLORS) {
      let count = 0;
      for (let row = 0; row < working.length; row += 1) {
        for (let col = 0; col < working[row].length; col += 1) {
          if (working[row][col] === color && isEdge(working, row, col)) count += 1;
        }
      }
      if (count > bestCount) {
        best = color;
        bestCount = count;
      }
    }
    if (!best) break;
    sequence.push(best);
    const result = hammer(working, [best]);
    for (let row = 0; row < working.length; row += 1) working[row] = result.grid[row];
  }
  return sequence;
}
