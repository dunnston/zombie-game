// The player: stats, movement, aiming, attacking, healing, death and respawn.

import { PLAYER, WEAPONS, CONSUMABLES, xpForLevel, bagWeight } from './config.js';
import { startingAttrs, recomputeStats } from './perks.js';
import { G, moveCircle, notify, unstick } from './state.js';
import { Input, key, keyTap } from '../core/input.js';
import { meleeAttack, fireGun, startReload, updateReload } from './combat.js';
import { healPlayer } from './damage.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { clamp, smooth, makeRng } from '../core/util.js';

const rng = makeRng(0x51EE99);

export function createPlayer(x, y) {
  const p = {
    x, y, vx: 0, vy: 0, angle: 0, r: PLAYER.r,
    hp: PLAYER.maxHp,
    stam: PLAYER.maxStam,
    stamLock: 0,
    dead: false, respawnT: 0, invuln: 0, hurtFlash: 0, lastHurt: 99,

    weapons: ['fists', 'pipe'],
    startWeapon: 'pipe',
    slot: 1,
    mag: {},
    bag: {},
    items: { bandage: 2 },
    armors: [],
    armor: null,

    attackCd: 0,
    reloading: null,
    searching: null,
    using: null,
    swing: null,
    recoil: 0,
    sneaking: false,
    sprinting: false,

    // Progression: levels pay out skill points, spent on attribute ranks or
    // perks. Every derived stat below is produced by recomputeStats().
    level: 1, xp: 0, xpNext: xpForLevel(1), skillPoints: 0,
    attrs: startingAttrs(),
    perks: {},
    secondWindCd: 0,

    spawnPoint: null, spawnStructure: null,
    godMode: false,
  };
  recomputeStats(p);
  p.hp = p.maxHp;
  p.stam = p.maxStam;
  for (const w of p.weapons) if (WEAPONS[w].mag) p.mag[w] = WEAPONS[w].mag;
  return p;
}

export const currentWeapon = (p) => WEAPONS[p.weapons[p.slot]] || WEAPONS.fists;

export function selectSlot(p, i) {
  if (i < 0 || i >= p.weapons.length || i === p.slot) return;
  p.slot = i;
  p.reloading = null;
  p.attackCd = Math.max(p.attackCd, 0.14);
  sfx('ui');
}

export function cycleSlot(p, dir) {
  const n = p.weapons.length;
  selectSlot(p, ((p.slot + dir) % n + n) % n);
}

export function useHealing(p) {
  if (p.using || p.dead) return false;
  if (p.hp >= p.maxHp) { notify('Already at full health', '#8a8f84'); return false; }
  const missing = p.maxHp - p.hp;
  // Spend the smaller item unless the wound is big enough to justify a medkit.
  let pick = null;
  if (missing > 45 && (p.items.medkit || 0) > 0) pick = 'medkit';
  else if ((p.items.bandage || 0) > 0) pick = 'bandage';
  else if ((p.items.medkit || 0) > 0) pick = 'medkit';
  if (!pick) { sfx('deny'); notify('No medical supplies', '#c96a5a'); return false; }

  const c = CONSUMABLES[pick];
  p.using = { id: pick, t: 0, dur: c.time * p.healSpeedMul };
  return true;
}

function finishUse(p) {
  const c = CONSUMABLES[p.using.id];
  p.items[p.using.id]--;
  if (p.items[p.using.id] <= 0) delete p.items[p.using.id];
  healPlayer(c.heal);
  p.using = null;
}

export function updatePlayer(dt) {
  const p = G.player;
  p.lastHurt += dt;

  if (p.dead) {
    p.respawnT -= dt;
    if (p.respawnT <= 0) respawnPlayer();
    return;
  }

  // Never let the player end up sealed inside geometry.
  unstick(p, p.r);

  p.invuln = Math.max(0, p.invuln - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  p.attackCd = Math.max(0, p.attackCd - dt);
  p.recoil *= Math.exp(-9 * dt);
  p.secondWindCd = Math.max(0, p.secondWindCd - dt);

  // Adrenaline (Strength perk) is a live state, not a stat, so it can flicker
  // on and off with your health bar.
  p.adrenalineActive = !!p.adrenaline && p.hp / p.maxHp < 0.34;

  if (p.swing) {
    p.swing.t += dt;
    if (p.swing.t >= p.swing.dur) p.swing = null;
  }

  // --------------------------------------------------------------- aiming --
  const cam = G.camera;
  const mx = (Input.mouse.x - G.canvasW / 2) / cam.zoom + cam.x;
  const my = (Input.mouse.y - G.canvasH / 2) / cam.zoom + cam.y;
  Input.mouse.wx = mx; Input.mouse.wy = my;
  const aimTarget = Math.atan2(my - p.y, mx - p.x);
  p.angle = aimTarget + p.recoil * (p.recoilDir || 1);
  if (p.recoil < 0.001) p.recoilDir = rng.chance(0.5) ? 1 : -1;

  const uiBlocked = !!G.ui.panel;

  // ------------------------------------------------------------- movement --
  let ix = 0, iy = 0;
  if (!uiBlocked) {
    if (key('KeyW') || key('ArrowUp')) iy -= 1;
    if (key('KeyS') || key('ArrowDown')) iy += 1;
    if (key('KeyA') || key('ArrowLeft')) ix -= 1;
    if (key('KeyD') || key('ArrowRight')) ix += 1;
  }
  const moving = ix !== 0 || iy !== 0;
  if (moving) {
    const len = Math.hypot(ix, iy);
    ix /= len; iy /= len;
  }

  p.sneaking = !uiBlocked && (key('ControlLeft') || key('ControlRight'));
  const wantSprint = !uiBlocked && !p.sneaking && (key('ShiftLeft') || key('ShiftRight')) && moving && p.stam > 1;
  p.sprinting = wantSprint;

  if (p.sprinting) {
    p.stam = Math.max(0, p.stam - PLAYER.stamDrain * dt);
    p.stamLock = PLAYER.stamRegenDelay;
    if (p.stam <= 0) p.sprinting = false;
  } else {
    p.stamLock = Math.max(0, p.stamLock - dt);
    if (p.stamLock <= 0) p.stam = Math.min(p.maxStam, p.stam + p.stamRegen * dt);
  }

  // Actions that root you in place.
  const rooted = !!(p.searching || p.using);
  let speed = PLAYER.speed * p.speedMul * (p.adrenalineActive ? 1.15 : 1);
  if (p.sprinting) speed *= PLAYER.sprintMul;
  if (p.sneaking) speed *= 0.5;
  if (rooted) speed = 0;
  // Overloaded packs slow you down — a soft cap rather than a hard block.
  const load = bagLoad(p);
  if (load > 1) speed *= clamp(1.25 - load * 0.25, 0.55, 1);

  p.vx += (ix * speed - p.vx) * smooth(18, dt);
  p.vy += (iy * speed - p.vy) * smooth(18, dt);
  if (!moving) { p.vx *= Math.exp(-11 * dt); p.vy *= Math.exp(-11 * dt); }
  moveCircle(p, p.vx * dt, p.vy * dt, p.r);

  // ---------------------------------------------------------- channelling --
  if (p.using) {
    p.using.t += dt;
    if (p.using.t >= p.using.dur) finishUse(p);
  }

  // --------------------------------------------------------------- combat --
  updateReload(p, dt);
  if (!uiBlocked && !G.ui.buildMode && !rooted) {
    const w = currentWeapon(p);
    if (keyTap('KeyR')) startReload(p, w);

    if (Input.mouseDown && p.attackCd <= 0) {
      if (w.kind === 'melee') {
        p.attackCd = w.cd;
        p.stam = Math.max(0, p.stam - 4);
        meleeAttack(p, w);
      } else {
        if (p.reloading && !p.reloading.shell) {
          // hold fire while a magazine swap finishes
        } else {
          if (p.reloading && p.reloading.shell) p.reloading = null;   // pump-action interrupt
          if ((p.mag[w.id] || 0) > 0) {
            p.attackCd = w.cd * p.fireRateMul;
            fireGun(p, w);
          } else if (Input.mousePressed) {
            startReload(p, w);
          }
        }
      }
    }

    for (let i = 0; i < 6; i++) {
      if (keyTap(`Digit${i + 1}`)) selectSlot(p, i);
    }
    if (Input.wheel !== 0) cycleSlot(p, Input.wheel > 0 ? 1 : -1);
    if (keyTap('KeyQ')) useHealing(p);
  }
}

/** Fraction of carry capacity used, by weight — matches what addResCapped enforces. */
export function bagLoad(p) {
  return bagWeight(p.bag) / p.carryCap;
}

// ------------------------------------------------------------------ respawn --

/**
 * A random open tile in tier-1 land. Rejects spots with enemies nearby so a
 * respawn is never an instant second death.
 */
export function pickRandomSpawn(minEnemyDist = 520) {
  const tiles = G.world.spawnTiles;
  if (!tiles.length) return { x: 78 * 32, y: 78 * 32 };
  const d2 = minEnemyDist * minEnemyDist;
  let fallback = null;
  for (let i = 0; i < 40; i++) {
    const [tx, ty] = tiles[Math.floor(rng() * tiles.length)];
    const spot = { x: tx * 32 + 16, y: ty * 32 + 16 };
    if (!fallback) fallback = spot;
    let clear = true;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = e.x - spot.x, dy = e.y - spot.y;
      if (dx * dx + dy * dy < d2) { clear = false; break; }
    }
    if (clear) return spot;
  }
  return fallback;
}

export function respawnPlayer() {
  const p = G.player;
  const spot = p.spawnPoint && p.spawnStructure && !p.spawnStructure.destroyed
    ? p.spawnPoint
    : pickRandomSpawn();

  p.x = spot.x; p.y = spot.y;
  p.vx = 0; p.vy = 0;
  p.hp = p.maxHp;
  p.stam = p.maxStam;
  p.dead = false;
  p.invuln = 2.2;
  p.reloading = null;
  p.searching = null;
  p.using = null;
  p.slot = clamp(p.slot, 0, p.weapons.length - 1);
  for (const w of p.weapons) {
    const def = WEAPONS[w];
    if (def && def.mag) p.mag[w] = Math.max(p.mag[w] || 0, 0);
  }

  G.camera.x = p.x; G.camera.y = p.y;
  FX.ring(p.x, p.y, 6, 90, 0.6, '#9fd0ff', 3);
  notify(
    p.spawnStructure ? 'Respawned at your bedroll' : 'Respawned somewhere in the wild',
    '#9fd0ff', true,
  );
}
