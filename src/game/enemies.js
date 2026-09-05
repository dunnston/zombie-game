// Enemy spawning and AI.
//
// Steering is deliberately simple but robust: walk toward the target, and if
// the direct line is blocked, fan out to the nearest clear heading. When a
// player-built wall is what's in the way, hit it instead of sliding along it —
// that's what turns a base into a tower-defence problem.

import { ENEMIES, TILE } from './config.js';
import {
  G, moveCircle, solidPx, structAtPx, hasLineOfSight, SpatialHash, unstick,
} from './state.js';
import { dangerAtPx } from './world.js';
import { damagePlayer, damageStructure } from './damage.js';
import { sfx } from '../core/audio.js';
import { makeRng, dist2, clamp, angleDelta, TAU } from '../core/util.js';

const rng = makeRng(0xBADDCAFE);
const scratch = [];

export const MAX_ENEMIES = 160;

// Ambient population target per danger tier, measured near the player.
const DENSITY = [0, 5, 10, 17, 24];
const MIX = {
  1: [['walker', 0.94], ['runner', 0.06]],
  2: [['walker', 0.70], ['runner', 0.28], ['brute', 0.02]],
  3: [['walker', 0.52], ['runner', 0.36], ['brute', 0.12]],
  4: [['walker', 0.40], ['runner', 0.36], ['brute', 0.24]],
};

export function spawnEnemy(type, x, y, opts = {}) {
  const def = ENEMIES[type];
  if (!def) return null;
  const hpMul = opts.hpMul || 1;
  const e = {
    type, def,
    x, y, vx: 0, vy: 0,
    angle: rng.range(0, TAU),
    hp: def.hp * hpMul, maxHp: def.hp * hpMul,
    flash: 0, dead: false,
    aggro: !!opts.aggro, alertT: opts.aggro ? 999 : 0,
    target: null, blocker: null,
    atkCd: rng.range(0, 0.5), windup: 0,
    anim: rng.range(0, TAU),
    slowT: 0, stuckT: 0,
    lastX: x, lastY: y,
    wanderA: rng.range(0, TAU), wanderT: 0,
    raid: !!opts.raid,
    noiseX: 0, noiseY: 0,
    growlT: rng.range(2, 12),
  };
  G.enemies.push(e);
  return e;
}

function pickType(tier) {
  const table = MIX[clamp(tier, 1, 4)];
  const r = rng();
  let acc = 0;
  for (const [t, w] of table) { acc += w; if (r <= acc) return t; }
  return 'walker';
}

/** Finds an unblocked spot on a ring around the player, outside their view. */
function findSpawnPoint(minR, maxR) {
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(minR, maxR);
    const x = G.player.x + Math.cos(a) * r;
    const y = G.player.y + Math.sin(a) * r;
    if (x < TILE * 2 || y < TILE * 2 || x > G.world.w * TILE - TILE * 2 || y > G.world.h * TILE - TILE * 2) continue;
    if (solidPx(x, y)) continue;
    return { x, y };
  }
  return null;
}

let spawnAccum = 0;

export function updateSpawning(dt) {
  const p = G.player;
  if (!p || p.dead) return;
  spawnAccum += dt;
  if (spawnAccum < 0.6) return;
  spawnAccum = 0;

  // Cull anything the player has walked far away from — keeps the sim cheap
  // and stops old aggro chains following you across the map.
  const cullR2 = 2400 * 2400;
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    if (e.dead) { G.enemies.splice(i, 1); continue; }
    if (!e.raid && dist2(e.x, e.y, p.x, p.y) > cullR2) G.enemies.splice(i, 1);
  }

  if (G.raid) return;                      // raids control their own spawning
  if (G.enemies.length >= MAX_ENEMIES) return;

  const tier = dangerAtPx(G.world, p.x, p.y);
  const near = countNear(p.x, p.y, 950);
  const want = DENSITY[clamp(tier, 1, 4)];
  if (near >= want) return;

  const ring = Math.max(880, G.viewRadius + 180);
  const spot = findSpawnPoint(ring, ring + 420);
  if (!spot) return;
  const spotTier = dangerAtPx(G.world, spot.x, spot.y);
  spawnEnemy(pickType(Math.max(tier, spotTier)), spot.x, spot.y);
}

export function countNear(x, y, r) {
  const r2 = r * r;
  let n = 0;
  for (const e of G.enemies) if (!e.dead && dist2(e.x, e.y, x, y) < r2) n++;
  return n;
}

/** Pre-populates the districts around a point so arriving somewhere feels alive. */
export function seedArea(x, y, radius, count, minR = 420) {
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, TAU), r = rng.range(minR, radius);
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (solidPx(px, py)) continue;
    spawnEnemy(pickType(dangerAtPx(G.world, px, py)), px, py);
  }
}

// ----------------------------------------------------------------- AI step --

const PROBE_ANGLES = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3];

/** Is the straight line from (x,y) along `angle` clear for `len` px? */
function clearAhead(x, y, angle, len, r) {
  const steps = Math.max(2, Math.ceil(len / 14));
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * len;
    const px = x + Math.cos(angle) * t;
    const py = y + Math.sin(angle) * t;
    if (solidPx(px + Math.cos(angle + Math.PI / 2) * r * 0.7, py + Math.sin(angle + Math.PI / 2) * r * 0.7)) return false;
    if (solidPx(px - Math.cos(angle + Math.PI / 2) * r * 0.7, py - Math.sin(angle + Math.PI / 2) * r * 0.7)) return false;
  }
  return true;
}

function steer(e, wantAngle) {
  const probeLen = 34 + e.def.r;
  for (const off of PROBE_ANGLES) {
    const a = wantAngle + off;
    if (clearAhead(e.x, e.y, a, probeLen, e.def.r)) return a;
  }
  return wantAngle;
}

/** The solid player structure directly in front of the enemy, if any. */
function blockerAhead(e, angle) {
  const d = e.def.r + 16;
  const s = structAtPx(e.x + Math.cos(angle) * d, e.y + Math.sin(angle) * d);
  if (s && s.solid && !(s.def.gate && s.open) && !s.destroyed) return s;
  return null;
}

export function updateEnemies(dt) {
  const p = G.player;
  const hash = G.spatial;

  for (const e of G.enemies) {
    if (e.dead) continue;

    e.flash = Math.max(0, e.flash - dt);
    e.atkCd = Math.max(0, e.atkCd - dt);
    e.slowT = Math.max(0, e.slowT - dt);
    e.alertT = Math.max(0, e.alertT - dt);
    e.anim += dt * (2 + e.def.speed * 0.03);
    e.growlT -= dt;
    if (e.growlT <= 0) {
      e.growlT = rng.range(4, 16);
      if (dist2(e.x, e.y, p.x, p.y) < 620 * 620) sfx('zombieGrowl');
    }

    // ---------------------------------------------------------- targeting --
    let tx, ty, targetStruct = null, targetIsPlayer = false;
    const dPlayer2 = dist2(e.x, e.y, p.x, p.y);
    const senseR = e.def.sense * (p.sneaking ? 0.55 : 1);

    if (!p.dead && (e.aggro || dPlayer2 < senseR * senseR)) {
      // Sight check stops enemies tracking you through solid buildings.
      if (e.aggro || dPlayer2 < 120 * 120 || hasLineOfSight(e.x, e.y, p.x, p.y)) {
        e.aggro = true;
        e.alertT = Math.max(e.alertT, 4);
      }
    }
    if (p.dead) e.aggro = false;

    if (e.raid && G.raid) {
      // Raiders push for the base, but will happily eat the player en route.
      if (!p.dead && dPlayer2 < 300 * 300) { tx = p.x; ty = p.y; targetIsPlayer = true; }
      else if (e.objective && !e.objective.destroyed) { tx = e.objective.x; ty = e.objective.y; targetStruct = e.objective; }
      else if (!p.dead) { tx = p.x; ty = p.y; targetIsPlayer = true; }
      else { tx = G.raid.cx; ty = G.raid.cy; }
    } else if (e.aggro && !p.dead) {
      tx = p.x; ty = p.y; targetIsPlayer = true;
    } else if (e.alertT > 0 && e.noiseX) {
      tx = e.noiseX; ty = e.noiseY;
    } else {
      // Idle shamble.
      e.wanderT -= dt;
      if (e.wanderT <= 0) { e.wanderT = rng.range(1.6, 4.2); e.wanderA += rng.range(-1.6, 1.6); }
      tx = e.x + Math.cos(e.wanderA) * 80;
      ty = e.y + Math.sin(e.wanderA) * 80;
    }

    const wantAngle = Math.atan2(ty - e.y, tx - e.x);

    // --------------------------------------------------------- attacking ---
    const dTarget = Math.hypot(tx - e.x, ty - e.y);

    if (e.windup > 0) {
      e.windup -= dt;
      if (e.windup <= 0) {
        // Land the blow if the victim is still there.
        if (e.pendingStruct && !e.pendingStruct.destroyed) {
          const s = e.pendingStruct;
          if (dist2(e.x, e.y, s.x, s.y) < (e.def.atkRange + TILE) * (e.def.atkRange + TILE)) {
            damageStructure(s, e.def.dmg * e.def.structMul, e.x, e.y);
          }
        } else if (!p.dead && dist2(e.x, e.y, p.x, p.y) < (e.def.atkRange + p.r + 6) ** 2) {
          damagePlayer(e.def.dmg, e.x, e.y, e.def.name);
        }
        e.pendingStruct = null;
      }
      e.lastX = e.x; e.lastY = e.y;
      continue;                                     // committed to the swing
    }

    // Flesh first. A reachable player always outranks scenery — otherwise a
    // zombie standing right next to you would punch the wall behind you and
    // ignore you entirely, which is both wrong and trivially exploitable.
    const playerInReach = !p.dead && dist2(e.x, e.y, p.x, p.y) < (e.def.atkRange + p.r) ** 2;
    if (playerInReach && e.atkCd <= 0) {
      e.atkCd = e.def.atkCd;
      e.windup = 0.24;
      e.pendingStruct = null;
      e.angle = Math.atan2(p.y - e.y, p.x - e.x);
      e.blocker = null;
      continue;
    }

    // Otherwise, a wall between the enemy and its goal becomes the goal.
    const blocker = playerInReach ? null : blockerAhead(e, wantAngle);
    if (blocker && (e.aggro || e.raid)) {
      e.blocker = blocker;
      if (e.atkCd <= 0) {
        e.atkCd = e.def.atkCd;
        e.windup = 0.22;
        e.pendingStruct = blocker;
        e.angle = Math.atan2(blocker.y - e.y, blocker.x - e.x);
      }
      e.lastX = e.x; e.lastY = e.y;
      continue;
    }
    e.blocker = null;

    if (targetStruct && dTarget < e.def.atkRange + TILE * 0.5 && e.atkCd <= 0) {
      e.atkCd = e.def.atkCd;
      e.windup = 0.22;
      e.pendingStruct = targetStruct;
      e.angle = wantAngle;
      continue;
    }

    // ----------------------------------------------------------- movement --
    const moveAngle = steer(e, wantAngle);
    e.angle = e.angle + clamp(angleDelta(e.angle, moveAngle), -9 * dt, 9 * dt);

    let speed = e.def.speed;
    if (e.slowT > 0) speed *= 0.45;
    if (!e.aggro && !e.raid) speed *= 0.45;
    // Runners lunge in bursts rather than sprinting flat out.
    if (e.type === 'runner' && e.aggro) speed *= 1 + Math.sin(e.anim * 1.7) * 0.18;

    e.vx += Math.cos(moveAngle) * speed * 8 * dt;
    e.vy += Math.sin(moveAngle) * speed * 8 * dt;

    // Separation — keeps a horde as a crowd rather than a single stacked blob.
    hash.query(e.x, e.y, e.def.r * 3, scratch);
    for (let i = 0; i < scratch.length; i++) {
      const o = scratch[i];
      if (o === e || o.dead) continue;
      const dx = e.x - o.x, dy = e.y - o.y;
      const d2 = dx * dx + dy * dy;
      const want = e.def.r + o.def.r;
      if (d2 < want * want && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (want - d) / want;
        e.vx += (dx / d) * push * 220 * dt * 4;
        e.vy += (dy / d) * push * 220 * dt * 4;
      }
    }

    const damp = Math.exp(-7.5 * dt);
    e.vx *= damp; e.vy *= damp;
    const vlen = Math.hypot(e.vx, e.vy);
    const cap = speed * 1.55;
    if (vlen > cap) { e.vx = (e.vx / vlen) * cap; e.vy = (e.vy / vlen) * cap; }

    moveCircle(e, e.vx * dt, e.vy * dt, e.def.r);

    // ------------------------------------------------------ stuck rescue ---
    const moved = dist2(e.x, e.y, e.lastX, e.lastY);
    if ((e.aggro || e.raid) && moved < 1.2) {
      e.stuckT += dt;
      if (e.stuckT > 0.7) {
        // Punch whatever player-built thing is adjacent; otherwise sidestep.
        const s = adjacentStructure(e);
        if (s && e.atkCd <= 0) {
          e.atkCd = e.def.atkCd;
          e.windup = 0.22;
          e.pendingStruct = s;
        } else {
          unstick(e, e.def.r);
          e.wanderA = wantAngle + (rng.chance(0.5) ? 1.4 : -1.4);
          e.vx += Math.cos(e.wanderA) * 160;
          e.vy += Math.sin(e.wanderA) * 160;
        }
        e.stuckT = 0;
      }
    } else {
      e.stuckT = 0;
    }
    e.lastX = e.x; e.lastY = e.y;
  }
}

function adjacentStructure(e) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const s = structAtPx(e.x + Math.cos(a) * (e.def.r + 14), e.y + Math.sin(a) * (e.def.r + 14));
    if (s && s.solid && !s.destroyed && !(s.def.gate && s.open)) return s;
  }
  return null;
}

export function rebuildSpatial() {
  if (!G.spatial) G.spatial = new SpatialHash();
  G.spatial.clear();
  for (const e of G.enemies) if (!e.dead) G.spatial.insert(e);
}

export function clearEnemies() {
  G.enemies.length = 0;
  if (G.spatial) G.spatial.clear();
}
