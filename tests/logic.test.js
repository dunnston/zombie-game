// Pure-logic tests that run under `node --test` with no browser.
// Anything touching the DOM lives in tests/browser-smoke.js instead.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RES, WEAPONS, ENEMIES, STRUCTURES, RECIPES, UPGRADES, LOOT, CONTAINERS,
  BUILD_ORDER, THREAT, RAIDS, PLAYER, TILE, WORLD_TILES,
  bagWeight, xpForLevel, raidSpec,
} from '../src/game/config.js';
import { createWorld, isBlockedTile, dangerAtPx, locationAtPx, propAtTile, removeProp } from '../src/game/world.js';
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

test('upgrades are well formed and actually change a stat', () => {
  const ids = new Set();
  for (const u of UPGRADES) {
    assert.ok(!ids.has(u.id), `duplicate upgrade ${u.id}`);
    ids.add(u.id);
    assert.ok(u.max >= 1 && u.name && u.desc && u.cat);

    const before = fakePlayer();
    const after = fakePlayer();
    u.apply(after);
    assert.notDeepEqual(after, before, `${u.id} changed nothing`);
  }
  assert.ok(UPGRADES.length >= 12, 'the MVP wants at least 12 meaningful upgrades');
  const cats = new Set(UPGRADES.map((u) => u.cat));
  assert.deepEqual([...cats].sort(), ['BUILDING', 'COMBAT', 'SCAVENGING', 'SURVIVAL']);
});

function fakePlayer() {
  return {
    maxHp: 100, hp: 100, maxStam: 100, stam: 100, stamRegen: 20,
    meleeMul: 1, gunMul: 1, reloadMul: 1, fireRateMul: 1, spreadMul: 1,
    lootMul: 1, carryCap: 200, searchMul: 1, pickupRange: 46,
    buildCostMul: 1, structHpMul: 1, turretMul: 1,
    healMul: 1, healSpeedMul: 1, speedMul: 1, threatMul: 1, noiseMul: 1,
  };
}

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
