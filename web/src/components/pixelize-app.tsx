import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { applyMusic, sfx, unlockAudio } from "@/game/audio";
import { buildLevel, coinsFor, POINTS_PER_LEVEL, PROGRESS_MAX, type WorkerPiece } from "@/game/levels";
import { cloneGrid, colorsOnBoard, hammer, remainingCount, type DotColor, type Grid } from "@/game/logic";
import { grantProgress, loadSave, writeSave, type Save, type Settings, type TokenKind } from "@/game/store";

const WORKER_SRC: Record<DotColor, string> = {
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
    blurb: "Drops a worker who hammers two random colors at once.",
  },
  box: {
    src: "/art/token-box.png",
    name: "Extra bay",
    blurb: "Opens a sixth forklift bay for this picture.",
  },
  wipe: {
    src: "/art/token-wipe.png",
    name: "Color wipe",
    blurb: "You pick a color. Every dot of that color falls off, edges or not.",
  },
};

type Phase =
  | "walk"
  | "drive"
  | "wait"
  | "enter"
  | "to-gate"
  | "unload"
  | "from-gate"
  | "exit"
  | "down"
  | "leave";

type Actor = {
  id: string;
  piece: WorkerPiece;
  lane: number;
  phase: Phase;
  phaseStartedAt: number;
  skipWalk: boolean;
  haulMs: number;
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
  token: TokenKind | null;
  coinsGain: number;
};

const TICK = {
  walk: 640,
  drive: 700,
  enter: 280,
  unload: 200,
  fromGate: 720,
  exit: 280,
  down: 660,
  leave: 420,
  flight: 560,
};

const ON_ROAD = new Set<Phase>(["enter", "to-gate", "unload", "from-gate", "exit"]);

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
    token: null,
    coinsGain: 0,
  };
}

function phaseLimit(actor: Actor): number {
  switch (actor.phase) {
    case "walk":
      return actor.skipWalk ? 0 : TICK.walk;
    case "drive":
      return TICK.drive;
    case "wait":
      return Number.POSITIVE_INFINITY;
    case "enter":
      return TICK.enter;
    case "to-gate":
      return actor.haulMs;
    case "unload":
      return TICK.unload;
    case "from-gate":
      return TICK.fromGate;
    case "exit":
      return TICK.exit;
    case "down":
      return TICK.down;
    case "leave":
      return TICK.leave;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

type Measure = (dot: PendingDot) => Flight | null;

function stepWorld(prev: Run, now: number, measure: Measure, onSound: (kind: "hammer" | "miss") => void): Run {
  const due = prev.pending.filter((dot) => dot.at <= now);
  let pending = prev.pending.filter((dot) => dot.at > now);
  const flights = prev.flights.filter((flight) => now - flight.born < TICK.flight);
  let grid = prev.grid;
  if (due.length) {
    grid = cloneGrid(prev.grid);
    for (const dot of due) {
      if (grid[dot.row]?.[dot.col] === dot.color) {
        grid[dot.row][dot.col] = null;
        const flight = measure(dot);
        if (flight) flights.push(flight);
      }
    }
  }

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
    if (actor.phase === "drive") {
      replace(index, { ...actor, phase: roadBusy() ? "wait" : "enter", phaseStartedAt: now });
      continue;
    }
    if (actor.phase === "enter") {
      const removed = [...hammer(grid, actor.piece.colors).removed].sort((a, b) => b.col - a.col || a.row - b.row);
      if (!removed.length) {
        onSound("miss");
        note = "Nothing on the edge matches that worker.";
        replace(index, { ...actor, phase: "exit", phaseStartedAt: now, haulMs: 0 });
        continue;
      }
      const haulMs = Math.min(2200, Math.max(720, removed.length * 150));
      const spacing = haulMs / removed.length;
      pending = pending.concat(
        removed.map((dot, i) => ({
          id: `${actor.id}-${dot.row}-${dot.col}`,
          row: dot.row,
          col: dot.col,
          color: dot.color,
          at: now + Math.max(24, i * spacing),
        })),
      );
      onSound("hammer");
      replace(index, { ...actor, phase: "to-gate", phaseStartedAt: now, haulMs });
      continue;
    }
    const follow: Partial<Record<Phase, Phase>> = {
      walk: "drive",
      "to-gate": "unload",
      unload: "from-gate",
      "from-gate": "exit",
      exit: "down",
      down: "leave",
    };
    const nextPhase = follow[actor.phase];
    if (nextPhase) replace(index, { ...actor, phase: nextPhase, phaseStartedAt: now });
  }

  if (!roadBusy()) {
    const waiter = actors
      .map((actor, index) => ({ actor, index }))
      .filter(({ actor }) => !gone.has(actor.id) && actor.phase === "wait")
      .sort((a, b) => a.actor.phaseStartedAt - b.actor.phaseStartedAt)[0];
    if (waiter) replace(waiter.index, { ...waiter.actor, phase: "enter", phaseStartedAt: now });
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

function measureFlight(
  frame: HTMLElement | null,
  gridEl: HTMLElement | null,
  gate: HTMLElement | null,
  cols: number,
  rows: number,
  dot: PendingDot,
  born: number,
): Flight | null {
  if (!frame || !gridEl || !gate || cols < 1 || rows < 1) return null;
  const frameBox = frame.getBoundingClientRect();
  const gridBox = gridEl.getBoundingClientRect();
  const gateBox = gate.getBoundingClientRect();
  const frameStyle = getComputedStyle(frame);
  const borderLeft = Number.parseFloat(frameStyle.borderLeftWidth) || 0;
  const borderTop = Number.parseFloat(frameStyle.borderTopWidth) || 0;
  const cellW = gridBox.width / cols;
  const cellH = gridBox.height / rows;
  const x = gridBox.left - frameBox.left - borderLeft + dot.col * cellW;
  const y = gridBox.top - frameBox.top - borderTop + dot.row * cellH;
  const size = Math.max(6, Math.min(cellW, cellH) - 2);
  const gx = gateBox.left - frameBox.left - borderLeft + gateBox.width * 0.28;
  const gy = gateBox.top - frameBox.top - borderTop + gateBox.height * 0.42;
  return { id: dot.id, color: dot.color, x, y, size, dx: gx - x, dy: gy - y, born };
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
    if (!run || run.won || run.actors.length > 0 || run.pending.length > 0 || remainingCount(run.grid) !== 0) {
      if (run && remainingCount(run.grid) !== 0) awarded.current = false;
      return;
    }
    if (awarded.current || claimedWins.has(run.id)) return;
    awarded.current = true;
    claimedWins.add(run.id);
    const current = saveRef.current;
    if (!current) return;
    const { save: next, token } = grantProgress(current, run.level);
    commit(next);
    sfx.win(next.settings);
    if (token) sfx.token(next.settings);
    commitRun((prev) => {
      if (!prev || prev.won) return prev;
      return { ...prev, won: true, token, coinsGain: coinsFor(prev.level) };
    });
  }, [run, commit, commitRun]);

  const sendWorker = (lane: number) => {
    const current = runRef.current;
    const settings = saveRef.current?.settings;
    if (!current || !settings || current.won) return;
    unlockAudio();
    if (current.actors.some((actor) => actor.lane === lane)) {
      setShake(true);
      window.setTimeout(() => setShake(false), 280);
      commitRun((prev) => (prev ? { ...prev, note: "That forklift is still out." } : prev));
      return;
    }
    const row = current.rows[lane];
    if (!row?.length) return;
    if (!hammer(current.grid, row[0].colors).removed.length) {
      sfx.miss(settings);
      setShake(true);
      window.setTimeout(() => setShake(false), 280);
      commitRun((prev) => (prev ? { ...prev, note: "Nothing on the edge matches that worker." } : prev));
      return;
    }
    sfx.load(settings);
    const piece = row[0];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    commitRun((prev) => {
      if (!prev || prev.won) return prev;
      if (prev.actors.some((actor) => actor.lane === lane)) return prev;
      const line = prev.rows[lane];
      if (!line?.length || line[0]?.id !== piece.id) return prev;
      const rows = prev.rows.map((entry) => entry.slice());
      rows[lane].shift();
      if (reduce) return { ...prev, grid: hammer(prev.grid, piece.colors).grid, rows, note: "" };
      const bumped = prev.bumped.slice();
      bumped[lane] = (bumped[lane] ?? 0) + 1;
      const actor: Actor = {
        id: piece.id,
        piece,
        lane,
        phase: "walk",
        phaseStartedAt: performance.now(),
        skipWalk: false,
        haulMs: 720,
      };
      return { ...prev, rows, bumped, actors: [...prev.actors, actor], note: "" };
    });
  };

  const useToken = (kind: TokenKind) => {
    const current = runRef.current;
    if (!save || !current || current.won) return;
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
      const actor: Actor = {
        id,
        piece: { id, colors: [first, second] },
        lane,
        phase: "drive",
        phaseStartedAt: performance.now(),
        skipWalk: true,
        haulMs: 720,
      };
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
    if (!save || !current || save.tokens.wipe <= 0) return;
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
          onSettings={() => setPanel("settings")}
          onShop={() => setPanel("shop")}
          onPouch={() => setPanel("pouch")}
        />
      ) : null}
      {screen === "game" && run ? (
        <GameView
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
          onRestart={() => commitRun(() => startRun(run.level))}
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
          <p className="text-sm font-extrabold text-ink-soft">Every dot of this color comes off.</p>
          <div className="flex flex-wrap gap-3">
            {colorsOnBoard(run.grid).map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => confirmWipe(color)}
                className={`dot size-12 ${dotClass(color)}`}
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
  onSettings,
  onShop,
  onPouch,
}: {
  save: Save;
  onLevel: () => void;
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

        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <h1 className="title-stroke text-6xl">Pixelize</h1>
          <button
            type="button"
            onClick={onLevel}
            className="rounded-full bg-coral px-10 py-4 font-display text-3xl text-cream shadow-lg"
          >
            Level {save.level}
          </button>
          <p className="max-w-[16rem] text-center text-sm font-extrabold text-cream drop-shadow">
            Send workers one at a time. They only knock off dots that match them, and only dots on the edge.
          </p>
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
  const busy = run.actors.length > 0 || run.pending.length > 0;
  const useful = crewCanWork(run);
  const stuck = !run.won && !busy && left > 0 && !useful;

  const measureLanes = () => {
    const frame = frameRef.current;
    if (!frame) return;
    const frameBox = frame.getBoundingClientRect();
    const dock = footerRef.current?.getBoundingClientRect().height ?? 92;
    const gate = gateRef.current?.getBoundingClientRect();
    for (let lane = 0; lane < laneRefs.current.length; lane += 1) {
      const laneEl = laneRefs.current[lane];
      if (!laneEl) continue;
      const laneBox = laneEl.getBoundingClientRect();
      const forkTop = laneBox.top + 4;
      const forkHeight = 40;
      const lift = Math.max(48, forkTop - (frameBox.bottom - forkHeight - 8));
      const waitLift = Math.max(24, lift - forkHeight - 12);
      const forkCenter = laneBox.left + laneBox.width / 2;
      const haulX = gate ? gate.left + gate.width * 0.35 - forkCenter : 80;
      const slotTop = laneBox.bottom - dock - 56;
      const walk = Math.max(16, slotTop - (forkTop + forkHeight) - 2);
      laneEl.style.setProperty("--lift", `${lift}px`);
      laneEl.style.setProperty("--wait-lift", `${waitLift}px`);
      laneEl.style.setProperty("--haul-x", `${haulX}px`);
      laneEl.style.setProperty("--walk", `${walk}px`);
      laneEl.style.setProperty("--dock", `${dock}px`);
    }
  };

  useLayoutEffect(() => {
    measureLanes();
    const observer = new ResizeObserver(() => measureLanes());
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [run.forks, run.note]);

  useEffect(() => {
    let frame = 0;
    let alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      commitRun((prev) => {
        if (!prev) return prev;
        if (!prev.actors.length && !prev.pending.length && !prev.flights.length) return prev;
        const cols = prev.grid[0]?.length ?? 1;
        return stepWorld(
          prev,
          now,
          (dot) => measureFlight(frameRef.current, gridRef.current, gateRef.current, cols, prev.grid.length, dot, now),
          (kind) => {
            const settings = saveLive.current.settings;
            if (kind === "hammer") sfx.hammer(settings);
            else sfx.miss(settings);
          },
        );
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
    <div className="relative mx-auto flex h-dvh max-w-[440px] flex-col overflow-hidden bg-ink text-cream [--dock:5.75rem]">
      <header className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onHome} className="rounded-full bg-ink-soft px-3 py-2 text-sm font-extrabold">
          Yard
        </button>
        <p className="font-display text-xl">Level {run.level}</p>
        <p className="text-sm font-extrabold">{left} dots</p>
      </header>
      {run.note ? <p className="px-3 pb-1 text-center text-xs font-extrabold text-amber">{run.note}</p> : null}

      <section
        ref={frameRef}
        className="relative mx-3 flex h-[40dvh] min-h-[190px] flex-col overflow-hidden rounded-[var(--radius-card)] border-4 border-cream bg-ink-soft"
      >
        <div className="flex min-h-0 flex-1 items-center justify-center px-2 pt-2 [container-type:size]">
          <div
            ref={gridRef}
            className={`grid gap-[3px] ${shake ? "shake" : ""}`}
            style={{
              gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
              width: `min(100cqw, calc(100cqh * ${width} / ${height}))`,
              aspectRatio: `${width} / ${height}`,
            }}
          >
            {run.grid.map((row, r) =>
              row.map((cell, c) =>
                cell ? (
                  <span key={`${r}-${c}`} className={`dot ${dotClass(cell)}`} />
                ) : (
                  <span key={`${r}-${c}`} />
                ),
              ),
            )}
          </div>
        </div>
        {run.flights.map((flight) => (
          <span
            key={flight.id}
            className={`cargo ${dotClass(flight.color)}`}
            style={{
              left: flight.x,
              top: flight.y,
              width: flight.size,
              height: flight.size,
              ["--dx" as string]: `${flight.dx}px`,
              ["--dy" as string]: `${flight.dy}px`,
            }}
          />
        ))}
        <div className="relative h-28 shrink-0">
          <div className="absolute inset-x-4 top-1/2 h-2 -translate-y-1/2 bg-cream/25" />
          <div ref={gateRef} className="absolute right-2 bottom-1 h-20 w-9" aria-hidden>
            <span className="gate-bar" />
            <span className="gate-post left-0" />
            <span className="gate-post right-0" />
            <span className="gate-mouth" />
          </div>
        </div>
      </section>

      <div className="relative min-h-[15rem] flex-1">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 flex" style={{ top: "calc(100% - var(--dock) - 3.5rem)" }}>
            {Array.from({ length: run.forks }, (_, lane) => (
              <div key={lane} className="flex min-w-0 flex-1 justify-center">
                {lane < run.rows.length ? (
                  <div
                    key={`${run.bumped[lane] ?? 0}-${run.rows[lane]?.[0]?.id ?? "empty"}`}
                    className={`flex w-14 flex-col items-center ${run.bumped[lane] ? "queue-up" : ""}`}
                  >
                    {(run.rows[lane] ?? []).map((piece, index) => (
                      <button
                        key={piece.id}
                        type="button"
                        disabled={index !== 0 || run.won}
                        onClick={() => onSend(lane)}
                        className={`h-14 w-14 ${index === 0 ? "" : "pointer-events-none"}`}
                        aria-hidden={index === 0 ? undefined : true}
                        aria-label={index === 0 ? `Send ${piece.colors.join(" and ")} worker` : undefined}
                      >
                        <WorkerFace colors={piece.colors} />
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
            const facingBack = actor?.phase === "from-gate";
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
                  className="rig absolute top-1 left-1/2 -ml-7 w-14"
                  data-phase={actor?.phase ?? "park"}
                  style={actor?.phase === "to-gate" ? { transitionDuration: `${actor.haulMs}ms` } : undefined}
                >
                  <div className={facingBack ? "-scale-x-100" : ""}>
                    {actor ? (
                      <div className="rider absolute -top-1 left-0">
                        <span className={facingBack ? "block -scale-x-100" : "block"}>
                          <WorkerFace colors={actor.piece.colors} className="size-8" />
                        </span>
                      </div>
                    ) : null}
                    <img src="/art/forklift.png" alt="" className="h-10 w-14 object-contain" />
                  </div>
                </div>
                {actor?.phase === "walk" ? (
                  <div
                    key={actor.id}
                    className="walker-move absolute top-[calc(100%-var(--dock)-3.5rem)] left-1/2 -ml-6"
                  >
                    <WorkerFace colors={actor.piece.colors} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {stuck ? (
          <div
            className="absolute inset-x-3 z-30 rounded-2xl bg-coral px-3 py-2 text-center text-sm font-extrabold"
            style={{ bottom: "calc(var(--dock) + 0.4rem)" }}
          >
            No worker left can reach a loose dot.
            <button type="button" onClick={onRestart} className="mt-1 block w-full rounded-full bg-cream py-2 text-ink">
              Restart level
            </button>
          </div>
        ) : null}

        <footer ref={footerRef} className="absolute inset-x-0 bottom-0 z-20 grid h-[var(--dock)] grid-cols-3 content-center gap-2 bg-ink px-3">
          {(["dual", "box", "wipe"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={save.tokens[kind] <= 0 || run.won}
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

function WorkerFace({ colors, className = "size-12" }: { colors: DotColor[]; className?: string }) {
  return (
    <span className={`relative block ${className}`}>
      <img src={WORKER_SRC[colors[0]]} alt="" className="h-full w-full object-contain" />
      {colors[1] ? (
        <img src={WORKER_SRC[colors[1]]} alt="" className="absolute right-0 bottom-0 h-1/2 w-1/2 bg-cream object-contain" />
      ) : null}
    </span>
  );
}

function crewCanWork(run: Run): boolean {
  return run.rows.some((row) => row.some((piece) => hammer(run.grid, piece.colors).removed.length > 0));
}function dotClass(color: DotColor): string {
  return `dot-${color}`;
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
