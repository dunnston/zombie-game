// Pure-logic tests that run under `node --test` with no browser.
// Anything touching the DOM lives in tests/browser-smoke.js instead.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RES, WEAPONS, ENEMIES, STRUCTURES, RECIPES, LOOT, CONTAINERS, FURNISHING, CONSUMABLES, T,
  BUILD_ORDER, THREAT, RAIDS, PLAYER, TILE, WORLD_TILES,
  bagWeight, xpForLevel, raidSpec, GEAR, GEAR_SLOTS, ARMOR_SLOTS, MAX_GEAR_DR, STASH_SLOTS,
  ARMAMENTS, ARMAMENT_IDS, DEFAULT_ARMAMENT,
} from '../src/game/config.js';
import { createWorld, isBlockedTile, dangerAtPx, locationAtPx, propAtTile, removeProp } from '../src/game/world.js';
import { HARVEST, chopMultiplier, chopStamCost, canChop } from '../src/game/combat.js';
import {
  ATTRS, ATTR_IDS, ATTR_MAX, ATTR_START, PERKS, perksFor, perkStatus,
  canRaiseAttr, recomputeStats, startingAttrs,
} from '../src/game/perks.js';
import {
  darkness, phaseAt, clockString, nightFactors, DAY_LENGTH, PHASES,
} from '../src/game/daynight.js';
import { pointsForLevel } from '../src/game/progression.js';
import {
  SURVIVOR, JOBS, JOB_IDS, SCAVENGE, BUILDER, POST_RADIUS, canSeeContainer,
} from '../src/game/survivors.js';
import { G, equippedLight, lightActive, addRes, takeRes, countRes } from '../src/game/state.js';
import {
  makeStructure, repairCost, planRepairAll, isDamaged, costLabel, REPAIR_COST_SHARE, REPAIR_ALL_RANGE,
  buildMenu, buildBarLayout, withdrawSupplies, depositAll,
} from '../src/game/building.js';
import {
  ITEMS, makeSlots, slotsAdd, slotsTake, slotsCount, slotsWeight, stackLimit,
} from '../src/game/items.js';
import { makeRng, weightedPick, clamp, angleDelta, hash2, pruneInPlace, circleRectOverlap } from '../src/core/util.js';
import {
  ACTIONS, ACTION_BY_ID, codesFor, rebind, resetBinds, loadBinds, saveBinds, conflictsFor,
  keyLabel, isDefault, boundCodes, RESERVED,
} from '../src/core/bindings.js';
import {
  listSlots, createSlot, deleteSlot, renameSlot, defaultName, latestSlot, hasSave,
  migrateLegacy, saveGame, playtimeLabel, INDEX_KEY,
} from '../src/game/saves.js';
import { LEGACY_KEY, restoreSlots } from '../src/game/save.js';
import { makeNoise, NOISE } from '../src/game/noise.js';
import { FIRE, isFlammable } from '../src/game/fire.js';
import { readFileSync } from 'node:fs';

/** A localStorage stand-in for the Node tests: the same four calls, in memory. */
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

// ------------------------------------------------------------------- util ---

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});

test('angleDelta returns the shortest signed turn', () => {
  assert.ok(Math.abs(angleDelta(0, 0.1) - 0.1) < 1e-9);
  // Turning from +170deg to -170deg is a +20deg step, not -340deg.
  const d = angleDelta(Math.PI * 0.95, -Math.PI * 0.95);
  assert.ok(d > 0 && d < 0.4, `expected a small positive turn, got ${d}`);
});

test('makeRng is deterministic for a given seed', () => {
  const a = makeRng(1234);
  const b = makeRng(1234);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [makeRng(9999)(), 0, 0].slice(0, 1).concat([0, 0]));
});

test('hash2 is stable and inside [0,1)', () => {
  for (let i = 0; i < 50; i++) {
    const v = hash2(i, i * 7);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, hash2(i, i * 7));
  }
});

test('weightedPick respects weights', () => {
  const rng = makeRng(7);
  const table = [{ id: 'a', w: 0 }, { id: 'b', w: 100 }];
  for (let i = 0; i < 50; i++) assert.equal(weightedPick(table, rng).id, 'b');
  assert.equal(weightedPick([], rng), null);
});

test('pruneInPlace keeps order and removes matches', () => {
  const arr = [1, 2, 3, 4, 5, 6];
  pruneInPlace(arr, (n) => n % 2 === 0);
  assert.deepEqual(arr, [1, 3, 5]);
});

test('circleRectOverlap detects edge contact', () => {
  assert.equal(circleRectOverlap(0, 0, 10, 5, 5, 20, 20), true);
  assert.equal(circleRectOverlap(0, 0, 5, 50, 50, 20, 20), false);
});

// ----------------------------------------------------------- config sanity ---

test('every weapon is internally consistent', () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    assert.equal(w.id, id, `${id} has a mismatched id`);
    assert.ok(w.dmg > 0, `${id} deals no damage`);
    assert.ok(w.cd > 0, `${id} has no cooldown`);
    if (w.kind === 'gun') {
      assert.ok(w.mag > 0, `${id} has no magazine`);
      assert.ok(RES[w.ammo], `${id} uses unknown ammo ${w.ammo}`);
      assert.ok(w.reload > 0 && w.speed > 0 && w.life > 0, `${id} has bad ballistics`);
    } else {
      assert.ok(w.range > 0 && w.arc > 0, `${id} has no reach`);
    }
  }
});

test('weapon tiers actually improve on damage per second', () => {
  const dps = (w) => (w.kind === 'gun' ? (w.dmg * (w.pellets || 1)) / w.cd : w.dmg / w.cd);
  assert.ok(dps(WEAPONS.pipe) > dps(WEAPONS.fists), 'pipe should beat fists');
  assert.ok(dps(WEAPONS.machete) > dps(WEAPONS.pipe), 'machete should beat pipe');
  assert.ok(dps(WEAPONS.pistol) > dps(WEAPONS.pipe), 'a pistol should beat a pipe');
  assert.ok(dps(WEAPONS.carbine) > dps(WEAPONS.pistol), 'the carbine is the top tier');
});

test('enemy tiers escalate in threat', () => {
  const { walker, runner, brute, behemoth } = ENEMIES;
  assert.ok(runner.speed > walker.speed, 'runners must be faster than walkers');
  assert.ok(brute.hp > runner.hp * 3, 'brutes must be far tougher');
  assert.ok(behemoth.hp > brute.hp * 2, 'the behemoth is the wall');
  assert.ok(brute.xp > runner.xp && runner.xp > walker.xp, 'xp should track difficulty');
  // Only the heavies should be real wall-breakers.
  assert.ok(walker.structMul < 1 && runner.structMul < 1);
  assert.ok(brute.structMul > 2 && behemoth.structMul > brute.structMul);
});

test('structures have costs, health and a build-menu entry', () => {
  for (const [id, s] of Object.entries(STRUCTURES)) {
    assert.equal(s.id, id);
    assert.ok(s.hp > 0, `${id} has no health`);
    assert.ok(Object.keys(s.cost).length > 0, `${id} is free`);
    for (const r of Object.keys(s.cost)) assert.ok(RES[r], `${id} costs unknown resource ${r}`);
    assert.ok(BUILD_ORDER.includes(id), `${id} is missing from the build menu`);
  }
  for (const id of BUILD_ORDER) assert.ok(STRUCTURES[id], `build menu lists unknown ${id}`);
});

test('wall tiers get strictly tougher', () => {
  const hp = (id) => STRUCTURES[id].hp;
  assert.ok(hp('barricade') < hp('woodWall'));
  assert.ok(hp('woodWall') < hp('reinforcedWall'));
  assert.ok(hp('reinforcedWall') < hp('metalWall'));
});

test('every recipe is craftable from real resources and grants something', () => {
  const ids = new Set();
  for (const r of RECIPES) {
    assert.ok(!ids.has(r.id), `duplicate recipe id ${r.id}`);
    ids.add(r.id);
    assert.ok(r.bench >= 0 && r.bench <= 2, `${r.id} has a bad bench tier`);
    for (const c of Object.keys(r.cost)) assert.ok(RES[c], `${r.id} costs unknown ${c}`);
    const g = r.give;
    assert.ok(g.weapon || g.armor || g.item || g.res, `${r.id} grants nothing`);
    if (g.weapon) assert.ok(WEAPONS[g.weapon], `${r.id} grants unknown weapon`);
    if (g.res) for (const k of Object.keys(g.res)) assert.ok(RES[k], `${r.id} grants unknown ${k}`);
    assert.ok(r.xp > 0, `${r.id} gives no xp`);
  }
});

test('advanced gear is gated behind the upgraded workbench', () => {
  const byId = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
  for (const id of ['shotgun', 'rifle', 'carbine', 'heavyVest', 'milVest', 'sledge', 'smg']) {
    assert.equal(byId[id].bench, 2, `${id} should need Workbench II`);
  }
  assert.equal(byId.bandage.bench, 0, 'bandages must be craftable by hand');
});

test('every loot table entry references something real', () => {
  for (const [name, table] of Object.entries(LOOT)) {
    assert.ok(table.length > 0, `${name} is empty`);
    for (const e of table) {
      assert.ok(e.w > 0, `${name} has a zero-weight entry`);
      assert.ok(e.min > 0 && e.max >= e.min, `${name}/${e.id} has a bad range`);
      // Resolve every prefixed id against its actual registry. The old version
      // only checked the suffix was non-empty, which passed for any typo and
      // would have shipped a loot table entry that silently granted nothing.
      if (e.id.startsWith('weapon:')) assert.ok(WEAPONS[e.id.slice(7)], `${name}: unknown ${e.id}`);
      else if (e.id.startsWith('gear:')) assert.ok(GEAR[e.id.slice(5)], `${name}: unknown ${e.id}`);
      else if (e.id.startsWith('armor:')) assert.ok(GEAR[e.id.slice(6)], `${name}: unknown ${e.id}`);
      else if (e.id.startsWith('item:')) assert.ok(CONSUMABLES[e.id.slice(5)], `${name}: unknown ${e.id}`);
      else assert.ok(RES[e.id], `${name}: unknown resource ${e.id}`);
    }
  }
  for (const [name, c] of Object.entries(CONTAINERS)) {
    assert.ok(LOOT[c.table], `container ${name} points at missing table ${c.table}`);
    assert.ok(c.rolls[0] > 0 && c.rolls[1] >= c.rolls[0]);
  }
});

test('loot themes match their locations', () => {
  const has = (table, id) => LOOT[table].some((e) => e.id === id);
  assert.ok(has('toolbox', 'wood') && has('toolbox', 'scrap'), 'hardware should give building materials');
  assert.ok(has('pharmacy', 'med'), 'pharmacies should give medicine');
  assert.ok(has('policeLocker', 'ammoP'), 'police lockers should give ammo');
  assert.ok(has('militaryCrate', 'mil'), 'military crates should give military parts');
  assert.ok(has('electronics', 'elec'), 'parts bins should give electronics');
  // Military parts are the rare tier: they should not show up in starter loot.
  for (const t of ['cabinet', 'kitchen', 'toolbox', 'shelf', 'carTrunk']) {
    assert.ok(!has(t, 'mil'), `${t} should not contain military parts`);
  }
});

// ------------------------------------------------- attributes and perks ---

test('every attribute is described and distinct', () => {
  assert.equal(ATTR_IDS.length, 6);
  const abbrs = new Set();
  for (const id of ATTR_IDS) {
    const a = ATTRS[id];
    assert.equal(a.id, id);
    assert.ok(a.name && a.abbr && a.blurb && a.perRank, `${id} is missing copy`);
    assert.ok(!abbrs.has(a.abbr), `duplicate abbreviation ${a.abbr}`);
    abbrs.add(a.abbr);
  }
  assert.deepEqual([...ATTR_IDS].sort(), ['cha', 'con', 'int', 'lck', 'per', 'str']);
});

test('raising an attribute changes at least one derived stat', () => {
  for (const id of ATTR_IDS) {
    const base = recomputeStats(fakePlayer());
    const bumped = fakePlayer();
    bumped.attrs[id] = ATTR_START + 1;
    recomputeStats(bumped);
    assert.notDeepEqual(stripAttrs(bumped), stripAttrs(base), `${id} does nothing`);
  }
});

test('every perk is well formed and actually changes a stat', () => {
  const ids = new Set();
  for (const perk of PERKS) {
    assert.ok(!ids.has(perk.id), `duplicate perk ${perk.id}`);
    ids.add(perk.id);
    assert.ok(ATTRS[perk.attr], `${perk.id} hangs off unknown attribute ${perk.attr}`);
    assert.ok(perk.max >= 1 && perk.name && perk.desc, `${perk.id} is missing copy`);
    assert.ok(perk.req >= 1 && perk.req <= ATTR_MAX, `${perk.id} has an unreachable requirement`);

    const before = recomputeStats(fakePlayer());
    const after = fakePlayer();
    after.perks[perk.id] = 1;
    recomputeStats(after);
    assert.notDeepEqual(stripAttrs(after), stripAttrs(before), `${perk.id} changed nothing`);
  }
});

test('every attribute tree has perks across a spread of requirements', () => {
  for (const id of ATTR_IDS) {
    const tree = perksFor(id);
    assert.ok(tree.length >= 4, `${id} only has ${tree.length} perks`);
    const reqs = tree.map((k) => k.req);
    assert.ok(Math.min(...reqs) <= 2, `${id} has nothing available early`);
    assert.ok(Math.max(...reqs) >= 5, `${id} has nothing worth climbing for`);
  }
  assert.ok(PERKS.length >= 24, `only ${PERKS.length} perks`);
});

test('recomputing stats is idempotent', () => {
  const p = fakePlayer();
  p.attrs.str = 6;
  p.attrs.con = 5;
  p.perks.heavyHitter = 2;
  p.perks.thickSkin = 3;
  recomputeStats(p);
  const once = JSON.stringify(p);
  recomputeStats(p);
  recomputeStats(p);
  assert.equal(JSON.stringify(p), once, 'stats drifted when recomputed twice');
});

test('perk ranks stack', () => {
  const one = fakePlayer();
  one.attrs.str = 5;
  one.perks.heavyHitter = 1;
  recomputeStats(one);
  const three = fakePlayer();
  three.attrs.str = 5;
  three.perks.heavyHitter = 3;
  recomputeStats(three);
  assert.ok(three.meleeMul > one.meleeMul, 'rank 3 should beat rank 1');
});

test('perk purchase gating respects rank, cost and maximum', () => {
  const p = recomputeStats(fakePlayer());
  p.skillPoints = 0;
  const perk = PERKS.find((k) => k.attr === 'str' && k.req === 3) || PERKS[0];

  assert.equal(perkStatus(p, perk).ok, false, 'no points should block a purchase');
  p.skillPoints = 5;
  p.attrs[perk.attr] = 1;
  assert.equal(perkStatus(p, perk).ok, false, 'too low a rank should block a purchase');
  assert.equal(perkStatus(p, perk).locked, true);

  p.attrs[perk.attr] = perk.req;
  assert.equal(perkStatus(p, perk).ok, true, 'meeting the requirement should unlock it');

  p.perks[perk.id] = perk.max;
  assert.equal(perkStatus(p, perk).ok, false, 'a mastered perk cannot be bought again');
});

test('attributes cannot be raised past their ceiling', () => {
  const p = recomputeStats(fakePlayer());
  p.skillPoints = 50;
  p.attrs.str = ATTR_MAX;
  assert.equal(canRaiseAttr(p, 'str').ok, false);
  p.attrs.str = ATTR_MAX - 1;
  assert.equal(canRaiseAttr(p, 'str').ok, true);
  p.skillPoints = 0;
  assert.equal(canRaiseAttr(p, 'str').ok, false, 'no points, no rank');
});

test('Charisma is what gates the survivor roster', () => {
  const lonely = fakePlayer();
  lonely.attrs.cha = 1;
  recomputeStats(lonely);
  const popular = fakePlayer();
  popular.attrs.cha = ATTR_MAX;
  popular.perks.recruiter = 3;
  recomputeStats(popular);
  assert.ok(popular.survivorCap > lonely.survivorCap, 'Charisma must raise the cap');
  assert.ok(popular.survivorCap >= 5, `cap only reached ${popular.survivorCap}`);
});

test('levels pay out skill points, with a bonus every fifth', () => {
  assert.equal(pointsForLevel(2), 1);
  assert.equal(pointsForLevel(4), 1);
  assert.equal(pointsForLevel(5), 2);
  assert.equal(pointsForLevel(10), 2);
  let total = 0;
  for (let l = 2; l <= 20; l++) total += pointsForLevel(l);
  assert.ok(total >= 19 && total <= 30, `level 20 should feel earned, got ${total} points`);
});

function fakePlayer() {
  return { hp: 100, stam: 100, attrs: startingAttrs(), perks: {}, skillPoints: 0 };
}

/** Compare derived stats only — attrs/perks obviously differ between cases. */
function stripAttrs(p) {
  const { attrs, perks, skillPoints, hp, stam, ...rest } = p;
  void attrs; void perks; void skillPoints; void hp; void stam;
  return rest;
}

// ------------------------------------------------------------ day / night ---

test('the day curve is dark at night and clear at noon', () => {
  assert.ok(darkness(0.30).alpha < 0.02, 'noon should be fully lit');
  assert.ok(darkness(0.85).alpha > 0.6, 'the small hours should be dark');
  assert.ok(darkness(0.65).alpha > 0.05 && darkness(0.65).alpha < darkness(0.85).alpha,
    'dusk should be a ramp, not a step');
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const a = darkness(t).alpha;
    assert.ok(a >= 0 && a <= 1, `alpha out of range at t=${t.toFixed(2)}: ${a}`);
  }
});

test('night makes the town measurably worse', () => {
  const noon = nightFactors(0.30);
  const midnight = nightFactors(0.85);
  assert.ok(midnight.density > noon.density, 'more of them are out at night');
  assert.ok(midnight.sense > noon.sense, 'they notice you sooner at night');
  assert.ok(midnight.threat > noon.threat, 'noise carries further at night');
  assert.ok(noon.density <= 1.05 && noon.sense <= 1.05, 'daytime must be the baseline');
});

test('the clock reads sensibly across the day', () => {
  assert.equal(clockString(0), '06:00');
  assert.equal(clockString(0.25), '12:00');
  assert.equal(clockString(0.5), '18:00');
  assert.equal(clockString(0.75), '00:00');
  for (let t = 0; t < 1; t += 0.01) {
    assert.match(clockString(t), /^([01]\d|2[0-3]):[0-5]\d$/, `bad clock at ${t}`);
  }
});

test('phases cover the whole day with no gaps', () => {
  for (let t = 0; t < 1; t += 0.005) {
    const p = phaseAt(t);
    assert.ok(p && p.id, `no phase at ${t.toFixed(3)}`);
  }
  assert.equal(phaseAt(0.30).id, 'day');
  assert.equal(phaseAt(0.85).id, 'night');
  assert.ok(DAY_LENGTH > 120, 'a day should be long enough to plan around');
});

// -------------------------------------------------------------- survivors ---

test('survivors get meaningfully stronger with each level', () => {
  const hp = (lvl) => SURVIVOR.baseHp + SURVIVOR.hpPerLevel * (lvl - 1);
  const dmg = (lvl) => SURVIVOR.baseDmg + SURVIVOR.dmgPerLevel * (lvl - 1);
  assert.ok(hp(SURVIVOR.maxLevel) > hp(1) * 2, 'a veteran should be far tougher');
  assert.ok(dmg(SURVIVOR.maxLevel) > dmg(1) * 2, 'a veteran should hit far harder');
  assert.ok(SURVIVOR.range > 200 && SURVIVOR.range < 400, 'they should cover a base, not the map');
  assert.ok(SURVIVOR.reviveTime >= 5, 'you need time to reach someone who goes down');
  assert.ok(SURVIVOR.upkeepPerMin > 0, 'people have to eat for Quartermaster to matter');
});

test('Rations exist and are found where food would be', () => {
  assert.ok(RES.rations, 'Rations must be a real resource');
  const has = (table) => LOOT[table].some((e) => e.id === 'rations');
  assert.ok(has('kitchen'), 'kitchens should have food');
  assert.ok(has('shelf'), 'shops should have food');
  assert.ok(has('militaryCrate'), 'ration packs belong in military crates');
  assert.ok(!has('toolbox'), 'a toolbox is not a pantry');
  assert.ok(!has('policeLocker'), 'a gun locker is not a pantry');
});

test('the town is furnished with plenty to search', () => {
  const w = createWorld(20240917);
  const kinds = new Map();
  for (const c of w.containers) kinds.set(c.kind, (kinds.get(c.kind) || 0) + 1);
  assert.ok(kinds.size >= 20, `only ${kinds.size} kinds of searchable thing`);
  assert.ok(w.containers.length >= 250, `only ${w.containers.length} containers`);
  for (const k of ['bookshelf', 'dresser', 'wardrobe', 'fridge', 'desk', 'nightstand', 'toolrack']) {
    assert.ok((kinds.get(k) || 0) > 0, `no ${k} anywhere in town`);
  }
});

test('furniture loot reads true to the furniture', () => {
  const has = (table, id) => LOOT[table].some((e) => e.id === id);
  assert.ok(has('fridge', 'rations'), 'fridges hold food');
  assert.ok(!has('fridge', 'parts'), 'fridges do not hold weapon parts');
  assert.ok(has('wardrobe', 'cloth'), 'wardrobes hold clothes');
  assert.ok(has('toolrack', 'parts') && has('toolrack', 'scrap'), 'tool racks hold tools');
  assert.ok(has('footlocker', 'mil'), 'footlockers hold military kit');
  assert.ok(has('vanity', 'med'), 'bathrooms hold medicine');
  assert.ok(has('vending', 'rations'), 'vending machines hold food');
  // Every furnishing table must reference real content.
  for (const [name, list] of Object.entries(FURNISHING)) {
    assert.ok(list.length >= 4, `${name} has too few furnishing options`);
    for (const [kind, weight] of list) {
      assert.ok(CONTAINERS[kind], `${name} furnishes with unknown ${kind}`);
      assert.ok(weight > 0, `${name}/${kind} has no weight`);
    }
  }
});

test('bunks and watchtowers are real, purposeful structures', () => {
  assert.equal(STRUCTURES.bunk.houses, 1, 'a bunk sleeps one person');
  assert.ok(STRUCTURES.bunk.cost.wood > 0);
  assert.equal(STRUCTURES.watchtower.post, 'sniper');
  assert.ok(STRUCTURES.watchtower.sniperRange > 400, 'a tower must actually extend reach');
  assert.ok(STRUCTURES.watchtower.sniperDmg > 1.5, 'a posted sniper must hit harder');
  assert.ok(BUILD_ORDER.includes('bunk') && BUILD_ORDER.includes('watchtower'));
});

test('the four survivor jobs are distinct and described', () => {
  assert.deepEqual(JOB_IDS.sort(), ['builder', 'guard', 'scavenger', 'sniper']);
  const shorts = new Set();
  for (const id of JOB_IDS) {
    const j = JOBS[id];
    assert.equal(j.id, id);
    assert.ok(j.name && j.desc && j.color, `${id} is missing copy`);
    assert.ok(!shorts.has(j.short), `duplicate job tag ${j.short}`);
    shorts.add(j.short);
  }
  assert.equal(JOBS.sniper.needs, 'watchtower', 'only the sniper needs a structure');
  // A sniper has to actually be on the tower to draw its stats.
  assert.ok(POST_RADIUS > 0 && POST_RADIUS < 100, `POST_RADIUS ${POST_RADIUS} is not a "standing on it" distance`);
  // Non-combat jobs need a give-up path, since there is no pathfinding.
  assert.ok(SCAVENGE.giveUpAfter > 0 && SCAVENGE.radius > 0);
  assert.ok(BUILDER.giveUpAfter > 0 && BUILDER.repairPerSec > 0);
  assert.ok(Object.keys(BUILDER.costPer100).length > 0, 'repairs must cost materials');
});

// ------------------------------------------------------------------ repair ---

/** A builder with no perks, standing at a point, carrying nothing. */
const repairer = (x = 0, y = 0) => ({ x, y, bag: {}, buildCostMul: 1 });

test('a repair bill scales with the damage and never comes free', () => {
  G.structures.length = 0;
  G.structGrid.clear();
  const p = repairer();
  const wall = makeStructure('woodWall', 10, 10);
  assert.equal(repairCost(wall, p), null, 'an intact piece has no bill');
  assert.equal(isDamaged(wall), false);

  wall.hp = wall.maxHp * 0.5;
  const half = repairCost(wall, p);
  assert.deepEqual(half, { wood: Math.round(STRUCTURES.woodWall.cost.wood * 0.5 * REPAIR_COST_SHARE) });
  wall.hp = 1;
  const wrecked = repairCost(wall, p);
  assert.ok(wrecked.wood > half.wood, `a wreck (${wrecked.wood}) costs more than a dent (${half.wood})`);
  assert.ok(wrecked.wood < STRUCTURES.woodWall.cost.wood, 'repairing is cheaper than rebuilding');

  // A scratch still costs one of the main material — never zero.
  wall.hp = wall.maxHp * 0.99;
  assert.deepEqual(repairCost(wall, p), { wood: 1 });

  // Perks that cut build cost cut the repair bill too.
  wall.hp = wall.maxHp * 0.5;
  const cheap = repairCost(wall, { ...p, buildCostMul: 0.5 });
  assert.ok(cheap.wood < half.wood, `${cheap.wood} should be under ${half.wood}`);
});

test('a scratched steel wall does not cost a weapon part', () => {
  G.structures.length = 0;
  G.structGrid.clear();
  const p = repairer();
  const steel = makeStructure('metalWall', 12, 10);
  steel.hp = steel.maxHp * 0.6;
  const bill = repairCost(steel, p);
  assert.ok(bill.scrap > 0, 'scrap is the main material');
  assert.equal(bill.parts, undefined, `parts should not be on the bill: ${JSON.stringify(bill)}`);
  assert.equal(costLabel(bill), `SCRP ${bill.scrap}`);
});

test('REPAIR ALL fixes the worst first and skips what you cannot pay for', () => {
  G.structures.length = 0;
  G.structGrid.clear();
  G.stash = {};
  const p = repairer(11 * TILE, 11 * TILE);
  const a = makeStructure('woodWall', 10, 10);
  const b = makeStructure('woodWall', 12, 10);
  const c = makeStructure('woodWall', 10, 12);
  const steel = makeStructure('metalWall', 12, 12);
  const far = makeStructure('woodWall', 10 + Math.ceil(REPAIR_ALL_RANGE / TILE) + 2, 10);
  a.hp = a.maxHp * 0.2;      // worst
  b.hp = b.maxHp * 0.6;
  c.hp = c.maxHp * 0.9;      // mildest
  steel.hp = steel.maxHp * 0.1;
  far.hp = 1;

  const empty = planRepairAll(p);
  assert.equal(empty.pieces.length, 4, 'the far wall is out of reach');
  assert.equal(empty.repairable, 0);
  assert.equal(empty.skipped, 4);

  // Enough wood for the two worst wood walls and not the third; no scrap at all.
  const costA = repairCost(a, p).wood, costB = repairCost(b, p).wood;
  G.stash.wood = costA + costB;
  const plan = planRepairAll(p);
  assert.deepEqual(plan.pieces.map((x) => x.s), [steel, a, b, c], 'most damaged first');
  assert.deepEqual(plan.pieces.map((x) => x.ok), [false, true, true, false]);
  assert.equal(plan.repairable, 2);
  assert.equal(plan.skipped, 2);
  assert.deepEqual(plan.cost, { wood: costA + costB }, 'the bill counts only what will be repaired');
});

test('the build bar never drops a card, whatever the window width', () => {
  // At 92px a 1400px window drew fourteen of sixteen cards; with a 60px floor
  // a 900px window still drew thirteen. The ones that fell off the end were
  // always the REPAIR and DEMOLISH tools. Wrapping is the rule now.
  const n = buildMenu().length;
  assert.equal(buildMenu().slice(-2).join(','), 'repair,demolish', 'the tools are last, so they are the first to be lost');
  for (let W = 640; W <= 2560; W += 20) {
    const { cols, rows, cw, gap } = buildBarLayout(W, n);
    assert.ok(cols * rows >= n, `${W}px: ${cols}×${rows} holds fewer than ${n} cards`);
    assert.ok(cols * (cw + gap) - gap <= W - 20, `${W}px: a row of ${cols}×${cw} does not fit`);
    assert.ok(cw >= 60 && cw <= 92, `${W}px: card width ${cw}`);
  }
  assert.equal(buildBarLayout(1400, n).rows, 1, 'a wide window keeps one row');
  assert.equal(buildBarLayout(900, n).rows, 2, 'a laptop split-screen wraps to two');
  assert.ok(buildBarLayout(1400, n).cw < 92, 'a 1400px window shrinks the cards rather than losing any');
});

test('a scavenger can see containers it stands beside', () => {
  // Every container marks its own tile blocked, so a sight ray run all the way
  // to the centre reports "blocked" for every container in the world — which
  // silently turned the scavenger's reachability preference into a no-op.
  const w = createWorld(20240917);
  G.world = w;
  const open = w.containers.filter((c) => !c.hidden);
  let visible = 0;
  for (const c of open) {
    if (canSeeContainer(c.x + 120, c.y, c)) visible++;
  }
  assert.ok(
    visible > open.length * 0.2,
    `only ${visible} of ${open.length} containers are visible from beside them`,
  );
  // And a container right under your nose is always workable.
  assert.equal(canSeeContainer(open[0].x + 8, open[0].y, open[0]), true);
});

test('the floodlight is a real, power-gated structure', () => {
  const f = STRUCTURES.floodlight;
  assert.ok(f, 'floodlight must exist');
  assert.equal(f.powered, true, 'it should need power');
  assert.ok(f.lightRadius > 100, 'it should actually light something');
  assert.equal(f.solid, false, 'you should be able to walk past your own lamp');
  assert.ok(BUILD_ORDER.includes('floodlight'));
});

test('xp curve rises and never stalls', () => {
  let last = 0;
  for (let l = 1; l <= 30; l++) {
    const need = xpForLevel(l);
    assert.ok(need > last, `level ${l} is not more expensive than ${l - 1}`);
    assert.ok(Number.isFinite(need));
    last = need;
  }
  // Early levels should come fast enough to teach the draft.
  assert.ok(xpForLevel(1) <= 90);
});

test('xp curve steepens instead of drifting up in a straight line', () => {
  const cum = (lv) => {
    let t = 0;
    for (let l = 1; l < lv; l++) t += xpForLevel(l);
    return t;
  };
  // The first playtest hit level 7 in about ten minutes, which spent the whole
  // attribute tree before the map had been seen. The first two levels should
  // still be quick...
  assert.ok(cum(3) < 500, `level 3 costs ${cum(3)}, which is not a quick start`);
  // ...and the climb after that has to actually bite. A curve close to linear
  // is what caused the problem: each level has to cost meaningfully more than
  // the whole run that preceded it by the time you are in double figures.
  assert.ok(cum(7) > 3500, `level 7 costs ${cum(7)}, still too cheap`);
  assert.ok(cum(10) > 4 * cum(7), 'the curve flattens out again after level 7');
  assert.ok(xpForLevel(10) > 5 * xpForLevel(3), 'late levels are not dearer than early ones');
});

// --------------------------------------------------------- items and gear ---

test('every resource stacks and has a weight', () => {
  for (const [id, r] of Object.entries(RES)) {
    assert.ok(r.stack > 0, `${id} has no stack size`);
    assert.ok(r.wt > 0, `${id} is weightless`);
    assert.ok(ITEMS[id], `${id} is missing from the item registry`);
    assert.equal(ITEMS[id].kind, 'res');
  }
});

test('gear covers all five armour slots at three tiers', () => {
  for (const slot of ARMOR_SLOTS) {
    const pieces = Object.values(GEAR).filter((g) => g.slot === slot);
    assert.ok(pieces.length >= 3, `${slot} has only ${pieces.length} pieces`);
    const drs = pieces.map((g) => g.dr).sort((a, b) => a - b);
    // Each tier has to be a real step up, or the slot is decoration.
    for (let i = 1; i < drs.length; i++) {
      assert.ok(drs[i] > drs[i - 1], `${slot} has two pieces with the same armour`);
    }
  }
});

test('a full set of the best gear stays under the armour cap', () => {
  let total = 0;
  for (const slot of ARMOR_SLOTS) {
    const best = Object.values(GEAR)
      .filter((g) => g.slot === slot)
      .reduce((a, b) => (b.dr > a.dr ? b : a));
    total += best.dr;
  }
  assert.ok(total <= MAX_GEAR_DR + 1e-9,
    `a full set reaches ${total.toFixed(2)}, over the ${MAX_GEAR_DR} cap`);
  // ...and is still worth chasing.
  assert.ok(total > 0.5, `a full set is only ${total.toFixed(2)} — not worth the hunt`);
});

test('the body slot still carries the most armour', () => {
  const bestOf = (slot) => Object.values(GEAR)
    .filter((g) => g.slot === slot)
    .reduce((a, b) => (b.dr > a.dr ? b : a)).dr;
  for (const slot of ARMOR_SLOTS) {
    if (slot === 'body') continue;
    assert.ok(bestOf('body') > bestOf(slot), `${slot} rivals the vest`);
  }
});

test('slot containers stack, split across slots and never exceed a stack', () => {
  const c = makeSlots(3);
  const limit = stackLimit('wood');
  // One slot holds exactly one stack.
  assert.equal(slotsAdd(c, 'wood', limit), limit);
  assert.equal(c.slots[0].n, limit);
  assert.equal(c.slots[1], null);
  // The next unit opens a second slot rather than over-filling the first.
  assert.equal(slotsAdd(c, 'wood', 1), 1);
  assert.equal(c.slots[0].n, limit);
  assert.equal(c.slots[1].n, 1);
  assert.equal(slotsCount(c, 'wood'), limit + 1);
  // A full container reports what actually fitted, so callers can spill it.
  slotsAdd(c, 'scrap', stackLimit('scrap'));
  const fitted = slotsAdd(c, 'cloth', 10);
  assert.equal(fitted, 0, 'a full container accepted something anyway');
});

test('taking from a slot container empties slots as it goes', () => {
  const c = makeSlots(4);
  slotsAdd(c, 'ammoP', 200);
  const before = slotsCount(c, 'ammoP');
  assert.equal(slotsTake(c, 'ammoP', 30), 30);
  assert.equal(slotsCount(c, 'ammoP'), before - 30);
  assert.equal(slotsTake(c, 'ammoP', 9999), before - 30, 'take reported more than it held');
  assert.equal(slotsCount(c, 'ammoP'), 0);
  assert.ok(c.slots.every((s) => !s), 'emptied stacks left rubbish behind');
});

test('weight counts ammo lighter than bulk, in slots too', () => {
  const a = makeSlots(10);
  const b = makeSlots(10);
  slotsAdd(a, 'wood', 40);
  slotsAdd(b, 'ammoP', 40);
  assert.ok(slotsWeight(b) < slotsWeight(a), 'ammo weighs as much as timber');
  assert.equal(slotsWeight(a), 40 * RES.wood.wt);
});

test('bagWeight counts ammo lighter than bulk materials', () => {
  assert.equal(bagWeight({ wood: 10 }), 10);
  assert.ok(bagWeight({ ammoP: 100 }) < bagWeight({ wood: 100 }));
  assert.equal(bagWeight({ notAResource: 999 }), 0);
});

// -------------------------------------------------------------- raid specs ---

test('raids escalate in size and reward', () => {
  for (let i = 1; i < RAIDS.length; i++) {
    assert.ok(RAIDS[i].base >= RAIDS[i - 1].base, `raid ${i} is not bigger`);
    assert.ok(RAIDS[i].xp > RAIDS[i - 1].xp, `raid ${i} is not worth more`);
  }
  assert.ok(RAIDS.length >= 3, 'the MVP needs at least three raid tiers');
  // Tier 1 must be walkers only; heavies arrive later.
  assert.deepEqual(Object.keys(RAIDS[0].mix), ['walker']);
  assert.ok('runner' in RAIDS[1].mix, 'raid 2 introduces runners');
  assert.ok('brute' in RAIDS[2].mix, 'raid 3 introduces brutes');
  for (const r of RAIDS) {
    const total = Object.values(r.mix).reduce((a, b) => a + b, 0);
    assert.ok(total > 0.9 && total < 1.1, `${r.name} mix should sum to ~1`);
    for (const k of Object.keys(r.mix)) assert.ok(ENEMIES[k], `${r.name} spawns unknown ${k}`);
    for (const k of Object.keys(r.reward)) assert.ok(RES[k], `${r.name} rewards unknown ${k}`);
  }
});

test('raidSpec keeps scaling past the authored list', () => {
  const last = RAIDS[RAIDS.length - 1];
  const beyond = raidSpec(RAIDS.length + 2);
  assert.ok(beyond.base > last.base);
  assert.ok(beyond.xp > last.xp);
  assert.equal(raidSpec(0), RAIDS[0]);
});

test('threat thresholds are ordered and reachable', () => {
  assert.deepEqual([...THREAT.warnAt].sort((a, b) => a - b), THREAT.warnAt);
  assert.ok(THREAT.warnAt[THREAT.warnAt.length - 1] < THREAT.max);
  assert.ok(THREAT.postRaidReset < THREAT.max);
  assert.ok(THREAT.decayPerSec > 0, 'lying low must lower threat');
  // A single loud act must not instantly summon a horde.
  assert.ok(THREAT.perGunshot * 3 < THREAT.max / 4);
});

// ------------------------------------------------------------------ world ---

test('the world generates a complete, playable map', () => {
  const w = createWorld(20240917);
  assert.equal(w.w, WORLD_TILES);
  assert.equal(w.tiles.length, WORLD_TILES * WORLD_TILES);
  assert.ok(w.containers.length > 150, `only ${w.containers.length} containers`);
  assert.ok(w.props.length > 400, `only ${w.props.length} props`);
  assert.ok(w.spawnTiles.length > 100, `only ${w.spawnTiles.length} spawn points`);
  assert.equal(w.locations.length, 18);
});

test('the country wraps the town with its own biomes', () => {
  const w = createWorld(20240917);
  const count = (t, rect) => {
    let n = 0;
    for (let y = rect[1]; y < rect[1] + rect[3]; y++) for (let x = rect[0]; x < rect[0] + rect[2]; x++) if (w.tiles[y * w.w + x] === t) n++;
    return n;
  };
  const rectOf = (id) => w.locations.find((l) => l.id === id).rect;
  // Farmland is tilled, the lake holds water, the forest is thick with trees.
  assert.ok(count(T.FIELD, rectOf('farms')) > 800, 'the farms have fields');
  assert.ok(count(T.WATER, rectOf('lake')) > 500, 'the lake has water in it');
  assert.ok(count(T.FENCE, rectOf('ranch')) > 60, 'the ranch has a fenced paddock');
  let pines = 0, forestTrees = 0;
  for (const p of w.props) {
    if (p.kind === 'pine') pines++;
    if ((p.kind === 'pine' || p.kind === 'tree') && p.ty < 62) forestTrees++;
  }
  assert.ok(pines > 500, `only ${pines} pines`);
  assert.ok(forestTrees > 1500, `the forest only has ${forestTrees} trees`);
  // The river runs the full height of the map, and both bridges cross it.
  for (let y = 0; y < w.h; y++) {
    let water = 0;
    for (let x = 40; x < 90; x++) if (w.tiles[y * w.w + x] === T.WATER) water++;
    const bridge = (y >= 105 && y <= 110) || (y >= 157 && y <= 163);
    if (bridge) assert.equal(water, 0, `row ${y} should be a bridge`);
    else assert.ok(water >= 4, `row ${y} has no river`);
  }
});

test('every district and nearly every container can be reached on foot from the camp', () => {
  const w = createWorld(20240917);
  const W = w.w;
  const seen = new Uint8Array(W * W);
  const q = [[160, 160]];
  seen[160 * W + 160] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
      const i = ny * W + nx;
      if (seen[i] || w.blocked[i]) continue;
      seen[i] = 1;
      q.push([nx, ny]);
    }
  }
  // Every location, including the ones across the river.
  for (const l of w.locations) {
    const [lx, ly, lw, lh] = l.rect;
    let n = 0;
    for (let y = ly; y < ly + lh; y++) for (let x = lx; x < lx + lw; x++) if (seen[y * W + x]) n++;
    assert.ok(n > 50, `${l.id} is cut off from the camp (${n} reachable tiles)`);
  }
  // Every container has a walkable neighbour you can search it from. (Two
  // corner pieces boxed in by their neighbours are reached diagonally.)
  const around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const cutOff = w.containers.filter((c) => !around.some(([dx, dy]) => seen[(c.ty + dy) * W + c.tx + dx]));
  assert.equal(cutOff.length, 0, `unreachable containers: ${cutOff.map((c) => `${c.kind}@${c.tx},${c.ty}`).join(' ')}`);
});

test('world edges are treated as blocked', () => {
  const w = createWorld(1);
  assert.equal(isBlockedTile(w, -1, 10), true);
  assert.equal(isBlockedTile(w, 10, WORLD_TILES + 5), true);
});

test('danger rises with distance from the safe districts', () => {
  const w = createWorld(20240917);
  const tierOf = (id) => {
    const l = w.locations.find((x) => x.id === id);
    return dangerAtPx(w, (l.rect[0] + l.rect[2] / 2) * TILE, (l.rect[1] + l.rect[3] / 2) * TILE);
  };
  assert.equal(tierOf('suburb'), 1);
  assert.equal(tierOf('commercial'), 2);
  assert.equal(tierOf('police'), 3);
  assert.equal(tierOf('hospital'), 3);
  assert.equal(tierOf('military'), 4);
  assert.equal(tierOf('farms'), 1);
  assert.equal(tierOf('forest'), 2);
  assert.equal(tierOf('heights'), 3);
  assert.equal(tierOf('downtown'), 4);
  // Deep in the forest, well away from the town, is still tier 2.
  assert.equal(dangerAtPx(w, 20 * TILE, 10 * TILE), 2);
});

test('every player spawn point is safe, open, low-danger ground', () => {
  const w = createWorld(20240917);
  for (const [tx, ty] of w.spawnTiles) {
    assert.equal(isBlockedTile(w, tx, ty), false, `spawn ${tx},${ty} is inside geometry`);
    assert.ok(dangerAtPx(w, tx * TILE, ty * TILE) <= 1, `spawn ${tx},${ty} is in a dangerous zone`);
  }
});

test('high-value districts carry their signature loot', () => {
  const w = createWorld(20240917);
  const inLoc = (c, id) => {
    const l = w.locations.find((x) => x.id === id);
    return c.tx >= l.rect[0] && c.ty >= l.rect[1] &&
      c.tx < l.rect[0] + l.rect[2] && c.ty < l.rect[1] + l.rect[3];
  };
  const mil = w.containers.filter((c) => inLoc(c, 'military') && c.table === 'militaryCrate');
  assert.ok(mil.length >= 10, `military checkpoint only has ${mil.length} crates`);
  const guns = w.containers.filter((c) => inLoc(c, 'police') && (c.table === 'gunSafe' || c.table === 'policeLocker'));
  assert.ok(guns.length >= 8, `police station only has ${guns.length} weapon caches`);
  const meds = w.containers.filter((c) => inLoc(c, 'hospital') && (c.table === 'pharmacy' || c.table === 'hospitalCrate'));
  assert.ok(meds.length >= 10, `hospital only has ${meds.length} medical caches`);
  const logs = w.containers.filter((c) => inLoc(c, 'lumber') && c.table === 'logPile');
  assert.ok(logs.length >= 12, `lumber camp only has ${logs.length} log piles`);
  const safes = w.containers.filter((c) => inLoc(c, 'downtown') && c.table === 'gunSafe');
  assert.ok(safes.length >= 2, `the bank only has ${safes.length} safes`);
  const guns2 = w.containers.filter((c) => inLoc(c, 'mall') && (c.table === 'gunSafe' || c.table === 'displaycase'));
  assert.ok(guns2.length >= 4, `the outfitters only has ${guns2.length} gun cases`);
});

test('locations are found by world position', () => {
  const w = createWorld(20240917);
  const l = w.locations.find((x) => x.id === 'police');
  const hit = locationAtPx(w, (l.rect[0] + 2) * TILE, (l.rect[1] + 2) * TILE);
  assert.equal(hit.id, 'police');
  assert.equal(locationAtPx(w, 60 * TILE, 290 * TILE), null);   // the south-west outskirts
});

test('chopping a tree frees the tile it was blocking', () => {
  const w = createWorld(20240917);
  const tree = [...w.propGrid.values()].find((p) => p.kind === 'tree' || p.kind === 'pine');
  const key = `${tree.tx},${tree.ty}`;
  assert.ok(tree, 'expected at least one harvestable tree');
  assert.equal(isBlockedTile(w, tree.tx, tree.ty), true);
  assert.equal(propAtTile(w, tree.tx, tree.ty), tree);

  removeProp(w, tree);
  assert.equal(isBlockedTile(w, tree.tx, tree.ty), false, 'the tile should be walkable now');
  assert.equal(propAtTile(w, tree.tx, tree.ty), null);
  assert.ok(w.chopped.includes(key), 'the harvest should be recorded for the save file');
});

test('bushes and rocks are harvestable without blocking the ground', () => {
  const w = createWorld(20240917);
  const props = [...w.propGrid.values()];
  const bush = props.find((p) => p.kind === 'bush');
  const rock = props.find((p) => p.kind === 'rock');
  assert.ok(bush && rock, 'expected bushes and rocks in the prop grid');
  assert.equal(bush.harvest, 'fiber');
  assert.equal(rock.harvest, 'stone');
  assert.equal(isBlockedTile(w, bush.tx, bush.ty), false, 'a bush is walk-through');
  assert.equal(isBlockedTile(w, rock.tx, rock.ty), false, 'a rock is walk-through');
  // Breaking one must not free a tile something else is blocking.
  w.blocked[bush.ty * w.w + bush.tx] = 1;
  removeProp(w, bush);
  assert.equal(isBlockedTile(w, bush.tx, bush.ty), true, 'removing a bush must not clear an unrelated block');
  assert.equal(propAtTile(w, bush.tx, bush.ty), null);
  const trees = props.filter((p) => p.harvest === 'wood');
  assert.ok(trees.length > 1000 && props.length - trees.length > 500, `${trees.length} trees, ${props.length - trees.length} bushes and rocks`);
});

test('the hatchet is made by hand from what the scenery gives up', () => {
  const axe = RECIPES.find((r) => r.id === 'axe');
  assert.ok(axe && axe.bench === 0, 'the hatchet must be craftable without a workbench');
  for (const id of Object.keys(axe.cost)) {
    assert.ok(['sticks', 'stone', 'fiber'].includes(id), `hatchet costs ${id}, which needs an axe or a workbench to get`);
  }
  assert.ok(WEAPONS.axe.axe, 'the hatchet is the thing that fells trees');
  assert.ok(WEAPONS.axe.dmg < WEAPONS.machete.dmg, 'a tool, not the best weapon');
});

test('every hand tool is craftable from gathered materials alone', () => {
  const GATHERED = ['sticks', 'stone', 'fiber'];
  const byId = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
  for (const id of ['axe', 'pick', 'knife', 'hammer']) {
    const r = byId[id];
    assert.ok(r, `${id} has no recipe`);
    assert.equal(r.bench, 0, `${id} must be craftable without a workbench`);
    for (const c of Object.keys(r.cost)) {
      assert.ok(GATHERED.includes(c), `${id} costs ${c}, which cannot be gathered by hand`);
    }
    assert.ok(WEAPONS[r.give.weapon].tool, `${id} should be marked a tool`);
  }
  // Each tool is the best way to get one material and a poor weapon.
  assert.ok(WEAPONS.axe.axe && WEAPONS.pick.pick && WEAPONS.knife.knife && WEAPONS.hammer.hammer);
  for (const id of ['axe', 'pick', 'knife', 'hammer']) {
    assert.ok(WEAPONS[id].dmg < WEAPONS.machete.dmg, `${id} should not outfight a machete`);
  }
});

test('the small scenery is never gated, and the big scenery always is', () => {
  // The tools are made from what small scenery drops, so gating a loose rock
  // or a bush behind a tool would deadlock the opening. Every *big* source is
  // gated, which is the reason to carry the tool at all.
  for (const k of ['stone', 'fiber']) {
    assert.ok(!HARVEST[k].needs, `${k} must be gatherable with bare hands`);
  }
  assert.equal(HARVEST.wood.needs, 'axe');
  assert.equal(HARVEST.boulder.needs, 'pick');
  assert.equal(HARVEST.thicket.needs, 'scythe');
  // The boosted small source and the gated big source share a tool and a
  // resource, so the tool has one clear job.
  assert.equal(HARVEST.stone.boost, 'pick');
  assert.equal(HARVEST.fiber.boost, 'scythe');
  assert.equal(HARVEST.boulder.res, HARVEST.stone.res);
  assert.equal(HARVEST.thicket.res, HARVEST.fiber.res);
  for (const k of ['stone', 'fiber']) {
    assert.ok(WEAPONS[HARVEST[k].boost].toolMul > 1, `${k}'s tool should actually yield more`);
  }
  // A boulder must be worth the walk over the loose rock beside it.
  assert.ok(HARVEST.boulder.min > HARVEST.stone.max * 2, 'a boulder should dwarf a rock');
  assert.ok(HARVEST.thicket.min > HARVEST.fiber.max * 2, 'a thicket should dwarf a bush');
  // Every gate names a tool that exists and is craftable by hand.
  const byId = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
  for (const rule of Object.values(HARVEST)) {
    if (!rule.needs) continue;
    const tools = Object.values(WEAPONS).filter((wp) => wp[rule.needs]);
    assert.ok(tools.length, `nothing has the '${rule.needs}' flag`);
    // At least one, not the first one found: the metal tier carries the same
    // flags, and a gate is only open from the start if a *bench-0* tool has it.
    assert.ok(tools.some((wp) => byId[wp.id] && byId[wp.id].bench === 0),
      `every '${rule.needs}' tool needs a workbench, and the workbench needs wood`);
  }
});

test('a tree and a boulder are a job, and the metal tier halves it', () => {
  // The owner's note: "it is way too easy to mine trees and boulders". It was
  // literally one swing for a tree (70hp against 72 a swing), which made the
  // whole wood tier free and left the pickaxe with nothing to prove.
  const w = createWorld(20240917);
  const p = recomputeStats(fakePlayer());
  const swings = (prop, weapon) => {
    const rule = HARVEST[prop.harvest];
    return Math.ceil(prop.hp / (weapon.dmg * p.meleeMul * chopMultiplier(weapon, p, rule)));
  };
  const find = (kind) => [...w.propGrid.values()].find((q) => q.kind === kind);
  const tree = find('tree'), boulder = find('boulder'), thicket = find('thicket');

  const treeStone = swings(tree, WEAPONS.axe);
  const boulderStone = swings(boulder, WEAPONS.pick);
  assert.ok(treeStone >= 5 && treeStone <= 9, `${treeStone} Hatchet swings to fell a tree — should be 5–9`);
  assert.ok(boulderStone >= 5 && boulderStone <= 9, `${boulderStone} Stone Pickaxe swings for a boulder — should be 5–9`);

  // The metal tier is the reason to keep scavenging scrap: same yield, about
  // half the time. Compare seconds, not swings — the metal tools swing faster.
  const secs = (prop, weapon) => swings(prop, weapon) * weapon.cd;
  const treeGain = secs(tree, WEAPONS.axe) / secs(tree, WEAPONS.fireaxe);
  const rockGain = secs(boulder, WEAPONS.pick) / secs(boulder, WEAPONS.steelpick);
  assert.ok(treeGain >= 1.7, `the Fire Axe is only ${treeGain.toFixed(2)}x the Hatchet on a tree`);
  assert.ok(rockGain >= 1.7, `the Steel Pickaxe is only ${rockGain.toFixed(2)}x the Stone one on a boulder`);

  // Thickets are deliberately left where they were — see tasks/todo.md. Fiber
  // is what the litter cut took most of, and there is no metal scythe yet.
  assert.ok(swings(thicket, WEAPONS.scythe) <= 3, 'a thicket should still be quick');
});

test('the metal tools upgrade the stone ones without replacing the opening', () => {
  const byId = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
  for (const [metal, stone, flag] of [['fireaxe', 'axe', 'axe'], ['steelpick', 'pick', 'pick']]) {
    const m = WEAPONS[metal], s = WEAPONS[stone], r = byId[metal];
    assert.ok(m && r, `${metal} needs a weapon and a recipe`);
    assert.ok(m[flag] && m.tool, `${metal} must carry the '${flag}' gate and read as a tool`);
    assert.equal(r.bench, 1, `${metal} belongs at the workbench, not on the second bench or in your hands`);
    assert.ok(m.chopMul > s.chopMul, `${metal} should out-chop the ${stone}`);
    assert.ok(m.dmg < WEAPONS.machete.dmg, `${metal} is a tool, not the best weapon in the game`);
    // Same yield: the upgrade buys back time, it does not inflate the economy.
    assert.equal(m.toolMul || 1, s.toolMul || 1, `${metal} must not out-yield the ${stone}`);
    // Made of things a workbench-owner has, never of the raw stuff that would
    // let it skip the stone tier entirely.
    for (const c of Object.keys(r.cost)) {
      assert.ok(!['sticks', 'fiber'].includes(c), `${metal} costs ${c}, which would make the stone tier skippable`);
    }
  }
});

test('every hand-gatherable prop has a harvest rule behind it', () => {
  // The first version shipped litter whose `harvest` key had no HARVEST entry,
  // so the prompt appeared, E did nothing, and nothing errored. A missing rule
  // is a silent no-op, which is the worst failure mode this project has.
  const w = createWorld(20240917);
  const kinds = new Map();
  for (const prop of w.propGrid.values()) {
    if (prop.hand) kinds.set(prop.harvest, (kinds.get(prop.harvest) || 0) + 1);
  }
  assert.ok(kinds.size >= 4, `only ${kinds.size} kinds of hand-gatherable thing`);
  for (const [key, n] of kinds) {
    const rule = HARVEST[key];
    assert.ok(rule, `${n} props harvest as '${key}', which has no HARVEST rule — E would do nothing`);
    assert.ok(RES[rule.res], `${key} yields '${rule.res}', which is not a resource`);
    assert.ok(rule.min > 0 && rule.max >= rule.min, `${key} has a bad yield range`);
    assert.ok(!rule.needs, `${key} is hand-gatherable, so it must not need a tool`);
  }
});

test('there is something to pick up where the player wakes up', () => {
  // The tool tier is unplayable if the raw material is not underfoot: the first
  // playtest found no sticks, stone or fiber at all, because the town centre
  // was the thinnest ground on the map and the player starts in it.
  const w = createWorld(20240917);
  const camp = w.locations.find((l) => l.id === 'camp');
  const cx = camp.rect[0] + camp.rect[2] / 2, cy = camp.rect[1] + camp.rect[3] / 2;
  const within = (r) => {
    let n = 0;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const prop = propAtTile(w, x, y);
        if (prop && prop.hand) n++;
      }
    }
    return n;
  };
  // Enough of each kind to actually make the first tool (3 sticks, 3 stone, 4
  // fiber) — the real gate, and the one that must hold with room to spare.
  // Counting `min` yields only, so this is the worst roll of every pickup.
  const got = { sticks: 0, stone: 0, fiber: 0 };
  for (let y = Math.floor(cy - 15); y <= cy + 15; y++) {
    for (let x = Math.floor(cx - 15); x <= cx + 15; x++) {
      const prop = propAtTile(w, x, y);
      if (!prop || !prop.hand) continue;
      const rule = HARVEST[prop.harvest];
      if (rule && got[rule.res] !== undefined) got[rule.res] += rule.min;
    }
  }
  const axe = RECIPES.find((r) => r.id === 'axe');
  for (const [id, need] of Object.entries(axe.cost)) {
    assert.ok(got[id] >= need * 2,
      `only ${got[id]} ${id} within fifteen tiles of the camp, and a Hatchet needs ${need} — the opening should not be a search`);
  }

  // Coarse proxies for "you trip over something". These were 5 and 40 when the
  // map carried ~14,800 pieces of litter; that was the version the owner called
  // a carpet of sticks, so the thresholds came down with the density. The
  // material check above is what actually protects the first ten minutes.
  assert.ok(within(6) >= 2, `only ${within(6)} things to gather within six tiles of the camp`);
  assert.ok(within(15) >= 25, `only ${within(15)} within fifteen tiles`);
});

test('hand-gathered litter never blocks the ground it lies on', () => {
  const w = createWorld(20240917);
  const litter = [...w.propGrid.values()].filter((p) => p.kind === 'litter');
  // A budget with a ceiling, not just a floor. The first version of the litter
  // pass shipped ~14,800 pieces and the owner's note was "WAY too many sticks,
  // stones and fiber on the map" — the ground read as a carpet. Too little and
  // the opening stalls; too much and gathering is not a decision. Both ends
  // are the assertion.
  //
  // Cut a second time on 2026-09-07 (~4,250 -> ~2,370) after the owner said
  // there was still too much. The floor could come down this far only because
  // the opening is now protected directly by the starter cache in world.js
  // rather than by hoping the map-wide odds land near the camp.
  assert.ok(litter.length > 1800 && litter.length < 3200,
    `${litter.length} pieces of litter on a 320-tile map — the budget is 1,800–3,200`);
  assert.ok(litter.every((p) => !p.solid), 'litter must not be solid');
  assert.ok(litter.every((p) => !isBlockedTile(w, p.tx, p.ty)), 'litter must not block its tile');
});

test('harvesting never leaves an invisible wall behind', () => {
  const w = createWorld(20240917);
  const byKind = (k) => [...w.propGrid.values()].find((p) => p.kind === k);
  // Anything that claimed its tile must give it back when it is harvested.
  for (const kind of ['tree', 'pine', 'boulder']) {
    const prop = byKind(kind);
    assert.ok(prop, `no ${kind} in the world`);
    assert.equal(prop.solid, true, `${kind} should record that it claimed its tile`);
    assert.equal(isBlockedTile(w, prop.tx, prop.ty), true, `${kind} should block`);
    removeProp(w, prop);
    assert.equal(isBlockedTile(w, prop.tx, prop.ty), false,
      `harvesting a ${kind} left its tile blocked — an invisible permanent wall`);
  }
  // ...and anything that never claimed one must not free a tile it does not own.
  for (const kind of ['bush', 'rock', 'thicket']) {
    const prop = byKind(kind);
    assert.ok(!prop.solid, `${kind} should not claim its tile`);
    w.blocked[prop.ty * w.w + prop.tx] = 1;      // something else is standing here
    removeProp(w, prop);
    assert.equal(isBlockedTile(w, prop.tx, prop.ty), true,
      `harvesting a ${kind} cleared a tile that something else was blocking`);
  }
});

test('the crafting panel can reach every recipe, including the top tier', () => {
  // The panel is a fixed-height two-column grid. It used to render whatever
  // fitted and drop the rest, which silently hid every Workbench II recipe
  // once the tool recipes were added — no gun could be crafted at all.
  // These are the panel's own numbers from drawCraftPanel().
  const PANEL_H = 620, ROW_H = 52, CARD_H = 46, COLS = 2;
  const listTop = 90;                              // the worst case: bench upgrade row shown
  const listH = PANEL_H - 12 - listTop;
  const rows = Math.max(1, Math.floor(listH / ROW_H));
  const perPage = rows * COLS;
  const maxScroll = Math.max(0, Math.ceil(RECIPES.length / COLS) - rows);
  assert.ok(CARD_H <= ROW_H);
  // Either everything fits, or the list must be scrollable far enough to reach
  // the last recipe. The panel implements the second.
  const reachable = (maxScroll * COLS) + perPage;
  assert.ok(reachable >= RECIPES.length,
    `only ${reachable} of ${RECIPES.length} recipes are reachable`);
  const lastBench2 = RECIPES.map((r, i) => [i, r]).filter(([, r]) => r.bench === 2).pop();
  assert.ok(lastBench2, 'expected Workbench II recipes to exist');
  assert.ok(lastBench2[0] < reachable, `${lastBench2[1].id} sits past the end of the panel`);
});

test('the world carries big stone and big fiber, and both block nothing you need', () => {
  const w = createWorld(20240917);
  const props = [...w.propGrid.values()];
  const boulders = props.filter((p) => p.kind === 'boulder');
  const thickets = props.filter((p) => p.kind === 'thicket');
  assert.ok(boulders.length > 80, `only ${boulders.length} boulders`);
  assert.ok(thickets.length > 80, `only ${thickets.length} thickets`);
  assert.equal(boulders[0].harvest, 'boulder');
  assert.equal(thickets[0].harvest, 'thicket');
  // A boulder is an obstacle; a thicket is cover you can stand in.
  assert.ok(boulders.every((p) => isBlockedTile(w, p.tx, p.ty)), 'boulders should block');
  assert.ok(thickets.every((p) => !isBlockedTile(w, p.tx, p.ty)), 'thickets should not block');
  // They belong to the wild, not to the middle of town.
  const inTown = (p) => p.tx >= 86 && p.ty >= 86 && p.tx < 234 && p.ty < 234;
  assert.ok(boulders.filter(inTown).length < boulders.length * 0.5, 'boulders belong outside town');
});

test('a stone wall can be raised from gathered material only', () => {
  const wall = STRUCTURES.stoneWall;
  assert.ok(wall && wall.wall && wall.solid);
  for (const c of Object.keys(wall.cost)) {
    assert.ok(['stone', 'sticks', 'fiber'].includes(c), `stone wall costs ${c}`);
  }
  assert.ok(wall.hp > STRUCTURES.woodWall.hp, 'stone should be tougher than wood');
  assert.ok(wall.hp < STRUCTURES.reinforcedWall.hp, 'but not tougher than reinforced');
  assert.ok(BUILD_ORDER.includes('stoneWall'));
});

test('the hammer stands in for a bench only on simple work', () => {
  const hammered = RECIPES.filter((r) => r.hammer);
  assert.ok(hammered.length > 0, 'the hammer should unlock something');
  for (const r of hammered) {
    assert.equal(r.bench, 1, `${r.id} — the hammer must never reach Workbench II`);
    assert.ok(!r.give.weapon || WEAPONS[r.give.weapon].kind !== 'gun',
      `${r.id} — a hammer must not make a gun`);
  }
  // Cordage turns fiber into cloth, but needs a blade.
  const cord = RECIPES.find((r) => r.id === 'cordage');
  assert.equal(cord.tool, 'knife');
  assert.deepEqual(Object.keys(cord.cost), ['fiber']);
});

test('the world layout is pinned to the save version', () => {
  // A save replays `chopped` tile keys and restores structures against a world
  // rebuilt from its seed, so ANY change to the generator's RNG stream silently
  // corrupts existing saves: felled props come back, different ones vanish, and
  // a tree can regrow inside a wall the player built. Invariant 7.
  //
  // If you changed world generation on purpose, that is fine — bump
  // `G.version` in state.js and update this fingerprint in the same commit.
  // If you did not, something perturbed the shared rng and you have just
  // invalidated every save without saying so.
  const w = createWorld(20240917);
  let h = 2166136261;
  const mix = (n) => { h ^= n | 0; h = Math.imul(h, 16777619) >>> 0; };
  for (let i = 0; i < w.tiles.length; i += 97) mix(w.tiles[i]);
  mix(w.containers.length);
  for (const c of w.containers) { mix(c.tx); mix(c.ty); }
  mix(w.propGrid.size);
  for (const [key, prop] of w.propGrid) {
    for (let i = 0; i < key.length; i++) mix(key.charCodeAt(i));
    mix(prop.harvest ? prop.harvest.length : 0);
  }
  mix(w.vehicleSpawns.length);

  // Measured on the 2026-09-07 litter cut: containers, vehicles, tiles and
  // every non-litter prop came out byte-identical, so only the litter (and the
  // purely cosmetic reeds, which hold no tile) actually moved.
  const FINGERPRINT = 'cd427428';
  const SAVE_VERSION = 12;
  assert.equal((h >>> 0).toString(16), FINGERPRINT,
    `world generation changed. If that was deliberate, bump G.version (now ${G.version}) and this fingerprint together`);
  assert.equal(G.version, SAVE_VERSION,
    'the save version moved without the world fingerprint being rechecked');
});

test('world generation is deterministic for a seed', () => {
  const a = createWorld(4242);
  const b = createWorld(4242);
  assert.equal(a.containers.length, b.containers.length);
  assert.equal(a.props.length, b.props.length);
  assert.deepEqual(Array.from(a.tiles.slice(0, 5000)), Array.from(b.tiles.slice(0, 5000)));
});

// ----------------------------------------------------------------- player ---

test('player tuning keeps the fantasy intact', () => {
  assert.ok(PLAYER.speed > ENEMIES.walker.speed * 2, 'you must outrun a walker comfortably');
  assert.ok(PLAYER.speed * PLAYER.sprintMul > ENEMIES.runner.speed, 'sprinting must beat a runner');
  assert.ok(ENEMIES.runner.speed > PLAYER.speed * 0.6, 'runners still need to be scary');
  assert.ok(PLAYER.respawnTime <= 5, 'death should not mean waiting around');
  assert.ok(PLAYER.searchTime < 2, 'looting must stay snappy');
});

// ---------------------------------------------------------------- stamina ---

/** A fresh character with real derived stats, as recomputeStats builds them. */
function freshStats() {
  return recomputeStats({ attrs: startingAttrs(), perks: {}, hp: 100, stam: 0, equip: null });
}

test('a full bar is about three trees, and then a breather', () => {
  // The owner, after playing the tool tier: "Chopping should use significantly
  // more stamina. After chopping should have to wait a bit before the next
  // trees. Can maybe chop like 3 before having to wait for stamina to refill."
  //
  // Before this round a swing cost a flat 4, never set `stamLock`, and was
  // repaid in 0.2s at 20/s regen — so felling a 470hp tree was free.
  const p = freshStats();
  p.stam = p.maxStam;
  const axe = WEAPONS.axe;
  const perSwing = axe.dmg * p.meleeMul * chopMultiplier(axe, p, HARVEST.wood);
  const swingsPerTree = Math.ceil(470 / perSwing);
  const trees = p.maxStam / (swingsPerTree * chopStamCost(p));

  assert.equal(swingsPerTree, 6, `a tree is ${swingsPerTree} hatchet swings at starting stats`);
  assert.ok(trees >= 2.5 && trees < 4,
    `a full bar is ${trees.toFixed(2)} trees — the ask was about three`);

  // And the breather is a real pause, not a blink.
  const refill = PLAYER.stamChopDelay + p.maxStam / p.stamRegen;
  assert.ok(refill > 4 && refill < 12, `${refill.toFixed(1)}s to get back to full`);
});

test('work is gated by stamina and fighting never is', () => {
  const p = freshStats();
  p.stam = 0;
  assert.equal(canChop(p), false, 'an empty bar cannot harvest');
  p.stam = chopStamCost(p);
  assert.equal(canChop(p), true, 'exactly one swing left is still a swing');

  // Exhaustion latches. Measured in the browser: without this, a player who
  // held the button felled trees forever at a sixth of the speed, because
  // every regen tick bought exactly one more swing and there was never a
  // moment where you had to stop.
  p.winded = true;
  assert.equal(canChop(p), false, 'a winded player cannot dribble one swing per tick');
  p.stam = p.maxStam * PLAYER.stamWindedRecovery;
  p.winded = false;                       // movePlayer clears it at this point
  assert.equal(canChop(p), true, 'and back to half is back to work');
  assert.ok(PLAYER.stamWindedRecovery > 0.2 && PLAYER.stamWindedRecovery <= 0.75,
    'the recovery threshold has to be a real pause without being a punishment');

  // Fighting must never be refused: being winded may stop you working, but it
  // must not leave you unable to defend yourself.
  assert.ok(PLAYER.stamSwing < PLAYER.stamChop,
    'a combat swing has to be cheaper than a harvest swing');
  assert.ok(PLAYER.stamSwing * 20 < PLAYER.maxStam,
    'a fight must not be able to empty the bar in a few swings');
});

test('the metal tier buys endurance as well as time', () => {
  const p = freshStats();
  const swings = (w) => Math.ceil(470 / (w.dmg * p.meleeMul * chopMultiplier(w, p, HARVEST.wood)));
  const stone = swings(WEAPONS.axe) * chopStamCost(p);
  const metal = swings(WEAPONS.fireaxe) * chopStamCost(p);
  assert.ok(metal < stone, `a Fire Axe fells a tree for ${metal} stamina against the Hatchet's ${stone}`);
});

test('stamina is a stat you can raise, in ceiling and in recovery', () => {
  const base = freshStats();

  const tough = recomputeStats({ attrs: { ...startingAttrs(), con: 8 }, perks: {}, hp: 100, stam: 0, equip: null });
  assert.ok(tough.maxStam > base.maxStam, 'CON raises the ceiling');
  assert.ok(tough.stamRegen > base.stamRegen, 'CON raises recovery too — it did not before this round');

  const woody = recomputeStats({
    attrs: { ...startingAttrs(), con: 5 }, perks: { woodcraft: 2 }, hp: 100, stam: 0, equip: null,
  });
  assert.ok(chopStamCost(woody) < chopStamCost(base) * 0.5,
    'two ranks of Woodcraft roughly halve what a harvest swing costs');

  // recomputeStats is the only source of modifiers (invariant 4), so the cost
  // has to survive a rebuild rather than being mutated on purchase.
  const again = chopStamCost(recomputeStats(woody));
  assert.equal(again, chopStamCost(woody), 'recomputing is idempotent for the chop cost');
});

// -------------------------------------------------------------- armaments ---

test('every armament is buildable, feedable and describable', () => {
  assert.ok(ARMAMENT_IDS.length >= 4, 'there is a real choice to make');
  for (const id of ARMAMENT_IDS) {
    const a = ARMAMENTS[id];
    assert.ok(a.name && a.desc, `${id} says what it is`);
    assert.ok(a.dmg > 0 && a.cd > 0 && a.range > 0, `${id} has sane numbers`);
    assert.ok(a.noise > 0, `${id} makes some sound`);
    assert.ok(Object.keys(a.ammo).length > 0, `${id} costs something to fire`);
    for (const res of Object.keys(a.ammo)) {
      assert.ok(RES[res], `${id} feeds on '${res}', which is not a resource`);
    }
    if (id === DEFAULT_ARMAMENT) continue;
    assert.ok(a.cost && Object.keys(a.cost).length, `${id} has to be bought`);
    for (const res of Object.keys(a.cost)) assert.ok(RES[res], `${id} costs '${res}', which is not a resource`);
  }
});

test('arrows are free, and everything else is an upgrade', () => {
  // A tower you built must never be a thing that does nothing. The default is
  // the one that costs nothing to unlock and almost nothing to feed.
  assert.equal(ARMAMENTS[DEFAULT_ARMAMENT].cost, null);
  assert.equal(DEFAULT_ARMAMENT, 'arrows');
  for (const id of ARMAMENT_IDS) {
    if (id !== DEFAULT_ARMAMENT) assert.ok(ARMAMENTS[id].cost, `${id} should be bought, not given`);
  }
});

test('louder is stronger, which is the whole decision', () => {
  // The owner's framing: "The trade off is noise level vs effectiveness." So
  // the ordering by noise has to be an ordering by output too, or the choice
  // collapses into one obviously-best answer.
  //
  // Two armaments buy something other than raw impact, and the measure has to
  // know that or it punishes them for it:
  //
  //   - fire arrows hit SOFTER than plain ones; what they sell is the burn.
  //   - the cannon is deliberately worse than a sniper rifle one-on-one. It
  //     is artillery. Its 70px splash is the reason to own it, so it is
  //     measured against a modest crowd rather than a single walker.
  //
  // Measured single-target: arrows 0.80, fire 0.52, sniper 1.12, cannon 1.06.
  const CROWD = 2.5;                       // a conservative count of extra hits
  const dps = (a) => (a.dmg * (a.splash ? CROWD : 1)) / a.cd;
  const ladder = [...ARMAMENT_IDS]
    .filter((id) => !ARMAMENTS[id].burns)
    .sort((x, y) => ARMAMENTS[x].noise - ARMAMENTS[y].noise);
  for (let i = 1; i < ladder.length; i++) {
    const q = ARMAMENTS[ladder[i - 1]], l = ARMAMENTS[ladder[i]];
    assert.ok(dps(l) > dps(q),
      `${l.id} is louder than ${q.id} and must hit harder for it (${dps(l).toFixed(2)} vs ${dps(q).toFixed(2)})`);
  }
  // And the quiet end really is quiet: an arrow tower must be quieter than
  // the auto turret it exists as an alternative to.
  assert.ok(ARMAMENTS.arrows.noise < NOISE.turret);
  assert.ok(ARMAMENTS.cannon.noise > NOISE.turret, 'the cannon is the loudest thing you own');
  // And the cannon is the only one that hits a group, which is what it is for.
  assert.ok(ARMAMENTS.cannon.splash > 0);
  for (const id of ARMAMENT_IDS) {
    if (id !== 'cannon') assert.ok(!ARMAMENTS[id].splash, `${id} hits one thing`);
  }
});

// ------------------------------------------------------------------- fire ---

test('fire spreads to zombies and scenery, and never to your base', () => {
  // The owner chose this explicitly when asked how dangerous fire should be.
  // Losing your own compound to your own tower would be the kind of surprise
  // that ends a run, so the absence of a path from a fire to a structure is a
  // decision — this is the assertion that keeps it one.
  // Comments stripped first. The first version of this test matched the
  // sentence in fire.js explaining that it does not touch G.structures, which
  // is a nicely circular way to fail.
  const src = readFileSync(new URL('../src/game/fire.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(!/G\.structures/.test(src),
    'fire.js must not touch G.structures — player buildings do not burn, by choice');
  assert.ok(/G\.enemies/.test(src), 'but zombies do');
  assert.ok(/propAtTile|isFlammable/.test(src), 'and so does scenery');
});

test('only the things that should burn are flammable', () => {
  for (const kind of ['tree', 'pine', 'bush', 'thicket', 'litter']) {
    assert.ok(isFlammable({ kind }), `${kind} should burn`);
  }
  for (const kind of ['rock', 'boulder', 'silo', 'wreck', 'car']) {
    assert.ok(!isFlammable({ kind }), `${kind} must not burn`);
  }
  assert.ok(!isFlammable(null), 'and nothing is not something');
});

test('a fire is bounded in time and in number', () => {
  // A pine forest is thousands of trees. A fire with no ceiling would take the
  // frame rate with it, and one with no lifetime would never go out.
  assert.ok(FIRE.propLife > 2 && FIRE.propLife < 30, 'a burning tree burns out');
  assert.ok(FIRE.burnTime > 2 && FIRE.burnTime < 20, 'and so does a burning zombie');
  assert.ok(FIRE.maxFires > 40 && FIRE.maxFires < 400, `${FIRE.maxFires} concurrent fires is the budget`);
  assert.ok(FIRE.toEnemyChance > 0 && FIRE.toEnemyChance < 1, 'spread is a chance, not a certainty');
  assert.ok(FIRE.propSpreadChance < FIRE.toEnemyChance,
    'a fire should chase a crowd more readily than it eats a forest');
});

test('the fire armament is the one that burns', () => {
  assert.ok(ARMAMENTS.firearrows.burns, 'fire arrows set things alight');
  for (const id of ARMAMENT_IDS) {
    if (id !== 'firearrows') assert.ok(!ARMAMENTS[id].burns, `${id} must not start fires`);
  }
  // It pays for the crowd damage in raw hitting power...
  assert.ok(ARMAMENTS.firearrows.dmg < ARMAMENTS.arrows.dmg,
    'a fire arrow hits softer than a plain one — the burn is the damage');
  assert.ok(ARMAMENTS.firearrows.cd > ARMAMENTS.arrows.cd, '...and in cadence');
  // ...and it has to be worth it. A full burn is several shots' worth of
  // damage on its own, before any of it spreads.
  const burnTotal = FIRE.burnTime * FIRE.burnDps;
  assert.ok(burnTotal > 30, `a burn is only ${burnTotal} damage — not worth the fuel or the risk`);
  // It costs more to feed than a plain arrow, or it would simply be better.
  assert.ok(Object.keys(ARMAMENTS.firearrows.ammo).length > Object.keys(ARMAMENTS.arrows.ammo).length,
    'fire arrows have to cost more per shot than plain ones');
});

// ------------------------------------------------------------------ noise ---

/** Plants some enemies in G and returns them. */
function fakeHorde(spots) {
  G.enemies.length = 0;
  for (const [x, y] of spots) G.enemies.push({ x, y, dead: false, aggro: false, alertT: 0 });
  return G.enemies;
}

test('a sound is heard inside its radius and nowhere else', () => {
  const horde = fakeHorde([[0, 0], [100, 0], [400, 0], [900, 0]]);
  const heard = makeNoise(0, 0, 500);
  assert.equal(heard, 3, 'three inside 500px, one outside');
  assert.deepEqual(horde.map((e) => e.aggro), [true, true, true, false]);
  // The destination is the point of the whole thing.
  assert.equal(horde[0].noiseX, 0);
  assert.equal(horde[3].noiseX, undefined, 'the one that heard nothing has nowhere to go');
  G.enemies.length = 0;
});

test('a noise at the origin is still a noise', () => {
  // The branch in enemies.js tested `e.noiseX` for truthiness, so a sound at
  // exactly x = 0 was silently ignored. The map is 10,240px square and the
  // origin is a real corner of it.
  fakeHorde([[10, 10]]);
  makeNoise(0, 200, 500);
  assert.equal(G.enemies[0].noiseX, 0);
  assert.notEqual(G.enemies[0].noiseX, undefined);
  G.enemies.length = 0;
});

test('being quiet actually makes you quieter, whatever the source', () => {
  // `noiseMul` is what the Low Profile and Ghost perks buy. It only ever
  // applied to the player's own gunshot: the copy of this function in
  // vehicles.js ignored it, so a stealth build's car was exactly as loud.
  fakeHorde([[300, 0]]);
  assert.equal(makeNoise(0, 0, 400, { noiseMul: 1 }), 1);
  fakeHorde([[300, 0]]);
  assert.equal(makeNoise(0, 0, 400, { noiseMul: 0.5 }), 0, 'half as loud does not reach as far');
  G.enemies.length = 0;
});

test('the noise table ranks the way the trade-off needs it to', () => {
  // Quiet work, louder building, and the base's automated defences loudest of
  // all — that is the choice an arrow tower exists to offer.
  assert.ok(NOISE.chop < NOISE.build, 'an axe is quieter than a hammer');
  assert.ok(NOISE.build < NOISE.generator, 'a running generator carries further');
  assert.ok(NOISE.generator < NOISE.turret, 'a turret is the loudest thing you own');
  // And a gun is loud on the same scale, so the numbers are comparable.
  assert.ok(WEAPONS.pistol.noise > NOISE.build);
  assert.ok(WEAPONS.rifle.noise > WEAPONS.smg.noise, 'a rifle is louder than an SMG');
  for (const w of Object.values(WEAPONS)) {
    if (w.kind !== 'gun') continue;
    assert.ok(w.noise > 0, `${w.id} is a firearm and must make a sound`);
  }
});

// -------------------------------------------------------------------- bow ---

test('a bow is quiet and a gun is not', () => {
  const bow = WEAPONS.bow;
  assert.equal(bow.kind, 'gun', 'the bow rides the whole firearm path');
  assert.equal(bow.ammo, 'arrow');
  assert.ok(RES.arrow, 'arrows are a resource you can carry and craft');
  // The entire point of the weapon. It must be quieter than every firearm,
  // and by a wide margin, or "arrows are quiet" is a label rather than a rule.
  for (const w of Object.values(WEAPONS)) {
    if (w.kind !== 'gun' || w.bow) continue;
    assert.ok(bow.noise * 3 < w.noise, `a bow (${bow.noise}) must be far quieter than a ${w.id} (${w.noise})`);
    assert.ok(bow.threat < w.threat, `and draw less Threat than a ${w.id}`);
  }
});

test('one bullet does what several arrows do', () => {
  // The owner: "One bullet can kill the smaller zombies while it takes several
  // arrows." Measured against a walker, which is the small zombie.
  const walker = ENEMIES.walker.hp;
  const shots = (w) => Math.ceil(walker / w.dmg);
  const arrows = shots(WEAPONS.bow);
  assert.ok(arrows >= 3, `a walker should take at least three arrows, not ${arrows}`);
  assert.equal(shots(WEAPONS.rifle), 1, 'a rifle round drops a walker outright');
  assert.ok(arrows > shots(WEAPONS.pistol), 'and a pistol still beats a bow shot for shot');
  // Damage per second, so the trade is paid for in more than one currency.
  const dps = (w) => w.dmg / w.cd;
  assert.ok(dps(WEAPONS.bow) < dps(WEAPONS.pistol) * 0.4,
    'a bow has to be much slower as well as weaker — quiet is what it sells');
});

test('arrows are made of what the ground gives up', () => {
  const r = RECIPES.find((x) => x.id === 'arrow');
  const bow = RECIPES.find((x) => x.id === 'bow');
  assert.ok(r && bow, 'both are craftable');
  assert.equal(r.bench, 0);
  assert.equal(bow.bench, 0, 'the quiet answer to a gun cannot be gated behind a bench');
  // This is the sink that justified cutting litter again: arrows cost the
  // three hand-gathered materials and nothing else, and you burn them forever.
  for (const id of Object.keys(r.cost)) {
    assert.ok(['sticks', 'stone', 'fiber'].includes(id), `arrows should not cost ${id}`);
  }
  assert.ok(r.give.res.arrow >= 5, 'and a craft has to be worth the trip');
});

// ---------------------------------------------------------------- storage ---

test('every container holds a fixed number of slots, and the stash is the biggest', () => {
  const stores = Object.values(STRUCTURES).filter((s) => s.store);
  assert.ok(stores.length >= 3, 'there is a real storage ladder, not one box');
  for (const s of stores) {
    assert.ok(Number.isInteger(s.store) && s.store > 0, `${s.id} has a sane slot count`);
    assert.ok(s.protect, `${s.id} should count as base infrastructure`);
  }
  // The stash is the only container survivors and towers feed from, so running
  // out of room in it is a real consequence — it has to be the roomiest.
  assert.equal(STRUCTURES.stash.store, STASH_SLOTS);
  for (const s of stores) {
    if (s.id !== 'stash') assert.ok(s.store < STASH_SLOTS, `${s.id} must not out-hold the stash`);
  }
  // Cheap wood box, tougher metal one. Storage should be a build decision.
  assert.ok(STRUCTURES.chest.store < STRUCTURES.locker.store);
  assert.ok(STRUCTURES.chest.hp < STRUCTURES.locker.hp);
  for (const id of ['chest', 'locker']) assert.ok(BUILD_ORDER.includes(id), `${id} is on the build bar`);
});

test('the shared stash is a slot container, and a full one refuses politely', () => {
  const stash = makeSlots(4);
  // Four slots of scrap is 200; the 201st has nowhere to go and must be
  // reported as not taken rather than silently vanishing.
  assert.equal(addRes(stash, 'scrap', 300), 200);
  assert.equal(slotsCount(stash, 'scrap'), 200);
  assert.equal(addRes(stash, 'wood', 10), 0, 'a full container takes nothing more');
  assert.equal(takeRes(stash, 'scrap', 60), 60);
  assert.equal(addRes(stash, 'wood', 10), 10, 'and takes it again once there is room');
});

test('a stash full of junk really can starve your survivors', () => {
  // The owner chose this trade-off explicitly when asked. It is the whole
  // reason storage is worth building more of, so assert it rather than let a
  // later "fix" quietly restore an infinite pile.
  const stash = makeSlots(2);
  addRes(stash, 'scrap', 100);
  assert.equal(addRes(stash, 'rations', 5), 0, 'no room left for food');
  assert.equal(countRes(stash, 'rations'), 0);
});

test('a container round-trips through a save as slots', () => {
  const store = makeSlots(6);
  addRes(store, 'wood', 40);
  addRes(store, 'ammoP', 30);
  const saved = JSON.parse(JSON.stringify(store.slots));

  const restored = makeSlots(6);
  restoreSlots(restored, saved);
  assert.equal(countRes(restored, 'wood'), 40);
  assert.equal(countRes(restored, 'ammoP'), 30);

  // The sanitiser has to survive content changes: an id that no longer exists
  // becomes an empty slot, never a stack of nothing.
  const junk = makeSlots(3);
  restoreSlots(junk, [{ id: 'notAThing', n: 5 }, null, { id: 'wood', n: 2 }]);
  assert.equal(junk.slots[0], null);
  assert.equal(countRes(junk, 'wood'), 2);
});

test('the withdraw list is what you take out, not everything', () => {
  // Deposit-all then take-all must not be a loop: building material stays put.
  const store = makeSlots(10);
  addRes(store, 'wood', 50);
  addRes(store, 'ammoP', 40);
  addRes(store, 'arrow', 20);
  const p = { bag: makeSlots(20), hotbar: makeSlots(6), carryCap: 999 };
  withdrawSupplies(p, store);
  assert.equal(countRes(p.bag, 'ammoP'), 40, 'ammunition comes out');
  assert.equal(countRes(p.bag, 'arrow'), 20, 'so do arrows');
  assert.equal(countRes(p.bag, 'wood'), 0, 'building material does not');
  assert.equal(countRes(store, 'wood'), 50);
});

// ------------------------------------------------------------------ light ---

test('the off-hand is a gear slot and not an armour slot', () => {
  assert.ok(GEAR_SLOTS.includes('offhand'), 'the off-hand is a real equipment slot');
  assert.ok(!ARMOR_SLOTS.includes('offhand'), 'it carries no armour');
  assert.equal(GEAR_SLOTS.length, ARMOR_SLOTS.length + 1);
  // Only lights fit there, so nothing can quietly occupy the slot.
  for (const g of Object.values(GEAR)) {
    if (g.slot !== 'offhand') continue;
    assert.ok(g.light, `${g.id} is in the off-hand but casts no light`);
    assert.equal(g.dr, 0, `${g.id} must not be armour`);
  }
  assert.ok(Object.values(GEAR).some((g) => g.slot === 'offhand'),
    'the slot needs something to put in it');
});

test('a torch is made of what the ground is covered in, and burns itself up', () => {
  const r = RECIPES.find((x) => x.id === 'torch');
  assert.ok(r, 'there is a torch recipe');
  assert.equal(r.bench, 0, 'the first night cannot wait for a workbench');
  assert.deepEqual(Object.keys(r.cost).sort(), ['fiber', 'sticks'],
    'a torch costs only hand-gathered material');
  assert.equal(GEAR.torch.consumed, true, 'a torch is spent, not owned');
  assert.ok(GEAR.torch.burn > 60, 'and it lasts long enough to be worth making');
});

test('a flashlight reaches further than a torch, and costs batteries to do it', () => {
  const t = GEAR.torch.light, f = GEAR.flashlight.light;
  assert.ok(f.cone && !t.cone, 'the flashlight is a beam and the torch is a puddle');
  assert.ok(f.cone.len > t.radius * 1.5, 'the beam is the reason to want one');
  assert.equal(GEAR.flashlight.battery, 'battery');
  assert.ok(RES.battery, 'batteries are a real resource');
  assert.ok(!GEAR.flashlight.consumed, 'a flashlight is kept; only its charge runs out');

  // Findable before it is craftable, or the flashlight is a bench unlock
  // rather than something you scavenge your way into.
  const tables = Object.entries(LOOT).filter(([, t2]) => t2.some((e) => e.id === 'battery'));
  assert.ok(tables.length >= 4, `batteries appear in only ${tables.length} loot tables`);
});

test('a light only counts as lit when it is equipped, switched on and has charge', () => {
  const p = { equip: { offhand: null }, lightOn: true, lightFuel: 99 };
  assert.equal(lightActive(p), false, 'an empty off-hand casts nothing');
  p.equip.offhand = 'torch';
  assert.equal(lightActive(p), true);
  p.lightFuel = 0;
  assert.equal(lightActive(p), false, 'a spent torch casts nothing');
  p.lightFuel = 99; p.lightOn = false;
  assert.equal(lightActive(p), false, 'an unlit torch casts nothing');
  assert.equal(equippedLight(p).id, 'torch', 'but it is still what you are carrying');
});

test('being lit is being seen', () => {
  // Pillar 6: the only reason to carry a light at night is to see, so it has
  // to cost something. A player with no light must be no easier to notice.
  const dark = { equip: { offhand: 'torch' }, lightOn: false, lightFuel: 99 };
  const lit = { equip: { offhand: 'torch' }, lightOn: true, lightFuel: 99 };
  assert.equal(lightActive(dark), false);
  assert.equal(lightActive(lit), true);
});

// -------------------------------------------------------------- bindings ---

test('every action has a label, a group and at least one default key', () => {
  const ids = new Set();
  for (const a of ACTIONS) {
    assert.ok(a.id && a.label && a.group, `${a.id} is described`);
    assert.ok(Array.isArray(a.def) && a.def.length >= 1, `${a.id} has a default`);
    assert.ok(!ids.has(a.id), `${a.id} is unique`);
    ids.add(a.id);
    for (const c of a.def) assert.ok(!RESERVED.has(c), `${a.id} does not default to a reserved key`);
  }
  // The controls the README advertises are still the defaults.
  assert.deepEqual(codesFor('moveUp'), ['KeyW', 'ArrowUp']);
  assert.deepEqual(codesFor('interact'), ['KeyE']);
  assert.deepEqual(codesFor('slot3'), ['Digit3']);
});

test('rebinding replaces an action\'s keys, persists, and can be reset', () => {
  globalThis.localStorage = fakeStorage();
  resetBinds();
  assert.ok(rebind('moveRight', 'KeyL'));
  assert.deepEqual(codesFor('moveRight'), ['KeyL']);
  assert.ok(!isDefault('moveRight'));
  assert.ok(boundCodes().has('KeyL') && !boundCodes().has('KeyD'));
  // A fresh load reads it back over the defaults.
  resetBinds();
  assert.deepEqual(codesFor('moveRight'), ['KeyD', 'ArrowRight']);
  loadBinds();
  assert.deepEqual(codesFor('moveRight'), ['KeyL']);
  resetBinds();
  saveBinds();
  loadBinds();
  assert.ok(isDefault('moveRight'));
  delete globalThis.localStorage;
});

test('a key on two actions is reported as a conflict, not refused; Escape is refused', () => {
  globalThis.localStorage = fakeStorage();
  resetBinds();
  rebind('moveLeft', 'KeyL');
  rebind('moveRight', 'KeyL');
  assert.deepEqual(conflictsFor('moveRight'), ['moveLeft']);
  assert.deepEqual(conflictsFor('moveLeft'), ['moveRight']);
  assert.equal(conflictsFor('interact').length, 0);
  assert.equal(rebind('interact', 'Escape'), false);
  assert.deepEqual(codesFor('interact'), ['KeyE']);
  assert.equal(rebind('noSuchAction', 'KeyZ'), false);
  resetBinds();
  delete globalThis.localStorage;
});

test('a saved binding for an action that no longer exists is dropped, not crashed on', () => {
  globalThis.localStorage = fakeStorage();
  globalThis.localStorage.setItem('deadline.binds', JSON.stringify({
    moveUp: ['KeyT'], gone: ['KeyZ'], interact: ['Escape', 'KeyY'], craft: 'KeyC',
  }));
  loadBinds();
  assert.deepEqual(codesFor('moveUp'), ['KeyT']);
  assert.equal(codesFor('gone').length, 0);
  assert.deepEqual(codesFor('interact'), ['KeyY'], 'the reserved key is filtered out');
  assert.deepEqual(codesFor('craft'), ACTION_BY_ID.craft.def, 'a malformed entry keeps the default');
  resetBinds();
  delete globalThis.localStorage;
});

test('key labels read like a keyboard, not like event codes', () => {
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('ShiftLeft'), 'Left Shift');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('F5'), 'F5');
  assert.equal(keyLabel(null), '—');
});

// ------------------------------------------------------------- save slots ---

test('save slots are created, listed newest first, renamed and deleted', () => {
  globalThis.localStorage = fakeStorage();
  assert.equal(hasSave(), false);
  assert.equal(latestSlot(), null);
  assert.equal(defaultName('solo'), 'Game 1');
  const a = createSlot('First run', 'solo');
  const b = createSlot('', 'solo');
  assert.equal(b.name, 'Game 1', 'an empty name gets the first free default');
  assert.equal(defaultName('solo'), 'Game 2', 'and the next one moves on');
  assert.equal(defaultName('coop'), 'Co-op world 1');
  assert.ok(hasSave());
  assert.equal(listSlots().length, 2);
  // Touch b so it is the most recent; CONTINUE follows the *chosen* slot first
  // (what a load marks current), and only then the most recently written.
  b.updated = a.updated + 1000;
  globalThis.localStorage.setItem(INDEX_KEY, JSON.stringify({ v: 1, current: b.id, slots: [a, b] }));
  assert.equal(latestSlot().id, b.id);
  globalThis.localStorage.setItem(INDEX_KEY, JSON.stringify({ v: 1, current: a.id, slots: [a, b] }));
  assert.equal(latestSlot().id, a.id, 'the slot the player last picked wins over the one written last');
  globalThis.localStorage.setItem(INDEX_KEY, JSON.stringify({ v: 1, current: 'gone', slots: [a, b] }));
  assert.equal(latestSlot().id, b.id, 'a stale current falls back to the most recent');
  globalThis.localStorage.setItem(INDEX_KEY, JSON.stringify({ v: 1, current: b.id, slots: [a, b] }));
  assert.ok(renameSlot(a.id, 'Renamed'));
  assert.equal(listSlots().find((s) => s.id === a.id).name, 'Renamed');
  assert.ok(deleteSlot(b.id));
  assert.equal(listSlots().length, 1);
  assert.equal(latestSlot().id, a.id);
  assert.equal(deleteSlot('nope'), false);
  delete globalThis.localStorage;
});

test('the single pre-slot save is migrated into slot 1 and the old key removed', () => {
  globalThis.localStorage = fakeStorage();
  const legacy = { v: 6, seed: 42, time: 610, day: 3, stats: { kills: 17 }, player: { level: 5 } };
  globalThis.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
  assert.ok(migrateLegacy());
  const slots = listSlots();
  assert.equal(slots.length, 1);
  assert.equal(slots[0].name, 'Game 1');
  assert.equal(slots[0].day, 3);
  assert.equal(slots[0].level, 5);
  assert.equal(slots[0].kills, 17);
  assert.equal(slots[0].seed, 42);
  assert.equal(globalThis.localStorage.getItem(LEGACY_KEY), null, 'the old key is gone');
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('deadline.slot.' + slots[0].id)), legacy,
    'the payload is carried over untouched');
  assert.equal(migrateLegacy(), false, 'a second run finds nothing to do');
  delete globalThis.localStorage;
});

test('saving with no game refuses rather than writing an empty slot', () => {
  globalThis.localStorage = fakeStorage();
  G.world = null;
  assert.equal(saveGame(), false);
  assert.equal(listSlots().length, 0);
  delete globalThis.localStorage;
});

test('play time reads as minutes and hours', () => {
  assert.equal(playtimeLabel(0), '0m');
  assert.equal(playtimeLabel(47 * 60), '47m');
  assert.equal(playtimeLabel(2 * 3600 + 5 * 60), '2h 05m');
});

// ------------------------------------------------------------- networking ---

test('room codes use an unambiguous alphabet and normalise what a person types', async () => {
  const { makeCode, isCode } = await import('../server/signal.js');
  const { isRoomCode, normaliseCode, CODE_ALPHABET } = await import('../src/net/protocol.js');
  assert.ok(!/[01OI]/.test(CODE_ALPHABET), 'no 0/O/1/I');
  for (let i = 0; i < 200; i++) {
    const c = makeCode();
    assert.equal(c.length, 6);
    assert.ok(isCode(c) && isRoomCode(c), c);
  }
  assert.equal(normaliseCode(' ab-c2 d3 '), 'ABC2D3');
  assert.equal(isRoomCode('ABC0D3'), false, 'zero is not in the alphabet');
});

test('a guest on a different build is refused, and told what to run', async () => {
  const { joinRefusal, msg, PROTOCOL, BUILD, OUT_OF_DATE } = await import('../src/net/protocol.js');

  // What a current client actually sends is what the host actually accepts.
  const hello = msg.hello('someone', 'Ryan', null);
  assert.equal(hello.p, PROTOCOL);
  assert.equal(hello.b, BUILD);
  assert.equal(joinRefusal(hello.p, hello.b), null, 'the same build joins');

  // A different checkout of the game.
  assert.equal(joinRefusal(PROTOCOL, 'deadbee'), OUT_OF_DATE);

  // A client old enough to predate the build stamp sends no `b` at all. This
  // is the case that slipped through before: PROTOCOL stayed at 1 across the
  // map expansion, so the wire looked compatible when the world was not.
  assert.equal(joinRefusal(PROTOCOL, undefined), OUT_OF_DATE, 'a missing build is stale, not a pass');
  assert.equal(joinRefusal(PROTOCOL, ''), OUT_OF_DATE);
  assert.equal(joinRefusal(PROTOCOL, 7), OUT_OF_DATE, 'and neither is a non-string');

  // The original gate still fires.
  assert.equal(joinRefusal(PROTOCOL + 1, BUILD), OUT_OF_DATE);

  // 'dev' means "built without git", not "matches anything".
  assert.equal(joinRefusal(PROTOCOL, 'dev', 'dev'), null, 'two tarballs agree with each other');
  assert.equal(joinRefusal(PROTOCOL, 'dev', 'abc1234'), OUT_OF_DATE, 'unknown is not a wildcard');

  // The whole point of the message: it names the fix.
  assert.match(OUT_OF_DATE, /update\.sh/);
});

test('two dirty checkouts of the same commit do not share a build id', async () => {
  const { execSync } = await import('node:child_process');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { buildId } = await import('../scripts/build-id.mjs');

  const clean = execSync('git status --porcelain src/').toString().trim() === '';
  const before = buildId();

  // A bare `-dirty` suffix would collide here: same commit, different edits,
  // identical id — and joinRefusal would wave through exactly the mismatch it
  // exists to catch.
  const probe = 'src/__buildid_probe__.js';
  writeFileSync(probe, '// scratch\n');
  try {
    const withProbe = buildId();
    assert.notEqual(withProbe, before, 'an untracked source file changes the id');
    writeFileSync(probe, '// scratch, but different\n');
    assert.notEqual(buildId(), withProbe, 'different contents give a different id');
  } finally {
    unlinkSync(probe);
  }

  assert.equal(buildId(), before, 'and removing it puts the id back');
  if (clean) assert.ok(!/-dirty/.test(before), 'a clean tree has no dirty suffix');
});

test('an intent survives the wire: packed, unpacked, and merged without losing an edge', async () => {
  const { packIntent, unpackIntent, mergeIntent } = await import('../src/net/protocol.js');
  const { makeIntent } = await import('../src/game/intent.js');
  const it = makeIntent();
  it.mx = 0.6; it.my = -0.8; it.aimX = 1234.4; it.aimY = 88.6;
  it.sprint = true; it.fire = true; it.interact = true; it.slot = 3; it.wheel = -1;
  it.drive.left = true; it.drive.brake = true;
  const back = unpackIntent(JSON.parse(JSON.stringify(packIntent(it))), makeIntent());
  assert.equal(back.mx, 0.6); assert.equal(back.my, -0.8);
  assert.equal(back.aimX, 1234); assert.equal(back.aimY, 89);
  assert.ok(back.sprint && back.fire && back.interact && !back.sneak && !back.reload);
  assert.equal(back.slot, 3); assert.equal(back.wheel, -1);
  assert.ok(back.drive.left && back.drive.brake && !back.drive.forward);
  // A packet with the edge, then one without: the edge must still be seen once.
  const held = makeIntent();
  mergeIntent(held, packIntent(it));
  const later = makeIntent(); later.mx = 1;
  mergeIntent(held, packIntent(later));
  assert.equal(held.mx, 1, 'held state comes from the newest packet');
  assert.equal(held.interact, true, 'the earlier press is not lost');
  assert.equal(held.slot, 3, 'nor the slot change');
});

test('a late packet on the unordered channel contributes its edges and none of its held state', async () => {
  const { packIntent, mergeIntent, mergeLateIntent } = await import('../src/net/protocol.js');
  const { makeIntent } = await import('../src/game/intent.js');
  // The newest packet: E held mid-search, sprinting, driving forward, firing.
  const newest = makeIntent();
  newest.interactHeld = true; newest.sprint = true; newest.fire = true; newest.drive.forward = true; newest.mx = 1;
  const held = mergeIntent(makeIntent(), packIntent(newest));
  // Then an older one arrives: nothing held, but it carried a reload press and a slot change.
  const older = makeIntent();
  older.reload = true; older.slot = 2;
  mergeLateIntent(held, packIntent(older));
  assert.ok(held.interactHeld && held.sprint && held.fire && held.drive.forward, 'held state stays as the newest packet said');
  assert.equal(held.mx, 1, 'movement too');
  assert.equal(held.reload, true, 'the late press is still a press');
  assert.equal(held.slot, 2, 'and the late slot change lands when nothing newer chose one');
});

test('a snapshot describes only what is near the guest, and every player', async () => {
  const { packSnapshot, INTEREST_RADIUS } = await import('../src/net/protocol.js');
  const far = INTEREST_RADIUS * 2;
  const fakeG = {
    time: 10, day: 1, dayTime: 0.3, threat: 5, threatTier: 0, raid: null, raidsDone: 0, benchTier: 1,
    players: [
      { netId: 1, x: 0, y: 0, angle: 0, hp: 100, maxHp: 100, stam: 50, maxStam: 100, slot: 0, level: 1, xp: 0, xpNext: 55, skillPoints: 0 },
      { netId: 2, x: far, y: 0, angle: 0, hp: 100, maxHp: 100, stam: 50, maxStam: 100, slot: 0, level: 1, xp: 0, xpNext: 55, skillPoints: 0 },
    ],
    enemies: [
      { id: 1, type: 'walker', x: 100, y: 0, angle: 0, hp: 10, maxHp: 10, flash: 0 },
      { id: 2, type: 'walker', x: far, y: 0, angle: 0, hp: 10, maxHp: 10, flash: 0 },
      { id: 3, type: 'walker', x: 50, y: 0, angle: 0, hp: 10, maxHp: 10, flash: 0, dead: true },
    ],
    pickups: [{ uid: 7, x: 10, y: 10, kind: 'res', id: 'wood', n: 3 }, { uid: 8, x: far, y: 10, kind: 'res', id: 'wood', n: 3 }],
    vehicles: [{ id: 1, x: far, y: 100, angle: 0, hp: 1, fuel: 1 }],
    survivors: [], backpacks: [{ id: 'b1', x: 5, y: 5 }],
  };
  const s = packSnapshot(fakeG, fakeG.players[0], 42);
  assert.equal(s.q, 42);
  assert.equal(s.pl.length, 2, 'every player, near or far');
  assert.deepEqual(s.en.map((e) => e.id), [1], 'only the live enemy in range');
  assert.deepEqual(s.pk.map((p) => p.u), [7]);
  assert.equal(s.vh.length, 0, 'a far car is not described');
  assert.equal(s.bp.length, 1);
  // The same world seen by the far player describes the far things instead.
  const s2 = packSnapshot(fakeG, fakeG.players[1], 43);
  assert.deepEqual(s2.en.map((e) => e.id), [2]);
  assert.equal(s2.vh.length, 1);
});

test('password hashes compare equal for the same password and differ otherwise', async () => {
  const { hashPassword } = await import('../src/net/protocol.js');
  const a = await hashPassword('pumpkin'), b = await hashPassword('pumpkin'), c = await hashPassword('Pumpkin');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a.length >= 8);
});

test('a v6 save is wrapped into v8 with its one player under the host id', async () => {
  const { migrateSave } = await import('../src/game/save.js');
  const v6 = { v: 6, seed: 1, player: { x: 1, y: 2, level: 4, bag: [] }, carKeys: ['key1'], driving: null, structures: [] };
  const v8 = migrateSave(JSON.parse(JSON.stringify(v6)));
  assert.equal(v8.v, 8);
  assert.ok(v8.hostId && v8.players[v8.hostId], 'the host record exists');
  assert.equal(v8.players[v8.hostId].level, 4);
  assert.deepEqual(v8.players[v8.hostId].carKeys, ['key1'], 'car keys moved into the record');
  assert.equal(v8.player, undefined);
  assert.equal(v8.seed, 1);
  const already = { v: 8, players: {} };
  assert.equal(migrateSave(already), already, 'a v8 save passes through untouched');
});
