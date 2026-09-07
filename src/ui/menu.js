// The title screen and its sub-screens — new game, save slots, multiplayer,
// controls — and the controls panel the pause menu opens in-game. Drawn with
// the same immediate-mode kit as the HUD, on its own backdrop: no world exists
// yet when this is on screen.
//
// Every button's rectangle is recorded in G.menu.rects under its label, so the
// browser suite can drive the menu with real synthetic clicks.

import { G, notify } from '../game/state.js';
import { Input, keyTap } from '../core/input.js';
import { newGame, toTitle } from '../game/game.js';
import { seedLoot } from '../game/loot.js';
import {
  listSlots, latestSlot, createSlot, deleteSlot, loadSlot, saveToSlot, defaultName, slotById,
  slotPayloadVersion,
  playtimeLabel, whenLabel,
} from '../game/saves.js';
import {
  ACTIONS, GROUPS, actionLabel, conflictsFor, rebind, resetBinds, saveBinds, pressedBindable,
  ACTION_BY_ID, isDefault,
} from '../core/bindings.js';
import { C, panel, button, beginUiFrame, drawCursor, inside, clicked } from './kit.js';
import { makeRng, clamp } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { startHosting, stopHosting } from '../net/host.js';
import { joinGame, leaveGame } from '../net/client.js';
import { hashPassword, loadIdentity, saveIdentity, normaliseCode, isRoomCode } from '../net/protocol.js';

const VERSION = '1.0.0';

// --------------------------------------------------------------- text fields --
// Real <input>s, positioned over the canvas when a screen needs typing and
// hidden otherwise. A canvas text box is not worth writing. Each screen names
// its fields ('name', 'code', 'password'); only the ones it shows are visible.

const fields = new Map();      // key -> input element
const submitted = new Set();   // keys whose field saw Enter this frame
const shownThisFrame = new Set();

function ensureField(key) {
  if (typeof document === 'undefined') return null;
  let f = fields.get(key);
  if (f) return f;
  f = document.createElement('input');
  f.id = key === 'name' ? 'deadline-textfield' : `deadline-textfield-${key}`;
  f.className = 'deadline-textfield';
  f.type = key === 'password' ? 'password' : 'text';
  f.maxLength = key === 'code' ? 6 : 24;
  f.autocomplete = 'off';
  f.spellcheck = false;
  f.dataset.key = key;
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { submitted.add(key); e.preventDefault(); }
  });
  document.body.appendChild(f);
  fields.set(key, f);
  return f;
}

/** Shows a field at a CSS-pixel rectangle; focuses the first one shown on a screen. */
function textField(key, x, y, w, h, initial = '') {
  const f = ensureField(key);
  if (!f) return;
  shownThisFrame.add(key);
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  f.style.width = `${w}px`;
  f.style.height = `${h}px`;
  if (f.style.display !== 'block') {
    f.style.display = 'block';
    f.value = initial;
    if (shownThisFrame.size === 1) setTimeout(() => f.focus(), 0);
  }
}

/** Hides every field a screen did not draw this frame. Called once per frame. */
function settleFields() {
  for (const [key, f] of fields) {
    if (!shownThisFrame.has(key) && f.style.display === 'block') { f.style.display = 'none'; f.blur(); }
  }
  shownThisFrame.clear();
}

export function hideField() {
  for (const f of fields.values()) { f.style.display = 'none'; f.blur(); }
  submitted.clear();
}

const takeSubmit = (key) => { const had = submitted.has(key); submitted.delete(key); return had; };
export const fieldValue = (key = 'name') => { const f = fields.get(key); return f ? f.value : ''; };
export function setFieldValue(v, key = 'name') { const f = ensureField(key); if (f) f.value = v; }

// ---------------------------------------------------------------- backdrop --

const dots = (() => {
  const r = makeRng(0x7E11);
  const out = [];
  for (let i = 0; i < 140; i++) out.push([r(), r(), 0.4 + r() * 1.6, 0.05 + r() * 0.12]);
  return out;
})();

function drawBackdrop(ctx, W, H) {
  ctx.fillStyle = '#0a0c09';
  ctx.fillRect(0, 0, W, H);
  // A faint tile grid, like the ground seen from very high up.
  ctx.strokeStyle = 'rgba(143,174,106,0.045)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
  for (const [fx, fy, r, a] of dots) {
    ctx.fillStyle = `rgba(183,224,138,${a})`;
    ctx.beginPath();
    ctx.arc(fx * W, fy * H, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dark vignette so the panels sit in a pool of light.
  const grd = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.9);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
}

function title(ctx, W, y, big = true) {
  ctx.textAlign = 'center';
  ctx.font = `bold ${big ? 64 : 30}px "Courier New", monospace`;
  ctx.fillStyle = '#000000aa';
  ctx.fillText('DEADLINE', W / 2 + 3, y + 3);
  ctx.fillStyle = C.accent;
  ctx.fillText('DEADLINE', W / 2, y);
  if (big) {
    ctx.font = '13px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText('a dead town, a horde, and whatever you can build before dark', W / 2, y + 28);
  }
  ctx.textAlign = 'left';
}

/** A button that also records where it was, for the tests. */
function menuButton(ctx, key, x, y, w, h, label, opts) {
  G.menu.rects[key] = { x, y, w, h };
  return button(ctx, x, y, w, h, label, opts);
}

function footer(ctx, W, H, text) {
  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, H - 16);
  ctx.textAlign = 'left';
}

function goto(screen) {
  hideField();
  G.menu.screen = screen;
  G.menu.pendingRebind = null;
  G.menu.confirmDelete = null;
  G.menu.error = null;
  G.menu.scroll = 0;
}

// ------------------------------------------------------------------ screens --

/**
 * Why a slot would not load. Almost always because the world changed shape
 * under it — saying which version it is beats "that save could not be loaded".
 */
export function staleReason(id) {
  const v = slotPayloadVersion(id);
  if (v === null) return 'that save is missing or unreadable';
  if (v !== G.version) {
    return `that save is from an older build (v${v}, this is v${G.version}) — the map changed, so it cannot be loaded`;
  }
  return 'that save could not be loaded';
}

function drawMain(ctx, W, H) {
  title(ctx, W, H * 0.3);
  const latest = latestSlot();
  const bw = 340, bh = 44, gap = 12;
  const bx = W / 2 - bw / 2;
  let by = H * 0.42;

  const cont = latest
    ? `${latest.name}  ·  Day ${latest.day}  ·  Level ${latest.level}  ·  ${playtimeLabel(latest.playtime)}`
    : 'no saved games yet';
  if (menuButton(ctx, 'CONTINUE', bx, by, bw, bh, 'CONTINUE', { enabled: !!latest, sub: cont })) {
    if (loadSlot(latest.id)) {
      seedLoot((G.world.seed ^ 0x9E3779B9) >>> 0);
    } else {
      // Silently starting a *new* world here reads as "CONTINUE lost my game".
      G.menu.error = staleReason(latest.id);
    }
  }
  drawMenuError(ctx, bx, by - 12, bw);
  by += bh + gap;
  if (menuButton(ctx, 'NEW GAME', bx, by, bw, bh, 'NEW GAME', { sub: 'a fresh town, in its own save slot' })) {
    goto('new');
  }
  by += bh + gap;
  const n = listSlots().length;
  if (menuButton(ctx, 'LOAD GAME', bx, by, bw, bh, 'LOAD GAME', {
    enabled: n > 0, sub: n ? `${n} saved game${n === 1 ? '' : 's'}` : 'nothing to load',
  })) goto('slots');
  by += bh + gap;
  if (menuButton(ctx, 'MULTIPLAYER', bx, by, bw, bh, 'MULTIPLAYER', { sub: 'online co-op — host or join' })) goto('multi');
  by += bh + gap;
  if (menuButton(ctx, 'CONTROLS', bx, by, bw, bh, 'CONTROLS', { sub: 'see and change every key' })) goto('controls');

  footer(ctx, W, H, `v${VERSION}   ·   saves live in this browser   ·   Esc goes back`);
}

function drawNew(ctx, W, H) {
  title(ctx, W, H * 0.22);
  const w = 440, h = 232;
  const x = (W - w) / 2, y = H * 0.36;
  panel(ctx, x, y, w, h, 'NEW GAME');

  ctx.font = '12px "Courier New", monospace';
  ctx.fillStyle = C.text;
  ctx.fillText('Name this game', x + 20, y + 58);
  ctx.fillStyle = C.dim;
  ctx.font = '10px "Courier New", monospace';
  ctx.fillText('It gets its own save slot. You can have as many as you like.', x + 20, y + 76);

  textField('name', x + 20, y + 90, w - 40, 32, defaultName('solo'));

  const bw = (w - 52) / 2;
  const start = menuButton(ctx, 'START', x + 20, y + 146, bw, 40, 'START', { center: true, color: C.accent });
  const back = menuButton(ctx, 'BACK', x + 32 + bw, y + 146, bw, 40, 'BACK', { center: true });
  if (start || takeSubmit('name')) {
    const name = fieldValue('name').trim() || defaultName('solo');
    const slot = createSlot(name, 'solo');
    hideField();
    newGame(Math.floor(Math.random() * 0x7fffffff));
    G.slotId = slot.id;
    saveToSlot(slot.id);
  } else if (back) {
    goto('main');
  }
  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'center';
  ctx.fillText('Enter starts', W / 2, y + h - 14);
  ctx.textAlign = 'left';
}

/** The one place a menu error is drawn on the title and slot screens. */
function drawMenuError(ctx, x, y, w) {
  if (!G.menu.error) return;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.warn;
  ctx.fillText(G.menu.error, x, y);
  ctx.font = '12px "Courier New", monospace';
}

function drawSlots(ctx, W, H) {
  title(ctx, W, 64, false);
  const slots = listSlots();
  drawSlotsBody(ctx, W, H, slots);
}

function drawSlotsBody(ctx, W, H, slots) {
  const w = Math.min(680, W - 40);
  const rowH = 58;
  const listH = Math.min(slots.length * rowH, H - 260);
  const h = listH + 120;
  const x = (W - w) / 2, y = 96;
  panel(ctx, x, y, w, h, 'SAVED GAMES');

  // Scroll when there are more rows than fit.
  const maxScroll = Math.max(0, slots.length * rowH - listH);
  if (Input.wheel !== 0 && inside(x, y, w, h)) {
    G.menu.scroll = clamp(G.menu.scroll + Input.wheel * rowH, 0, maxScroll);
  }
  G.menu.scroll = clamp(G.menu.scroll, 0, maxScroll);

  // While the delete confirmation is up, everything behind it is inert: a
  // click meant for KEEP must not also land on a LOAD underneath.
  const modal = !!G.menu.confirmDelete;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y + 32, w, listH);
  ctx.clip();
  let ry = y + 32 - G.menu.scroll;
  for (const s of slots) {
    const current = s.id === G.slotId;
    if (ry + rowH >= y + 32 && ry <= y + 32 + listH) {
      ctx.fillStyle = current ? 'rgba(143,174,106,0.10)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(x + 8, ry + 4, w - 16, rowH - 8);
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillStyle = C.text;
      ctx.fillText(s.name, x + 20, ry + 24);
      ctx.font = '10px "Courier New", monospace';
      ctx.fillStyle = C.dim;
      const mode = s.mode === 'coop' ? 'Co-op world' : 'Solo';
      ctx.fillText(
        `${mode}  ·  Day ${s.day}  ·  Level ${s.level}  ·  ${s.kills} kills  ·  ${playtimeLabel(s.playtime)}  ·  ${whenLabel(s.updated)}`,
        x + 20, ry + 42,
      );
      const bx = x + w - 20 - 84 * 2;
      if (menuButton(ctx, `LOAD:${s.id}`, bx, ry + 13, 76, 32, 'LOAD', { center: true, color: C.accent, enabled: !modal })) {
        if (loadSlot(s.id)) seedLoot((G.world.seed ^ 0x9E3779B9) >>> 0);
        else G.menu.error = staleReason(s.id);   // a dead button is a bug report
      }
      if (menuButton(ctx, `DELETE:${s.id}`, bx + 84, ry + 13, 76, 32, 'DELETE', { center: true, color: C.warn, enabled: !modal })) {
        G.menu.confirmDelete = s.id;
      }
    }
    ry += rowH;
  }
  ctx.restore();

  drawMenuError(ctx, x + 20, y + h - 44, w - 40);

  if (slots.length === 0) {
    ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    ctx.fillText('No saved games.', W / 2, y + 60);
    ctx.textAlign = 'left';
  }

  if (menuButton(ctx, 'BACK', x + 20, y + h - 60, 120, 40, 'BACK', { center: true, enabled: !modal })) goto('main');
  if (menuButton(ctx, 'NEW GAME', x + w - 160, y + h - 60, 140, 40, 'NEW GAME', { center: true, enabled: !modal })) goto('new');

  if (G.menu.confirmDelete) drawConfirmDelete(ctx, W, H, slots.find((s) => s.id === G.menu.confirmDelete));
}

function drawConfirmDelete(ctx, W, H, slot) {
  if (!slot) { G.menu.confirmDelete = null; return; }
  ctx.fillStyle = 'rgba(6,8,5,0.7)';
  ctx.fillRect(0, 0, W, H);
  const w = 420, h = 170;
  const x = (W - w) / 2, y = (H - h) / 2;
  panel(ctx, x, y, w, h, 'DELETE SAVE');
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.fillStyle = C.text;
  ctx.fillText(`Delete "${slot.name}"?`, x + 20, y + 56);
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText(`Day ${slot.day}, level ${slot.level}, ${playtimeLabel(slot.playtime)} played. This cannot be undone.`, x + 20, y + 78);
  const bw = (w - 52) / 2;
  if (menuButton(ctx, 'DELETE', x + 20, y + 106, bw, 40, 'DELETE', { center: true, color: C.warn })) {
    deleteSlot(slot.id);
    G.menu.confirmDelete = null;
    sfx('build');
  }
  if (menuButton(ctx, 'KEEP', x + 32 + bw, y + 106, bw, 40, 'KEEP', { center: true })) {
    G.menu.confirmDelete = null;
  }
}

function drawMulti(ctx, W, H) {
  title(ctx, W, H * 0.22);
  const w = 460, h = 250;
  const x = (W - w) / 2, y = H * 0.36;
  panel(ctx, x, y, w, h, 'MULTIPLAYER');
  ctx.font = '12px "Courier New", monospace';
  ctx.fillStyle = C.text;
  ctx.fillText('Online co-op for up to four.', x + 20, y + 56);
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('One of you hosts and gets a room code; the others join with it.', x + 20, y + 76);
  ctx.fillText('Shared base, separate packs and levels, revive each other.', x + 20, y + 92);

  const bw = (w - 52) / 2;
  if (menuButton(ctx, 'HOST', x + 20, y + 118, bw, 44, 'HOST A GAME', { sub: 'your world, your code', center: true })) {
    G.menu.hostSlot = G.menu.hostSlot || 'new';
    G.menu.busy = false; G.menu.error = null;
    goto('host');
  }
  if (menuButton(ctx, 'JOIN', x + 32 + bw, y + 118, bw, 44, 'JOIN A GAME', { sub: 'with a friend\'s code', center: true })) {
    G.menu.busy = false; G.menu.error = null;
    goto('join');
  }
  if (menuButton(ctx, 'BACK', x + 20, y + h - 58, 120, 40, 'BACK', { center: true })) goto('main');
}

/** The identity this browser plays as: a stable id and the last name used. */
function identity() {
  const id = loadIdentity();
  if (!id.name) id.name = 'Survivor';
  return id;
}

function drawHost(ctx, W, H) {
  title(ctx, W, 64, false);
  const slots = listSlots().slice(0, 4);
  const w = Math.min(600, W - 40);
  const rowH = 46;
  const listH = (slots.length + 1) * rowH;
  const h = 292 + listH;
  const x = (W - w) / 2, y = 96;
  panel(ctx, x, y, w, h, 'HOST A GAME');
  const me = identity();
  const pad = 24;

  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('Your name', x + pad, y + 54);
  ctx.fillText('Password (optional)', x + w / 2 + 8, y + 54);
  textField('name', x + pad, y + 62, w / 2 - pad - 12, 32, me.name);
  textField('password', x + w / 2 + 8, y + 62, w / 2 - pad - 8, 32, '');

  ctx.fillStyle = C.dim;
  ctx.fillText('Which world', x + pad, y + 126);
  let ry = y + 134;
  const choose = (key, label, sub, id) => {
    const selected = G.menu.hostSlot === id;
    if (menuButton(ctx, key, x + pad, ry, w - pad * 2, rowH - 6, (selected ? '● ' : '○ ') + label, { sub, small: true, color: selected ? C.accent : C.text })) {
      G.menu.hostSlot = id;
    }
    ry += rowH;
  };
  choose('WORLD:new', 'New world', 'a fresh town in a new slot', 'new');
  for (const s of slots) {
    choose(`WORLD:${s.id}`, s.name, `${s.mode === 'coop' ? 'Co-op' : 'Solo'}  ·  Day ${s.day}  ·  Level ${s.level}  ·  ${playtimeLabel(s.playtime)}`, s.id);
  }

  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  const ty = ry + 14;
  ctx.fillText('Hosting runs the world in this browser. Friends join with the room code;', x + pad, ty);
  ctx.fillText('the password is checked here and never sent to the server.', x + pad, ty + 14);
  if (G.menu.error) { ctx.fillStyle = C.warn; ctx.fillText(G.menu.error, x + pad, ty + 34); }
  else if (G.menu.busy) { ctx.fillStyle = C.gold; ctx.fillText(G.net.status || 'starting…', x + pad, ty + 34); }

  const bw = (w - pad * 2 - 12) / 2;
  const by = y + h - 64;
  const start = menuButton(ctx, 'START HOSTING', x + pad, by, bw, 42, 'START HOSTING', { center: true, color: C.accent, enabled: !G.menu.busy });
  if (menuButton(ctx, 'BACK', x + pad + bw + 12, by, bw, 42, 'BACK', { center: true, enabled: !G.menu.busy })) goto('multi');
  if (start && !G.menu.busy) beginHosting(me);
}

async function beginHosting(me) {
  G.menu.busy = true; G.menu.error = null;
  const name = fieldValue('name').trim() || 'Host';
  const pw = fieldValue('password');
  saveIdentity({ ...me, name });
  try {
    const pwHash = pw ? await hashPassword(pw) : null;
    // The world first, so the code appears over a running game.
    if (G.menu.hostSlot === 'new' || !slotById(G.menu.hostSlot)) {
      const slot = createSlot(defaultName('coop'), 'coop');
      newGame(Math.floor(Math.random() * 0x7fffffff));
      G.slotId = slot.id;
    } else if (!loadSlot(G.menu.hostSlot)) {
      throw new Error('that save could not be loaded');
    } else {
      seedLoot((G.world.seed ^ 0x9E3779B9) >>> 0);
    }
    G.player.name = name;
    G.mode = 'coop';
    hideField();
    const code = await startHosting({ name, passwordHash: pwHash });
    saveToSlot(G.slotId);
    notify(`Hosting. Room code ${code} — friends join with it.`, '#e8c86a', true);
  } catch (err) {
    G.menu.error = String(err && err.message || err);
    if (G.scene === 'game') { stopHosting(); toTitle(true); goto('host'); }
  }
  G.menu.busy = false;
}

function drawJoin(ctx, W, H) {
  title(ctx, W, H * 0.2);
  const w = 520, h = 324;
  const x = (W - w) / 2, y = H * 0.34;
  panel(ctx, x, y, w, h, 'JOIN A GAME');
  const me = identity();
  const pad = 24;

  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('Room code', x + pad, y + 54);
  ctx.fillText('Password (if they set one)', x + w / 2 + 8, y + 54);
  textField('code', x + pad, y + 62, w / 2 - pad - 12, 32, G.menu.lastCode || '');
  textField('password', x + w / 2 + 8, y + 62, w / 2 - pad - 8, 32, '');
  ctx.fillStyle = C.dim;
  ctx.fillText('Your name', x + pad, y + 126);
  textField('name', x + pad, y + 134, w - pad * 2, 32, me.name);

  ctx.font = '10px "Courier New", monospace';
  const ty = y + 196;
  if (G.menu.error) { ctx.fillStyle = C.warn; ctx.fillText(G.menu.error, x + pad, ty); }
  else if (G.menu.busy) { ctx.fillStyle = C.gold; ctx.fillText(G.net.status || 'connecting…', x + pad, ty); }
  else {
    ctx.fillStyle = C.dim;
    ctx.fillText('Your character is kept by the host — come back with the same', x + pad, ty);
    ctx.fillText('browser and it is yours.', x + pad, ty + 14);
  }

  const bw = (w - pad * 2 - 12) / 2;
  const by = y + h - 64;
  const go = menuButton(ctx, 'CONNECT', x + pad, by, bw, 42, 'CONNECT', { center: true, color: C.accent, enabled: !G.menu.busy });
  if (menuButton(ctx, 'BACK', x + pad + bw + 12, by, bw, 42, 'BACK', { center: true, enabled: !G.menu.busy })) goto('multi');
  if ((go || takeSubmit('code') || takeSubmit('password') || takeSubmit('name')) && !G.menu.busy) beginJoin(me);
}

async function beginJoin(me) {
  const code = normaliseCode(fieldValue('code'));
  if (!isRoomCode(code)) { G.menu.error = 'a room code is six letters and numbers'; return; }
  G.menu.busy = true; G.menu.error = null;
  G.menu.lastCode = code;
  const name = fieldValue('name').trim() || 'Survivor';
  const pw = fieldValue('password');
  saveIdentity({ ...me, name });
  try {
    const pwHash = pw ? await hashPassword(pw) : null;
    await joinGame({ code, passwordHash: pwHash, identity: { id: me.id, name } });
    hideField();
  } catch (err) {
    G.menu.error = String(err && err.message || err);
    leaveGame(false);
  }
  G.menu.busy = false;
}

// ----------------------------------------------------------------- controls --

/**
 * Every action with its key. Click a row, press a key. Shared by the title
 * screen and the in-game pause menu; `onBack` says where BACK goes.
 */
export function drawControlsPanel(ctx, W, H, onBack) {
  const w = Math.min(600, W - 40);
  const h = Math.min(H - 60, 40 + GROUPS.length * 28 + ACTIONS.length * 26 + 96);
  const x = (W - w) / 2, y = (H - h) / 2;
  panel(ctx, x, y, w, h, 'CONTROLS');

  const listTop = y + 34, listH = h - 34 - 74;
  const contentH = GROUPS.length * 28 + ACTIONS.length * 26 + 8;
  const maxScroll = Math.max(0, contentH - listH);
  if (Input.wheel !== 0 && inside(x, y, w, h)) {
    G.menu.scroll = clamp(G.menu.scroll + Input.wheel * 26, 0, maxScroll);
  }
  G.menu.scroll = clamp(G.menu.scroll, 0, maxScroll);

  // Capture: the next bindable key goes to the pending action.
  if (G.menu.pendingRebind) {
    const code = pressedBindable();
    if (code) {
      rebind(G.menu.pendingRebind, code);
      G.menu.pendingRebind = null;
      sfx('craft');
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, listTop, w, listH);
  ctx.clip();
  let ry = listTop + 6 - G.menu.scroll;
  for (const g of GROUPS) {
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillStyle = C.borderHi;
    ctx.fillText(g.toUpperCase(), x + 20, ry + 18);
    ry += 28;
    for (const a of ACTIONS) {
      if (a.group !== g) continue;
      const pending = G.menu.pendingRebind === a.id;
      const hot = inside(x + 12, ry, w - 24, 26) && ry >= listTop && ry + 26 <= listTop + listH;
      G.menu.rects[`ROW:${a.id}`] = { x: x + 12, y: ry, w: w - 24, h: 26 };
      ctx.fillStyle = pending ? 'rgba(232,200,106,0.16)' : hot ? 'rgba(90,120,66,0.28)' : 'transparent';
      ctx.fillRect(x + 12, ry, w - 24, 26);
      ctx.font = '12px "Courier New", monospace';
      ctx.fillStyle = C.text;
      ctx.fillText(a.label, x + 24, ry + 18);
      ctx.textAlign = 'right';
      const conflicts = conflictsFor(a.id);
      if (pending) {
        ctx.fillStyle = C.gold;
        ctx.fillText('press a key…  (Esc cancels)', x + w - 24, ry + 18);
      } else {
        ctx.fillStyle = conflicts.length ? C.warn : isDefault(a.id) ? C.dim : C.accent;
        const conflictText = conflicts.length ? `  also ${conflicts.map((id) => ACTION_BY_ID[id].label).join(', ')}` : '';
        ctx.font = conflicts.length ? '10px "Courier New", monospace' : 'bold 12px "Courier New", monospace';
        ctx.fillText(actionLabel(a.id) + conflictText, x + w - 24, ry + 18);
      }
      ctx.textAlign = 'left';
      if (hot && clicked() && !G.menu.pendingRebind) {
        G.menu.pendingRebind = a.id;
        sfx('ui');
      }
      ry += 26;
    }
  }
  ctx.restore();

  ctx.font = '10px "Courier New", monospace';
  ctx.fillStyle = C.dim;
  ctx.fillText('Click a row, then press the key you want. Mouse buttons, the wheel and Esc are fixed.', x + 20, y + h - 52);
  if (menuButton(ctx, 'BACK', x + 20, y + h - 44, 120, 34, 'BACK', { center: true })) {
    G.menu.pendingRebind = null;
    onBack();
  }
  if (menuButton(ctx, 'RESET TO DEFAULTS', x + w - 200, y + h - 44, 180, 34, 'RESET TO DEFAULTS', { center: true, small: true })) {
    resetBinds();
    saveBinds();
    G.menu.pendingRebind = null;
    sfx('build');
  }
}

// -------------------------------------------------------------------- entry --

/** The whole title screen. Called once per frame instead of the world and HUD. */
export function drawMenu(ctx, deviceW, deviceH) {
  const { W, H } = beginUiFrame(ctx, deviceW, deviceH, true);
  G.menu.rects = {};
  drawBackdrop(ctx, W, H);

  // Escape walks back out. In a rebind it cancels the rebind first.
  if (keyTap('Escape')) {
    if (G.menu.pendingRebind) G.menu.pendingRebind = null;
    else if (G.menu.confirmDelete) G.menu.confirmDelete = null;
    else if (G.menu.screen !== 'main') goto('main');
    sfx('ui');
  }

  switch (G.menu.screen) {
    case 'new': drawNew(ctx, W, H); break;
    case 'slots': drawSlots(ctx, W, H); break;
    case 'multi': drawMulti(ctx, W, H); break;
    case 'host': drawHost(ctx, W, H); break;
    case 'join': drawJoin(ctx, W, H); break;
    case 'controls': drawControlsPanel(ctx, W, H, () => goto('main')); break;
    default: drawMain(ctx, W, H); break;
  }
  // Any field a screen did not draw this frame goes away.
  settleFields();
  submitted.clear();

  drawCursor(ctx);
}

/** Test and debug hooks: read the button rectangles, type into a field. */
export const menuDebug = {
  rects: () => G.menu.rects,
  staleReason,
  error: () => G.menu.error,
  setText: (v, key = 'name') => setFieldValue(v, key),
  screen: () => G.menu.screen,
  goto,
  toTitle,
};
