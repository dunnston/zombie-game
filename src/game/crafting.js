// Crafting. Instant by design — the resource cost is the whole cost.

import { RECIPES, WEAPONS, CONSUMABLES, THREAT } from './config.js';
import { G, canAfford, spend, addRes, addResCapped, notify, scaledCost } from './state.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { addXp } from './progression.js';
import { addThreat } from './threat.js';
import { GEAR } from './config.js';
import { slotsAdd, firstEmpty, packAllowance } from './items.js';

/** Recipes visible at the player's current bench access level. */
export function visibleRecipes(benchTier) {
  return RECIPES.filter((r) => r.bench <= benchTier);
}

export function craftStatus(r, benchTier) {
  if (r.bench > benchTier) {
    return { ok: false, reason: r.bench === 1 ? 'Needs a Workbench' : 'Needs Workbench II' };
  }
  const p = G.player;
  // Duplicates are allowed now that gear and guns are ordinary items you can
  // carry, drop, stash or hand to the next respawn. What limits you is space.
  if ((r.give.weapon || r.give.armor) && firstEmpty(p.bag) < 0 && firstEmpty(p.hotbar) < 0) {
    return { ok: false, reason: 'No room in your pack' };
  }
  if (!canAfford(r.cost)) return { ok: false, reason: 'Missing materials' };
  return { ok: true, reason: '' };
}

export function craft(r, benchTier) {
  const st = craftStatus(r, benchTier);
  if (!st.ok) { sfx('deny'); notify(st.reason, '#c96a5a'); return false; }
  const p = G.player;
  spend(r.cost);

  let label = r.name;
  if (r.give.weapon) {
    const w = WEAPONS[r.give.weapon];
    if (firstEmpty(p.hotbar) >= 0) slotsAdd(p.hotbar, r.give.weapon, 1);
    else slotsAdd(p.bag, r.give.weapon, 1);
    if (p.mag[r.give.weapon] === undefined) p.mag[r.give.weapon] = w.mag || 0;
    label = `${w.name} crafted`;
  } else if (r.give.armor) {
    slotsAdd(p.bag, r.give.armor, 1);
    label = `${GEAR[r.give.armor].name} crafted — equip it from your pack (I)`;
  } else if (r.give.item) {
    slotsAdd(p.bag, r.give.item, r.give.n);
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
  addXp(r.xp);
  addThreat(THREAT.perCraft);
  FX.text(p.x, p.y - 34, label, '#b7e08a', 12, -40, 1.0);
  notify(label, '#b7e08a');
  return true;
}

export const recipeCost = (r) => scaledCost(r.cost, 1);
