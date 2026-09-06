// What a player wants to do this simulation step, as data.
//
// The simulation never reads the keyboard. Each step, the local player's intent
// is filled in from `Input` here — and only here — and updatePlayer() acts on
// the intent. That is what lets a second person's intent arrive over a wire and
// drive an identical player through identical code. UI concerns (which panel is
// open, whether build mode owns the mouse) are resolved at this boundary, so
// the sim never has to know about them.

import { G } from './state.js';
import { Input, key, keyTap } from '../core/input.js';

export function makeIntent() {
  return {
    // Movement axis, already normalised to length <= 1.
    mx: 0, my: 0,
    // Where the player is pointing, in world pixels.
    aimX: 0, aimY: 0,
    sprint: false, sneak: false,
    // Held fire, and the edge for a fresh press (a click with an empty gun
    // reloads; holding the button afterwards does not keep asking).
    fire: false, firePressed: false,
    reload: false,
    // E: the tap that begins an interaction, and whether it is still held.
    interact: false, interactHeld: false,
    // Q: use whatever healing is to hand.
    use: false,
    // 0-5 selects a hotbar slot; -1 means no change. Wheel is +-1 or 0.
    slot: -1, wheel: 0,
    // At the wheel of a car.
    drive: { forward: false, back: false, left: false, right: false, brake: false },
    // Beside a car or a stash.
    stow: false, unstow: false, withdrawAmmo: false,
  };
}

export function clearIntent(it) {
  it.mx = 0; it.my = 0;
  it.sprint = false; it.sneak = false;
  it.fire = false; it.firePressed = false; it.reload = false;
  it.interact = false; it.interactHeld = false; it.use = false;
  it.slot = -1; it.wheel = 0;
  const d = it.drive;
  d.forward = false; d.back = false; d.left = false; d.right = false; d.brake = false;
  it.stow = false; it.unstow = false; it.withdrawAmmo = false;
  return it;
}

/**
 * Spends the edge-triggered half of an intent. The local player's intent is
 * rebuilt from the keyboard every step, so its edges last exactly one step by
 * construction. A remote player's intent arrives as a packet and stays put
 * until the next one — so "E was pressed" would open and close a gate sixty
 * times a second unless the step that acted on it also consumes it. Held
 * states (movement, fire, sprint, E still down) are left alone.
 */
export function consumeEdges(it) {
  it.firePressed = false;
  it.reload = false;
  it.interact = false;
  it.use = false;
  it.slot = -1;
  it.wheel = 0;
  it.stow = false;
  it.unstow = false;
  it.withdrawAmmo = false;
  return it;
}

/**
 * Reads the keyboard and mouse into the local player's intent.
 *
 * A panel over the world swallows everything but aim. Build mode owns the
 * mouse, the wheel and the digit keys, so none of those reach the sim while it
 * is up. Both rules used to be scattered through updatePlayer; they live here
 * now so the sim sees one consistent picture whatever the UI is doing.
 */
export function gatherLocalIntent(p) {
  const it = clearIntent(p.intent);

  // Cursor into world space. Kept on Input.mouse too, because the build ghost,
  // the camera lead and the HUD all read it from there.
  const cam = G.camera;
  const wx = (Input.mouse.x - G.canvasW / 2) / cam.zoom + cam.x;
  const wy = (Input.mouse.y - G.canvasH / 2) / cam.zoom + cam.y;
  Input.mouse.wx = wx; Input.mouse.wy = wy;
  it.aimX = wx; it.aimY = wy;

  const panel = !!G.ui.panel;
  const building = G.ui.buildMode;
  const driving = !!p.drivingId;

  if (panel) return it;

  if (driving) {
    const d = it.drive;
    d.forward = key('KeyW') || key('ArrowUp');
    d.back = key('KeyS') || key('ArrowDown');
    d.left = key('KeyA') || key('ArrowLeft');
    d.right = key('KeyD') || key('ArrowRight');
    d.brake = key('Space');
  } else {
    let ix = 0, iy = 0;
    if (key('KeyW') || key('ArrowUp')) iy -= 1;
    if (key('KeyS') || key('ArrowDown')) iy += 1;
    if (key('KeyA') || key('ArrowLeft')) ix -= 1;
    if (key('KeyD') || key('ArrowRight')) ix += 1;
    if (ix !== 0 || iy !== 0) {
      const len = Math.hypot(ix, iy);
      ix /= len; iy /= len;
    }
    it.mx = ix; it.my = iy;
    it.sneak = key('ControlLeft') || key('ControlRight');
    it.sprint = key('ShiftLeft') || key('ShiftRight');
  }

  // A search in progress keeps going while E stays down, build mode or not.
  it.interactHeld = key('KeyE');

  // Build mode owns the mouse, the wheel, the digits and every action key —
  // you can still walk, but you are placing things, not fighting or looting.
  if (building) return it;

  it.interact = keyTap('KeyE');
  it.withdrawAmmo = keyTap('KeyF');
  if (keyTap('KeyG')) {
    if (key('ShiftLeft') || key('ShiftRight')) it.unstow = true;
    else it.stow = true;
  }
  // R is claimed by refuelling first, in game.js, which clears this flag.
  it.reload = keyTap('KeyR');

  it.fire = Input.mouseDown;
  it.firePressed = Input.mousePressed;
  it.use = keyTap('KeyQ');
  for (let i = 0; i < 6; i++) {
    if (keyTap(`Digit${i + 1}`)) it.slot = i;
  }
  if (Input.wheel !== 0) it.wheel = Input.wheel > 0 ? 1 : -1;
  return it;
}
