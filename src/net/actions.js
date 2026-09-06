// The one seam between the UI and anything that changes shared state.
//
// In solo and on the host, `act.place(...)` is `placeStructure(...)` for the
// local player. On a guest it is a command to the host, who validates it with
// the same functions and executes it; the result comes back as events. The
// HUD, the inventory screen and build mode call `act.*` and never care which.

import { G } from '../game/state.js';
import { placeStructure, repairStructure, demolishStructure, upgradeBench, structAtTile } from '../game/building.js';
import { craft } from '../game/crafting.js';
import { raiseAttribute, buyPerk } from '../game/progression.js';
import {
  equipFromBag, unequip, equipBest, moveStack, splitStack, dropStack, dropEquipped, unequipTo, equipFromSlot,
} from '../game/equipment.js';
import { assignJob } from '../game/survivors.js';
import { RECIPES } from '../game/config.js';
import { sendCommand } from './client.js';

const isClient = () => G.net.role === 'client';

export const act = {
  place(type, tx, ty) {
    if (isClient()) return sendCommand('place', { type, tx, ty }), null;
    return placeStructure(type, tx, ty, G.player);
  },
  repair(s) {
    if (isClient()) return sendCommand('repair', { tx: s.tx, ty: s.ty }), false;
    return repairStructure(s, G.player);
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
  moveStack(fromCont, fromIndex, toCont, toIndex) {
    if (isClient()) return sendCommand('move', { fc: fromCont, fi: fromIndex, tc: toCont, ti: toIndex }), false;
    return moveStack(G.player, fromCont, fromIndex, toCont, toIndex);
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
    case 'demolish': { const s = struct(); return !!s && demolishStructure(s, p); }
    case 'upgradeBench': { const s = struct(); return !!s && s.type === 'workbench' && upgradeBench(s, p); }
    case 'craft': { const r = RECIPES.find((x) => x.id === a.id); return !!r && craft(r, Math.min(a.tier | 0, G.benchTier), p); }
    case 'attr': return raiseAttribute(String(a.id), p);
    case 'perk': return buyPerk(String(a.id), p);
    case 'job': { const s = G.survivors.find((x) => x.id === a.id && !x.dead); return !!s && assignJob(s, String(a.job)); }
    case 'equip': return equipFromBag(p, a.i | 0);
    case 'unequip': return unequip(p, String(a.slot));
    case 'equipBest': return equipBest(p);
    case 'move': return moveStack(p, String(a.fc), a.fi | 0, String(a.tc), a.ti | 0);
    case 'split': return splitStack(p, String(a.c), a.fi | 0, a.ti | 0);
    case 'drop': return dropStack(p, String(a.c), a.i | 0, a.all !== false);
    case 'dropEq': return dropEquipped(p, String(a.slot));
    case 'unequipTo': return unequipTo(p, String(a.slot), String(a.c), a.i | 0);
    case 'equipFromSlot': return equipFromSlot(p, String(a.c), a.i | 0, String(a.slot));
    default: return false;
  }
}
