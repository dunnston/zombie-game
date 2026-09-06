// Save slots. Any number of games side by side: two solo runs and a co-op
// world, each in its own slot, each deletable on its own.
//
// A slot's *address* and a save's *format* are kept apart on purpose. The
// index under `deadline.slots` says which games exist and what they look like
// from the outside (name, day, level, play time); the payload under
// `deadline.slot.<id>` is exactly the data save.js has always produced. When
// the payload format changes (v8, with guests remembered), nothing here moves.

import { G, notify } from './state.js';
import { serialiseGame, applySaveData, LEGACY_KEY } from './save.js';

export const INDEX_KEY = 'deadline.slots';
const SLOT_PREFIX = 'deadline.slot.';

function store() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function readIndex() {
  const s = store();
  if (!s) return { v: 1, current: null, slots: [] };
  try {
    const raw = s.getItem(INDEX_KEY);
    const idx = raw ? JSON.parse(raw) : null;
    if (idx && Array.isArray(idx.slots)) return idx;
  } catch { /* fall through */ }
  return { v: 1, current: null, slots: [] };
}

function writeIndex(idx) {
  const s = store();
  if (!s) return false;
  try { s.setItem(INDEX_KEY, JSON.stringify(idx)); return true; } catch { return false; }
}

const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Slots, most recently played first. */
export function listSlots() {
  return readIndex().slots.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export const slotById = (id) => readIndex().slots.find((s) => s.id === id) || null;

/**
 * The slot CONTINUE would open: the one the player last chose. Loading a slot
 * marks it current even before it saves, so a refresh straight after LOAD
 * still comes back to the game that was picked, not to whichever one happened
 * to be written last.
 */
export function latestSlot() {
  const idx = readIndex();
  const current = idx.slots.find((s) => s.id === idx.current);
  if (current) return current;
  const all = listSlots();
  return all.length ? all[0] : null;
}

export const hasSave = () => readIndex().slots.length > 0;

/** A name nobody else in the index is using: "Game 3", or the given one. */
export function defaultName(mode = 'solo') {
  const taken = new Set(readIndex().slots.map((s) => s.name));
  const base = mode === 'coop' ? 'Co-op world' : 'Game';
  for (let i = 1; ; i++) {
    const n = `${base} ${i}`;
    if (!taken.has(n)) return n;
  }
}

/** Makes an empty slot entry. Nothing is written for it until saveToSlot(). */
export function createSlot(name, mode = 'solo') {
  const idx = readIndex();
  const now = Date.now();
  const slot = {
    id: newId(), name: (name || '').trim() || defaultName(mode), mode,
    created: now, updated: now, playtime: 0, day: 1, level: 1, kills: 0, seed: null,
  };
  idx.slots.push(slot);
  idx.current = slot.id;
  writeIndex(idx);
  return slot;
}

export function renameSlot(id, name) {
  const idx = readIndex();
  const slot = idx.slots.find((s) => s.id === id);
  if (!slot) return false;
  slot.name = (name || '').trim() || slot.name;
  return writeIndex(idx);
}

/** What the slot list shows, taken from the live game. */
function summarise(slot) {
  const p = G.player;
  slot.updated = Date.now();
  slot.playtime = Math.round(G.playtime || 0);
  slot.day = G.day || 1;
  slot.level = p ? p.level : 1;
  slot.kills = G.stats ? G.stats.kills : 0;
  slot.seed = G.world ? G.world.seed : slot.seed;
  // A world is co-op while it is being hosted or while other people's
  // characters live in it; played alone with nobody else recorded, it is solo.
  slot.mode = (G.net && G.net.role === 'host') || G.players.length > 1 ? 'coop' : 'solo';
  G.mode = slot.mode;
}

/** Writes the live game into a slot and refreshes its summary. */
export function saveToSlot(id) {
  const s = store();
  if (!s || !G.world || !G.player) return false;
  const idx = readIndex();
  const slot = idx.slots.find((x) => x.id === id);
  if (!slot) return false;
  try {
    s.setItem(SLOT_PREFIX + id, JSON.stringify(serialiseGame()));
  } catch (err) {
    console.warn('[saves] write failed', err);
    return false;
  }
  summarise(slot);
  idx.current = id;
  writeIndex(idx);
  return true;
}

/** Rebuilds G from a slot. False if the slot is missing or unreadable. */
export function loadSlot(id) {
  const s = store();
  if (!s) return false;
  const idx = readIndex();
  const slot = idx.slots.find((x) => x.id === id);
  if (!slot) return false;
  let data;
  try {
    const raw = s.getItem(SLOT_PREFIX + id);
    if (!raw) return false;
    data = JSON.parse(raw);
  } catch (err) {
    console.warn('[saves] unreadable', err);
    return false;
  }
  if (!applySaveData(data)) return false;
  G.slotId = id;
  G.mode = slot.mode || 'solo';
  G.playtime = slot.playtime || data.playtime || 0;
  idx.current = id;
  writeIndex(idx);
  return true;
}

export function deleteSlot(id) {
  const s = store();
  const idx = readIndex();
  const i = idx.slots.findIndex((x) => x.id === id);
  if (i < 0) return false;
  idx.slots.splice(i, 1);
  if (idx.current === id) idx.current = idx.slots.length ? idx.slots[0].id : null;
  if (G.slotId === id) G.slotId = null;
  try { if (s) s.removeItem(SLOT_PREFIX + id); } catch { /* ignore */ }
  return writeIndex(idx);
}

/**
 * The single pre-slot save becomes slot 1. Runs once at boot; a one-line wrap,
 * so the run in progress survives the change rather than being retired.
 */
export function migrateLegacy() {
  const s = store();
  if (!s) return false;
  let raw;
  try { raw = s.getItem(LEGACY_KEY); } catch { return false; }
  if (!raw) return false;
  const idx = readIndex();
  let data = null;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (data) {
    const now = Date.now();
    const slot = {
      id: newId(), name: 'Game 1', mode: 'solo',
      created: now, updated: now, playtime: data.time || 0,
      day: data.day || 1, level: data.player ? data.player.level || 1 : 1,
      kills: data.stats ? data.stats.kills || 0 : 0, seed: data.seed ?? null,
    };
    try { s.setItem(SLOT_PREFIX + slot.id, raw); } catch { return false; }
    idx.slots.push(slot);
    idx.current = slot.id;
    writeIndex(idx);
  }
  try { s.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  return !!data;
}

// ------------------------------------------------------- the old entry points --
// game.js, main.js and the tests still say saveGame()/loadGame(): they act on
// the current slot. A save with no slot yet gets one, so autosave and F5 keep
// working for a game the tests started straight through newGame().

export function saveGame() {
  if (!G.world || !G.player) return false;
  if (!G.slotId || !slotById(G.slotId)) {
    const slot = createSlot(defaultName(G.mode || 'solo'), G.mode || 'solo');
    G.slotId = slot.id;
  }
  return saveToSlot(G.slotId);
}

export function loadGame(id = null) {
  const target = id || G.slotId || (latestSlot() && latestSlot().id);
  if (!target) return false;
  return loadSlot(target);
}

/** Deletes the current slot — the game in progress stops being saved anywhere. */
export function clearSave() {
  if (G.slotId && deleteSlot(G.slotId)) notify('Save deleted', '#d9c46a');
  G.slotId = null;
}

/** Human play time: 47m, 2h 05m. */
export function playtimeLabel(sec) {
  const m = Math.floor((sec || 0) / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "Today 20:14" / "6 Sep 20:14", for the slot list. */
export function whenLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today ${time}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${time}`;
}
