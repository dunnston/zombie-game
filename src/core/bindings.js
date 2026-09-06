// Key bindings: actions the game understands, and which physical keys mean
// them. The simulation and the UI ask "is `interact` held?" — never "is KeyE
// down?" — so a player can put anything on any action and every consumer
// follows. Stored in the browser, not in a save: controls belong to the
// person, not to the world.
//
// The mouse buttons, the wheel and Escape are not rebindable. Escape in
// particular has to reach the menu whatever state the bindings are in.

import { Input, key, keyTap, setSwallowPredicate } from './input.js';

export const ACTIONS = [
  { id: 'moveUp', label: 'Move up', group: 'Move', def: ['KeyW', 'ArrowUp'] },
  { id: 'moveDown', label: 'Move down', group: 'Move', def: ['KeyS', 'ArrowDown'] },
  { id: 'moveLeft', label: 'Move left', group: 'Move', def: ['KeyA', 'ArrowLeft'] },
  { id: 'moveRight', label: 'Move right', group: 'Move', def: ['KeyD', 'ArrowRight'] },
  { id: 'sprint', label: 'Sprint', group: 'Move', def: ['ShiftLeft', 'ShiftRight'] },
  { id: 'sneak', label: 'Crouch', group: 'Move', def: ['ControlLeft', 'ControlRight'] },
  { id: 'brake', label: 'Brake (driving)', group: 'Move', def: ['Space'] },

  { id: 'reload', label: 'Reload / refuel', group: 'Combat', def: ['KeyR'] },
  { id: 'useHeal', label: 'Use bandage or medkit', group: 'Combat', def: ['KeyQ'] },
  { id: 'slot1', label: 'Hotbar 1', group: 'Combat', def: ['Digit1'] },
  { id: 'slot2', label: 'Hotbar 2', group: 'Combat', def: ['Digit2'] },
  { id: 'slot3', label: 'Hotbar 3', group: 'Combat', def: ['Digit3'] },
  { id: 'slot4', label: 'Hotbar 4', group: 'Combat', def: ['Digit4'] },
  { id: 'slot5', label: 'Hotbar 5', group: 'Combat', def: ['Digit5'] },
  { id: 'slot6', label: 'Hotbar 6', group: 'Combat', def: ['Digit6'] },

  { id: 'interact', label: 'Interact (hold to search)', group: 'Interact', def: ['KeyE'] },
  { id: 'withdraw', label: 'Take ammo from stash', group: 'Interact', def: ['KeyF'] },
  { id: 'stow', label: 'Stow pack in car boot (Sprint + this takes it out)', group: 'Interact', def: ['KeyG'] },

  { id: 'inventory', label: 'Inventory', group: 'Screens', def: ['KeyI'] },
  { id: 'character', label: 'Character sheet', group: 'Screens', def: ['Tab'] },
  { id: 'craft', label: 'Crafting', group: 'Screens', def: ['KeyC'] },
  { id: 'map', label: 'Town map', group: 'Screens', def: ['KeyM'] },
  { id: 'build', label: 'Build mode', group: 'Screens', def: ['KeyB'] },
  { id: 'save', label: 'Save now', group: 'Screens', def: ['F5'] },
  { id: 'mute', label: 'Mute audio', group: 'Screens', def: ['KeyP'] },
];

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
export const GROUPS = ['Move', 'Combat', 'Interact', 'Screens'];

/** Keys that mean something fixed and cannot be given to an action. */
export const RESERVED = new Set(['Escape']);

const STORE_KEY = 'deadline.binds';

// action id -> array of codes. Filled by resetBinds()/loadBinds() below.
const binds = {};

function store() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function resetBinds() {
  for (const a of ACTIONS) binds[a.id] = [...a.def];
  return binds;
}

export function saveBinds() {
  const s = store();
  if (!s) return false;
  try { s.setItem(STORE_KEY, JSON.stringify(binds)); return true; } catch { return false; }
}

/**
 * Restores saved bindings over the defaults. Anything the save does not
 * mention keeps its default, and anything it mentions that is no longer an
 * action is dropped — a new action never arrives unbound.
 */
export function loadBinds() {
  resetBinds();
  const s = store();
  if (!s) return binds;
  try {
    const raw = s.getItem(STORE_KEY);
    if (!raw) return binds;
    const data = JSON.parse(raw);
    for (const id in data) {
      if (!ACTION_BY_ID[id] || !Array.isArray(data[id])) continue;
      const codes = data[id].filter((c) => typeof c === 'string' && c && !RESERVED.has(c));
      if (codes.length) binds[id] = codes;
    }
  } catch { /* unreadable: defaults stand */ }
  return binds;
}

export const codesFor = (id) => binds[id] || [];

/** Gives an action exactly one key. Other actions keep theirs — see conflictsFor. */
export function rebind(id, code) {
  if (!ACTION_BY_ID[id] || !code || RESERVED.has(code)) return false;
  binds[id] = [code];
  saveBinds();
  return true;
}

/** Other actions that share a key with this one. Shown, not forbidden. */
export function conflictsFor(id) {
  const mine = new Set(codesFor(id));
  const out = [];
  for (const a of ACTIONS) {
    if (a.id === id) continue;
    if (codesFor(a.id).some((c) => mine.has(c))) out.push(a.id);
  }
  return out;
}

export function isDefault(id) {
  const a = ACTION_BY_ID[id];
  const cur = codesFor(id);
  return !!a && cur.length === a.def.length && cur.every((c, i) => c === a.def[i]);
}

/** Every code any action currently uses, for the browser-default swallow list. */
export function boundCodes() {
  const out = new Set();
  for (const id in binds) for (const c of binds[id]) out.add(c);
  return out;
}

// ------------------------------------------------------------------ queries --

/** Is any key bound to this action held? */
export function act(id) {
  const codes = binds[id];
  if (!codes) return false;
  for (let i = 0; i < codes.length; i++) if (key(codes[i])) return true;
  return false;
}

/** Was any key bound to this action tapped this step? */
export function actTap(id) {
  const codes = binds[id];
  if (!codes) return false;
  for (let i = 0; i < codes.length; i++) if (keyTap(codes[i])) return true;
  return false;
}

/** The first freshly pressed key this frame that could be bound, or null. */
export function pressedBindable() {
  for (const c of Input.pressed) {
    if (RESERVED.has(c)) continue;
    return c;
  }
  return null;
}

// ------------------------------------------------------------------- labels --

const LABELS = {
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt',
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace',
  CapsLock: 'Caps Lock', Escape: 'Esc',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};

/** A human name for a key code: KeyW → W, Digit3 → 3, ShiftLeft → Left Shift. */
export function keyLabel(code) {
  if (!code) return '—';
  if (LABELS[code]) return LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (/^F\d+$/.test(code)) return code;
  return code;
}

export const actionLabel = (id) => codesFor(id).map(keyLabel).join(' / ');

/**
 * The one key a hint should name: "hold E", "press B". Every on-screen hint
 * goes through this, so a rebound key is never advertised by its old name.
 */
export const primaryLabel = (id) => keyLabel(codesFor(id)[0]);

// The browser must not scroll, quick-find or reload on a key the game uses,
// whatever the player has bound it to.
setSwallowPredicate((code) => boundCodes().has(code));
loadBinds();
