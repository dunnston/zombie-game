// Survivor NPCs.
//
// You find people out in the town and bring them home. They garrison whatever
// you have built, shoot what comes at it, and get better at it over time. They
// also die permanently — which is the point. A base is worth defending because
// of who is standing in it, not because of what the walls cost.

import { TILE, RES } from './config.js';
import {
  G, moveCircle, notify, unstick, hasTerrainLineOfSight,
  takeRes, addRes, countRes, shake,
} from './state.js';
import { spawnBullet } from './combat.js';
import { baseCenter } from './building.js';
import { rollContainer, spawnPickup, spawnEntryPickup } from './loot.js';
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

/** How close a sniper must be to their tower to count as posted on it. */
export const POST_RADIUS = 52;

// Names are cosmetic but they matter: a numbered unit is a resource, a named
// one is a person you would rather not lose.
const NAMES = [
  'Mira', 'Cass', 'Dev', 'Rosa', 'Tobin', 'Junie', 'Hal', 'Ada',
  'Wes', 'Nel', 'Bram', 'Ivy', 'Otto', 'Sona', 'Rhett', 'Pim',
];

// ---------------------------------------------------------------- the jobs --

export const JOBS = {
  guard: {
    id: 'guard', name: 'Guard', short: 'GRD', color: '#d9765a',
    desc: 'Holds the base and shoots what comes at it.',
  },
  sniper: {
    id: 'sniper', name: 'Sniper', short: 'SNP', color: '#6fb0c4',
    desc: 'Posted on a Watchtower: far more range and damage, but tied to it.',
    needs: 'watchtower',
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', short: 'SCV', color: '#e8c86a',
    desc: 'Makes supply runs and brings materials back to the stash.',
  },
  builder: {
    id: 'builder', name: 'Builder', short: 'BLD', color: '#8fd07a',
    desc: 'Repairs damaged structures, during a raid and after it.',
  },
};

export const JOB_IDS = Object.keys(JOBS);

/**
 * How many people you can keep. Two independent limits, and the UI reports
 * whichever is actually binding: Charisma is how many will follow you, bunks
 * are how many you can house.
 */
export function rosterLimits() {
  const charisma = Math.max(0, Math.round(G.player ? G.player.survivorCap : 0));
  let bunks = 0;
  for (const s of G.structures) {
    if (s.destroyed) continue;
    if (s.def.houses) bunks += s.def.houses;
  }
  return { charisma, bunks, cap: Math.min(charisma, bunks) };
}

export const survivorCap = () => rosterLimits().cap;

export const liveSurvivors = () => G.survivors.filter((s) => !s.dead);

/** Watchtowers with nobody posted on them. */
export function freeTowers() {
  const taken = new Set(liveSurvivors().map((s) => s.tower).filter(Boolean));
  return G.structures.filter((s) => !s.destroyed && s.def.post === 'sniper' && !taken.has(s));
}

export function assignJob(s, job) {
  if (!JOBS[job] || s.dead) return false;
  if (job === 'sniper') {
    const tower = s.tower && !s.tower.destroyed ? s.tower : freeTowers()[0];
    if (!tower) {
      sfx('deny');
      notify('No free Watchtower to post them on', '#c96a5a');
      return false;
    }
    s.tower = tower;
  } else {
    s.tower = null;
  }
  s.job = job;
  s.jobT = 0;
  // A haul was taken out of a real container, so reassignment must not delete
  // it: hand it in if a stash is close, otherwise put it on the floor.
  if (s.carrying || (s.carryItems && s.carryItems.length)) {
    const stash = nearestStash(s.x, s.y);
    if (stash && dist2(s.x, s.y, stash.x, stash.y) < 260 * 260) deliverCargo(s, stash);
    else dropCargo(s);
  }
  // Jobs target different kinds of object, so a leftover target from the
  // previous job is not just stale, it is the wrong shape entirely.
  s.runTarget = null;
  sfx('ui');
  notify(`${s.name} is now on ${JOBS[job].name} duty`, JOBS[job].color);
  return true;
}

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
    job: opts.job || 'guard',
    tower: null,
    jobT: 0,
    carrying: null,          // scavenger's haul on the way home
    runTarget: null,
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
  const { charisma, bunks, cap } = rosterLimits();
  if (liveSurvivors().length >= cap) {
    sfx('deny');
    // Say which of the two limits is actually in the way — being told "no room"
    // without being told which kind of room is useless.
    let why;
    if (bunks <= liveSurvivors().length) {
      why = bunks === 0
        ? 'Nowhere for them to sleep — build a Bunk first'
        : `Every Bunk is taken (${bunks}). Build another.`;
    } else if (charisma <= liveSurvivors().length) {
      why = charisma === 0
        ? 'Nobody will follow you yet — raise Charisma'
        : `Only ${charisma} will follow you. Raise Charisma.`;
    } else {
      why = 'No room';
    }
    notify(why, '#c96a5a', true);
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
  // Whatever they were carrying was taken out of a real container, so it falls
  // where they do rather than disappearing with them.
  dropCargo(s);
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
  const rp = G.player;
  const held = (id) => countRes(rp.bag, id) + countRes(rp.hotbar, id);
  const spendItem = (id, n) => {
    const fromBag = takeRes(rp.bag, id, n);
    if (fromBag < n) takeRes(rp.hotbar, id, n - fromBag);
  };
  if (held('medkit') >= cost) {
    spendItem('medkit', cost);
  } else if (held('bandage') >= 2) {
    spendItem('bandage', 2);
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

    // A sniper whose tower has been destroyed falls back to guarding.
    if (s.job === 'sniper' && (!s.tower || s.tower.destroyed)) {
      s.tower = null;
      s.job = 'guard';
    }

    // Where this person is meant to be, given their job.
    let postX, postY;
    if (s.job === 'sniper' && s.tower) { postX = s.tower.x; postY = s.tower.y; }
    else if (s.post) { postX = s.post.x; postY = s.post.y; }
    else if (base.hasBase) { postX = base.x; postY = base.y; }
    else { postX = p.x; postY = p.y; }

    // A sniper only gets the tower's reach once they are actually standing on
    // it. Holding a reference to a structure on the other side of the base is
    // not the same as being up it.
    const posted = s.job === 'sniper' && s.tower &&
      dist2(s.x, s.y, s.tower.x, s.tower.y) < POST_RADIUS * POST_RADIUS;
    s.posted = posted;
    const range = posted ? s.tower.def.sniperRange : SURVIVOR.range;
    const dmgMul = posted ? s.tower.def.sniperDmg : 1;

    // ------------------------------------------------------------ target --
    let best = null, bestD = range * range;
    G.spatial.query(s.x, s.y, range, scratch);
    for (const e of scratch) {
      if (e.dead) continue;
      const d = dist2(s.x, s.y, e.x, e.y);
      if (d < bestD && hasTerrainLineOfSight(s.x, s.y, e.x, e.y)) { bestD = d; best = e; }
    }
    s.target = best;
    s.shotRange = range;
    s.shotDmgMul = dmgMul;

    // --------------------------------------------------------- job work --
    // Non-combat jobs only get on with it when nothing is shooting at them.
    const underThreat = !!best && bestD < (SURVIVOR.range * 0.8) ** 2;
    let jobX = null, jobY = null;
    if (!underThreat) {
      if (s.job === 'scavenger') ({ x: jobX, y: jobY } = scavengerStep(s, dt, base));
      else if (s.job === 'builder') ({ x: jobX, y: jobY } = builderStep(s, dt, base));
    }

    // ------------------------------------------------------------- move --
    let wantX = postX, wantY = postY;
    const climbing = s.job === 'sniper' && s.tower && !posted;
    if (climbing) {
      // Get to the tower first. Stopping to shoot on the way is how a sniper
      // ends up permanently "posted" from across the base.
      wantX = s.tower.x; wantY = s.tower.y;
      if (best) s.angle += clamp(angleDelta(s.angle, Math.atan2(best.y - s.y, best.x - s.x)), -8 * dt, 8 * dt);
      else s.angle += clamp(angleDelta(s.angle, Math.atan2(wantY - s.y, wantX - s.x)), -6 * dt, 6 * dt);
    } else if (best && (s.job === 'guard' || s.job === 'sniper' || underThreat)) {
      // Hold position and shoot; close only if the target is drifting away.
      const d = Math.sqrt(bestD);
      // A posted sniper never leaves their tower.
      if (s.job !== 'sniper' && d > SURVIVOR.range * 0.8) { wantX = best.x; wantY = best.y; }
      else { wantX = s.x; wantY = s.y; }
      s.angle += clamp(angleDelta(s.angle, Math.atan2(best.y - s.y, best.x - s.x)), -8 * dt, 8 * dt);
    } else if (jobX !== null) {
      wantX = jobX; wantY = jobY;
      const d = Math.hypot(wantX - s.x, wantY - s.y);
      if (d > 20) s.angle += clamp(angleDelta(s.angle, Math.atan2(wantY - s.y, wantX - s.x)), -6 * dt, 6 * dt);
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
      const sniping = s.job === 'sniper' && s.tower;
      const aimErr = (sniping ? 0.04 : 0.10) - Math.min(0.03, s.level * 0.004);
      const a = s.angle + (Math.random() - 0.5) * aimErr * 2;
      s.cd = SURVIVOR.fireCd * (sniping ? 1.7 : 1) * (s.hungry ? 1.35 : 1);
      // Survivors draw from the stash so arming them is a real decision.
      const paid = takeRes(G.stash, 'ammoP', 1);
      if (paid > 0) {
        spawnBullet(s.x + Math.cos(a) * 16, s.y + Math.sin(a) * 16, a, {
          speed: sniping ? 1700 : 1150,
          dmg: s.dmg * s.shotDmgMul,
          life: sniping ? 0.55 : 0.5,
          knock: sniping ? 110 : 45,
          pierce: sniping ? 1 : 0,
          color: sniping ? '#e8f0c0' : '#cfe8b0',
          size: sniping ? 2.8 : 2,
          owner: `survivor:${s.id}`,
        });
        FX.muzzle(s.x + Math.cos(a) * 18, s.y + Math.sin(a) * 18, a, sniping ? 1.1 : 0.6);
        sfx(sniping ? 'rifle' : 'smg');
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

// ------------------------------------------------------------- job routines --

export const SCAVENGE = {
  radius: 900,          // how far from the base they will range
  reach: 68,            // how close they must get to work one
  searchTime: 6,        // seconds spent working a container
  giveUpAfter: 2.5,     // seconds of no progress before trying something else
};

/**
 * Scavengers walk to a nearby unlooted container, work it, and carry the haul
 * back to the stash. They are slower and less thorough than you are, which is
 * the point: they turn time into materials while you do something else.
 */
function scavengerStep(s, dt, base) {
  const stash = nearestStash(s.x, s.y);

  // Carrying a haul? Take it home.
  if (s.carrying || (s.carryItems && s.carryItems.length)) {
    // The stash was destroyed while they were walking back. Put the haul on the
    // ground rather than deleting it — it was taken out of a real container.
    if (!stash) { dropCargo(s); return { x: null, y: null }; }
    const home = dist2(s.x, s.y, stash.x, stash.y);
    if (home < 52 * 52) {
      deliverCargo(s, stash);
      s.runTarget = null;
      s.homeT = 0;
      s.lastHomeD = Infinity;
      return { x: null, y: null };
    }
    // The return leg needs the same stuck recovery as the outbound one: a stash
    // behind a closed gate would otherwise hold a loaded carrier against the
    // wall forever, and every future haul with them.
    s.homeT = (s.homeT || 0) + dt;
    if (s.homeT > SCAVENGE.giveUpAfter) {
      if ((s.lastHomeD || Infinity) - home > 900) {
        s.lastHomeD = home;
        s.homeT = 0;
      } else {
        notify(`${s.name} could not reach the stash and put the haul down`, '#d9c46a');
        dropCargo(s);
        s.homeT = 0;
        s.lastHomeD = Infinity;
        return { x: null, y: null };
      }
    }
    return { x: stash.x, y: stash.y };
  }

  // No stash, nowhere to put anything: don't strip the neighbourhood for
  // nothing. Idle at the post until the player builds one.
  if (!stash) {
    if (!G.scavengeWarned || G.time - G.scavengeWarned > 45) {
      G.scavengeWarned = G.time;
      notify('Your scavengers need a Supply Stash to deliver to', '#d9c46a');
    }
    return { x: null, y: null };
  }

  // Pick a target container near the base. The `table` check makes sure we are
  // looking at a container and not a structure left over from another job.
  if (!s.runTarget || !s.runTarget.table || s.runTarget.looted) {
    s.runTarget = null;
    const { x: originX, y: originY } = homeAnchor(s, base);
    // Don't send two people to the same shelf, and skip anything this person
    // has already failed to reach.
    const claimed = new Set(liveSurvivors().map((o) => o.runTarget).filter(Boolean));

    // There is no pathfinding, so prefer containers with a clear line from the
    // base — those are the ones they can actually walk to. Anything behind a
    // wall is only tried if nothing open is left, and the give-up timer below
    // drops it quickly if it turns out to be sealed off.
    let bestC = null, bestD = SCAVENGE.radius * SCAVENGE.radius;
    let fallbackC = null, fallbackD = SCAVENGE.radius * SCAVENGE.radius;
    for (const c of G.world.containers) {
      if (c.looted || c.hidden || claimed.has(c)) continue;
      if (s.unreachLoot && s.unreachLoot.has(c.id)) continue;
      const d = dist2(originX, originY, c.x, c.y);
      if (d >= fallbackD && d >= bestD) continue;
      if (d < bestD && canSeeContainer(originX, originY, c)) {
        bestD = d; bestC = c;
      } else if (d < fallbackD) {
        fallbackD = d; fallbackC = c;
      }
    }
    if (!bestC) bestC = fallbackC;
    // Everything in range has defeated them: forget the grudges and retry.
    if (!bestC && s.unreachLoot && s.unreachLoot.size) { s.unreachLoot.clear(); }
    s.runTarget = bestC;
    s.jobT = 0;
    s.reachT = 0;
    s.lastReachD = Infinity;
    if (!bestC) return { x: null, y: null };
  }

  const c = s.runTarget;
  const away = dist2(s.x, s.y, c.x, c.y);
  // The container's own tile is solid, so a survivor can never stand closer
  // than about a tile away — the working radius has to allow for that.
  if (away > SCAVENGE.reach * SCAVENGE.reach) {
    // There is no pathfinding here, so a container behind a wall would hold a
    // scavenger against it forever. If they stop closing, give this one up and
    // let the next pick find something they can actually walk to.
    s.reachT = (s.reachT || 0) + dt;
    if (s.reachT > SCAVENGE.giveUpAfter) {
      const closed = (s.lastReachD || Infinity) - away > 900;   // ~30px of progress
      if (!closed) {
        if (!s.unreachLoot) s.unreachLoot = new Set();
        s.unreachLoot.add(c.id);
        s.runTarget = null;
        return { x: null, y: null };
      }
      s.lastReachD = away;
      s.reachT = 0;
    }
    return { x: c.x, y: c.y };
  }

  // In reach: work it.
  s.jobT += dt;
  if (s.jobT >= SCAVENGE.searchTime) {
    s.jobT = 0;
    c.looted = true;
    const entries = rollContainer(c, 1, {});
    const haul = {};
    const gear = [];
    for (const e of entries) {
      // Materials go in the pack; weapons, armour and medicine are carried home
      // too and left beside the stash. Nothing a container held is destroyed
      // just because a survivor opened it rather than the player.
      if (RES[e.id]) haul[e.id] = (haul[e.id] || 0) + e.n;
      else gear.push(e);
    }
    if (Object.keys(haul).length === 0 && gear.length === 0) haul.scrap = 3;
    s.carrying = Object.keys(haul).length ? haul : null;
    s.carryItems = gear;
    FX.ring(c.x, c.y, 4, 26, 0.4, '#e8c86a', 2);
    s.runTarget = null;
  }
  return { x: s.x, y: s.y };
}

export const BUILDER = {
  radius: 700,          // searched from the base, not from the builder
  reach: 58,            // structures are solid, so allow for standing beside one
  giveUpAfter: 2.5,
  repairPerSec: 26,
  costPer100: { wood: 2, scrap: 1 },
};

/**
 * Builders walk to the most damaged structure in range and patch it up, taking
 * materials from the stash as they go. During a raid this is the difference
 * between a wall that holds and one that does not.
 */
function builderStep(s, dt, base) {
  // The `def` check keeps a container from a previous job out of the repair
  // path, where its undefined hp would poison the arithmetic.
  let target = s.runTarget;
  if (!target || !target.def || target.destroyed || target.hp >= target.maxHp) {
    target = null;
    // Search from their settlement, not from wherever this person happens to be
    // standing. A builder who wandered should still know the wall is broken and
    // walk back to it, rather than losing sight of the job.
    const { x: originX, y: originY } = homeAnchor(s, base);
    let worst = 1;
    for (const st of G.structures) {
      if (st.destroyed || st.hp >= st.maxHp) continue;
      if (s.unreachBuild && s.unreachBuild.has(st)) continue;
      if (dist2(originX, originY, st.x, st.y) > BUILDER.radius * BUILDER.radius) continue;
      const frac = st.hp / st.maxHp;
      if (frac < worst) { worst = frac; target = st; }
    }
    // Nothing left they can get to: forget the grudges and look again.
    if (!target && s.unreachBuild && s.unreachBuild.size) s.unreachBuild.clear();
    s.runTarget = target;
    s.reachT = 0;
    s.lastReachD = Infinity;
  }
  if (!target) return { x: null, y: null };

  const away = dist2(s.x, s.y, target.x, target.y);
  if (away > BUILDER.reach * BUILDER.reach) {
    // Same no-pathfinding caveat as scavenging: if they stop closing on a
    // structure, drop it and pick another rather than leaning on a wall.
    s.reachT = (s.reachT || 0) + dt;
    if (s.reachT > BUILDER.giveUpAfter) {
      if ((s.lastReachD || Infinity) - away > 900) {
        s.lastReachD = away;
        s.reachT = 0;
      } else {
        if (!s.unreachBuild) s.unreachBuild = new Set();
        s.unreachBuild.add(target);
        s.runTarget = null;
        s.reachT = 0;
        s.lastReachD = Infinity;
        return { x: null, y: null };
      }
    }
    return { x: target.x, y: target.y };
  }
  s.reachT = 0;
  s.lastReachD = Infinity;

  // In reach. Materials are bought *before* any repair is applied, a block at a
  // time and all-or-nothing — repairing first and billing later handed out
  // almost a full block of free health every time the stash ran dry, which
  // during a raid is the difference between a wall that should have fallen and
  // one that did not.
  if ((s.repairCredit || 0) <= 0) {
    const affordable = Object.entries(BUILDER.costPer100)
      .every(([id, n]) => countRes(G.stash, id) >= n);
    if (!affordable) {
      if (!G.repairWarned || G.time - G.repairWarned > 40) {
        G.repairWarned = G.time;
        notify('Your builders are out of materials', '#d9c46a');
      }
      return { x: s.x, y: s.y };
    }
    for (const [id, n] of Object.entries(BUILDER.costPer100)) takeRes(G.stash, id, n);
    s.repairCredit = 100;
    awardSurvivorXp(s, 3);
  }

  const heal = Math.min(
    BUILDER.repairPerSec * dt,
    s.repairCredit,
    target.maxHp - target.hp,
  );
  s.repairCredit -= heal;
  target.hp += heal;
  if (Math.random() < dt * 5) FX.sparks(target.x, target.y, 0, -1, 2, '#d8c88a');
  return { x: s.x, y: s.y };
}

/**
 * Where a worker considers "home". Deliberately the stash they would deliver
 * to rather than baseCenter(), which averages every structure in the world — so
 * with two settlements far apart that average lands in the empty middle and
 * both settlements fall outside the working radius.
 */
function homeAnchor(s, base) {
  const stash = nearestStash(s.x, s.y);
  if (stash) return { x: stash.x, y: stash.y };
  if (base && base.hasBase) return { x: base.x, y: base.y };
  return { x: s.x, y: s.y };
}

/**
 * Line of sight to a container, stopping short of its own tile.
 *
 * Every container marks its tile blocked, so a ray that runs all the way to the
 * centre hits the target itself and reports "no line of sight" for literally
 * every container in the world — which silently turned the reachability
 * preference into a no-op.
 */
export function canSeeContainer(fromX, fromY, c) {
  const dx = c.x - fromX, dy = c.y - fromY;
  const len = Math.hypot(dx, dy);
  if (len < 40) return true;
  const back = Math.min(len - 1, 26);
  return hasTerrainLineOfSight(fromX, fromY, c.x - (dx / len) * back, c.y - (dy / len) * back, 20);
}

/** The stash nearest to the given point — not, as it once was, to the origin. */
function nearestStash(fromX = 0, fromY = 0) {
  let best = null, bd = Infinity;
  for (const st of G.structures) {
    if (st.destroyed || st.type !== 'stash') continue;
    const d = dist2(st.x, st.y, fromX, fromY);
    if (d < bd) { bd = d; best = st; }
  }
  return best;
}

/** Hands the haul over: materials into the stash, gear onto the ground beside it. */
function deliverCargo(s, stash) {
  let total = 0;
  for (const id in s.carrying || {}) {
    addRes(G.stash, id, s.carrying[id]);
    total += s.carrying[id];
  }
  // Decoded by the shared grammar rather than a hand-written prefix list —
  // the list here missed `gear:` when it was added, so a scavenger who found a
  // helmet spawned a pickup nothing could decode and it was deleted on contact.
  for (const e of s.carryItems || []) {
    spawnEntryPickup(stash.x, stash.y + 26, e.id, e.n);
    total += e.n;
  }
  if (total > 0) {
    FX.text(s.x, s.y - 24, `+${total} delivered`, '#e8c86a', 11, -34, 1.0);
    sfx('loot');
    awardSurvivorXp(s, 8);
  }
  s.carrying = null;
  s.carryItems = null;
}

/** Puts a haul on the ground where the survivor stands. Never deletes it. */
function dropCargo(s) {
  for (const id in s.carrying || {}) spawnPickup(s.x, s.y, 'res', id, s.carrying[id]);
  for (const e of s.carryItems || []) spawnEntryPickup(s.x, s.y, e.id, e.n);
  if (s.carrying || (s.carryItems && s.carryItems.length)) {
    FX.text(s.x, s.y - 24, 'DROPPED', '#e8c86a', 11, -34, 1.0);
  }
  s.carrying = null;
  s.carryItems = null;
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
