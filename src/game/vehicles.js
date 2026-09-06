// Drivable cars.
//
// A car is the answer to the two things that most limit a run: carry capacity
// and the walk to the far districts. It costs Fuel, it is loud, and most of
// them are locked — so getting one running is a small goal in itself rather
// than a free upgrade lying in the street.

import { TILE, RES } from './config.js';
import { ITEMS, slotsEntries, packAllowance } from './items.js';
import {
  G, notify, terrainBlocksPx, solidPx, addResCapped, addRes, takeRes, countRes,
  shake, screenFlash, isLocal,
} from './state.js';
import { damageEnemy } from './damage.js';
import { spawnPickup } from './loot.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { addXp } from './progression.js';
import { addThreat } from './threat.js';
import { primaryLabel } from '../core/bindings.js';
import { clamp, angleDelta, dist2, makeRng } from '../core/util.js';

const rng = makeRng(0xCA125);
const scratch = [];

export const CAR = {
  // Deliberately arcade: throttle, reverse, and steering that only bites when
  // you are actually moving. Nobody wants to parallel-park during a horde.
  accel: 340,
  reverseAccel: 180,
  maxSpeed: 430,
  maxReverse: 150,
  brake: 520,
  drag: 1.1,
  steer: 2.5,               // radians/sec at speed
  steerAtSpeed: 170,        // speed at which steering is fully effective
  r: 20,

  maxHp: 420,
  fuelMax: 60,
  burnPerSec: 0.55,         // idling
  burnPerSpeed: 0.004,      // plus this per unit of speed
  trunkCap: 400,

  rammeDamage: 46,          // to an enemy you hit at speed
  ramSelfDamage: 3,
  crashSpeed: 150,          // above this, hitting terrain hurts
  noiseRadius: 640,
  threatPerSec: 0.5,

  enterRange: 74,
  pickBaseChance: 0.34,     // before Perception
  pickPerPerception: 0.07,
  hotwireTime: 3.2,
  pickTime: 1.6,
};

export const LOCK_STATE = { OPEN: 'open', LOCKED: 'locked' };

/** Turns a generated car prop into a real vehicle entity. */
export function makeVehicle(prop, seedRng) {
  const r = seedRng || rng;
  const locked = r.chance(0.62);
  return {
    id: G.vehicleSeq = (G.vehicleSeq || 0) + 1,
    x: prop.x, y: prop.y,
    angle: prop.rot || 0,
    vx: 0, vy: 0, speed: 0,
    si: prop.si,
    hp: CAR.maxHp * r.range(0.45, 1),
    maxHp: CAR.maxHp,
    // Most abandoned cars are close to empty; a full tank is a find.
    fuel: r.chance(0.25) ? r.range(18, CAR.fuelMax) : r.range(0, 9),
    locked,
    keyId: locked ? `key${r.int(1000, 9999)}` : null,
    hotwired: false,
    trunk: {},
    engineOn: false,
    destroyed: false,
    flash: 0,
    headlights: true,
  };
}

/** The car `p` is at the wheel of, if any. */
export const drivenCar = (p = G.player) => (p && p.drivingId
  ? G.vehicles.find((v) => v.id === p.drivingId && !v.destroyed)
  : null);

export const isDriving = (p = G.player) => !!drivenCar(p);

/** Whoever is at the wheel of `v`, or null if it is parked. */
export const driverOf = (v) => G.players.find((q) => q.drivingId === v.id && !q.away) || null;

export function nearestVehicle(x, y, range = CAR.enterRange) {
  let best = null, bd = range * range;
  for (const v of G.vehicles) {
    if (v.destroyed) continue;
    const d = dist2(x, y, v.x, v.y);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

// ------------------------------------------------------------------ getting in

export const hasKeyFor = (p, v) => !!(v.keyId && p.carKeys && p.carKeys.includes(v.keyId));

/** Chance to pick a lock, from Perception. Never certain, never hopeless. */
export function pickChance(p) {
  const per = (p.attrs && p.attrs.per) || 1;
  return clamp(CAR.pickBaseChance + per * CAR.pickPerPerception, 0.15, 0.92);
}

/** What the interact prompt should say for this car. */
export function vehiclePrompt(p, v) {
  if (v.destroyed) return 'Wrecked';
  if (!v.locked || v.hotwired) return v.fuel > 0.5 ? 'Drive' : 'Drive  (no fuel)';
  if (hasKeyFor(p, v)) return 'Unlock with your key';
  const bits = [];
  if (countRes(p.bag, 'lockpick') + countRes(p.hotbar, 'lockpick') > 0) {
    bits.push(`Pick lock (${Math.round(pickChance(p) * 100)}%)`);
  }
  if (p.hotwire) bits.push('Hotwire');
  return bits.length ? bits.join('  ·  ') : 'Locked — needs a key, a pick, or hotwiring';
}

/**
 * Tries to get into a locked car. Returns true if the door is now open.
 * Order of preference: your key, then a pick, then hotwiring.
 */
export function tryUnlock(p, v) {
  if (!v.locked || v.hotwired) return true;

  if (hasKeyFor(p, v)) {
    v.locked = false;
    p.carKeys = p.carKeys.filter((k) => k !== v.keyId);
    sfx('reloadDone');
    notify('The key turns. It is yours.', '#b7e08a', true);
    addXp(p, 25);
    return true;
  }

  if (countRes(p.bag, 'lockpick') + countRes(p.hotbar, 'lockpick') > 0) {
    if (!takeRes(p.bag, 'lockpick', 1)) takeRes(p.hotbar, 'lockpick', 1);
    if (Math.random() < pickChance(p)) {
      v.locked = false;
      sfx('reloadDone');
      notify('The lock gives', '#b7e08a');
      addXp(p, 30);
      return true;
    }
    // A failed pick snaps the tool and makes noise.
    sfx('dryfire');
    FX.text(v.x, v.y - 26, 'PICK SNAPPED', '#c96a5a', 12, -32, 1.0);
    notify('The pick snaps. Something heard that.', '#c96a5a');
    makeNoise(v.x, v.y, 260);
    addThreat(0.6, '', p);
    return false;
  }

  if (p.hotwire) {
    p.using = { id: 'hotwire', t: 0, dur: CAR.hotwireTime * (p.hotwireSpeedMul || 1), vehicle: v };
    notify('Hotwiring — stay still', '#d9c46a');
    return false;
  }

  sfx('deny');
  notify('Locked. Find the key, a lockpick, or learn to hotwire.', '#c96a5a');
  return false;
}

export function finishHotwire(p, v) {
  if (!v || v.destroyed) return;
  v.hotwired = true;
  v.locked = false;
  sfx('levelUp');
  FX.ring(v.x, v.y, 8, 70, 0.5, '#d0c46a', 3);
  notify('Engine catches. Loud, but it runs.', '#b7e08a', true);
  makeNoise(v.x, v.y, 420);
  addThreat(2, '', p);
  addXp(p, 45);
}

export function enterVehicle(p, v) {
  if (v.destroyed) { sfx('deny'); return false; }
  // One seat. A second "driver" would share the car's id, be treated as
  // driving by updatePlayer and be read by nobody — stranded until the first
  // driver got out.
  const other = driverOf(v);
  if (other && other !== p) {
    sfx('deny');
    if (isLocal(p)) notify(`${other.name} is driving that one`, '#c96a5a');
    return false;
  }
  if (v.locked && !v.hotwired) return tryUnlock(p, v) ? enterVehicle(p, v) : false;

  p.drivingId = v.id;
  p.searching = null;
  v.engineOn = true;
  v.vx = 0; v.vy = 0; v.speed = 0;
  releaseTiles(v);                 // it is no longer scenery in the way
  sfx('build');
  notify(v.fuel > 0.5
    ? `${primaryLabel('moveUp')}/${primaryLabel('moveDown')} to drive, ${primaryLabel('moveLeft')}/${primaryLabel('moveRight')} to steer, ${primaryLabel('interact')} to get out`
    : 'No fuel. You will need some.', '#d8e8c0');
  return true;
}

/**
 * Gets the player out. `which` lets the wrecking path pass the car explicitly —
 * `drivenCar()` filters out destroyed vehicles, so resolving through it after
 * marking one destroyed would silently fail to clear `drivingId` and strand the
 * player with neither walking nor combat.
 */
export function exitVehicle(p, which = null) {
  const v = which || drivenCar(p);
  if (!v) return false;
  p.drivingId = null;
  v.engineOn = false;
  v.vx = 0; v.vy = 0; v.speed = 0;
  occupyTiles(v);                  // parked again, so it blocks again
  // Step out beside the car, never inside a wall.
  for (let i = 0; i < 12; i++) {
    const a = v.angle + Math.PI / 2 + (i % 2 ? 1 : -1) * Math.PI * (i / 12);
    const nx = v.x + Math.cos(a) * 34;
    const ny = v.y + Math.sin(a) * 34;
    if (!terrainBlocksPx(nx, ny)) { p.x = nx; p.y = ny; break; }
  }
  p.vx = 0; p.vy = 0;
  sfx('ui');
  return true;
}

// ------------------------------------------------------------------- driving

/** Every car takes a step; the ones with a driver take theirs from the driver's intent. */
export function updateVehicles(dt) {
  for (const v of G.vehicles) {
    if (v.destroyed) continue;
    v.flash = Math.max(0, v.flash - dt);
    const driver = driverOf(v);
    if (!driver) {
      // Parked cars coast to a stop if they were shoved.
      v.vx *= Math.exp(-4 * dt);
      v.vy *= Math.exp(-4 * dt);
      v.speed *= Math.exp(-4 * dt);
      continue;
    }
    driveCar(v, dt, driver.intent.drive, driver);
    // The driver rides along with the car.
    driver.x = v.x;
    driver.y = v.y;
    driver.angle = v.angle;
  }
}

function driveCar(v, dt, input, p) {
  const local = isLocal(p);
  const dry = v.fuel <= 0;

  // ------------------------------------------------------------ throttle --
  let thrust = 0;
  if (!dry) {
    if (input.forward) thrust = CAR.accel;
    else if (input.back) thrust = -CAR.reverseAccel;
  }
  if (input.brake) {
    const s = Math.sign(v.speed);
    v.speed -= s * CAR.brake * dt;
    if (Math.sign(v.speed) !== s) v.speed = 0;
  }

  v.speed += thrust * dt;
  v.speed -= v.speed * CAR.drag * dt;
  v.speed = clamp(v.speed, -CAR.maxReverse, CAR.maxSpeed);
  if (Math.abs(v.speed) < 2) v.speed = 0;

  // ------------------------------------------------------------- steering --
  // Steering authority scales with speed, so a stationary car cannot spin.
  const grip = clamp(Math.abs(v.speed) / CAR.steerAtSpeed, 0, 1);
  const dir = v.speed < 0 ? -1 : 1;
  if (input.left) v.angle -= CAR.steer * grip * dir * dt;
  if (input.right) v.angle += CAR.steer * grip * dir * dt;

  // --------------------------------------------------------------- move --
  const step = v.speed * dt;
  const nx = v.x + Math.cos(v.angle) * step;
  const ny = v.y + Math.sin(v.angle) * step;

  // Cars collide with player-built structures too, not just terrain. The
  // terrain-only helper is for bullets; a car that drives through your own gate
  // makes the gate pointless. The driven car has released its own tiles, so it
  // cannot collide with itself.
  const hitX = solidPx(nx, v.y);
  const hitY = solidPx(v.x, ny);
  if (!hitX) v.x = nx;
  if (!hitY) v.y = ny;

  if (hitX || hitY) {
    const impact = Math.abs(v.speed);
    if (impact > CAR.crashSpeed) {
      const dmg = (impact - CAR.crashSpeed) * 0.14;
      damageVehicle(v, dmg, 'crash');
      if (local) shake(clamp(impact * 0.02, 2, 8));
      sfx('structureHit');
      FX.debris(v.x + Math.cos(v.angle) * 20, v.y + Math.sin(v.angle) * 20, 8, '#9aa2ab');
      makeNoise(v.x, v.y, 380);
    }
    v.speed *= -0.15;
  }

  const lim = G.world.w * TILE - 40;
  v.x = clamp(v.x, 40, lim);
  v.y = clamp(v.y, 40, lim);

  // -------------------------------------------------------------- roadkill --
  if (Math.abs(v.speed) > 60) {
    G.spatial.query(v.x, v.y, CAR.r + 26, scratch);
    for (const e of scratch) {
      if (e.dead) continue;
      if (dist2(v.x, v.y, e.x, e.y) > (CAR.r + e.def.r) ** 2) continue;
      const force = Math.abs(v.speed) / CAR.maxSpeed;
      // The driver made this kill — their XP, their Luck on the drop.
      damageEnemy(e, CAR.rammeDamage * force * 2, {
        fromX: v.x, fromY: v.y, knock: 340 * force, crit: true, source: p,
      });
      damageVehicle(v, CAR.ramSelfDamage * (1 + force), 'ram');
      v.speed *= 0.86;
      if (local) { shake(3); screenFlash('#5a1010', 0.16); }
      FX.blood(e.x, e.y, Math.cos(v.angle), Math.sin(v.angle), 12);
    }
  }

  // ------------------------------------------------------------ fuel, noise --
  if (!dry && (input.forward || input.back || Math.abs(v.speed) > 5)) {
    v.fuel = Math.max(0, v.fuel - (CAR.burnPerSec + Math.abs(v.speed) * CAR.burnPerSpeed) * dt);
    if (v.fuel <= 0) notify('Out of fuel', '#d98a4a', true);
  }
  if (Math.abs(v.speed) > 30) {
    addThreat(CAR.threatPerSec * dt * (Math.abs(v.speed) / CAR.maxSpeed), '', p);
    v.noiseT = (v.noiseT || 0) - dt;
    if (v.noiseT <= 0) {
      v.noiseT = 0.5;
      makeNoise(v.x, v.y, CAR.noiseRadius * (Math.abs(v.speed) / CAR.maxSpeed));
    }
    if (Math.random() < dt * 12) {
      FX.smoke(v.x - Math.cos(v.angle) * 22, v.y - Math.sin(v.angle) * 22, 1, '#6a6a62');
    }
  }
}

/** Gunfire-style alert, reused for engines, crashes and snapped picks. */
function makeNoise(x, y, radius) {
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

export function damageVehicle(v, dmg, cause = 'hit') {
  if (v.destroyed || dmg <= 0) return;
  v.hp -= dmg;
  v.flash = 0.1;
  if (v.hp <= 0) wreckVehicle(v, cause);
}

function wreckVehicle(v, cause) {
  const p = driverOf(v);
  // Get the driver out *before* the car is marked destroyed — see exitVehicle.
  if (p) {
    exitVehicle(p, v);
    // Getting out of a car as it dies costs you.
    if (cause === 'crash' && isLocal(p)) screenFlash('#8c1a1a', 0.5);
  }
  v.destroyed = true;
  v.hp = 0;
  // Anything in the boot spills onto the road rather than vanishing.
  for (const id in v.trunk) {
    if (v.trunk[id] > 0) spillTrunk(v, id, v.trunk[id]);
  }
  v.trunk = {};
  FX.debris(v.x, v.y, 24, '#7a6a55');
  FX.smoke(v.x, v.y, 8, '#4a453e');
  FX.decal(v.x, v.y, 24, '#2a251c');
  sfx('structureBreak');
  shake(8);
  notify('The car is finished', '#c96a5a', true);
}

function spillTrunk(v, id, n) {
  spawnPickup(v.x + (Math.random() - 0.5) * 40, v.y + (Math.random() - 0.5) * 40, 'res', id, n);
}

// ---------------------------------------------------------------- the boot

export const trunkLoad = (v) => Object.values(v.trunk).reduce((a, b) => a + b, 0);

/** Moves the player's carried resources into the boot. */
export function stowInTrunk(v, p = G.player) {
  let moved = 0;
  // Raw materials only — the boot is for the haul, not for your rifle or the
  // bandages you are about to need.
  const carried = slotsEntries(p.bag);
  for (const id of Object.keys(carried)) {
    const it = ITEMS[id];
    if (!it || it.kind !== 'res') continue;
    const room = CAR.trunkCap - trunkLoad(v);
    if (room <= 0) break;
    const give = Math.min(carried[id], room);
    if (give <= 0) continue;
    const took = takeRes(p.bag, id, give);
    v.trunk[id] = (v.trunk[id] || 0) + took;
    moved += took;
  }
  if (moved > 0) { sfx('loot'); notify(`Stowed ${moved} in the boot`, '#b7e08a'); }
  else { sfx('ui'); notify(trunkLoad(v) >= CAR.trunkCap ? 'The boot is full' : 'Nothing to stow', '#8a8f84'); }
  return moved;
}

export function takeFromTrunk(v, p = G.player) {
  let moved = 0;
  for (const id in v.trunk) {
    const got = addResCapped(p.bag, id, v.trunk[id], packAllowance(p));
    v.trunk[id] -= got;
    if (v.trunk[id] <= 0) delete v.trunk[id];
    moved += got;
  }
  if (moved > 0) { sfx('loot'); notify(`Took ${moved} from the boot`, '#b7e08a'); }
  else { sfx('ui'); notify('Nothing you can carry', '#8a8f84'); }
  return moved;
}

export function refuelVehicle(v, p = G.player) {
  const need = Math.ceil(CAR.fuelMax - v.fuel);
  if (need <= 0) { notify('Tank is full', '#8a8f84'); return false; }
  let take = takeRes(p.bag, 'fuel', need);
  if (take < need) take += takeRes(G.stash, 'fuel', need - take);
  if (take <= 0) { sfx('deny'); notify('No fuel to put in it', '#c96a5a'); return false; }
  v.fuel = Math.min(CAR.fuelMax, v.fuel + take);
  sfx('build');
  FX.text(v.x, v.y - 24, `+${take} FUEL`, '#d2762c', 12, -32, 1.0);
  return true;
}

/** Stripping a wreck for parts, so a dead car is still worth something. */
export function salvageVehicle(v, p = G.player) {
  if (!v.destroyed) return false;
  const scrap = 14 + Math.floor(Math.random() * 14 * p.lootMul);
  const parts = Math.random() < 0.45 ? 1 : 0;
  addRes(G.stash, 'scrap', scrap);
  if (parts) addRes(G.stash, 'parts', parts);
  releaseTiles(v);
  const i = G.vehicles.indexOf(v);
  if (i >= 0) G.vehicles.splice(i, 1);
  sfx('build');
  FX.debris(v.x, v.y, 16, '#8a8f84');
  notify(`Stripped the wreck — ${scrap} scrap${parts ? ' and a part' : ''} to your stash`, '#b7e08a');
  addXp(p, 12);
  return true;
}

/**
 * Hides the key for every locked car in the nearest container, so "whose car is
 * this?" always has a findable answer.
 *
 * Called both when a world is generated and when one is loaded — the markers
 * live on freshly generated container objects, so a load without this leaves
 * every locked car keyless.
 */
export function plantVehicleKeys() {
  const used = new Set();
  for (const c of G.world.containers) c.extra = null;

  for (const v of G.vehicles) {
    if (v.destroyed || !v.locked || !v.keyId) continue;
    let best = null, bd = 520 * 520;
    for (const c of G.world.containers) {
      if (c.hidden || used.has(c.id)) continue;
      const d = dist2(c.x, c.y, v.x, v.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) {
      used.add(best.id);
      best.extra = [{ id: `key:${v.keyId}`, n: 1 }];
      v.keyHint = best.label;
    } else {
      // Nowhere close to hide one: this car needs a pick or a wire instead.
      v.keyId = null;
    }
  }
}

// ------------------------------------------------------------ parked tiles --
// A parked car blocks the tiles it sits on, exactly like the scenery it used to
// be. Driving releases them, and parking claims new ones — tracking precisely
// which tiles this car claimed, so releasing never clears a tree that was
// already there.

export function releaseTiles(v) {
  const w = G.world;
  for (const [tx, ty] of v.tiles || []) {
    if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
    w.blocked[ty * w.w + tx] = 0;
  }
  v.tiles = [];
}

export function occupyTiles(v) {
  const w = G.world;
  const claimed = [];
  const cx = Math.floor(v.x / TILE), cy = Math.floor(v.y / TILE);
  // Two tiles along the car's long axis, rounded to the nearest cardinal.
  const along = Math.abs(Math.cos(v.angle)) > 0.5 ? [1, 0] : [0, 1];
  for (const [dx, dy] of [[0, 0], along]) {
    const tx = cx + dx, ty = cy + dy;
    if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
    if (w.blocked[ty * w.w + tx]) continue;      // something else is there
    w.blocked[ty * w.w + tx] = 1;
    claimed.push([tx, ty]);
  }
  v.tiles = claimed;
}

export const RES_ = RES;
