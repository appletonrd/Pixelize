import { cloneGrid, solve, type DotColor, type Grid } from "@/game/logic";

const LETTER: Record<string, DotColor | null> = {
  R: "red",
  U: "blue",
  Y: "yellow",
  G: "green",
  P: "purple",
  O: "orange",
  ".": null,
};

function parse(rows: string[]): Grid {
  return rows.map((row) => [...row].map((ch) => LETTER[ch] ?? null));
}

const TEMPLATES: Grid[] = [
  parse(["UUUUUU", "URRRRU", "URYRRU", "URYRRU", "URRRRU", "UUUUUU"]),
  parse([
    ".RRRRRR.",
    "RRRYYRRR",
    "RRYYYYRR",
    "RRRYYRRR",
    ".RRRRRR.",
    "..RRRR..",
    "...GG...",
    "....G...",
  ]),
  parse([
    "...YYYY...",
    "..YYYYYY..",
    ".YYYYYYYY.",
    "RRRRRRRRRR",
    "RRUUUUUURR",
    "RRURRRRRUR",
    "RRUROOORUR",
    "RRURRRRRUR",
    "RRUUUUUUUR",
    "RRRRRRRRRR",
  ]),
  parse([
    "..YYYYYY..",
    ".YUUYYUUY.",
    "YYYYYYYYYY",
    "YYRYYYRYYY",
    ".YYYOOYYY.",
    "..YYOOYY..",
    "...YYYY...",
    "....YY....",
  ]),
  parse([
    "....GG....",
    "...GGGG...",
    "..GGRRGG..",
    ".GGGRRRGG.",
    "GGGRRRRGGG",
    ".OOORRROO.",
    "..OORROO..",
    "...OOOO...",
    "....OO....",
  ]),
  parse([
    "..PPPPPP..",
    ".PPUUUUPP.",
    "PPUYYYYUPP",
    "PPUYYYYUPP",
    ".PPUUUUPP.",
    "..PPPPPP..",
    "...OOOO...",
    "..OOOOOO..",
    "...OOOO...",
  ]),
];

const BORDER_CYCLE: DotColor[] = ["orange", "purple", "green", "blue", "red", "yellow"];

function withBorder(grid: Grid, color: DotColor): Grid {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const next: Grid = [];
  for (let row = 0; row < height + 2; row += 1) {
    const line: Grid[number] = [];
    for (let col = 0; col < width + 2; col += 1) {
      if (row === 0 || col === 0 || row === height + 1 || col === width + 1) line.push(color);
      else line.push(grid[row - 1][col - 1]);
    }
    next.push(line);
  }
  return next;
}

export type WorkerPiece = {
  id: string;
  colors: DotColor[];
};

export type LevelData = {
  level: number;
  grid: Grid;
  rows: WorkerPiece[][];
};

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let pieceSerial = 1;

function piece(colors: DotColor[], rand: () => number): WorkerPiece {
  pieceSerial += 1;
  return { id: `w${pieceSerial}-${Math.floor(rand() * 1e6)}`, colors };
}

export function buildLevel(level: number): LevelData {
  const index = (level - 1) % TEMPLATES.length;
  let grid = cloneGrid(TEMPLATES[index]);
  const rings = Math.floor((level - 1) / TEMPLATES.length);
  for (let ring = 0; ring < rings; ring += 1) {
    grid = withBorder(grid, BORDER_CYCLE[(index + ring) % BORDER_CYCLE.length]);
  }

  const sequence = solve(grid);
  const rand = mulberry32(level * 9973 + 17);
  const bag = sequence.slice();
  const used = new Set(sequence);
  for (const color of used) bag.push(color);

  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = bag[i];
    bag[i] = bag[j];
    bag[j] = swap;
  }

  const rows: WorkerPiece[][] = [[], [], [], [], []];
  bag.forEach((color, i) => {
    rows[i % 5].push(piece([color], rand));
  });

  return { level, grid, rows };
}

export const PROGRESS_MAX = 100;
export const POINTS_PER_LEVEL = 40;

export function coinsFor(level: number): number {
  return 8 + level * 2;
}
