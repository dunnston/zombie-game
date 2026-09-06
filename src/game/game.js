// Game orchestration: new-game setup, the per-frame update order, player
// interactions, the tutorial, and autosave.

import {
  TILE, PLAYER, THREAT, STRUCTURES, CAMERA, WEAPONS, RECIPES, GEAR, GEAR_SLOTS,
} from './config.js';
import {
  G, notify, structAtPx, solidPx, shake, addRes, countRes, pointerOverHud,
  addPlayer, removePlayer, isLocal, presentPlayers, nearestPlayer, baseOwner,
} from './state.js';
import { createWorld, dangerAtPx, locationAtPx } from './world.js';
import {
  createPlayer, updatePlayer, movePlayer, pickRandomSpawn, currentWeapon, selectSlot,
  heldId, carriedWeight, revivePlayer,
} from './player.js';
import { makeIntent, gatherLocalIntent, consumeEdges } from './intent.js';
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
  baseCenter, refreshBedrolls,
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
import { act } from '../net/actions.js';
import { hostAfterUpdate } from '../net/host.js';
import { updateClient } from '../net/client.js';
import { emit } from '../net/events.js';
import { structChanged } from './state.js';
import { updateFX, clearFX } from '../core/particles.js';
import * as FX from '../core/particles.js';
// Only UI keys are read here — panels, build mode, pause. Everything the
// simulation acts on goes through intent.js. Both ask for actions, not keys.
import { Input, keyTap } from '../core/input.js';
import { actTap, primaryLabel } from '../core/bindings.js';
import { sfx, resumeAudio, toggleMute } from '../core/audio.js';
import { saveGame, loadGame, hasSave, clearSave } from './saves.js';
import { clamp, dist2, smooth, lerp } from '../core/util.js';

// Hints name keys through the bindings, so they follow whatever the player
// has set. `text` is a function for that reason.
const k = primaryLabel;
export const TUTORIAL = [
  { id: 'move', text: () => `${k('moveUp')}${k('moveLeft')}${k('moveDown')}${k('moveRight')} to move  ·  ${k('sprint').toUpperCase()} to sprint  ·  mouse to aim` },
  { id: 'attack', text: () => 'LEFT CLICK to swing your pipe' },
  { id: 'loot', text: () => `Find a container and hold ${k('interact')} to search it` },
  { id: 'build', text: () => `Press ${k('build')} to build  ·  place a BEDROLL to set your respawn` },
  { id: 'bench', text: () => `Build a WORKBENCH, then press ${k('craft')} beside it to craft` },
  { id: 'threat', text: () => 'Watch the THREAT bar — activity draws a horde to your base' },
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
  G.scene = 'game';
  G.playtime = 0;
  G.mode = 'solo';
  // The slot is the caller's decision: the title screen makes one, the tests
  // do not, and a slotless game gets one the first time it saves.
  G.slotId = null;

  const spot = pickRandomSpawn();
  G.player = createPlayer(spot.x, spot.y);
  giveStarterKit(G.player);

  G.camera.x = spot.x;
  G.camera.y = spot.y;

  spawnVehicles();
  seedRescues(G.world, 8);
  seedArea(spot.x, spot.y, 1100, 5);
  notify('You wake up on the roadside. Find shelter before dark.', '#d8e8c0', true);
  return G;
}

/** A small leg-up so the first two minutes are about fighting, not scrounging. */
function giveStarterKit(p) {
  addRes(p.bag, 'wood', 20);
  addRes(p.bag, 'scrap', 10);
  addRes(p.bag, 'cloth', 8);
}

/**
 * Brings another person into the world, beside whoever is already here. This
 * is what a guest joining does; the smoke test uses it to stand up a second
 * survivor and drive them by intent.
 */
export function joinPlayer(opts = {}) {
  const anchor = opts.near || baseOwner();
  let spot = null;
  if (anchor) {
    for (let i = 0; i < 24 && !spot; i++) {
      const a = (i / 24) * Math.PI * 2 + 0.3;
      const r = 48 + Math.floor(i / 8) * 28;
      const x = anchor.x + Math.cos(a) * r, y = anchor.y + Math.sin(a) * r;
      if (!solidPx(x, y)) spot = { x, y };
    }
  }
  if (!spot) spot = pickRandomSpawn();
  const p = createPlayer(spot.x, spot.y, { ...opts, seat: opts.seat ?? G.players.length });
  giveStarterKit(p);
  addPlayer(p);
  notify(`${p.name} joined`, '#9fd0ff', true);
  return p;
}

/**
 * A player who has disconnected but is still part of this world: parked, not
 * removed. Their car is put back, their channels dropped, and they stop being
 * drawn, targeted or simulated — but everything they carry saves with the
 * world, and the same identity gets it back.
 */
export function parkPlayer(p) {
  // Park the car first: a driver who vanishes would leave it engine-on with its
  // collision tiles released, and nothing would ever put them back.
  if (p.drivingId) exitVehicle(p);
  p.searching = null;
  p.using = null;
  p.reviving = null;
  p.intent && (p.intent.mx = 0, p.intent.my = 0, p.intent.fire = false);
  // Anyone mid-revive on this player sees them gone, not a ghost that stays downed.
  p.away = true;
  return p;
}

export function leavePlayer(p) {
  if (!G.players.includes(p)) return false;
  parkPlayer(p);
  removePlayer(p);
  notify(`${p.name} left`, '#8a8f84');
  return true;
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

/** CONTINUE: the most recently played slot, or a fresh game if there is none. */
export function startGame(preferSave = true) {
  if (preferSave && hasSave() && loadGame()) {
    seedLoot((G.world.seed ^ 0x9E3779B9) >>> 0);
    notify('Save loaded', '#b7e08a', true);
    return;
  }
  newGame(Math.floor(Math.random() * 0x7fffffff));
}

/** Back to the title screen. The game in progress is saved first if it has a slot. */
export function toTitle(save = true) {
  if (save && G.scene === 'game' && G.slotId && G.world && G.player) saveGame();
  cancelDrag();
  G.paused = false;
  G.ui.panel = null;
  G.ui.buildMode = false;
  G.scene = 'title';
  G.menu.screen = 'main';
  G.menu.pendingRebind = null;
  G.menu.confirmDelete = null;
}

// ------------------------------------------------------------- interaction --

export function findInteractable(p = G.player) {
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
  if (isDriving(p)) {
    const car = drivenCar(p);
    return { kind: 'exitCar', ref: car, label: 'Get out' };
  }

  // A teammate on the ground outranks everything else in the world.
  for (const q of G.players) {
    if (q === p || !q.downed || q.dead || q.away) continue;
    const d = dist2(p.x, p.y, q.x, q.y);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'revivePlayer', ref: q, label: `Help ${q.name} up  (${Math.ceil(q.downT)}s)` };
    }
  }
  if (best) return best;

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
    if (s.type === 'stash') { bestD = d; best = { kind: 'stash', ref: s, label: `Deposit all  ·  ${k('withdraw')}: take ammo` }; }
    else if (s.type === 'workbench') { bestD = d; best = { kind: 'bench', ref: s, label: s.tier >= 2 ? `Workbench II  ·  ${k('craft')}: craft` : `Upgrade Workbench  ·  ${k('craft')}: craft` }; }
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
      best = { kind: 'bedroll', ref: s, label: p.spawnStructure === s ? 'Respawn point (active)' : 'Set as respawn point' };
    }
  }
  return best;
}

/** `p` presses E on `target`. */
export function beginInteract(p, target) {
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
      recruit(target.ref, p);
      break;
    case 'car':
      enterVehicle(p, target.ref);
      break;
    case 'exitCar':
      exitVehicle(p);
      break;
    case 'salvageCar':
      salvageVehicle(target.ref, p);
      break;
    case 'revive':
      reviveSurvivor(target.ref, p);
      break;
    case 'revivePlayer':
      // A channel, like searching: hold E beside them until it completes.
      p.reviving = { target: target.ref, t: 0, dur: PLAYER.reviveTime };
      sfx('ui');
      break;
    case 'stash':
      stashDepositAll(p);
      break;
    case 'bench':
      if (target.ref.tier < 2) upgradeBench(target.ref, p);
      else if (isLocal(p)) { G.ui.panel = 'craft'; sfx('ui'); }
      break;
    case 'gate':
      target.ref.open = !target.ref.open;
      structChanged(target.ref);
      sfx('build');
      break;
    case 'generator':
      useGenerator(target.ref, p);
      break;
    case 'bedroll': {
      const s = target.ref;
      p.spawnStructure = s;
      p.spawnPoint = { x: s.x, y: s.y + TILE };
      refreshBedrolls();
      if (isLocal(p)) notify('Respawn point set', '#b7e08a');
      sfx('ui');
      break;
    }
    default: break;
  }
}

function finishSearch(p) {
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
  emit('looted', { id: c.id });
  emit('loot', { n: p.netId, x: Math.round(c.x), y: Math.round(c.y), lines: lines.map((l) => ({ text: l.text, color: l.color })) });

  let y = c.y - 12;
  for (const l of lines) { FX.text(c.x, y, l.text, l.color, 12, -34, 1.1); y -= 15; }
  sfx('loot');
  FX.ring(c.x, c.y, 4, 34, 0.4, anyMajor ? '#ffe08a' : '#c9a227', 2);
  addXp(p, 6 + (c.rolls[1] * 3));
  addThreat(THREAT.perLoot, '', p);
  if (isLocal(p)) completeTutorial('loot');
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

/** Build mode is a local UI: the ghost, the bar and the mouse belong to `p`. */
function updateBuildMode(p) {
  const menu = buildMenu();

  if (Input.wheel !== 0) {
    G.ui.buildIndex = (G.ui.buildIndex + Input.wheel + menu.length) % menu.length;
    sfx('ui');
  }
  // 1–6 follow the hotbar bindings; 7–9 have no action of their own.
  for (let i = 0; i < 9; i++) {
    const tapped = i < 6 ? actTap(`slot${i + 1}`) : keyTap(`Digit${i + 1}`);
    if (tapped && i < menu.length) { G.ui.buildIndex = i; sfx('ui'); }
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
      if (sel === 'repair') act.repair(s);
      else act.demolish(s);
    } else if (Input.mousePressed && !overBar) {
      sfx('deny');
    }
    return;
  }

  const check = canPlace(sel, tx, ty, p);
  G.ui.ghost.valid = check.ok;
  G.ui.ghost.reason = check.reason;

  // Hold to place a run of walls; single click for everything else.
  const repeatable = !!STRUCTURES[sel].wall;
  const wantPlace = (repeatable ? Input.mouseDown : Input.mousePressed) && !overBar;
  if (wantPlace && (G.ui.placeCd || 0) <= 0) {
    // On a guest this is a request to the host; the wall arrives as an event.
    if (act.place(sel, tx, ty) || G.net.role === 'client') {
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
    addXp(G.player, 10);
    sfx('ui');
  }
}

function updateTutorial(dt) {
  const p = G.player;
  const step = TUTORIAL[G.tutorial.step];
  G.tutorial.hint = step ? step.text() : null;
  if (!step) return;
  if (step.id === 'move') {
    G.tutorial.moved = (G.tutorial.moved || 0) + Math.hypot(p.vx, p.vy) * dt;
    if (G.tutorial.moved > 260) completeTutorial('move');
  }
  if (step.id === 'threat' && G.threat > 25) completeTutorial('threat');
}

// -------------------------------------------------------------- discovery --

function updateDiscovery(p) {
  const loc = locationAtPx(G.world, p.x, p.y);
  if (isLocal(p)) G.ui.location = loc;
  if (loc && !loc.discovered) {
    loc.discovered = true;
    emit('loc', { id: loc.id });
    const xp = 25 * loc.tier;
    addXp(p, xp);
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

/** One player's simulation step: the refuel-before-reload claim, then updatePlayer. */
function stepPlayer(p, dt) {
  // Refuelling claims R before updatePlayer can read it as a reload. Without
  // this one press did both — reloading the weapon and quietly spending fuel.
  if (!p.dead && !p.downed && p.intent.reload) {
    const car = drivenCar(p) || nearestVehicle(p.x, p.y, PLAYER.interactRange);
    const canFuel = car && !car.destroyed && car.fuel < CAR.fuelMax - 1 &&
      countRes(p.bag, 'fuel') + countRes(G.stash, 'fuel') > 0;
    if (canFuel) {
      p.intent.reload = false;
      refuelVehicle(car, p);
    }
  }
  updatePlayer(p, dt);
}

/** E, F and G for one player, plus the channels they hold: searching and reviving. */
function interactPlayer(p, dt) {
  const it = p.intent;
  if (it.interact) beginInteract(p, findInteractable(p));
  if (it.withdrawAmmo) {
    const st = nearestStructure(p.x, p.y, PLAYER.interactRange, (s) => s.type === 'stash');
    if (st) stashWithdrawAmmo(p);
  }
  // The boot: G stows your pack into it, shift+G takes it back out. Works from
  // the driver's seat or standing beside the car.
  if (it.stow || it.unstow) {
    const car = drivenCar(p) || nearestVehicle(p.x, p.y, PLAYER.interactRange);
    if (car && !car.destroyed) {
      if (it.unstow) takeFromTrunk(car, p);
      else stowInTrunk(car, p);
    }
  }

  if (p.searching) {
    // Letting go of E or drifting out of reach aborts the search.
    const c = p.searching.c;
    const outOfReach = dist2(p.x, p.y, c.x, c.y) > (PLAYER.interactRange + 24) ** 2;
    if ((!it.interactHeld && p.searching.t > 0.12) || outOfReach) { p.searching = null; }
    else {
      p.searching.t += dt;
      if (p.searching.t >= p.searching.dur) finishSearch(p);
    }
  }

  if (p.reviving) {
    const q = p.reviving.target;
    const gone = !q.downed || q.dead || q.away;
    const outOfReach = dist2(p.x, p.y, q.x, q.y) > (PLAYER.interactRange + 24) ** 2;
    if (gone || (!it.interactHeld && p.reviving.t > 0.12) || outOfReach) { p.reviving = null; }
    else {
      p.reviving.t += dt;
      if (p.reviving.t >= p.reviving.dur) {
        p.reviving = null;
        if (revivePlayer(p, q)) addXp(p, 20);
      }
    }
  }
}

let autosaveT = 0;

export function update(dt) {
  const p = G.player;
  G.time += dt;
  G.ui.placeCd = Math.max(0, (G.ui.placeCd || 0) - dt);

  // -------------------------------------------------------- global input --
  // The controls panel is capturing a key: nothing else may read the keyboard.
  const rebinding = G.ui.panel === 'controls' && !!G.menu.pendingRebind;
  if (!rebinding) {
    if (actTap('inventory')) { setPanel(G.ui.panel === 'inv' ? null : 'inv'); }
    if (actTap('map')) { setPanel(G.ui.panel === 'map' ? null : 'map'); }
    if (actTap('character')) { setPanel(G.ui.panel === 'char' ? null : 'char'); }
    if (actTap('mute')) { const m = toggleMute(); notify(m ? 'Audio muted' : 'Audio on', '#8a8f84'); }
    if (actTap('save')) { saveGame() ? notify('Game saved', '#b7e08a') : notify('Save failed', '#c96a5a'); }
  }

  if (keyTap('Escape')) {
    if (rebinding) { G.menu.pendingRebind = null; sfx('ui'); }
    else if (G.ui.panel) { setPanel(null); }
    else if (G.ui.buildMode) { G.ui.buildMode = false; sfx('ui'); }
    else { G.paused = !G.paused; sfx('ui'); }
  }

  if (G.paused) { updateFX(dt); return; }
  G.playtime += dt;

  if (!rebinding && actTap('craft')) { setPanel(G.ui.panel === 'craft' ? null : 'craft'); }

  // Build mode is toggled in exactly one place. Handling B here *and* inside
  // updateBuildMode() meant the same edge-triggered press opened and then
  // immediately closed it, so the advertised key never worked.
  if (!rebinding && actTap('build') && !G.ui.panel) {
    G.ui.buildMode = !G.ui.buildMode;
    sfx('ui');
  }
  if (G.ui.panel) G.ui.buildMode = false;

  // ------------------------------------------------------------- systems --
  rebuildSpatial();

  // A guest does not run the world. It sends what its player wants, predicts
  // its own movement, and eases everything else toward what the host said.
  if (G.net.role === 'client') {
    updateClient(dt);
    updateCamera(dt);
    if (p && !p.dead && !p.downed) {
      G.ui.hover = findInteractable(p);
      if (G.ui.buildMode) updateBuildMode(p);
    } else {
      G.ui.hover = null;
      G.ui.buildMode = false;
    }
    updateBullets(dt);            // tracers only: their damage is zero here
    updateCosmetics(dt);
    return;
  }

  // The person at this keyboard says what they want; anyone else's intent has
  // already arrived from wherever they are.
  if (p) gatherLocalIntent(p);

  for (const q of G.players) {
    if (q.away) continue;
    stepPlayer(q, dt);
  }

  // Driving takes over movement entirely: the driver rides in the car.
  updateVehicles(dt);

  updateCamera(dt);

  for (const q of G.players) {
    if (q.away || q.dead || q.downed) continue;
    updateDiscovery(q);
    interactPlayer(q, dt);
  }

  // Local UI: the interact prompt and build mode belong to this keyboard.
  if (p && !p.dead && !p.downed) {
    G.ui.hover = findInteractable(p);
    if (G.ui.buildMode) updateBuildMode(p);
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

  updateCosmetics(dt);
  updateTutorial(dt);

  // Edge-triggered intent from anyone but this keyboard has now had its one
  // step. The local intent is rebuilt from the keys at the top of update().
  for (const q of G.players) if (!isLocal(q)) consumeEdges(q.intent);

  // Guests hear what happened this step. A no-op unless hosting.
  hostAfterUpdate(dt);

  // Autosave, into this game's slot. A game with no slot (the tests start
  // straight through newGame) is not quietly given one every 25 seconds.
  autosaveT += dt;
  if (autosaveT > 25) { autosaveT = 0; if (G.slotId) saveGame(); }
}

/** Corpses fading, structures un-flashing, notifications ageing, particles. */
function updateCosmetics(dt) {
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
}

// Exposed for the UI layer and for the browser smoke test.
export const api = {
  newGame, startGame, saveGame, loadGame, clearSave, hasSave, toTitle,
  buildMenu, structureCost, isUnlocked, currentWeapon, selectSlot,
  startRaid, addXp, addRes, countRes, dangerAtPx, solidPx, shake,
  findInteractable, placeStructure, canPlace, spawnEnemy, forceEndRaid,
  visibleRecipes, craft, craftStatus, nearWorkbench, upgradeBench, baseCenter,
  spawnEntryPickup, RECIPES,
  grantLoot, rollContainer, spawnPickup, repairStructure, demolishStructure,
  killPlayer: (p = G.player, force = false) => killPlayer(p, force),
  killEnemy,
  // Players beyond the first — a second survivor for the test to drive by intent.
  joinPlayer, leavePlayer, parkPlayer, makeIntent, revivePlayer, beginInteract, movePlayer,
  isLocal, presentPlayers, nearestPlayer, baseOwner,
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
