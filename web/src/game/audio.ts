import type { Settings } from "@/game/store";

let ctx: AudioContext | null = null;
let musicNodes: { osc: OscillatorNode; gain: GainGain }[] = [];
let musicOn = false;
let step = 0;
let nextAt = 0;
let raf = 0;
let liveSettings: Settings = {
  sound: true,
  music: true,
  soundVol: 0.7,
  musicVol: 0.45,
};

type GainGain = GainNode;

const MELODY = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 783.99];

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function unlockAudio() {
  const audio = context();
  if (audio && audio.state === "suspended") void audio.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, volume: number, settings: Settings) {
  if (!settings.sound || volume <= 0) return;
  const audio = context();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const peak = 0.08 * settings.soundVol * volume;
  gain.gain.setValueAtTime(peak, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + dur + 0.02);
}

export const sfx = {
  tap: (s: Settings) => tone(420, 0.08, "triangle", 0.6, s),
  load: (s: Settings) => tone(520, 0.1, "square", 0.35, s),
  hammer: (s: Settings) => {
    tone(180, 0.12, "sawtooth", 0.4, s);
    tone(90, 0.16, "triangle", 0.5, s);
  },
  miss: (s: Settings) => tone(140, 0.14, "sine", 0.4, s),
  win: (s: Settings) => {
    tone(523, 0.12, "triangle", 0.7, s);
    setTimeout(() => tone(659, 0.12, "triangle", 0.7, s), 90);
    setTimeout(() => tone(784, 0.22, "triangle", 0.8, s), 180);
  },
  token: (s: Settings) => tone(880, 0.2, "square", 0.35, s),
  coin: (s: Settings) => tone(990, 0.09, "square", 0.3, s),
};

function stopMusic() {
  cancelAnimationFrame(raf);
  for (const node of musicNodes) {
    try {
      node.osc.stop();
    } catch {
      /* already stopped */
    }
  }
  musicNodes = [];
  musicOn = false;
}

function pump() {
  const audio = context();
  const settings = liveSettings;
  if (!audio || !musicOn || !settings.music) return;
  const horizon = audio.currentTime + 0.35;
  while (nextAt < horizon) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = MELODY[step % MELODY.length];
    const peak = 0.03 * settings.musicVol;
    gain.gain.setValueAtTime(0.0001, nextAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), nextAt + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, nextAt + 0.28);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(nextAt);
    osc.stop(nextAt + 0.3);
    musicNodes.push({ osc, gain });
    nextAt += 0.32;
    step += 1;
  }
  musicNodes = musicNodes.filter((node) => {
    try {
      return node.osc.context.currentTime < nextAt;
    } catch {
      return false;
    }
  });
  raf = requestAnimationFrame(() => pump());
}

export function applyMusic(settings: Settings) {
  liveSettings = settings;
  if (!settings.music || settings.musicVol <= 0.01) {
    stopMusic();
    return;
  }
  const audio = context();
  if (!audio) return;
  if (!musicOn) {
    musicOn = true;
    nextAt = audio.currentTime + 0.05;
    pump();
  }
}
