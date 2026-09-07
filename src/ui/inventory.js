// The inventory screen: pack grid, five equipment slots, hotbar, weight bar,
// and drag and drop between all of them.
//
// Drawn in the same immediate-mode style as the rest of the UI, with one piece
// of persistent state — the stack currently under the cursor. Immediate mode
// and dragging coexist fine as long as the drag lives outside the frame: press
// picks a stack up, release puts it down on whatever is under the pointer.

import { GEAR, GEAR_SLOTS, GEAR_SLOT_NAMES, WEAPONS } from '../game/config.js';
import { G, notify, lightActive } from '../game/state.js';
import { primaryLabel } from '../core/bindings.js';
import { itemDef, stackLimit } from '../game/items.js';
import { carriedWeight } from '../game/player.js';
// Every change to what the player carries goes through the action seam: a
// direct call in solo and on the host, a command to the host on a guest.
import { act } from '../net/actions.js';
import { Input } from '../core/input.js';
import { clamp } from '../core/util.js';
import { sfx } from '../core/audio.js';

const COLS = 6;
const CELL = 46;
const GAP = 4;

const C = {
  slot: 'rgba(30,40,24,0.75)',
  slotHi: 'rgba(90,120,66,0.45)',
  slotGear: 'rgba(24,30,18,0.8)',
  border: '#4a5a38',
  borderHi: '#8fae6a',
  text: '#d5e4c2',
  dim: '#7d8f68',
  gold: '#e8c86a',
  warn: '#e05a4a',
  accent: '#b7e08a',
};

/**
 * The stack being dragged, or null. Held at module scope because a drag spans
 * frames; everything else about this screen is rebuilt every frame.
 */
let drag = null;

/**
 * The hit rects from the last frame, in CSS pixels. Published so the browser
 * test can aim real mouse events at real slots rather than re-deriving this
 * file's layout maths — a test that computes its own coordinates stops testing
 * the layout the moment the layout changes.
 */
export let lastZones = [];

export const isDragging = () => !!drag;

/** Drops the drag without losing the stack — the panel closing must not eat it. */
export function cancelDrag() {
  drag = null;
}

// ------------------------------------------------------------------ layout ---

function slotRects(x, y, count, cols = COLS) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      i,
      x: x + (i % cols) * (CELL + GAP),
      y: y + Math.floor(i / cols) * (CELL + GAP),
      w: CELL,
      h: CELL,
    });
  }
  return out;
}

function hitZone(zones, mx, my) {
  for (const z of zones) {
    if (mx >= z.x && mx <= z.x + z.w && my >= z.y && my <= z.y + z.h) return z;
  }
  return null;
}

// ----------------------------------------------------------------- drawing ---

/** A blocky glyph per item kind, so a slot reads without any art. */
function drawStack(ctx, r, stack, dim = false) {
  const it = itemDef(stack.id);
  if (!it) return;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;

  ctx.globalAlpha = dim ? 0.35 : 1;
  ctx.fillStyle = it.color || '#9aa2ab';
  if (it.kind === 'res') {
    ctx.fillRect(cx - 11, cy - 9, 22, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(cx - 11, cy - 9, 22, 5);
  } else if (it.kind === 'weapon') {
    ctx.fillRect(cx - 13, cy - 3, 26, 6);
    ctx.fillRect(cx + 4, cy - 8, 6, 11);
  } else if (it.kind === 'gear') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 11);
    ctx.lineTo(cx + 10, cy - 5);
    ctx.lineTo(cx + 10, cy + 6);
    ctx.lineTo(cx, cy + 12);
    ctx.lineTo(cx - 10, cy + 6);
    ctx.lineTo(cx - 10, cy - 5);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(cx - 6, cy - 2.5, 12, 5);
    ctx.fillRect(cx - 2.5, cy - 6, 5, 12);
  }

  if (stack.n > 1) {
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0c100a';
    ctx.fillText(String(stack.n), r.x + r.w - 3, r.y + r.h - 3);
    ctx.fillStyle = C.text;
    ctx.fillText(String(stack.n), r.x + r.w - 4, r.y + r.h - 4);
    ctx.textAlign = 'left';
  }
  ctx.globalAlpha = 1;
}

function drawSlot(ctx, r, stack, opts = {}) {
  const { hot = false, label = null, selected = false, dimStack = false } = opts;
  ctx.fillStyle = hot ? C.slotHi : label ? C.slotGear : C.slot;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = selected ? C.gold : hot ? C.borderHi : C.border;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

  if (!stack && label) {
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = '#55603f';
    ctx.textAlign = 'center';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 3);
    ctx.textAlign = 'left';
  }
  if (stack) drawStack(ctx, r, stack, dimStack);
}

// ------------------------------------------------------------------- drag ---

function beginDrag(p, zone) {
  if (zone.kind === 'equip') {
    const id = p.equip[zone.slot];
    if (id) drag = { from: zone, stack: { id, n: 1 } };
    return;
  }
  const cont = zone.kind === 'bag' ? p.bag : p.hotbar;
  const s = cont.slots[zone.i];
  if (s) drag = { from: zone, stack: s };
}

function endDrag(p, zone) {
  if (!drag) return;
  const from = drag.from;
  drag = null;

  // Released over open space: put it back rather than dropping it. Scattering
  // your ammunition on the floor should take a deliberate button, not a slip.
  if (!zone) return;
  if (zone.kind === from.kind && zone.i === from.i && zone.slot === from.slot) return;

  if (from.kind === 'equip') {
    if (zone.kind === 'equip') return;
    // Taking a piece off into a cell; swaps only with a piece for the same slot.
    act.unequipTo(from.slot, zone.kind, zone.i);
    return;
  }

  if (zone.kind === 'equip') {
    const cont = from.kind === 'bag' ? p.bag : p.hotbar;
    const s = cont.slots[from.i];
    if (!s) return;
    const g = GEAR[s.id];
    if (!g || g.slot !== zone.slot) {
      sfx('deny');
      notify(`That is not worn on your ${GEAR_SLOT_NAMES[zone.slot].toLowerCase()}`, '#c96a5a');
      return;
    }
    act.equipFromSlot(from.kind, from.i, zone.slot);
    return;
  }

  // Raw materials and ammunition are refused by the hotbar. Every consumer of
  // them — reloading, crafting, build costs — reads the pack and the stash, so
  // a stack parked on the hotbar would still cost carry weight while being
  // invisible to the things that need it. The hotbar is for what you use.
  if (zone.kind === 'hotbar' && !hotbarAccepts(p, from)) {
    sfx('deny');
    notify('The hotbar is for weapons and supplies, not materials', '#c96a5a');
    return;
  }

  act.moveStack(from.kind, from.i, zone.kind, zone.i);
}

/** Whether the stack being dragged is something the hotbar will hold. */
function hotbarAccepts(p, from) {
  const cont = from.kind === 'bag' ? p.bag : p.hotbar;
  const s = cont.slots[from.i];
  if (!s) return true;
  const it = itemDef(s.id);
  return !it || it.kind !== 'res';
}

// ------------------------------------------------------------------ panel ---

/**
 * Draws the screen and resolves its own input. The shared drawing helpers
 * arrive in `ui` from hud.js, so the two files keep one visual style without
 * either importing the other.
 */
export function drawInventoryPanel(ctx, W, H, ui) {
  const { panel, button, claim, uiMouse, mouseDown, mouseUp } = ui;
  const p = G.player;
  if (!p) return;

  const w = Math.min(780, W - 60);
  const h = Math.min(580, H - 50);
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  claim(x, y, w, h);
  panel(ctx, x, y, w, h, 'INVENTORY  —  drag to move  ·  I or ESC to close');

  const m = uiMouse();
  const zones = [];
  const isHot = (r) => m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;

  // -------------------------------------------------------------- equipped --
  const eqX = x + 20;
  let eqY = y + 54;
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('EQUIPPED', eqX, eqY - 8);

  for (const slot of GEAR_SLOTS) {
    const r = { x: eqX, y: eqY, w: CELL, h: CELL, kind: 'equip', slot, i: -1 };
    const id = p.equip[slot];
    const dragged = drag && drag.from.kind === 'equip' && drag.from.slot === slot;
    drawSlot(ctx, r, id ? { id, n: 1 } : null, {
      hot: isHot(r), label: GEAR_SLOT_NAMES[slot].toUpperCase(), dimStack: dragged,
    });

    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = id ? C.text : C.dim;
    ctx.fillText(id ? GEAR[id].name : 'empty', eqX + CELL + 10, eqY + 19);
    if (id) {
      const g = GEAR[id];
      ctx.fillStyle = C.accent;
      // A light is not armour: say what it does instead of "+0% armour".
      ctx.fillText(
        g.light
          ? `${lightActive(p) ? 'lit' : 'out'}  ${Math.max(0, Math.round(p.lightFuel))}s  ·  ${primaryLabel('light')}`
          : `+${Math.round(g.dr * 100)}% armour`,
        eqX + CELL + 10, eqY + 33,
      );
    }
    zones.push(r);
    eqY += CELL + GAP;
  }

  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = p.armorDR > 0 ? C.accent : C.dim;
  ctx.fillText(`TOTAL ARMOUR  ${Math.round((p.armorDR || 0) * 100)}%`, eqX, eqY + 16);
  if (button(ctx, eqX, eqY + 26, 168, 26, 'EQUIP BEST', { small: true })) act.equipBest();

  // ------------------------------------------------------------------ pack --
  const gridX = x + 268;
  const gridY = y + 54;
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('PACK', gridX, gridY - 8);

  for (const r of slotRects(gridX, gridY, p.bag.slots.length)) {
    r.kind = 'bag';
    const dragged = drag && drag.from.kind === 'bag' && drag.from.i === r.i;
    drawSlot(ctx, r, p.bag.slots[r.i], { hot: isHot(r), dimStack: dragged });
    zones.push(r);
  }

  const rows = Math.ceil(p.bag.slots.length / COLS);
  const gridBottom = gridY + rows * (CELL + GAP);
  const barW = COLS * (CELL + GAP) - GAP;

  // ---------------------------------------------------------------- weight --
  // Capacity is weight, not slot count: a pack of ammunition is not a pack of
  // scrap. The grid is finite too, but weight is normally what stops you.
  const weight = carriedWeight(p);
  const frac = weight / p.carryCap;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = frac > 1 ? C.warn : C.dim;
  ctx.fillText(`WEIGHT  ${weight.toFixed(1)} / ${Math.round(p.carryCap)}`, gridX, gridBottom + 12);
  ctx.fillStyle = '#1a2016';
  ctx.fillRect(gridX, gridBottom + 18, barW, 8);
  ctx.fillStyle = frac > 1 ? C.warn : frac > 0.85 ? C.gold : C.accent;
  ctx.fillRect(gridX, gridBottom + 18, barW * clamp(frac, 0, 1), 8);
  ctx.strokeStyle = '#00000066';
  ctx.lineWidth = 1;
  ctx.strokeRect(gridX + 0.5, gridBottom + 18.5, barW - 1, 7);
  if (frac > 1) {
    ctx.fillStyle = C.warn;
    ctx.fillText('OVERLOADED', gridX + barW + 12, gridBottom + 26);
  }

  // ---------------------------------------------------------------- hotbar --
  const hbY = gridBottom + 52;
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('HOTBAR  —  keys 1-6 select what you are holding', gridX, hbY - 8);
  for (const r of slotRects(gridX, hbY, p.hotbar.slots.length, p.hotbar.slots.length)) {
    r.kind = 'hotbar';
    const dragged = drag && drag.from.kind === 'hotbar' && drag.from.i === r.i;
    drawSlot(ctx, r, p.hotbar.slots[r.i], {
      hot: isHot(r), selected: r.i === p.slot, dimStack: dragged,
    });
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText(String(r.i + 1), r.x + 3, r.y + 11);
    zones.push(r);
  }

  // ----------------------------------------------------------------- input --
  const over = hitZone(zones, m.x, m.y);
  if (mouseDown() && over && !drag) beginDrag(p, over);
  if (mouseUp() && drag) endDrag(p, over);
  if (Input.rightPressed && over && !drag) quickAction(p, over);

  // ------------------------------------------------------------ drop, help --
  const hoverStack = over && over.kind !== 'equip'
    ? (over.kind === 'bag' ? p.bag : p.hotbar).slots[over.i]
    : null;
  if (button(ctx, x + w - 152, y + h - 40, 132, 26, 'DROP HOVERED', {
    small: true, enabled: !!hoverStack, color: C.warn,
  }) && hoverStack) {
    act.dropStack(over.kind, over.i, true);
  }

  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('right click: wear gear · move between pack and hotbar', x + 20, y + h - 22);

  // Tooltip after everything else so nothing paints over it.
  if (over && !drag) {
    const id = over.kind === 'equip' ? p.equip[over.slot] : hoverStack ? hoverStack.id : null;
    if (id) drawTooltip(ctx, id, m.x, m.y, x, y, w, h);
  }

  if (drag) {
    ctx.globalAlpha = 0.92;
    drawSlot(ctx, { x: m.x - CELL / 2, y: m.y - CELL / 2, w: CELL, h: CELL }, drag.stack, {});
    ctx.globalAlpha = 1;
  }

  lastZones = zones;
}

/** Right click: wear it, or send it between pack and hotbar. */
function quickAction(p, zone) {
  if (zone.kind === 'equip') { act.unequip(zone.slot); return; }
  const cont = zone.kind === 'bag' ? p.bag : p.hotbar;
  const s = cont.slots[zone.i];
  if (!s) return;
  const it = itemDef(s.id);
  if (!it) return;

  if (it.kind === 'gear') {
    if (zone.kind === 'bag') { act.equipFromBag(zone.i); return; }
    const free = p.bag.slots.findIndex((v) => !v);
    if (free < 0) { sfx('deny'); notify('No room in your pack', '#c96a5a'); return; }
    act.moveStack('hotbar', zone.i, 'bag', free);
    act.equipFromBag(free);
    return;
  }

  const toKind = zone.kind === 'bag' ? 'hotbar' : 'bag';
  const to = toKind === 'bag' ? p.bag : p.hotbar;
  let target = to.slots.findIndex((t) => t && t.id === s.id && t.n < stackLimit(s.id));
  if (target < 0) target = to.slots.findIndex((t) => !t);
  if (target < 0) { sfx('deny'); notify('No room', '#c96a5a'); return; }
  act.moveStack(zone.kind, zone.i, toKind, target);
}

function drawTooltip(ctx, id, mx, my, px, py, pw, ph) {
  const it = itemDef(id);
  if (!it) return;
  const lines = [it.name];
  if (it.kind === 'gear') {
    const g = GEAR[id];
    lines.push(`${GEAR_SLOT_NAMES[g.slot]}  ·  +${Math.round(g.dr * 100)}% armour`);
  } else if (it.kind === 'weapon') {
    const wd = WEAPONS[id];
    lines.push(`${wd.kind === 'gun' ? 'Firearm' : 'Melee'}  ·  ${wd.dmg} damage`);
  } else if (it.kind === 'consumable' && it.def.heal > 0) {
    lines.push(`Heals ${it.def.heal}`);
  } else if (it.kind === 'res') {
    lines.push(`Stacks to ${it.stack}`);
  }
  lines.push(`${it.wt} weight each`);

  ctx.font = '11px "Courier New", monospace';
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
  const bw = tw + 16;
  const bh = lines.length * 14 + 10;
  let bx = mx + 14;
  let by = my + 14;
  if (bx + bw > px + pw) bx = mx - bw - 8;
  if (by + bh > py + ph) by = my - bh - 8;

  ctx.fillStyle = 'rgba(8,11,7,0.96)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = C.borderHi;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.fillStyle = C.text;
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillText(lines[0], bx + 8, by + 16);
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  for (let i = 1; i < lines.length; i++) ctx.fillText(lines[i], bx + 8, by + 16 + i * 14);
}
