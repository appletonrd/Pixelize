import type { Grid } from "@/game/logic";

export type Face = "right" | "left" | "up" | "down";

export type CellNode = { r: number; c: number };

export type Leg = {
  tx: number;
  ty: number;
  face: Face;
  ms: number;
};

export type Board = {
  cols: number;
  rows: number;
  gridLeft: number;
  gridTop: number;
  cellW: number;
  cellH: number;
  frameLeft: number;
  frameTop: number;
  frameRight: number;
  frameBottom: number;
  originX: number;
  originY: number;
  rigW: number;
  rigH: number;
  gateLeft: number;
  gateTop: number;
  gateW: number;
  gateH: number;
};

const STEP = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function rigSize(cellW: number, cellH: number, road = Number.POSITIVE_INFINITY) {
  const base = Math.min(cellW, cellH);
  let rigW = Math.min(54, Math.max(34, base * 1.5));
  if (Number.isFinite(road)) rigW = Math.min(rigW, Math.max(24, road * 0.92));
  const rigH = Math.min(40, Math.max(18, rigW * 0.74));
  return { rigW, rigH };
}

export function loadSize(rigW: number, cellW: number, cellH: number) {
  const cell = Math.min(cellW, cellH);
  return Math.max(5, Math.min(cell * 0.9, rigW * 0.42));
}

export function dotSize(board: Board) {
  return loadSize(board.rigW, board.cellW, board.cellH);
}

function inside(board: Board, r: number, c: number) {
  return r >= 0 && c >= 0 && r < board.rows && c < board.cols;
}

function onMargin(board: Board, r: number, c: number) {
  return r >= -1 && c >= -1 && r <= board.rows && c <= board.cols && !inside(board, r, c);
}

export function walkable(grid: Grid, board: Board, r: number, c: number) {
  if (onMargin(board, r, c)) return true;
  if (!inside(board, r, c)) return false;
  return grid[r][c] == null;
}

export function nodeCenter(board: Board, node: CellNode) {
  const gridRight = board.gridLeft + board.cols * board.cellW;
  const gridBottom = board.gridTop + board.rows * board.cellH;
  let x: number;
  let y: number;
  if (node.c <= -1) x = (board.frameLeft + board.gridLeft) / 2;
  else if (node.c >= board.cols) x = (gridRight + board.frameRight) / 2;
  else x = board.gridLeft + (node.c + 0.5) * board.cellW;
  if (node.r <= -1) y = (board.frameTop + board.gridTop) / 2;
  else if (node.r >= board.rows) y = (gridBottom + board.frameBottom) / 2;
  else y = board.gridTop + (node.r + 0.5) * board.cellH;
  return { x, y };
}

export function nodePose(board: Board, node: CellNode) {
  const center = nodeCenter(board, node);
  return {
    tx: center.x - board.originX - board.rigW / 2,
    ty: center.y - board.originY - board.rigH / 2,
  };
}

export function nudgePose(board: Board, node: CellNode, face: Face) {
  const base = nodePose(board, node);
  const stepX = board.cellW * 0.33;
  const stepY = board.cellH * 0.33;
  if (face === "right") return { tx: base.tx + stepX, ty: base.ty };
  if (face === "left") return { tx: base.tx - stepX, ty: base.ty };
  if (face === "down") return { tx: base.tx, ty: base.ty + stepY };
  return { tx: base.tx, ty: base.ty - stepY };
}

export function gatePose(board: Board) {
  const mouth = board.gateLeft + 8;
  return {
    tx: mouth - board.originX - board.rigW / 2,
    ty: board.gateTop + board.gateH / 2 - board.originY - board.rigH / 2,
  };
}

export function bottomNode(board: Board, screenX: number): CellNode {
  const gridRight = board.gridLeft + board.cols * board.cellW;
  if (screenX <= board.gridLeft) return { r: board.rows, c: -1 };
  if (screenX >= gridRight) return { r: board.rows, c: board.cols };
  const col = Math.max(0, Math.min(board.cols - 1, Math.floor((screenX - board.gridLeft) / board.cellW)));
  return { r: board.rows, c: col };
}

export function gateNode(board: Board): CellNode {
  const gy = board.gateTop + board.gateH / 2;
  let bestR = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let r = -1; r <= board.rows; r += 1) {
    const dist = Math.abs(nodeCenter(board, { r, c: board.cols }).y - gy);
    if (dist < best) {
      best = dist;
      bestR = r;
    }
  }
  return { r: bestR, c: board.cols };
}

export function approaches(grid: Grid, board: Board, dot: { row: number; col: number }) {
  const options: { node: CellNode; face: Face }[] = [
    { node: { r: dot.row, c: dot.col - 1 }, face: "right" },
    { node: { r: dot.row + 1, c: dot.col }, face: "up" },
    { node: { r: dot.row - 1, c: dot.col }, face: "down" },
    { node: { r: dot.row, c: dot.col + 1 }, face: "left" },
  ];
  return options.filter((option) => walkable(grid, board, option.node.r, option.node.c));
}

function idOf(node: CellNode) {
  return `${node.r},${node.c}`;
}

export function findPath(grid: Grid, board: Board, from: CellNode, to: CellNode): CellNode[] | null {
  if (!walkable(grid, board, from.r, from.c) || !walkable(grid, board, to.r, to.c)) return null;
  if (from.r === to.r && from.c === to.c) return [from];
  const queue: CellNode[] = [from];
  const prev = new Map<string, string | null>();
  prev.set(idOf(from), null);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const [dr, dc] of STEP) {
      const next = { r: current.r + dr, c: current.c + dc };
      const id = idOf(next);
      if (prev.has(id) || !walkable(grid, board, next.r, next.c)) continue;
      prev.set(id, idOf(current));
      if (next.r === to.r && next.c === to.c) {
        const path = [next];
        let cursor: string | null = idOf(current);
        while (cursor) {
          const [r, c] = cursor.split(",").map(Number);
          path.push({ r, c });
          cursor = prev.get(cursor) ?? null;
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

function faceOf(dx: number, dy: number, fallback: Face): Face {
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 0.5) return dx > 0 ? "right" : "left";
  if (Math.abs(dy) > 0.5) return dy > 0 ? "down" : "up";
  return fallback;
}

function legMs(dx: number, dy: number) {
  return Math.round(Math.min(760, Math.max(180, Math.hypot(dx, dy) * 1.35)));
}

export function legsAlong(points: { tx: number; ty: number }[], fallback: Face): Leg[] {
  if (!points.length) return [];
  const unique: { tx: number; ty: number }[] = [];
  for (const point of points) {
    const last = unique[unique.length - 1];
    if (last && Math.abs(last.tx - point.tx) < 0.5 && Math.abs(last.ty - point.ty) < 0.5) continue;
    unique.push(point);
  }
  const straight = [unique[0]];
  for (let index = 1; index < unique.length; index += 1) {
    const prev = straight[straight.length - 1];
    const next = unique[index];
    if (Math.abs(next.tx - prev.tx) > 0.5 && Math.abs(next.ty - prev.ty) > 0.5) {
      straight.push({ tx: next.tx, ty: prev.ty });
    }
    straight.push(next);
  }
  const corners = [straight[0]];
  for (let index = 1; index < straight.length - 1; index += 1) {
    const before = corners[corners.length - 1];
    const current = straight[index];
    const after = straight[index + 1];
    const dx1 = Math.sign(current.tx - before.tx);
    const dy1 = Math.sign(current.ty - before.ty);
    const dx2 = Math.sign(after.tx - current.tx);
    const dy2 = Math.sign(after.ty - current.ty);
    if (dx1 !== dx2 || dy1 !== dy2) corners.push(current);
  }
  if (straight.length > 1) corners.push(straight[straight.length - 1]);
  const legs: Leg[] = [];
  let face = fallback;
  for (let index = 1; index < corners.length; index += 1) {
    const dx = corners[index].tx - corners[index - 1].tx;
    const dy = corners[index].ty - corners[index - 1].ty;
    face = faceOf(dx, dy, face);
    legs.push({ tx: corners[index].tx, ty: corners[index].ty, face, ms: legMs(dx, dy) });
  }
  return legs;
}
