// The guest session. This browser does not run the world; it shows the one the
// host describes and sends back what its player wants to do.
//
// Own movement is predicted locally with the same movePlayer() the host runs,
// then pulled toward the host's answer. Everything else eases toward its last
// reported position. Anything that changes shared state goes to the host as a
// command (see actions.js) and comes back as an event.

import { G, notify, netHooks, removeStructure, structAt } from '../game/state.js';
import { ENEMIES, TILE } from '../game/config.js';
import { gatherLocalIntent, clearIntent } from '../game/intent.js';
import { movePlayer, createPlayer } from '../game/player.js';
import { applySaveData, restorePlayerRecord } from '../game/save.js';
import { makeStructure } from '../game/building.js';
import { makeSurvivor } from '../game/survivors.js';
import { spawnBullet } from '../game/combat.js';
import { occupyTiles, releaseTiles } from '../game/vehicles.js';
import { removeProp } from '../game/world.js';
import { addPlayer } from '../game/state.js';
import { seedLoot } from '../game/loot.js';
import { joinRoom, signalUrl } from './transport.js';
import { PROTOCOL, msg, unpackIntent, tickStats, makeStats } from './protocol.js';
import { sfx } from '../core/audio.js';
import * as FX from '../core/particles.js';
import { makeRng, TAU, clamp } from '../core/util.js';

const rng = makeRng(0xC11E47);

const C = {
  peer: null,
  seq: 0,
  snap: null,          // latest snapshot
  auth: null,          // authoritative position of our own player from the latest snapshot
  lastSnapT: 0,
  wasDowned: false, wasDead: false, level: 0,
};

export const isClient = () => G.net.role === 'client';

/**
 * Joins a hosted game. Resolves once the world has arrived and is on screen.
 * Rejects with a readable reason.
 */
export async function joinGame({ code, passwordHash, identity }) {
  leaveGame(false);
  G.net.role = 'client';
  G.net.status = 'contacting the signalling server…';
  G.net.error = null;
  G.net.stats = makeStats();
  G.net.code = code;

  let peer;
  try {
    peer = await joinRoom(signalUrl(), code);
  } catch (err) {
    G.net.role = 'solo';
    G.net.status = '';
    G.net.error = String(err && err.message || err);
    throw err;
  }
  C.peer = peer;
  G.net.status = 'connected — waiting for the host…';

  const welcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the host did not answer')), 15000);
    peer.onMessage('reliable', function first(m) {
      if (!m) return;
      if (m.t === 'welcome') { clearTimeout(timer); resolve(m); }
      else if (m.t === 'reject') { clearTimeout(timer); reject(new Error(m.reason || 'refused')); }
    });
    peer.onClose(() => { clearTimeout(timer); reject(new Error('the host closed the connection')); });
    peer.send('reliable', msg.hello(identity.id, identity.name, passwordHash));
  }).catch((err) => {
    leaveGame(false);
    G.net.error = String(err && err.message || err);
    throw err;
  });

  applyWelcome(welcome, identity);
  peer.onMessage('reliable', onReliable);
  peer.onMessage('state', onState);
  peer.onClose(() => hostGone('The host left.'));
  G.net.status = 'in game';
  return true;
}

/**
 * The host closed the room or the line died. The world in G is a stale copy
 * of theirs — it must not carry on as a solo game (and never be saved), so the
 * guest goes back to the JOIN screen with the code still filled in and the
 * reason on the status line. The teardown itself is game.js's toTitle(),
 * reached through netHooks: importing game.js from here closes an import cycle
 * that broke boot.
 */
function hostGone(text) {
  if (!isClient()) return;
  leaveGame(false);
  if (netHooks.toTitle) netHooks.toTitle(false);
  else { G.scene = 'title'; G.paused = false; }
  G.menu.screen = 'join';
  G.menu.busy = false;
  G.menu.error = text;
  G.net.error = text;
}

export function leaveGame(sayBye = true) {
  if (C.peer) {
    if (sayBye) { try { C.peer.send('reliable', msg.bye()); } catch { /* ignore */ } }
    try { C.peer.close(); } catch { /* ignore */ }
  }
  C.peer = null; C.snap = null; C.auth = null;
  if (G.net.role === 'client') { G.net.role = 'solo'; G.net.status = ''; G.net.code = null; G.net.hostName = null; }
}

// ---------------------------------------------------------------- welcome --

function applyWelcome(m, identity) {
  const ok = applySaveData(m.world);
  if (!ok) throw new Error('the host sent a world this version cannot read');
  seedLoot((G.world.seed ^ 0x9E3779B9) >>> 0);
  G.slotId = null;               // guests do not save; the host remembers them
  G.mode = 'coop';
  G.net.hostName = m.host || 'Host';
  applyRoster(m.roster);
  // Our own character is whichever record carries our identity.
  const idx = G.players.findIndex((p) => p.netId === m.n);
  if (idx < 0) throw new Error('the host did not include your character');
  G.localIdx = idx;
  const me = G.player;
  me.away = false;
  me.godMode = false;
  G.camera.x = me.x; G.camera.y = me.y;
  C.wasDowned = me.downed; C.wasDead = me.dead; C.level = me.level;
  G.scene = 'game';
  G.paused = false;
  G.ui.panel = null;
  notify(`Joined ${G.net.hostName}'s game`, '#9fd0ff', true);
  void identity;
}

/** Keeps G.players lined up with the host's roster: names, colours, who is away. */
function applyRoster(roster) {
  if (!Array.isArray(roster)) return;
  for (const r of roster) {
    let p = G.players.find((q) => q.netId === r.n);
    if (!p) {
      const anchor = G.player || { x: 0, y: 0 };
      p = createPlayer(anchor.x, anchor.y, { id: r.id, name: r.name, seat: G.players.length });
      addPlayer(p);
      p.netId = r.n;
    }
    p.name = r.name; if (r.color) p.color = r.color;
    p.id = r.id || p.id;
    p.away = !!r.aw;
  }
}

// ---------------------------------------------------------------- messages --

function onReliable(m) {
  if (!m || m.t !== 'ev') {
    if (m && m.t === 'bye') hostGone('The host ended the game.');
    return;
  }
  switch (m.k) {
    case 'struct': upsertStructure(m.s); break;
    case 'sdel': { const s = structAt(m.tx, m.ty); if (s) { s.destroyed = true; removeStructure(s); } break; }
    case 'dyn': for (const rec of m.list || []) upsertStructure(rec); break;
    case 'stash': G.stash = m.stash || {}; G.stashItems = m.items || {}; break;
    case 'inv': if (G.player) restorePlayerRecord(G.player, m.rec, { keepPosition: true }); break;
    case 'bullet':
      spawnBullet(m.x, m.y, m.a, { speed: m.sp, dmg: 0, life: m.lf, color: m.c, size: m.sz, owner: 'remote' });
      if (m.w) sfx(m.w === 'smg' ? 'smg' : m.w === 'shotgun' ? 'shotgun' : m.w === 'rifle' || m.w === 'carbine' ? 'rifle' : m.w === 'turret' ? 'turret' : 'pistol');
      break;
    case 'edie': {
      const i = G.enemies.findIndex((e) => e.id === m.id);
      if (i >= 0) G.enemies.splice(i, 1);
      FX.blood(m.x, m.y, 0, 0, 16);
      FX.decal(m.x, m.y, 14, '#4a1010');
      G.corpses.push({ x: m.x, y: m.y, angle: m.a || 0, type: m.tp || 'walker', t: 0, life: 45 });
      sfx('zombieDie');
      break;
    }
    case 'notify': notify(m.text, m.color, m.big); break;
    case 'loot':
      if (G.player && m.n === G.player.netId) {
        let y = m.y - 12;
        for (const l of m.lines || []) { FX.text(m.x, y, l.text, l.color, 12, -34, 1.1); y -= 15; }
        sfx('loot');
      }
      FX.ring(m.x, m.y, 4, 34, 0.4, '#c9a227', 2);
      break;
    case 'looted': { const c = G.world.containers.find((x) => x.id === m.id); if (c) c.looted = true; break; }
    case 'prop': { const prop = G.world.propGrid.get(m.key); if (prop) removeProp(G.world, prop); break; }
    case 'loc': { const l = G.world.locations.find((x) => x.id === m.id); if (l) l.discovered = true; break; }
    case 'roster': applyRoster(m.roster); break;
    case 'rescues': G.rescues = (m.list || []).map((r) => ({ ...r, found: false })); break;
    case 'fx': if (m.f === 'ring') FX.ring(m.x, m.y, m.r0 || 6, m.r1 || 60, m.d || 0.5, m.c || '#9fd0ff', m.w || 2); break;
    default: break;
  }
}

function upsertStructure(rec) {
  if (!rec) return;
  let s = structAt(rec.tx, rec.ty);
  if (s && s.type !== rec.t) { s.destroyed = true; removeStructure(s); s = null; }
  if (!s) {
    if (rec.destroyed) return;
    s = makeStructure(rec.t, rec.tx, rec.ty, 1);
    if (!s) return;
  }
  s.maxHp = rec.maxHp || s.maxHp;
  s.hp = Math.min(rec.hp ?? s.maxHp, s.maxHp);
  s.open = !!rec.open; s.tier = rec.tier || 1; s.fuel = rec.fuel || 0; s.ammo = rec.ammo || 0;
  s.on = rec.on !== false; s.active = !!rec.active; s.running = !!rec.running; s.powered = !!rec.powered;
  s.aim = rec.aim || s.aim || 0;
  if (rec.destroyed) { s.destroyed = true; removeStructure(s); }
}

function onState(m) {
  if (!m || m.t !== 'snap') return;
  if (C.snap && m.q < C.snap.q) return;     // late packet
  C.snap = m;
  C.lastSnapT = performance.now();
  applySnapshot(m);
}

// --------------------------------------------------------------- snapshots --

function applySnapshot(s) {
  G.time = s.tm; G.day = s.day; G.dayTime = s.dt; G.threat = s.th; G.threatTier = s.tt;
  G.raidsDone = s.rd; G.benchTier = s.bt;
  G.raid = s.raid ? {
    phase: s.raid.ph, wave: s.raid.w, spec: { waves: s.raid.ws, name: s.raid.nm }, killed: s.raid.k, total: s.raid.tot,
    timer: s.raid.tmr, cx: s.raid.cx, cy: s.raid.cy, hasBase: true,
  } : null;

  // Players. Ours: authoritative stats, position reconciled in updateClient.
  for (const pr of s.pl) {
    const p = G.players.find((q) => q.netId === pr.n);
    if (!p) continue;
    p.hp = pr.hp; p.maxHp = pr.mh; p.stam = pr.st; p.maxStam = pr.ms;
    p.dead = !!pr.d; p.downed = !!pr.dn; p.downT = pr.dt; p.drivingId = pr.dr || null;
    p.level = pr.lv; p.xp = pr.xp; p.xpNext = pr.xn; p.skillPoints = pr.sk; p.away = !!pr.aw;
    const chan = pr.ck ? { t: pr.ch, dur: 1 } : null;
    p.searching = pr.ck === 's' ? { ...chan, c: null } : null;
    p.using = pr.ck === 'u' ? { ...chan, id: 'bandage' } : null;
    p.reviving = pr.ck === 'r' ? { ...chan, target: null } : null;
    if (p === G.player) {
      C.auth = { x: pr.x, y: pr.y };
      if (p.slot !== pr.s) p.slot = pr.s;
      if (pr.dn && !C.wasDowned) { notify('YOU ARE DOWN — a teammate can get you up', '#e05a4a', true); sfx('playerDie'); }
      if (pr.d && !C.wasDead) { notify('YOU DIED — your pack is marked on the map', '#e05a4a', true); sfx('playerDie'); }
      if (!pr.d && C.wasDead) notify('Respawned', '#9fd0ff', true);
      if (pr.lv > C.level && C.level > 0) { notify(`LEVEL ${pr.lv} — ${pr.sk} skill point${pr.sk === 1 ? '' : 's'} to spend`, '#ffe08a', true); sfx('levelUp'); }
      C.wasDowned = !!pr.dn; C.wasDead = !!pr.d; C.level = pr.lv;
      if (pr.d || pr.dn || pr.dr) { p.x = pr.x; p.y = pr.y; }   // no prediction while dead, down or driving
    } else {
      p.tx = pr.x; p.ty = pr.y; p.angle = pr.a; p.slot = pr.s;
      p.sneaking = !!pr.sn; p.sprinting = !!pr.sp;
      p.swing = pr.sw ? (p.swing || { t: 0, dur: 0.2, angle: pr.a, arc: 1.2, range: 40 }) : null;
      if (p.tx === undefined || Math.hypot(p.tx - p.x, p.ty - p.y) > 400) { p.x = pr.x; p.y = pr.y; }
    }
  }

  // Enemies, by id.
  const seen = new Set();
  for (const er of s.en) {
    seen.add(er.id);
    let e = G.enemies.find((x) => x.id === er.id);
    if (!e) {
      const def = ENEMIES[er.t];
      if (!def) continue;
      e = { id: er.id, type: er.t, def, x: er.x, y: er.y, vx: 0, vy: 0, angle: er.a, hp: er.hp, maxHp: er.mh,
        flash: 0, dead: false, aggro: !!er.ag, anim: rng.range(0, TAU), raid: !!er.rd, atkCd: 0, windup: 0, slowT: 0 };
      G.enemies.push(e);
    }
    e.tx = er.x; e.ty = er.y; e.ta = er.a; e.hp = er.hp; e.maxHp = er.mh; e.aggro = !!er.ag; e.raid = !!er.rd;
    if (er.f) e.flash = 0.11;
    if (Math.hypot(e.tx - e.x, e.ty - e.y) > 300) { e.x = e.tx; e.y = e.ty; }
  }
  for (let i = G.enemies.length - 1; i >= 0; i--) if (!seen.has(G.enemies[i].id)) G.enemies.splice(i, 1);

  // Pickups, by uid.
  const seenP = new Set();
  for (const pr of s.pk) {
    seenP.add(pr.u);
    let it = G.pickups.find((x) => x.uid === pr.u);
    if (!it) { it = { uid: pr.u, x: pr.x, y: pr.y, kind: pr.k, id: pr.i, n: pr.n, vx: 0, vy: 0, t: 0, bob: rng.range(0, TAU), life: 600 }; G.pickups.push(it); }
    it.tx = pr.x; it.ty = pr.y; it.n = pr.n;
  }
  for (let i = G.pickups.length - 1; i >= 0; i--) if (!seenP.has(G.pickups[i].uid)) G.pickups.splice(i, 1);

  // Vehicles, by id. A car with its engine on has released its tiles on the host.
  for (const vr of s.vh) {
    const v = G.vehicles.find((x) => x.id === vr.id);
    if (!v) continue;
    const wasOn = v.engineOn;
    v.tx = vr.x; v.ty = vr.y; v.ta = vr.a; v.speed = vr.sp; v.hp = vr.hp; v.fuel = vr.fu;
    v.destroyed = !!vr.dm; v.engineOn = !!vr.eg; v.locked = !!vr.lk; v.hotwired = !!vr.hw;
    if (v.engineOn && !wasOn) releaseTiles(v);
    if (!v.engineOn && wasOn) { v.x = v.tx; v.y = v.ty; v.angle = v.ta; occupyTiles(v); }
    if (Math.hypot(v.tx - v.x, v.ty - v.y) > 200) { v.x = v.tx; v.y = v.ty; v.angle = v.ta; }
  }

  // Death drops, by id. Contents stay on the host; a guest only needs the marker.
  const seenB = new Set();
  for (const br of s.bp || []) {
    seenB.add(br.id);
    let b = G.backpacks.find((x) => x.id === br.id);
    if (!b) { b = { id: br.id, x: br.x, y: br.y, contents: { bag: {}, mag: {} }, t: 0 }; G.backpacks.push(b); }
  }
  for (let i = G.backpacks.length - 1; i >= 0; i--) if (!seenB.has(G.backpacks[i].id)) G.backpacks.splice(i, 1);

  // Survivors, by id.
  const seenS = new Set();
  for (const sr of s.sv) {
    seenS.add(sr.id);
    let sv = G.survivors.find((x) => x.id === sr.id);
    if (!sv) {
      sv = makeSurvivor(sr.x, sr.y, { id: sr.id, name: sr.nm, level: sr.lv, recruited: true, job: sr.j });
      G.survivors.push(sv);
    }
    sv.tx = sr.x; sv.ty = sr.y; sv.angle = sr.a; sv.hp = sr.hp; sv.maxHp = sr.mh; sv.downed = !!sr.dn; sv.downT = sr.dt;
    sv.job = sr.j; sv.name = sr.nm; sv.level = sr.lv; sv.hungry = !!sr.hg; sv.outOfAmmo = !!sr.oa; sv.posted = !!sr.ps;
    sv.tower = sr.tw ? structAt(sr.tw.tx, sr.tw.ty) : null;
    if (Math.hypot(sv.tx - sv.x, sv.ty - sv.y) > 300) { sv.x = sv.tx; sv.y = sv.ty; }
  }
  for (let i = G.survivors.length - 1; i >= 0; i--) if (!seenS.has(G.survivors[i].id)) G.survivors.splice(i, 1);
}

// ------------------------------------------------------------ per update --

/** One fixed step on a guest: send intent, predict self, ease everyone else. */
export function updateClient(dt) {
  const me = G.player;
  if (!me || !C.peer) return;
  tickStats(G.net.stats, dt);
  G.net.stats.sentBytes = C.peer.stats.sentBytes; G.net.stats.recvBytes = C.peer.stats.recvBytes;

  gatherLocalIntent(me);
  C.seq++;
  C.peer.send('state', msg.intent(C.seq, me.intent));

  // Predict our own movement with the host's code, then lean toward its answer.
  if (!me.dead && !me.downed && !me.drivingId) {
    me.lastHurt += dt;
    me.attackCd = Math.max(0, me.attackCd - dt);
    me.angle = Math.atan2(me.intent.aimY - me.y, me.intent.aimX - me.x);
    movePlayer(me, dt, false);
    if (C.auth) {
      const dx = C.auth.x - me.x, dy = C.auth.y - me.y;
      const err = Math.hypot(dx, dy);
      if (err > 48) { me.x = C.auth.x; me.y = C.auth.y; }
      else if (err > 0.5) { const k = 1 - Math.exp(-6 * dt); me.x += dx * k; me.y += dy * k; }
    }
  } else if (me.drivingId) {
    const v = G.vehicles.find((x) => x.id === me.drivingId);
    if (v) { me.x = v.x; me.y = v.y; me.angle = v.angle; }
  }

  // Everyone and everything else eases toward its last reported place.
  const k = 1 - Math.exp(-14 * dt);
  const ease = (o) => {
    if (o.tx === undefined) return;
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
    if (o.ta !== undefined) o.angle += angleTo(o.angle, o.ta) * k;
  };
  for (const p of G.players) if (p !== me && !p.away && !p.dead) { ease(p); if (p.swing) { p.swing.t += dt; if (p.swing.t >= p.swing.dur) p.swing.t = 0; } }
  for (const e of G.enemies) { ease(e); e.flash = Math.max(0, e.flash - dt); e.anim += dt * (2 + e.def.speed * 0.03); }
  for (const it of G.pickups) { ease(it); it.t += dt; }
  for (const v of G.vehicles) if (v.engineOn) ease(v);
  for (const sv of G.survivors) { ease(sv); sv.anim = (sv.anim || 0) + dt * 5; sv.flash = Math.max(0, sv.flash || 0); }
  for (const b of G.bullets) b.remote = true;
}

function angleTo(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/**
 * While paused (or otherwise not playing) the host must hear "holding nothing",
 * not silence: silence leaves the last intent in force until the host's
 * timeout, and a paused player must stop the instant they pause.
 */
export function sendIdleIntent() {
  const me = G.player;
  if (!me || !C.peer) return;
  clearIntent(me.intent);
  C.seq++;
  C.peer.send('state', msg.intent(C.seq, me.intent));
}

/** Sends a command to the host. */
export function sendCommand(name, args) {
  if (!C.peer) return false;
  return C.peer.send('reliable', msg.cmd(name, args));
}

export const clientDebug = { state: C, unpackIntent, clamp, TILE, PROTOCOL, hostGone };
