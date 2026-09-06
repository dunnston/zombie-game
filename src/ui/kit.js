// The immediate-mode UI kit: palette, panels, buttons, hit-testing and the
// cursor. Shared by the in-game HUD and the title screen, and handed to panels
// that live in their own module so they draw in the same style. Everything is
// laid out in CSS pixels; beginUiFrame() applies the devicePixelRatio scale.

import { G } from '../game/state.js';
import { Input } from '../core/input.js';
import { currentWeapon } from '../game/player.js';
import { clamp, TAU } from '../core/util.js';
import { sfx } from '../core/audio.js';

export const C = {
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

export function panel(ctx, x, y, w, h, title = null) {
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

export function bar(ctx, x, y, w, h, frac, color, bg = '#1a2016') {
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

export const inside = (x, y, w, h) => {
  const m = uiMouse();
  return m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
};

// False on frames that ran no simulation step: the edges are being held over
// for the next one, so the UI must draw without consuming them.
let uiInteractive = true;
export const clicked = () => uiInteractive && Input.mousePressed;

/** Records a screen-space region that swallows clicks from the world. */
export function claim(x, y, w, h) {
  G.ui.hudRects.push({ x, y, w, h });
}

/**
 * Starts a UI pass: scales the context to CSS pixels, forgets last frame's
 * click regions, and says whether clicks may be consumed this frame. Returns
 * the CSS-pixel size to lay out in.
 */
export function beginUiFrame(ctx, deviceW, deviceH, interactive = true) {
  uiInteractive = interactive;
  G.ui.hudRects = [];
  const S = G.dpr || 1;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return { W: deviceW / S, H: deviceH / S };
}

/** Immediate-mode button. Returns true on the frame it is clicked. */
export function button(ctx, x, y, w, h, label, opts = {}) {
  const { enabled = true, sub = null, color = C.text, small = false, center = false } = opts;
  const hot = inside(x, y, w, h);
  const hit = hot && enabled && clicked();

  ctx.fillStyle = !enabled ? 'rgba(30,34,26,0.7)' : hot ? 'rgba(90,120,66,0.45)' : 'rgba(30,40,24,0.75)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = !enabled ? '#333d2a' : hot ? C.borderHi : C.border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.font = `bold ${small ? 11 : 12}px "Courier New", monospace`;
  ctx.fillStyle = enabled ? color : '#5c6650';
  const tx = center ? x + w / 2 : x + 9;
  if (center) ctx.textAlign = 'center';
  // With a subtitle the two lines share the height proportionally, so a short
  // button does not push its second line onto the border.
  ctx.fillText(label, tx, y + (sub ? Math.round(h * 0.42) + 2 : h / 2 + 4));
  if (sub) {
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = enabled ? C.dim : '#4c5544';
    ctx.fillText(sub, tx, y + Math.round(h * 0.8) + 1);
  }
  if (center) ctx.textAlign = 'left';
  if (hit) sfx('ui');
  return hit;
}

// Handed to panels that live in their own module, so they draw in this style
// without importing the HUD — and so `uiInteractive` still gates their input.
export const UI_KIT = {
  panel: (...a) => panel(...a),
  button: (...a) => button(...a),
  claim: (...a) => claim(...a),
  uiMouse: () => uiMouse(),
  mouseDown: () => uiInteractive && Input.mousePressed,
  mouseUp: () => uiInteractive && Input.mouseReleased,
};

/** The crosshair. Opens with the held weapon's spread; a plain ring on the menu. */
export function drawCursor(ctx) {
  const { x, y } = uiMouse();
  const p = G.scene === 'game' ? G.player : null;
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
