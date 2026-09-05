// Central damage resolution for players, enemies and structures.
// Kept in its own module so combat/enemies/building never need to import
// each other.

import { PLAYER, ARMORS, THREAT } from './config.js';
import { G, notify, shake, screenFlash, removeStructure } from './state.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { addXp } from './progression.js';
import { addThreat } from './threat.js';
import { enemyDrop, dropBackpack } from './loot.js';
import { clamp } from '../core/util.js';

// ------------------------------------------------------------------ enemies --

/**
 * @param {object} e       target enemy
 * @param {number} dmg     pre-mitigation damage
 * @param {object} opts    { fromX, fromY, knock, crit, silent, source }
 */
export function damageEnemy(e, dmg, opts = {}) {
  if (e.dead || dmg <= 0) return 0;
  const { fromX = e.x, fromY = e.y, knock = 0, crit = false, source = 'player' } = opts;

  e.hp -= dmg;
  e.flash = 0.11;
  e.aggro = true;
  e.target = null;              // re-evaluate: something just hurt it
  e.alertT = 6;
  G.stats.damageDealt += dmg;

  const dx = e.x - fromX, dy = e.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  if (knock > 0) {
    const k = knock * (1 - (e.def.knockResist || 0));
    e.vx += (dx / len) * k;
    e.vy += (dy / len) * k;
  }

  FX.blood(e.x, e.y, dx / len, dy / len, crit ? 12 : 7);
  FX.damageNumber(e.x, e.y - e.def.r, dmg, crit);

  if (e.hp <= 0) killEnemy(e, source);
  return dmg;
}

export function killEnemy(e, source = 'player') {
  if (e.dead) return;
  e.dead = true;
  G.stats.kills++;

  FX.blood(e.x, e.y, 0, 0, 16);
  FX.decal(e.x, e.y, e.def.r * 1.4, '#4a1010');
  G.corpses.push({ x: e.x, y: e.y, angle: e.angle, type: e.type, t: 0, life: 45 });
  if (G.corpses.length > 90) G.corpses.shift();
  sfx('zombieDie');

  if (e.def.boss) { shake(9); FX.ring(e.x, e.y, 10, 160, 0.7, '#e05a4a', 4); }

  addXp(e.def.xp * (G.raid ? 1.25 : 1), null);
  enemyDrop(e);
  if (!G.raid) addThreat(THREAT.killWalk * (e.def.threat || 0.4));
  if (G.raid) G.raid.killed++;
}

// ------------------------------------------------------------------- player --

export function damagePlayer(amount, fromX, fromY, label = '') {
  const p = G.player;
  if (!p || p.dead || p.invuln > 0 || p.godMode) return 0;

  const dr = p.armor && ARMORS[p.armor] ? ARMORS[p.armor].dr : 0;
  const dealt = Math.max(1, amount * (1 - dr));
  p.hp -= dealt;
  p.invuln = PLAYER.invulnAfterHit;
  p.hurtFlash = 0.35;
  p.lastHurt = 0;
  // Being hit interrupts searching and healing — no free looting mid-fight.
  p.searching = null;
  p.using = null;

  const dx = p.x - fromX, dy = p.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  p.vx += (dx / len) * 90;
  p.vy += (dy / len) * 90;

  FX.blood(p.x, p.y, dx / len, dy / len, 6, '#a02020');
  screenFlash('#8c1a1a', clamp(dealt / 45, 0.18, 0.7));
  shake(2 + dealt * 0.08);
  sfx('playerHurt');
  if (label) FX.text(p.x, p.y - 26, `-${Math.round(dealt)}`, '#ff8a7a', 13, -44, 0.7);

  if (p.hp <= 0) killPlayer();
  return dealt;
}

export function killPlayer() {
  const p = G.player;
  if (p.dead) return;
  p.dead = true;
  p.hp = 0;
  p.respawnT = PLAYER.respawnTime;
  G.stats.deaths++;
  G.ui.panel = null;
  G.ui.buildMode = false;

  const pack = dropBackpack(p);
  FX.blood(p.x, p.y, 0, 0, 26, '#a02020');
  FX.decal(p.x, p.y, 22, '#4a1010');
  screenFlash('#7a1010', 0.9);
  shake(14);
  sfx('playerDie');
  notify(pack ? 'YOU DIED — your pack is marked on the map' : 'YOU DIED', '#e05a4a', true);
}

export function healPlayer(amount) {
  const p = G.player;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount * p.healMul);
  const gained = p.hp - before;
  if (gained > 0) {
    FX.text(p.x, p.y - 24, `+${Math.round(gained)}`, '#7ce08a', 13, -40, 0.8);
    FX.ring(p.x, p.y, 6, 40, 0.4, '#7ce08a', 2);
    sfx('heal');
  }
  return gained;
}

// --------------------------------------------------------------- structures --

export function damageStructure(s, dmg, fromX = s.x, fromY = s.y) {
  if (!s || s.destroyed || dmg <= 0) return 0;
  s.hp -= dmg;
  s.flash = 0.12;
  s.lastHit = G.time;

  const dx = s.x - fromX, dy = s.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  FX.debris(s.x - (dx / len) * 12, s.y - (dy / len) * 12, 3, s.def.wall ? '#8a7350' : '#9aa2ab');
  sfx('structureHit');

  if (s.hp <= 0) destroyStructure(s);
  return dmg;
}

export function destroyStructure(s) {
  if (s.destroyed) return;
  s.destroyed = true;
  removeStructure(s);
  FX.debris(s.x, s.y, 20, s.def.wall ? '#8a7350' : '#9aa2ab');
  FX.smoke(s.x, s.y, 5);
  FX.decal(s.x, s.y, 16, '#2a251c');
  sfx('structureBreak');
  shake(4);
  if (G.raid) notify(`${s.def.name} destroyed!`, '#e05a4a');
  // Losing your bedroll costs you the respawn point.
  if (s.type === 'bedroll' && G.player && G.player.spawnStructure === s) {
    G.player.spawnStructure = null;
    G.player.spawnPoint = null;
    notify('Your bedroll was destroyed — respawn point lost', '#e05a4a');
  }
}
