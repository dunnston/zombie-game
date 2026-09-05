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

// Keys the browser would otherwise use for scrolling / quick-find.
const SWALLOW = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Slash', 'Quote',
]);

export function initInput(canvas) {
  Input._canvas = canvas;

  window.addEventListener('keydown', (e) => {
    if (SWALLOW.has(e.code)) e.preventDefault();
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

export function endFrame() {
  Input.pressed.clear();
  Input.released.clear();
  Input.mousePressed = false;
  Input.mouseReleased = false;
  Input.rightPressed = false;
  Input.wheel = 0;
}
