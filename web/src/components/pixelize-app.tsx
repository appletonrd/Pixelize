import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { applyMusic, sfx, unlockAudio } from "@/game/audio";
import { buildLevel, coinsFor, POINTS_PER_LEVEL, PROGRESS_MAX, type WorkerPiece } from "@/game/levels";
import {
  colorsOnBoard,
  hammer,
  isEdge,
  remainingCount,
  wipeColor,
  type DotColor,
  type Grid,
} from "@/game/logic";
import {
  grantProgress,
  loadSave,
  writeSave,
  type Save,
  type Settings,
  type TokenKind,
} from "@/game/store";

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

type Pop = { id: string; row: number; col: number; color: DotColor };

type Run = {
  id: string;
  level: number;
  grid: Grid;
  rows: WorkerPiece[][];
  boxes: (WorkerPiece | null)[];
  pops: Pop[];
  note: string;
  won: boolean;
  token: TokenKind | null;
  coinsGain: number;
};

const claimedWins = new Set<string>();

type Screen = "splash" | "menu" | "game";

function emptyBoxes(count: number): (WorkerPiece | null)[] {
  return Array.from({ length: count }, () => null);
}

function startRun(level: number, bays: number): Run {
  const built = buildLevel(level);
  return {
    id: `${level}-${Date.now()}`,
    level,
    grid: built.grid,
    rows: built.rows,
    boxes: emptyBoxes(bays),
    pops: [],
    note: "",
    won: false,
    token: null,
    coinsGain: 0,
  };
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
    const next = { ...save, settings: { ...save.settings, ...partial } };
    commit(next);
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
      setRun(startRun(level, 5));
      setScreen("game");
    }, 1500);
  };

  const awarded = useRef(false);

  useEffect(() => {
    if (!run) return;
    if (run.won || remainingCount(run.grid) !== 0) {
      if (remainingCount(run.grid) !== 0) awarded.current = false;
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
    setRun({ ...run, won: true, token, coinsGain: coinsFor(run.level) });
  }, [run, commit]);

  const launch = useCallback((id: string) => {
    setRun((prev) => {
      if (!prev || prev.won) return prev;
      const index = prev.boxes.findIndex((piece) => piece?.id === id);
      if (index < 0) return prev;
      const piece = prev.boxes[index];
      if (!piece) return prev;
      const result = hammer(prev.grid, piece.colors);
      const settings = saveRef.current?.settings;
      if (settings) {
        if (result.removed.length) sfx.hammer(settings);
        else sfx.miss(settings);
      }
      const boxes = prev.boxes.slice();
      boxes[index] = null;
      const pops: Pop[] = result.removed.map((dot) => ({
        id: `${id}-${dot.row}-${dot.col}`,
        ...dot,
      }));
      const next: Run = {
        ...prev,
        grid: result.grid,
        boxes,
        pops,
        note: result.removed.length ? "" : "Nothing on the edge matches that worker.",
      };
      return next;
    });
  }, []);

  const sendWorker = (rowIndex: number, visibleIndex: number) => {
    if (!run || !save || run.won) return;
    unlockAudio();
    const row = run.rows[rowIndex];
    if (!row || visibleIndex >= row.length || visibleIndex >= 4) return;
    const open = run.boxes.findIndex((slot) => slot == null);
    if (open < 0) {
      setShake(true);
      window.setTimeout(() => setShake(false), 280);
      setRun({ ...run, note: "Every bay is full. Wait for a forklift." });
      return;
    }
    sfx.load(save.settings);
    const rows = run.rows.map((line) => line.slice());
    const [taken] = rows[rowIndex].splice(visibleIndex, 1);
    const boxes = run.boxes.slice();
    boxes[open] = taken;
    setRun({ ...run, rows, boxes, note: "" });
  };

  const useToken = (kind: TokenKind) => {
    if (!save || !run || run.won) return;
    if (save.tokens[kind] <= 0) return;
    unlockAudio();
    if (kind === "box") {
      if (run.boxes.length >= 6) {
        setRun({ ...run, note: "The extra bay is already out." });
        return;
      }
      commit({ ...save, tokens: { ...save.tokens, box: save.tokens.box - 1 } });
      sfx.token(save.settings);
      setRun({ ...run, boxes: [...run.boxes, null], note: "A sixth bay rolls in." });
      return;
    }
    if (kind === "dual") {
      const open = run.boxes.findIndex((slot) => slot == null);
      if (open < 0) {
        setRun({ ...run, note: "Free a bay first." });
        return;
      }
      const present = colorsOnBoard(run.grid);
      const pool = present.length ? present : (["red", "blue"] as DotColor[]);
      const first = pool[Math.floor(Math.random() * pool.length)];
      let second = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1) {
        while (second === first) second = pool[Math.floor(Math.random() * pool.length)];
      }
      commit({ ...save, tokens: { ...save.tokens, dual: save.tokens.dual - 1 } });
      sfx.token(save.settings);
      const boxes = run.boxes.slice();
      boxes[open] = { id: `dual-${Date.now()}`, colors: [first, second] };
      setRun({ ...run, boxes, note: "Two-tone worker is in a bay." });
      return;
    }
    setPanel("wipe");
  };

  const confirmWipe = (color: DotColor) => {
    if (!save || !run || save.tokens.wipe <= 0) return;
    const result = wipeColor(run.grid, color);
    commit({ ...save, tokens: { ...save.tokens, wipe: save.tokens.wipe - 1 } });
    sfx.hammer(save.settings);
    const pops: Pop[] = [];
    for (let row = 0; row < run.grid.length; row += 1) {
      for (let col = 0; col < run.grid[row].length; col += 1) {
        if (run.grid[row][col] === color) pops.push({ id: `wipe-${row}-${col}`, row, col, color });
      }
    }
    const next: Run = { ...run, grid: result.grid, pops, note: "" };
    setPanel(null);
    setRun(next);
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
          onSend={sendWorker}
          onLaunch={launch}
          onToken={useToken}
          onHome={() => {
            setScreen("menu");
            setPanel(null);
          }}
          onRestart={() => setRun(startRun(run.level, 5))}
          onHint={() => commit({ ...save, hintSeen: true })}
          onNext={() => {
            setRun(null);
            setScreen("menu");
          }}
        />
      ) : null}

      {panel === "settings" ? (
        <Sheet title="Settings" onClose={() => setPanel(null)}>
          <Toggle
            label="Sound"
            on={save.settings.sound}
            onChange={(sound) => patchSettings({ sound })}
          />
          <Volume
            label="Sound level"
            value={save.settings.soundVol}
            disabled={!save.settings.sound}
            onChange={(soundVol) => patchSettings({ soundVol })}
          />
          <Toggle
            label="Music"
            on={save.settings.music}
            onChange={(music) => patchSettings({ music })}
          />
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
  onSend,
  onLaunch,
  onToken,
  onHome,
  onRestart,
  onHint,
  onNext,
}: {
  run: Run;
  save: Save;
  shake: boolean;
  onSend: (row: number, index: number) => void;
  onLaunch: (id: string) => void;
  onToken: (kind: TokenKind) => void;
  onHome: () => void;
  onRestart: () => void;
  onHint: () => void;
  onNext: () => void;
}) {
  const height = run.grid.length;
  const width = run.grid[0]?.length ?? 1;
  const left = remainingCount(run.grid);
  const waiting = run.boxes.some(Boolean);
  const useful = crewCanWork(run);
  const stuck = !run.won && !waiting && left > 0 && !useful;

  return (
    <div className="relative mx-auto flex h-dvh max-w-[440px] flex-col bg-ink text-cream">
      <header className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onHome} className="rounded-full bg-ink-soft px-3 py-2 text-sm font-extrabold">
          Yard
        </button>
        <p className="font-display text-xl">Level {run.level}</p>
        <p className="text-sm font-extrabold">{left} dots</p>
      </header>

      <section className="mx-3 flex h-[38dvh] items-center justify-center rounded-[var(--radius-card)] border-4 border-cream bg-ink-soft p-2 [container-type:size]">
        <div
          className={`grid gap-[3px] ${shake ? "shake" : ""}`}
          style={{
            gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
            width: `min(100cqw, calc(100cqh * ${width} / ${height}))`,
            aspectRatio: `${width} / ${height}`,
          }}
        >
          {run.grid.map((row, r) =>
            row.map((cell, c) => {
              const popping = run.pops.find((pop) => pop.row === r && pop.col === c);
              const color = cell ?? popping?.color ?? null;
              if (!color) return <span key={`${r}-${c}`} />;
              const edge = cell ? isEdge(run.grid, r, c) : false;
              return (
                <span
                  key={`${r}-${c}`}
                  className={`dot ${dotClass(color)} ${edge ? "dot-edge" : ""} ${popping && !cell ? "dot-pop" : ""}`}
                />
              );
            }),
          )}
        </div>
      </section>

      <div className={`mt-2 flex items-end justify-center gap-2 px-2 ${shake ? "shake" : ""}`}>
        {run.boxes.map((piece, index) => (
          <Bay key={index} piece={piece} onLaunch={onLaunch} />
        ))}
      </div>

      {run.note ? <p className="px-4 pt-1 text-center text-xs font-extrabold text-amber">{run.note}</p> : null}
      {!save.hintSeen && run.level === 1 ? (
        <button type="button" onClick={onHint} className="mx-4 mt-1 rounded-xl bg-cream px-3 py-2 text-xs font-extrabold text-ink">
          Cream rings mark dots a worker can reach. Tap to hide this.
        </button>
      ) : null}

      <div className="mt-1 flex min-h-0 flex-1 flex-col justify-center gap-1 overflow-y-auto px-3 py-1">
        {run.rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-1">
            {Array.from({ length: 4 }, (_, index) => {
              const piece = row[index];
              return piece ? (
                <button
                  key={piece.id}
                  type="button"
                  onClick={() => onSend(rowIndex, index)}
                  className="relative size-12 shrink-0"
                  aria-label={`Send ${piece.colors.join(" and ")} worker`}
                >
                  <WorkerFace colors={piece.colors} />
                </button>
              ) : (
                <span key={index} className="size-12 shrink-0 rounded-full border border-dashed border-cream/30" />
              );
            })}
            {row.length > 4 ? (
              <span className="ml-1 text-xs font-extrabold text-cream-dim">+{row.length - 4}</span>
            ) : null}
          </div>
        ))}
      </div>

      {stuck ? (
        <div className="mx-3 mb-2 rounded-2xl bg-coral px-3 py-2 text-center text-sm font-extrabold">
          No worker left can reach a loose dot.
          <button type="button" onClick={onRestart} className="mt-1 block w-full rounded-full bg-cream py-2 text-ink">
            Restart level
          </button>
        </div>
      ) : null}

      <footer className="grid grid-cols-3 gap-2 px-3 pb-3">
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

      {run.won ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/75 px-6">
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

function Bay({ piece, onLaunch }: { piece: WorkerPiece | null; onLaunch: (id: string) => void }) {
  const launchRef = useRef(onLaunch);
  launchRef.current = onLaunch;

  useEffect(() => {
    if (!piece) return;
    let cancelled = false;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      if (now - start >= 980) launchRef.current(piece.id);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [piece]);

  return (
    <div className="flex w-14 flex-col items-center">
      <div className="flex h-14 items-end justify-center">
        {piece ? (
          <div className="hop">
            <WorkerFace colors={piece.colors} />
          </div>
        ) : null}
      </div>
      <img src="/art/forklift.png" alt="" className="h-10 w-14 object-contain" />
    </div>
  );
}

function WorkerFace({ colors }: { colors: DotColor[] }) {
  return (
    <span className="relative block size-12">
      <img src={WORKER_SRC[colors[0]]} alt="" className="size-12 object-contain" />
      {colors[1] ? (
        <img
          src={WORKER_SRC[colors[1]]}
          alt=""
          className="absolute right-0 bottom-0 size-6 rounded-full bg-cream object-contain"
        />
      ) : null}
    </span>
  );
}

function crewCanWork(run: Run): boolean {
  const waiting = run.boxes.filter((piece): piece is WorkerPiece => piece != null);
  const crew = [...run.rows.flat(), ...waiting];
  return crew.some((piece) => hammer(run.grid, piece.colors).removed.length > 0);
}

function dotClass(color: DotColor): string {
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
