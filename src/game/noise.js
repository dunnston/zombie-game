// Sound, and the zombies it brings.
//
// This mechanic mostly already existed and mostly did not work. `alertEnemies`
// in combat.js set `e.aggro`, `e.alertT` and `e.noiseX/Y`, and `WEAPONS[].noise`
// carried a per-gun radius — but `e.aggro` was set once and never cleared, and
// the branch in enemies.js that walks toward `e.noiseX/Y` sits *below* the one
// that walks toward the player. So a zombie that had ever seen anybody walked
// at the nearest player forever, and the noise destination was unreachable.
// vehicles.js also carried a byte-for-byte duplicate of the function.
//
// One implementation lives here, aggro now expires (see enemies.js), and the
// things that were conspicuously silent — turrets, towers, generators, your own
// axe — are heard.

import { G } from './state.js';
import { dist2 } from '../core/util.js';

/**
 * How loud each source is, as a radius in world pixels. Guns already carried
 * their own `noise` in WEAPONS; these are everything else, gathered in one
 * place so the quiet-versus-effective trade is a table somebody can read
 * rather than numbers scattered over five files.
 */
export const NOISE = {
  // Work. You can hear an axe across a clearing, which is the point: gathering
  // is no longer free of consequence now that it also costs stamina.
  chop: 140,
  build: 190,
  // The base defending itself. A turret is a machine gun on a post and a
  // cannon is artillery; both pull the horde onto the thing making the noise.
  turret: 520,
  generator: 300,
  // Doors, locks and engines, from vehicles.js.
  pickSnap: 260,
  engine: 420,
  crash: 380,
};

/**
 * Pulls everything within `radius` toward (x, y).
 *
 * `actor` is whoever made the sound, when there is one — their `noiseMul`
 * applies, so a stealth build is quieter with a car and a turret the same way
 * it is quieter with a pistol. That never happened before: the duplicate in
 * vehicles.js ignored the stat entirely.
 */
export function makeNoise(x, y, radius, actor = null) {
  const r = radius * (actor && actor.noiseMul !== undefined ? actor.noiseMul : 1);
  if (r <= 0) return 0;
  const r2 = r * r;
  let heard = 0;
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, x, y) >= r2) continue;
    // Aggro plus a destination. The aggro is what makes them move at all; the
    // destination is what they move toward once no player is in their senses.
    e.aggro = true;
    e.alertT = Math.max(e.alertT || 0, 8);
    e.noiseX = x;
    e.noiseY = y;
    heard++;
  }
  return heard;
}

/** The old name, kept because combat.js and the tests both say it. */
export const alertEnemies = makeNoise;
