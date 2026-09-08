// Equipping, unequipping and the drag-and-drop moves the inventory screen
// makes. Kept out of player.js so the UI has one obvious place to call into,
// and so every path that changes what is worn goes through recomputeStats().

import { GEAR, GEAR_SLOTS, ARMOR_SLOTS, PLAYER } from './config.js';
import { G, notify } from './state.js';
import {
  ITEMS, slotsAdd, slotsTake, firstEmpty, gearSlot, slotsMove, slotsSplit,
} from './items.js';
import { recomputeStats } from './perks.js';
import { carriedWeight } from './player.js';
import { spawnPickup } from './loot.js';
import { structAtTile } from './building.js';
import { dist2 } from '../core/util.js';
import { sfx } from '../core/audio.js';

/**
 * Reconciles the off-hand after anything changes what is worn, then rebuilds
 * the stats. Every mutator in this file ends with this rather than with
 * `recomputeStats` alone, so there is still exactly one place a modifier can
 * come from (invariant 4) and exactly one place the light can fall out of step.
 *
 * A light's charge lives on the player, not in the slot, because a slot is
 * only `{ id, n }` — see items.js. So the charge is remembered per light id:
 * putting a flashlight down and picking it back up keeps its battery, but
 * switching to a different light and back does not.
 */
function afterEquipChange(p) {
  const id = p.equip ? p.equip.offhand : null;
  const g = id ? GEAR[id] : null;
  if (!g || !g.light) {
    p.lightOn = false;                     // nothing lit; the charge is kept
  } else if (p.lightId !== g.id) {
    p.lightId = g.id;
    // A torch comes ready to burn. A flashlight arrives flat, so finding one
    // is not the same as having light — you still need a battery.
    p.lightFuel = g.battery ? 0 : g.burn;
    p.lightOn = false;
  }
  recomputeStats(p);
}

/**
 * Wears the item in bag slot `index`. Anything already in that equipment slot
 * goes back to the pack — swapping a helmet should never destroy the old one.
 */
export function equipFromBag(p, index) {
  const stack = p.bag.slots[index];
  if (!stack) return false;
  const slot = gearSlot(stack.id);
  if (!slot) { sfx('deny'); return false; }

  const previous = p.equip[slot];
  p.equip[slot] = stack.id;
  // Gear never stacks, so the slot is emptied outright.
  p.bag.slots[index] = previous ? { id: previous, n: 1 } : null;

  afterEquipChange(p);
  sfx('ui');
  notify(`${GEAR[stack.id].name} equipped`, '#b7e08a');
  return true;
}

/** Takes a piece off. Fails if there is nowhere to put it. */
export function unequip(p, slot) {
  const id = p.equip[slot];
  if (!id) return false;
  if (firstEmpty(p.bag) < 0) {
    sfx('deny');
    notify('No room in your pack', '#c96a5a');
    return false;
  }
  p.equip[slot] = null;
  slotsAdd(p.bag, id, 1);
  afterEquipChange(p);
  sfx('ui');
  return true;
}

/**
 * Drag from a body slot onto a pack or hotbar cell: takes the piece off into
 * that cell, swapping with whatever is there if it is a piece for the same
 * slot. Refuses anything else, so a helmet cannot land on a stack of nails.
 */
export function unequipTo(p, slot, contKind, index) {
  const id = p.equip[slot];
  if (!id) return false;
  const cont = contKind === 'bag' ? p.bag : p.hotbar;
  if (index < 0 || index >= cont.slots.length) return false;
  const target = cont.slots[index];
  if (target) {
    const g = GEAR[target.id];
    if (!g || g.slot !== slot || target.n !== 1) return false;
    p.equip[slot] = target.id;
  } else {
    p.equip[slot] = null;
  }
  cont.slots[index] = { id, n: 1 };
  afterEquipChange(p);
  sfx('ui');
  return true;
}

/**
 * Drag from a pack or hotbar cell onto a body slot: wears it if it belongs
 * there, and puts whatever was worn back into the cell it came from.
 */
export function equipFromSlot(p, contKind, index, slot) {
  const cont = contKind === 'bag' ? p.bag : p.hotbar;
  const s = cont.slots[index];
  if (!s) return false;
  const g = GEAR[s.id];
  if (!g || g.slot !== slot) return false;
  const previous = p.equip[slot];
  p.equip[slot] = s.id;
  cont.slots[index] = previous ? { id: previous, n: 1 } : null;
  afterEquipChange(p);
  sfx('ui');
  return true;
}

/**
 * Wears the best thing carried for every empty slot — the quick-equip button.
 *
 * Armour slots only. The off-hand holds a light, which has no `dr` to be best
 * at, and picking between a torch and a flashlight is a decision about how
 * loud and how long you want to be lit, not one this button can make for you.
 */
export function equipBest(p) {
  let changed = 0;
  for (const slot of ARMOR_SLOTS) {
    let bestIndex = -1, bestDr = p.equip[slot] ? GEAR[p.equip[slot]].dr : -1;
    for (let i = 0; i < p.bag.slots.length; i++) {
      const s = p.bag.slots[i];
      if (!s) continue;
      const g = GEAR[s.id];
      if (!g || g.slot !== slot) continue;
      if (g.dr > bestDr) { bestDr = g.dr; bestIndex = i; }
    }
    if (bestIndex >= 0 && equipFromBag(p, bestIndex)) changed++;
  }
  if (!changed) notify('Nothing better to wear', '#8a8f84');
  return changed;
}

// ------------------------------------------------------------------ moves ---

/**
 * Moves or merges between any two containers this player can reach: the pack,
 * the hotbar, and — when `at` names a tile — the store of the structure
 * standing on it.
 *
 * `at` exists so a guest's move carries WHICH chest. The host resolves the
 * structure itself and checks the player is standing beside it, rather than
 * trusting a screen it cannot see.
 */
export function moveStack(p, fromCont, fromIndex, toCont, toIndex, at = null) {
  const store = at ? reachableStore(p, at) : null;
  if ((fromCont === 'store' || toCont === 'store') && !store) return false;
  const from = container(p, fromCont, store);
  const to = container(p, toCont, store);
  if (!from || !to) return false;
  const ok = from === to
    ? slotsMove(from, fromIndex, toIndex)
    : slotsMove(from, fromIndex, toIndex, to);
  if (ok) sfx('ui');
  return ok;
}

export function splitStack(p, cont, fromIndex, toIndex) {
  const c = container(p, cont);
  if (!c) return false;
  const ok = slotsSplit(c, fromIndex, toIndex);
  if (ok) sfx('ui');
  return ok;
}

/** Drops a stack on the ground at the player's feet, where it can be picked up. */
export function dropStack(p, cont, index, all = true, at = null) {
  // `at` names a chest or stash, so ctrl+click on a container slot drops on
  // the ground rather than silently doing nothing. Range-checked host-side,
  // exactly as moveStack is.
  const store = at ? reachableStore(p, at) : null;
  if (cont === 'store' && !store) return false;
  const c = container(p, cont, store);
  if (!c) return false;
  const s = c.slots[index];
  if (!s) return false;
  const n = all ? s.n : 1;
  const id = s.id;
  slotsTake(c, id, n);
  spawnPickup(p.x, p.y, kindOf(id), id, n, p);
  sfx('ui');
  notify(`Dropped ${n} ${ITEMS[id].name}`, '#8a8f84');
  return true;
}

/** Drops a worn piece straight on the ground, without needing pack room. */
export function dropEquipped(p, slot) {
  const id = p.equip[slot];
  if (!id) return false;
  p.equip[slot] = null;
  // Both sides of the merge are wanted: afterEquipChange keeps the off-hand
  // light in step, and `p` marks the pile as this player's own drop so their
  // pickup magnet does not hand it straight back.
  afterEquipChange(p);
  spawnPickup(p.x, p.y, 'gear', id, 1, p);
  sfx('ui');
  return true;
}

function kindOf(id) {
  const it = ITEMS[id];
  if (!it) return 'res';
  return it.kind === 'res' ? 'res' : it.kind;
}

/**
 * The store of the structure at `at`, if this player is close enough to be
 * using it. Range-checked here rather than in the UI: the screen belongs to
 * one browser and the rule has to hold for a guest's command too.
 */
function reachableStore(p, at) {
  const s = structAtTile(at.tx | 0, at.ty | 0);
  if (!s || s.destroyed || !s.store) return null;
  const R = PLAYER.interactRange + 40;
  return dist2(p.x, p.y, s.x, s.y) <= R * R ? s.store : null;
}

function container(p, name, store = null) {
  if (name === 'bag') return p.bag;
  if (name === 'hotbar') return p.hotbar;
  if (name === 'store') return store;
  return null;
}

/** True when the pack is over capacity — the UI greys the weight bar for this. */
export const overloaded = (p) => carriedWeight(p) > p.carryCap;
