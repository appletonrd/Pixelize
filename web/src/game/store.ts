import { coinsFor, POINTS_PER_LEVEL, PROGRESS_MAX } from "@/game/levels";

export type TokenKind = "dual" | "box" | "wipe";

export type Settings = {
  sound: boolean;
  music: boolean;
  soundVol: number;
  musicVol: number;
};

export type Save = {
  version: 1;
  level: number;
  coins: number;
  progress: number;
  tokens: Record<TokenKind, number>;
  settings: Settings;
  hintSeen: boolean;
};

const KEY = "pixelize-save-v1";

export const TOKEN_KINDS: TokenKind[] = ["dual", "box", "wipe"];

export function defaultSave(): Save {
  return {
    version: 1,
    level: 1,
    coins: 20,
    progress: 0,
    tokens: { dual: 0, box: 0, wipe: 0 },
    settings: { sound: true, music: true, soundVol: 0.7, musicVol: 0.45 },
    hintSeen: false,
  };
}

export function loadSave(): Save {
  if (typeof localStorage === "undefined") return defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<Save>;
    const base = defaultSave();
    return {
      ...base,
      ...parsed,
      version: 1,
      tokens: { ...base.tokens, ...parsed.tokens },
      settings: { ...base.settings, ...parsed.settings },
    };
  } catch {
    return defaultSave();
  }
}

export function writeSave(save: Save) {
  localStorage.setItem(KEY, JSON.stringify(save));
}

export function grantClear(save: Save, coins: number, nextLevel: number | null): { save: Save; token: TokenKind | null } {
  const next: Save = {
    ...save,
    level: nextLevel ?? save.level,
    coins: save.coins + coins,
    progress: save.progress + POINTS_PER_LEVEL,
    tokens: { ...save.tokens },
  };
  let token: TokenKind | null = null;
  if (next.progress >= PROGRESS_MAX) {
    next.progress -= PROGRESS_MAX;
    token = TOKEN_KINDS[Math.floor(Math.random() * TOKEN_KINDS.length)];
    next.tokens[token] += 1;
  }
  return { save: next, token };
}

export function grantProgress(save: Save, levelJustCleared: number): { save: Save; token: TokenKind | null } {
  return grantClear(save, coinsFor(levelJustCleared), levelJustCleared + 1);
}
