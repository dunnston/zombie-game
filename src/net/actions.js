// The one seam between the UI and anything that changes shared state.
//
// In solo and on the host, `act.place(...)` is `placeStructure(...)` for the
// local player. On a guest it is a command to the host, who validates it with
// the same functions and executes it; the result comes back as events. The
// HUD, the inventory screen and build mode call `act.*` and never care which.

import { G } from '../game/state.js';
import {
  placeStructure, repairStructure, repairAll, demolishStructure, upgradeBench, structAtTile,
  depositAll, withdrawSupplies,
} from '../game/building.js';
import { craft } from '../game/crafting.js';
import { raiseAttribute, buyPerk } from '../game/progression.js';
import {
  equipFromBag, unequip, equipBest, moveStack, splitStack, dropStack, dropEquipped, unequipTo, equipFromSlot,
} from '../game/equipment.js';
import { assignJob, buyArmament, setTowerArmament } from '../game/survivors.js';
import { RECIPES } from '../game/config.js';
import { sendCommand } from './client.js';

const isClient = () => G.net.role === 'client';

/** A wire {tx, ty} coerced to integers, or null. */
const tileArg = (at) => (at && typeof at === 'object' ? { tx: at.tx | 0, ty: at.ty | 0 } : null);

/**
 * The container the player means, range-checked. Falls back to the shared
 * stash when no tile is given, which is what the old E-beside-the-stash and
 * take-ammo shortcuts pass.
 */
function storeAt(p, at) {
  if (!at) return G.stash;
  const s = structAtTile(at.tx, at.ty);
  if (!s || s.destroyed || !s.store) return null;
  const R = 116;                                   // interactRange plus a little
  return (s.x - p.x) ** 2 + (s.y - p.y) ** 2 <= R * R ? s.store : null;
}

export const act = {
  place(type, tx, ty) {
    if (isClient()) return sendCommand('place', { type, tx, ty }), null;
    return placeStructure(type, tx, ty, G.player);
  },
  repair(s) {
    if (isClient()) return sendCommand('repair', { tx: s.tx, ty: s.ty }), false;
    return repairStructure(s, G.player);
  },
  repairAll() {
    if (isClient()) return sendCommand('repairAll', {}), 0;
    return repairAll(G.player);
  },
  demolish(s) {
    if (isClient()) return sendCommand('demolish', { tx: s.tx, ty: s.ty }), false;
    return demolishStructure(s, G.player);
  },
  upgradeBench(s) {
    if (isClient()) return sendCommand('upgradeBench', { tx: s.tx, ty: s.ty }), false;
    return upgradeBench(s, G.player);
  },
  craft(recipe, benchTier) {
    if (isClient()) return sendCommand('craft', { id: recipe.id, tier: benchTier }), false;
    return craft(recipe, benchTier, G.player);
  },
  raiseAttribute(id) {
    if (isClient()) return sendCommand('attr', { id }), false;
    return raiseAttribute(id, G.player);
  },
  buyPerk(id) {
    if (isClient()) return sendCommand('perk', { id }), false;
    return buyPerk(id, G.player);
  },
  assignJob(s, job) {
    if (isClient()) return sendCommand('job', { id: s.id, job }), false;
    return assignJob(s, job);
  },
  // Inventory. `p` is always the local player; the host resolves it to the guest's.
  equipFromBag(index) {
    if (isClient()) return sendCommand('equip', { i: index }), false;
    return equipFromBag(G.player, index);
  },
  unequip(slot) {
    if (isClient()) return sendCommand('unequip', { slot }), false;
    return unequip(G.player, slot);
  },
  equipBest() {
    if (isClient()) return sendCommand('equipBest', {}), 0;
    return equipBest(G.player);
  },
  // `at` is {tx, ty} when either end of the move is a chest, locker or stash.
  // The host resolves the structure and checks the range itself.
  moveStack(fromCont, fromIndex, toCont, toIndex, at = null) {
    if (isClient()) return sendCommand('move', { fc: fromCont, fi: fromIndex, tc: toCont, ti: toIndex, at }), false;
    return moveStack(G.player, fromCont, fromIndex, toCont, toIndex, at);
  },
  buyArmament(id) {
    if (isClient()) return sendCommand('buyArm', { id }), false;
    return buyArmament(String(id), G.player);
  },
  setTowerArm(tower, id) {
    if (isClient()) return sendCommand('towerArm', { tx: tower.tx, ty: tower.ty, id }), false;
    return setTowerArmament(tower, String(id), G.player);
  },
  depositAll(at) {
    if (isClient()) return sendCommand('deposit', { at }), 0;
    return depositAll(G.player, storeAt(G.player, at));
  },
  withdrawSupplies(at) {
    if (isClient()) return sendCommand('withdraw', { at }), 0;
    return withdrawSupplies(G.player, storeAt(G.player, at));
  },
  splitStack(cont, fromIndex, toIndex) {
    if (isClient()) return sendCommand('split', { c: cont, fi: fromIndex, ti: toIndex }), false;
    return splitStack(G.player, cont, fromIndex, toIndex);
  },
  dropStack(cont, index, all = true) {
    if (isClient()) return sendCommand('drop', { c: cont, i: index, all }), false;
    return dropStack(G.player, cont, index, all);
  },
  dropEquipped(slot) {
    if (isClient()) return sendCommand('dropEq', { slot }), false;
    return dropEquipped(G.player, slot);
  },
  unequipTo(slot, contKind, index) {
    if (isClient()) return sendCommand('unequipTo', { slot, c: contKind, i: index }), false;
    return unequipTo(G.player, slot, contKind, index);
  },
  equipFromSlot(contKind, index, slot) {
    if (isClient()) return sendCommand('equipFromSlot', { c: contKind, i: index, slot }), false;
    return equipFromSlot(G.player, contKind, index, slot);
  },
};

/**
 * Host side: runs a guest's command as that guest. Every branch goes through
 * the same function the UI would have called locally, so range, cost and room
 * checks are the ones solo uses. Unknown or malformed commands are ignored.
 */
export function executeCommand(p, name, a) {
  if (!p || p.away || p.dead || p.downed) return false;
  const struct = () => structAtTile(a.tx | 0, a.ty | 0);
  switch (name) {
    case 'place': return !!placeStructure(String(a.type), a.tx | 0, a.ty | 0, p);
    case 'repair': { const s = struct(); return !!s && repairStructure(s, p); }
    case 'repairAll': return repairAll(p) > 0;
    case 'demolish': { const s = struct(); return !!s && demolishStructure(s, p); }
    case 'upgradeBench': { const s = struct(); return !!s && s.type === 'workbench' && upgradeBench(s, p); }
    case 'craft': { const r = RECIPES.find((x) => x.id === a.id); return !!r && craft(r, Math.min(a.tier | 0, G.benchTier), p); }
    case 'attr': return raiseAttribute(String(a.id), p);
    case 'perk': return buyPerk(String(a.id), p);
    case 'job': { const s = G.survivors.find((x) => x.id === a.id && !x.dead); return !!s && assignJob(s, String(a.job)); }
    case 'equip': return equipFromBag(p, a.i | 0);
    case 'unequip': return unequip(p, String(a.slot));
    case 'equipBest': return equipBest(p);
    case 'move': return moveStack(p, String(a.fc), a.fi | 0, String(a.tc), a.ti | 0, tileArg(a.at));
    case 'buyArm': return buyArmament(String(a.id), p);
    case 'towerArm': { const s = struct(); return !!s && setTowerArmament(s, String(a.id), p); }
    case 'deposit': return depositAll(p, storeAt(p, tileArg(a.at))) > 0;
    case 'withdraw': return withdrawSupplies(p, storeAt(p, tileArg(a.at))) > 0;
    case 'split': return splitStack(p, String(a.c), a.fi | 0, a.ti | 0);
    case 'drop': return dropStack(p, String(a.c), a.i | 0, a.all !== false);
    case 'dropEq': return dropEquipped(p, String(a.slot));
    case 'unequipTo': return unequipTo(p, String(a.slot), String(a.c), a.i | 0);
    case 'equipFromSlot': return equipFromSlot(p, String(a.c), a.i | 0, String(a.slot));
    default: return false;
  }
}
