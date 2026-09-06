// Crafting. Instant by design — the resource cost is the whole cost.

import { RECIPES, WEAPONS, CONSUMABLES, THREAT } from './config.js';
import { G, canAfford, spend, addRes, addResCapped, notify, scaledCost } from './state.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { addXp } from './progression.js';
import { addThreat } from './threat.js';
import { GEAR } from './config.js';
import {
  ITEMS, slotsAdd, firstEmpty, packAllowance, stackLimit, slotsWeight, itemWeight,
} from './items.js';
import { spawnEntryPickup } from './loot.js';
import { primaryLabel } from '../core/bindings.js';

/** The prefixed entry id for an item, so it can be spawned as a ground pickup. */
function entryIdFor(id) {
  const it = ITEMS[id];
  if (!it) return id;
  if (it.kind === 'weapon') return `weapon:${id}`;
  if (it.kind === 'gear') return `gear:${id}`;
  if (it.kind === 'consumable') return `item:${id}`;
  return id;
}

/** Recipes visible at the player's current bench access level. */
export function visibleRecipes(benchTier) {
  return RECIPES.filter((r) => r.bench <= benchTier);
}

export function craftStatus(r, benchTier, p = G.player) {
  if (r.bench > benchTier) {
    return { ok: false, reason: r.bench === 1 ? 'Needs a Workbench' : 'Needs Workbench II' };
  }
  // Duplicates are allowed now that gear and guns are ordinary items you can
  // carry, drop, stash or hand to the next respawn. What limits you is space —
  // and the check has to name the *same* container the craft will actually use,
  // or the cost is spent and the output falls on the floor. Weapons prefer the
  // hotbar and fall back to the pack; gear only ever goes to the pack.
  if (r.give.weapon && firstEmpty(p.bag) < 0 && firstEmpty(p.hotbar) < 0) {
    return { ok: false, reason: 'No room for it' };
  }
  if (r.give.armor && firstEmpty(p.bag) < 0) {
    return { ok: false, reason: 'No room in your pack' };
  }
  if (r.give.item && !roomForStack(p, r.give.item, r.give.n)) {
    return { ok: false, reason: 'No room in your pack' };
  }
  if (!canAfford(r.cost, 1, p)) return { ok: false, reason: 'Missing materials' };
  return { ok: true, reason: '' };
}

/** Whether the pack can take `n` of `id`, by slot space and by weight. */
function roomForStack(p, id, n) {
  const max = stackLimit(id);
  let room = 0;
  for (const s of p.bag.slots) {
    if (!s) room += max;
    else if (s.id === id) room += max - s.n;
    if (room >= n) break;
  }
  if (room < n) return false;
  return packAllowance(p) - slotsWeight(p.bag) >= itemWeight(id) * n - 1e-9;
}

export function craft(r, benchTier, p = G.player) {
  const st = craftStatus(r, benchTier, p);
  if (!st.ok) { sfx('deny'); notify(st.reason, '#c96a5a'); return false; }
  spend(r.cost, 1, p);

  // Belt and braces behind the checks above: whatever a slotsAdd cannot take
  // lands at the player's feet. The cost has already been spent by this point,
  // so the one outcome that must be impossible is the output disappearing.
  const orGround = (id, wanted, got) => {
    if (got >= wanted) return;
    spawnEntryPickup(p.x, p.y, entryIdFor(id), wanted - got);
    notify('No room — it is on the ground at your feet', '#d9c46a');
  };

  let label = r.name;
  if (r.give.weapon) {
    const w = WEAPONS[r.give.weapon];
    const got = firstEmpty(p.hotbar) >= 0
      ? slotsAdd(p.hotbar, r.give.weapon, 1)
      : slotsAdd(p.bag, r.give.weapon, 1);
    orGround(r.give.weapon, 1, got);
    if (p.mag[r.give.weapon] === undefined) p.mag[r.give.weapon] = w.mag || 0;
    label = `${w.name} crafted`;
  } else if (r.give.armor) {
    orGround(r.give.armor, 1, slotsAdd(p.bag, r.give.armor, 1));
    label = `${GEAR[r.give.armor].name} crafted — equip it from your pack (${primaryLabel('inventory')})`;
  } else if (r.give.item) {
    orGround(r.give.item, r.give.n, slotsAdd(p.bag, r.give.item, r.give.n));
    label = `${CONSUMABLES[r.give.item].name} x${r.give.n}`;
  } else if (r.give.res) {
    for (const id in r.give.res) {
      // Gunsmith boosts crafted ammunition specifically.
      const isAmmo = id === 'ammoP' || id === 'ammoS' || id === 'ammoR';
      const want = Math.round(r.give.res[id] * (isAmmo ? p.craftYieldMul : 1));
      const got = addResCapped(p.bag, id, want, packAllowance(p));
      if (got < want) {
        addRes(G.stash, id, want - got);
        notify('Pack full — the rest went to your stash', '#d9c46a');
      }
    }
  }

  G.stats.crafted++;
  sfx('craft');
  addXp(p, r.xp);
  addThreat(THREAT.perCraft, '', p);
  FX.text(p.x, p.y - 34, label, '#b7e08a', 12, -40, 1.0);
  notify(label, '#b7e08a');
  return true;
}

export const recipeCost = (r) => scaledCost(r.cost, 1);
