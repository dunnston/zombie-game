// Save format. The world is regenerated from its seed, so a save is just the
// deltas: what's been looted, what's been built, and who you are.
//
// This file only turns the game into data and data back into the game —
// serialiseGame() and applySaveData(). Where that data lives (which slot,
// which key) is saves.js's business, and a guest joining a hosted game will
// come in through applySaveData too, so the two can never drift.

import { G, structAt } from './state.js';
import { createWorld, removeProp } from './world.js';
import { createPlayer, pickRandomSpawn } from './player.js';
import { makeStructure } from './building.js';
import { recomputeStats, startingAttrs } from './perks.js';
import { makeSurvivor, refreshAllSurvivors } from './survivors.js';
import { spawnPickup } from './loot.js';
import { ITEMS, stackLimit } from './items.js';
import { GEAR, GEAR_SLOTS } from './config.js';
import { clamp } from '../core/util.js';
import { xpForLevel, TILE } from './config.js';

/**
 * Rebuilds a slot container from saved data, dropping anything the current
 * build no longer recognises and clamping stacks to today's limits — a save
 * must never be able to reintroduce a deleted item or an over-full stack.
 */
function restoreSlots(container, saved) {
  if (!Array.isArray(saved)) return;
  for (let i = 0; i < container.slots.length; i++) {
    const s = saved[i];
    if (!s || !s.id || !ITEMS[s.id]) { container.slots[i] = null; continue; }
    const n = Math.max(1, Math.min(stackLimit(s.id), Math.floor(s.n) || 1));
    container.slots[i] = { id: s.id, n };
  }
}
import { CAR, plantVehicleKeys, occupyTiles } from './vehicles.js';
import { serialisePressure, loadPressure } from './pressure.js';

// v5: furnishing changed how many containers each building gets, which shifts
// the ordinal container ids that `looted` is stored against. A v4 save loaded
// against a v5 world would mark unrelated furniture as searched and re-fill
// things you had already emptied, so those saves are retired rather than
// silently corrupted.
// v7: the player's pack, hotbar and five equipment slots replaced the four
// parallel collections (bag/items/weapons/armors) a v6 save records. There is
// no sensible way to place a v6 player's belongings into slots without
// guessing, so those saves are retired rather than half-restored.
// The single pre-slot save lived here. saves.js migrates it into slot 1.
export const LEGACY_KEY = 'deadline.save.v7';

/** Where a dead player would come back, and at what health. */
function resolveRespawn(p) {
  if (p.spawnStructure && !p.spawnStructure.destroyed) {
    return { x: p.spawnStructure.x, y: p.spawnStructure.y + TILE, hp: p.maxHp };
  }
  const spot = pickRandomSpawn();
  return { x: spot.x, y: spot.y, hp: p.maxHp };
}

/** The whole game as plain data. Throws only if there is no game to describe. */
export function serialiseGame() {
  {
    const p = G.player;
    // An autosave can land inside the death countdown. Persisting hp: 0 with no
    // death state would restore a player who is walking around dead, so resolve
    // the pending respawn at save time exactly as respawnPlayer would. The
    // backpack has already been dropped and is saved separately, so no
    // consequence is skipped.
    const resolved = p.dead || p.downed ? resolveRespawn(p) : { x: p.x, y: p.y, hp: p.hp };

    const data = {
      v: G.version,
      seed: G.world.seed,
      time: G.time,
      playtime: G.playtime || 0,
      threat: G.threat,
      raidsDone: G.raidsDone,
      benchTier: G.benchTier,
      stats: G.stats,
      stash: G.stash,
      stashItems: G.stashItems,
      tutorial: { step: G.tutorial.step, done: G.tutorial.done },
      looted: G.world.containers.filter((c) => c.looted).map((c) => c.id),
      chopped: G.world.chopped,
      day: G.day,
      dayTime: G.dayTime,
      rationDebt: G.rationDebt,
      // Cleared ground should still be clear after a reload; otherwise saving
      // beside your base hands the horde its opening back.
      quiet: serialisePressure(),
      survivorSeq: G.survivorSeq,
      survivors: G.survivors.filter((s) => !s.dead).map((s) => ({
        id: s.id, name: s.name, level: s.level, xp: s.xp, kills: s.kills,
        x: s.x, y: s.y, hp: s.hp, downed: s.downed, downT: s.downT,
        job: s.job,
        // Towers are stored by tile, since structure objects are rebuilt on load.
        tower: s.tower && !s.tower.destroyed ? { tx: s.tower.tx, ty: s.tower.ty } : null,
        // The source container is already recorded as looted, so a haul left out
        // of the save would simply cease to exist.
        carrying: s.carrying || null,
        carryItems: s.carryItems && s.carryItems.length ? s.carryItems : null,
        repairCredit: s.repairCredit || 0,
      })),
      rescues: G.rescues.map((r) => ({ x: r.x, y: r.y, name: r.name, level: r.level })),
      vehicleSeq: G.vehicleSeq,
      vehicles: G.vehicles.map((v) => ({
        id: v.id, x: Math.round(v.x), y: Math.round(v.y), angle: v.angle, si: v.si,
        hp: v.hp, fuel: v.fuel, locked: v.locked, keyId: v.keyId, hotwired: v.hotwired,
        destroyed: v.destroyed, trunk: v.trunk, tiles: v.tiles, keyHint: v.keyHint,
      })),
      carKeys: G.player.carKeys || [],
      driving: G.player.drivingId || null,
      discovered: G.world.locations.filter((l) => l.discovered).map((l) => l.id),
      structures: G.structures.map((s) => ({
        t: s.type, tx: s.tx, ty: s.ty, hp: s.hp, maxHp: s.maxHp,
        open: s.open, tier: s.tier, fuel: s.fuel, ammo: s.ammo, on: s.on, active: s.active,
      })),
      backpacks: G.backpacks.map((b) => ({ x: b.x, y: b.y, c: b.contents })),
      // Loose items on the ground are real progress — a scavenger's delivered
      // gear, loot that overflowed your pack, an enemy drop. Their source
      // containers are already recorded as looted, so dropping them from the
      // save would destroy them.
      pickups: G.pickups.map((it) => ({
        x: Math.round(it.x), y: Math.round(it.y), k: it.kind, i: it.id, n: it.n,
      })),
      player: {
        x: resolved.x, y: resolved.y, hp: resolved.hp, stam: p.stam,
        slot: p.slot, mag: p.mag,
        bag: p.bag.slots, hotbar: p.hotbar.slots, equip: p.equip,
        level: p.level, xp: p.xp, skillPoints: p.skillPoints,
        attrs: p.attrs, perks: p.perks, secondWindCd: p.secondWindCd,
        spawn: p.spawnStructure ? { tx: p.spawnStructure.tx, ty: p.spawnStructure.ty } : null,
      },
    };
    return data;
  }
}

/** Rebuilds G from save data. Returns false if the data is not usable. */
export function applySaveData(data) {
  if (!data || data.v !== G.version) return false;

  try {
    G.world = createWorld(data.seed);
    loadPressure(data.quiet, G.world);
    const lootedSet = new Set(data.looted || []);
    for (const c of G.world.containers) if (lootedSet.has(c.id)) c.looted = true;
    const discSet = new Set(data.discovered || []);
    for (const l of G.world.locations) if (discSet.has(l.id)) l.discovered = true;
    for (const key of data.chopped || []) {
      const prop = G.world.propGrid.get(key);
      if (prop) removeProp(G.world, prop);
    }

    G.enemies.length = 0;
    G.bullets.length = 0;
    G.pickups.length = 0;
    G.corpses.length = 0;
    G.structures.length = 0;
    G.structGrid.clear();
    G.backpacks.length = 0;

    G.time = data.time || 0;
    G.threat = data.threat || 0;
    G.raidsDone = data.raidsDone || 0;
    G.benchTier = data.benchTier || 0;
    G.stash = data.stash || {};
    G.stashItems = data.stashItems || {};
    G.stats = { kills: 0, looted: 0, built: 0, crafted: 0, deaths: 0, damageDealt: 0, ...(data.stats || {}) };
    G.tutorial = { step: data.tutorial?.step || 0, done: data.tutorial?.done || {}, hint: null };
    G.raid = null;

    const pd = data.player;
    const p = createPlayer(pd.x, pd.y);
    restoreSlots(p.bag, pd.bag);
    restoreSlots(p.hotbar, pd.hotbar);
    for (const slot of GEAR_SLOTS) {
      const id = pd.equip ? pd.equip[slot] : null;
      p.equip[slot] = GEAR[id] ? id : null;
    }
    p.slot = clamp(pd.slot || 0, 0, p.hotbar.slots.length - 1);
    p.mag = pd.mag || {};
    p.level = pd.level || 1;
    p.xp = pd.xp || 0;
    p.xpNext = xpForLevel(p.level);
    p.skillPoints = pd.skillPoints || 0;
    p.attrs = { ...startingAttrs(), ...(pd.attrs || {}) };
    p.perks = pd.perks || {};
    p.secondWindCd = pd.secondWindCd || 0;
    recomputeStats(p);
    // Belt and braces: never restore a player who is alive on zero health,
    // whatever an older or hand-edited save claims.
    p.hp = clamp(pd.hp ?? p.maxHp, 1, p.maxHp);
    p.dead = false;
    p.stam = Math.min(pd.stam ?? p.maxStam, p.maxStam);
    G.player = p;

    for (const s of data.structures || []) {
      const st = makeStructure(s.t, s.tx, s.ty, 1);
      if (!st) continue;
      st.maxHp = s.maxHp || st.maxHp;
      st.hp = Math.min(s.hp ?? st.maxHp, st.maxHp);
      st.open = !!s.open;
      st.tier = s.tier || 1;
      st.fuel = s.fuel || 0;
      st.ammo = s.ammo || 0;
      st.on = s.on !== false;
      st.active = !!s.active;
      if (s.t === 'bedroll' && pd.spawn && pd.spawn.tx === s.tx && pd.spawn.ty === s.ty) {
        p.spawnStructure = st;
        p.spawnPoint = { x: st.x, y: st.y + 32 };
      }
    }

    for (const b of data.backpacks || []) {
      G.backpacks.push({ x: b.x, y: b.y, contents: b.c, t: 0, id: Math.random() });
    }

    G.day = data.day || 1;
    G.dayTime = data.dayTime ?? 0.16;
    G.rationDebt = data.rationDebt || 0;
    G.survivorSeq = data.survivorSeq || 0;
    G.survivors.length = 0;
    for (const sv of data.survivors || []) {
      const s = makeSurvivor(sv.x, sv.y, {
        id: sv.id, name: sv.name, level: sv.level, recruited: true, job: sv.job,
      });
      s.xp = sv.xp || 0;
      s.kills = sv.kills || 0;
      s.downed = !!sv.downed;
      s.downT = sv.downT || 0;
      s.hp = Math.min(sv.hp ?? s.maxHp, s.maxHp);
      if (sv.tower) s.tower = structAt(sv.tower.tx, sv.tower.ty);
      if (s.job === 'sniper' && !s.tower) s.job = 'guard';
      s.carrying = sv.carrying || null;
      s.carryItems = sv.carryItems || null;
      s.repairCredit = sv.repairCredit || 0;
      G.survivors.push(s);
    }
    refreshAllSurvivors();
    G.rescues.length = 0;
    for (const r of data.rescues || []) G.rescues.push({ ...r, found: false });

    G.pickups.length = 0;
    for (const it of data.pickups || []) {
      spawnPickup(it.x, it.y, it.k, it.i, it.n);
    }

    // Cars, with whatever state they were left in.
    //
    // createWorld() re-blocks every car's *original* spawn footprint, but a car
    // may have been driven and parked somewhere else — or saved mid-drive with
    // no footprint at all. Without reconciling, the old spot keeps an invisible
    // obstacle and the car where it actually stands is not solid. So: clear
    // every generated footprint first, then let each parked car claim the tiles
    // it occupies now.
    for (const s of G.world.vehicleSpawns || []) {
      for (const [tx, ty] of s.tiles || []) {
        if (tx < 0 || ty < 0 || tx >= G.world.w || ty >= G.world.h) continue;
        G.world.blocked[ty * G.world.w + tx] = 0;
      }
    }

    G.vehicles.length = 0;
    G.vehicleSeq = data.vehicleSeq || 0;
    for (const vd of data.vehicles || []) {
      const v = {
        id: vd.id, x: vd.x, y: vd.y, angle: vd.angle || 0, si: vd.si || 0,
        vx: 0, vy: 0, speed: 0,
        hp: vd.hp, maxHp: CAR.maxHp, fuel: vd.fuel,
        locked: !!vd.locked, keyId: vd.keyId || null, hotwired: !!vd.hotwired,
        destroyed: !!vd.destroyed, trunk: vd.trunk || {}, tiles: [],
        keyHint: vd.keyHint, engineOn: false, flash: 0, headlights: true,
      };
      G.vehicles.push(v);
      if (!v.destroyed) occupyTiles(v);
    }
    // Key markers live on freshly generated container objects, so they have to
    // be re-planted after a load or every locked car becomes keyless.
    plantVehicleKeys();
    p.carKeys = data.carKeys || [];
    // Never restore mid-drive: it would need the car's tiles reconciled, and
    // stepping out on load is a kinder failure than waking up inside geometry.
    p.drivingId = null;

    G.camera.x = p.x;
    G.camera.y = p.y;
    G.playtime = data.playtime || 0;
    G.scene = 'game';
    G.paused = false;
    return true;
  } catch (err) {
    console.warn('[save] load failed', err);
    return false;
  }
}
