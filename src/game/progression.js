// XP, levels and the pick-one-of-three upgrade draft.

import { UPGRADES, xpForLevel } from './config.js';
import { G, notify } from './state.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { makeRng } from '../core/util.js';

export function addXp(amount, label = null) {
  const p = G.player;
  if (!p || amount <= 0) return;
  p.xp += amount;
  if (label) FX.text(p.x, p.y - 30, `+${Math.round(amount)} XP ${label}`, '#9fd0ff', 11, -38, 0.8);
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = xpForLevel(p.level);
    p.pendingLevels++;
  }
  if (p.pendingLevels > 0 && !G.ui.levelChoices) openLevelUp();
}

/** Upgrades the player has not yet maxed out. */
export function availableUpgrades(p) {
  return UPGRADES.filter((u) => (p.upgrades[u.id] || 0) < u.max);
}

export function rollChoices(p, seed) {
  const rng = makeRng(seed);
  const pool = availableUpgrades(p);
  const picks = [];
  // Prefer one from each category so the draft always offers a real decision.
  const byCat = new Map();
  for (const u of pool) {
    if (!byCat.has(u.cat)) byCat.set(u.cat, []);
    byCat.get(u.cat).push(u);
  }
  const cats = [...byCat.keys()];
  while (picks.length < 3 && cats.length) {
    const ci = rng.int(0, cats.length - 1);
    const list = byCat.get(cats[ci]);
    const u = list.splice(rng.int(0, list.length - 1), 1)[0];
    if (u) picks.push(u);
    if (!list || list.length === 0) cats.splice(ci, 1);
  }
  // Top up from anything left if categories ran dry.
  for (const u of pool) {
    if (picks.length >= 3) break;
    if (!picks.includes(u)) picks.push(u);
  }
  return picks;
}

export function openLevelUp() {
  const p = G.player;
  if (p.pendingLevels <= 0) return;
  const choices = rollChoices(p, (p.level * 7919 + G.stats.kills * 31 + Math.floor(G.time * 13)) >>> 0);
  if (choices.length === 0) { p.pendingLevels = 0; return; }
  G.ui.levelChoices = choices;
  G.ui.panel = 'levelup';
  sfx('levelUp');
  FX.ring(p.x, p.y, 10, 130, 0.7, '#ffe08a', 3);
  notify(`LEVEL ${p.level}`, '#ffe08a', true);
}

export function chooseUpgrade(id) {
  const p = G.player;
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return false;
  if ((p.upgrades[id] || 0) >= u.max) return false;
  u.apply(p);
  p.upgrades[id] = (p.upgrades[id] || 0) + 1;
  p.pendingLevels--;
  G.ui.levelChoices = null;
  G.ui.panel = null;
  sfx('craft');
  notify(`${u.name} — ${u.desc}`, '#b7e08a');
  FX.ring(p.x, p.y, 8, 90, 0.5, '#b7e08a', 2);
  if (p.pendingLevels > 0) openLevelUp();
  return true;
}

/** Re-applies every owned upgrade onto a fresh stat block (used by save/load). */
export function reapplyUpgrades(p) {
  for (const u of UPGRADES) {
    const n = p.upgrades[u.id] || 0;
    for (let i = 0; i < n; i++) u.apply(p);
  }
}
