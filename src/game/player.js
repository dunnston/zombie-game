// The player: stats, movement, aiming, attacking, healing, death and respawn.

import { PLAYER, WEAPONS, CONSUMABLES, xpForLevel, bagWeight } from './config.js';
import {
  makeSlots, makeEquip, slotsAdd, slotsTake, slotsWeight, slotsCount, ITEMS,
  packAllowance,
} from './items.js';

export { packAllowance };
import { startingAttrs, recomputeStats } from './perks.js';
import { G, moveCircle, notify, unstick, isLocal } from './state.js';
import { makeIntent } from './intent.js';
import { meleeAttack, fireGun, startReload, updateReload } from './combat.js';
import { healPlayer, killPlayer } from './damage.js';
import { finishHotwire } from './vehicles.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { clamp, smooth, makeRng } from '../core/util.js';

const rng = makeRng(0x51EE99);

/**
 * @param x, y   where they stand
 * @param opts   { id, name, seat } — identity for a save file, a display name,
 *               and which of the colour/name seats to draw from
 */
export function createPlayer(x, y, opts = {}) {
  const seat = opts.seat ?? 0;
  const p = {
    // Identity. `id` outlives the session (it is what a save remembers a guest
    // by); `netId` is handed out by addPlayer() and is only good for one game.
    id: opts.id || null,
    netId: 0,
    name: opts.name || PLAYER.names[Math.min(seat, PLAYER.names.length - 1)],
    color: PLAYER.colors[seat % PLAYER.colors.length],
    // What this player is trying to do this step. Filled by gatherLocalIntent
    // for the person at this keyboard, or from the wire for anyone else.
    intent: makeIntent(),
    // Disconnected: not drawn, not simulated, not a target — but kept, with
    // everything they carry, so they can pick up where they left off.
    away: false,

    x, y, vx: 0, vy: 0, angle: 0, r: PLAYER.r,
    hp: PLAYER.maxHp,
    stam: PLAYER.maxStam,
    stamLock: 0,
    dead: false, respawnT: 0, invuln: 0, hurtFlash: 0, lastHurt: 99,
    // Down but not out: a teammate can still bring you back.
    downed: false, downT: 0, reviving: null,

    // One addressable list for everything carried. Capacity is by weight, not
    // slot count — a pack of ammunition is not a pack of scrap — but the grid
    // is finite too, so hoarding thirty kinds of thing still costs you.
    bag: makeSlots(PLAYER.invSlots),
    // Kept so a death drop always leaves you something to swing.
    startWeapon: 'pipe',
    // Six slots along the bottom of the screen. Holds weapons and consumables;
    // keys 1-6 select, and the selected one is what you are holding.
    hotbar: makeSlots(PLAYER.hotbarSlots),
    slot: 0,
    equip: makeEquip(),
    mag: {},

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
    drivingId: null,
    carKeys: [],
    godMode: false,
  };
  recomputeStats(p);
  p.hp = p.maxHp;
  p.stam = p.maxStam;
  // You start holding a pipe and carrying a couple of bandages.
  slotsAdd(p.hotbar, 'pipe', 1);
  slotsAdd(p.hotbar, 'bandage', 2);
  p.mag.pipe = undefined;
  for (const id in WEAPONS) if (WEAPONS[id].mag) p.mag[id] = p.mag[id] || 0;
  p.mag.pipe = 0;
  return p;
}

// --------------------------------------------------------------- hotbar ---

/** The item id in the selected hotbar slot, or null for empty hands. */
export function heldId(p) {
  const s = p.hotbar.slots[p.slot];
  return s ? s.id : null;
}

/**
 * What the player is swinging or firing. An empty hotbar slot, or one holding
 * something that is not a weapon, means fists — you can still punch.
 */
export function currentWeapon(p) {
  const id = heldId(p);
  const w = id ? WEAPONS[id] : null;
  return w || WEAPONS.fists;
}

/** Every weapon the player is carrying anywhere, for reload and ammo checks. */
export function carriedWeapons(p) {
  const out = [];
  for (const s of p.hotbar.slots) if (s && WEAPONS[s.id]) out.push(s.id);
  for (const s of p.bag.slots) if (s && WEAPONS[s.id]) out.push(s.id);
  return out;
}

export const hasItem = (p, id) =>
  slotsCount(p.bag, id) + slotsCount(p.hotbar, id) > 0;

export function selectSlot(p, i) {
  if (i < 0 || i >= p.hotbar.slots.length || i === p.slot) return;
  p.slot = i;
  p.reloading = null;
  p.attackCd = Math.max(p.attackCd, 0.14);
  sfx('ui');
}

export function cycleSlot(p, dir) {
  const n = p.hotbar.slots.length;
  selectSlot(p, ((p.slot + dir) % n + n) % n);
}

/**
 * Uses whatever is in the selected hotbar slot, if it is usable. Lets the
 * hotbar hold bandages and have them mean something, rather than being a
 * weapon rack with a separate heal key.
 */
export function useHeld(p) {
  const id = heldId(p);
  if (!id || !CONSUMABLES[id] || CONSUMABLES[id].tool) return false;
  return useConsumable(p, id);
}

/** Starts the use channel for a specific consumable the player is carrying. */
export function useConsumable(p, id) {
  if (p.using || p.dead) return false;
  const c = CONSUMABLES[id];
  if (!c || c.tool) return false;
  if (!hasItem(p, id)) { sfx('deny'); return false; }
  if (c.heal > 0 && p.hp >= p.maxHp) {
    notify('Already at full health', '#8a8f84');
    return false;
  }
  p.using = { id, t: 0, dur: c.time * p.healSpeedMul };
  return true;
}

export function useHealing(p) {
  if (p.using || p.dead) return false;
  if (p.hp >= p.maxHp) { notify('Already at full health', '#8a8f84'); return false; }
  const missing = p.maxHp - p.hp;
  // Spend the smaller item unless the wound is big enough to justify a medkit.
  const bandages = slotsCount(p.bag, 'bandage') + slotsCount(p.hotbar, 'bandage');
  const kits = slotsCount(p.bag, 'medkit') + slotsCount(p.hotbar, 'medkit');
  let pick = null;
  if (missing > 45 && kits > 0) pick = 'medkit';
  else if (bandages > 0) pick = 'bandage';
  else if (kits > 0) pick = 'medkit';
  if (!pick) { sfx('deny'); notify('No medical supplies', '#c96a5a'); return false; }
  return useConsumable(p, pick);
}

function finishUse(p) {
  // Hotwiring borrows the same channel as healing — it is the only other thing
  // that roots you in place for a couple of seconds.
  if (p.using.id === 'hotwire') {
    finishHotwire(p, p.using.vehicle);
    p.using = null;
    return;
  }
  const c = CONSUMABLES[p.using.id];
  // Spend it from the hotbar first, so the stack you can see going down is the
  // one you were watching.
  if (!slotsTake(p.hotbar, p.using.id, 1)) slotsTake(p.bag, p.using.id, 1);
  healPlayer(p, c.heal);
  p.using = null;
}

/**
 * One simulation step for one player, driven entirely by `p.intent`. Nothing
 * in here knows whether the intent came from this keyboard or from a wire.
 */
export function updatePlayer(p, dt) {
  const it = p.intent;
  p.lastHurt += dt;

  if (p.dead) {
    p.respawnT -= dt;
    if (p.respawnT <= 0) respawnPlayer(p);
    return;
  }

  // Down: the clock runs, and nothing else does. A teammate can still reach
  // you; if nobody does, this becomes an ordinary death.
  if (p.downed) {
    p.downT -= dt;
    p.vx *= Math.exp(-11 * dt); p.vy *= Math.exp(-11 * dt);
    if (p.downT <= 0) killPlayer(p, true);
    return;
  }

  // While driving, the car owns your position — skip the on-foot movement and
  // collision entirely rather than fighting it for control.
  const driving = !!p.drivingId;
  if (!driving) unstick(p, p.r);

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
  const aimTarget = Math.atan2(it.aimY - p.y, it.aimX - p.x);
  p.angle = aimTarget + p.recoil * (p.recoilDir || 1);
  if (p.recoil < 0.001) p.recoilDir = rng.chance(0.5) ? 1 : -1;

  // ------------------------------------------------------------- movement --
  // Actions that root you in place.
  const rooted = !!(p.searching || p.using || p.reviving);
  movePlayer(p, dt, rooted);

  // ---------------------------------------------------------- channelling --
  if (p.using) {
    p.using.t += dt;
    if (p.using.t >= p.using.dur) finishUse(p);
  }

  // --------------------------------------------------------------- combat --
  updateReload(p, dt);
  // Two hands on the wheel: no shooting while driving. The intent has already
  // been blanked by the UI layer if a panel or build mode owns the input.
  if (!driving && !rooted) {
    const w = currentWeapon(p);
    if (it.reload) startReload(p, w);

    if (it.fire && p.attackCd <= 0) {
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
          } else if (it.firePressed) {
            startReload(p, w);
          }
        }
      }
    }

    if (it.slot >= 0) selectSlot(p, it.slot);
    if (it.wheel !== 0) cycleSlot(p, it.wheel);
    if (it.use) useHealing(p);
  }
}

/**
 * Stamina, speed and the actual step, from the movement half of the intent.
 * Separate from updatePlayer so a client can run exactly this for its own
 * player between snapshots and land where the host will say it landed.
 */
export function movePlayer(p, dt, rooted = false) {
  const it = p.intent;
  const driving = !!p.drivingId;
  const moving = it.mx !== 0 || it.my !== 0;

  p.sneaking = !driving && it.sneak;
  p.sprinting = !driving && !p.sneaking && it.sprint && moving && p.stam > 1;

  if (p.sprinting) {
    p.stam = Math.max(0, p.stam - PLAYER.stamDrain * dt);
    p.stamLock = PLAYER.stamRegenDelay;
    if (p.stam <= 0) p.sprinting = false;
  } else {
    p.stamLock = Math.max(0, p.stamLock - dt);
    if (p.stamLock <= 0) p.stam = Math.min(p.maxStam, p.stam + p.stamRegen * dt);
  }

  let speed = PLAYER.speed * p.speedMul * (p.adrenalineActive ? 1.15 : 1);
  if (p.sprinting) speed *= PLAYER.sprintMul;
  if (p.sneaking) speed *= 0.5;
  if (rooted) speed = 0;
  // Overloaded packs slow you down — a soft cap rather than a hard block.
  const load = bagLoad(p);
  if (load > 1) speed *= clamp(1.25 - load * 0.25, 0.55, 1);

  if (!driving) {
    p.vx += (it.mx * speed - p.vx) * smooth(18, dt);
    p.vy += (it.my * speed - p.vy) * smooth(18, dt);
    if (!moving) { p.vx *= Math.exp(-11 * dt); p.vy *= Math.exp(-11 * dt); }
    moveCircle(p, p.vx * dt, p.vy * dt, p.r);
  }
}

/** Fraction of carry capacity used, by weight — matches what addResCapped enforces. */
/**
 * Carried weight as a fraction of capacity. The hotbar counts: a shotgun on
 * the bar is still a shotgun on your back.
 */
export function carriedWeight(p) {
  return slotsWeight(p.bag) + slotsWeight(p.hotbar);
}

export function bagLoad(p) {
  return carriedWeight(p) / p.carryCap;
}



// ------------------------------------------------------------------ respawn --

/**
 * A random open tile in tier-1 land. Rejects spots with enemies nearby so a
 * respawn is never an instant second death. With `near`, only tiles within
 * that many pixels of a point are considered — the first morning starts by
 * the Roadside Camp, not in a field on the far side of the river.
 */
export function pickRandomSpawn(minEnemyDist = 520, near = null) {
  let tiles = G.world.spawnTiles;
  if (near) {
    const r2 = near.r * near.r;
    const close = tiles.filter(([tx, ty]) => {
      const dx = tx * 32 + 16 - near.x, dy = ty * 32 + 16 - near.y;
      return dx * dx + dy * dy <= r2;
    });
    if (close.length) tiles = close;
  }
  if (!tiles.length) return { x: 160 * 32, y: 160 * 32 };
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

export function respawnPlayer(p) {
  const spot = p.spawnPoint && p.spawnStructure && !p.spawnStructure.destroyed
    ? p.spawnPoint
    : pickRandomSpawn();

  p.x = spot.x; p.y = spot.y;
  p.vx = 0; p.vy = 0;
  p.hp = p.maxHp;
  p.stam = p.maxStam;
  p.dead = false;
  p.downed = false;
  p.invuln = 2.2;
  p.reloading = null;
  p.searching = null;
  p.using = null;
  p.reviving = null;
  p.slot = clamp(p.slot, 0, p.hotbar.slots.length - 1);
  for (const w of carriedWeapons(p)) {
    const def = WEAPONS[w];
    if (def && def.mag) p.mag[w] = Math.max(p.mag[w] || 0, 0);
  }

  if (isLocal(p)) { G.camera.x = p.x; G.camera.y = p.y; }
  FX.ring(p.x, p.y, 6, 90, 0.6, '#9fd0ff', 3);
  if (isLocal(p)) {
    notify(
      p.spawnStructure ? 'Respawned at your bedroll' : 'Respawned somewhere in the wild',
      '#9fd0ff', true,
    );
  } else {
    notify(`${p.name} is back`, '#9fd0ff');
  }
}

/**
 * Brings a downed teammate back up. The reviver has held E beside them for
 * PLAYER.reviveTime — that channel is run from game.js, like searching.
 */
export function revivePlayer(reviver, p) {
  if (!p.downed || p.dead) return false;
  p.downed = false;
  p.downT = 0;
  p.hp = Math.max(1, Math.round(p.maxHp * PLAYER.reviveHpFrac));
  p.invuln = 1.5;
  p.lastHurt = 0;
  FX.ring(p.x, p.y, 6, 60, 0.5, '#7ce08a', 2);
  FX.text(p.x, p.y - 24, `${p.name.toUpperCase()} IS UP`, '#7ce08a', 12, -34, 1.0);
  sfx('heal');
  if (isLocal(p)) notify(`${reviver.name} got you back on your feet`, '#b7e08a', true);
  else notify(`${p.name} is back on their feet`, '#b7e08a');
  return true;
}
