// Game orchestration: new-game setup, the per-frame update order, player
// interactions, the tutorial, and autosave.

import {
  TILE, PLAYER, THREAT, STRUCTURES, CAMERA, WEAPONS, RECIPES, GEAR, GEAR_SLOTS,
} from './config.js';
import {
  G, notify, structAtPx, solidPx, shake, addRes, countRes, pointerOverHud,
} from './state.js';
import { createWorld, dangerAtPx, locationAtPx } from './world.js';
import {
  createPlayer, updatePlayer, pickRandomSpawn, currentWeapon, selectSlot,
  heldId, carriedWeight,
} from './player.js';
import {
  equipFromBag, unequip, equipBest, moveStack, dropStack, dropEquipped,
} from './equipment.js';
import {
  ITEMS, slotsCount, slotsAdd, slotsTake, slotsEntries, slotsClear,
} from './items.js';
import {
  updateEnemies, updateSpawning, rebuildSpatial, seedArea, spawnEnemy,
} from './enemies.js';
import { updateBullets, updateTurrets, updateTraps } from './combat.js';
import {
  updatePickups, rollContainer, grantLoot, collectBackpack, seedLoot, spawnPickup,
  spawnEntryPickup,
} from './loot.js';
import {
  buildMenu, canPlace, placeStructure, repairStructure, demolishStructure,
  updateGenerators, updateFloodlights, useGenerator, generatorRunning,
  upgradeBench, nearestStructure, nearWorkbench,
  stashDepositAll, stashWithdrawAmmo, structureCost, isUnlocked, BUILD_RANGE,
  baseCenter,
} from './building.js';
import { updateThreat, addThreat, raidReady } from './threat.js';
import {
  updatePressure, initPressure, quietAt, totalQuietAt, densityMul, suppressed,
  addQuiet, CELL,
} from './pressure.js';
import { startRaid, updateRaid, forceEndRaid } from './raid.js';
import { visibleRecipes, craft, craftStatus } from './crafting.js';
import { addXp, raiseAttribute, buyPerk } from './progression.js';
import { killPlayer, killEnemy } from './damage.js';
import { initClock, updateClock, nightFactors, clockString, darkness } from './daynight.js';
import { recomputeStats, ATTRS, PERKS, perkStatus } from './perks.js';
import {
  makeVehicle, updateVehicles, enterVehicle, exitVehicle, drivenCar, isDriving,
  nearestVehicle, vehiclePrompt, tryUnlock, finishHotwire, stowInTrunk,
  takeFromTrunk, refuelVehicle, salvageVehicle, damageVehicle, trunkLoad,
  releaseTiles, occupyTiles, pickChance, hasKeyFor, plantVehicleKeys, CAR,
} from './vehicles.js';
import { RES } from './config.js';
import { makeRng } from '../core/util.js';
import {
  updateSurvivors, updateUpkeep, seedRescues, recruit, reviveSurvivor,
  liveSurvivors, survivorCap, refreshAllSurvivors, makeSurvivor,
  rationsHeld, rationsCarried, JOBS, JOB_IDS, rosterLimits, freeTowers,
  assignJob, SCAVENGE, BUILDER, SURVIVOR,
} from './survivors.js';
import { cancelDrag, lastZones, isDragging } from '../ui/inventory.js';
import { updateFX, clearFX } from '../core/particles.js';
import * as FX from '../core/particles.js';
import { Input, key, keyTap, consumeKey, endFrame } from '../core/input.js';
import { sfx, resumeAudio, toggleMute } from '../core/audio.js';
import { saveGame, loadGame, hasSave, clearSave } from './save.js';
import { clamp, dist2, smooth, lerp } from '../core/util.js';

export const TUTORIAL = [
  { id: 'move', text: 'WASD to move  ·  SHIFT to sprint  ·  mouse to aim' },
  { id: 'attack', text: 'LEFT CLICK to swing your pipe' },
  { id: 'loot', text: 'Find a container and hold E to search it' },
  { id: 'build', text: 'Press B to build  ·  place a BEDROLL to set your respawn' },
  { id: 'bench', text: 'Build a WORKBENCH, then press C beside it to craft' },
  { id: 'threat', text: 'Watch the THREAT bar — activity draws a horde to your base' },
];

export function newGame(seed = 20240917) {
  G.world = createWorld(seed);
  seedLoot(seed ^ 0x9E3779B9);
  initPressure(G.world);

  G.enemies.length = 0;
  G.bullets.length = 0;
  G.pickups.length = 0;
  G.corpses.length = 0;
  G.structures.length = 0;
  G.structGrid.clear();
  G.backpacks.length = 0;
  clearFX();

  G.notifications.length = 0;
  G.survivors.length = 0;
  G.rescues.length = 0;
  G.vehicles.length = 0;
  G.survivorSeq = 0;
  G.rationDebt = 0;
  initClock();
  G.stash = {};
  G.stashItems = {};
  G.benchTier = 0;
  G.threat = 0;
  G.threatTier = 0;
  G.raid = null;
  G.raidsDone = 0;
  G.time = 0;
  G.stats = { kills: 0, looted: 0, built: 0, crafted: 0, deaths: 0, damageDealt: 0 };
  G.tutorial = { step: 0, done: {}, hint: null };
  G.ui = {
    panel: null, buildIndex: 0, buildMode: false, hover: null, mapOpen: false,
    levelChoices: null, tab: 0, hudRects: [],
  };
  G.paused = false;

  const spot = pickRandomSpawn();
  G.player = createPlayer(spot.x, spot.y);
  // A small leg-up so the first two minutes are about fighting, not scrounging.
  addRes(G.player.bag, 'wood', 20);
  addRes(G.player.bag, 'scrap', 10);
  addRes(G.player.bag, 'cloth', 8);

  G.camera.x = spot.x;
  G.camera.y = spot.y;

  spawnVehicles();
  seedRescues(G.world, 8);
  seedArea(spot.x, spot.y, 1100, 5);
  notify('You wake up on the roadside. Find shelter before dark.', '#d8e8c0', true);
  return G;
}

/**
 * Turns the generated car spawns into drivable vehicles, pre-loads their boots,
 * and plants the keys for the locked ones in a container near enough that
 * "whose car is this?" has a findable answer.
 */
export function spawnVehicles() {
  G.vehicles.length = 0;
  G.vehicleSeq = 0;
  const spawns = G.world.vehicleSpawns || [];

  for (const s of spawns) {
    const r = makeRng(s.seed);
    const v = makeVehicle(s, r);
    v.tiles = s.tiles;
    // A boot that already holds something, so opening one is worth doing.
    if (r.chance(0.55)) {
      const entries = rollContainer(
        { table: 'carTrunk', rolls: [1, 2] }, 1, {},
      );
      for (const e of entries) if (RES[e.id]) v.trunk[e.id] = (v.trunk[e.id] || 0) + e.n;
    }
    G.vehicles.push(v);
  }

  plantVehicleKeys();
  return G.vehicles.length;
}

export function startGame(preferSave = true) {
  if (preferSave && hasSave() && loadGame()) {
    seedLoot((G.world.seed ^ 0x9E3779B9) >>> 0);
    notify('Save loaded', '#b7e08a', true);
    return;
  }
  newGame();
}

// ------------------------------------------------------------- interaction --

export function findInteractable() {
  const p = G.player;
  const R = PLAYER.interactRange;
  let best = null, bestD = R * R;

  // Death drops win outright. If you died beside your own workbench, "recover
  // my gear" is always what you meant, not "upgrade the bench".
  let packBest = null, packD = R * R;
  for (const b of G.backpacks) {
    const d = dist2(p.x, p.y, b.x, b.y);
    if (d < packD) { packD = d; packBest = { kind: 'backpack', ref: b, label: 'Recover your pack' }; }
  }
  if (packBest) return packBest;

  // While driving, E is how you get out — nothing else competes for it.
  if (isDriving()) {
    const car = drivenCar();
    return { kind: 'exitCar', ref: car, label: 'Get out' };
  }

  // A downed survivor is the next most urgent thing in the world.
  for (const s of G.survivors) {
    if (!s.downed || s.dead) continue;
    const d = dist2(p.x, p.y, s.x, s.y);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'revive', ref: s, label: `Help ${s.name} up  (${Math.ceil(s.downT)}s)` };
    }
  }
  if (best) return best;

  for (const r of G.rescues) {
    const d = dist2(p.x, p.y, r.x, r.y);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'rescue', ref: r, label: `Recruit ${r.name}  (${liveSurvivors().length}/${survivorCap()})` };
    }
  }

  for (const c of G.world.containers) {
    if (c.looted) continue;
    const d = dist2(p.x, p.y, c.x, c.y);
    if (d < bestD) { bestD = d; best = { kind: 'container', ref: c, label: `Search ${c.label}` }; }
  }

  for (const v of G.vehicles) {
    const d = dist2(p.x, p.y, v.x, v.y);
    if (d >= bestD) continue;
    bestD = d;
    best = v.destroyed
      ? { kind: 'salvageCar', ref: v, label: 'Strip the wreck' }
      : { kind: 'car', ref: v, label: vehiclePrompt(p, v) };
  }
  for (const s of G.structures) {
    if (s.destroyed) continue;
    const d = dist2(p.x, p.y, s.x, s.y);
    if (d >= bestD) continue;
    if (s.type === 'stash') { bestD = d; best = { kind: 'stash', ref: s, label: 'Deposit all  ·  F: take ammo' }; }
    else if (s.type === 'workbench') { bestD = d; best = { kind: 'bench', ref: s, label: s.tier >= 2 ? 'Workbench II  ·  C: craft' : 'Upgrade Workbench  ·  C: craft' }; }
    else if (s.type === 'gate') { bestD = d; best = { kind: 'gate', ref: s, label: s.open ? 'Close gate' : 'Open gate' }; }
    else if (s.type === 'generator') {
      bestD = d;
      best = {
        kind: 'generator', ref: s,
        label: generatorRunning(s)
          ? `Switch off  (${Math.round(s.fuel)}/${s.def.fuelMax} fuel)`
          : `Refuel and start  (${Math.round(s.fuel)}/${s.def.fuelMax})`,
      };
    } else if (s.type === 'bedroll') {
      bestD = d;
      best = { kind: 'bedroll', ref: s, label: G.player.spawnStructure === s ? 'Respawn point (active)' : 'Set as respawn point' };
    }
  }
  return best;
}

function beginInteract(target) {
  const p = G.player;
  if (!target) return;

  switch (target.kind) {
    case 'container': {
      const c = target.ref;
      const rolls = (c.rolls[0] + c.rolls[1]) / 2;
      p.searching = { c, t: 0, dur: PLAYER.searchTime * p.searchMul * (0.7 + rolls * 0.18) };
      sfx('ui');
      break;
    }
    case 'backpack':
      collectBackpack(p, target.ref);
      break;
    case 'rescue':
      recruit(target.ref);
      break;
    case 'car':
      enterVehicle(p, target.ref);
      break;
    case 'exitCar':
      exitVehicle(p);
      break;
    case 'salvageCar':
      salvageVehicle(target.ref);
      break;
    case 'revive':
      reviveSurvivor(target.ref);
      break;
    case 'stash':
      stashDepositAll();
      break;
    case 'bench':
      if (target.ref.tier < 2) upgradeBench(target.ref);
      else { G.ui.panel = 'craft'; sfx('ui'); }
      break;
    case 'gate':
      target.ref.open = !target.ref.open;
      sfx('build');
      break;
    case 'generator':
      useGenerator(target.ref);
      break;
    case 'bedroll': {
      const s = target.ref;
      for (const o of G.structures) if (o.type === 'bedroll') o.active = false;
      s.active = true;
      p.spawnStructure = s;
      p.spawnPoint = { x: s.x, y: s.y + TILE };
      notify('Respawn point set', '#b7e08a');
      sfx('ui');
      break;
    }
    default: break;
  }
}

function finishSearch() {
  const p = G.player;
  const c = p.searching.c;
  p.searching = null;
  if (c.looted) return;
  c.looted = true;
  G.stats.looted++;

  const entries = rollContainer(c, p.lootMul, {
    rareMul: p.rareLootMul,
    doubleChance: p.doubleDropChance,
  });
  const { lines, anyMajor } = grantLoot(p, entries, c.x, c.y);

  let y = c.y - 12;
  for (const l of lines) { FX.text(c.x, y, l.text, l.color, 12, -34, 1.1); y -= 15; }
  sfx('loot');
  FX.ring(c.x, c.y, 4, 34, 0.4, anyMajor ? '#ffe08a' : '#c9a227', 2);
  addXp(6 + (c.rolls[1] * 3));
  addThreat(THREAT.perLoot);
  completeTutorial('loot');
}

/**
 * Opens or closes a panel. Routed through one place so a half-finished drag in
 * the inventory can never survive the screen closing — the stack would be held
 * by a panel nobody can see.
 */
function setPanel(name) {
  if (G.ui.panel === 'inv' && name !== 'inv') cancelDrag();
  G.ui.panel = name;
  sfx('ui');
}

// ------------------------------------------------------------- build input --

function updateBuildMode() {
  const p = G.player;
  const menu = buildMenu();

  if (Input.wheel !== 0) {
    G.ui.buildIndex = (G.ui.buildIndex + Input.wheel + menu.length) % menu.length;
    sfx('ui');
  }
  for (let i = 0; i < 9; i++) {
    if (keyTap(`Digit${i + 1}`) && i < menu.length) { G.ui.buildIndex = i; sfx('ui'); }
  }
  // B and Escape are handled by the caller; only right-click exits from here.
  if (Input.rightPressed) {
    G.ui.buildMode = false;
    sfx('ui');
    return;
  }

  // The build bar resolves its own clicks; ignore presses that land on it.
  const overBar = pointerOverHud();

  const sel = menu[G.ui.buildIndex];
  const tx = Math.floor(Input.mouse.wx / TILE);
  const ty = Math.floor(Input.mouse.wy / TILE);
  G.ui.ghost = { sel, tx, ty };

  if (sel === 'repair' || sel === 'demolish') {
    const s = structAtPx(Input.mouse.wx, Input.mouse.wy);
    G.ui.ghost.target = s;
    G.ui.ghost.valid = !!s && dist2(s.x, s.y, p.x, p.y) < BUILD_RANGE * BUILD_RANGE;
    if (Input.mousePressed && !overBar && G.ui.ghost.valid) {
      if (sel === 'repair') repairStructure(s);
      else demolishStructure(s);
    } else if (Input.mousePressed && !overBar) {
      sfx('deny');
    }
    return;
  }

  const check = canPlace(sel, tx, ty);
  G.ui.ghost.valid = check.ok;
  G.ui.ghost.reason = check.reason;

  // Hold to place a run of walls; single click for everything else.
  const repeatable = !!STRUCTURES[sel].wall;
  const wantPlace = (repeatable ? Input.mouseDown : Input.mousePressed) && !overBar;
  if (wantPlace && (G.ui.placeCd || 0) <= 0) {
    if (placeStructure(sel, tx, ty)) {
      G.ui.placeCd = repeatable ? 0.07 : 0.16;
      if (sel === 'bedroll') completeTutorial('build');
      if (sel === 'workbench') completeTutorial('bench');
    } else {
      G.ui.placeCd = 0.25;
    }
  }
}

// ---------------------------------------------------------------- tutorial --

export function completeTutorial(id) {
  if (G.tutorial.done[id]) return;
  G.tutorial.done[id] = true;
  const i = TUTORIAL.findIndex((t) => t.id === id);
  if (i === G.tutorial.step) {
    G.tutorial.step++;
    addXp(10);
    sfx('ui');
  }
}

function updateTutorial(dt) {
  const p = G.player;
  const step = TUTORIAL[G.tutorial.step];
  G.tutorial.hint = step ? step.text : null;
  if (!step) return;
  if (step.id === 'move') {
    G.tutorial.moved = (G.tutorial.moved || 0) + Math.hypot(p.vx, p.vy) * dt;
    if (G.tutorial.moved > 260) completeTutorial('move');
  }
  if (step.id === 'threat' && G.threat > 25) completeTutorial('threat');
}

// -------------------------------------------------------------- discovery --

function updateDiscovery() {
  const p = G.player;
  const loc = locationAtPx(G.world, p.x, p.y);
  G.ui.location = loc;
  if (loc && !loc.discovered) {
    loc.discovered = true;
    const xp = 25 * loc.tier;
    addXp(xp);
    notify(`${loc.name} — ${loc.desc}`, '#9fd0ff', true);
    FX.text(p.x, p.y - 40, `DISCOVERED  +${xp} XP`, '#9fd0ff', 14, -30, 1.4);
    sfx('levelUp');
  }
}

// ------------------------------------------------------------------ camera --

function updateCamera(dt) {
  const cam = G.camera;
  const p = G.player;
  const cssH = G.canvasH / (G.dpr || 1);
  const targetZoom = clamp(cssH / CAMERA.viewHeight, CAMERA.minZoom, CAMERA.maxZoom) * (G.dpr || 1);
  cam.zoom = lerp(cam.zoom || targetZoom, targetZoom, smooth(8, dt));

  // Lead the camera slightly toward the cursor so you can see what you're aiming at.
  const lx = clamp((Input.mouse.wx - p.x) * 0.22, -170, 170);
  const ly = clamp((Input.mouse.wy - p.y) * 0.22, -170, 170);
  const tx = p.x + lx, ty = p.y + ly;

  cam.x = lerp(cam.x, tx, smooth(CAMERA.follow, dt));
  cam.y = lerp(cam.y, ty, smooth(CAMERA.follow, dt));

  cam.shake = Math.max(0, cam.shake - dt * 34);
  const s = cam.shake;
  cam.shakeX = (Math.random() - 0.5) * s;
  cam.shakeY = (Math.random() - 0.5) * s;

  const half = G.canvasW / 2 / cam.zoom;
  const halfY = G.canvasH / 2 / cam.zoom;
  const lim = G.world.w * TILE;
  cam.x = clamp(cam.x, half, lim - half);
  cam.y = clamp(cam.y, halfY, lim - halfY);
  G.viewRadius = Math.hypot(half, halfY);
}

// ------------------------------------------------------------------ update --

let autosaveT = 0;

export function update(dt) {
  const p = G.player;
  G.time += dt;
  G.ui.placeCd = Math.max(0, (G.ui.placeCd || 0) - dt);

  // -------------------------------------------------------- global input --
  if (keyTap('KeyI')) { setPanel(G.ui.panel === 'inv' ? null : 'inv'); }
  if (keyTap('KeyM')) { setPanel(G.ui.panel === 'map' ? null : 'map'); }
  if (keyTap('Tab')) { setPanel(G.ui.panel === 'char' ? null : 'char'); }
  if (keyTap('KeyP')) { const m = toggleMute(); notify(m ? 'Audio muted' : 'Audio on', '#8a8f84'); }
  if (keyTap('F5')) { saveGame() ? notify('Game saved', '#b7e08a') : notify('Save failed', '#c96a5a'); }

  if (keyTap('Escape')) {
    if (G.ui.panel) { setPanel(null); }
    else if (G.ui.buildMode) { G.ui.buildMode = false; sfx('ui'); }
    else { G.paused = !G.paused; sfx('ui'); }
  }

  if (G.paused) { updateFX(dt); return; }

  const craftKey = keyTap('KeyC');
  if (craftKey) { setPanel(G.ui.panel === 'craft' ? null : 'craft'); }

  // Build mode is toggled in exactly one place. Handling B here *and* inside
  // updateBuildMode() meant the same edge-triggered press opened and then
  // immediately closed it, so the advertised key never worked.
  if (keyTap('KeyB') && !G.ui.panel) {
    G.ui.buildMode = !G.ui.buildMode;
    sfx('ui');
  }
  if (G.ui.panel) G.ui.buildMode = false;

  // ------------------------------------------------------------- systems --
  rebuildSpatial();

  // Refuelling claims R before updatePlayer can read it as a reload. keyTap is
  // non-consuming, so without this one press did both — reloading the weapon
  // and quietly spending fuel.
  if (!G.ui.panel && !G.ui.buildMode && !p.dead && keyTap('KeyR')) {
    const car = drivenCar() || nearestVehicle(p.x, p.y, PLAYER.interactRange);
    const canFuel = car && !car.destroyed && car.fuel < CAR.fuelMax - 1 &&
      countRes(p.bag, 'fuel') + countRes(G.stash, 'fuel') > 0;
    if (canFuel) {
      consumeKey('KeyR');
      refuelVehicle(car);
    }
  }

  updatePlayer(dt);

  // Driving takes over movement entirely: the player rides in the car.
  const driving = isDriving();
  updateVehicles(dt, driving && !G.ui.panel ? {
    forward: key('KeyW') || key('ArrowUp'),
    back: key('KeyS') || key('ArrowDown'),
    left: key('KeyA') || key('ArrowLeft'),
    right: key('KeyD') || key('ArrowRight'),
    brake: key('Space'),
  } : {});

  updateCamera(dt);

  if (!p.dead) {
    updateDiscovery();
    G.ui.hover = findInteractable();

    if (G.ui.buildMode) {
      updateBuildMode();
    } else if (!G.ui.panel) {
      if (keyTap('KeyE')) beginInteract(G.ui.hover);
      if (keyTap('KeyF')) {
        const st = nearestStructure(p.x, p.y, PLAYER.interactRange, (s) => s.type === 'stash');
        if (st) stashWithdrawAmmo();
      }
      // The boot: G stows your pack into it, shift+G takes it back out. Works
      // from the driver's seat or standing beside the car.
      if (keyTap('KeyG')) {
        const car = drivenCar() || nearestVehicle(p.x, p.y, PLAYER.interactRange);
        if (car && !car.destroyed) {
          if (key('ShiftLeft') || key('ShiftRight')) takeFromTrunk(car);
          else stowInTrunk(car);
        }
      }
      // Refuelling is handled earlier in the frame, before updatePlayer can
      // read the same R press as a reload.
    }

    if (p.searching) {
      // Letting go of E or drifting out of reach aborts the search.
      const c = p.searching.c;
      const outOfReach = dist2(p.x, p.y, c.x, c.y) > (PLAYER.interactRange + 24) ** 2;
      if ((!key('KeyE') && p.searching.t > 0.12) || outOfReach) { p.searching = null; }
      else {
        p.searching.t += dt;
        if (p.searching.t >= p.searching.dur) finishSearch();
      }
    }
  } else {
    G.ui.hover = null;
    G.ui.buildMode = false;
  }

  updateClock(dt);
  updateEnemies(dt);
  updateSurvivors(dt);
  updateBullets(dt);
  updateTurrets(dt);
  updateTraps(dt);
  updateGenerators(dt);
  updateFloodlights();
  updateUpkeep(dt);
  updatePickups(dt);
  // Quiet decays before the spawner reads it, so a lull always ends on time.
  updatePressure(dt);
  updateSpawning(dt);
  updateThreat(dt);

  if (G.raid) updateRaid(dt);
  else if (raidReady()) startRaid();

  for (let i = G.corpses.length - 1; i >= 0; i--) {
    const c = G.corpses[i];
    c.t += dt;
    if (c.t > c.life) G.corpses.splice(i, 1);
  }
  for (const s of G.structures) if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
  for (const n of G.notifications) n.t += dt;
  for (let i = G.notifications.length - 1; i >= 0; i--) {
    if (G.notifications[i].t > G.notifications[i].life) G.notifications.splice(i, 1);
  }
  if (G.flash.t > 0) G.flash.t = Math.max(0, G.flash.t - dt * 2.4);

  updateFX(dt);
  updateTutorial(dt);

  autosaveT += dt;
  if (autosaveT > 25) { autosaveT = 0; saveGame(); }
}

// Exposed for the UI layer and for the browser smoke test.
export const api = {
  newGame, startGame, saveGame, loadGame, clearSave, hasSave,
  buildMenu, structureCost, isUnlocked, currentWeapon, selectSlot,
  startRaid, addXp, addRes, countRes, dangerAtPx, solidPx, shake,
  findInteractable, placeStructure, canPlace, spawnEnemy, forceEndRaid,
  visibleRecipes, craft, craftStatus, nearWorkbench, upgradeBench, baseCenter,
  spawnEntryPickup, RECIPES,
  grantLoot, rollContainer, spawnPickup, repairStructure, demolishStructure, killPlayer,
  killEnemy,
  raiseAttribute, buyPerk, recomputeStats, ATTRS, PERKS, perkStatus,
  cancelDrag, isDragging, invZones: () => lastZones,
  equipFromBag, unequip, equipBest, moveStack, dropStack, dropEquipped,
  ITEMS, slotsCount, slotsAdd, slotsTake, slotsEntries, GEAR, GEAR_SLOTS,
  clearBag: (pl) => { slotsClear(pl.bag); },
  carriedWeight, heldId,
  spawnVehicles, makeVehicle, enterVehicle, exitVehicle, drivenCar, isDriving,
  nearestVehicle, vehiclePrompt, tryUnlock, stowInTrunk, takeFromTrunk,
  refuelVehicle, salvageVehicle, damageVehicle, trunkLoad,
  releaseTiles, occupyTiles, pickChance, hasKeyFor, plantVehicleKeys, CAR,
  seedRescues, recruit, reviveSurvivor, liveSurvivors, survivorCap,
  refreshAllSurvivors, makeSurvivor, rationsHeld, rationsCarried,
  JOBS, JOB_IDS, rosterLimits, freeTowers, assignJob, SCAVENGE, BUILDER,
  clockString, darkness, nightFactors, SURVIVOR,
  quietAt, totalQuietAt, densityMul, suppressed, addQuiet, updatePressure, CELL,
  WEAPONS, STRUCTURES, RECIPES, CAMERA, PLAYER, THREAT,
};
