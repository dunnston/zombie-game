// Equipping, unequipping and the drag-and-drop moves the inventory screen
// makes. Kept out of player.js so the UI has one obvious place to call into,
// and so every path that changes what is worn goes through recomputeStats().

import { GEAR, GEAR_SLOTS, ARMOR_SLOTS } from './config.js';
import { G, notify } from './state.js';
import {
  ITEMS, slotsAdd, slotsTake, firstEmpty, gearSlot, slotsMove, slotsSplit,
} from './items.js';
import { recomputeStats } from './perks.js';
import { carriedWeight } from './player.js';
import { spawnPickup } from './loot.js';
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

/** Moves or merges between any two of the player's slot containers. */
export function moveStack(p, fromCont, fromIndex, toCont, toIndex) {
  const from = container(p, fromCont);
  const to = container(p, toCont);
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
export function dropStack(p, cont, index, all = true) {
  const c = container(p, cont);
  if (!c) return false;
  const s = c.slots[index];
  if (!s) return false;
  const n = all ? s.n : 1;
  const id = s.id;
  slotsTake(c, id, n);
  spawnPickup(p.x, p.y, kindOf(id), id, n);
  sfx('ui');
  notify(`Dropped ${n} ${ITEMS[id].name}`, '#8a8f84');
  return true;
}

/** Drops a worn piece straight on the ground, without needing pack room. */
export function dropEquipped(p, slot) {
  const id = p.equip[slot];
  if (!id) return false;
  p.equip[slot] = null;
  afterEquipChange(p);
  spawnPickup(p.x, p.y, 'gear', id, 1);
  sfx('ui');
  return true;
}

function kindOf(id) {
  const it = ITEMS[id];
  if (!it) return 'res';
  return it.kind === 'res' ? 'res' : it.kind;
}

function container(p, name) {
  if (name === 'bag') return p.bag;
  if (name === 'hotbar') return p.hotbar;
  return null;
}

/** True when the pack is over capacity — the UI greys the weight bar for this. */
export const overloaded = (p) => carriedWeight(p) > p.carryCap;
