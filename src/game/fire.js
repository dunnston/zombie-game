// Fire: what a fire arrow leaves behind.
//
// The owner asked for this with the risk attached — "Fire has a risk of
// spreading, a zombie can catch on fire and spread the fire" — and, asked how
// far that should go, chose zombies and scenery but never the player's own
// structures. That last part is a decision, not an oversight, and the absence
// of any path from a fire to `G.structures` below is deliberate.
//
// So fire is a crowd weapon with a real cost: it clears a horde, it can take
// the treeline you were going to chop, and it burns whoever is standing in it
// — you and your survivors included.

import { TILE } from './config.js';
import { G, notify } from './state.js';
import { damageEnemy, damagePlayer } from './damage.js';
import { damageSurvivor } from './survivors.js';
import { propAtTile, removeProp } from './world.js';
import { emit } from '../net/events.js';
import * as FX from '../core/particles.js';
import { sfx } from '../core/audio.js';
import { dist2 } from '../core/util.js';

export const FIRE = {
  // On an enemy.
  burnTime: 6.5,
  burnDps: 9,
  // How often a burning thing tries to set light to what is around it.
  spreadEvery: 0.6,
  toEnemyRadius: 42,
  toEnemyChance: 0.45,
  toPropRadius: 46,
  toPropChance: 0.22,
  // A burning piece of scenery.
  propLife: 7,
  propSpreadRadius: TILE * 1.6,
  propSpreadChance: 0.16,
  propDps: 16,
  propHurtRadius: 26,
  // A ceiling, because the forest is thousands of pines and a fire that could
  // take all of them at once would take the frame rate with it.
  maxFires: 140,
};

/** Scenery that burns. Rock, boulder, silo and wreck do not. */
const FLAMMABLE = new Set(['tree', 'pine', 'bush', 'thicket', 'litter', 'hay', 'reed']);

export const isFlammable = (prop) => !!prop && FLAMMABLE.has(prop.kind);

/** Sets an enemy alight, or refreshes one that already is. */
export function ignite(e) {
  if (!e || e.dead) return false;
  const fresh = !(e.burnT > 0);
  e.burnT = FIRE.burnTime;
  e.burnDps = FIRE.burnDps;
  if (fresh) e.burnSpreadT = FIRE.spreadEvery;
  return true;
}

/**
 * Sets a piece of scenery alight. Refuses anything that does not burn, and
 * anything past the cap — a refused ignition is how this stays affordable.
 */
export function igniteProp(prop) {
  if (!isFlammable(prop) || prop.burning) return false;
  if (G.fires.length >= FIRE.maxFires) return false;
  prop.burning = true;
  G.fires.push({
    prop, x: prop.x, y: prop.y, tx: prop.tx, ty: prop.ty,
    t: 0, life: FIRE.propLife * (0.8 + Math.random() * 0.4), spreadT: FIRE.spreadEvery,
  });
  return true;
}

/** Everything that is burning, and everything standing in it. */
export function updateFire(dt) {
  burnEnemies(dt);
  burnProps(dt);
  checkWildfire();
}

function burnEnemies(dt) {
  for (const e of G.enemies) {
    if (e.dead || !(e.burnT > 0)) continue;
    e.burnT -= dt;
    // `noAlert`: a burn ticks several times a second and must not keep
    // resetting what the enemy was doing. See damageEnemy.
    damageEnemy(e, e.burnDps * dt, { source: 'fire', noAlert: true });
    if (Math.random() < dt * 14) FX.debris(e.x, e.y - 6, 1, '#ff9a3a');

    e.burnSpreadT -= dt;
    if (e.burnSpreadT > 0) continue;
    e.burnSpreadT = FIRE.spreadEvery;
    spreadFrom(e.x, e.y, FIRE.toEnemyRadius, FIRE.toEnemyChance, FIRE.toPropRadius, FIRE.toPropChance, e);
  }
}

function burnProps(dt) {
  for (let i = G.fires.length - 1; i >= 0; i--) {
    const f = G.fires[i];
    f.t += dt;
    if (Math.random() < dt * 22) FX.debris(f.x, f.y - 4, 1, Math.random() < 0.5 ? '#ff9a3a' : '#ffd08a');
    if (Math.random() < dt * 3) FX.smoke(f.x, f.y - 8, 1, '#6a6058');

    hurtAnythingStandingIn(f, dt);

    f.spreadT -= dt;
    if (f.spreadT <= 0) {
      f.spreadT = FIRE.spreadEvery;
      spreadFrom(f.x, f.y, 0, 0, FIRE.propSpreadRadius, FIRE.propSpreadChance, null);
    }

    if (f.t < f.life) continue;
    // Burnt out. The prop goes through the same path chopping uses, so a guest
    // sees it vanish and a save's `chopped` keys stay consistent — a burnt
    // treeline has to still be burnt when the game is loaded again.
    G.fires.splice(i, 1);
    if (f.prop && !f.prop.burnedAway) {
      f.prop.burnedAway = true;
      emit('prop', { key: `${f.prop.tx},${f.prop.ty}` });
      removeProp(G.world, f.prop);
    }
    FX.decal(f.x, f.y, 15, '#1a1512');
  }
}

/** Fire burns whoever is standing in it. That includes you. */
function hurtAnythingStandingIn(f, dt) {
  const R = FIRE.propHurtRadius;
  const dmg = FIRE.propDps * dt;
  for (const e of G.enemies) {
    if (e.dead || e.burnT > 0) continue;
    if (dist2(e.x, e.y, f.x, f.y) < R * R) ignite(e);
  }
  for (const q of G.players) {
    if (q.dead || q.away || q.downed) continue;
    if (dist2(q.x, q.y, f.x, f.y) < R * R) damagePlayer(q, dmg, f.x, f.y, 'fire');
  }
  for (const s of G.survivors) {
    if (s.dead || s.downed) continue;
    if (dist2(s.x, s.y, f.x, f.y) < R * R) damageSurvivor(s, dmg, f.x, f.y);
  }
}

/**
 * One spread roll from a point.
 *
 * Note what is missing: nothing here touches `G.structures`. Player-built
 * walls, chests, bunks and workbenches cannot catch, by choice — losing your
 * base to your own tower would be the kind of surprise that ends a run, and
 * the owner asked for zombies and scenery. A Node test asserts it stays that
 * way.
 */
function spreadFrom(x, y, eRadius, eChance, pRadius, pChance, self) {
  if (eRadius > 0) {
    for (const o of G.enemies) {
      if (o === self || o.dead || o.burnT > 0) continue;
      if (dist2(o.x, o.y, x, y) > eRadius * eRadius) continue;
      if (Math.random() < eChance) ignite(o);
    }
  }
  if (pRadius <= 0 || G.fires.length >= FIRE.maxFires) return;
  const span = Math.ceil(pRadius / TILE);
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  for (let j = -span; j <= span; j++) {
    for (let i = -span; i <= span; i++) {
      const prop = propAtTile(G.world, tx + i, ty + j);
      if (!isFlammable(prop) || prop.burning) continue;
      if (dist2(prop.x, prop.y, x, y) > pRadius * pRadius) continue;
      if (Math.random() < pChance) igniteProp(prop);
    }
  }
}

/** A new or loaded world has nothing alight in it. */
export function resetFires() {
  G.fires.length = 0;
  G.wildfireWarned = false;
}

/** Says so, once, when a fire you started is getting away from you. */
function checkWildfire() {
  if (G.fires.length < 25) { if (G.fires.length === 0) G.wildfireWarned = false; return; }
  if (G.wildfireWarned) return;
  G.wildfireWarned = true;
  notify('That fire is spreading', '#ff9a3a', true);
  sfx('hitWall');
}
