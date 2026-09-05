// All on-screen UI: HUD, panels, map and menus. Drawn in screen space with an
// immediate-mode button helper, so clicks are resolved during the draw pass.

import {
  RES, WEAPONS, ARMORS, CONSUMABLES, STRUCTURES, TILE, THREAT, TERRAIN, T,
  UPGRADES, RECIPES, BENCH_UPGRADE_COST,
} from '../game/config.js';
import { G, countRes, totalRes, canAfford } from '../game/state.js';
import { Input } from '../core/input.js';
import { currentWeapon, bagLoad } from '../game/player.js';
import { buildMenu, structureCost, isUnlocked, nearWorkbench, upgradeBench } from '../game/building.js';
import { visibleRecipes, craftStatus, craft } from '../game/crafting.js';
import { chooseUpgrade } from '../game/progression.js';
import { threatLabel, threatColor } from '../game/threat.js';
import { dangerAtPx } from '../game/world.js';
import { clamp, TAU, clock } from '../core/util.js';
import { sfx } from '../core/audio.js';

const C = {
  bg: 'rgba(12,16,10,0.92)',
  bgSoft: 'rgba(12,16,10,0.72)',
  border: '#4a5a38',
  borderHi: '#8fae6a',
  text: '#d5e4c2',
  dim: '#7d8f68',
  accent: '#b7e08a',
  gold: '#e8c86a',
  warn: '#e05a4a',
  blue: '#9fd0ff',
};

let minimapImg = null;
let minimapSeed = -1;
const hitboxes = [];

// ------------------------------------------------------------------ helpers --

function panel(ctx, x, y, w, h, title = null) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = 'rgba(143,174,106,0.10)';
  ctx.fillRect(x + 2, y + 2, w - 4, 22);
  if (title) {
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = C.borderHi;
    ctx.fillText(title, x + 10, y + 17);
  }
}

function bar(ctx, x, y, w, h, frac, color, bg = '#1a2016') {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  ctx.strokeStyle = '#00000066';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Mouse position in CSS pixels — the space every UI element is laid out in. */
export const uiMouse = () => {
  const s = G.dpr || 1;
  return { x: Input.mouse.x / s, y: Input.mouse.y / s };
};

const inside = (x, y, w, h) => {
  const m = uiMouse();
  return m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
};

/** Immediate-mode button. Returns true on the frame it is clicked. */
function button(ctx, x, y, w, h, label, opts = {}) {
  const { enabled = true, sub = null, color = C.text, small = false } = opts;
  const hot = inside(x, y, w, h);
  const clicked = hot && enabled && Input.mousePressed;

  ctx.fillStyle = !enabled ? 'rgba(30,34,26,0.7)' : hot ? 'rgba(90,120,66,0.45)' : 'rgba(30,40,24,0.75)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = !enabled ? '#333d2a' : hot ? C.borderHi : C.border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.font = `bold ${small ? 11 : 12}px "Courier New", monospace`;
  ctx.fillStyle = enabled ? color : '#5c6650';
  ctx.fillText(label, x + 9, y + (sub ? 16 : h / 2 + 4));
  if (sub) {
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = enabled ? C.dim : '#4c5544';
    ctx.fillText(sub, x + 9, y + 29);
  }
  if (clicked) sfx('ui');
  return clicked;
}

function costString(cost) {
  return Object.entries(cost)
    .map(([id, n]) => `${RES[id] ? RES[id].short : id} ${n}`)
    .join('  ');
}

function costAffordable(cost) {
  return canAfford(cost);
}

// -------------------------------------------------------------------- entry --

export function drawHUD(ctx, deviceW, deviceH) {
  hitboxes.length = 0;
  // The whole UI is authored in CSS pixels and scaled up for HiDPI displays,
  // so text stays legible regardless of devicePixelRatio.
  const S = G.dpr || 1;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const W = deviceW / S, H = deviceH / S;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const p = G.player;
  G.ui.dangerTier = dangerAtPx(G.world, p.x, p.y);

  drawVitals(ctx, W, H);
  drawWeaponBar(ctx, W, H);
  drawThreat(ctx, W, H);
  drawResourceStrip(ctx, W, H);
  drawMinimap(ctx, W, H);
  drawNotifications(ctx, W, H);
  drawTopCentre(ctx, W, H);
  drawOffscreenMarkers(ctx, W, H);
  if (G.ui.buildMode) drawBuildBar(ctx, W, H);

  if (G.ui.panel === 'char') drawCharPanel(ctx, W, H);
  else if (G.ui.panel === 'craft') drawCraftPanel(ctx, W, H);
  else if (G.ui.panel === 'map') drawMapPanel(ctx, W, H);
  else if (G.ui.panel === 'levelup') drawLevelUp(ctx, W, H);

  if (p.dead) drawDeath(ctx, W, H);
  if (G.paused) drawPause(ctx, W, H);

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

  // Armour + carry load
  ctx.font = '11px "Courier New", monospace';
  const arm = p.armor ? ARMORS[p.armor] : null;
  ctx.fillStyle = arm ? C.accent : C.dim;
  ctx.fillText(arm ? `ARMOUR ${Math.round(arm.dr * 100)}%` : 'NO ARMOUR', x, y + 58);

  const load = bagLoad(p);
  ctx.fillStyle = load > 1 ? C.warn : load > 0.8 ? C.gold : C.dim;
  ctx.textAlign = 'right';
  ctx.fillText(`LOAD ${Math.round(load * 100)}%`, x + w, y + 58);
  ctx.textAlign = 'left';

  // Consumables
  const bandages = p.items.bandage || 0, kits = p.items.medkit || 0;
  ctx.fillStyle = bandages + kits > 0 ? C.text : C.dim;
  ctx.fillText(`Q  HEAL   bandage ${bandages}   medkit ${kits}`, x, y + 74);

  if (p.pendingLevels > 0) {
    ctx.fillStyle = C.gold;
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillText(`▲ ${p.pendingLevels} UPGRADE READY`, x, y + 100);
  }
}

// ------------------------------------------------------------- weapon strip --

function drawWeaponBar(ctx, W, H) {
  const p = G.player;
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

  // Slot pips
  let sx = x + 200;
  ctx.font = 'bold 11px "Courier New", monospace';
  for (let i = 0; i < p.weapons.length; i++) {
    const sel = i === p.slot;
    ctx.fillStyle = sel ? 'rgba(143,174,106,0.4)' : 'rgba(20,26,16,0.8)';
    ctx.fillRect(sx, y - 2, 22, 22);
    ctx.strokeStyle = sel ? C.borderHi : C.border;
    ctx.strokeRect(sx + 0.5, y - 1.5, 21, 21);
    ctx.fillStyle = sel ? C.text : C.dim;
    ctx.fillText(`${i + 1}`, sx + 8, y + 13);
    sx += 26;
    if (sx > x + 300) break;
  }
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
    ctx.fillText('B BUILD   ·   C CRAFT   ·   TAB CHARACTER   ·   M MAP   ·   E INTERACT   ·   Q HEAL   ·   ESC MENU', cx, H - 14);
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

  ctx.fillStyle = C.bg;
  ctx.fillRect(x0 - 10, y - 26, Math.min(total + 20, W - 20), ch + 40);
  ctx.strokeStyle = C.borderHi;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 9.5, y - 25.5, Math.min(total + 20, W - 20) - 1, ch + 39);

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

    if (inside(x, y, cw, ch) && Input.mousePressed) { G.ui.buildIndex = i; sfx('ui'); }

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

function drawCharPanel(ctx, W, H) {
  const w = Math.min(760, W - 60), h = Math.min(520, H - 60);
  const x = (W - w) / 2, y = (H - h) / 2;
  panel(ctx, x, y, w, h, 'CHARACTER  —  TAB to close');
  const p = G.player;

  const col1 = x + 20, col2 = x + w / 2 + 10;
  let yy = y + 48;

  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('STATS', col1, yy);
  yy += 20;
  ctx.font = '12px "Courier New", monospace';
  const stats = [
    ['Level', p.level],
    ['Max Health', Math.round(p.maxHp)],
    ['Max Stamina', Math.round(p.maxStam)],
    ['Melee damage', `+${Math.round((p.meleeMul - 1) * 100)}%`],
    ['Firearm damage', `+${Math.round((p.gunMul - 1) * 100)}%`],
    ['Reload speed', `+${Math.round((1 / p.reloadMul - 1) * 100)}%`],
    ['Move speed', `+${Math.round((p.speedMul - 1) * 100)}%`],
    ['Carry capacity', p.carryCap],
    ['Loot yield', `+${Math.round((p.lootMul - 1) * 100)}%`],
    ['Structure HP', `+${Math.round((p.structHpMul - 1) * 100)}%`],
    ['Build cost', `-${Math.round((1 - p.buildCostMul) * 100)}%`],
    ['Threat generated', `-${Math.round((1 - p.threatMul) * 100)}%`],
  ];
  for (const [k, v] of stats) {
    ctx.fillStyle = C.dim;
    ctx.fillText(k, col1, yy);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(`${v}`, col1 + 300, yy);
    ctx.textAlign = 'left';
    yy += 17;
  }

  yy += 8;
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('RUN', col1, yy);
  yy += 18;
  ctx.font = '12px "Courier New", monospace';
  const runStats = [
    ['Time survived', clock(G.time)],
    ['Kills', G.stats.kills],
    ['Containers looted', G.stats.looted],
    ['Structures built', G.stats.built],
    ['Items crafted', G.stats.crafted],
    ['Raids repelled', G.raidsDone],
    ['Deaths', G.stats.deaths],
  ];
  for (const [k, v] of runStats) {
    ctx.fillStyle = C.dim;
    ctx.fillText(k, col1, yy);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(`${v}`, col1 + 300, yy);
    ctx.textAlign = 'left';
    yy += 17;
  }

  // Upgrades owned
  let ry = y + 48;
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('UPGRADES', col2, ry);
  ry += 20;
  ctx.font = '11px "Courier New", monospace';
  let any = false;
  for (const u of UPGRADES) {
    const n = p.upgrades[u.id] || 0;
    if (!n) continue;
    any = true;
    ctx.fillStyle = C.accent;
    ctx.fillText(`${u.name} ${n > 1 ? `x${n}` : ''}`, col2, ry);
    ctx.fillStyle = C.dim;
    ctx.fillText(u.desc, col2 + 4, ry + 13);
    ry += 30;
  }
  if (!any) {
    ctx.fillStyle = C.dim;
    ctx.fillText('None yet — level up to choose.', col2, ry);
    ry += 24;
  }

  // Loadout
  ry += 10;
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = C.borderHi;
  ctx.fillText('LOADOUT', col2, ry);
  ry += 20;
  ctx.font = '11px "Courier New", monospace';
  for (let i = 0; i < p.weapons.length; i++) {
    const wd = WEAPONS[p.weapons[i]];
    ctx.fillStyle = i === p.slot ? C.gold : C.text;
    ctx.fillText(`${i + 1}. ${wd.name}`, col2, ry);
    ctx.fillStyle = C.dim;
    ctx.fillText(wd.kind === 'gun' ? `${wd.dmg}dmg x${wd.pellets || 1}  mag ${wd.mag}` : `${wd.dmg} dmg`, col2 + 180, ry);
    ry += 16;
  }
  ry += 6;
  for (const id in p.items) {
    if (!p.items[id]) continue;
    ctx.fillStyle = CONSUMABLES[id] ? CONSUMABLES[id].color : C.text;
    ctx.fillText(`${CONSUMABLES[id]?.name || id} x${p.items[id]}`, col2, ry);
    ry += 15;
  }
}

// ------------------------------------------------------------- craft panel ---

function drawCraftPanel(ctx, W, H) {
  const w = Math.min(720, W - 60), h = Math.min(620, H - 50);
  const x = (W - w) / 2, y = (H - h) / 2;

  const bench = nearWorkbench(G.player.x, G.player.y);
  const tier = bench ? bench.tier : 0;
  panel(ctx, x, y, w, h, `CRAFTING  —  ${bench ? `Workbench ${tier === 2 ? 'II' : 'I'} in range` : 'no workbench nearby'}  —  C to close`);

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
      upgradeBench(bench);
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
      craft(r, tier);
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

// ---------------------------------------------------------------- level up ---

function drawLevelUp(ctx, W, H) {
  const choices = G.ui.levelChoices || [];
  ctx.fillStyle = 'rgba(6,8,5,0.8)';
  ctx.fillRect(0, 0, W, H);

  const cw = 260, ch = 190, gap = 20;
  const total = choices.length * cw + (choices.length - 1) * gap;
  const x0 = (W - total) / 2;
  const y = H / 2 - ch / 2;

  ctx.textAlign = 'center';
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.fillStyle = C.gold;
  ctx.fillText(`LEVEL ${G.player.level}`, W / 2, y - 60);
  ctx.font = '13px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('Choose an upgrade — click or press 1 / 2 / 3', W / 2, y - 36);
  ctx.textAlign = 'left';

  for (let i = 0; i < choices.length; i++) {
    const u = choices[i];
    const x = x0 + i * (cw + gap);
    const hot = inside(x, y, cw, ch);

    ctx.fillStyle = hot ? 'rgba(90,120,66,0.5)' : 'rgba(20,26,16,0.94)';
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = hot ? C.gold : C.border;
    ctx.lineWidth = hot ? 3 : 2;
    ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);

    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = { COMBAT: '#e0704a', SCAVENGING: '#e8c86a', BUILDING: '#59b8c4', SURVIVAL: '#8fd07a' }[u.cat] || C.dim;
    ctx.fillText(u.cat, x + 16, y + 28);

    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillStyle = C.text;
    ctx.fillText(u.name, x + 16, y + 62);

    ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    wrapText(ctx, u.desc, x + 16, y + 92, cw - 32, 16);

    const owned = G.player.upgrades[u.id] || 0;
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText(`owned ${owned} / ${u.max}`, x + 16, y + ch - 34);

    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.fillStyle = C.gold;
    ctx.fillText(`${i + 1}`, x + cw - 30, y + ch - 20);

    if (hot && Input.mousePressed) chooseUpgrade(u.id);
  }
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

export const pauseActions = { restart: false, clear: false };

function drawPause(ctx, W, H) {
  ctx.fillStyle = 'rgba(6,8,5,0.82)';
  ctx.fillRect(0, 0, W, H);
  const w = 380, h = 300;
  const x = (W - w) / 2, y = (H - h) / 2;
  panel(ctx, x, y, w, h, 'PAUSED');

  ctx.textAlign = 'center';
  ctx.font = 'bold 26px "Courier New", monospace';
  ctx.fillStyle = C.accent;
  ctx.fillText('DEADLINE', W / 2, y + 62);
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText(`Level ${G.player.level}   ·   ${G.stats.kills} kills   ·   ${G.raidsDone} raids   ·   ${clock(G.time)}`, W / 2, y + 84);
  ctx.textAlign = 'left';

  const bw = w - 60, bx = x + 30;
  let by = y + 106;
  if (button(ctx, bx, by, bw, 34, 'RESUME  (ESC)')) { G.paused = false; }
  by += 44;
  if (button(ctx, bx, by, bw, 34, 'SAVE GAME  (F5)')) { pauseActions.save = true; }
  by += 44;
  if (button(ctx, bx, by, bw, 34, 'NEW GAME — abandons this run', { color: C.warn })) { pauseActions.restart = true; }
  by += 44;
  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'center';
  ctx.fillText('P mutes audio  ·  autosaves every 25s', W / 2, by + 16);
  ctx.textAlign = 'left';
}

// ------------------------------------------------------------------- cursor --

function drawCursor(ctx) {
  const { x, y } = uiMouse();
  const p = G.player;
  const spread = p && !p.dead ? clamp((currentWeapon(p).spread || 0) * p.spreadMul * 260 + p.recoil * 200, 4, 46) : 8;

  ctx.save();
  ctx.strokeStyle = G.ui.buildMode ? '#b7e08a' : 'rgba(232,240,216,0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, TAU);
  ctx.stroke();
  const s = spread;
  ctx.globalAlpha = 0.75;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * s, y + dy * s);
    ctx.lineTo(x + dx * (s + 7), y + dy * (s + 7));
    ctx.stroke();
  }
  ctx.restore();
}
