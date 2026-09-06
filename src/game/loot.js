// Loot rolls, world pickups and the death backpack.

import { LOOT, RES, WEAPONS, ARMORS, CONSUMABLES, TILE, bagWeight } from './config.js';
import { G, addResCapped, notify, solidPx } from './state.js';
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
const hasWeapon = (p, id) => p.weapons.includes(id);

/**
 * Gives one loot entry to the player. Resources respect carry weight; the
 * overflow is returned so the caller can drop it on the ground.
 * Returns { text, color, overflow: {id,n}|null }.
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
        const got = addResCapped(p.bag, w.ammo, give, p.carryCap);
        return { text: `${w.name} (spare ammo +${got})`, color: '#d8c98a' };
      }
      return { text: `${w.name} (already carried)`, color: '#8a8f84' };
    }
    p.weapons.push(wid);
    p.mag[wid] = w.mag || 0;
    return { text: `${w.name} acquired`, color: '#ffe08a', major: true };
  }

  if (id.startsWith('armor:')) {
    const aid = id.slice(6);
    const a = ARMORS[aid];
    if (!a) return null;
    if (!p.armors.includes(aid)) p.armors.push(aid);
    const best = bestArmor(p);
    if (best !== p.armor) {
      p.armor = best;
      return { text: `${a.name} equipped (+${Math.round(a.dr * 100)}% armour)`, color: '#ffe08a', major: true };
    }
    return { text: `${a.name} stowed`, color: '#a8b09a' };
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
    p.items[iid] = (p.items[iid] || 0) + n;
    return { text: `${c.name} x${n}`, color: c.color };
  }

  const def = RES[id];
  if (!def) return null;
  const got = addResCapped(p.bag, id, n, p.carryCap);
  const over = n - got;
  return {
    text: got > 0 ? `${def.name} +${got}` : `${def.name} — PACK FULL`,
    color: got > 0 ? def.color : '#c96a5a',
    overflow: over > 0 ? { id, n: over } : null,
  };
}

export function bestArmor(p) {
  let best = null, dr = -1;
  for (const id of p.armors) {
    const a = ARMORS[id];
    if (a && a.dr > dr) { dr = a.dr; best = id; }
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
    if (r.overflow) spawnPickup(x, y, 'res', r.overflow.id, r.overflow.n);
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
  G.pickups.push({
    x: px, y: py, kind, id, n,
    vx: lootRng.range(-40, 40), vy: lootRng.range(-40, 40),
    t: 0, bob: lootRng.range(0, TAU), life: 600,
  });
}

export function updatePickups(dt) {
  const p = G.player;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const it = G.pickups[i];
    it.t += dt;
    it.life -= dt;
    it.x += it.vx * dt; it.y += it.vy * dt;
    const damp = Math.exp(-6 * dt);
    it.vx *= damp; it.vy *= damp;

    if (it.life <= 0) { G.pickups.splice(i, 1); continue; }
    if (!p || p.dead) continue;

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

const pickupEntryId = (it) =>
  it.kind === 'res' ? it.id
    : it.kind === 'item' ? `item:${it.id}`
      : it.kind === 'weapon' ? `weapon:${it.id}`
        : `armor:${it.id}`;

// ---------------------------------------------------------------- backpacks --

/** Everything the player was carrying, dropped where they fell. */
export function dropBackpack(p) {
  const contents = {
    bag: { ...p.bag },
    items: { ...p.items },
    weapons: p.weapons.filter((w) => w !== 'fists' && w !== p.startWeapon),
    armors: [...p.armors],
    mag: { ...p.mag },
  };
  const empty = bagWeight(contents.bag) === 0 && contents.weapons.length === 0 &&
    contents.armors.length === 0 && Object.keys(contents.items).length === 0;
  if (empty) return null;

  const pack = { x: p.x, y: p.y, contents, t: 0, id: Date.now() + Math.random() };
  G.backpacks.push(pack);

  p.bag = {};
  p.items = {};
  p.armors = [];
  p.armor = null;
  p.weapons = p.weapons.filter((w) => w === 'fists' || w === p.startWeapon);
  if (!p.weapons.includes(p.startWeapon)) p.weapons.push(p.startWeapon);
  p.slot = Math.min(p.slot, p.weapons.length - 1);
  return pack;
}

export function collectBackpack(p, pack) {
  let n = 0;
  for (const id in pack.contents.bag) {
    const got = addResCapped(p.bag, id, pack.contents.bag[id], p.carryCap);
    pack.contents.bag[id] -= got;
    if (pack.contents.bag[id] <= 0) delete pack.contents.bag[id];
    n += got;
  }
  for (const id in pack.contents.items) {
    p.items[id] = (p.items[id] || 0) + pack.contents.items[id];
    n += pack.contents.items[id];
  }
  pack.contents.items = {};
  for (const w of pack.contents.weapons) {
    if (!p.weapons.includes(w)) {
      p.weapons.push(w);
      p.mag[w] = pack.contents.mag[w] ?? (WEAPONS[w] ? WEAPONS[w].mag : 0);
      n++;
    }
  }
  pack.contents.weapons = [];
  for (const a of pack.contents.armors) if (!p.armors.includes(a)) { p.armors.push(a); n++; }
  pack.contents.armors = [];
  p.armor = bestArmor(p);

  const leftover = bagWeight(pack.contents.bag);
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

/** Small drops from a dead enemy — keeps ammo flowing so guns stay usable. */
export function enemyDrop(e) {
  const p = G.player;
  // Fortune Favours (Luck perk) can pay a body out twice.
  if (p && p.doubleDropChance > 0 && lootRng() < p.doubleDropChance) rollEnemyDrop(e);
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
