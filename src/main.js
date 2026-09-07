// Entry point: canvas setup, the fixed-step game loop, and the debug hooks the
// browser smoke test drives.

import './style.css';
import { G } from './game/state.js';
import { ENEMIES } from './game/config.js';
import {
  initInput, endFrame, Input, snapshotEdges, clearEdges, restoreEdges,
} from './core/input.js';
import { initAudio, resumeAudio } from './core/audio.js';
import { primeSprites, buildSprites } from './core/sprites.js';
import { render } from './render/renderer.js';
import { drawHUD, pauseActions } from './ui/hud.js';
import { drawMenu, menuDebug } from './ui/menu.js';
import { update, newGame, toTitle, api } from './game/game.js';
import {
  saveGame, migrateLegacy, listSlots, createSlot, deleteSlot, loadSlot, saveToSlot, latestSlot, slotPayloadVersion,
} from './game/saves.js';
import {
  ACTIONS, codesFor, rebind, resetBinds, keyLabel, actionLabel, conflictsFor, loadBinds,
} from './core/bindings.js';
import { notify } from './game/state.js';
import { startHosting, stopHosting, isHosting, hostOffline, debugAttachGuest } from './net/host.js';
import { joinGame, leaveGame, isClient, clientDebug } from './net/client.js';
import { makeLoopback } from './net/transport.js';
import { hashPassword, msg, PROTOCOL, packSnapshot, loadIdentity } from './net/protocol.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const overlay = document.getElementById('overlay');

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  G.canvasW = canvas.width;
  G.canvasH = canvas.height;
  G.dpr = dpr;
}

window.addEventListener('resize', resize);

// --------------------------------------------------------------------- boot --

primeSprites({ ENEMIES });
buildSprites();
initInput(canvas);
resize();
// The single pre-slot save, if there is one, becomes slot 1. Then the title
// screen: nothing runs until the player picks a game.
migrateLegacy();
G.scene = 'title';

// Audio contexts need a gesture; wire it to the first interaction of any kind.
const unlock = () => { initAudio(); resumeAudio(); };
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

overlay.classList.add('hidden');

// ---------------------------------------------------------------- main loop --

const FIXED = 1 / 60;
const MAX_STEPS = 5;
let acc = 0;
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0;
G.fps = 60;

function frame(now) {
  requestAnimationFrame(frame);

  let raw = (now - last) / 1000;
  last = now;
  // Tab-out or a long stall must not fast-forward the world.
  if (raw > 0.25) raw = 0.25;

  fpsAcc += raw; fpsFrames++;
  if (fpsAcc > 0.5) { G.fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  resize();

  // On the title there is no world to step: draw the menu, resolve its clicks,
  // and spend this frame's edges so a click cannot repeat.
  if (G.scene === 'title') {
    acc = 0;
    drawMenu(ctx, canvas.width, canvas.height);
    endFrame();
    return;
  }

  // Brief hitstop on heavy impacts.
  let scale = 1;
  if (G.slowmo > 0) { G.slowmo = Math.max(0, G.slowmo - raw); scale = 0.28; }

  acc += raw * scale;

  // Edge-triggered input is consumed by exactly one simulation step. A frame
  // that runs no fixed update must keep the tap for the next one (otherwise
  // short presses vanish on high-refresh displays), and a frame that runs
  // several must not let each of them see the same press.
  const edges = snapshotEdges();
  let steps = 0;
  while (acc >= FIXED && steps < MAX_STEPS) {
    update(FIXED);
    acc -= FIXED;
    steps++;
    if (steps === 1) clearEdges();
  }
  if (steps === MAX_STEPS) acc = 0;

  // Hand the edges back so the UI pass can resolve clicks from the same press.
  const consumed = steps > 0;
  if (consumed) restoreEdges(edges);

  render(ctx, canvas.width, canvas.height);
  drawHUD(ctx, canvas.width, canvas.height, consumed);

  // Pause-menu actions are resolved after the UI has drawn them.
  if (pauseActions.save) {
    pauseActions.save = false;
    notify(saveGame() ? 'Game saved' : 'Save failed', '#b7e08a');
  }
  if (pauseActions.quit) {
    pauseActions.quit = false;
    toTitle(true);
    if (isHosting()) stopHosting();
  }
  if (pauseActions.leave) {
    pauseActions.leave = false;
    leaveGame(true);
    toTitle(false);
  }

  // Only discard the edges once a simulation step has actually seen them.
  if (consumed) endFrame();
}

requestAnimationFrame(frame);

// ---------------------------------------------------------------- debug API --
// Used by the automated browser test; harmless in normal play.

window.DEADLINE = {
  G, api, Input,
  version: '1.0.0',
  errors: [],
  canvas,
  newGame: (seed) => newGame(seed ?? 20240917),
  setThreat: (v) => { G.threat = v; },
  giveAll: () => {
    Object.assign(G.stash, {
      wood: 999, scrap: 999, cloth: 999, elec: 999, med: 999,
      parts: 999, mil: 999, fuel: 999, ammoP: 999, ammoS: 999, ammoR: 999,
    });
  },
  teleport: (x, y) => {
    G.player.x = x; G.player.y = y;
    G.camera.x = x; G.camera.y = y;
    G.player.vx = 0; G.player.vy = 0;
  },
  god: (on = true, p = G.player) => { p.godMode = on; },

  // The title screen, save slots and key bindings, for the browser suite.
  menu: menuDebug,
  toTitle,
  saves: { listSlots, createSlot, deleteSlot, loadSlot, saveToSlot, latestSlot, slotPayloadVersion },
  binds: { ACTIONS, codesFor, rebind, resetBinds, keyLabel, actionLabel, conflictsFor, loadBinds },
  // Networking, for the browser suite: host without a broker and drive a fake
  // guest through an in-memory loopback.
  net: {
    startHosting, stopHosting, isHosting, hostOffline, debugAttachGuest, joinGame, leaveGame, isClient,
    makeLoopback, hashPassword, msg, PROTOCOL, packSnapshot, loadIdentity, client: clientDebug,
  },

  // Synthetic input, so the test drives the same code path a human does.
  key(code, down = true) {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  },
  tap(code) { this.key(code, true); this.key(code, false); },
  mouseMove(x, y) {
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
  },
  mouseDown(btn = 0) {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: btn, bubbles: true, cancelable: true }));
  },
  mouseUp(btn = 0) {
    window.dispatchEvent(new MouseEvent('mouseup', { button: btn, bubbles: true }));
  },
  aimAt(wx, wy) {
    // Convert a world point to a client point and move the cursor there.
    const cx = (wx - G.camera.x) * G.camera.zoom + G.canvasW / 2;
    const cy = (wy - G.camera.y) * G.camera.zoom + G.canvasH / 2;
    const r = canvas.getBoundingClientRect();
    this.mouseMove(r.left + cx / (G.dpr || 1), r.top + cy / (G.dpr || 1));
  },
};

window.addEventListener('error', (e) => {
  window.DEADLINE.errors.push(String(e.message || e));
});
window.addEventListener('unhandledrejection', (e) => {
  window.DEADLINE.errors.push(String(e.reason));
});
