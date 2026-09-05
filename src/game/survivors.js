// Survivor NPCs.
//
// You find people out in the town and bring them home. They garrison whatever
// you have built, shoot what comes at it, and get better at it over time. They
// also die permanently — which is the point. A base is worth defending because
// of who is standing in it, not because of what the walls cost.

import { TILE, RES } from './config.js';
import {
  G, moveCircle, notify, unstick, hasTerrainLineOfSight, takeRes, countRes, shake,
} from './state.js';
import { spawnBullet } from './combat.js';
import { baseCenter } from './building.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { addXp } from './progression.js';
import { makeRng, dist2, clamp, angleDelta, TAU } from '../core/util.js';

const rng = makeRng(0x5EA12345);
const scratch = [];

export const SURVIVOR = {
  r: 12,
  baseHp: 90,
  hpPerLevel: 22,
  baseDmg: 11,
  dmgPerLevel: 2.6,
  fireCd: 0.62,
  range: 300,
  speed: 118,
  xpPerLevel: 55,
  maxLevel: 10,
  guardRadius: 190,       // how far from their post they will roam
  reviveTime: 8,          // downed -> dead if nobody helps
  upkeepPerMin: 1.0,      // Rations eaten per survivor per minute
};

// Names are cosmetic but they matter: a numbered unit is a resource, a named
// one is a person you would rather not lose.
const NAMES = [
  'Mira', 'Cass', 'Dev', 'Rosa', 'Tobin', 'Junie', 'Hal', 'Ada',
  'Wes', 'Nel', 'Bram', 'Ivy', 'Otto', 'Sona', 'Rhett', 'Pim',
];

export function survivorCap() {
  return Math.max(0, Math.round(G.player.survivorCap));
}

export const liveSurvivors = () => G.survivors.filter((s) => !s.dead);

export function makeSurvivor(x, y, opts = {}) {
  const name = opts.name || NAMES[Math.floor(rng() * NAMES.length)];
  const level = opts.level || 1;
  const s = {
    id: opts.id ?? (G.survivorSeq = (G.survivorSeq || 0) + 1),
    name, level, xp: 0,
    x, y, vx: 0, vy: 0, angle: 0,
    hp: 0, maxHp: 0,
    dead: false, downed: false, downT: 0,
    recruited: !!opts.recruited,
    cd: rng.range(0, 0.6),
    target: null,
    post: opts.post || null,
    flash: 0, anim: rng.range(0, TAU),
    kills: 0,
    hungry: false,
    tint: ['#7a8fa8', '#8a7f6a', '#7f8a6a', '#8a6f7a'][Math.floor(rng() * 4)],
  };
  refreshSurvivor(s);
  s.hp = s.maxHp;
  return s;
}

/** Recomputes a survivor's stats from level and the player's Charisma perks. */
export function refreshSurvivor(s) {
  const p = G.player;
  const hpMul = p ? p.survivorHpMul : 1;
  const dmgMul = p ? p.survivorDmgMul : 1;
  s.maxHp = Math.round((SURVIVOR.baseHp + SURVIVOR.hpPerLevel * (s.level - 1)) * hpMul);
  s.dmg = (SURVIVOR.baseDmg + SURVIVOR.dmgPerLevel * (s.level - 1)) * dmgMul;
  if (s.hp > s.maxHp) s.hp = s.maxHp;
}

export function refreshAllSurvivors() {
  for (const s of G.survivors) refreshSurvivor(s);
}

// --------------------------------------------------------------- recruiting --

/** Scatters unrescued survivors around the town for the player to find. */
export function seedRescues(world, count = 7) {
  G.rescues.length = 0;
  const rescueRng = makeRng((world.seed ^ 0x51F7) >>> 0);
  // Prefer buildings: someone holed up indoors reads better than one in a field.
  const candidates = world.containers.filter((c) => !c.hidden);
  let guard = 0;
  while (G.rescues.length < count && guard++ < count * 60) {
    const c = candidates[Math.floor(rescueRng() * candidates.length)];
    if (!c) break;
    const x = c.x + rescueRng.range(-48, 48);
    const y = c.y + rescueRng.range(-48, 48);
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 2 || ty < 2 || tx >= world.w - 2 || ty >= world.h - 2) continue;
    if (world.blocked[ty * world.w + tx]) continue;
    if (G.rescues.some((r) => dist2(r.x, r.y, x, y) < 700 * 700)) continue;
    G.rescues.push({
      x, y,
      name: NAMES[Math.floor(rescueRng() * NAMES.length)],
      level: 1 + Math.floor(rescueRng() * 2),
      found: false,
    });
  }
  return G.rescues.length;
}

export function recruit(rescue) {
  const cap = survivorCap();
  if (liveSurvivors().length >= cap) {
    sfx('deny');
    notify(
      cap === 0
        ? 'Nobody will follow you yet — raise Charisma'
        : `You can only look after ${cap} — no room`,
      '#c96a5a', true,
    );
    return null;
  }
  const s = makeSurvivor(rescue.x, rescue.y, {
    name: rescue.name, level: rescue.level, recruited: true,
  });
  G.survivors.push(s);
  const i = G.rescues.indexOf(rescue);
  if (i >= 0) G.rescues.splice(i, 1);

  sfx('levelUp');
  FX.ring(s.x, s.y, 6, 70, 0.6, '#b7e08a', 3);
  notify(`${s.name} joined you — they will hold the base`, '#b7e08a', true);
  addXp(60);
  return s;
}

// -------------------------------------------------------------------- upkeep --

let upkeepAccum = 0;

export function updateUpkeep(dt) {
  const alive = liveSurvivors();
  if (alive.length === 0) { upkeepAccum = 0; return; }
  upkeepAccum += dt;
  if (upkeepAccum < 10) return;
  const minutes = upkeepAccum / 60;
  upkeepAccum = 0;

  // Charge this tick's upkeep *plus* whatever is outstanding, so restocking the
  // pantry actually clears a shortage. Billing only the current tick would leave
  // any accrued debt permanent and the crew starving forever.
  const need = alive.length * SURVIVOR.upkeepPerMin * minutes * G.player.upkeepMul;
  const owed = need + (G.rationDebt || 0);
  const paid = takeRes(G.stash, 'rations', owed);
  G.rationDebt = Math.max(0, owed - paid);

  if (G.rationDebt > 1) {
    // Hungry survivors are weaker and slowly starve rather than vanishing.
    for (const s of alive) {
      s.hungry = true;
      s.hp = Math.max(1, s.hp - 2);
    }
    if (!G.rationWarned || G.time - G.rationWarned > 45) {
      G.rationWarned = G.time;
      notify('Your people are out of Rations — stock the stash', '#e05a4a', true);
    }
    // Cap the backlog so a long trip away is recoverable, not a death spiral.
    G.rationDebt = Math.min(G.rationDebt, 5);
  } else {
    for (const s of alive) s.hungry = false;
  }
}

/**
 * The pantry is the stash, exactly like the ammo your people shoot. Food in
 * your own pack is no use to anyone until you drop it off.
 */
export const rationsHeld = () => countRes(G.stash, 'rations');
export const rationsCarried = () => countRes(G.player.bag, 'rations');

// ------------------------------------------------------------------- combat --

export function damageSurvivor(s, dmg, fromX, fromY) {
  if (s.dead || s.downed) return 0;
  s.hp -= dmg;
  s.flash = 0.12;
  const dx = s.x - fromX, dy = s.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  FX.blood(s.x, s.y, dx / len, dy / len, 5, '#8f1f1f');

  if (s.hp <= 0) {
    s.hp = 0;
    s.downed = true;
    s.downT = SURVIVOR.reviveTime;
    FX.text(s.x, s.y - 24, `${s.name} IS DOWN`, '#e05a4a', 13, -34, 1.4);
    notify(`${s.name} is down — get to them`, '#e05a4a', true);
    sfx('playerHurt');
  }
  return dmg;
}

function killSurvivor(s) {
  s.dead = true;
  s.downed = false;
  FX.blood(s.x, s.y, 0, 0, 18, '#8f1f1f');
  FX.decal(s.x, s.y, 20, '#4a1010');
  notify(`${s.name} is gone. Level ${s.level}.`, '#e05a4a', true);
  sfx('playerDie');
  shake(6);
}

export function reviveSurvivor(s) {
  if (!s.downed || s.dead) return false;
  const cost = 1;
  if ((G.player.items.medkit || 0) >= cost) {
    G.player.items.medkit -= cost;
    if (G.player.items.medkit <= 0) delete G.player.items.medkit;
  } else if ((G.player.items.bandage || 0) >= 2) {
    G.player.items.bandage -= 2;
    if (G.player.items.bandage <= 0) delete G.player.items.bandage;
  } else {
    sfx('deny');
    notify('Need a medkit, or two bandages', '#c96a5a');
    return false;
  }
  s.downed = false;
  s.hp = Math.round(s.maxHp * 0.45);
  FX.ring(s.x, s.y, 6, 50, 0.5, '#7ce08a', 2);
  FX.text(s.x, s.y - 24, `${s.name} IS UP`, '#7ce08a', 12, -34, 1.0);
  notify(`${s.name} is back on their feet`, '#b7e08a');
  sfx('heal');
  addXp(20);
  return true;
}

export function awardSurvivorXp(s, amount) {
  s.xp += amount * G.player.survivorXpMul;
  const need = () => SURVIVOR.xpPerLevel * s.level;
  while (s.level < SURVIVOR.maxLevel && s.xp >= need()) {
    s.xp -= need();
    s.level++;
    refreshSurvivor(s);
    s.hp = s.maxHp;
    FX.text(s.x, s.y - 26, `${s.name} LVL ${s.level}`, '#ffe08a', 12, -36, 1.2);
    sfx('levelUp');
  }
}

// -------------------------------------------------------------------- update --

export function updateSurvivors(dt) {
  const p = G.player;
  const base = baseCenter();

  for (let i = G.survivors.length - 1; i >= 0; i--) {
    const s = G.survivors[i];
    if (s.dead) { G.survivors.splice(i, 1); continue; }

    s.flash = Math.max(0, s.flash - dt);
    s.cd = Math.max(0, s.cd - dt);
    s.anim += dt * 5;

    if (s.downed) {
      s.downT -= dt;
      if (s.downT <= 0) killSurvivor(s);
      continue;
    }

    unstick(s, SURVIVOR.r);

    // Their post is the base if there is one, otherwise the player.
    const postX = s.post ? s.post.x : (base.hasBase ? base.x : p.x);
    const postY = s.post ? s.post.y : (base.hasBase ? base.y : p.y);

    // ------------------------------------------------------------ target --
    let best = null, bestD = SURVIVOR.range * SURVIVOR.range;
    G.spatial.query(s.x, s.y, SURVIVOR.range, scratch);
    for (const e of scratch) {
      if (e.dead) continue;
      const d = dist2(s.x, s.y, e.x, e.y);
      if (d < bestD && hasTerrainLineOfSight(s.x, s.y, e.x, e.y)) { bestD = d; best = e; }
    }
    s.target = best;

    // ------------------------------------------------------------- move --
    let wantX = postX, wantY = postY;
    if (best) {
      // Hold position and shoot; close only if the target is drifting away.
      const d = Math.sqrt(bestD);
      if (d > SURVIVOR.range * 0.8) { wantX = best.x; wantY = best.y; }
      else { wantX = s.x; wantY = s.y; }
      s.angle += clamp(angleDelta(s.angle, Math.atan2(best.y - s.y, best.x - s.x)), -8 * dt, 8 * dt);
    } else {
      const dp = Math.hypot(postX - s.x, postY - s.y);
      if (dp > SURVIVOR.guardRadius) { wantX = postX; wantY = postY; }
      else { wantX = s.x; wantY = s.y; }
      if (dp > 24) s.angle += clamp(angleDelta(s.angle, Math.atan2(postY - s.y, postX - s.x)), -6 * dt, 6 * dt);
    }

    const dx = wantX - s.x, dy = wantY - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 12) {
      const sp = SURVIVOR.speed * (s.hungry ? 0.75 : 1);
      s.vx += ((dx / dist) * sp - s.vx) * Math.min(1, 10 * dt);
      s.vy += ((dy / dist) * sp - s.vy) * Math.min(1, 10 * dt);
    } else {
      s.vx *= Math.exp(-9 * dt);
      s.vy *= Math.exp(-9 * dt);
    }

    // Spread out so a group does not stack into one silhouette.
    for (const o of G.survivors) {
      if (o === s || o.dead) continue;
      const ox = s.x - o.x, oy = s.y - o.y;
      const d2 = ox * ox + oy * oy;
      const want = SURVIVOR.r * 2.4;
      if (d2 < want * want && d2 > 0.01) {
        const d = Math.sqrt(d2);
        s.vx += (ox / d) * 160 * dt * 4;
        s.vy += (oy / d) * 160 * dt * 4;
      }
    }

    moveCircle(s, s.vx * dt, s.vy * dt, SURVIVOR.r);

    // ------------------------------------------------------------- fire --
    if (best && s.cd <= 0) {
      const aimErr = 0.10 - Math.min(0.06, s.level * 0.007);
      const a = s.angle + (Math.random() - 0.5) * aimErr * 2;
      s.cd = SURVIVOR.fireCd * (s.hungry ? 1.35 : 1);
      // Survivors draw from the stash so arming them is a real decision.
      const paid = takeRes(G.stash, 'ammoP', 1);
      if (paid > 0) {
        spawnBullet(s.x + Math.cos(a) * 16, s.y + Math.sin(a) * 16, a, {
          speed: 1150, dmg: s.dmg, life: 0.5, knock: 45,
          color: '#cfe8b0', size: 2, owner: `survivor:${s.id}`,
        });
        FX.muzzle(s.x + Math.cos(a) * 18, s.y + Math.sin(a) * 18, a, 0.6);
        sfx('smg');
      } else {
        s.cd = 1.2;
        s.outOfAmmo = true;
        if (!G.ammoWarned || G.time - G.ammoWarned > 40) {
          G.ammoWarned = G.time;
          notify('Your people are out of 9mm — stock the stash', '#d9c46a');
        }
      }
      if (paid > 0) s.outOfAmmo = false;
    }
  }
}

/** Called when a bullet owned by a survivor lands a kill. */
export function creditSurvivorKill(ownerTag, xp) {
  if (!ownerTag || !ownerTag.startsWith('survivor:')) return;
  const id = Number(ownerTag.slice(9));
  const s = G.survivors.find((x) => x.id === id && !x.dead);
  if (!s) return;
  s.kills++;
  awardSurvivorXp(s, xp);
}

export const RATION_RES = RES.rations;
