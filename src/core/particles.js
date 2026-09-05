// Pooled particles, floating combat text, and persistent ground decals.
// Everything here is purely cosmetic — gameplay never reads from it.

import { TAU } from './util.js';

const MAX_PARTICLES = 900;
const MAX_TEXT = 90;
const MAX_DECALS = 420;

export const FX = {
  parts: [],
  texts: [],
  decals: [],
  ring: [],
};

function spawn(p) {
  if (FX.parts.length >= MAX_PARTICLES) FX.parts.shift();
  FX.parts.push(p);
}

export function blood(x, y, dirX = 0, dirY = 0, amount = 8, tint = '#8f1f1f') {
  for (let i = 0; i < amount; i++) {
    const a = Math.random() * TAU;
    const sp = 40 + Math.random() * 190;
    spawn({
      x, y,
      vx: Math.cos(a) * sp + dirX * 120,
      vy: Math.sin(a) * sp + dirY * 120,
      life: 0.32 + Math.random() * 0.4, t: 0,
      size: 1.6 + Math.random() * 2.6,
      color: tint, drag: 3.4, kind: 'blood', gore: Math.random() < 0.4,
    });
  }
}

export function sparks(x, y, dirX, dirY, amount = 6, color = '#ffd27a') {
  for (let i = 0; i < amount; i++) {
    const a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 2.0;
    const sp = 110 + Math.random() * 300;
    spawn({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.14 + Math.random() * 0.2, t: 0,
      size: 1 + Math.random() * 1.8, color, drag: 5, kind: 'spark',
    });
  }
}

export function debris(x, y, amount = 8, color = '#8a7350') {
  for (let i = 0; i < amount; i++) {
    const a = Math.random() * TAU;
    const sp = 50 + Math.random() * 200;
    spawn({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.4 + Math.random() * 0.5, t: 0,
      size: 1.5 + Math.random() * 3, color, drag: 4.2, kind: 'debris',
      spin: (Math.random() - 0.5) * 14, rot: Math.random() * TAU,
    });
  }
}

export function smoke(x, y, amount = 5, color = '#6a6a62') {
  for (let i = 0; i < amount; i++) {
    const a = Math.random() * TAU;
    spawn({
      x, y, vx: Math.cos(a) * 22, vy: Math.sin(a) * 22 - 12,
      life: 0.6 + Math.random() * 0.7, t: 0,
      size: 4 + Math.random() * 7, color, drag: 1.4, kind: 'smoke', grow: 16,
    });
  }
}

export function muzzle(x, y, angle, scale = 1) {
  spawn({
    x, y, vx: Math.cos(angle) * 40, vy: Math.sin(angle) * 40,
    life: 0.055, t: 0, size: 9 * scale, color: '#ffe6a8', kind: 'muzzle',
    angle, drag: 1,
  });
  sparks(x, y, Math.cos(angle), Math.sin(angle), 3 + Math.floor(scale * 2));
}

export function ring(x, y, r0, r1, life, color, width = 2) {
  FX.ring.push({ x, y, r0, r1, life, t: 0, color, width });
}

export function text(x, y, str, color = '#f0e6cf', size = 13, vy = -46, life = 0.85) {
  if (FX.texts.length >= MAX_TEXT) FX.texts.shift();
  FX.texts.push({ x, y, str, color, size, vy, life, t: 0 });
}

export function damageNumber(x, y, amount, crit = false) {
  text(
    x + (Math.random() - 0.5) * 12, y - 6,
    crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`,
    crit ? '#ffd45e' : '#f2e4cd',
    crit ? 17 : 12,
    -52 - Math.random() * 20,
    crit ? 1.0 : 0.72,
  );
}

export function decal(x, y, r, color) {
  if (FX.decals.length >= MAX_DECALS) FX.decals.shift();
  FX.decals.push({ x, y, r, color, rot: Math.random() * TAU });
}

export function updateFX(dt) {
  for (let i = FX.parts.length - 1; i >= 0; i--) {
    const p = FX.parts[i];
    p.t += dt;
    if (p.t >= p.life) {
      if (p.kind === 'blood' && p.gore) decal(p.x, p.y, p.size * 1.3, '#5c1414');
      FX.parts.splice(i, 1);
      continue;
    }
    const d = Math.exp(-(p.drag || 3) * dt);
    p.vx *= d; p.vy *= d;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.spin) p.rot += p.spin * dt;
    if (p.grow) p.size += p.grow * dt;
  }

  for (let i = FX.texts.length - 1; i >= 0; i--) {
    const t = FX.texts[i];
    t.t += dt;
    if (t.t >= t.life) { FX.texts.splice(i, 1); continue; }
    t.y += t.vy * dt;
    t.vy *= Math.exp(-2.2 * dt);
  }

  for (let i = FX.ring.length - 1; i >= 0; i--) {
    const r = FX.ring[i];
    r.t += dt;
    if (r.t >= r.life) FX.ring.splice(i, 1);
  }
}

export function clearFX() {
  FX.parts.length = 0;
  FX.texts.length = 0;
  FX.decals.length = 0;
  FX.ring.length = 0;
}
