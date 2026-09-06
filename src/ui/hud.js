// All on-screen UI: HUD, panels, map and menus. Drawn in screen space with an
// immediate-mode button helper, so clicks are resolved during the draw pass.

import {
  RES, WEAPONS, GEAR, GEAR_SLOTS, CONSUMABLES, STRUCTURES, TILE, THREAT, TERRAIN, T,
  RECIPES, BENCH_UPGRADE_COST,
} from '../game/config.js';
import { G, countRes, totalRes, canAfford } from '../game/state.js';
import { Input } from '../core/input.js';
import { currentWeapon, bagLoad } from '../game/player.js';
import { buildMenu, structureCost, isUnlocked, nearWorkbench, upgradeBench } from '../game/building.js';
import { visibleRecipes, craftStatus, craft } from '../game/crafting.js';
import { raiseAttribute, buyPerk } from '../game/progression.js';
import {
  ATTRS, ATTR_IDS, ATTR_MAX, perksFor, perkStatus, canRaiseAttr,
} from '../game/perks.js';
import {
  liveSurvivors, survivorCap, rationsHeld, rationsCarried, SURVIVOR,
  JOBS, JOB_IDS, rosterLimits, freeTowers, assignJob,
} from '../game/survivors.js';
import { clockString, darkness, phaseAt } from '../game/daynight.js';
import { drivenCar, trunkLoad, CAR } from '../game/vehicles.js';
import { threatLabel, threatColor } from '../game/threat.js';
import { dangerAtPx } from '../game/world.js';
import { clamp, TAU, clock } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { drawInventoryPanel } from './inventory.js';
import { drawControlsPanel } from './menu.js';
import { ITEMS } from '../game/items.js';
// The palette, panels, buttons and cursor live in kit.js so the title screen
// draws in the same style without importing the HUD.
import {
  C, panel, bar, uiMouse, inside, clicked, claim, UI_KIT, beginUiFrame, button, drawCursor,
} from './kit.js';
import { primaryLabel } from '../core/bindings.js';
import { act } from '../net/actions.js';

export { uiMouse };

let minimapImg = null;
let minimapSeed = -1;
const hitboxes = [];

// ------------------------------------------------------------------ helpers --

function costString(cost) {
  return Object.entries(cost)
    .map(([id, n]) => `${RES[id] ? RES[id].short : id} ${n}`)
    .join('  ');
}

function costAffordable(cost) {
  return canAfford(cost);
}

// -------------------------------------------------------------------- entry --

export function drawHUD(ctx, deviceW, deviceH, interactive = true) {
  hitboxes.length = 0;
  // The whole UI is authored in CSS pixels and scaled up for HiDPI displays,
  // so text stays legible regardless of devicePixelRatio.
  const { W, H } = beginUiFrame(ctx, deviceW, deviceH, interactive);

  const p = G.player;
  G.ui.dangerTier = dangerAtPx(G.world, p.x, p.y);

  drawVitals(ctx, W, H);
  drawClock(ctx, W, H);
  drawRoomChip(ctx, W, H);
  drawWeaponBar(ctx, W, H);
  drawThreat(ctx, W, H);
  drawResourceStrip(ctx, W, H);
  drawMinimap(ctx, W, H);
  drawNotifications(ctx, W, H);
  drawTopCentre(ctx, W, H);
  drawOffscreenMarkers(ctx, W, H);
  if (G.ui.buildMode) drawBuildBar(ctx, W, H);

  if (G.ui.panel === 'char') drawCharPanel(ctx, W, H);
  else if (G.ui.panel === 'inv') drawInventoryPanel(ctx, W, H, UI_KIT);
  else if (G.ui.panel === 'craft') drawCraftPanel(ctx, W, H);
  else if (G.ui.panel === 'map') drawMapPanel(ctx, W, H);
  else if (G.ui.panel === 'controls') drawControlsPanel(ctx, W, H, () => { G.ui.panel = null; });

  if (p.dead || p.downed) drawDeath(ctx, W, H);
  // The controls panel opened from the pause menu sits in front of it.
  if (G.paused && G.ui.panel !== 'controls') drawPause(ctx, W, H);

  drawCursor(ctx);
}

// ------------------------------------------------------------------ vitals --

function drawVitals(ctx, W, H) {
  const p = G.player;
  const x = 16, y = 16, w = 236;

  ctx.fillStyle = C.bgSoft;
  ctx.fillRect(x - 8, y - 8, w + 16, 92);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7.5, y - 7.5, w + 15, 91);

  // Health
  const hf = p.hp / p.maxHp;
  bar(ctx, x, y, w, 16, hf, hf > 0.5 ? '#7ec46a' : hf > 0.25 ? '#d9c46a' : '#e05a4a');
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = '#0d1109';
  ctx.fillText(`HP ${Math.ceil(p.hp)} / ${p.maxHp}`, x + 6, y + 12);

  // Stamina
  bar(ctx, x, y + 20, w, 8, p.stam / p.maxStam, p.stam > 12 ? '#6fa8c4' : '#c47a4a');

  // XP
  bar(ctx, x, y + 32, w, 10, p.xp / p.xpNext, '#9a7ec4');
  ctx.fillStyle = C.text;
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.fillText(`LVL ${p.level}`, x + 4, y + 41);
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.floor(p.xp)}/${p.xpNext}`, x + w - 4, y + 41);
  ctx.textAlign = 'left';

  // Armour + carry load. Armour is the total across all five slots — see
  // recomputeStats; the breakdown lives on the inventory screen.
  ctx.font = '11px "Courier New", monospace';
  const dr = p.armorDR || 0;
  const wornCount = GEAR_SLOTS.reduce((n, s) => n + (p.equip[s] ? 1 : 0), 0);
  ctx.fillStyle = dr > 0 ? C.accent : C.dim;
  ctx.fillText(
    dr > 0 ? `ARMOUR ${Math.round(dr * 100)}%  (${wornCount}/5)` : 'UNARMOURED  —  I',
    x, y + 58,
  );

  const load = bagLoad(p);
  ctx.fillStyle = load > 1 ? C.warn : load > 0.8 ? C.gold : C.dim;
  ctx.textAlign = 'right';
  ctx.fillText(`LOAD ${Math.round(load * 100)}%`, x + w, y + 58);
  ctx.textAlign = 'left';

  // Consumables, counted across the pack and the hotbar together.
  const held = (id) => countRes(p.bag, id) + countRes(p.hotbar, id);
  const bandages = held('bandage'), kits = held('medkit');
  ctx.fillStyle = bandages + kits > 0 ? C.text : C.dim;
  ctx.fillText(`${primaryLabel('useHeal').toUpperCase()}  HEAL   bandage ${bandages}   medkit ${kits}`, x, y + 74);

  if (p.skillPoints > 0) {
    ctx.fillStyle = C.gold;
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillText(
      `▲ ${p.skillPoints} SKILL POINT${p.skillPoints === 1 ? '' : 'S'} — TAB`,
      x, y + 100,
    );
  }
}

/** Day counter, clock and phase. Sits under the vitals block. */
function drawClock(ctx, W, H) {
  const p = G.player;
  const x = 16;
  const y = p.skillPoints > 0 ? 128 : 112;
  const dark = darkness().alpha;
  const phase = phaseAt(G.dayTime);

  ctx.fillStyle = C.bgSoft;
  ctx.fillRect(x - 8, y - 8, 252, 40);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7.5, y - 7.5, 251, 39);

  ctx.font = 'bold 15px "Courier New", monospace';
  ctx.fillStyle = C.text;
  ctx.fillText(`DAY ${G.day}`, x, y + 10);
  ctx.font = 'bold 14px "Courier New", monospace';
  ctx.fillStyle = dark > 0.5 ? '#8f9ad0' : C.gold;
  ctx.fillText(clockString(), x + 78, y + 10);
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = { dawn: '#d0a05a', day: '#d0c46a', dusk: '#d98a4a', night: '#8f9ad0' }[phase.id];
  ctx.textAlign = 'right';
  ctx.fillText(phase.name, x + 236, y + 10);
  ctx.textAlign = 'left';

  // A day-long bar with the night stretch marked out.
  const bw = 236;
  ctx.fillStyle = '#1a2016';
  ctx.fillRect(x, y + 16, bw, 7);
  ctx.fillStyle = 'rgba(60,72,130,0.55)';
  ctx.fillRect(x + bw * 0.72, y + 16, bw * 0.28, 7);
  ctx.fillStyle = 'rgba(210,150,70,0.4)';
  ctx.fillRect(x + bw * 0.58, y + 16, bw * 0.14, 7);
  ctx.fillStyle = '#e8e0c0';
  ctx.fillRect(x + bw * G.dayTime - 1, y + 14, 2, 11);
  ctx.strokeStyle = '#00000066';
  ctx.strokeRect(x + 0.5, y + 16.5, bw - 1, 6);

  // Survivor tally, only once you actually have people.
  const crew = liveSurvivors();
  if (crew.length > 0 || survivorCap() > 0) {
    const down = crew.filter((s) => s.downed).length;
    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = down > 0 ? C.warn : C.dim;
    ctx.fillText(
      `PEOPLE ${crew.length}/${survivorCap()}${down ? `  ·  ${down} DOWN` : ''}  ·  FOOD ${Math.floor(rationsHeld())}`,
      x, y + 38,
    );
  }
}

// ------------------------------------------------------------- weapon strip --

function drawWeaponBar(ctx, W, H) {
  const p = G.player;
  const car = drivenCar();
  if (car) { drawDrivingBar(ctx, W, H, car); return; }

  const w = currentWeapon(p);
  const y = H - 68;
  const x = 16;

  ctx.fillStyle = C.bgSoft;
  ctx.fillRect(x - 8, y - 8, 316, 62);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7.5, y - 7.5, 315, 61);

  ctx.font = 'bold 15px "Courier New", monospace';
  ctx.fillStyle = C.text;
  ctx.fillText(w.name.toUpperCase(), x, y + 12);

  ctx.font = '12px "Courier New", monospace';
  if (w.kind === 'gun') {
    const mag = p.mag[w.id] || 0;
    const reserve = countRes(p.bag, w.ammo);
    ctx.fillStyle = mag > 0 ? C.gold : C.warn;
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillText(`${mag}`, x, y + 38);
    ctx.font = '13px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    const magW = ctx.measureText(`${mag}`).width;
    ctx.fillText(`/ ${w.mag}   ·   ${reserve} spare`, x + magW + 16, y + 38);
    if (p.reloading) {
      const f = p.reloading.t / p.reloading.dur;
      bar(ctx, x, y + 44, 180, 6, f, C.gold);
      ctx.fillStyle = C.gold;
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillText('RELOADING', x + 186, y + 50);
    } else if (mag === 0) {
      ctx.fillStyle = C.warn;
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillText('R — RELOAD', x, y + 50);
    }
  } else {
    ctx.fillStyle = C.dim;
    ctx.fillText(`MELEE  ·  ${Math.round(w.dmg * p.meleeMul)} dmg`, x, y + 34);
  }

  drawHotbarStrip(ctx, x + 196, y - 2);
}

/**
 * The always-visible hotbar. Six slots with what is in them, so "what am I
 * carrying and what am I holding" is answerable without opening anything —
 * which is the question the first playtest kept asking.
 */
function drawHotbarStrip(ctx, x, y) {
  const p = G.player;
  const cell = 26;
  for (let i = 0; i < p.hotbar.slots.length; i++) {
    const sx = x + i * (cell + 3);
    const sel = i === p.slot;
    const s = p.hotbar.slots[i];
    ctx.fillStyle = sel ? 'rgba(143,174,106,0.4)' : 'rgba(20,26,16,0.8)';
    ctx.fillRect(sx, y, cell, cell);
    ctx.strokeStyle = sel ? C.borderHi : C.border;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(sx + 0.5, y + 0.5, cell - 1, cell - 1);

    if (s) {
      const it = ITEMS[s.id];
      ctx.fillStyle = (it && it.color) || '#9aa2ab';
      ctx.fillRect(sx + 7, y + 9, cell - 14, cell - 16);
      if (s.n > 1) {
        ctx.font = 'bold 9px "Courier New", monospace';
        ctx.fillStyle = C.text;
        ctx.textAlign = 'right';
        ctx.fillText(String(s.n), sx + cell - 2, y + cell - 2);
        ctx.textAlign = 'left';
      }
    }
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = sel ? C.text : C.dim;
    ctx.fillText(`${i + 1}`, sx + 2, y + 9);
  }
}

/** Replaces the weapon strip while you are behind the wheel. */
function drawDrivingBar(ctx, W, H, car) {
  const x = 16, y = H - 68;
  ctx.fillStyle = C.bgSoft;
  ctx.fillRect(x - 8, y - 8, 340, 62);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7.5, y - 7.5, 339, 61);

  ctx.font = 'bold 15px "Courier New", monospace';
  ctx.fillStyle = C.text;
  ctx.fillText(car.hotwired ? 'HOTWIRED CAR' : 'CAR', x, y + 12);

  const kph = Math.round(Math.abs(car.speed) * 0.34);
  ctx.font = 'bold 20px "Courier New", monospace';
  ctx.fillStyle = car.speed < -1 ? C.gold : C.text;
  ctx.fillText(`${kph}`, x + 122, y + 14);
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('km/h', x + 122 + ctx.measureText(`${kph}`).width + 22, y + 14);

  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('FUEL', x, y + 26);
  bar(ctx, x + 34, y + 19, 110, 8, car.fuel / CAR.fuelMax, car.fuel > 8 ? '#d2762c' : '#c94a3a');
  ctx.fillStyle = C.dim;
  ctx.fillText('BODY', x + 156, y + 26);
  bar(ctx, x + 192, y + 19, 110, 8, car.hp / car.maxHp,
    car.hp / car.maxHp > 0.4 ? '#7ec46a' : '#e05a4a');

  const load = trunkLoad(car);
  ctx.fillStyle = C.dim;
  ctx.fillText(`BOOT ${Math.round(load)} / ${CAR.trunkCap}`, x, y + 42);
  ctx.fillStyle = car.fuel <= 0 ? C.warn : C.dim;
  ctx.fillText(
    car.fuel <= 0 ? 'OUT OF FUEL' : 'W/S drive · A/D steer · SPACE brake · E out · G stow',
    x + 118, y + 42,
  );
}

// ------------------------------------------------------------------ threat --

function drawThreat(ctx, W, H) {
  const x = W - 276, y = 16, w = 260;

  ctx.fillStyle = C.bgSoft;
  ctx.fillRect(x - 8, y - 8, w + 16, G.raid ? 92 : 58);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7.5, y - 7.5, w + 15, (G.raid ? 92 : 58) - 1);

  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('THREAT', x, y + 11);
  ctx.textAlign = 'right';
  ctx.fillStyle = threatColor();
  ctx.fillText(threatLabel(), x + w, y + 11);
  ctx.textAlign = 'left';

  bar(ctx, x, y + 16, w, 12, G.threat / THREAT.max, threatColor());
  // Warning ticks
  ctx.fillStyle = '#00000088';
  for (const t of THREAT.warnAt) ctx.fillRect(x + (t / THREAT.max) * w, y + 16, 1, 12);

  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText(`raids survived ${G.raidsDone}   ·   ${clock(G.time)}`, x, y + 42);

  if (G.raid) {
    const r = G.raid;
    ctx.font = 'bold 13px "Courier New", monospace';
    if (r.phase === 'warning') {
      ctx.fillStyle = C.warn;
      ctx.fillText(`${r.spec.name} IN ${Math.ceil(r.timer)}s`, x, y + 62);
      ctx.font = '10px "Courier New", monospace';
      ctx.fillStyle = C.gold;
      ctx.fillText(r.hasBase ? 'Get to your defences' : 'Build cover — anything', x, y + 76);
    } else {
      const done = r.killed;
      ctx.fillStyle = C.warn;
      ctx.fillText(`${r.spec.name}  ·  WAVE ${r.wave}/${r.spec.waves}`, x, y + 62);
      bar(ctx, x, y + 68, w, 10, done / Math.max(1, r.total), '#c4553f');
      ctx.font = '10px "Courier New", monospace';
      ctx.fillStyle = C.text;
      ctx.fillText(`${done} / ${r.total} killed`, x, y + 88);
    }
  }
}

// ------------------------------------------------------------- resources -----

const STRIP_IDS = ['wood', 'scrap', 'cloth', 'elec', 'med', 'parts', 'mil', 'fuel'];

function drawResourceStrip(ctx, W, H) {
  const p = G.player;
  const x = W - 276;
  const y = G.raid ? 118 : 84;

  ctx.fillStyle = C.bgSoft;
  ctx.fillRect(x - 8, y - 8, 276, 8 + STRIP_IDS.length * 15 + 26);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7.5, y - 7.5, 275, 7 + STRIP_IDS.length * 15 + 26);

  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('CARRIED', x, y + 6);
  ctx.textAlign = 'right';
  ctx.fillText('STASH', x + 252, y + 6);
  ctx.textAlign = 'left';

  let yy = y + 20;
  for (const id of STRIP_IDS) {
    const def = RES[id];
    const carried = countRes(p.bag, id);
    const stashed = countRes(G.stash, id);
    ctx.fillStyle = def.color;
    ctx.fillRect(x, yy - 7, 7, 7);
    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = carried + stashed > 0 ? C.text : '#4e5744';
    ctx.fillText(def.name, x + 13, yy);
    ctx.textAlign = 'right';
    ctx.fillStyle = carried > 0 ? C.text : '#4e5744';
    ctx.fillText(`${carried}`, x + 196, yy);
    ctx.fillStyle = stashed > 0 ? C.gold : '#4e5744';
    ctx.fillText(`${stashed}`, x + 252, yy);
    ctx.textAlign = 'left';
    yy += 15;
  }

  // Ammo row
  ctx.font = '11px "Courier New", monospace';
  const ammo = ['ammoP', 'ammoS', 'ammoR']
    .map((id) => `${RES[id].short} ${countRes(p.bag, id)}`)
    .join('   ');
  ctx.fillStyle = C.gold;
  ctx.fillText(ammo, x, yy + 6);
}

// ----------------------------------------------------------------- minimap ---

function buildMinimap() {
  const world = G.world;
  const c = document.createElement('canvas');
  c.width = world.w; c.height = world.h;
  const g = c.getContext('2d');
  const img = g.createImageData(world.w, world.h);
  for (let i = 0; i < world.w * world.h; i++) {
    const t = world.tiles[i];
    const pal = TERRAIN[t] || TERRAIN[T.GRASS];
    const hex = pal.a;
    let r = parseInt(hex.slice(1, 3), 16);
    let gg = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    // Tint by danger so the map itself communicates where not to go.
    const d = world.danger[i];
    if (d > 1) { r = Math.min(255, r + (d - 1) * 26); gg = Math.max(0, gg - (d - 1) * 8); b = Math.max(0, b - (d - 1) * 8); }
    if (world.blocked[i] && t !== T.WALL) { r = (r * 0.75) | 0; gg = (gg * 0.75) | 0; b = (b * 0.75) | 0; }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function ensureMinimap() {
  if (!minimapImg || minimapSeed !== G.world.seed) {
    minimapImg = buildMinimap();
    minimapSeed = G.world.seed;
  }
  return minimapImg;
}

function drawMinimap(ctx, W, H) {
  const size = 168;
  const x = W - size - 16, y = H - size - 16;
  const world = G.world;
  const img = ensureMinimap();

  ctx.fillStyle = C.bg;
  ctx.fillRect(x - 4, y - 4, size + 8, size + 8);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 3.5, y - 3.5, size + 7, size + 7);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(img, x, y, size, size);
  ctx.globalAlpha = 1;

  const sc = size / (world.w * TILE);
  const mx = (wx) => x + wx * sc;
  const my = (wy) => y + wy * sc;

  // Structures
  for (const s of G.structures) {
    if (s.destroyed) continue;
    ctx.fillStyle = s.def.protect ? '#59b8c4' : '#b7e08a';
    ctx.fillRect(mx(s.x) - 1, my(s.y) - 1, 2, 2);
  }
  // Backpacks
  for (const b of G.backpacks) {
    ctx.fillStyle = '#e8c86a';
    ctx.beginPath();
    ctx.arc(mx(b.x), my(b.y), 3, 0, TAU);
    ctx.fill();
  }
  // Teammates, in their colour.
  for (const q of G.players) {
    if (q === G.player || q.away || q.dead) continue;
    ctx.fillStyle = q.color || '#dff0ff';
    ctx.beginPath();
    ctx.arc(mx(q.x), my(q.y), 3, 0, TAU);
    ctx.fill();
  }
  // Enemies
  for (const e of G.enemies) {
    if (e.dead) continue;
    ctx.fillStyle = e.raid ? '#ff5a4a' : e.aggro ? '#d9705a' : '#8a5a4a';
    ctx.fillRect(mx(e.x) - 1, my(e.y) - 1, 2, 2);
  }
  // Raid marker
  if (G.raid && G.raid.hasBase) {
    ctx.strokeStyle = '#ff5a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(mx(G.raid.cx), my(G.raid.cy), 8 + Math.sin(G.time * 4) * 3, 0, TAU);
    ctx.stroke();
  }
  // Player
  const p = G.player;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(mx(p.x), my(p.y), 2.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#ffffffaa';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(mx(p.x), my(p.y));
  ctx.lineTo(mx(p.x) + Math.cos(p.angle) * 8, my(p.y) + Math.sin(p.angle) * 8);
  ctx.stroke();

  ctx.restore();

  ctx.font = '9px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('M — MAP', x, y - 8);
}

// ----------------------------------------------------------- notifications ---

function drawNotifications(ctx, W, H) {
  let y = H - 130;
  ctx.textAlign = 'left';
  for (let i = G.notifications.length - 1; i >= 0; i--) {
    const n = G.notifications[i];
    const a = clamp(1 - (n.t / n.life) ** 3, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = `bold ${n.big ? 14 : 12}px "Courier New", monospace`;
    const w = ctx.measureText(n.text).width + 16;
    ctx.fillStyle = 'rgba(10,14,8,0.8)';
    ctx.fillRect(16, y - 13, w, 19);
    ctx.fillStyle = n.color;
    ctx.fillRect(16, y - 13, 3, 19);
    ctx.fillText(n.text, 26, y);
    y -= 23;
    ctx.globalAlpha = 1;
  }
}

// -------------------------------------------------------------- top centre ---

function drawTopCentre(ctx, W, H) {
  ctx.textAlign = 'center';
  const cx = W / 2;

  const loc = G.ui.location;
  if (loc) {
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = ['#8fae6a', '#8fae6a', '#d9c46a', '#d98a4a', '#e05a4a'][loc.tier] || C.dim;
    ctx.fillText(loc.name, cx, 28);
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText(`DANGER ${'▲'.repeat(loc.tier)}`, cx, 42);
  }

  if (G.tutorial.hint && !G.ui.panel) {
    ctx.font = 'bold 13px "Courier New", monospace';
    const w = ctx.measureText(G.tutorial.hint).width + 28;
    ctx.fillStyle = 'rgba(12,16,10,0.88)';
    ctx.fillRect(cx - w / 2, 58, w, 26);
    ctx.strokeStyle = C.borderHi;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2 + 0.5, 58.5, w - 1, 25);
    ctx.fillStyle = C.accent;
    ctx.fillText(G.tutorial.hint, cx, 76);
  }

  // Key hints along the bottom.
  if (!G.ui.panel && !G.ui.buildMode) {
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = 'rgba(125,143,104,0.75)';
    const K = (id) => primaryLabel(id).toUpperCase();
    ctx.fillText(
      `${K('build')} BUILD   ·   ${K('craft')} CRAFT   ·   ${K('character')} CHARACTER   ·   ${K('map')} MAP   ·   ${K('interact')} INTERACT   ·   ${K('useHeal')} HEAL   ·   ESC MENU`,
      cx, H - 14,
    );
  }
  ctx.textAlign = 'left';
}

// ------------------------------------------------------- offscreen markers ---

function drawOffscreenMarkers(ctx, W, H) {
  const cam = G.camera;
  const marks = [];
  for (const b of G.backpacks) marks.push({ x: b.x, y: b.y, color: C.gold, label: 'PACK' });
  if (G.raid && G.raid.hasBase && G.raid.phase !== 'warning') {
    marks.push({ x: G.raid.cx, y: G.raid.cy, color: C.warn, label: 'BASE' });
  }
  if (G.player.spawnStructure && !G.player.spawnStructure.destroyed) {
    marks.push({ x: G.player.spawnStructure.x, y: G.player.spawnStructure.y, color: '#9fd0ff', label: 'CAMP' });
  }
  // Teammates off screen: their colour, their name.
  for (const q of G.players) {
    if (q === G.player || q.away || q.dead) continue;
    marks.push({ x: q.x, y: q.y, color: q.color || '#dff0ff', label: q.name.toUpperCase() });
  }

  const S = G.dpr || 1;
  for (const m of marks) {
    const sx = ((m.x - cam.x) * cam.zoom) / S + W / 2;
    const sy = ((m.y - cam.y) * cam.zoom) / S + H / 2;
    if (sx > 60 && sx < W - 60 && sy > 60 && sy < H - 60) continue;

    const cx = W / 2, cy = H / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    const rx = Math.min(W / 2 - 46, Math.abs(Math.cos(a)) < 1e-3 ? 1e6 : (W / 2 - 46) / Math.abs(Math.cos(a)));
    const ry = Math.min(H / 2 - 46, Math.abs(Math.sin(a)) < 1e-3 ? 1e6 : (H / 2 - 46) / Math.abs(Math.sin(a)));
    const r = Math.min(rx, ry);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = m.color;
    ctx.textAlign = 'center';
    const d = Math.round(Math.hypot(m.x - G.player.x, m.y - G.player.y) / 32);
    ctx.fillText(`${m.label} ${d}m`, px, py + 22);
    ctx.textAlign = 'left';
  }
}

// ---------------------------------------------------------------- build bar --

function drawBuildBar(ctx, W, H) {
  const menu = buildMenu();
  const cw = 92, ch = 62, gap = 5;
  const total = menu.length * (cw + gap) - gap;
  const x0 = Math.max(10, W / 2 - total / 2);
  const y = H - 152;

  const barW = Math.min(total + 20, W - 20);
  // Clicks on the bar select a piece; they must not also be read as a placement
  // by the world update, or picking a card would spend resources first.
  claim(x0 - 10, y - 26, barW, ch + 40);

  ctx.fillStyle = C.bg;
  ctx.fillRect(x0 - 10, y - 26, barW, ch + 40);
  ctx.strokeStyle = C.borderHi;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 9.5, y - 25.5, barW - 1, ch + 39);

  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('BUILD MODE  ·  wheel / 1-9 to select  ·  LMB place  ·  RMB or B to exit', x0 - 4, y - 10);

  for (let i = 0; i < menu.length; i++) {
    const id = menu[i];
    const x = x0 + i * (cw + gap);
    if (x + cw > W - 8) break;
    const sel = i === G.ui.buildIndex;
    const isTool = id === 'repair' || id === 'demolish';
    const def = STRUCTURES[id];
    const unlocked = isTool || isUnlocked(id);
    const cost = isTool ? null : structureCost(id);
    const afford = isTool ? true : costAffordable(cost);

    ctx.fillStyle = sel ? 'rgba(120,160,86,0.42)' : 'rgba(22,28,18,0.85)';
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = sel ? C.borderHi : C.border;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);

    if (inside(x, y, cw, ch) && clicked()) { G.ui.buildIndex = i; sfx('ui'); }

    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = !unlocked ? '#5c6650' : isTool ? C.blue : afford ? C.text : '#8a6a5a';
    const name = isTool ? id.toUpperCase() : def.name.toUpperCase();
    ctx.fillText(name.slice(0, 13), x + 6, y + 15);

    ctx.font = '9px "Courier New", monospace';
    if (isTool) {
      ctx.fillStyle = C.dim;
      ctx.fillText(id === 'repair' ? 'click a piece' : 'salvage 50%', x + 6, y + 30);
    } else if (!unlocked) {
      ctx.fillStyle = '#8a6a5a';
      ctx.fillText('WORKBENCH II', x + 6, y + 30);
    } else {
      ctx.fillStyle = afford ? C.dim : '#a06a5a';
      let yy = y + 30;
      for (const [rid, n] of Object.entries(cost)) {
        ctx.fillText(`${RES[rid].short} ${n}`, x + 6, yy);
        yy += 11;
      }
      ctx.fillStyle = C.dim;
      ctx.fillText(`HP ${Math.round(def.hp * G.player.structHpMul)}`, x + 50, y + 30);
    }
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText(`${i + 1}`, x + cw - 12, y + 14);
  }
}

// -------------------------------------------------------------- char panel ---

const CHAR_TABS = ['SKILLS', 'STATUS', 'PEOPLE'];

function drawCharPanel(ctx, W, H) {
  const w = Math.min(860, W - 50), h = Math.min(600, H - 50);
  const x = (W - w) / 2, y = (H - h) / 2;
  const p = G.player;

  panel(ctx, x, y, w, h, `CHARACTER  —  TAB to close`);

  // Tabs
  const tw = 120, th = 26;
  for (let i = 0; i < CHAR_TABS.length; i++) {
    const bx = x + 14 + i * (tw + 6), by = y + 30;
    const sel = (G.ui.tab || 0) === i;
    const hot = inside(bx, by, tw, th);
    ctx.fillStyle = sel ? 'rgba(120,160,86,0.42)' : hot ? 'rgba(90,120,66,0.3)' : 'rgba(24,30,20,0.8)';
    ctx.fillRect(bx, by, tw, th);
    ctx.strokeStyle = sel ? C.borderHi : C.border;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, th - 1);
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillStyle = sel ? C.text : C.dim;
    ctx.textAlign = 'center';
    ctx.fillText(CHAR_TABS[i], bx + tw / 2, by + 17);
    ctx.textAlign = 'left';
    if (hot && clicked()) { G.ui.tab = i; sfx('ui'); }
  }

  // Points banner
  ctx.textAlign = 'right';
  ctx.font = 'bold 14px "Courier New", monospace';
  ctx.fillStyle = p.skillPoints > 0 ? C.gold : C.dim;
  ctx.fillText(
    p.skillPoints > 0 ? `${p.skillPoints} SKILL POINT${p.skillPoints === 1 ? '' : 'S'}` : 'no skill points',
    x + w - 16, y + 48,
  );
  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText(`LEVEL ${p.level}   ·   ${Math.floor(p.xp)} / ${p.xpNext} XP`, x + w - 16, y + 64);
  ctx.textAlign = 'left';

  const top = y + 76;
  if ((G.ui.tab || 0) === 0) drawSkillsTab(ctx, x, top, w, h - (top - y) - 14);
  else if (G.ui.tab === 1) drawStatusTab(ctx, x, top, w, h - (top - y) - 14);
  else drawPeopleTab(ctx, x, top, w, h - (top - y) - 14);
}

// ------------------------------------------------------------- skills tab ---

function drawSkillsTab(ctx, px, py, pw, ph) {
  const p = G.player;
  const colW = 290;
  const x = px + 16, y = py + 6;

  if (!G.ui.attrSel) G.ui.attrSel = ATTR_IDS[0];

  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('ATTRIBUTES', x, y + 4);
  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('click a name  ·  [+] spends a point', x, y + 18);

  let ry = y + 30;
  for (const id of ATTR_IDS) {
    const a = ATTRS[id];
    const rank = p.attrs[id] || 1;
    const sel = G.ui.attrSel === id;
    const rowH = 46;
    const hot = inside(x, ry, colW - 42, rowH);

    ctx.fillStyle = sel ? 'rgba(120,160,86,0.26)' : hot ? 'rgba(90,120,66,0.16)' : 'rgba(20,26,16,0.6)';
    ctx.fillRect(x, ry, colW - 42, rowH);
    ctx.strokeStyle = sel ? a.color : C.border;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(x + 0.5, ry + 0.5, colW - 43, rowH - 1);
    if (hot && clicked()) { G.ui.attrSel = id; sfx('ui'); }

    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = a.color;
    ctx.fillText(a.abbr, x + 8, ry + 17);
    ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = C.text;
    ctx.fillText(a.name, x + 44, ry + 17);

    // Rank pips
    for (let i = 0; i < ATTR_MAX; i++) {
      ctx.fillStyle = i < rank ? a.color : 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 8 + i * 13, ry + 25, 10, 6);
    }
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText(`${rank}`, x + 8 + ATTR_MAX * 13 + 6, ry + 32);

    // Clipped: these strings must never bleed under the [+] button.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 6, ry + 34, colW - 54, 12);
    ctx.clip();
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText(a.perRank, x + 8, ry + 42);
    ctx.restore();

    // Buy button
    const can = canRaiseAttr(p, id);
    const bx = x + colW - 36, bw = 30;
    const bhot = inside(bx, ry + 8, bw, 30);
    ctx.fillStyle = can.ok ? (bhot ? 'rgba(140,190,100,0.6)' : 'rgba(90,120,66,0.45)') : 'rgba(30,34,26,0.6)';
    ctx.fillRect(bx, ry + 8, bw, 30);
    ctx.strokeStyle = can.ok ? C.borderHi : '#333d2a';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, ry + 8.5, bw - 1, 29);
    ctx.font = 'bold 17px "Courier New", monospace';
    ctx.fillStyle = can.ok ? C.text : '#4c5544';
    ctx.textAlign = 'center';
    ctx.fillText(rank >= ATTR_MAX ? '—' : '+', bx + bw / 2, ry + 29);
    ctx.textAlign = 'left';
    if (bhot && clicked()) act.raiseAttribute(id);

    ry += rowH + 6;
  }

  // ------------------------------------------------------------- perks --
  const kx = px + colW + 8;
  const kw = pw - colW - 30;
  const attr = ATTRS[G.ui.attrSel];
  const list = perksFor(G.ui.attrSel);

  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = attr.color;
  ctx.fillText(`${attr.name.toUpperCase()} PERKS`, kx, y + 4);
  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText(attr.blurb, kx, y + 18);

  let ky = y + 30;
  for (const perk of list) {
    const st = perkStatus(p, perk);
    const rank = st.rank;
    const rowH = 62;
    const maxed = rank >= perk.max;
    const hot = inside(kx, ky, kw, rowH);
    const buyable = st.ok;

    ctx.fillStyle = st.locked ? 'rgba(18,20,16,0.72)'
      : maxed ? 'rgba(60,80,46,0.34)'
        : hot && buyable ? 'rgba(90,120,66,0.42)' : 'rgba(24,30,20,0.75)';
    ctx.fillRect(kx, ky, kw, rowH);
    ctx.strokeStyle = maxed ? C.accent : st.locked ? '#333d2a' : buyable && hot ? C.borderHi : C.border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(kx + 0.5, ky + 0.5, kw - 1, rowH - 1);
    if (hot && buyable && clicked()) act.buyPerk(perk.id);

    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = st.locked ? '#5c6650' : maxed ? C.accent : C.text;
    ctx.fillText(perk.name, kx + 10, ky + 19);

    // Rank pips
    for (let i = 0; i < perk.max; i++) {
      ctx.fillStyle = i < rank ? attr.color : 'rgba(255,255,255,0.12)';
      ctx.fillRect(kx + kw - 14 - (perk.max - i) * 12, ky + 11, 9, 9);
    }

    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = st.locked ? '#4c5544' : C.dim;
    wrapText(ctx, perk.desc, kx + 10, ky + 36, kw - 26, 13);

    ctx.font = 'bold 10px "Courier New", monospace';
    if (st.locked) {
      ctx.fillStyle = '#a06a5a';
      ctx.fillText(`LOCKED — needs ${attr.abbr} ${perk.req}`, kx + 10, ky + rowH - 7);
    } else if (maxed) {
      ctx.fillStyle = C.accent;
      ctx.fillText('MASTERED', kx + 10, ky + rowH - 7);
    } else if (p.skillPoints > 0) {
      ctx.fillStyle = C.gold;
      ctx.fillText('CLICK TO LEARN — 1 point', kx + 10, ky + rowH - 7);
    } else {
      ctx.fillStyle = C.dim;
      ctx.fillText(`requires ${attr.abbr} ${perk.req}`, kx + 10, ky + rowH - 7);
    }

    ky += rowH + 6;
    if (ky + rowH > py + ph) break;
  }
}

// ------------------------------------------------------------- status tab ---

function drawStatusTab(ctx, px, py, pw, ph) {
  const p = G.player;
  const col1 = px + 20, col2 = px + pw / 2 + 10;
  let yy = py + 16;

  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('DERIVED', col1, yy);
  yy += 20;
  ctx.font = '12px "Courier New", monospace';
  const pct = (v) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  const stats = [
    ['Max health', Math.round(p.maxHp)],
    ['Max stamina', Math.round(p.maxStam)],
    ['Carry capacity', Math.round(p.carryCap)],
    ['Melee damage', pct(p.meleeMul)],
    ['Firearm damage', pct(p.gunMul)],
    ['Critical chance', `${Math.round(p.critChance * 100)}%`],
    ['Weapon spread', `${Math.round((p.spreadMul - 1) * 100)}%`],
    ['Bullet range', pct(p.rangeMul)],
    ['Loot yield', pct(p.lootMul)],
    ['Rare loot', pct(p.rareLootMul)],
    ['Search speed', `+${Math.round((1 / p.searchMul - 1) * 100)}%`],
    ['Structure cost', `${Math.round((p.buildCostMul - 1) * 100)}%`],
    ['Structure health', pct(p.structHpMul)],
    ['Turret power', pct(p.turretMul)],
    ['Healing', pct(p.healMul)],
    ['Threat generated', `${Math.round((p.threatMul - 1) * 100)}%`],
    ['Experience', pct(p.xpMul)],
  ];
  for (const [k, v] of stats) {
    ctx.fillStyle = C.dim;
    ctx.fillText(k, col1, yy);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(`${v}`, col1 + 300, yy);
    ctx.textAlign = 'left';
    yy += 16;
  }

  let ry = py + 16;
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('THE RUN', col2, ry);
  ry += 20;
  ctx.font = '12px "Courier New", monospace';
  const runStats = [
    ['Day', G.day],
    ['Time', clockString()],
    ['Survived', clock(G.time)],
    ['Kills', G.stats.kills],
    ['Containers looted', G.stats.looted],
    ['Structures built', G.stats.built],
    ['Items crafted', G.stats.crafted],
    ['Raids repelled', G.raidsDone],
    ['Deaths', G.stats.deaths],
    ['People with you', `${liveSurvivors().length} / ${survivorCap()}`],
  ];
  for (const [k, v] of runStats) {
    ctx.fillStyle = C.dim;
    ctx.fillText(k, col2, ry);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(`${v}`, col2 + 260, ry);
    ctx.textAlign = 'left';
    ry += 16;
  }

  ry += 14;
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('LOADOUT', col2, ry);
  ry += 18;
  ctx.font = '11px "Courier New", monospace';
  for (let i = 0; i < p.hotbar.slots.length; i++) {
    const s = p.hotbar.slots[i];
    const wd = s ? WEAPONS[s.id] : null;
    ctx.fillStyle = i === p.slot ? C.gold : s ? C.text : C.dim;
    ctx.fillText(`${i + 1}. ${s ? ITEMS[s.id].name : '—'}`, col2, ry);
    if (wd) {
      ctx.fillStyle = C.dim;
      ctx.fillText(wd.kind === 'gun' ? `${wd.dmg} x${wd.pellets || 1}  mag ${wd.mag}` : `${wd.dmg} dmg`, col2 + 175, ry);
    }
    ry += 15;
  }
  ry += 6;
  for (const slot of GEAR_SLOTS) {
    const id = p.equip[slot];
    ctx.fillStyle = id ? C.accent : C.dim;
    ctx.fillText(
      `${slot.padEnd(6)} ${id ? `${GEAR[id].name}  +${Math.round(GEAR[id].dr * 100)}%` : '—'}`,
      col2, ry,
    );
    ry += 15;
  }
}

// ------------------------------------------------------------- people tab ---

function drawPeopleTab(ctx, px, py, pw, ph) {
  const p = G.player;
  const x = px + 20;
  let y = py + 16;
  const crew = liveSurvivors();
  const cap = survivorCap();

  const limits = rosterLimits();
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText(`YOUR PEOPLE   ${crew.length} / ${cap}`, x, y);

  // Two independent limits — say which one is actually in the way.
  ctx.font = '10px "Courier New", monospace';
  const bindBunks = limits.bunks <= limits.charisma;
  ctx.fillStyle = bindBunks ? C.gold : C.dim;
  ctx.fillText(`${limits.bunks} bunk${limits.bunks === 1 ? '' : 's'} built`, x, y + 15);
  ctx.fillStyle = bindBunks ? C.dim : C.gold;
  ctx.fillText(`Charisma allows ${limits.charisma}`, x + 130, y + 15);
  ctx.fillStyle = C.dim;
  ctx.fillText(
    bindBunks ? '← build more Bunks to make room' : '← raise Charisma to bring more in',
    x + 270, y + 15,
  );

  // The stash is the pantry, exactly like the ammo they shoot. Food in your own
  // pack feeds nobody until you drop it off, so say so plainly.
  const rations = rationsHeld();
  const carried = rationsCarried();
  const burn = crew.length * SURVIVOR.upkeepPerMin * p.upkeepMul;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = rations > 0 ? (rations < burn * 5 ? C.gold : C.text) : C.warn;
  ctx.fillText(
    `Stash Rations ${Math.floor(rations)}   ·   burning ${burn.toFixed(1)}/min` +
    (burn > 0 ? `   ·   ${rations > 0 ? `${Math.floor(rations / Math.max(0.01, burn))} min left` : 'STARVING'}` : ''),
    x, y + 34,
  );
  if (carried > 0) {
    ctx.fillStyle = rations <= 0 ? C.warn : C.dim;
    ctx.fillText(
      `You are carrying ${Math.floor(carried)} — deposit at the stash to feed them`,
      x, y + 50,
    );
  }
  const ammo = countRes(G.stash, 'ammoP');
  ctx.fillStyle = ammo > 40 ? C.text : C.gold;
  ctx.fillText(`Stash 9mm ${ammo}   ·   they fire from the stash, so keep it full`,
    x, y + (carried > 0 ? 66 : 50));

  y += carried > 0 ? 84 : 68;

  if (crew.length === 0) {
    ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText(
      limits.bunks === 0
        ? 'Nowhere for anyone to sleep. Build a Bunk (B) before you go looking.'
        : limits.charisma === 0
          ? 'Nobody will follow you yet. Raise Charisma to open a slot.'
          : 'Nobody yet. Survivors are marked with a green ring out in the town.',
      x, y,
    );
    return;
  }

  // A maxed Charisma plus three Recruiter ranks allows eight people, which is
  // more rows than the panel can show — so the list scrolls.
  const rowH = 74, rowGap = 6;
  const listTop = y;
  const listH = py + ph - listTop;
  const visible = Math.max(1, Math.floor(listH / (rowH + rowGap)));
  const maxScroll = Math.max(0, crew.length - visible);
  if (inside(x, listTop, pw - 40, listH) && Input.wheel !== 0) {
    G.ui.rosterScroll = clamp((G.ui.rosterScroll || 0) + Input.wheel, 0, maxScroll);
  }
  const scroll = clamp(G.ui.rosterScroll || 0, 0, maxScroll);
  G.ui.rosterScroll = scroll;

  if (maxScroll > 0) {
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    ctx.fillText(
      `showing ${scroll + 1}-${Math.min(crew.length, scroll + visible)} of ${crew.length}  ·  scroll to see the rest`,
      x + pw - 40, listTop - 6,
    );
    ctx.textAlign = 'left';
  }

  for (const s of crew.slice(scroll, scroll + visible)) {
    ctx.fillStyle = 'rgba(24,30,20,0.75)';
    ctx.fillRect(x, y, pw - 40, rowH);
    ctx.strokeStyle = s.downed ? C.warn : s.hungry ? '#a06a5a' : C.border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, pw - 41, rowH - 1);

    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = s.downed ? C.warn : C.text;
    ctx.fillText(s.name, x + 12, y + 19);
    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = C.gold;
    ctx.fillText(`LVL ${s.level}`, x + 110, y + 19);
    ctx.fillStyle = C.dim;
    ctx.fillText(`${s.kills} kills`, x + 180, y + 19);
    ctx.fillText(`dmg ${Math.round(s.dmg)}`, x + 250, y + 19);
    if (s.hungry) { ctx.fillStyle = '#e0904a'; ctx.fillText('HUNGRY', x + 330, y + 19); }
    if (s.downed) { ctx.fillStyle = C.warn; ctx.fillText('DOWN', x + 330, y + 19); }
    if (s.carrying) { ctx.fillStyle = '#e8c86a'; ctx.fillText('HAULING', x + 400, y + 19); }

    // Health + xp bars
    bar(ctx, x + 12, y + 26, 170, 7, s.hp / s.maxHp,
      s.hp / s.maxHp > 0.5 ? '#7ec46a' : s.hp / s.maxHp > 0.25 ? '#d9c46a' : '#e05a4a');
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText(`${Math.round(s.hp)}/${s.maxHp}`, x + 188, y + 33);

    const need = SURVIVOR.xpPerLevel * s.level;
    bar(ctx, x + 250, y + 26, 130, 7, s.level >= SURVIVOR.maxLevel ? 1 : s.xp / need, '#9a7ec4');
    ctx.fillStyle = C.dim;
    ctx.fillText(s.level >= SURVIVOR.maxLevel ? 'veteran' : `${Math.floor(s.xp)}/${need} xp`, x + 386, y + 33);

    // ------------------------------------------------------ job buttons --
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText('JOB', x + 12, y + 55);

    let bx = x + 44;
    for (const id of JOB_IDS) {
      const job = JOBS[id];
      const bw = 74, bh = 18;
      const active = (s.job || 'guard') === id;
      const towerFree = id !== 'sniper' || active || freeTowers().length > 0;
      const hot = inside(bx, y + 44, bw, bh);

      ctx.fillStyle = active ? 'rgba(120,160,86,0.42)'
        : !towerFree ? 'rgba(26,28,22,0.7)'
          : hot ? 'rgba(90,120,66,0.34)' : 'rgba(20,26,16,0.7)';
      ctx.fillRect(bx, y + 44, bw, bh);
      ctx.strokeStyle = active ? job.color : towerFree ? C.border : '#333d2a';
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(bx + 0.5, y + 44.5, bw - 1, bh - 1);
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = active ? job.color : towerFree ? C.text : '#4c5544';
      ctx.textAlign = 'center';
      ctx.fillText(job.name.toUpperCase(), bx + bw / 2, y + 56);
      ctx.textAlign = 'left';

      if (hot && clicked() && !active) act.assignJob(s, id);
      bx += bw + 5;
    }

    // What the current job is doing right now.
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    const job = JOBS[s.job || 'guard'];
    // Targets differ in shape between jobs, so read them defensively.
    let doing = job.desc;
    if (s.job === 'scavenger' && s.carrying) doing = 'Carrying a haul back to the stash.';
    else if (s.job === 'scavenger' && s.runTarget?.label) doing = `Working a ${s.runTarget.label}.`;
    else if (s.job === 'builder' && s.runTarget?.def) doing = `Repairing a ${s.runTarget.def.name}.`;
    else if (s.job === 'sniper' && !s.tower) doing = 'No tower — falling back to guarding.';
    ctx.fillText(doing, bx + 8, y + 56);

    y += rowH + rowGap;
  }
}

// ------------------------------------------------------------- craft panel ---

function drawCraftPanel(ctx, W, H) {
  const w = Math.min(720, W - 60), h = Math.min(620, H - 50);
  const x = (W - w) / 2, y = (H - h) / 2;

  const bench = nearWorkbench(G.player.x, G.player.y);
  const tier = bench ? bench.tier : 0;
  panel(ctx, x, y, w, h, `CRAFTING  —  ${bench ? `Workbench ${tier === 2 ? 'II' : 'I'} in range` : 'no workbench nearby'}  —  ${primaryLabel('craft')} to close`);

  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('Crafting is instant. Materials come from your pack and any stash.', x + 20, y + 40);

  // The upgrade prompt gets its own full-width row so it can never collide
  // with the recipe grid.
  let listTop = y + 54;
  if (bench && bench.tier < 2) {
    const bw = w - 40, bh = 30;
    const bx = x + 20, by = y + 50;
    const afford = canAfford(BENCH_UPGRADE_COST);
    if (button(ctx, bx, by, bw, bh, 'UPGRADE WORKBENCH → II', {
      enabled: afford,
      sub: null,
      color: C.blue,
    })) {
      act.upgradeBench(bench);
    }
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = afford ? C.dim : '#a06a5a';
    ctx.textAlign = 'right';
    ctx.fillText(costString(BENCH_UPGRADE_COST), bx + bw - 10, by + 19);
    ctx.textAlign = 'left';
    listTop = by + bh + 10;
  }

  const list = RECIPES;
  const cols = 2;
  const cw = (w - 50) / cols;
  const chh = 46;
  let i = 0;
  for (const r of list) {
    const cx = x + 20 + (i % cols) * (cw + 10);
    const cy = listTop + Math.floor(i / cols) * (chh + 6);
    if (cy + chh > y + h - 12) break;
    i++;

    const st = craftStatus(r, tier);
    const locked = r.bench > tier;
    const label = r.name;
    const sub = `${costString(r.cost)}${locked ? `   ·   ${st.reason}` : ''}`;

    if (button(ctx, cx, cy, cw, chh, label, {
      enabled: st.ok,
      sub,
      color: locked ? '#8a8f84' : st.ok ? C.text : '#a08a5a',
    })) {
      act.craft(r, tier);
    }
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = r.bench === 2 ? C.blue : r.bench === 1 ? C.dim : C.accent;
    ctx.textAlign = 'right';
    ctx.fillText(r.bench === 0 ? 'HAND' : r.bench === 1 ? 'BENCH I' : 'BENCH II', cx + cw - 8, cy + 14);
    ctx.textAlign = 'left';
  }
}

// --------------------------------------------------------------- map panel ---

function drawMapPanel(ctx, W, H) {
  const size = Math.min(W - 120, H - 140);
  const x = (W - size) / 2, y = (H - size) / 2;
  const world = G.world;

  ctx.fillStyle = 'rgba(6,8,5,0.86)';
  ctx.fillRect(0, 0, W, H);

  panel(ctx, x - 12, y - 34, size + 24, size + 66, 'TOWN MAP  —  M to close');

  const img = ensureMinimap();
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();

  const sc = size / (world.w * TILE);
  const mx = (wx) => x + wx * sc;
  const my = (wy) => y + wy * sc;

  // Location labels
  ctx.textAlign = 'center';
  for (const l of world.locations) {
    const [lx, ly, lw, lh] = l.rect;
    const cx = mx((lx + lw / 2) * TILE);
    const cy = my((ly + lh / 2) * TILE);
    ctx.strokeStyle = l.discovered ? 'rgba(180,210,150,0.5)' : 'rgba(120,130,110,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(lx * TILE), my(ly * TILE), lw * TILE * sc, lh * TILE * sc);

    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillStyle = l.discovered
      ? ['#8fae6a', '#8fae6a', '#d9c46a', '#d98a4a', '#e05a4a'][l.tier]
      : 'rgba(140,150,130,0.55)';
    ctx.fillText(l.discovered ? l.name : '? ? ?', cx, cy);
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = 'rgba(200,210,180,0.55)';
    ctx.fillText(`DANGER ${'▲'.repeat(l.tier)}`, cx, cy + 12);
  }
  ctx.textAlign = 'left';

  for (const s of G.structures) {
    if (s.destroyed) continue;
    ctx.fillStyle = s.def.protect ? '#59b8c4' : '#b7e08a';
    ctx.fillRect(mx(s.x) - 1.5, my(s.y) - 1.5, 3, 3);
  }
  for (const b of G.backpacks) {
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(mx(b.x), my(b.y), 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('P', mx(b.x) - 3, my(b.y) + 3);
  }
  const p = G.player;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(mx(p.x), my(p.y), 4.5, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('White = you   ·   Gold = dropped pack   ·   Cyan = base structures   ·   Red tint = danger', x, y + size + 20);
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  for (const wd of words) {
    const test = line ? `${line} ${wd}` : wd;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lh;
      line = wd;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}

// -------------------------------------------------------------------- death --

function drawDeath(ctx, W, H) {
  const p = G.player;
  if (p.downed) {
    // Down, not dead: a teammate can still reach you. Keep the world visible
    // so you can watch them coming.
    const pulse = 0.5 + Math.sin(G.time * 4) * 0.5;
    ctx.fillStyle = `rgba(60,6,6,${0.28 + pulse * 0.1})`;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px "Courier New", monospace';
    ctx.fillStyle = '#c4392f';
    ctx.fillText('YOU ARE DOWN', W / 2, H / 2 - 20);
    ctx.font = '15px "Courier New", monospace';
    ctx.fillStyle = C.text;
    ctx.fillText(`A teammate can hold ${primaryLabel('interact')} beside you to get you up.`, W / 2, H / 2 + 16);
    ctx.fillStyle = C.dim;
    ctx.font = '13px "Courier New", monospace';
    ctx.fillText(`${Math.ceil(p.downT)}s before you bleed out`, W / 2, H / 2 + 44);
    ctx.textAlign = 'left';
    return;
  }
  ctx.fillStyle = `rgba(60,6,6,${clamp(0.35 + (3 - p.respawnT) * 0.16, 0.3, 0.72)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 54px "Courier New", monospace';
  ctx.fillStyle = '#c4392f';
  ctx.fillText('YOU DIED', W / 2, H / 2 - 20);
  ctx.font = '15px "Courier New", monospace';
  ctx.fillStyle = C.text;
  ctx.fillText('Your gear is in a pack where you fell. Go and get it.', W / 2, H / 2 + 16);
  ctx.fillStyle = C.dim;
  ctx.font = '13px "Courier New", monospace';
  ctx.fillText(
    p.spawnStructure && !p.spawnStructure.destroyed
      ? `Respawning at your bedroll in ${Math.ceil(p.respawnT)}...`
      : `Respawning somewhere in the wild in ${Math.ceil(p.respawnT)}...  (place a Bedroll to fix this)`,
    W / 2, H / 2 + 44,
  );
  ctx.textAlign = 'left';
}

// -------------------------------------------------------------------- pause --

/** Hosting: the room code and the head count, under the clock. Joined: whose game. */
function drawRoomChip(ctx, W, H) {
  const role = G.net.role;
  if (role === 'solo') return;
  const x = 10, y = 150, w = 250, h = 30;
  ctx.fillStyle = C.bgSoft;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = 'bold 11px "Courier New", monospace';
  if (role === 'host') {
    const present = G.players.filter((p) => !p.away).length;
    ctx.fillStyle = C.gold;
    ctx.fillText(`ROOM ${G.net.code || '……'}`, x + 10, y + 19);
    ctx.fillStyle = C.dim;
    ctx.font = '10px "Courier New", monospace';
    ctx.fillText(`${present}/4 here  ·  friends join with the code`, x + 110, y + 19);
  } else {
    ctx.fillStyle = C.blue;
    ctx.fillText(`${G.net.hostName || 'HOST'}'S GAME`.toUpperCase(), x + 10, y + 19);
    ctx.fillStyle = C.dim;
    ctx.font = '10px "Courier New", monospace';
    ctx.fillText(G.net.stats ? `${Math.round(G.net.stats.recvPerSec / 1024)} KB/s` : '', x + 190, y + 19);
  }
  void H;
}

// Resolved by main.js after the UI has drawn, so saving and quitting happen
// outside the draw pass.
export const pauseActions = { save: false, quit: false, stopHost: false, leave: false };

function drawPause(ctx, W, H) {
  const role = G.net.role;
  ctx.fillStyle = 'rgba(6,8,5,0.82)';
  ctx.fillRect(0, 0, W, H);
  const roster = role === 'host' ? G.players.filter((p) => !p.away) : [];
  const w = 380, h = 344 + (role === 'host' ? 30 + roster.length * 16 : 0);
  const x = (W - w) / 2, y = (H - h) / 2;
  panel(ctx, x, y, w, h, role === 'client' ? 'PAUSED — the world carries on without you' : 'PAUSED');

  ctx.textAlign = 'center';
  ctx.font = 'bold 26px "Courier New", monospace';
  ctx.fillStyle = C.accent;
  ctx.fillText('DEADLINE', W / 2, y + 62);
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText(`Level ${G.player.level}   ·   ${G.stats.kills} kills   ·   ${G.raidsDone} raids   ·   ${clock(G.time)}`, W / 2, y + 84);
  ctx.textAlign = 'left';

  let by = y + 106;
  if (role === 'host') {
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillStyle = C.gold;
    ctx.textAlign = 'center';
    ctx.fillText(`ROOM CODE  ${G.net.code || '……'}`, W / 2, by + 4);
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    let ry = by + 20;
    for (const q of roster) { ctx.fillText(`${q.name}${q === G.player ? '  (you, hosting)' : ''}`, W / 2, ry); ry += 16; }
    ctx.textAlign = 'left';
    by += 30 + roster.length * 16;
  }

  const bw = w - 60, bx = x + 30;
  // Each button's rectangle is recorded for the browser suite, like the menu's.
  const rec = (key) => { G.menu.rects[`PAUSE:${key}`] = { x: bx, y: by, w: bw, h: 34 }; };
  rec('RESUME');
  if (button(ctx, bx, by, bw, 34, 'RESUME  (ESC)')) { G.paused = false; }
  by += 44;
  if (role === 'client') {
    rec('LEAVE');
    if (button(ctx, bx, by, bw, 34, 'LEAVE GAME', { sub: 'the host keeps your character', color: C.gold })) { pauseActions.leave = true; }
  } else {
    rec('SAVE');
    if (button(ctx, bx, by, bw, 34, `SAVE GAME  (${primaryLabel('save').toUpperCase()})`)) { pauseActions.save = true; }
  }
  by += 44;
  // Opens the controls panel *over* the pause: the world stays stopped, and
  // BACK returns here. Unpausing to show it let enemies act on a player who
  // could not answer.
  rec('CONTROLS');
  if (button(ctx, bx, by, bw, 34, 'CONTROLS')) { G.ui.panel = 'controls'; }
  by += 44;
  rec('QUIT');
  if (role === 'client') {
    if (button(ctx, bx, by, bw, 34, 'QUIT TO TITLE', { color: C.gold })) { pauseActions.leave = true; }
  } else if (button(ctx, bx, by, bw, 34, role === 'host' ? 'STOP HOSTING AND QUIT' : 'QUIT TO TITLE', { sub: 'saves first', color: C.gold })) {
    pauseActions.quit = true;
  }
  by += 48;
  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'center';
  ctx.fillText(
    role === 'client' ? 'your progress is saved by the host'
      : G.slotId ? 'autosaves every 25s' : 'this game has no save slot yet — SAVE GAME makes one',
    W / 2, by + 16,
  );
  ctx.textAlign = 'left';
}
