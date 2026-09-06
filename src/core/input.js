// Keyboard + mouse state. `pressed` is edge-triggered and cleared once per frame
// by endFrame(), so gameplay code can ask "was this tapped this frame?".

export const Input = {
  down: new Set(),
  pressed: new Set(),
  released: new Set(),
  mouse: { x: 0, y: 0, wx: 0, wy: 0 },
  mouseDown: false,
  mousePressed: false,
  mouseReleased: false,
  rightDown: false,
  rightPressed: false,
  wheel: 0,
  _canvas: null,
};

// Keys the browser would otherwise use for scrolling, quick-find or reloading.
// F5 is ours: we advertise it as the manual save, so the native reload has to
// be cancelled or the page navigates away before the handler ever runs. On top
// of this fixed set, bindings.js registers "anything currently bound", so a
// player who moves on the arrow keys or Space is not also scrolling the page.
const SWALLOW = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Slash', 'Quote', 'F5',
]);
let swallowExtra = () => false;

export function setSwallowPredicate(fn) { swallowExtra = fn || (() => false); }

/** A real text box has focus — the keyboard is typing, not playing. */
const typing = (e) => {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
};

export function initInput(canvas) {
  Input._canvas = canvas;

  window.addEventListener('keydown', (e) => {
    if (typing(e)) {
      // Escape still has to reach the menu; everything else is the text field's.
      if (e.code !== 'Escape') return;
    } else if (SWALLOW.has(e.code) || swallowExtra(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) return;
    Input.down.add(e.code);
    Input.pressed.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    Input.down.delete(e.code);
    Input.released.add(e.code);
  });

  // Releasing focus while holding a key would otherwise leave it stuck down.
  window.addEventListener('blur', () => {
    Input.down.clear();
    Input.mouseDown = false;
    Input.rightDown = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    Input.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    Input.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
  });

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (e.button === 0) { Input.mouseDown = true; Input.mousePressed = true; }
    if (e.button === 2) { Input.rightDown = true; Input.rightPressed = true; }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) { Input.mouseDown = false; Input.mouseReleased = true; }
    if (e.button === 2) Input.rightDown = false;
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    Input.wheel += Math.sign(e.deltaY);
  }, { passive: false });
}

export const key = (code) => Input.down.has(code);
export const keyTap = (code) => Input.pressed.has(code);

/**
 * Takes a tap so nothing else this frame can also act on it.
 *
 * `keyTap` is non-consuming, so two systems reading the same key both fire —
 * one press once reloaded a weapon *and* refuelled a car. Use this when a
 * context should win the key outright.
 */
export function consumeKey(code) {
  if (!Input.pressed.has(code)) return false;
  Input.pressed.delete(code);
  return true;
}

export function endFrame() {
  Input.pressed.clear();
  Input.released.clear();
  Input.mousePressed = false;
  Input.mouseReleased = false;
  Input.rightPressed = false;
  Input.wheel = 0;
}

// --------------------------------------------------------------- edge state --
// Edge-triggered input has to be seen by exactly one simulation step. On a
// high-refresh display most animation frames run zero fixed updates, so
// clearing unconditionally would drop taps entirely; after a hitch several
// updates run in one frame, so leaving them set would fire a toggle twice.
// The loop snapshots the edges, lets the first step consume them, blanks them
// for any extra steps, and restores them for the UI pass.

export function snapshotEdges() {
  return {
    pressed: new Set(Input.pressed),
    released: new Set(Input.released),
    mousePressed: Input.mousePressed,
    mouseReleased: Input.mouseReleased,
    rightPressed: Input.rightPressed,
    wheel: Input.wheel,
  };
}

export function clearEdges() {
  Input.pressed.clear();
  Input.released.clear();
  Input.mousePressed = false;
  Input.mouseReleased = false;
  Input.rightPressed = false;
  Input.wheel = 0;
}

export function restoreEdges(e) {
  Input.pressed = e.pressed;
  Input.released = e.released;
  Input.mousePressed = e.mousePressed;
  Input.mouseReleased = e.mouseReleased;
  Input.rightPressed = e.rightPressed;
  Input.wheel = e.wheel;
}
