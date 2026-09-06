// The day/night cycle.
//
// Night is the pressure valve of the whole game: the map gets darker and
// smaller, the infected get bolder, and Threat climbs faster. Everything you
// built during the day is what decides whether you enjoy it or dread it.

import { G, notify } from './state.js';
import { sfx } from '../core/audio.js';
import { clamp, lerp } from '../core/util.js';

/** One full day in seconds. Roughly nine minutes: long enough to plan around. */
export const DAY_LENGTH = 540;

// Fractions of a day. Night is the shortest phase but by far the loudest.
export const PHASES = [
  { id: 'dawn',  name: 'DAWN',  from: 0.00, to: 0.12, tint: '#2a3358', alpha: 0.30 },
  { id: 'day',   name: 'DAY',   from: 0.12, to: 0.58, tint: '#0a0c09', alpha: 0.00 },
  { id: 'dusk',  name: 'DUSK',  from: 0.58, to: 0.72, tint: '#3a2740', alpha: 0.34 },
  { id: 'night', name: 'NIGHT', from: 0.72, to: 1.00, tint: '#070c1c', alpha: 0.80 },
];

export function initClock() {
  // Start mid-morning so a new run gets a full working day before dark.
  G.dayTime = 0.16;
  G.day = 1;
  G.phase = 'day';
}

export function updateClock(dt) {
  const before = G.dayTime;
  G.dayTime += dt / DAY_LENGTH;
  if (G.dayTime >= 1) {
    G.dayTime -= 1;
    G.day++;
    notify(`DAY ${G.day}`, '#d0c46a', true, 'all');
  }
  const phase = phaseAt(G.dayTime);
  if (phase.id !== G.phase) {
    const previous = G.phase;
    G.phase = phase.id;
    announcePhase(phase, previous);
  }
  void before;
}

function announcePhase(phase) {
  if (phase.id === 'dusk') {
    notify('The light is going. Get behind something.', '#d98a4a', true, 'all');
    sfx('raidWarn');
  } else if (phase.id === 'night') {
    notify('NIGHT — they can hear you a long way off', '#8f9ad0', true, 'all');
  } else if (phase.id === 'dawn') {
    notify('First light. You made it.', '#d0c46a', true, 'all');
  }
}

export function phaseAt(t) {
  for (const p of PHASES) if (t >= p.from && t < p.to) return p;
  return PHASES[PHASES.length - 1];
}

/**
 * How dark the screen should be, smoothly blended across phase boundaries so
 * dusk creeps in rather than snapping.
 */
export function darkness(t = G.dayTime) {
  // Sample the curve as a smooth ramp rather than stepping between phases.
  const key = [
    { t: 0.00, a: 0.62, c: '#101a3a' },
    { t: 0.10, a: 0.22, c: '#2a3358' },
    { t: 0.16, a: 0.00, c: '#0a0c09' },
    { t: 0.56, a: 0.00, c: '#0a0c09' },
    { t: 0.66, a: 0.30, c: '#3a2740' },
    { t: 0.74, a: 0.62, c: '#161436' },
    { t: 0.82, a: 0.82, c: '#070c1c' },
    { t: 0.96, a: 0.78, c: '#080f24' },
    { t: 1.00, a: 0.62, c: '#101a3a' },
  ];
  for (let i = 0; i < key.length - 1; i++) {
    const a = key[i], b = key[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { alpha: lerp(a.a, b.a, k), color: k < 0.5 ? a.c : b.c };
    }
  }
  return { alpha: 0, color: '#0a0c09' };
}

export const isNight = () => G.phase === 'night';
export const isDark = () => darkness().alpha > 0.35;

/** Multipliers the rest of the simulation reads off the clock. */
export function nightFactors(t = G.dayTime) {
  const d = darkness(t).alpha;
  const k = clamp(d / 0.8, 0, 1);
  return {
    density: 1 + k * 0.85,      // more of them out there
    sense: 1 + k * 0.55,        // and they notice you sooner
    speed: 1 + k * 0.10,
    threat: 1 + k * 0.9,
    darkness: d,
  };
}

/** Readable clock, 24h, for the HUD. */
export function clockString(t = G.dayTime) {
  // Dawn sits at 06:00 so the numbers match what the screen is doing.
  const hours = (t * 24 + 6) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
