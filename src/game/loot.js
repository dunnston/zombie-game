// Loot rolls, world pickups and the death backpack.

import { LOOT, RES, WEAPONS, GEAR, CONSUMABLES, TILE, bagWeight } from './config.js';
import {
  ITEMS, slotsAdd, slotsCount, slotsEntries, slotsWeight, slotsClear,
  firstEmpty, makeSlots, packAllowance,
} from './items.js';
import { recomputeStats } from './perks.js';
import { G, addResCapped, notify, solidPx, nearestPlayer, baseOwner } from './state.js';
import { makeRng, weightedPick, dist2, clamp, TAU } from '../core/util.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';

let lootRng = makeRng(0xC0FFEE);

export function seedLoot(seed) { lootRng = makeRng(seed >>> 0); }

/** Rolls a container's table. Returns [{ id, n }] where id may be 'weapon:x' etc. */
export function rollContainer(container, lootMul = 1, opts = {}) {
  const table = LOOT[container.table];
  if (!table) return [];
  const { rareMul = 1, doubleChance = 0 } = opts;

  // Luck re-weights the table toward its scarcer entries rather than simply
  // handing out more of everything — that is Scrounger's job.
  const weighted = rareMul === 1 ? table : table.map((e) => {
    const rare = !RES[e.id] || e.id === 'mil' || e.id === 'parts';
    return rare ? { ...e, w: e.w * rareMul } : e;
  });

  const [lo, hi] = container.rolls;
  let rolls = lootRng.int(lo, hi);
  if (doubleChance > 0 && lootRng() < doubleChance) rolls *= 2;

  const out = new Map();
  for (let i = 0; i < rolls; i++) {
    const e = weightedPick(weighted, lootRng);
    if (!e) continue;
    let n = lootRng.int(e.min, e.max);
    // Scrounger multiplies bulk resources, not unique equipment.
    if (RES[e.id]) n = Math.max(1, Math.round(n * lootMul));
    out.set(e.id, (out.get(e.id) || 0) + n);
  }
  // Guaranteed contents — car keys are planted in a specific container so the
  // car they open is always findable, rather than left to a weighted roll.
  for (const e of container.extra || []) {
    out.set(e.id, (out.get(e.id) || 0) + e.n);
  }
  return [...out.entries()].map(([id, n]) => ({ id, n }));
}

/** True if the player already owns this weapon. */
const hasWeapon = (p, id) =>
  slotsCount(p.bag, id) + slotsCount(p.hotbar, id) > 0;

/**
 * Puts one non-stacking item (a weapon or a piece of gear) into the first free
 * slot, preferring the hotbar for weapons so a gun you pick up is immediately
 * to hand. Returns false when there is nowhere to put it.
 */
function giveItem(p, id, preferHotbar = false) {
  if (preferHotbar && firstEmpty(p.hotbar) >= 0) return slotsAdd(p.hotbar, id, 1) > 0;
  if (firstEmpty(p.bag) >= 0) return slotsAdd(p.bag, id, 1) > 0;
  if (firstEmpty(p.hotbar) >= 0) return slotsAdd(p.hotbar, id, 1) > 0;
  return false;
}

/**
 * Gives one loot entry to the player. Resources respect carry weight; anything
 * that does not fit comes back as `overflow` so the caller can leave it on the
 * ground.
 *
 * `overflow.entry` is a full **prefixed** entry id (`item:bandage`,
 * `weapon:rifle`, `gear:milVest`, or a bare resource id). It has to be, because
 * the pickup it becomes is decoded by the same grammar: an earlier version
 * returned the bare id and hard-coded the pickup kind to 'res', so overflowing
 * bandages became a pickup nothing could decode, which was then deleted on
 * contact.
 *
 * Returns { text, color, overflow: {entry,n}|null }.
 */
export function giveEntry(p, entry) {
  const { id, n } = entry;

  if (id.startsWith('weapon:')) {
    const wid = id.slice(7);
    const w = WEAPONS[wid];
    if (!w) return null;
    if (hasWeapon(p, wid)) {
      // Duplicate guns convert to a useful magazine of their ammo instead.
      if (w.ammo) {
        const give = w.mag * 2;
        const got = addResCapped(p.bag, w.ammo, give, packAllowance(p));
        return { text: `${w.name} (spare ammo +${got})`, color: '#d8c98a' };
      }
      return { text: `${w.name} (already carried)`, color: '#8a8f84' };
    }
    if (!giveItem(p, wid, true)) {
      // Never destroy it: hand it back so it stays on the ground and the player
      // can make room and come back for it.
      return {
        text: `${w.name} — NO ROOM`, color: '#c96a5a',
        overflow: { entry: id, n: 1 },
      };
    }
    p.mag[wid] = w.mag || 0;
    return { text: `${w.name} acquired`, color: '#ffe08a', major: true };
  }

  if (id.startsWith('armor:') || id.startsWith('gear:')) {
    const aid = id.slice(id.indexOf(':') + 1);
    const a = GEAR[aid];
    if (!a) return null;
    // Gear goes into the pack. Choosing what to wear is the player's job now —
    // silently equipping the highest-armour piece is exactly what made the old
    // system impossible to reason about.
    if (!giveItem(p, aid)) {
      return {
        text: `${a.name} — NO ROOM`, color: '#c96a5a',
        overflow: { entry: `gear:${aid}`, n: 1 },
      };
    }
    const worn = p.equip[a.slot];
    const better = !worn || a.dr > GEAR[worn].dr;
    return {
      text: better ? `${a.name} — better than what you are wearing` : `${a.name} stowed`,
      color: better ? '#ffe08a' : '#a8b09a',
      major: better,
    };
  }

  if (id.startsWith('key:')) {
    const keyId = id.slice(4);
    if (!p.carKeys) p.carKeys = [];
    if (!p.carKeys.includes(keyId)) p.carKeys.push(keyId);
    return { text: 'Car keys', color: '#e8c86a', major: true };
  }

  if (id.startsWith('item:')) {
    const iid = id.slice(5);
    const c = CONSUMABLES[iid];
    if (!c) return null;
    const got = addResCapped(p.bag, iid, n, packAllowance(p));
    return {
      text: got > 0 ? `${c.name} x${got}` : `${c.name} — PACK FULL`,
      color: got > 0 ? c.color : '#c96a5a',
      overflow: n - got > 0 ? { entry: `item:${iid}`, n: n - got } : null,
    };
  }

  const def = RES[id];
  if (!def) return null;
  const got = addResCapped(p.bag, id, n, packAllowance(p));
  const over = n - got;
  return {
    text: got > 0 ? `${def.name} +${got}` : `${def.name} — PACK FULL`,
    color: got > 0 ? def.color : '#c96a5a',
    overflow: over > 0 ? { entry: id, n: over } : null,
  };
}

/**
 * The best piece carried for each slot. Used only by the inventory screen's
 * quick-equip button now — nothing equips itself behind the player's back.
 */
export function bestGearFor(p, slot) {
  let best = null, dr = -1;
  for (const s of p.bag.slots) {
    if (!s) continue;
    const g = GEAR[s.id];
    if (g && g.slot === slot && g.dr > dr) { dr = g.dr; best = s.id; }
  }
  return best;
}

/** Applies a whole roll, drops overflow, and returns lines for the loot popup. */
export function grantLoot(p, entries, x, y) {
  const lines = [];
  let anyMajor = false;
  for (const e of entries) {
    const r = giveEntry(p, e);
    if (!r) continue;
    lines.push(r);
    if (r.major) anyMajor = true;
    // The overflow carries its own prefixed entry id, so a bandage that did not
    // fit becomes a bandage on the floor rather than an undecodable pickup.
    if (r.overflow) spawnEntryPickup(x, y, r.overflow.entry, r.overflow.n);
  }
  return { lines, anyMajor };
}

// ------------------------------------------------------------------ pickups --

export function spawnPickup(x, y, kind, id, n = 1) {
  // Nudge out of walls so a drop is never unreachable.
  let px = x, py = y, guard = 0;
  while (solidPx(px, py) && guard++ < 24) {
    const a = lootRng.range(0, TAU);
    px = x + Math.cos(a) * (8 + guard * 3);
    py = y + Math.sin(a) * (8 + guard * 3);
  }
  const it = {
    // `id` is the item; `uid` is this particular pile, for the wire.
    uid: ++G.pickupSeq,
    x: px, y: py, kind, id, n,
    vx: lootRng.range(-40, 40), vy: lootRng.range(-40, 40),
    t: 0, bob: lootRng.range(0, TAU), life: 600,
  };
  G.pickups.push(it);
  return it;
}

export function updatePickups(dt) {
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const it = G.pickups[i];
    it.t += dt;
    it.life -= dt;
    it.x += it.vx * dt; it.y += it.vy * dt;
    const damp = Math.exp(-6 * dt);
    it.vx *= damp; it.vy *= damp;

    if (it.life <= 0) { G.pickups.splice(i, 1); continue; }
    // Whoever is closest gets the pull — and the loot.
    const p = nearestPlayer(it.x, it.y);
    if (!p) continue;

    const d2 = dist2(it.x, it.y, p.x, p.y);
    const range = p.pickupRange;
    // Magnet pull, then collect.
    if (d2 < range * range * 5.5) {
      const d = Math.sqrt(d2) || 1;
      const pull = clamp(700 / d, 40, 620);
      it.vx += ((p.x - it.x) / d) * pull * dt;
      it.vy += ((p.y - it.y) / d) * pull * dt;
    }
    if (d2 < (range * 0.45) * (range * 0.45)) {
      const r = giveEntry(p, { id: pickupEntryId(it), n: it.n });
      if (r && r.overflow) {
        // No room — leave it on the ground and stop pulling for a moment.
        it.n = r.overflow.n;
        it.vx = (it.x - p.x) * 1.2; it.vy = (it.y - p.y) * 1.2;
        continue;
      }
      if (r) FX.text(it.x, it.y - 8, r.text, r.color, 11, -40, 0.7);
      sfx('pickup');
      G.pickups.splice(i, 1);
    }
  }
}

// Ground pickups and loot entries are the same grammar seen from two sides.
// Both directions live here so they cannot drift apart — they already did
// once, and the symptom was rare gear silently deleted on contact.

/** Splits a prefixed entry id into the {kind, id} a pickup is stored as. */
export function entryToPickup(entry) {
  const c = entry.indexOf(':');
  if (c < 0) return { kind: 'res', id: entry };
  const prefix = entry.slice(0, c);
  const id = entry.slice(c + 1);
  if (prefix === 'weapon') return { kind: 'weapon', id };
  if (prefix === 'item') return { kind: 'item', id };
  if (prefix === 'armor' || prefix === 'gear') return { kind: 'gear', id };
  if (prefix === 'key') return { kind: 'key', id };
  return { kind: 'res', id: entry };
}

/** Rebuilds the entry id a pickup came from, for handing back to giveEntry. */
const pickupEntryId = (it) =>
  it.kind === 'res' ? it.id
    : it.kind === 'item' ? `item:${it.id}`
      : it.kind === 'weapon' ? `weapon:${it.id}`
        : it.kind === 'key' ? `key:${it.id}`
          : `gear:${it.id}`;

/** Drops a loot entry on the ground, decoding its kind from the entry id. */
export function spawnEntryPickup(x, y, entry, n) {
  const { kind, id } = entryToPickup(entry);
  spawnPickup(x, y, kind, id, n);
}

// ---------------------------------------------------------------- backpacks --

/** Everything the player was carrying, dropped where they fell. */
export function dropBackpack(p) {
  // Everything carried and worn, as one id->count map. You keep the starting
  // pipe so a respawn is never completely toothless.
  const held = {};
  const take = (cont) => {
    const entries = slotsEntries(cont);
    for (const id in entries) held[id] = (held[id] || 0) + entries[id];
  };
  take(p.bag);
  take(p.hotbar);
  for (const slot in p.equip) {
    const id = p.equip[slot];
    if (id) held[id] = (held[id] || 0) + 1;
  }
  if (held[p.startWeapon]) {
    held[p.startWeapon] -= 1;
    if (held[p.startWeapon] <= 0) delete held[p.startWeapon];
  }

  const contents = { bag: held, mag: { ...p.mag } };
  if (Object.keys(held).length === 0) return null;

  const pack = { x: p.x, y: p.y, contents, t: 0, id: Date.now() + Math.random() };
  G.backpacks.push(pack);

  slotsClear(p.bag);
  slotsClear(p.hotbar);
  for (const slot in p.equip) p.equip[slot] = null;
  slotsAdd(p.hotbar, p.startWeapon, 1);
  p.slot = 0;
  // Losing your armour has to actually cost you the mitigation — armorDR is
  // produced by recomputeStats and nothing else may write it.
  recomputeStats(p);
  return pack;
}

export function collectBackpack(p, pack) {
  let n = 0;
  for (const id of Object.keys(pack.contents.bag)) {
    const want = pack.contents.bag[id];
    const got = addResCapped(p.bag, id, want, packAllowance(p));
    pack.contents.bag[id] -= got;
    if (pack.contents.bag[id] <= 0) delete pack.contents.bag[id];
    if (got > 0 && WEAPONS[id] && p.mag[id] === undefined) {
      p.mag[id] = pack.contents.mag[id] ?? WEAPONS[id].mag ?? 0;
    }
    n += got;
  }

  let leftover = 0;
  for (const id in pack.contents.bag) leftover += pack.contents.bag[id];
  if (leftover <= 0) {
    G.backpacks.splice(G.backpacks.indexOf(pack), 1);
    notify('Pack recovered', '#b7e08a');
  } else {
    notify(`Recovered what fits — ${Math.round(leftover)} left in the pack`, '#d9c46a');
  }
  sfx('loot');
  FX.ring(pack.x, pack.y, 6, 60, 0.45, '#c9a227', 2);
  return n;
}

/**
 * Small drops from a dead enemy — keeps ammo flowing so guns stay usable.
 * @param killer  whose Luck applies; the player who made the kill
 */
export function enemyDrop(e, killer = baseOwner()) {
  // Fortune Favours (Luck perk) can pay a body out twice.
  if (killer && killer.doubleDropChance > 0 && lootRng() < killer.doubleDropChance) rollEnemyDrop(e);
  rollEnemyDrop(e);
}

function rollEnemyDrop(e) {
  const roll = lootRng();
  if (e.def.boss) {
    spawnPickup(e.x, e.y, 'res', 'mil', lootRng.int(4, 8));
    spawnPickup(e.x, e.y, 'res', 'parts', lootRng.int(2, 4));
    spawnPickup(e.x, e.y, 'res', 'ammoR', lootRng.int(10, 18));
    return;
  }
  if (roll < 0.16) spawnPickup(e.x, e.y, 'res', 'ammoP', lootRng.int(4, 10));
  else if (roll < 0.24) spawnPickup(e.x, e.y, 'res', 'cloth', lootRng.int(1, 3));
  else if (roll < 0.30) spawnPickup(e.x, e.y, 'res', 'scrap', lootRng.int(1, 4));
  else if (roll < 0.335) spawnPickup(e.x, e.y, 'item', 'bandage', 1);
  else if (roll < 0.35 && e.def.id === 'brute') spawnPickup(e.x, e.y, 'res', 'parts', 1);
}

export const containerWorldPos = (c) => ({ x: c.tx * TILE + TILE / 2, y: c.ty * TILE + TILE / 2 });
