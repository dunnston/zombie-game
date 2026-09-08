// Projectiles, melee swings and automated turret fire.
//
// Design note: player/turret bullets are blocked by *terrain* walls but pass
// over player-built structures. Top-down, your barricades are chest height —
// and being able to shoot over your own walls is what makes defending a base
// fun rather than infuriating.

import { WEAPONS, STRUCTURES, THREAT, TILE, RES, PLAYER } from './config.js';
import {
  G, bulletBlocksPx, hasTerrainLineOfSight, notify, shake, takeRes, countRes,
  isLocal, baseOwner, presentPlayers,
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
import { emit } from '../net/events.js';
import { makeNoise, alertEnemies, NOISE } from './noise.js';
import { ignite } from './fire.js';

const scratch = [];

export function spawnBullet(x, y, angle, opts) {
  // Guests draw the tracer themselves; the hit is decided here.
  if (opts.owner !== 'remote') {
    emit('bullet', {
      x: Math.round(x), y: Math.round(y), a: Math.round(angle * 1000) / 1000, sp: Math.round(opts.speed),
      lf: Math.round(opts.life * 100) / 100, c: opts.color || '#ffe6a8', sz: opts.size || 2.2, w: opts.w || null,
    });
  }
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
    // The player object for a player's shot, or a tag for anything automated.
    owner: opts.owner || null,
    crit: opts.crit || false,
    // Tower armaments. `burns` sets what it hits alight; `splash` is a radius
    // that catches everything around the impact for a share of the damage.
    burns: !!opts.burns,
    splash: opts.splash || 0,
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

      if (bulletBlocksPx(b.x, b.y)) {
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
        if (b.burns) ignite(e);
        if (b.splash > 0) splashDamage(b, e);
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

/**
 * What one harvest swing costs in stamina. Exported so the HUD, the tests and
 * the guest's own prediction all ask the same question rather than three
 * copies of the arithmetic drifting apart.
 */
export const chopStamCost = (p) => PLAYER.stamChop * (p.chopStamMul ?? 1);

/**
 * Enough left to swing at scenery? Fighting never asks this.
 *
 * `p.winded` is the hysteresis: it latches when the bar empties — however it
 * emptied, sprinting included — and only clears once you are back to half. See
 * `movePlayer`, which owns both edges so a guest predicting its own movement
 * arrives at the same answer the host will.
 */
export const canChop = (p) => !p.winded && p.stam >= chopStamCost(p);

/**
 * One melee swing. Returns true if the swing happened.
 *
 * The stamina rules live here rather than in `updatePlayer` because this is
 * the only place that knows whether a swing was a fight or a job: the arc is
 * searched for enemies first, and only an empty arc falls through to the
 * scenery. A fight costs `stamSwing` and is never refused; a harvest costs
 * `chopStamCost(p)`, stops recovery for `stamChopDelay`, and IS refused when
 * the bar is short — which is what makes three trees a decision.
 */
/** Everything a swing of `w` would connect with, nearest first. */
function meleeTargets(p, w) {
  const reach = w.range + p.r;
  const halfArc = w.arc / 2;
  const maxTargets = w.arc > 1.4 ? 6 : 3;
  G.spatial.query(p.x, p.y, reach + 24, scratch);
  return scratch
    .filter((e) => !e.dead && dist2(e.x, e.y, p.x, p.y) < (reach + e.def.r) * (reach + e.def.r))
    .filter((e) => Math.abs(angleDelta(p.angle, Math.atan2(e.y - p.y, e.x - p.x))) < halfArc + e.def.r / reach)
    .sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y))
    .slice(0, maxTargets);
}

/**
 * Would this swing be turned down for want of puff? Only work is ever
 * refused, so an enemy in the arc always answers no.
 *
 * Exported because a guest predicts its own swing arc locally (see
 * `predictSwing` in net/client.js) and must ask exactly the question the host
 * is about to ask, or it plays an animation for a swing that never happens.
 * `fighting` is passed in when the caller has already done the arc query.
 */
export function swingRefused(p, w, fighting = null) {
  if (fighting === null ? meleeTargets(p, w).length > 0 : fighting) return false;
  return !canChop(p) && !!propInFront(p, w);
}

export function meleeAttack(p, w) {
  const reach = w.range + p.r;
  const dmg = w.dmg * p.meleeMul * (p.adrenalineActive ? 1.45 : 1);
  const hits = meleeTargets(p, w);

  // Nothing to fight, something to harvest, and no puff left: refuse before
  // the animation starts, so a winded player sees why nothing is happening
  // instead of swinging uselessly at a tree.
  if (swingRefused(p, w, hits.length > 0)) {
    // Being turned down for work IS what makes you winded. Latching here
    // rather than at "stamina hit exactly zero" is the difference between a
    // pause and a dribble: 110 stamina is 18 swings of 6, so the bar stops at
    // 2 and never reaches zero, and without this latch the player simply
    // regenerated one swing's worth and took it, forever. Measured in the
    // browser — the first version of this fix did nothing for that reason.
    if (!p.winded) p.windedAt = 0;
    p.winded = true;
    if (!p.windedAt || G.time - p.windedAt > 3) {
      p.windedAt = G.time;
      if (isLocal(p)) notify('Winded — get your breath back before working again', '#d9c46a');
    }
    sfx('deny');
    return false;
  }

  p.swing = { t: 0, dur: Math.min(0.26, w.cd * 0.75), angle: p.angle, arc: w.arc, range: reach };
  sfx('swing');

  if (hits.length) {
    p.stam = Math.max(0, p.stam - PLAYER.stamSwing);
    sfx('meleeHit');
    if (isLocal(p)) shake(w.shake || 1.6);
    for (const e of hits) {
      const crit = Math.random() < p.critChance + 0.06;
      damageEnemy(e, dmg * (crit ? 1.9 : 1), {
        fromX: p.x, fromY: p.y, knock: w.knock, crit, source: p,
      });
    }
    // Brief hitstop makes a heavy swing land hard. It is a feel effect for the
    // person swinging — slowing the whole world for someone else's hit is not.
    if (w.id === 'sledge' && isLocal(p)) G.slowmo = Math.max(G.slowmo, 0.06);
  } else if (chopProp(p, w, dmg)) {
    p.stam = Math.max(0, p.stam - chopStamCost(p));
    p.stamLock = PLAYER.stamChopDelay;
  }
  // A swing that connects with nothing — thin air, or a tree you have no axe
  // for — costs nothing. Charging for it made flailing at the scenery a way to
  // exhaust yourself, and it is already its own punishment.
  return true;
}

/**
 * The tile a swing would land on, if it holds scenery this weapon could
 * actually harvest. The tool gate is part of the question: swinging a pipe at
 * a tree should say "you need a hatchet", not "you are too tired".
 */
function propInFront(p, w) {
  const reach = w.range + p.r;
  const tx = Math.floor((p.x + Math.cos(p.angle) * reach * 0.7) / TILE);
  const ty = Math.floor((p.y + Math.sin(p.angle) * reach * 0.7) / TILE);
  const prop = propAtTile(G.world, tx, ty);
  if (!prop) return null;
  const rule = HARVEST[prop.harvest];
  if (!rule || (rule.needs && !w[rule.needs])) return null;
  return prop;
}

/**
 * What each kind of scenery gives up, and what it takes to get it. Bushes and
 * rocks come apart under anything; a tree needs an axe. `bonus` is a second,
 * smaller drop — the sticks that fall with a bush or a felled tree.
 */
/**
 * Keyed by the rule, not by the resource, because two kinds of scenery can
 * give the same material on very different terms: a loose rock comes apart
 * under your hands, a boulder does not move without a pickaxe.
 *
 * `needs` is the tool without which nothing happens at all; `boost` is the
 * tool that merely does it better. Small scenery never has a `needs` — the
 * tools are made from what small scenery drops, so gating it would deadlock
 * the opening.
 */
export const HARVEST = {
  wood:    { res: 'wood',  min: 6, max: 11, bonus: 'sticks', bonusMin: 1, bonusMax: 3, needs: 'axe', xp: 4, debris: '#3f5226', label: 'WOOD' },
  fiber:   { res: 'fiber', min: 2, max: 4, bonus: 'sticks', bonusMin: 1, bonusMax: 2, boost: 'scythe', xp: 2, debris: '#4a6a2a', label: 'FIBER' },
  stone:   { res: 'stone', min: 2, max: 4, boost: 'pick', xp: 2, debris: '#6a6660', label: 'STONE' },
  boulder: { res: 'stone', min: 9, max: 16, needs: 'pick', xp: 5, debris: '#6a6660', label: 'STONE' },
  // Ground litter: taken by hand with the interact key, never swung at. Small
  // yields, but there is a lot of it and it costs nothing but the walk.
  litter_sticks: { res: 'sticks', min: 2, max: 4, xp: 1, debris: '#6b4e2e', label: 'STICKS' },
  litter_stone:  { res: 'stone',  min: 1, max: 3, xp: 1, debris: '#6a6660', label: 'STONE' },
  litter_fiber:  { res: 'fiber',  min: 2, max: 4, xp: 1, debris: '#4a6a2a', label: 'FIBER' },
  thicket: { res: 'fiber', min: 9, max: 15, bonus: 'sticks', bonusMin: 2, bonusMax: 4, needs: 'scythe', xp: 4, debris: '#4a6a2a', label: 'FIBER' },
};

/** What to tell someone swinging the wrong thing at it. Said once in a while. */
const NEEDS_HINT = {
  axe: 'You need a HATCHET to fell trees — bushes give fiber and sticks, rocks give stone',
  pick: 'That boulder needs a STONE PICKAXE — loose rocks you can break by hand',
  scythe: 'That thicket needs a SCYTHE — small bushes you can pull by hand',
};

/**
 * How much harder than a punch this weapon hits scenery. Heavy blunt weapons
 * are better at breaking things, a tool is built for it, and the tool made for
 * *this* material is better again.
 *
 * Exported because the shape of the whole gathering tier is "how many swings
 * is a tree", and a test that re-derived this formula would keep passing while
 * the formula moved underneath it.
 */
export function chopMultiplier(w, p, rule) {
  const boosted = !!(rule && rule.boost && w[rule.boost]);
  const base = w.chopMul || (w.id === 'sledge' ? 1.6 : w.id === 'machete' ? 1.3 : 1);
  return base * (boosted ? 1.6 : 1) * p.chopMul;
}

/** Drops `n` of a resource at a spot in a few piles, so it is readable on the ground. */
function dropRes(x, y, id, n) {
  const piles = Math.min(4, Math.ceil(n / 3));
  for (let i = 0; i < piles; i++) spawnPickup(x, y, 'res', id, Math.ceil(n / piles));
}

/**
 * Melee against harvestable scenery. Bushes give fiber and sticks, rocks give
 * stone, and those three make the hatchet that fells trees — the main early
 * wood supply, and the thing that opens firing lines for turrets. Felling one
 * is a real tactical decision, not just a resource tap.
 */
/**
 * Returns true only when the swing actually bit into the scenery. A swing at
 * nothing, or one that bounced off a tree for want of an axe, returns false —
 * `meleeAttack` charges those as an ordinary swing rather than as a full day's
 * work, because neither of them moved any material.
 */
function chopProp(p, w, dmg) {
  const reach = w.range + p.r;
  const tx = Math.floor((p.x + Math.cos(p.angle) * reach * 0.7) / TILE);
  const ty = Math.floor((p.y + Math.sin(p.angle) * reach * 0.7) / TILE);
  const prop = propAtTile(G.world, tx, ty);
  if (!prop) return false;
  const rule = HARVEST[prop.harvest] || HARVEST.wood;

  if (rule.needs && !w[rule.needs]) {
    // Bounce off. Say so once, and then only now and again.
    if (!p.axeHintAt || G.time - p.axeHintAt > 6) {
      p.axeHintAt = G.time;
      if (isLocal(p)) notify(NEEDS_HINT[rule.needs], '#d9c46a', true);
    }
    FX.debris(prop.x, prop.y, 2, '#4a3a22');
    sfx('hitWall');
    return false;
  }
  if (!G.tutorial.done.chop) {
    G.tutorial.done.chop = true;
    notify('Keep swinging — scenery breaks into materials. A hatchet is craftable by hand', '#a3763f', true);
  }

  const boosted = !!(rule.boost && w[rule.boost]);
  prop.hp -= dmg * chopMultiplier(w, p, rule);
  prop.hitAt = G.time;          // renderer reads this; avoids a per-frame prop loop
  FX.debris(prop.x, prop.y, 5, rule.debris);
  sfx('meleeHit');
  // Work is audible. Felling a tree in the open is a decision now that it
  // costs stamina; this is the other half of the cost.
  makeNoise(prop.x, prop.y, NOISE.chop, p);
  if (isLocal(p)) shake(1.2);

  if (prop.hp <= 0) {
    let n = rule.min + Math.round(Math.random() * (rule.max - rule.min) * p.lootMul);
    if (boosted) n = Math.round(n * (w.toolMul || 2));
    emit('prop', { key: `${prop.tx},${prop.ty}` });
    removeProp(G.world, prop);
    FX.debris(prop.x, prop.y, 18, rule.debris);
    FX.text(prop.x, prop.y - 20, `${rule.label} +${n}`, RES[rule.res] ? RES[rule.res].color : '#a3763f', 12, -38, 1.0);
    sfx('structureBreak');
    dropRes(prop.x, prop.y, rule.res, n);
    if (rule.bonus && Math.random() < 0.8) {
      const b = rule.bonusMin + Math.round(Math.random() * (rule.bonusMax - rule.bonusMin));
      dropRes(prop.x, prop.y, rule.bonus, b);
    }
    addXp(p, rule.xp || 2);
  }
  return true;
}

/**
 * A cannon round catches everything around where it landed for a share of the
 * damage. The direct hit has already been paid, so the target is skipped.
 */
function splashDamage(b, hit) {
  const r = b.splash;
  G.spatial.query(b.x, b.y, r, scratch);
  for (const e of scratch) {
    if (e.dead || e === hit) continue;
    const d2 = dist2(b.x, b.y, e.x, e.y);
    if (d2 > r * r) continue;
    // Full damage at the centre, a third at the edge.
    const falloff = 1 - (Math.sqrt(d2) / r) * 0.66;
    damageEnemy(e, b.dmg * falloff, {
      fromX: b.x, fromY: b.y, knock: b.knock * 0.5, source: b.owner,
    });
    if (b.burns) ignite(e);
  }
  FX.ring(b.x, b.y, 6, r, 0.32, '#ffb45a', 3);
  FX.debris(b.x, b.y, 10, '#a0764a');
}

// --------------------------------------------------------------------- guns --

export function fireGun(p, w) {
  const mag = p.mag[w.id] || 0;
  if (mag <= 0) {
    sfx('dryfire');
    startReload(p, w);
    return false;
  }
  // Ammo Cache (Luck perk) sometimes gives the round back.
  const freeShot = p.freeShotChance > 0 && Math.random() < p.freeShotChance;
  if (!freeShot) p.mag[w.id] = mag - 1;

  const spread = w.spread * p.spreadMul;
  const muzzleDist = p.r + 12;
  const mx = p.x + Math.cos(p.angle) * muzzleDist;
  const my = p.y + Math.sin(p.angle) * muzzleDist;

  for (let i = 0; i < (w.pellets || 1); i++) {
    const a = p.angle + (Math.random() - 0.5) * spread * 2;
    const crit = Math.random() < p.critChance;
    spawnBullet(mx, my, a, {
      speed: w.speed * (0.92 + Math.random() * 0.16),
      dmg: w.dmg * p.gunMul * (crit ? 1.8 : 1),
      life: w.life * p.rangeMul,
      knock: w.knock,
      pierce: w.pierce || 0,
      color: w.bow ? '#c8a878' : w.id === 'shotgun' ? '#ffd08a' : '#ffe6a8',
      size: w.bow ? 2.8 : w.id === 'rifle' ? 3 : 2.2,
      trail: w.bow ? 14 : undefined,
      crit,
      owner: p,
      w: i === 0 ? w.id : null,      // one sound per shot, not per pellet
    });
  }

  // No flash and no smoke from a bow — a muzzle particle is also a light
  // source at night (see drawNight), and a bow that lit up the treeline every
  // shot would give away the one thing it is for.
  if (!w.bow) {
    FX.muzzle(mx, my, p.angle, w.id === 'shotgun' ? 1.9 : w.id === 'rifle' ? 1.5 : 1);
    FX.smoke(mx, my, w.id === 'shotgun' ? 4 : 1, '#7a756a');
  }
  if (isLocal(p)) shake(w.shake);
  // Recoil kick, so rapid fire visibly pushes the aim around.
  p.recoil = Math.min(0.16, (p.recoil || 0) + spread * 1.4 + 0.012);
  p.vx -= Math.cos(p.angle) * (w.id === 'shotgun' ? 90 : 22);
  p.vy -= Math.sin(p.angle) * (w.id === 'shotgun' ? 90 : 22);

  sfx(w.bow ? 'swing' : w.id === 'smg' ? 'smg' : w.id === 'shotgun' ? 'shotgun' : w.id === 'rifle' ? 'rifle' : 'pistol');
  addThreat(THREAT.perGunshot * w.threat, '', p);
  makeNoise(p.x, p.y, w.noise, p);
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
  const held = p.hotbar.slots[p.slot];
  if (!w || !held || held.id !== w.id) { p.reloading = null; return; }
  p.reloading.t += dt;
  if (p.reloading.t >= p.reloading.dur) finishReloadStep(p, w);
}

// ------------------------------------------------------------------ turrets --

export function updateTurrets(dt) {
  // Turret reach and punch are base-wide — the base owner's perks.
  const owner = baseOwner();
  if (!owner) return;
  for (const s of G.structures) {
    if (s.type !== 'turret' || s.destroyed) continue;
    const def = STRUCTURES.turret;
    const range = def.range * (1 + (owner.turretMul - 1) * 0.5);
    const dmg = def.dmg * owner.turretMul;

    s.powered = turretPowered(s);
    s.cd = Math.max(0, (s.cd || 0) - dt);

    if (!s.powered) { s.targetE = null; continue; }

    // Reload from stash ammo, falling back to whatever anyone present carries.
    if ((s.ammo || 0) <= 0) {
      s.reloadT = (s.reloadT || 0) + dt;
      if (s.reloadT >= def.turretReload) {
        s.reloadT = 0;
        const want = def.turretMag;
        let got = takeRes(G.stash, 'ammoP', want);
        for (const q of presentPlayers()) {
          if (got > 0) break;
          got = takeRes(q.bag, 'ammoP', want);
        }
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
        speed: 1300, dmg, life: 0.5, knock: 45, color: '#9fe0ff', size: 2.2, owner: 'turret', w: 'turret',
      });
      FX.muzzle(s.x + Math.cos(a) * 20, s.y + Math.sin(a) * 20, a, 0.7);
      sfx('turret');
      addThreat(THREAT.turretPerShot);
      // A machine gun on a post. It pulls the horde onto itself, which is the
      // whole trade an arrow tower exists to offer an alternative to.
      makeNoise(s.x, s.y, NOISE.turret, owner);
    }
  }
}

/** Spike traps chew anything standing on them and slowly wear out. */
export function updateTraps(dt) {
  const owner = baseOwner();
  if (!owner) return;
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
        damageEnemy(e, def.trapDmg * (1 + (owner.structHpMul - 1) * 0.4), {
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
