import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { applyMusic, sfx, unlockAudio } from "@/game/audio";
import {
  approaches,
  bottomNode,
  dotSize,
  loadSize,
  findPath,
  gateNode,
  gatePose,
  legsAlong,
  nodePose,
  nudgePose,
  rigSize,
  type Board,
  type CellNode,
  type Face,
  type Leg,
} from "@/game/drive";
import { buildLevel, buildPicture, coinsFor, POINTS_PER_LEVEL, PROGRESS_MAX, type WorkerPiece } from "@/game/levels";
import { cloneGrid, colorRemains, colorsOnBoard, hammer, remainingCount, type DotColor, type Grid } from "@/game/logic";
import { PICTURES } from "@/game/pictures";
import { grantClear, loadSave, writeSave, type Save, type Settings, type TokenKind } from "@/game/store";

const SWATCH: Record<string, string> = {
  red: "#ff4b4b",
  blue: "#3aa0ff",
  yellow: "#ffd23a",
  green: "#3dce73",
  purple: "#b06bff",
  orange: "#ff8a2a",
};

function swatch(color: string) {
  return SWATCH[color] ?? color;
}

const WORKER_SRC: Record<string, string> = {
  red: "/art/worker-red.png",
  blue: "/art/worker-blue.png",
  yellow: "/art/worker-yellow.png",
  green: "/art/worker-green.png",
  purple: "/art/worker-purple.png",
  orange: "/art/worker-orange.png",
};

const TOKEN_META: Record<TokenKind, { src: string; name: string; blurb: string }> = {
  dual: {
    src: "/art/token-dual.png",
    name: "Two-tone worker",
    blurb: "Two colors at once.",
  },
  box: {
    src: "/art/token-box.png",
    name: "Extra bay",
    blurb: "One more forklift.",
  },
  wipe: {
    src: "/art/token-wipe.png",
    name: "Color wipe",
    blurb: "Clears one color.",
  },
};

type Phase = "walk" | "drive" | "wait" | "roll" | "load" | "drop" | "leave";
type Job = "pick" | "haul" | "home" | "hold";
type Spot = { row: number; col: number; color: DotColor };

type Actor = {
  id: string;
  piece: WorkerPiece;
  lane: number;
  phase: Phase;
  phaseStartedAt: number;
  skipWalk: boolean;
  spots: Spot[] | null;
  tx: number;
  ty: number;
  face: Face;
  legs: Leg[];
  legMs: number;
  job: Job;
  node: CellNode | null;
  goal: CellNode | null;
  target: Spot | null;
  armed: boolean;
  cargo: DotColor | null;
};

type PendingDot = {
  id: string;
  row: number;
  col: number;
  color: DotColor;
  at: number;
};

type Flight = {
  id: string;
  color: DotColor;
  x: number;
  y: number;
  size: number;
  dx: number;
  dy: number;
  born: number;
  ms: number;
};

type Run = {
  id: string;
  level: number;
  grid: Grid;
  rows: WorkerPiece[][];
  forks: number;
  actors: Actor[];
  pending: PendingDot[];
  flights: Flight[];
  bumped: number[];
  note: string;
  won: boolean;
  lost: boolean;
  picture: string | null;
  pictureId: string | null;
  token: TokenKind | null;
  coinsGain: number;
};

const TICK = { walk: 620, drive: 560, load: 240, drop: 240, leave: 400 };
const ON_ROAD = new Set<Phase>(["roll", "load", "drop"]);
const claimedWins = new Set<string>();
type Screen = "splash" | "menu" | "game";

function startRun(level: number): Run {
  const built = buildLevel(level);
  return {
    id: `${level}-${Date.now()}`,
    level,
    grid: built.grid,
    rows: built.rows,
    forks: 5,
    actors: [],
    pending: [],
    flights: [],
    bumped: [0, 0, 0, 0, 0],
    note: "",
    won: false,
    lost: false,
    picture: null,
    pictureId: null,
    token: null,
    coinsGain: 0,
  };
}

function startPicture(id: string): Run {
  const picture = PICTURES.find((entry) => entry.id === id) ?? PICTURES[0];
  const built = buildPicture(picture);
  return {
    id: `pic-${picture.id}-${Date.now()}`,
    level: 0,
    grid: built.grid,
    rows: built.rows,
    forks: 5,
    actors: [],
    pending: [],
    flights: [],
    bumped: [0, 0, 0, 0, 0],
    note: "",
    won: false,
    lost: false,
    picture: picture.title,
    pictureId: picture.id,
    token: null,
    coinsGain: 0,
  };
}

function phaseLimit(actor: Actor): number {
  switch (actor.phase) {
    case "walk":
      return actor.skipWalk ? 0 : TICK.walk;
    case "drive":
      return actor.armed ? actor.legMs : 0;
    case "wait":
      return Number.POSITIVE_INFINITY;
    case "roll":
      return actor.legMs;
    case "load":
      return TICK.load;
    case "drop":
      return TICK.drop;
    case "leave":
      return TICK.leave;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

type WorldView = {
  board: (lane: number, cols: number, rows: number) => Board | null;
  waitPose: (lane: number, cols: number, rows: number) => { tx: number; ty: number };
  toGate: (dot: PendingDot) => Flight | null;
  toFork: (dot: Spot, lane: number, face: Face, tx: number, ty: number, cols: number, rows: number) => Flight | null;
};

function freshActor(piece: WorkerPiece, lane: number, phase: Phase): Actor {
  return {
    id: piece.id,
    piece,
    lane,
    phase,
    phaseStartedAt: performance.now(),
    skipWalk: phase !== "walk",
    spots: null,
    tx: 0,
    ty: 0,
    face: "right",
    legs: [],
    legMs: 0,
    job: "pick",
    node: null,
    goal: null,
    target: null,
    armed: false,
    cargo: null,
  };
}

function withLeg(actor: Actor, legs: Leg[], job: Job, goal: CellNode | null, now: number): Actor {
  const [first, ...rest] = legs;
  if (!first) {
    const phase: Phase = job === "pick" ? "load" : job === "haul" ? "drop" : job === "hold" ? "wait" : "leave";
    return { ...actor, phase, job, goal, node: goal, legs: [], legMs: 0, phaseStartedAt: now };
  }
  return {
    ...actor,
    phase: "roll",
    job,
    goal,
    legs: rest,
    tx: first.tx,
    ty: first.ty,
    face: first.face,
    legMs: first.ms,
    phaseStartedAt: now,
    armed: true,
  };
}

function reachableSpots(grid: Grid, board: Board, colors: DotColor[], from: CellNode) {
  return hammer(grid, colors).removed.filter((dot) =>
    approaches(grid, board, dot).some((side) => findPath(grid, board, from, side.node)),
  );
}

function nearestSpot(grid: Grid, board: Board, spots: Spot[], from: CellNode) {
  let best: { spot: Spot; node: CellNode; face: Face; path: CellNode[] } | null = null;
  const rank = (face: Face) => (face === "left" ? 3 : face === "down" ? 2 : face === "up" ? 1 : 0);
  for (const spot of spots) {
    if (grid[spot.row]?.[spot.col] !== spot.color) continue;
    for (const side of approaches(grid, board, spot)) {
      const path = findPath(grid, board, from, side.node);
      if (!path) continue;
      if (!best || path.length < best.path.length || (path.length === best.path.length && rank(side.face) < rank(best.face))) {
        best = { spot, node: side.node, face: side.face, path };
      }
    }
  }
  return best;
}

function posePoints(board: Board, path: CellNode[]) {
  return path.map((node) => nodePose(board, node));
}

function pickupLegs(board: Board, grid: Grid, actor: Actor, choice: NonNullable<ReturnType<typeof nearestSpot>>) {
  const points = [{ tx: actor.tx, ty: actor.ty }];
  if (!actor.node) {
    const start = bottomNode(board, board.originX + board.rigW / 2);
    points.push(nodePose(board, start));
    const path = findPath(grid, board, start, choice.node) ?? [start, choice.node];
    points.push(...posePoints(board, path.slice(1)));
  } else {
    points.push(nodePose(board, actor.node));
    points.push(...posePoints(board, choice.path.slice(1)));
  }
  points.push(nudgePose(board, choice.node, choice.face));
  const legs = legsAlong(points, actor.face);
  if (legs.length) legs[legs.length - 1] = { ...legs[legs.length - 1], face: choice.face };
  return legs;
}

function haulLegs(board: Board, grid: Grid, actor: Actor) {
  const dock = gateNode(board);
  const parked = gatePose(board);
  const points = [{ tx: actor.tx, ty: actor.ty }];
  if (actor.node) {
    points.push(nodePose(board, actor.node));
    const path = findPath(grid, board, actor.node, dock) ?? [actor.node, dock];
    points.push(...posePoints(board, path.slice(1)));
  }
  const dockPose = nodePose(board, dock);
  points.push({ tx: dockPose.tx, ty: parked.ty });
  points.push(parked);
  return legsAlong(points, "right");
}

function homeLegs(board: Board, grid: Grid, actor: Actor) {
  const laneNode = bottomNode(board, board.originX + board.rigW / 2);
  const points = [{ tx: actor.tx, ty: actor.ty }];
  if (actor.node) {
    points.push(nodePose(board, actor.node));
    const path = findPath(grid, board, actor.node, laneNode) ?? [actor.node, laneNode];
    points.push(...posePoints(board, path.slice(1)));
  } else {
    points.push(nodePose(board, laneNode));
  }
  const lanePose = nodePose(board, laneNode);
  points.push({ tx: 0, ty: lanePose.ty });
  points.push({ tx: 0, ty: 0 });
  return legsAlong(points, actor.face);
}

function missHome(actor: Actor, now: number): Actor {
  return withLeg(actor, legsAlong([{ tx: actor.tx, ty: actor.ty }, { tx: 0, ty: 0 }], "down"), "home", null, now);
}

function parkHold(actor: Actor, board: Board, grid: Grid, now: number): Actor {
  if (!colorRemains(grid, actor.piece.colors)) {
    return withLeg({ ...actor, spots: null, target: null, cargo: null }, homeLegs(board, grid, actor), "home", null, now);
  }
  if (actor.phase === "wait" && actor.tx === 0 && actor.ty === 0) return actor;
  return withLeg({ ...actor, spots: null, target: null, cargo: null }, homeLegs(board, grid, actor), "hold", null, now);
}

function startPick(actor: Actor, grid: Grid, view: WorldView, cols: number, rows: number, now: number, _onSound: (kind: "hammer" | "miss") => void) {
  const board = view.board(actor.lane, cols, rows);
  if (!board) {
    if (actor.phase === "wait") return { actor, note: "" };
    return { actor: { ...actor, phase: "wait" as const, phaseStartedAt: now, armed: true }, note: "" };
  }
  const from = actor.node ?? bottomNode(board, board.originX + board.rigW / 2);
  const spots = reachableSpots(grid, board, actor.piece.colors, from);
  const choice = nearestSpot(grid, board, spots, from);
  if (!choice) return { actor: parkHold(actor, board, grid, now), note: "" };
  const next = { ...actor, spots, target: choice.spot };
  return { actor: withLeg(next, pickupLegs(board, grid, next, choice), "pick", choice.node, now), note: "" };
}

function stepWorld(prev: Run, now: number, view: WorldView, onSound: (kind: "hammer" | "miss") => void): Run {
  if (prev.lost) return prev;
  const due = prev.pending.filter((dot) => dot.at <= now);
  let pending = prev.pending.filter((dot) => dot.at > now);
  const flights = prev.flights.filter((flight) => now - flight.born < flight.ms + 40);
  let grid = prev.grid;
  if (due.length) {
    grid = cloneGrid(prev.grid);
    for (const dot of due) {
      if (grid[dot.row]?.[dot.col] === dot.color) {
        grid[dot.row][dot.col] = null;
        const flight = view.toGate(dot);
        if (flight) flights.push(flight);
      }
    }
  }
  const cols = grid[0]?.length ?? 1;
  const rows = grid.length;
  const actors = prev.actors.map((actor) => ({ ...actor }));
  const gone = new Set<string>();
  let note = prev.note;
  let moved = false;
  const roadBusy = () => actors.some((actor) => !gone.has(actor.id) && ON_ROAD.has(actor.phase));
  const order = actors
    .map((actor, index) => ({ actor, index }))
    .sort((a, b) => {
      const ar = ON_ROAD.has(a.actor.phase) ? 0 : 1;
      const br = ON_ROAD.has(b.actor.phase) ? 0 : 1;
      return ar - br || a.actor.phaseStartedAt - b.actor.phaseStartedAt;
    });
  const replace = (index: number, next: Actor | null) => {
    moved = true;
    if (!next) gone.add(actors[index].id);
    else actors[index] = next;
  };

  for (const { actor, index } of order) {
    if (gone.has(actor.id) || actor.phase === "wait") continue;
    if (now - actor.phaseStartedAt < phaseLimit(actor)) continue;
    if (actor.phase === "leave") {
      replace(index, null);
      continue;
    }
    if (actor.phase === "walk") {
      replace(index, { ...actor, phase: "drive", phaseStartedAt: now, armed: false });
      continue;
    }
    if (actor.phase === "drive" && !actor.armed) {
      replace(index, {
        ...actor,
        ...view.waitPose(actor.lane, cols, rows),
        face: "up",
        legMs: TICK.drive,
        armed: true,
        phaseStartedAt: now,
      });
      continue;
    }
    if (actor.phase === "drive") {
      if (roadBusy()) replace(index, { ...actor, phase: "wait", phaseStartedAt: now, armed: true });
      else {
        const started = startPick(actor, grid, view, cols, rows, now, onSound);
        if (started.note) note = started.note;
        if (started.actor !== actor) replace(index, started.actor);
      }
      continue;
    }
    if (actor.phase === "roll") {
      if (actor.legs.length) {
        const [first, ...rest] = actor.legs;
        replace(index, { ...actor, legs: rest, tx: first.tx, ty: first.ty, face: first.face, legMs: first.ms, phaseStartedAt: now });
        continue;
      }
      const arrived = { ...actor, node: actor.goal, legs: [] };
      if (actor.job === "pick") {
        const board = view.board(actor.lane, cols, rows);
        const spot = actor.target;
        if (!board || !spot || grid[spot.row]?.[spot.col] !== spot.color) {
          const from = arrived.node ?? (board ? bottomNode(board, board.originX + board.rigW / 2) : null);
          const choice = board && from ? nearestSpot(grid, board, actor.spots ?? [], from) : null;
          if (choice && board) {
            replace(index, withLeg({ ...arrived, target: choice.spot }, pickupLegs(board, grid, arrived, choice), "pick", choice.node, now));
          } else if (board) {
            const held = parkHold(arrived, board, grid, now);
            if (held !== arrived) replace(index, held);
          }
          continue;
        }
        if (grid === prev.grid) grid = cloneGrid(grid);
        grid[spot.row][spot.col] = null;
        const flight = view.toFork(spot, actor.lane, actor.face, actor.tx, actor.ty, cols, rows);
        if (flight) flights.push(flight);
        onSound("hammer");
        const remaining = (actor.spots ?? []).filter((item) => item.row !== spot.row || item.col !== spot.col);
        replace(index, { ...arrived, phase: "load", spots: remaining, target: spot, cargo: null, phaseStartedAt: now });
        continue;
      }
      if (actor.job === "haul") {
        replace(index, { ...arrived, phase: "drop", phaseStartedAt: now });
        continue;
      }
      if (actor.job === "hold") {
        replace(index, {
          ...arrived,
          phase: "wait",
          node: null,
          goal: null,
          cargo: null,
          spots: null,
          target: null,
          tx: 0,
          ty: 0,
        });
        continue;
      }
      replace(index, { ...arrived, phase: "leave", phaseStartedAt: now, tx: 0, ty: 0, cargo: null });
      continue;
    }
    if (actor.phase === "load") {
      const board = view.board(actor.lane, cols, rows);
      const loaded = { ...actor, cargo: actor.target?.color ?? null, target: null };
      replace(index, board ? withLeg(loaded, haulLegs(board, grid, loaded), "haul", gateNode(board), now) : missHome(loaded, now));
      continue;
    }
    if (actor.phase === "drop") {
      const board = view.board(actor.lane, cols, rows);
      const from = actor.node ?? (board ? gateNode(board) : null);
      const pendingSpots = (actor.spots ?? []).filter((spot) => grid[spot.row]?.[spot.col] === spot.color);
      const choice = board && from ? nearestSpot(grid, board, pendingSpots, from) : null;
      if (board && choice && from) {
        const nextActor = { ...actor, spots: pendingSpots, cargo: null, node: from, target: choice.spot };
        replace(index, withLeg(nextActor, pickupLegs(board, grid, nextActor, choice), "pick", choice.node, now));
      } else if (board) {
        replace(index, parkHold({ ...actor, cargo: null, spots: null, node: from ?? actor.node }, board, grid, now));
      } else {
        replace(index, missHome({ ...actor, cargo: null }, now));
      }
    }
  }

  if (!roadBusy()) {
    const waiters = actors
      .map((actor, index) => ({ actor, index }))
      .filter(({ actor }) => !gone.has(actor.id) && actor.phase === "wait")
      .sort((a, b) => a.actor.phaseStartedAt - b.actor.phaseStartedAt);
    for (const waiter of waiters) {
      const started = startPick(waiter.actor, grid, view, cols, rows, now, onSound);
      if (started.actor === waiter.actor) continue;
      if (started.note) note = started.note;
      replace(waiter.index, started.actor);
      break;
    }
  }

  const nextActors = actors.filter((actor) => !gone.has(actor.id));
  const sameFlights = !due.length && flights.length === prev.flights.length;
  const samePending = !due.length && pending.length === prev.pending.length;
  if (!moved && sameFlights && samePending && grid === prev.grid && note === prev.note) return prev;
  return { ...prev, grid, actors: nextActors, pending, flights, note };
}

function openFork(run: Run): number {
  for (let lane = run.forks - 1; lane >= 5; lane -= 1) {
    if (!run.actors.some((actor) => actor.lane === lane)) return lane;
  }
  for (let lane = 0; lane < Math.min(5, run.forks); lane += 1) {
    if (!run.actors.some((actor) => actor.lane === lane)) return lane;
  }
  return -1;
}

function cellBox(gridEl: HTMLElement, cols: number, rows: number, dot: { row: number; col: number }) {
  const gridBox = gridEl.getBoundingClientRect();
  const cellW = gridBox.width / cols;
  const cellH = gridBox.height / rows;
  return { x: gridBox.left + dot.col * cellW, y: gridBox.top + dot.row * cellH, w: cellW, h: cellH };
}

function measureFlight(
  shell: HTMLElement | null,
  gridEl: HTMLElement | null,
  gate: HTMLElement | null,
  cols: number,
  rows: number,
  dot: PendingDot,
  born: number,
): Flight | null {
  if (!shell || !gridEl || !gate || cols < 1 || rows < 1) return null;
  const shellBox = shell.getBoundingClientRect();
  const gateBox = gate.getBoundingClientRect();
  const cell = cellBox(gridEl, cols, rows, dot);
  const size = Number.parseFloat(getComputedStyle(shell).getPropertyValue("--dot")) || Math.max(8, Math.min(cell.w, cell.h) * 0.72);
  const x = cell.x + (cell.w - size) / 2 - shellBox.left;
  const y = cell.y + (cell.h - size) / 2 - shellBox.top;
  const gx = gateBox.left - shellBox.left + gateBox.width * 0.55;
  const gy = gateBox.top - shellBox.top + gateBox.height * 0.55;
  return { id: dot.id, color: dot.color, x, y, size, dx: gx - x, dy: gy - y, born, ms: 420 };
}

export function PixelizeApp() {
  const [ready, setReady] = useState(false);
  const [save, setSave] = useState<Save | null>(null);
  const [screen, setScreen] = useState<Screen>("splash");
  const [splashText, setSplashText] = useState("The yard is opening…");
  const [run, setRun] = useState<Run | null>(null);
  const [panel, setPanel] = useState<"settings" | "shop" | "pouch" | "wipe" | null>(null);
  const [shake, setShake] = useState(false);
  const saveRef = useRef<Save | null>(null);
  const runRef = useRef<Run | null>(null);

  const commitRun = useCallback((update: (prev: Run | null) => Run | null) => {
    const next = update(runRef.current);
    if (next === runRef.current) return;
    runRef.current = next;
    setRun(next);
  }, []);

  useEffect(() => {
    const loaded = loadSave();
    saveRef.current = loaded;
    setSave(loaded);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setScreen("menu"), 2100);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (!save) return;
    applyMusic(save.settings);
  }, [save]);

  const commit = useCallback((next: Save) => {
    saveRef.current = next;
    setSave(next);
    writeSave(next);
  }, []);

  const patchSettings = (partial: Partial<Settings>) => {
    if (!save) return;
    unlockAudio();
    commit({ ...save, settings: { ...save.settings, ...partial } });
  };

  const openPicture = (id: string) => {
    if (!save) return;
    const picture = PICTURES.find((entry) => entry.id === id);
    if (!picture) return;
    unlockAudio();
    sfx.tap(save.settings);
    setPanel(null);
    setSplashText(picture.title);
    setScreen("splash");
    window.setTimeout(() => {
      commitRun(() => startPicture(id));
      setScreen("game");
    }, 1500);
  };

  const openLevel = () => {
    if (!save) return;
    unlockAudio();
    sfx.tap(save.settings);
    setPanel(null);
    setSplashText(`Rolling out level ${save.level}…`);
    setScreen("splash");
    const level = save.level;
    window.setTimeout(() => {
      commitRun(() => startRun(level));
      setScreen("game");
    }, 1500);
  };

  const awarded = useRef(false);

  useEffect(() => {
    if (!run || run.won || run.actors.length > 0 || run.pending.length > 0 || run.flights.length > 0 || remainingCount(run.grid) !== 0) {
      if (run && remainingCount(run.grid) !== 0) awarded.current = false;
      return;
    }
    if (awarded.current || claimedWins.has(run.id)) return;
    awarded.current = true;
    claimedWins.add(run.id);
    const current = saveRef.current;
    if (!current) return;
    const coins = run.pictureId ? coinsFor(Math.max(1, current.level)) : coinsFor(run.level);
    const { save: next, token } = grantClear(current, coins, run.pictureId ? null : run.level + 1);
    commit(next);
    sfx.win(next.settings);
    if (token) sfx.token(next.settings);
    commitRun((prev) => {
      if (!prev || prev.won) return prev;
      return { ...prev, won: true, token, coinsGain: prev.pictureId ? coinsFor(Math.max(1, current.level)) : coinsFor(prev.level) };
    });
  }, [run, commit, commitRun]);

  const sendWorker = (lane: number) => {
    const current = runRef.current;
    const settings = saveRef.current?.settings;
    if (!current || !settings || current.won || current.lost) return;
    unlockAudio();
    const piece = current.rows[lane]?.[0];
    if (!piece) return;
    if (current.actors.some((actor) => actor.lane === lane)) {
      setShake(true);
      window.setTimeout(() => setShake(false), 280);
      commitRun((prev) => (prev ? { ...prev, note: "That forklift is still out." } : prev));
      return;
    }
    sfx.load(settings);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    commitRun((prev) => {
      if (!prev || prev.won) return prev;
      if (prev.actors.some((actor) => actor.lane === lane)) return prev;
      const line = prev.rows[lane];
      if (!line?.length || line[0]?.id !== piece.id) return prev;
      const rows = prev.rows.map((entry) => entry.slice());
      rows[lane].shift();
      if (reduce && hammer(prev.grid, piece.colors).removed.length) {
        return { ...prev, grid: hammer(prev.grid, piece.colors).grid, rows, note: "" };
      }
      const bumped = prev.bumped.slice();
      bumped[lane] = (bumped[lane] ?? 0) + 1;
      const actor = freshActor(piece, lane, "walk");
      return { ...prev, rows, bumped, actors: [...prev.actors, actor], note: "" };
    });
  };

  const useToken = (kind: TokenKind) => {
    const current = runRef.current;
    if (!save || !current || current.won || current.lost) return;
    if (save.tokens[kind] <= 0) return;
    unlockAudio();
    if (kind === "box") {
      if (current.forks >= 6) {
        commitRun((prev) => (prev ? { ...prev, note: "The extra bay is already out." } : prev));
        return;
      }
      commit({ ...save, tokens: { ...save.tokens, box: save.tokens.box - 1 } });
      sfx.token(save.settings);
      commitRun((prev) => (prev ? { ...prev, forks: prev.forks + 1, note: "A sixth forklift rolls in." } : prev));
      return;
    }
    if (kind === "dual") {
      const lane = openFork(current);
      if (lane < 0) {
        commitRun((prev) => (prev ? { ...prev, note: "Every forklift is already out." } : prev));
        return;
      }
      const present = colorsOnBoard(current.grid);
      const pool = present.length ? present : (["red", "blue"] as DotColor[]);
      const first = pool[Math.floor(Math.random() * pool.length)];
      let second = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1) {
        while (second === first) second = pool[Math.floor(Math.random() * pool.length)];
      }
      const id = `dual-${Date.now()}`;
      commit({ ...save, tokens: { ...save.tokens, dual: save.tokens.dual - 1 } });
      sfx.token(save.settings);
      const actor = freshActor({ id, colors: [first, second] }, lane, "drive");
      commitRun((prev) => {
        if (!prev || prev.actors.some((entry) => entry.lane === lane)) return prev;
        return { ...prev, actors: [...prev.actors, actor], note: "Two-tone worker takes a forklift." };
      });
      return;
    }
    setPanel("wipe");
  };

  const confirmWipe = (color: DotColor) => {
    const current = runRef.current;
    if (!save || !current || current.lost || save.tokens.wipe <= 0) return;
    const dots: PendingDot[] = [];
    const started = performance.now();
    for (let row = 0; row < current.grid.length; row += 1) {
      for (let col = 0; col < current.grid[row].length; col += 1) {
        if (current.grid[row][col] === color) {
          dots.push({
            id: `wipe-${row}-${col}-${current.id}`,
            row,
            col,
            color,
            at: started + dots.length * 70,
          });
        }
      }
    }
    commit({ ...save, tokens: { ...save.tokens, wipe: save.tokens.wipe - 1 } });
    sfx.hammer(save.settings);
    setPanel(null);
    commitRun((prev) => (prev ? { ...prev, pending: [...prev.pending, ...dots], note: "" } : prev));
  };

  const buyCoins = (amount: number) => {
    if (!save) return;
    unlockAudio();
    sfx.coin(save.settings);
    commit({ ...save, coins: save.coins + amount });
  };

  const buyToken = () => {
    if (!save || save.coins < 45) return;
    unlockAudio();
    const kind = (["dual", "box", "wipe"] as const)[Math.floor(Math.random() * 3)];
    sfx.token(save.settings);
    commit({
      ...save,
      coins: save.coins - 45,
      tokens: { ...save.tokens, [kind]: save.tokens[kind] + 1 },
    });
  };

  if (!ready || !save) {
    return <Splash text="The yard is opening…" />;
  }

  return (
    <div
      className="min-h-dvh bg-ink text-ink"
      onPointerDown={() => {
        unlockAudio();
        applyMusic(save.settings);
      }}
    >
      {screen === "splash" ? <Splash text={splashText} /> : null}
      {screen === "menu" ? (
        <Menu
          save={save}
          onLevel={openLevel}
          onPicture={openPicture}
          onSettings={() => setPanel("settings")}
          onShop={() => setPanel("shop")}
          onPouch={() => setPanel("pouch")}
        />
      ) : null}
      {screen === "game" && run ? (
        <GameView
          key={run.id}
          run={run}
          save={save}
          shake={shake}
          commitRun={commitRun}
          onSend={sendWorker}
          onToken={useToken}
          onHome={() => {
            setScreen("menu");
            setPanel(null);
          }}
          onRestart={() => commitRun(() => (run.pictureId ? startPicture(run.pictureId) : startRun(run.level)))}
          onNext={() => {
            commitRun(() => null);
            setScreen("menu");
          }}
        />
      ) : null}

      {panel === "settings" ? (
        <Sheet title="Settings" onClose={() => setPanel(null)}>
          <Toggle label="Sound" on={save.settings.sound} onChange={(sound) => patchSettings({ sound })} />
          <Volume
            label="Sound level"
            value={save.settings.soundVol}
            disabled={!save.settings.sound}
            onChange={(soundVol) => patchSettings({ soundVol })}
          />
          <Toggle label="Music" on={save.settings.music} onChange={(music) => patchSettings({ music })} />
          <Volume
            label="Music level"
            value={save.settings.musicVol}
            disabled={!save.settings.music}
            onChange={(musicVol) => patchSettings({ musicVol })}
          />
        </Sheet>
      ) : null}

      {panel === "shop" ? (
        <Sheet title="Coin shed" onClose={() => setPanel(null)}>
          <p className="text-sm font-extrabold text-ink-soft">
            Demo shed. Nothing is charged. Packs just drop coins into this game.
          </p>
          <Pack amount={80} price="$0.99" onBuy={() => buyCoins(80)} />
          <Pack amount={250} price="$2.99" onBuy={() => buyCoins(250)} />
          <Pack amount={700} price="$6.99" onBuy={() => buyCoins(700)} />
        </Sheet>
      ) : null}

      {panel === "pouch" ? (
        <Sheet title="Bonus tokens" onClose={() => setPanel(null)}>
          {(["dual", "box", "wipe"] as const).map((kind) => (
            <TokenRow key={kind} kind={kind} count={save.tokens[kind]} />
          ))}
          <button
            type="button"
            disabled={save.coins < 45}
            onClick={buyToken}
            className="mt-2 rounded-2xl bg-amber px-4 py-3 text-base font-extrabold text-ink disabled:opacity-40"
          >
            Buy a random token · 45 coins
          </button>
        </Sheet>
      ) : null}

      {panel === "wipe" && run ? (
        <Sheet title="Pick a color" onClose={() => setPanel(null)}>
          <div className="flex flex-wrap gap-3">
            {colorsOnBoard(run.grid).map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => confirmWipe(color)}
                className="dot size-12"
                style={{ background: swatch(color) }}
                aria-label={color}
              />
            ))}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div className="relative h-dvh overflow-hidden">
      <img src="/art/splash.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="relative z-10 flex h-full flex-col items-center px-6 pt-[18dvh] text-center">
        <h1 className="title-stroke text-[4.4rem]">Pixelize</h1>
        <p className="mt-6 rounded-full bg-ink/70 px-4 py-2 text-sm font-extrabold text-cream">{text}</p>
      </div>
    </div>
  );
}

function Menu({
  save,
  onLevel,
  onPicture,
  onSettings,
  onShop,
  onPouch,
}: {
  save: Save;
  onLevel: () => void;
  onPicture: (id: string) => void;
  onSettings: () => void;
  onShop: () => void;
  onPouch: () => void;
}) {
  return (
    <div className="relative h-dvh overflow-hidden">
      <img src="/art/menu.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-ink/20" />
      <div className="relative z-10 mx-auto flex h-full max-w-[440px] flex-col px-4">
        <div className="flex items-start justify-between pt-4">
          <button
            type="button"
            onClick={onShop}
            className="flex items-center gap-2 rounded-full bg-cream py-1 pr-4 pl-1 shadow-lg"
            aria-label="Buy coins"
          >
            <img src="/art/bill.png" alt="" className="size-12 object-contain" />
            <span className="font-display text-2xl text-ink">{save.coins}</span>
          </button>
          <button
            type="button"
            onClick={onSettings}
            className="rounded-full bg-cream px-4 py-3 text-sm font-extrabold text-ink shadow-lg"
          >
            Settings
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto py-4">
          <h1 className="title-stroke text-6xl">Pixelize</h1>
          <button
            type="button"
            onClick={onLevel}
            className="rounded-full bg-coral px-10 py-4 font-display text-3xl text-cream shadow-lg"
          >
            Level {save.level}
          </button>
          {PICTURES.map((picture) => (
            <button
              key={picture.id}
              type="button"
              onClick={() => onPicture(picture.id)}
              className="rounded-full bg-cream px-6 py-2 text-center shadow-lg"
            >
              <span className="block font-display text-2xl text-ink">Masterpiece</span>
              <span className="block text-sm font-extrabold text-ink-soft">{picture.title}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onPouch}
            className="flex items-center gap-3 rounded-full bg-cream py-1 pr-5 pl-1 shadow-lg"
          >
            <img src="/art/token-dual.png" alt="" className="size-14 object-contain" />
            <span className="text-left text-sm leading-tight font-extrabold text-ink">
              Bonus tokens
              <span className="block text-ink-soft">
                {save.tokens.dual + save.tokens.box + save.tokens.wipe} in the pouch
              </span>
            </span>
          </button>
        </div>

        <div className="pb-6">
          <div className="mb-2 flex items-end justify-between text-sm font-extrabold text-cream">
            <span>Yard progress</span>
            <span>
              {save.progress}/{PROGRESS_MAX}
            </span>
          </div>
          <div className="h-4 overflow-hidden rounded-full bg-ink/70">
            <div
              className="h-full rounded-full bg-amber"
              style={{ width: `${Math.min(100, (save.progress / PROGRESS_MAX) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-center text-xs font-extrabold text-cream">
            Each cleared picture adds {POINTS_PER_LEVEL}. A full bar drops a bonus token.
          </p>
        </div>
      </div>
    </div>
  );
}

function GameView({
  run,
  save,
  shake,
  commitRun,
  onSend,
  onToken,
  onHome,
  onRestart,
  onNext,
}: {
  run: Run;
  save: Save;
  shake: boolean;
  commitRun: (update: (prev: Run | null) => Run | null) => void;
  onSend: (lane: number) => void;
  onToken: (kind: TokenKind) => void;
  onHome: () => void;
  onRestart: () => void;
  onNext: () => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const saveLive = useRef(save);
  saveLive.current = save;
  const height = run.grid.length;
  const width = run.grid[0]?.length ?? 1;
  const left = remainingCount(run.grid);

  const readBoard = (lane: number, cols: number, rows: number): Board | null => {
    const frame = frameRef.current;
    const gridEl = gridRef.current;
    const gate = gateRef.current;
    const laneEl = laneRefs.current[lane];
    if (!frame || !gridEl || !gate || !laneEl || cols < 1 || rows < 1) return null;
    const gridBox = gridEl.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const gateBox = gate.getBoundingClientRect();
    const laneBox = laneEl.getBoundingClientRect();
    const frameStyle = getComputedStyle(frame);
    const borderLeft = Number.parseFloat(frameStyle.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(frameStyle.borderRightWidth) || 0;
    const borderTop = Number.parseFloat(frameStyle.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(frameStyle.borderBottomWidth) || 0;
    const cellW = gridBox.width / cols;
    const cellH = gridBox.height / rows;
    const road = Math.min(
      gridBox.left - (frameBox.left + borderLeft),
      frameBox.right - borderRight - gridBox.right,
      gridBox.top - (frameBox.top + borderTop),
      frameBox.bottom - borderBottom - gridBox.bottom,
    );
    const sized = rigSize(cellW, cellH, Math.max(10, road));
    return {
      cols,
      rows,
      gridLeft: gridBox.left,
      gridTop: gridBox.top,
      cellW,
      cellH,
      frameLeft: frameBox.left + borderLeft,
      frameTop: frameBox.top + borderTop,
      frameRight: frameBox.right - borderRight,
      frameBottom: frameBox.bottom - borderBottom,
      originX: laneBox.left + laneBox.width / 2 - sized.rigW / 2,
      originY: laneBox.top + 4,
      rigW: sized.rigW,
      rigH: sized.rigH,
      gateLeft: gateBox.left,
      gateTop: gateBox.top,
      gateW: gateBox.width,
      gateH: gateBox.height,
    };
  };

  const jammed = forkliftsJammed(run, readBoard);

  useEffect(() => {
    if (!jammed) return;
    commitRun((prev) => (prev && !prev.lost && !prev.won ? { ...prev, lost: true, note: "" } : prev));
  }, [jammed, commitRun]);

  const measureLanes = () => {
    const gridEl = gridRef.current;
    const frame = frameRef.current;
    const dock = footerRef.current?.getBoundingClientRect().height ?? 92;
    if (gridEl && frame && shellRef.current) {
      const box = gridEl.getBoundingClientRect();
      const frameBox = frame.getBoundingClientRect();
      const frameStyle = getComputedStyle(frame);
      const borderLeft = Number.parseFloat(frameStyle.borderLeftWidth) || 0;
      const borderRight = Number.parseFloat(frameStyle.borderRightWidth) || 0;
      const borderTop = Number.parseFloat(frameStyle.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(frameStyle.borderBottomWidth) || 0;
      const cellW = box.width / Math.max(1, width);
      const cellH = box.height / Math.max(1, height);
      const road = Math.min(
        box.left - (frameBox.left + borderLeft),
        frameBox.right - borderRight - box.right,
        box.top - (frameBox.top + borderTop),
        frameBox.bottom - borderBottom - box.bottom,
      );
      const sized = rigSize(cellW, cellH, Math.max(10, road));
      shellRef.current.style.setProperty("--rig-w", `${sized.rigW}px`);
      shellRef.current.style.setProperty("--rig-h", `${sized.rigH}px`);
      shellRef.current.style.setProperty("--dot", `${loadSize(sized.rigW, cellW, cellH)}px`);
    }
    for (const laneEl of laneRefs.current) {
      if (!laneEl) continue;
      const laneBox = laneEl.getBoundingClientRect();
      const workerTop = laneBox.bottom - dock - 3 * 44 - 18;
      laneEl.style.setProperty("--walk", `${Math.max(8, workerTop - (laneBox.top + 28))}px`);
      laneEl.style.setProperty("--dock", `${dock}px`);
    }
  };

  useLayoutEffect(() => {
    measureLanes();
    const observer = new ResizeObserver(() => measureLanes());
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [run.forks, run.level, width, height]);

  useEffect(() => {
    let frame = 0;
    let alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      commitRun((prev) => {
        if (!prev) return prev;
        if (!prev.actors.length && !prev.pending.length && !prev.flights.length) return prev;
        const cols = prev.grid[0]?.length ?? 1;
        const rows = prev.grid.length;
        const view: WorldView = {
          board: readBoard,
          waitPose: (lane, laneCols, laneRows) => {
            const board = readBoard(lane, laneCols, laneRows);
            if (!board) return { tx: 0, ty: -36 };
            return { tx: 0, ty: Math.min(-12, board.frameBottom + 6 - board.originY) };
          },
          toGate: (dot) => measureFlight(shellRef.current, gridRef.current, gateRef.current, cols, rows, dot, now),
          toFork: (dot, lane, face, tx, ty, laneCols, laneRows) => {
            const board = readBoard(lane, laneCols, laneRows);
            const shell = shellRef.current;
            const gridEl = gridRef.current;
            if (!board || !shell || !gridEl) return null;
            const shellBox = shell.getBoundingClientRect();
            const cell = cellBox(gridEl, laneCols, laneRows, dot);
            const size = dotSize(board);
            const x = cell.x + (cell.w - size) / 2 - shellBox.left;
            const y = cell.y + (cell.h - size) / 2 - shellBox.top;
            const tip = forkTip(board, face, tx, ty);
            return {
              id: `${dot.row}-${dot.col}-${lane}`,
              color: dot.color,
              x,
              y,
              size,
              dx: tip.x - shellBox.left - x,
              dy: tip.y - shellBox.top - y,
              born: now,
              ms: TICK.load,
            };
          },
        };
        return stepWorld(prev, now, view, (kind) => {
          const settings = saveLive.current.settings;
          if (kind === "hammer") sfx.hammer(settings);
          else sfx.miss(settings);
        });
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [commitRun]);

  return (
    <div
      ref={shellRef}
      className="relative mx-auto flex h-dvh max-w-[440px] flex-col overflow-hidden bg-ink text-cream [--dock:5.75rem] [--dot:12px] [--peek:1.15rem] [--rig-h:26px] [--rig-w:36px] [--slot:2.75rem]"
    >
      <header className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onHome} className="rounded-full bg-ink-soft px-3 py-2 text-sm font-extrabold">
          Yard
        </button>
        <p className="max-w-[12rem] truncate text-center font-display text-xl">{run.picture ?? `Level ${run.level}`}</p>
        <p className="text-sm font-extrabold">{left} dots</p>
      </header>
      {run.note ? <p className="px-3 pb-1 text-center text-xs font-extrabold text-amber">{run.note}</p> : null}

      <div className="mx-2 flex min-h-[190px] items-stretch gap-1">
        <section
          ref={frameRef}
          className="relative flex h-[40dvh] min-h-[190px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border-4 border-cream bg-ink-soft p-9 [container-type:size]"
        >
          <div
            ref={gridRef}
            className={`grid ${shake ? "shake" : ""}`}
            style={{
              gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
              width: `min(100cqw, calc(100cqh * ${width} / ${height}))`,
              aspectRatio: `${width} / ${height}`,
            }}
          >
            {run.grid.map((row, r) =>
              row.map((cell, c) => (
                <span key={`${r}-${c}`} className="flex items-center justify-center">
                  {cell ? (
                    <span className="dot" style={{ width: "var(--dot)", height: "var(--dot)", background: swatch(cell) }} />
                  ) : null}
                </span>
              )),
            )}
          </div>
        </section>
        <div ref={gateRef} className="relative my-auto h-28 w-16 shrink-0" aria-hidden>
          <span className="gate-bar" />
          <span className="gate-post left-0" />
          <span className="gate-post right-0" />
          <span className="gate-mouth" />
        </div>
      </div>

      <div className="relative min-h-[15rem] flex-1">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 flex" style={{ top: "calc(100% - var(--dock) - 3 * var(--slot) - var(--peek))" }}>
            {Array.from({ length: run.forks }, (_, lane) => (
              <div key={lane} className="flex min-w-0 flex-1 justify-center">
                {lane < run.rows.length ? (
                  <div
                    key={`${run.bumped[lane] ?? 0}-${run.rows[lane]?.[0]?.id ?? "empty"}`}
                    className={`flex w-11 flex-col items-center ${run.bumped[lane] ? "queue-up" : ""}`}
                  >
                    {(run.rows[lane] ?? []).map((piece, index) => (
                      <button
                        key={piece.id}
                        type="button"
                        disabled={index !== 0 || run.won || run.lost}
                        onClick={() => onSend(lane)}
                        className={`h-[var(--slot)] w-11 ${index === 0 ? "" : "pointer-events-none"}`}
                        aria-hidden={index === 0 ? undefined : true}
                        aria-label={index === 0 ? `Send ${piece.colors.join(" and ")} worker` : undefined}
                      >
                        <WorkerFace colors={piece.colors} className="h-full w-full" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 z-10 flex">
          {Array.from({ length: run.forks }, (_, lane) => {
            const actor = run.actors.find((entry) => entry.lane === lane) ?? null;
            const face = actor?.face ?? "right";
            const moving = actor?.phase === "roll" || actor?.phase === "drive";
            return (
              <div
                key={lane}
                ref={(node) => {
                  laneRefs.current[lane] = node;
                  if (node) measureLanes();
                }}
                className="relative h-full min-w-0 flex-1"
              >
                <div
                  className="rig absolute top-1 left-1/2"
                  data-phase={actor?.phase ?? "park"}
                  style={{
                    width: "var(--rig-w)",
                    height: "var(--rig-h)",
                    marginLeft: "calc(var(--rig-w) / -2)",
                    transform: `translate(${actor?.tx ?? 0}px, ${actor?.ty ?? 0}px)`,
                    transitionDuration: moving ? `${actor?.legMs ?? 0}ms` : "0ms",
                  }}
                >
                  <div className={`relative h-full w-full transition-transform duration-150 ${spinClass(face)}`}>
                    {actor ? (
                      <div className="rider absolute top-0 left-0">
                        <span className={`block ${uprightClass(face)}`}>
                          <WorkerFace colors={actor.piece.colors} className="size-5" />
                        </span>
                      </div>
                    ) : null}
                    {actor?.cargo ? (
                      <span
                        className={`cargo-ride ${actor.phase === "drop" ? "cargo-drop" : ""}`}
                        style={{ background: swatch(actor.cargo) }}
                      />
                    ) : null}
                    <img src="/art/forklift.png" alt="" className="h-full w-full object-contain" />
                  </div>
                </div>
                {actor?.phase === "walk" ? (
                  <div
                    key={actor.id}
                    className="walker-move absolute left-1/2 -ml-5 w-11"
                    style={{ top: "calc(100% - var(--dock) - 3 * var(--slot) - var(--peek))" }}
                  >
                    <WorkerFace colors={actor.piece.colors} className="h-11 w-11" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {jammed || run.lost ? (
          <div
            className="absolute inset-x-3 z-30 rounded-2xl bg-coral px-3 py-2 text-center text-sm font-extrabold"
            style={{ bottom: "calc(var(--dock) + 0.4rem)" }}
          >
            You lose
            <button type="button" onClick={onRestart} className="mt-1 block w-full rounded-full bg-cream py-2 text-ink">
              Restart
            </button>
          </div>
        ) : null}

        <footer ref={footerRef} className="absolute inset-x-0 bottom-0 z-20 grid h-[var(--dock)] grid-cols-3 content-center gap-2 bg-ink px-3">
          {(["dual", "box", "wipe"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={save.tokens[kind] <= 0 || run.won || run.lost}
              onClick={() => onToken(kind)}
              className="relative rounded-2xl bg-ink-soft px-1 py-1 disabled:opacity-40"
            >
              <img src={TOKEN_META[kind].src} alt={TOKEN_META[kind].name} className="mx-auto h-12 object-contain" />
              <span className="absolute top-1 right-1 rounded-full bg-amber px-1.5 text-xs font-extrabold text-ink">
                {save.tokens[kind]}
              </span>
            </button>
          ))}
        </footer>
      </div>

      {run.flights.map((flight) => (
        <span
          key={flight.id}
          className="cargo"
          style={{
            left: flight.x,
            top: flight.y,
            width: flight.size,
            height: flight.size,
            background: swatch(flight.color),
            animationDuration: `${flight.ms}ms`,
            ["--dx" as string]: `${flight.dx}px`,
            ["--dy" as string]: `${flight.dy}px`,
          }}
        />
      ))}

      {run.won ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/75 px-6">
          <div className="w-full max-w-sm rounded-[var(--radius-card)] bg-cream p-6 text-center text-ink">
            <h2 className="font-display text-4xl">Picture cleared</h2>
            <p className="mt-2 font-extrabold">
              +{POINTS_PER_LEVEL} progress · +{run.coinsGain} coins
            </p>
            {run.token ? (
              <p className="mt-3 flex items-center justify-center gap-2 font-extrabold">
                <img src={TOKEN_META[run.token].src} alt="" className="size-12" />
                Bonus token: {TOKEN_META[run.token].name}
              </p>
            ) : null}
            <button type="button" onClick={onNext} className="mt-4 w-full rounded-full bg-coral py-3 font-display text-2xl text-cream">
              Back to the yard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function forkTip(board: Board, face: Face, tx: number, ty: number) {
  const left = board.originX + tx;
  const top = board.originY + ty;
  const cx = left + board.rigW / 2;
  const cy = top + board.rigH / 2;
  if (face === "right") return { x: left + board.rigW - 2, y: cy };
  if (face === "left") return { x: left + 2, y: cy };
  if (face === "up") return { x: cx, y: cy - board.rigW / 2 };
  return { x: cx, y: cy + board.rigW / 2 };
}

function spinClass(face: Face) {
  if (face === "left") return "-scale-x-100";
  if (face === "up") return "-rotate-90";
  if (face === "down") return "rotate-90";
  return "";
}

function uprightClass(face: Face) {
  if (face === "left") return "-scale-x-100";
  if (face === "up") return "rotate-90";
  if (face === "down") return "-rotate-90";
  return "";
}

function WorkerFace({ colors, className = "size-12" }: { colors: DotColor[]; className?: string }) {
  const primary = WORKER_SRC[colors[0]];
  const secondary = colors[1] ? WORKER_SRC[colors[1]] : undefined;
  if (primary && (!colors[1] || secondary)) {
    return (
      <span className={`relative block ${className}`}>
        <img src={primary} alt="" className="h-full w-full object-contain object-top" />
        {secondary ? (
          <img src={secondary} alt="" className="absolute right-0 bottom-0 h-1/2 w-1/2 bg-cream object-contain" />
        ) : null}
      </span>
    );
  }
  return (
    <span className={`relative block ${className}`}>
      <img src="/art/worker-yellow.png" alt="" className="h-full w-full object-contain object-top" />
      <span
        className="absolute bottom-[18%] left-1/2 h-[30%] w-[46%] -translate-x-1/2 border-2 border-ink"
        style={{ background: swatch(colors[0]) }}
      />
      {colors[1] ? (
        <span
          className="absolute right-[6%] bottom-[18%] h-[22%] w-[28%] border-2 border-ink"
          style={{ background: swatch(colors[1]) }}
        />
      ) : null}
    </span>
  );
}

function forkliftsJammed(run: Run, boardFor: (lane: number, cols: number, rows: number) => Board | null) {
  if (run.won || run.pending.length > 0 || remainingCount(run.grid) === 0) return false;
  if (run.actors.some((actor) => actor.phase !== "wait")) return false;
  const queued = run.rows.some((row) => row.length > 0);
  if (run.actors.length < run.forks && queued) return false;
  if (run.actors.length === 0) return true;
  const cols = run.grid[0]?.length ?? 1;
  const rows = run.grid.length;
  for (const actor of run.actors) {
    const board = boardFor(actor.lane, cols, rows);
    if (!board) return false;
    const from = actor.node ?? bottomNode(board, board.originX + board.rigW / 2);
    if (reachableSpots(run.grid, board, actor.piece.colors, from).length > 0) return false;
  }
  return true;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink/60 sm:items-center">
      <div className="w-full max-w-md rounded-t-[var(--radius-card)] bg-cream p-5 text-ink sm:rounded-[var(--radius-card)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-3xl">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full bg-ink px-3 py-2 text-sm font-extrabold text-cream">
            Close
          </button>
        </div>
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex items-center justify-between rounded-2xl bg-cream-dim px-4 py-3 font-extrabold"
    >
      <span>{label}</span>
      <span className={`rounded-full px-3 py-1 text-sm ${on ? "bg-mint text-ink" : "bg-ink text-cream"}`}>
        {on ? "On" : "Off"}
      </span>
    </button>
  );
}

function Volume({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm font-extrabold ${disabled ? "opacity-40" : ""}`}>
      {label}
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="accent-coral"
      />
    </label>
  );
}

function Pack({ amount, price, onBuy }: { amount: number; price: string; onBuy: () => void }) {
  return (
    <button type="button" onClick={onBuy} className="flex items-center justify-between rounded-2xl bg-mint px-4 py-3 font-extrabold text-ink">
      <span>{amount} coins</span>
      <span className="rounded-full bg-cream px-3 py-1">{price}</span>
    </button>
  );
}

function TokenRow({ kind, count }: { kind: TokenKind; count: number }) {
  const meta = TOKEN_META[kind];
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-cream-dim p-2">
      <img src={meta.src} alt="" className="size-14 object-contain" />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold">{meta.name}</p>
        <p className="text-xs font-extrabold text-ink-soft">{meta.blurb}</p>
      </div>
      <span className="rounded-full bg-amber px-2 py-1 text-sm font-extrabold">{count}</span>
    </div>
  );
}
