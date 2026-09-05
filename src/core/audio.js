// All audio is synthesised at runtime with WebAudio — no asset files, no network.
// Every entry point is guarded so a browser that blocks/breaks audio can never
// stop the game from running.

let ctx = null;
let master = null;
let muted = false;
let noiseBuffer = null;
// Rate-limits identical sounds so a shotgun blast hitting 12 zombies is one impact, not twelve.
const lastPlayed = new Map();

export function initAudio() {
  if (ctx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);

    const len = ctx.sampleRate * 1.0;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

export function resumeAudio() {
  if (!ctx) initAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.35;
  return muted;
}

export const isMuted = () => muted;

const now = () => (ctx ? ctx.currentTime : 0);

function throttled(name, ms) {
  const t = performance.now();
  const last = lastPlayed.get(name) || -1e9;
  if (t - last < ms) return false;
  lastPlayed.set(name, t);
  return true;
}

function tone({ freq = 440, endFreq = null, type = 'square', dur = 0.12, gain = 0.3, delay = 0, sweep = 'exponential' }) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (endFreq !== null) {
    const target = Math.max(20, endFreq);
    if (sweep === 'linear') osc.frequency.linearRampToValueAtTime(target, t0 + dur);
    else osc.frequency.exponentialRampToValueAtTime(target, t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.15, gain = 0.3, filter = 'lowpass', freq = 1200, endFreq = null, q = 1, delay = 0 }) {
  if (!ctx || muted || !noiseBuffer) return;
  const t0 = now() + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.frequency.setValueAtTime(freq, t0);
  bq.Q.value = q;
  if (endFreq !== null) bq.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bq).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const SFX = {
  pistol() {
    noise({ dur: 0.09, gain: 0.34, filter: 'highpass', freq: 900, q: 0.6 });
    tone({ freq: 320, endFreq: 60, type: 'square', dur: 0.08, gain: 0.22 });
  },
  smg() {
    noise({ dur: 0.06, gain: 0.24, filter: 'highpass', freq: 1100, q: 0.6 });
    tone({ freq: 380, endFreq: 90, type: 'square', dur: 0.05, gain: 0.15 });
  },
  shotgun() {
    noise({ dur: 0.26, gain: 0.5, filter: 'lowpass', freq: 2600, endFreq: 180 });
    tone({ freq: 150, endFreq: 40, type: 'sawtooth', dur: 0.22, gain: 0.3 });
  },
  rifle() {
    noise({ dur: 0.14, gain: 0.42, filter: 'highpass', freq: 700, q: 0.8 });
    tone({ freq: 520, endFreq: 70, type: 'square', dur: 0.13, gain: 0.26 });
  },
  turret() {
    noise({ dur: 0.05, gain: 0.14, filter: 'highpass', freq: 1500, q: 0.7 });
    tone({ freq: 620, endFreq: 200, type: 'square', dur: 0.05, gain: 0.08 });
  },
  dryfire() { tone({ freq: 900, endFreq: 500, type: 'square', dur: 0.04, gain: 0.09 }); },
  reload() {
    tone({ freq: 220, endFreq: 160, type: 'square', dur: 0.06, gain: 0.14 });
    noise({ dur: 0.05, gain: 0.14, filter: 'bandpass', freq: 2200, q: 2, delay: 0.11 });
  },
  reloadDone() { tone({ freq: 340, endFreq: 520, type: 'square', dur: 0.07, gain: 0.16 }); },
  swing() { noise({ dur: 0.13, gain: 0.16, filter: 'bandpass', freq: 900, endFreq: 320, q: 1.2 }); },
  meleeHit() {
    noise({ dur: 0.11, gain: 0.34, filter: 'lowpass', freq: 900, endFreq: 200 });
    tone({ freq: 130, endFreq: 55, type: 'triangle', dur: 0.1, gain: 0.22 });
  },
  bulletHit() { noise({ dur: 0.07, gain: 0.2, filter: 'bandpass', freq: 1400, q: 1.4 }); },
  hitWall() { noise({ dur: 0.06, gain: 0.14, filter: 'highpass', freq: 2400, q: 2 }); },
  zombieDie() {
    tone({ freq: 210, endFreq: 62, type: 'sawtooth', dur: 0.34, gain: 0.2 });
    noise({ dur: 0.3, gain: 0.16, filter: 'lowpass', freq: 700, endFreq: 120 });
  },
  zombieGrowl() {
    tone({ freq: 95 + Math.random() * 40, endFreq: 60, type: 'sawtooth', dur: 0.5, gain: 0.1 });
  },
  playerHurt() {
    tone({ freq: 260, endFreq: 130, type: 'triangle', dur: 0.18, gain: 0.24 });
    noise({ dur: 0.12, gain: 0.16, filter: 'lowpass', freq: 600 });
  },
  playerDie() {
    tone({ freq: 340, endFreq: 55, type: 'sawtooth', dur: 1.1, gain: 0.3 });
    noise({ dur: 1.0, gain: 0.2, filter: 'lowpass', freq: 900, endFreq: 90 });
  },
  pickup() {
    tone({ freq: 640, type: 'square', dur: 0.05, gain: 0.14 });
    tone({ freq: 960, type: 'square', dur: 0.06, gain: 0.12, delay: 0.05 });
  },
  loot() {
    noise({ dur: 0.2, gain: 0.16, filter: 'bandpass', freq: 1100, q: 1.1 });
    tone({ freq: 480, endFreq: 720, type: 'square', dur: 0.1, gain: 0.12, delay: 0.08 });
  },
  build() {
    tone({ freq: 180, endFreq: 300, type: 'square', dur: 0.09, gain: 0.2 });
    noise({ dur: 0.1, gain: 0.2, filter: 'lowpass', freq: 1400, delay: 0.02 });
  },
  craft() {
    tone({ freq: 300, type: 'square', dur: 0.06, gain: 0.14 });
    tone({ freq: 450, type: 'square', dur: 0.06, gain: 0.14, delay: 0.07 });
    tone({ freq: 680, type: 'square', dur: 0.1, gain: 0.15, delay: 0.14 });
  },
  deny() { tone({ freq: 200, endFreq: 120, type: 'square', dur: 0.12, gain: 0.16 }); },
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.2, delay: i * 0.09 }));
  },
  raidWarn() {
    tone({ freq: 220, endFreq: 150, type: 'sawtooth', dur: 0.75, gain: 0.26 });
    tone({ freq: 224, endFreq: 154, type: 'sawtooth', dur: 0.75, gain: 0.2, delay: 0.02 });
  },
  raidWin() {
    [392, 523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.22, delay: i * 0.11 }));
  },
  structureHit() { noise({ dur: 0.1, gain: 0.2, filter: 'lowpass', freq: 700, endFreq: 200 }); },
  structureBreak() {
    noise({ dur: 0.45, gain: 0.34, filter: 'lowpass', freq: 1600, endFreq: 100 });
    tone({ freq: 160, endFreq: 45, type: 'sawtooth', dur: 0.4, gain: 0.2 });
  },
  heal() {
    tone({ freq: 420, endFreq: 700, type: 'sine', dur: 0.28, gain: 0.2 });
  },
  ui() { tone({ freq: 700, type: 'square', dur: 0.03, gain: 0.07 }); },
};

// Some effects fire many times in one frame; cap them so they stay punchy.
const THROTTLE = {
  bulletHit: 28, hitWall: 40, structureHit: 45, zombieDie: 30,
  meleeHit: 25, turret: 45, zombieGrowl: 260, playerHurt: 140,
};

export function sfx(name) {
  if (!ctx || muted) return;
  const fn = SFX[name];
  if (!fn) return;
  const t = THROTTLE[name];
  if (t && !throttled(name, t)) return;
  try { fn(); } catch { /* never let audio break the frame */ }
}
