// Raids: waves of enemies converge on the player's base (or on the player, if
// they haven't built one yet) until every raider is dead.

import { raidSpec, TILE } from './config.js';
import { G, notify, addRes, shake, screenFlash, solidPx } from './state.js';
import { spawnEnemy, MAX_ENEMIES } from './enemies.js';
import { baseCenter, raidTarget } from './building.js';
import { resetThreatAfterRaid } from './threat.js';
import { addXp } from './progression.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { makeRng, TAU, dist2 } from '../core/util.js';

const rng = makeRng(0xF00DBEEF);

export const WARNING_TIME = 12;

const STALL_INTERVAL = 4;      // seconds between progress checks
const STALL_LIMIT = 12;        // seconds of no progress before relocating
const MAX_RAID_SECONDS = 300;  // absolute ceiling on a single raid
const BREAKOFF_TIME = 25;      // seconds of no progress at all before the horde gives up
const BREAKOFF_RADIUS = 900;   // how far from the raid centre still counts as "the base"

export function startRaid() {
  const index = G.raidsDone;
  const spec = raidSpec(index);
  const center = baseCenter();

  G.raid = {
    index, spec,
    cx: center.x, cy: center.y,
    hasBase: center.hasBase,
    phase: 'warning',
    timer: WARNING_TIME,
    wave: 0,
    spawned: 0,
    killed: 0,
    toSpawn: 0,
    spawnTimer: 0,
    total: 0,
  };
  // Total is fixed up front so the HUD can show honest progress.
  let total = 0;
  for (let w = 0; w < spec.waves; w++) total += spec.base + spec.growth * w;
  G.raid.total = total;

  sfx('raidWarn');
  screenFlash('#8c3a1a', 0.55);
  notify(`${spec.name} INCOMING — ${WARNING_TIME}s`, '#e05a4a', true);
  notify(center.hasBase ? 'They are heading for your base' : 'They are coming for you', '#d98a4a', true);
}

function spawnRing(cx, cy, minR, maxR) {
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(minR, maxR);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const lim = G.world.w * TILE;
    if (x < TILE * 2 || y < TILE * 2 || x > lim - TILE * 2 || y > lim - TILE * 2) continue;
    if (solidPx(x, y)) continue;
    return { x, y };
  }
  return null;
}

function pickRaidType(mix) {
  const r = rng();
  let acc = 0;
  for (const t in mix) { acc += mix[t]; if (r <= acc) return t; }
  return 'walker';
}

function startWave(raid) {
  raid.wave++;
  raid.toSpawn = raid.spec.base + raid.spec.growth * (raid.wave - 1);
  raid.spawnTimer = 0;
  notify(`WAVE ${raid.wave} / ${raid.spec.waves}`, '#e05a4a', true);
  sfx('raidWarn');
  shake(5);
}

export function updateRaid(dt) {
  const raid = G.raid;
  if (!raid) return;
  const p = G.player;

  if (raid.phase === 'warning') {
    raid.timer -= dt;
    // Recentre on the base right up until the horde arrives.
    const c = baseCenter();
    raid.cx = c.x; raid.cy = c.y; raid.hasBase = c.hasBase;
    if (Math.floor(raid.timer + dt) !== Math.floor(raid.timer) && raid.timer > 0 && raid.timer < 6) {
      sfx('ui');
    }
    if (raid.timer <= 0) {
      raid.phase = 'active';
      startWave(raid);
    }
    return;
  }

  // ------------------------------------------------------------- spawning --
  if (raid.toSpawn > 0) {
    raid.spawnTimer -= dt;
    if (raid.spawnTimer <= 0 && G.enemies.length < MAX_ENEMIES) {
      raid.spawnTimer = 0.22;
      // If the player has wandered off, spawn around them so the raid still
      // finds someone to fight.
      const anchorOnPlayer = !raid.hasBase || dist2(p.x, p.y, raid.cx, raid.cy) > 1500 * 1500;
      const ax = anchorOnPlayer ? p.x : raid.cx;
      const ay = anchorOnPlayer ? p.y : raid.cy;
      // Close enough that shamblers arrive in seconds rather than a minute,
      // far enough to stay off screen when they appear.
      const spot = spawnRing(ax, ay, 520, 800);
      if (spot) {
        const type = pickRaidType(raid.spec.mix);
        const hpMul = 1 + raid.index * 0.06;
        const e = spawnEnemy(type, spot.x, spot.y, { aggro: true, raid: true, hpMul });
        if (e) {
          e.objective = raidTarget({ x: spot.x, y: spot.y });
          raid.spawned++;
          raid.toSpawn--;
        }
      }
    }
  }

  // Keep objectives fresh as walls fall.
  raid.retarget = (raid.retarget || 0) - dt;
  if (raid.retarget <= 0) {
    raid.retarget = 1.5;
    for (const e of G.enemies) {
      if (!e.raid || e.dead) continue;
      if (!e.objective || e.objective.destroyed) e.objective = raidTarget(e);
    }
  }

  // Anti-stall. A raider that gets hung up on terrain it cannot steer around
  // would otherwise leave the raid unwinnable, blocking all progression. If one
  // stops closing on the base, it is quietly moved to a fresh approach lane.
  raid.stallCheck = (raid.stallCheck ?? STALL_INTERVAL) - dt;
  if (raid.stallCheck <= 0) {
    raid.stallCheck = STALL_INTERVAL;
    for (const e of G.enemies) {
      if (!e.raid || e.dead) continue;
      const d = Math.hypot(e.x - raid.cx, e.y - raid.cy);
      if (e.lastRaidDist === undefined) { e.lastRaidDist = d; e.raidStall = 0; continue; }
      // Only count it as stalled if it is both far away and not getting closer.
      if (d > 240 && d > e.lastRaidDist - 30) e.raidStall = (e.raidStall || 0) + STALL_INTERVAL;
      else e.raidStall = 0;
      e.lastRaidDist = d;

      if (e.raidStall >= STALL_LIMIT) {
        const spot = spawnRing(raid.cx, raid.cy, 360, 560);
        if (spot) {
          e.x = spot.x; e.y = spot.y;
          e.vx = 0; e.vy = 0;
          e.raidStall = 0;
          e.lastRaidDist = Math.hypot(e.x - raid.cx, e.y - raid.cy);
          e.objective = raidTarget(e);
          e.aggro = true;
        }
      }
    }
  }

  // A raid ends only when every raider is dead, so anything that leaves the
  // last few unkillable strands it — and the player with it. It happens for
  // real: the base falls, you die, you respawn across the map, and the
  // survivors of the horde set off after you but wedge on terrain they cannot
  // path around. Nothing can then change until the backstop below fires three
  // minutes later. So watch actual progress — kills, structure damage, damage
  // to the player — and if none of it moves for long enough, the horde gives up
  // and drifts away. The relocation above cannot fix this on its own: it only
  // considers raiders far from the base, and a raider wedged in the ruins is
  // not one of them.
  raid.progressCheck = (raid.progressCheck ?? 1) - dt;
  if (raid.progressCheck <= 0) {
    raid.progressCheck = 1;
    let structHp = 0;
    let standing = 0;
    for (const s of G.structures) {
      if (s.destroyed) continue;
      structHp += s.hp;
      if (dist2(s.x, s.y, raid.cx, raid.cy) < BREAKOFF_RADIUS * BREAKOFF_RADIUS) standing++;
    }
    const sig = `${raid.killed}|${Math.round(structHp)}|${Math.round(p.hp)}|${p.dead ? 1 : 0}`;
    raid.idle = sig === raid.lastSig ? (raid.idle || 0) + 1 : 0;
    raid.lastSig = sig;
    raid.standing = standing;
  }
  if ((raid.idle || 0) >= BREAKOFF_TIME) {
    scatterRaid(raid.standing
      ? 'The horde loses interest and drifts away'
      : 'Nothing left to take — the horde scatters');
    return;
  }

  // Hard backstop: no raid may outlast this, whatever goes wrong.
  raid.elapsed = (raid.elapsed || 0) + dt;
  if (raid.elapsed > MAX_RAID_SECONDS) {
    scatterRaid('The horde breaks off and scatters');
    return;
  }

  // ---------------------------------------------------------- wave / end ---
  const alive = G.enemies.reduce((n, e) => n + (e.raid && !e.dead ? 1 : 0), 0);
  if (raid.toSpawn <= 0 && alive === 0) {
    if (raid.wave < raid.spec.waves) {
      raid.interWave = (raid.interWave ?? 3.5) - dt;
      if (raid.interWave <= 0) { raid.interWave = 3.5; startWave(raid); }
    } else {
      finishRaid();
    }
  }
}

/**
 * Ends a raid the player did not finish: the horde wanders off rather than
 * being killed to the last. Sending stragglers home through here instead of
 * `finishRaid` matters, because a full salvage payout for a raid that flattened
 * your base would make hiding until it ended better than defending.
 */
function scatterRaid(message) {
  notify(message, '#d9c46a', true);
  for (let i = G.enemies.length - 1; i >= 0; i--) if (G.enemies[i].raid) G.enemies.splice(i, 1);
  finishRaid(false);
}

function finishRaid(repelled = true) {
  const raid = G.raid;
  const spec = raid.spec;
  // Paid on the share of the horde actually put down, so breaking off early
  // still earns what was earned and nothing more.
  const share = repelled ? 1 : Math.max(0, Math.min(1, raid.killed / Math.max(1, raid.total)));
  G.raid = null;
  G.raidsDone++;
  resetThreatAfterRaid();

  const reward = {};
  for (const id in spec.reward) {
    const n = Math.floor(spec.reward[id] * share);
    if (n > 0) { reward[id] = n; addRes(G.stash, id, n); }
  }
  addXp(Math.round(spec.xp * (repelled ? 1 : 0.5 + share * 0.5)));

  // Clean up stragglers that were part of the raid but wandered off.
  for (const e of G.enemies) if (e.raid) e.raid = false;

  sfx('raidWin');
  screenFlash(repelled ? '#2a6a3a' : '#4a4a2a', 0.4);
  const rewardText = Object.entries(reward).map(([k, v]) => `${k} +${v}`).join('  ');
  const tint = repelled ? '#b7e08a' : '#d9c46a';
  notify(repelled ? `${spec.name} REPELLED` : `${spec.name} OVER`, tint, true);
  notify(rewardText ? `Salvage delivered to stash — ${rewardText}` : 'No salvage worth taking', tint, true);
  if (G.player) FX.ring(G.player.x, G.player.y, 10, 200, 0.9, tint, 4);
}

/** Debug/testing helper — ends a raid instantly. */
export function forceEndRaid() {
  if (!G.raid) return;
  for (let i = G.enemies.length - 1; i >= 0; i--) if (G.enemies[i].raid) G.enemies.splice(i, 1);
  G.raid.toSpawn = 0;
  G.raid.wave = G.raid.spec.waves;
  finishRaid();
}

export const raidAliveCount = () =>
  G.enemies.reduce((n, e) => n + (e.raid && !e.dead ? 1 : 0), 0);
