// Pure-logic tests that run under `node --test` with no browser.
// Anything touching the DOM lives in tests/browser-smoke.js instead.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RES, WEAPONS, ENEMIES, STRUCTURES, RECIPES, LOOT, CONTAINERS, FURNISHING,
  BUILD_ORDER, THREAT, RAIDS, PLAYER, TILE, WORLD_TILES,
  bagWeight, xpForLevel, raidSpec,
} from '../src/game/config.js';
import { createWorld, isBlockedTile, dangerAtPx, locationAtPx, propAtTile, removeProp } from '../src/game/world.js';
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
import { G } from '../src/game/state.js';
import { makeRng, weightedPick, clamp, angleDelta, hash2, pruneInPlace, circleRectOverlap } from '../src/core/util.js';

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
      if (e.id.startsWith('weapon:')) assert.ok(WEAPONS[e.id.slice(7)], `${name}: unknown ${e.id}`);
      else if (e.id.startsWith('armor:')) assert.ok(e.id.slice(6).length > 0);
      else if (e.id.startsWith('item:')) assert.ok(e.id.slice(5).length > 0);
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
  assert.equal(w.locations.length, 9);
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
});

test('locations are found by world position', () => {
  const w = createWorld(20240917);
  const l = w.locations.find((x) => x.id === 'police');
  const hit = locationAtPx(w, (l.rect[0] + 2) * TILE, (l.rect[1] + 2) * TILE);
  assert.equal(hit.id, 'police');
  assert.equal(locationAtPx(w, 2 * TILE, 2 * TILE), null);
});

test('chopping a tree frees the tile it was blocking', () => {
  const w = createWorld(20240917);
  const key = [...w.propGrid.keys()][0];
  const tree = w.propGrid.get(key);
  assert.ok(tree, 'expected at least one harvestable tree');
  assert.equal(isBlockedTile(w, tree.tx, tree.ty), true);
  assert.equal(propAtTile(w, tree.tx, tree.ty), tree);

  removeProp(w, tree);
  assert.equal(isBlockedTile(w, tree.tx, tree.ty), false, 'the tile should be walkable now');
  assert.equal(propAtTile(w, tree.tx, tree.ty), null);
  assert.ok(w.chopped.includes(key), 'the harvest should be recorded for the save file');
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
