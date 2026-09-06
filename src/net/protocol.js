// What goes over the wire, and the small pure helpers around it. No sockets,
// no game state — this module is importable under Node so the tests can check
// the shapes.
//
// Two channels. `reliable` is ordered: the join handshake, commands from a
// guest, events from the host. `state` is unordered and unacknowledged: a
// guest's intent every step, the host's snapshot at SNAP_HZ. Everything is JSON
// in v1; sizes are measured into G.net.stats rather than guessed.

export const PROTOCOL = 1;
export const SNAP_HZ = 20;
export const SNAP_EVERY = 3;            // fixed steps between snapshots at 60Hz
export const INTEREST_RADIUS = 1600;    // px around a guest that a snapshot describes
export const SYNC_INTERVAL = 0.5;       // seconds between inventory / stash / dynamic-structure diffs
export const MAX_PLAYERS = 4;

// ------------------------------------------------------------------ identity --
// A guest is the same person next week. The id lives in their browser; the
// host's save remembers their character by it.

const IDENTITY_KEY = 'deadline.identity';

export function loadIdentity() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const id = JSON.parse(raw);
      if (id && typeof id.id === 'string') return id;
    }
  } catch { /* fall through */ }
  const id = { id: randomId(), name: '' };
  saveIdentity(id);
  return id;
}

export function saveIdentity(identity) {
  try { globalThis.localStorage && globalThis.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity)); } catch { /* ignore */ }
  return identity;
}

export function randomId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}`;
}

// ------------------------------------------------------------------ password --
// Hashed in the browser, compared by the host. The broker never sees it.

export async function hashPassword(pw, salt = 'deadline') {
  const text = `${salt}:${pw || ''}`;
  const c = globalThis.crypto;
  if (c && c.subtle) {
    const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Node without WebCrypto (very old): a weak but stable fallback so tests run.
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// ---------------------------------------------------------------- room codes --

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
export const isRoomCode = (s) =>
  typeof s === 'string' && s.length === CODE_LEN && [...s].every((c) => CODE_ALPHABET.includes(c));
export const normaliseCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);

// ------------------------------------------------------------------ messages --
// Envelopes are plain objects with a `t`. These builders keep the field names in
// one place; the host and client read them by the same names.

export const msg = {
  hello: (identityId, name, passwordHash) => ({ t: 'hello', p: PROTOCOL, id: identityId, name, pw: passwordHash }),
  welcome: (netId, world, roster, hostName) => ({ t: 'welcome', n: netId, world, roster, host: hostName }),
  reject: (reason) => ({ t: 'reject', reason }),
  intent: (seq, intent) => ({ t: 'in', q: seq, i: packIntent(intent) }),
  cmd: (name, args) => ({ t: 'cmd', c: name, a: args || {} }),
  ev: (kind, fields) => ({ t: 'ev', k: kind, ...fields }),
  bye: () => ({ t: 'bye' }),
};

// ------------------------------------------------------------------- intents --
// The intent struct is what the sim reads (see game/intent.js). Packed into
// short keys for the wire and unpacked back into the same shape.

export function packIntent(it) {
  return {
    mx: r2(it.mx), my: r2(it.my), ax: Math.round(it.aimX), ay: Math.round(it.aimY),
    f: flags(it.sprint, it.sneak, it.fire, it.firePressed, it.reload, it.interact, it.interactHeld, it.use,
      it.stow, it.unstow, it.withdrawAmmo,
      it.drive.forward, it.drive.back, it.drive.left, it.drive.right, it.drive.brake),
    s: it.slot, w: it.wheel,
  };
}

export function unpackIntent(p, into) {
  const it = into;
  it.mx = p.mx || 0; it.my = p.my || 0;
  it.aimX = p.ax || 0; it.aimY = p.ay || 0;
  const f = p.f || 0;
  it.sprint = !!(f & 1); it.sneak = !!(f & 2); it.fire = !!(f & 4); it.firePressed = !!(f & 8);
  it.reload = !!(f & 16); it.interact = !!(f & 32); it.interactHeld = !!(f & 64); it.use = !!(f & 128);
  it.stow = !!(f & 256); it.unstow = !!(f & 512); it.withdrawAmmo = !!(f & 1024);
  it.drive.forward = !!(f & 2048); it.drive.back = !!(f & 4096);
  it.drive.left = !!(f & 8192); it.drive.right = !!(f & 16384); it.drive.brake = !!(f & 32768);
  it.slot = typeof p.s === 'number' ? p.s : -1;
  it.wheel = p.w || 0;
  return it;
}

/**
 * Edge flags arriving in a packet must survive until a simulation step has
 * seen them, even if a later packet without the edge lands first. Merging ORs
 * the edges and takes the held state from the newest packet.
 */
export function mergeIntent(into, fresh) {
  const edges = {
    firePressed: into.firePressed, reload: into.reload, interact: into.interact, use: into.use,
    stow: into.stow, unstow: into.unstow, withdrawAmmo: into.withdrawAmmo,
    slot: into.slot, wheel: into.wheel,
  };
  unpackIntent(fresh, into);
  into.firePressed ||= edges.firePressed; into.reload ||= edges.reload; into.interact ||= edges.interact;
  into.use ||= edges.use; into.stow ||= edges.stow; into.unstow ||= edges.unstow; into.withdrawAmmo ||= edges.withdrawAmmo;
  if (into.slot < 0) into.slot = edges.slot;
  if (into.wheel === 0) into.wheel = edges.wheel;
  return into;
}

function flags(...bits) {
  let f = 0;
  for (let i = 0; i < bits.length; i++) if (bits[i]) f |= 1 << i;
  return f;
}

// ----------------------------------------------------------------- snapshots --

export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;

export function packPlayer(p) {
  return {
    n: p.netId, x: r1(p.x), y: r1(p.y), a: r2(p.angle), hp: r1(p.hp), mh: p.maxHp, st: r1(p.stam), ms: p.maxStam,
    s: p.slot, d: p.dead ? 1 : 0, dn: p.downed ? 1 : 0, dt: r1(p.downT || 0), dr: p.drivingId || 0,
    sn: p.sneaking ? 1 : 0, sp: p.sprinting ? 1 : 0, sw: p.swing ? 1 : 0, rl: p.reloading ? 1 : 0,
    lv: p.level, xp: Math.round(p.xp), xn: Math.round(p.xpNext), sk: p.skillPoints, aw: p.away ? 1 : 0,
    ch: p.searching ? r2(p.searching.t / p.searching.dur) : p.using ? r2(p.using.t / p.using.dur) : p.reviving ? r2(p.reviving.t / p.reviving.dur) : -1,
    ck: p.searching ? 's' : p.using ? 'u' : p.reviving ? 'r' : '',
  };
}

export function packEnemy(e) {
  return { id: e.id, t: e.type, x: r1(e.x), y: r1(e.y), a: r2(e.angle), hp: r1(e.hp), mh: e.maxHp, f: e.flash > 0 ? 1 : 0, ag: e.aggro ? 1 : 0, rd: e.raid ? 1 : 0 };
}

export function packPickup(it) {
  return { u: it.uid, x: r1(it.x), y: r1(it.y), k: it.kind, i: it.id, n: it.n };
}

export function packVehicle(v) {
  return {
    id: v.id, x: r1(v.x), y: r1(v.y), a: r2(v.angle), sp: r1(v.speed || 0), hp: r1(v.hp), fu: r1(v.fuel),
    dm: v.destroyed ? 1 : 0, eg: v.engineOn ? 1 : 0, lk: v.locked ? 1 : 0, hw: v.hotwired ? 1 : 0, si: v.si,
    kh: v.keyHint || '', kid: v.keyId || null,
  };
}

export function packSurvivor(s) {
  return {
    id: s.id, x: r1(s.x), y: r1(s.y), a: r2(s.angle), hp: r1(s.hp), mh: s.maxHp, dn: s.downed ? 1 : 0, dt: r1(s.downT || 0),
    j: s.job, nm: s.name, lv: s.level, hg: s.hungry ? 1 : 0, oa: s.outOfAmmo ? 1 : 0,
    tw: s.tower ? { tx: s.tower.tx, ty: s.tower.ty } : null, ps: s.posted ? 1 : 0,
  };
}

/** The per-guest world picture: everything near them, and every player. */
export function packSnapshot(G, forPlayer, seq) {
  const cx = forPlayer.x, cy = forPlayer.y;
  const R2 = INTEREST_RADIUS * INTEREST_RADIUS;
  const near = (o) => { const dx = o.x - cx, dy = o.y - cy; return dx * dx + dy * dy <= R2; };
  const enemies = [];
  for (const e of G.enemies) if (!e.dead && near(e)) enemies.push(packEnemy(e));
  const pickups = [];
  for (const it of G.pickups) if (near(it)) pickups.push(packPickup(it));
  const vehicles = [];
  for (const v of G.vehicles) if (near(v) || v.id === forPlayer.drivingId) vehicles.push(packVehicle(v));
  const survivors = [];
  for (const s of G.survivors) if (!s.dead) survivors.push(packSurvivor(s));
  return {
    t: 'snap', q: seq,
    tm: r2(G.time), day: G.day, dt: r2(G.dayTime), th: r1(G.threat), tt: G.threatTier,
    raid: G.raid ? { ph: G.raid.phase, w: G.raid.wave, ws: G.raid.spec.waves, k: G.raid.killed, tot: G.raid.total, tmr: r1(G.raid.timer || 0), nm: G.raid.spec.name, cx: Math.round(G.raid.cx), cy: Math.round(G.raid.cy) } : null,
    rd: G.raidsDone, bt: G.benchTier,
    pl: G.players.map(packPlayer),
    en: enemies, pk: pickups, vh: vehicles, sv: survivors,
    // Death drops: few, and a guest needs to see their own to recover it.
    bp: G.backpacks.map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y) })),
  };
}

/** A structure as the wire (and the save) describes it. */
export function packStructure(s) {
  return {
    t: s.type, tx: s.tx, ty: s.ty, hp: r1(s.hp), maxHp: s.maxHp, open: !!s.open, tier: s.tier || 1,
    fuel: r1(s.fuel || 0), ammo: s.ammo || 0, on: s.on !== false, active: !!s.active,
    running: !!s.running, powered: !!s.powered, aim: r2(s.aim || 0), destroyed: !!s.destroyed,
  };
}

/** Everything a joining guest needs that a snapshot does not carry. */
export function packRoster(G) {
  return G.players.map((p) => ({ n: p.netId, id: p.id || null, name: p.name, color: p.color, aw: p.away ? 1 : 0 }));
}

// -------------------------------------------------------------------- stats --

export function makeStats() {
  return { sentBytes: 0, recvBytes: 0, sentPerSec: 0, recvPerSec: 0, snaps: 0, _t: 0, _s: 0, _r: 0 };
}

/** Rolls the per-second counters once a second. Call with dt every step. */
export function tickStats(st, dt) {
  st._t += dt;
  if (st._t >= 1) {
    st.sentPerSec = Math.round((st.sentBytes - st._s) / st._t);
    st.recvPerSec = Math.round((st.recvBytes - st._r) / st._t);
    st._s = st.sentBytes; st._r = st.recvBytes; st._t = 0;
  }
}
