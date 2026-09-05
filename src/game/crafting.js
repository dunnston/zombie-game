// Crafting. Instant by design — the resource cost is the whole cost.

import { RECIPES, WEAPONS, ARMORS, CONSUMABLES, THREAT } from './config.js';
import { G, canAfford, spend, addResCapped, notify, scaledCost } from './state.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { addXp } from './progression.js';
import { addThreat } from './threat.js';
import { bestArmor } from './loot.js';

/** Recipes visible at the player's current bench access level. */
export function visibleRecipes(benchTier) {
  return RECIPES.filter((r) => r.bench <= benchTier);
}

export function craftStatus(r, benchTier) {
  if (r.bench > benchTier) {
    return { ok: false, reason: r.bench === 1 ? 'Needs a Workbench' : 'Needs Workbench II' };
  }
  const p = G.player;
  if (r.give.weapon && p.weapons.includes(r.give.weapon)) {
    return { ok: false, reason: 'Already owned' };
  }
  if (r.give.armor && p.armors.includes(r.give.armor)) {
    return { ok: false, reason: 'Already owned' };
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
    p.weapons.push(r.give.weapon);
    p.mag[r.give.weapon] = w.mag || 0;
    label = `${w.name} crafted`;
  } else if (r.give.armor) {
    p.armors.push(r.give.armor);
    p.armor = bestArmor(p);
    label = `${ARMORS[r.give.armor].name} crafted`;
  } else if (r.give.item) {
    p.items[r.give.item] = (p.items[r.give.item] || 0) + r.give.n;
    label = `${CONSUMABLES[r.give.item].name} x${r.give.n}`;
  } else if (r.give.res) {
    for (const id in r.give.res) {
      const got = addResCapped(p.bag, id, r.give.res[id], p.carryCap);
      if (got < r.give.res[id]) notify('Pack full — some output was lost', '#d9c46a');
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
