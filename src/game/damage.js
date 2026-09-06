// Central damage resolution for players, enemies and structures.
// Kept in its own module so combat/enemies/building never need to import
// each other.

import { PLAYER, THREAT } from './config.js';
import {
  G, notify, shake, screenFlash, removeStructure, isLocal, presentPlayers, baseOwner, structChanged,
} from './state.js';
import { emit } from '../net/events.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { addXp } from './progression.js';
import { addThreat } from './threat.js';
import { enemyDrop, dropBackpack } from './loot.js';
import { creditSurvivorKill } from './survivors.js';
import { exitVehicle } from './vehicles.js';
import { addQuiet } from './pressure.js';
import { clamp } from '../core/util.js';

// ------------------------------------------------------------------ enemies --

/** True if a damage source is a player object rather than a tag like 'turret'. */
const isPlayer = (source) => !!(source && typeof source === 'object' && source.intent);

/**
 * Kill experience. A player who lands the kill earns it. Anything automated —
 * a turret, a trap, a survivor's rifle — pays out to everyone present, because
 * the base is everyone's. In solo both rules are the same rule.
 */
function awardKillXp(source, xp) {
  if (isPlayer(source)) { addXp(source, xp); return; }
  for (const p of presentPlayers()) addXp(p, xp);
}

/**
 * @param {object} e       target enemy
 * @param {number} dmg     pre-mitigation damage
 * @param {object} opts    { fromX, fromY, knock, crit, silent, source }
 *                         `source` is the player object for a player's own
 *                         hits, or a tag ('turret', 'trap', 'car',
 *                         'survivor:<id>') for everything else.
 */
export function damageEnemy(e, dmg, opts = {}) {
  if (e.dead || dmg <= 0) return 0;
  const { fromX = e.x, fromY = e.y, knock = 0, crit = false, source = null } = opts;

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

export function killEnemy(e, source = null) {
  if (e.dead) return;
  e.dead = true;
  G.stats.kills++;

  FX.blood(e.x, e.y, 0, 0, 16);
  FX.decal(e.x, e.y, e.def.r * 1.4, '#4a1010');
  G.corpses.push({ x: e.x, y: e.y, angle: e.angle, type: e.type, t: 0, life: 45 });
  if (G.corpses.length > 90) G.corpses.shift();
  sfx('zombieDie');

  if (e.def.boss) { shake(9); FX.ring(e.x, e.y, 10, 160, 0.7, '#e05a4a', 4); }
  emit('edie', { id: e.id, x: Math.round(e.x), y: Math.round(e.y), tp: e.type, a: Math.round(e.angle * 100) / 100 });

  awardKillXp(source, e.def.xp * (G.raid ? 1.25 : 1));
  // A survivor who lands the kill earns the experience for it.
  creditSurvivorKill(source, e.def.xp);
  // Luck perks on the body's drop belong to whoever put it down.
  enemyDrop(e, isPlayer(source) ? source : baseOwner());
  if (!G.raid) addThreat(THREAT.killWalk * (e.def.threat || 0.4));
  // Only raiders count towards the raid. This used to tally every kill made
  // while a raid existed, which quietly meant three different things were wrong
  // together: the HUD could report more killed than the raid ever spawned, the
  // stall detector read ambient kills as progress and so kept a wedged raid
  // alive, and — once a broken-off raid started paying out by share killed —
  // farming the local wildlife bought salvage for raiders nobody fought.
  if (G.raid && e.raid) G.raid.killed++;

  // Clearing ground is supposed to buy you a breather there. Raid kills do not
  // count: a raid is already a bounded event, and letting it quieten your base
  // would hand you a free lull for surviving one.
  if (!e.raid) addQuiet(e.x, e.y);
}

// ------------------------------------------------------------------- player --

export function damagePlayer(p, amount, fromX, fromY, label = '') {
  if (!p || p.dead || p.downed || p.away || p.invuln > 0 || p.godMode) return 0;
  const local = isLocal(p);

  // recomputeStats sums the five equipment slots into armorDR — see perks.js.
  const dr = p.armorDR || 0;
  const dealt = Math.max(1, amount * (1 - dr));
  p.hp -= dealt;
  p.invuln = PLAYER.invulnAfterHit;
  p.hurtFlash = 0.35;
  p.lastHurt = 0;
  // Being hit interrupts searching, healing and reviving — no free looting mid-fight.
  p.searching = null;
  p.using = null;
  p.reviving = null;

  const dx = p.x - fromX, dy = p.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  p.vx += (dx / len) * 90;
  p.vy += (dy / len) * 90;

  FX.blood(p.x, p.y, dx / len, dy / len, 6, '#a02020');
  // The screen flash and the shake belong to the person who got hit.
  if (local) {
    screenFlash('#8c1a1a', clamp(dealt / 45, 0.18, 0.7));
    shake(2 + dealt * 0.08);
  }
  sfx('playerHurt');
  if (label) FX.text(p.x, p.y - 26, `-${Math.round(dealt)}`, '#ff8a7a', 13, -44, 0.7);

  // Second Wind (Constitution perk): one free survival on a long cooldown.
  if (p.hp <= 0 && p.secondWind && p.secondWindCd <= 0) {
    p.hp = 1;
    p.secondWindCd = 120;
    p.invuln = 1.4;
    FX.ring(p.x, p.y, 8, 130, 0.8, '#ffe08a', 4);
    FX.text(p.x, p.y - 34, 'SECOND WIND', '#ffe08a', 16, -30, 1.6);
    if (local) {
      screenFlash('#c8a24a', 0.6);
      shake(8);
      notify('Second Wind — you should not have survived that', '#ffe08a', true);
    }
    sfx('levelUp');
    return dealt;
  }

  if (p.hp <= 0) killPlayer(p);
  return dealt;
}

/** Teammates who could come and pick this player up. */
function helpersFor(p) {
  return G.players.filter((o) => o !== p && !o.away && !o.dead && !o.downed);
}

/**
 * The player runs out of health. With a teammate on their feet somewhere in
 * the world this is a countdown, not a death: they go down where they stand,
 * keep everything, and can be revived. Alone — or when the countdown runs out
 * (`force`) — it is the death it always was: drop the pack, respawn.
 */
export function killPlayer(p, force = false) {
  if (p.dead) return;
  const local = isLocal(p);

  if (!force && !p.downed && helpersFor(p).length > 0) {
    if (p.drivingId) exitVehicle(p);
    p.downed = true;
    p.downT = PLAYER.downedTime;
    p.hp = 0;
    p.reloading = null;
    p.searching = null;
    p.using = null;
    p.reviving = null;
    if (local) { G.ui.panel = null; G.ui.buildMode = false; }
    FX.blood(p.x, p.y, 0, 0, 14, '#a02020');
    if (local) { screenFlash('#7a1010', 0.7); shake(10); }
    sfx('playerDie');
    notify(
      local ? 'YOU ARE DOWN — a teammate can get you up' : `${p.name} is down!`,
      '#e05a4a', true,
    );
    return;
  }

  // Get out of the car first. Leaving drivingId set means updateVehicles keeps
  // syncing the corpse to the car through the death countdown, and then snaps
  // the respawned player straight back to it — ignoring their bedroll.
  if (p.drivingId) exitVehicle(p);

  p.dead = true;
  p.downed = false;
  p.hp = 0;
  p.respawnT = PLAYER.respawnTime;
  G.stats.deaths++;
  if (local) { G.ui.panel = null; G.ui.buildMode = false; }

  const pack = dropBackpack(p);
  FX.blood(p.x, p.y, 0, 0, 26, '#a02020');
  FX.decal(p.x, p.y, 22, '#4a1010');
  if (local) { screenFlash('#7a1010', 0.9); shake(14); }
  sfx('playerDie');
  if (local) notify(pack ? 'YOU DIED — your pack is marked on the map' : 'YOU DIED', '#e05a4a', true);
  else notify(`${p.name} died`, '#e05a4a', true);
}

export function healPlayer(p, amount) {
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
  structChanged(s);

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
  for (const p of G.players) {
    if (s.type !== 'bedroll' || p.spawnStructure !== s) continue;
    p.spawnStructure = null;
    p.spawnPoint = null;
    if (isLocal(p)) notify('Your bedroll was destroyed — respawn point lost', '#e05a4a');
  }
}
