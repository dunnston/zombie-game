// Attributes and perk trees.
//
// Levelling grants skill points. A point buys either a rank in one of the six
// attributes, or a perk in that attribute's tree. Perks are gated on the rank
// of their parent attribute, so investing in an attribute opens its tree.
//
// Stats are rebuilt by a single pure recompute pass (base -> attributes ->
// perks) rather than by mutating the player when something is bought. That
// makes save/load, respawns and refunds trivially correct: there is exactly one
// place where a modifier can come from.

import { PLAYER } from './config.js';

export const ATTR_MIN = 1;
export const ATTR_MAX = 10;
export const ATTR_START = 2;

export const ATTRS = {
  str: {
    id: 'str', name: 'Strength', abbr: 'STR', color: '#d9765a',
    blurb: 'Swing harder, carry more.',
    perRank: '+9% melee · +25 carry · +6% chop',
  },
  per: {
    id: 'per', name: 'Perception', abbr: 'PER', color: '#6fb0c4',
    blurb: 'Steadier aim, sharper eyes, faster hands.',
    perRank: '-4% spread · -5% search time',
  },
  con: {
    id: 'con', name: 'Constitution', abbr: 'CON', color: '#7ec46a',
    blurb: 'More to lose before you lose it.',
    perRank: '+12 health · +10 stamina',
  },
  cha: {
    id: 'cha', name: 'Charisma', abbr: 'CHA', color: '#c48fd0',
    blurb: 'People will follow you, and fight for you.',
    perRank: '+1 slot per 2 ranks · +6% ally dmg',
  },
  int: {
    id: 'int', name: 'Intelligence', abbr: 'INT', color: '#d0c46a',
    blurb: 'Learn faster, build cheaper, wire better.',
    perRank: '+7% XP · -3% build cost · +5% turret',
  },
  lck: {
    id: 'lck', name: 'Luck', abbr: 'LCK', color: '#d0a05a',
    blurb: 'The world is kinder than it should be.',
    perRank: '+2% crit · +5% rare loot',
  },
};

export const ATTR_IDS = Object.keys(ATTRS);

/** A fresh attribute block. */
export const startingAttrs = () =>
  Object.fromEntries(ATTR_IDS.map((id) => [id, ATTR_START]));

// ------------------------------------------------------------------- perks --
// `req` is the rank needed in the parent attribute. `max` is how many times a
// perk can be taken. `apply(p, rank)` runs during recompute, never on purchase.

export const PERKS = [
  // ------------------------------------------------------------- STRENGTH --
  {
    id: 'packMule', attr: 'str', req: 2, max: 3, name: 'Pack Mule',
    desc: '+70 carry capacity per rank.',
    apply: (p, r) => { p.carryCap += 70 * r; },
  },
  {
    id: 'heavyHitter', attr: 'str', req: 3, max: 3, name: 'Heavy Hitter',
    desc: '+25% melee damage per rank.',
    apply: (p, r) => { p.meleeMul += 0.25 * r; },
  },
  {
    id: 'demolisher', attr: 'str', req: 5, max: 2, name: 'Demolisher',
    desc: 'Fell trees and salvage twice as fast per rank.',
    apply: (p, r) => { p.chopMul += 1.0 * r; },
  },
  {
    id: 'adrenaline', attr: 'str', req: 7, max: 1, name: 'Adrenaline',
    desc: 'Below a third health: +45% melee damage and +15% speed.',
    apply: (p) => { p.adrenaline = true; },
  },

  // ----------------------------------------------------------- PERCEPTION --
  {
    id: 'scrounger', attr: 'per', req: 2, max: 3, name: 'Scrounger',
    desc: '+35% resources from containers per rank.',
    apply: (p, r) => { p.lootMul += 0.35 * r; },
  },
  {
    id: 'quickHands', attr: 'per', req: 3, max: 2, name: 'Quick Hands',
    desc: '-30% search time and +18 pickup range per rank.',
    apply: (p, r) => { p.searchMul *= Math.pow(0.7, r); p.pickupRange += 18 * r; },
  },
  {
    id: 'eagleEye', attr: 'per', req: 4, max: 3, name: 'Eagle Eye',
    desc: '-22% weapon spread and +12% bullet range per rank.',
    apply: (p, r) => { p.spreadMul *= Math.pow(0.78, r); p.rangeMul += 0.12 * r; },
  },
  {
    id: 'sixthSense', attr: 'per', req: 6, max: 1, name: 'Sixth Sense',
    desc: 'Enemies show on the minimap much further out, even unaware ones.',
    apply: (p) => { p.radarMul += 1.4; },
  },

  // -------------------------------------------------------- CONSTITUTION --
  {
    id: 'thickSkin', attr: 'con', req: 2, max: 4, name: 'Thick Skin',
    desc: '+30 max health per rank.',
    apply: (p, r) => { p.maxHp += 30 * r; },
  },
  {
    id: 'marathon', attr: 'con', req: 3, max: 3, name: 'Marathon',
    desc: '+45 stamina and faster recovery per rank.',
    apply: (p, r) => { p.maxStam += 45 * r; p.stamRegen += 5 * r; },
  },
  {
    id: 'ironStomach', attr: 'con', req: 4, max: 2, name: 'Iron Stomach',
    desc: 'Medical supplies heal +60% and are used 30% faster per rank.',
    apply: (p, r) => { p.healMul += 0.6 * r; p.healSpeedMul *= Math.pow(0.7, r); },
  },
  {
    id: 'secondWind', attr: 'con', req: 6, max: 1, name: 'Second Wind',
    desc: 'Once every two minutes, a killing blow leaves you on 1 health instead.',
    apply: (p) => { p.secondWind = true; },
  },

  // ------------------------------------------------------------ CHARISMA --
  {
    id: 'recruiter', attr: 'cha', req: 2, max: 3, name: 'Recruiter',
    desc: '+1 survivor slot per rank.',
    apply: (p, r) => { p.survivorCap += r; },
  },
  {
    id: 'inspiring', attr: 'cha', req: 3, max: 2, name: 'Inspiring Presence',
    desc: 'Survivors gain +30% damage and +25% health per rank.',
    apply: (p, r) => { p.survivorDmgMul += 0.3 * r; p.survivorHpMul += 0.25 * r; },
  },
  {
    id: 'quartermaster', attr: 'cha', req: 4, max: 2, name: 'Quartermaster',
    desc: 'Survivors eat 40% fewer Rations per rank.',
    apply: (p, r) => { p.upkeepMul *= Math.pow(0.6, r); },
  },
  {
    id: 'leader', attr: 'cha', req: 6, max: 1, name: 'Natural Leader',
    desc: 'Survivors earn experience 60% faster and rally after a raid.',
    apply: (p) => { p.survivorXpMul += 0.6; },
  },

  // -------------------------------------------------------- INTELLIGENCE --
  {
    id: 'fastLearner', attr: 'int', req: 2, max: 3, name: 'Fast Learner',
    desc: '+22% experience from everything per rank.',
    apply: (p, r) => { p.xpMul += 0.22 * r; },
  },
  {
    id: 'engineer', attr: 'int', req: 3, max: 3, name: 'Engineer',
    desc: '-22% structure cost per rank.',
    apply: (p, r) => { p.buildCostMul *= Math.pow(0.78, r); },
  },
  {
    id: 'fortifier', attr: 'int', req: 4, max: 3, name: 'Fortifier',
    desc: '+45% structure health per rank.',
    apply: (p, r) => { p.structHpMul += 0.45 * r; },
  },
  {
    id: 'gunsmith', attr: 'int', req: 4, max: 2, name: 'Gunsmith',
    desc: 'Crafted ammo yields +60% per rank.',
    apply: (p, r) => { p.craftYieldMul += 0.6 * r; },
  },
  {
    id: 'fireControl', attr: 'int', req: 5, max: 2, name: 'Fire Control',
    desc: '+35% turret damage and range per rank.',
    apply: (p, r) => { p.turretMul += 0.35 * r; },
  },
  {
    id: 'hotwire', attr: 'int', req: 5, max: 2, name: 'Hotwire',
    desc: 'Start any locked car without a key. Rank 2 does it twice as fast.',
    apply: (p, r) => { p.hotwire = true; p.hotwireSpeedMul *= Math.pow(0.5, r - 1); },
  },

  // ----------------------------------------------------------------- LUCK --
  {
    id: 'scavengersLuck', attr: 'lck', req: 2, max: 3, name: "Scavenger's Luck",
    desc: '+30% chance of the rare entry in any loot roll, per rank.',
    apply: (p, r) => { p.rareLootMul += 0.3 * r; },
  },
  {
    id: 'luckyStrike', attr: 'lck', req: 3, max: 3, name: 'Lucky Strike',
    desc: '+7% critical hit chance per rank.',
    apply: (p, r) => { p.critChance += 0.07 * r; },
  },
  {
    id: 'ammoCache', attr: 'lck', req: 4, max: 2, name: 'Ammo Cache',
    desc: '20% chance per rank that a shot costs no ammunition.',
    apply: (p, r) => { p.freeShotChance += 0.2 * r; },
  },
  {
    id: 'lowProfile', attr: 'lck', req: 5, max: 2, name: 'Low Profile',
    desc: '-30% Threat generated and quieter gunfire per rank.',
    apply: (p, r) => { p.threatMul *= Math.pow(0.7, r); p.noiseMul *= Math.pow(0.7, r); },
  },
  {
    id: 'fortune', attr: 'lck', req: 7, max: 1, name: 'Fortune Favours',
    desc: 'Enemies drop twice as much, and containers can pay out twice.',
    apply: (p) => { p.doubleDropChance += 0.35; },
  },
];

export const PERKS_BY_ID = Object.fromEntries(PERKS.map((k) => [k.id, k]));
export const perksFor = (attr) => PERKS.filter((k) => k.attr === attr);

// ------------------------------------------------------------- stat rebuild --

/** Every modifier the game reads, at its untouched base value. */
export function baseStats() {
  return {
    maxHp: PLAYER.maxHp,
    maxStam: PLAYER.maxStam,
    stamRegen: PLAYER.stamRegen,
    carryCap: PLAYER.carryCap,
    pickupRange: PLAYER.pickupRange,

    meleeMul: 1, gunMul: 1, reloadMul: 1, fireRateMul: 1, spreadMul: 1,
    rangeMul: 1, chopMul: 1, critChance: 0.06, freeShotChance: 0,
    lootMul: 1, rareLootMul: 1, doubleDropChance: 0, searchMul: 1,
    buildCostMul: 1, structHpMul: 1, turretMul: 1, craftYieldMul: 1,
    healMul: 1, healSpeedMul: 1, speedMul: 1,
    threatMul: 1, noiseMul: 1, xpMul: 1, radarMul: 1,

    survivorCap: 0, survivorDmgMul: 1, survivorHpMul: 1, survivorXpMul: 1,
    upkeepMul: 1,

    adrenaline: false, secondWind: false,
    hotwire: false, hotwireSpeedMul: 1,
  };
}

function applyAttributes(p, attrs) {
  const r = (id) => (attrs[id] || ATTR_START) - 1;   // rank 1 is the baseline

  p.meleeMul += 0.09 * r('str');
  p.carryCap += 25 * r('str');
  p.chopMul += 0.06 * r('str');

  p.spreadMul *= Math.pow(0.96, r('per'));
  p.searchMul *= Math.pow(0.95, r('per'));
  p.pickupRange += 3 * r('per');

  p.maxHp += 12 * r('con');
  p.maxStam += 10 * r('con');

  p.survivorCap += Math.floor((attrs.cha || ATTR_START) / 2);
  p.survivorDmgMul += 0.06 * r('cha');

  p.xpMul += 0.07 * r('int');
  p.buildCostMul *= Math.pow(0.97, r('int'));
  p.turretMul += 0.05 * r('int');

  p.critChance += 0.02 * r('lck');
  p.rareLootMul += 0.05 * r('lck');
}

/**
 * Rebuilds every derived stat from scratch. Safe to call at any time — it is
 * the only place modifiers are produced.
 */
export function recomputeStats(p) {
  Object.assign(p, baseStats());
  applyAttributes(p, p.attrs);
  for (const perk of PERKS) {
    const rank = p.perks[perk.id] || 0;
    if (rank > 0) perk.apply(p, rank);
  }
  p.maxHp = Math.round(p.maxHp);
  p.maxStam = Math.round(p.maxStam);
  p.carryCap = Math.round(p.carryCap);
  if (p.hp > p.maxHp) p.hp = p.maxHp;
  if (p.stam > p.maxStam) p.stam = p.maxStam;
  return p;
}

// ---------------------------------------------------------------- purchases --

export function attrCost() { return 1; }
export function perkCost() { return 1; }

export function canRaiseAttr(p, id) {
  if (!ATTRS[id]) return { ok: false, reason: 'Unknown attribute' };
  if ((p.attrs[id] || 0) >= ATTR_MAX) return { ok: false, reason: 'Already at maximum' };
  if (p.skillPoints < attrCost()) return { ok: false, reason: 'No skill points' };
  return { ok: true, reason: '' };
}

export function perkStatus(p, perk) {
  const rank = p.perks[perk.id] || 0;
  if (rank >= perk.max) return { ok: false, reason: 'Fully learned', rank, locked: false };
  if ((p.attrs[perk.attr] || 0) < perk.req) {
    return { ok: false, reason: `Needs ${ATTRS[perk.attr].abbr} ${perk.req}`, rank, locked: true };
  }
  if (p.skillPoints < perkCost()) return { ok: false, reason: 'No skill points', rank, locked: false };
  return { ok: true, reason: '', rank, locked: false };
}
