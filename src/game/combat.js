// Projectiles, melee swings and automated turret fire.
//
// Design note: player/turret bullets are blocked by *terrain* walls but pass
// over player-built structures. Top-down, your barricades are chest height —
// and being able to shoot over your own walls is what makes defending a base
// fun rather than infuriating.

import { WEAPONS, STRUCTURES, THREAT, TILE } from './config.js';
import {
  G, terrainBlocksPx, hasTerrainLineOfSight, notify, shake, takeRes, countRes,
} from './state.js';
import { damageEnemy, destroyStructure } from './damage.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { angleDelta, dist2, clamp, TAU } from '../core/util.js';
import { addThreat } from './threat.js';
import { turretPowered } from './building.js';
import { propAtTile, removeProp } from './world.js';
import { spawnPickup } from './loot.js';
import { addXp } from './progression.js';

const scratch = [];

export function spawnBullet(x, y, angle, opts) {
  G.bullets.push({
    x, y, px: x, py: y,
    vx: Math.cos(angle) * opts.speed,
    vy: Math.sin(angle) * opts.speed,
    dmg: opts.dmg,
    life: opts.life,
    knock: opts.knock || 0,
    pierce: opts.pierce || 0,
    hits: null,
    color: opts.color || '#ffe6a8',
    size: opts.size || 2.2,
    trail: opts.trail ?? 8,
    owner: opts.owner || 'player',
    crit: opts.crit || false,
  });
}

export function updateBullets(dt) {
  const hash = G.spatial;
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    b.life -= dt;
    if (b.life <= 0) { G.bullets.splice(i, 1); continue; }

    b.px = b.x; b.py = b.y;
    // Substep so fast rounds cannot tunnel through a one-tile wall.
    const dist = Math.hypot(b.vx, b.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / 12));
    let done = false;

    for (let s = 0; s < steps && !done; s++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;

      if (terrainBlocksPx(b.x, b.y)) {
        FX.sparks(b.x, b.y, -b.vx, -b.vy, 4, '#cfd6dd');
        FX.decal(b.x, b.y, 2, '#1a1a18');
        sfx('hitWall');
        done = true;
        break;
      }

      hash.query(b.x, b.y, 26, scratch);
      for (let k = 0; k < scratch.length; k++) {
        const e = scratch[k];
        if (e.dead) continue;
        if (b.hits && b.hits.has(e)) continue;
        const rr = e.def.r + b.size;
        if (dist2(b.x, b.y, e.x, e.y) > rr * rr) continue;

        damageEnemy(e, b.dmg, { fromX: b.px, fromY: b.py, knock: b.knock, crit: b.crit, source: b.owner });
        sfx('bulletHit');
        if (b.pierce > 0) {
          b.pierce--;
          b.dmg *= 0.75;
          if (!b.hits) b.hits = new Set();
          b.hits.add(e);
        } else {
          done = true;
        }
        break;
      }
    }
    if (done) G.bullets.splice(i, 1);
  }
}

// -------------------------------------------------------------------- melee --

export function meleeAttack(p, w) {
  const reach = w.range + p.r;
  const halfArc = w.arc / 2;
  const maxTargets = w.arc > 1.4 ? 6 : 3;
  const dmg = w.dmg * p.meleeMul;

  p.swing = { t: 0, dur: Math.min(0.26, w.cd * 0.75), angle: p.angle, arc: w.arc, range: reach };
  sfx('swing');

  G.spatial.query(p.x, p.y, reach + 24, scratch);
  const hits = scratch
    .filter((e) => !e.dead && dist2(e.x, e.y, p.x, p.y) < (reach + e.def.r) * (reach + e.def.r))
    .filter((e) => Math.abs(angleDelta(p.angle, Math.atan2(e.y - p.y, e.x - p.x))) < halfArc + e.def.r / reach)
    .sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y))
    .slice(0, maxTargets);

  if (hits.length) {
    sfx('meleeHit');
    shake(w.shake || 1.6);
    for (const e of hits) {
      const crit = Math.random() < 0.12;
      damageEnemy(e, dmg * (crit ? 1.9 : 1), {
        fromX: p.x, fromY: p.y, knock: w.knock, crit,
      });
    }
    // Brief hitstop makes a heavy swing land hard.
    if (w.id === 'sledge') G.slowmo = Math.max(G.slowmo, 0.06);
  } else {
    // Nothing to fight? Chop whatever scenery is in front of you instead.
    chopProp(p, w, dmg);
  }
  return hits.length;
}

/**
 * Melee against harvestable scenery. Trees are the main early wood supply, and
 * clearing them opens firing lines for turrets — so felling one is a real
 * tactical decision, not just a resource tap.
 */
function chopProp(p, w, dmg) {
  const reach = w.range + p.r;
  const tx = Math.floor((p.x + Math.cos(p.angle) * reach * 0.7) / TILE);
  const ty = Math.floor((p.y + Math.sin(p.angle) * reach * 0.7) / TILE);
  const prop = propAtTile(G.world, tx, ty);
  if (!prop) return false;

  if (!G.tutorial.done.chop) {
    G.tutorial.done.chop = true;
    notify('Keep swinging — felled trees give Wood and clear firing lines', '#a3763f', true);
  }

  // Axes are not a thing here; heavy blunt weapons are simply better at it.
  const chopMul = w.id === 'sledge' ? 1.6 : w.id === 'machete' ? 1.3 : 1;
  prop.hp -= dmg * chopMul;
  prop.hitAt = G.time;          // renderer reads this; avoids a per-frame prop loop
  FX.debris(prop.x, prop.y, 5, '#4a3a22');
  sfx('meleeHit');
  shake(1.2);

  if (prop.hp <= 0) {
    const yield_ = 6 + Math.round(Math.random() * 5 * p.lootMul);
    removeProp(G.world, prop);
    FX.debris(prop.x, prop.y, 18, '#3f5226');
    FX.text(prop.x, prop.y - 20, `WOOD +${yield_}`, '#a3763f', 12, -38, 1.0);
    sfx('structureBreak');
    for (let i = 0; i < Math.min(4, Math.ceil(yield_ / 3)); i++) {
      spawnPickup(prop.x, prop.y, 'res', 'wood', Math.ceil(yield_ / Math.min(4, Math.ceil(yield_ / 3))));
    }
    addXp(4);
  }
  return true;
}

// --------------------------------------------------------------------- guns --

export function fireGun(p, w) {
  const mag = p.mag[w.id] || 0;
  if (mag <= 0) {
    sfx('dryfire');
    startReload(p, w);
    return false;
  }
  p.mag[w.id] = mag - 1;

  const spread = w.spread * p.spreadMul;
  const muzzleDist = p.r + 12;
  const mx = p.x + Math.cos(p.angle) * muzzleDist;
  const my = p.y + Math.sin(p.angle) * muzzleDist;

  for (let i = 0; i < (w.pellets || 1); i++) {
    const a = p.angle + (Math.random() - 0.5) * spread * 2;
    const crit = Math.random() < 0.08;
    spawnBullet(mx, my, a, {
      speed: w.speed * (0.92 + Math.random() * 0.16),
      dmg: w.dmg * p.gunMul * (crit ? 1.8 : 1),
      life: w.life,
      knock: w.knock,
      pierce: w.pierce || 0,
      color: w.id === 'shotgun' ? '#ffd08a' : '#ffe6a8',
      size: w.id === 'rifle' ? 3 : 2.2,
      crit,
    });
  }

  FX.muzzle(mx, my, p.angle, w.id === 'shotgun' ? 1.9 : w.id === 'rifle' ? 1.5 : 1);
  FX.smoke(mx, my, w.id === 'shotgun' ? 4 : 1, '#7a756a');
  shake(w.shake);
  // Recoil kick, so rapid fire visibly pushes the aim around.
  p.recoil = Math.min(0.16, (p.recoil || 0) + spread * 1.4 + 0.012);
  p.vx -= Math.cos(p.angle) * (w.id === 'shotgun' ? 90 : 22);
  p.vy -= Math.sin(p.angle) * (w.id === 'shotgun' ? 90 : 22);

  sfx(w.id === 'smg' ? 'smg' : w.id === 'shotgun' ? 'shotgun' : w.id === 'rifle' ? 'rifle' : 'pistol');
  addThreat(THREAT.perGunshot * w.threat);
  alertEnemies(p.x, p.y, w.noise * p.noiseMul);
  return true;
}

export function startReload(p, w) {
  if (!w.ammo || p.reloading) return false;
  if ((p.mag[w.id] || 0) >= w.mag) return false;
  if (countRes(p.bag, w.ammo) <= 0) {
    notify(`Out of ${w.ammo === 'ammoP' ? '9mm' : w.ammo === 'ammoS' ? 'shells' : 'rifle rounds'}`, '#c96a5a');
    sfx('dryfire');
    return false;
  }
  const dur = (w.shellReload ? w.reload : w.reload) * p.reloadMul;
  p.reloading = { w: w.id, t: 0, dur, shell: !!w.shellReload };
  sfx('reload');
  return true;
}

function finishReloadStep(p, w) {
  const have = countRes(p.bag, w.ammo);
  if (have <= 0) { p.reloading = null; return; }
  if (w.shellReload) {
    // Shotguns load one shell at a time and can be interrupted by firing.
    takeRes(p.bag, w.ammo, 1);
    p.mag[w.id] = (p.mag[w.id] || 0) + 1;
    if (p.mag[w.id] >= w.mag || countRes(p.bag, w.ammo) <= 0) {
      p.reloading = null;
      sfx('reloadDone');
    } else {
      p.reloading.t = 0;
      sfx('reload');
    }
  } else {
    const need = w.mag - (p.mag[w.id] || 0);
    const take = takeRes(p.bag, w.ammo, need);
    p.mag[w.id] = (p.mag[w.id] || 0) + take;
    p.reloading = null;
    sfx('reloadDone');
  }
}

export function updateReload(p, dt) {
  if (!p.reloading) return;
  const w = WEAPONS[p.reloading.w];
  if (!w || p.weapons[p.slot] !== w.id) { p.reloading = null; return; }
  p.reloading.t += dt;
  if (p.reloading.t >= p.reloading.dur) finishReloadStep(p, w);
}

/** Gunfire pulls nearby wandering enemies toward the sound. */
export function alertEnemies(x, y, radius) {
  const r2 = radius * radius;
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, x, y) < r2) {
      e.aggro = true;
      e.alertT = 8;
      e.noiseX = x; e.noiseY = y;
    }
  }
}

// ------------------------------------------------------------------ turrets --

export function updateTurrets(dt) {
  for (const s of G.structures) {
    if (s.type !== 'turret' || s.destroyed) continue;
    const def = STRUCTURES.turret;
    const p = G.player;
    const range = def.range * (1 + (p.turretMul - 1) * 0.5);
    const dmg = def.dmg * p.turretMul;

    s.powered = turretPowered(s);
    s.cd = Math.max(0, (s.cd || 0) - dt);

    if (!s.powered) { s.targetE = null; continue; }

    // Reload from stash ammo.
    if ((s.ammo || 0) <= 0) {
      s.reloadT = (s.reloadT || 0) + dt;
      if (s.reloadT >= def.turretReload) {
        s.reloadT = 0;
        const want = def.turretMag;
        const got = takeRes(G.stash, 'ammoP', want) || takeRes(p.bag, 'ammoP', want);
        s.ammo = got;
        if (got > 0) sfx('reloadDone');
        else s.starved = true;
      }
      continue;
    }
    s.starved = false;

    // Retarget: nearest live enemy in range that the turret can actually hit.
    // Without the sight test it would happily lock onto something behind a tree
    // and pump its whole magazine into the trunk.
    G.spatial.query(s.x, s.y, range, scratch);
    const inRange = [];
    for (const e of scratch) {
      if (e.dead) continue;
      const d = dist2(s.x, s.y, e.x, e.y);
      if (d < range * range) inRange.push({ e, d });
    }
    inRange.sort((a, b) => a.d - b.d);
    let best = null;
    for (const c of inRange) {
      if (hasTerrainLineOfSight(s.x, s.y, c.e.x, c.e.y)) { best = c.e; break; }
    }
    s.targetE = best;
    s.blindT = best ? 0 : (s.blindT || 0) + dt;
    if (!best) continue;

    const want = Math.atan2(best.y - s.y, best.x - s.x);
    const d = angleDelta(s.aim ?? want, want);
    s.aim = (s.aim ?? want) + clamp(d, -7 * dt, 7 * dt);

    if (Math.abs(d) < 0.22 && s.cd <= 0) {
      s.cd = def.fireCd;
      s.ammo--;
      const a = s.aim + (Math.random() - 0.5) * 0.07;
      spawnBullet(s.x + Math.cos(a) * 18, s.y + Math.sin(a) * 18, a, {
        speed: 1300, dmg, life: 0.5, knock: 45, color: '#9fe0ff', size: 2.2, owner: 'turret',
      });
      FX.muzzle(s.x + Math.cos(a) * 20, s.y + Math.sin(a) * 20, a, 0.7);
      sfx('turret');
      addThreat(THREAT.turretPerShot);
    }
  }
}

/** Spike traps chew anything standing on them and slowly wear out. */
export function updateTraps(dt) {
  for (const s of G.structures) {
    if (s.type !== 'spike' || s.destroyed) continue;
    s.cd = Math.max(0, (s.cd || 0) - dt);
    if (s.cd > 0) continue;
    const def = STRUCTURES.spike;
    G.spatial.query(s.x, s.y, TILE, scratch);
    let hit = false;
    for (const e of scratch) {
      if (e.dead) continue;
      if (Math.abs(e.x - s.x) < TILE * 0.62 && Math.abs(e.y - s.y) < TILE * 0.62) {
        damageEnemy(e, def.trapDmg * (1 + (G.player.structHpMul - 1) * 0.4), {
          fromX: s.x, fromY: s.y, knock: 30, source: 'trap',
        });
        e.slowT = 0.5;
        hit = true;
      }
    }
    if (hit) {
      s.cd = def.trapCd;
      s.hp -= 8;                    // traps are consumable; repair or replace
      FX.sparks(s.x, s.y, 0, -1, 5, '#d0d6dc');
      if (s.hp <= 0) destroyStructure(s);
    }
  }
}

export const TAU_ = TAU;
