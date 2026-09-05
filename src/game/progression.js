// XP, levels and spending skill points.
//
// Levelling no longer interrupts play with a forced draft. It hands you points
// and a notification; you open the character sheet and spend them when you are
// somewhere safe enough to think about it.

import { xpForLevel } from './config.js';
import { G, notify } from './state.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import {
  ATTRS, PERKS_BY_ID, recomputeStats, canRaiseAttr, perkStatus, attrCost, perkCost,
} from './perks.js';
import { refreshAllSurvivors } from './survivors.js';

/** Points awarded for reaching a given level. Every fifth level pays double. */
export const pointsForLevel = (level) => (level % 5 === 0 ? 2 : 1);

export function addXp(amount, label = null) {
  const p = G.player;
  if (!p || amount <= 0) return;
  const gained = amount * (p.xpMul || 1);
  p.xp += gained;
  if (label) FX.text(p.x, p.y - 30, `+${Math.round(gained)} XP ${label}`, '#9fd0ff', 11, -38, 0.8);

  let levelled = 0;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = xpForLevel(p.level);
    p.skillPoints += pointsForLevel(p.level);
    levelled++;
  }
  if (levelled > 0) onLevelUp(p, levelled);
}

function onLevelUp(p, levels) {
  sfx('levelUp');
  FX.ring(p.x, p.y, 10, 130, 0.7, '#ffe08a', 3);
  FX.text(p.x, p.y - 46, `LEVEL ${p.level}`, '#ffe08a', 18, -28, 1.6);
  notify(
    `LEVEL ${p.level} — ${p.skillPoints} skill point${p.skillPoints === 1 ? '' : 's'} to spend (TAB)`,
    '#ffe08a', true,
  );
  void levels;
}

// ------------------------------------------------------------- spending ----

export function raiseAttribute(id) {
  const p = G.player;
  const check = canRaiseAttr(p, id);
  if (!check.ok) { sfx('deny'); notify(check.reason, '#c96a5a'); return false; }

  const hpBefore = p.maxHp;
  const stamBefore = p.maxStam;
  p.attrs[id] += 1;
  p.skillPoints -= attrCost();
  recomputeStats(p);
  // Survivors cache their stats from the player's multipliers, so Charisma has
  // to reach the people already standing in your base, not just the next hire.
  refreshAllSurvivors();
  // Gains in max health/stamina are handed over rather than left as headroom.
  p.hp += Math.max(0, p.maxHp - hpBefore);
  p.stam += Math.max(0, p.maxStam - stamBefore);

  sfx('craft');
  notify(`${ATTRS[id].name} ${p.attrs[id]}`, ATTRS[id].color);
  FX.ring(p.x, p.y, 8, 70, 0.45, ATTRS[id].color, 2);
  return true;
}

export function buyPerk(perkId) {
  const p = G.player;
  const perk = PERKS_BY_ID[perkId];
  if (!perk) return false;
  const st = perkStatus(p, perk);
  if (!st.ok) { sfx('deny'); notify(st.reason, '#c96a5a'); return false; }

  const hpBefore = p.maxHp;
  const stamBefore = p.maxStam;
  p.perks[perkId] = (p.perks[perkId] || 0) + 1;
  p.skillPoints -= perkCost();
  recomputeStats(p);
  refreshAllSurvivors();          // Inspiring Presence must reach the current crew
  p.hp += Math.max(0, p.maxHp - hpBefore);
  p.stam += Math.max(0, p.maxStam - stamBefore);

  sfx('craft');
  const rank = p.perks[perkId];
  notify(`${perk.name}${perk.max > 1 ? ` ${rank}/${perk.max}` : ''} — ${perk.desc}`, '#b7e08a');
  FX.ring(p.x, p.y, 8, 90, 0.5, '#b7e08a', 2);
  return true;
}

/** Total points a player has ever earned, for the character sheet. */
export function lifetimePoints(p) {
  let total = 0;
  for (let l = 2; l <= p.level; l++) total += pointsForLevel(l);
  return total;
}

export const spentPoints = (p) => lifetimePoints(p) - p.skillPoints;
