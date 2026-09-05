// LocalStorage save/load. The world is regenerated from its seed, so a save is
// just the deltas: what's been looted, what's been built, and who you are.

import { G, notify } from './state.js';
import { createWorld, removeProp } from './world.js';
import { createPlayer } from './player.js';
import { makeStructure } from './building.js';
import { reapplyUpgrades } from './progression.js';
import { bestArmor } from './loot.js';
import { xpForLevel } from './config.js';

const KEY = 'deadline.save.v3';

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function saveGame() {
  try {
    const p = G.player;
    const data = {
      v: G.version,
      seed: G.world.seed,
      time: G.time,
      threat: G.threat,
      raidsDone: G.raidsDone,
      benchTier: G.benchTier,
      stats: G.stats,
      stash: G.stash,
      stashItems: G.stashItems,
      tutorial: { step: G.tutorial.step, done: G.tutorial.done },
      looted: G.world.containers.filter((c) => c.looted).map((c) => c.id),
      chopped: G.world.chopped,
      discovered: G.world.locations.filter((l) => l.discovered).map((l) => l.id),
      structures: G.structures.map((s) => ({
        t: s.type, tx: s.tx, ty: s.ty, hp: s.hp, maxHp: s.maxHp,
        open: s.open, tier: s.tier, fuel: s.fuel, ammo: s.ammo, on: s.on, active: s.active,
      })),
      backpacks: G.backpacks.map((b) => ({ x: b.x, y: b.y, c: b.contents })),
      player: {
        x: p.x, y: p.y, hp: p.hp, stam: p.stam,
        weapons: p.weapons, slot: p.slot, mag: p.mag,
        bag: p.bag, items: p.items, armors: p.armors,
        level: p.level, xp: p.xp, pendingLevels: p.pendingLevels, upgrades: p.upgrades,
        spawn: p.spawnStructure ? { tx: p.spawnStructure.tx, ty: p.spawnStructure.ty } : null,
      },
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('[save] failed', err);
    return false;
  }
}

/** Rebuilds G from a save. Returns false if there was nothing usable. */
export function loadGame() {
  let data;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    data = JSON.parse(raw);
  } catch (err) {
    console.warn('[save] unreadable', err);
    return false;
  }
  if (!data || data.v !== G.version) return false;

  try {
    G.world = createWorld(data.seed);
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
    p.weapons = pd.weapons && pd.weapons.length ? pd.weapons : p.weapons;
    p.slot = Math.min(pd.slot || 0, p.weapons.length - 1);
    p.mag = pd.mag || {};
    p.bag = pd.bag || {};
    p.items = pd.items || {};
    p.armors = pd.armors || [];
    p.level = pd.level || 1;
    p.xp = pd.xp || 0;
    p.xpNext = xpForLevel(p.level);
    p.pendingLevels = pd.pendingLevels || 0;
    p.upgrades = pd.upgrades || {};
    reapplyUpgrades(p);
    p.armor = bestArmor(p);
    p.hp = Math.min(pd.hp ?? p.maxHp, p.maxHp);
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

    G.camera.x = p.x;
    G.camera.y = p.y;
    return true;
  } catch (err) {
    console.warn('[save] load failed', err);
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); notify('Save cleared', '#d9c46a'); } catch { /* ignore */ }
}
