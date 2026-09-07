// The host session. This browser runs the simulation exactly as it does in
// solo; on top of that it lets guests in, feeds their intent into their
// players, and tells everyone what happened.
//
// Nothing here touches the sim's rules. Guests' intents land in p.intent and
// the ordinary update() acts on them; snapshots are read from G after it.

import { G, notify, netHooks } from '../game/state.js';
import { joinPlayer, parkPlayer } from '../game/game.js';
import { serialiseGame, playerRecord } from '../game/save.js';
import { saveGame } from '../game/saves.js';
import { hostRoom, signalUrl } from './transport.js';
import {
  joinRefusal, refreshBuild, MAX_PLAYERS, SNAP_EVERY, SYNC_INTERVAL, INTENT_TIMEOUT_MS, msg, mergeIntent, mergeLateIntent,
  packSnapshot, packRoster, packStructure, makeStats, tickStats,
} from './protocol.js';
import { clearIntent } from '../game/intent.js';
import { emit, drainEvents, clearEvents, broadcastNotify } from './events.js';
import { executeCommand } from './actions.js';

const H = {
  room: null,
  name: 'Host',
  pwHash: null,
  guests: new Map(),     // peer -> guest
  step: 0,
  seq: 0,
  syncT: 0,
  stashHash: '',
};

export const isHosting = () => G.net.role === 'host';

/**
 * Puts this browser in charge without talking to any broker: the sim becomes
 * the authority and guests can be attached by hand (the suite does this with a
 * loopback peer). startHosting() calls it, then adds the room.
 */
export function hostOffline({ name, passwordHash } = {}) {
  if (H.room) stopHosting();
  H.name = (name || '').trim() || G.player?.name || 'Host';
  H.pwHash = passwordHash || null;
  H.guests.clear();
  H.step = 0; H.seq = 0; H.syncT = 0; H.stashHash = '';
  G.net.role = 'host';
  G.net.status = 'hosting';
  G.net.error = null;
  G.net.stats = makeStats();
  G.net.guests = [];
  G.mode = 'coop';
  if (G.player) G.player.name = H.name;
  netHooks.emit = emit;
  notify.onBroadcast = broadcastNotify;
}

/** Attaches a ready peer as a guest, as the broker would. For the suite. */
export function debugAttachGuest(peer, gid = 'debug') { attachGuest(peer, gid); }

/**
 * Registers a room with the broker. Resolves once the code is known; guests
 * can join from then on, in the lobby or mid-game alike.
 */
export async function startHosting({ name, passwordHash } = {}) {
  hostOffline({ name, passwordHash });
  G.net.status = 'contacting the signalling server…';

  try {
    H.room = await hostRoom(signalUrl(), {
      onPeer: (peer, gid) => attachGuest(peer, gid),
      onGuestLeft: () => {},
      onError: (err) => { G.net.error = String(err && err.message || err); },
      onBrokerClosed: () => { if (isHosting()) G.net.status = 'signalling server gone — nobody new can join, current players are fine'; },
    });
  } catch (err) {
    stopHosting();
    G.net.error = String(err && err.message || err);
    throw err;
  }
  G.net.code = H.room.code;
  G.net.status = 'open';
  return H.room.code;
}

export function stopHosting() {
  for (const g of H.guests.keys()) { try { g.send('reliable', msg.bye()); g.close(); } catch { /* ignore */ } }
  H.guests.clear();
  if (H.room) { try { H.room.close(); } catch { /* ignore */ } }
  H.room = null;
  netHooks.emit = null;
  notify.onBroadcast = null;
  clearEvents();
  G.net.role = 'solo';
  G.net.code = null;
  G.net.status = '';
  G.net.guests = [];
}

// ------------------------------------------------------------------- guests --

function attachGuest(peer, gid) {
  const guest = { peer, gid, player: null, name: '', invHash: '', lastSeq: -1, lastIntentAt: 0, quiet: false };
  H.guests.set(peer, guest);
  peer.onMessage('reliable', (m) => onReliable(guest, m));
  peer.onMessage('state', (m) => onState(guest, m));
  peer.onClose(() => dropGuest(guest, 'connection lost'));
  refreshGuestList();
}

function onReliable(guest, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'hello') return admit(guest, m);
  if (!guest.player) return;                    // nothing else before hello
  if (m.t === 'cmd') return executeCommand(guest.player, m.c, m.a || {});
  if (m.t === 'bye') return dropGuest(guest, 'left');
}

function onState(guest, m) {
  if (!guest.player || !m || m.t !== 'in') return;
  // Out-of-order on the unreliable channel: an older packet must not undo a
  // newer one, but its edges are still real presses.
  if (typeof m.q === 'number' && m.q < guest.lastSeq) {
    mergeLateIntent(guest.player.intent, m.i);
    return;
  }
  guest.lastSeq = m.q;
  guest.lastIntentAt = performance.now();
  guest.quiet = false;
  mergeIntent(guest.player.intent, m.i);
}

/** A guest that has gone silent holds nothing. Their edges were consumed by the step anyway. */
function expireSilentIntents() {
  const now = performance.now();
  for (const g of H.guests.values()) {
    if (!g.player || g.quiet || !g.lastIntentAt) continue;
    if (now - g.lastIntentAt > INTENT_TIMEOUT_MS) { clearIntent(g.player.intent); g.quiet = true; }
  }
}

async function admit(guest, m) {
  const reject = (reason) => { guest.peer.send('reliable', msg.reject(reason)); setTimeout(() => guest.peer.close(), 200); };
  await refreshBuild();          // our own code may have changed under HMR too
  const stale = joinRefusal(m.p, m.b);
  if (stale) return reject(stale);
  if (H.pwHash && m.pw !== H.pwHash) return reject('wrong password');
  if (!G.world || !G.player) return reject('the host has not started a game yet');

  // The same person back again, or someone new. A second window of the host's
  // own browser carries the host's identity: that is a new player, not the
  // host, and it gets a derived id so the save keeps both records.
  let identityId = m.id || null;
  if (identityId && G.player && G.player.id === identityId) identityId = `${identityId}#2`;
  let p = identityId ? G.players.find((q) => q.id === identityId) : null;
  if (p && !p.away) {
    // Already here from another tab — refuse rather than fork the character.
    return reject('that player is already connected');
  }
  if (!p) {
    const present = G.players.filter((q) => !q.away).length;
    if (present >= MAX_PLAYERS) return reject('that game is full');
    p = joinPlayer({ id: identityId, name: (m.name || '').trim() || undefined });
  } else {
    p.away = false;
    if (m.name && m.name.trim()) p.name = m.name.trim();
    notify(`${p.name} is back`, '#9fd0ff', true, 'all');
  }
  guest.player = p;
  guest.name = p.name;

  guest.peer.send('reliable', msg.welcome(p.netId, serialiseGame(), packRoster(G), H.name));
  emit('roster', { roster: packRoster(G) });
  refreshGuestList();
  // Their inventory goes straight away rather than waiting for the sync tick.
  sendInventory(guest, true);
}

function dropGuest(guest, why) {
  if (!H.guests.has(guest.peer)) return;
  H.guests.delete(guest.peer);
  const p = guest.player;
  if (p) {
    parkPlayer(p);
    notify(`${p.name} ${why === 'left' ? 'left' : 'lost connection'}`, '#8a8f84', false, 'all');
    emit('roster', { roster: packRoster(G) });
  }
  try { guest.peer.close(); } catch { /* ignore */ }
  refreshGuestList();
}

function refreshGuestList() {
  G.net.guests = [...H.guests.values()].map((g) => ({
    name: g.player ? g.player.name : '(connecting…)', color: g.player ? g.player.color : null,
    netId: g.player ? g.player.netId : 0, connected: !!g.player,
  }));
}

// -------------------------------------------------------------- per update --

/** Called by game.js after every fixed step while hosting. */
export function hostAfterUpdate(dt) {
  if (!isHosting()) return;
  H.step++;
  tickStats(G.net.stats, dt);
  expireSilentIntents();

  if (H.step % SNAP_EVERY === 0) {
    H.seq++;
    for (const g of H.guests.values()) {
      if (!g.player) continue;
      g.peer.send('state', packSnapshot(G, g.player, H.seq));
    }
    G.net.stats.snaps++;
  }

  H.syncT += dt;
  if (H.syncT >= SYNC_INTERVAL) {
    H.syncT = 0;
    for (const g of H.guests.values()) sendInventory(g, false);
    syncStores();
    syncDynamicStructures();
  }

  const evs = drainEvents();
  if (evs.length) {
    for (const ev of evs) {
      const to = ev._to;
      delete ev._to;
      for (const g of H.guests.values()) {
        if (!g.player) continue;
        if (to !== null && to !== undefined && g.player.netId !== to) continue;
        g.peer.send('reliable', ev);
      }
    }
  }

  // Roll the aggregate byte counters up from the peers.
  let sent = 0, recv = 0;
  for (const g of H.guests.values()) { sent += g.peer.stats.sentBytes; recv += g.peer.stats.recvBytes; }
  G.net.stats.sentBytes = sent; G.net.stats.recvBytes = recv;
}

function sendInventory(guest, force) {
  const p = guest.player;
  if (!p) return;
  const rec = playerRecord(p);
  const text = JSON.stringify([rec.bag, rec.hotbar, rec.equip, rec.mag, rec.carKeys, rec.attrs, rec.perks, rec.skillPoints]);
  if (!force && text === guest.invHash) return;
  guest.invHash = text;
  guest.peer.send('reliable', msg.ev('inv', { rec }));
}

/**
 * Storage, diffed and sent only when it changed — the same hash-and-resync
 * shape inventories already use. Every container in the base is one entry:
 * the shared stash under a null tile, and each chest or locker under its own.
 *
 * Sent whole rather than as deltas because a container is small (16-48 slots),
 * changes rarely, and a missed delta would leave a guest looking at a chest
 * that does not match what is in it.
 */
function syncStores() {
  const list = [{ tx: null, ty: null, slots: G.stash.slots }];
  for (const s of G.structures) {
    if (!s.store || s.destroyed || s.type === 'stash') continue;
    list.push({ tx: s.tx, ty: s.ty, slots: s.store.slots });
  }
  const text = JSON.stringify(list);
  if (text === H.stashHash) return;
  H.stashHash = text;
  emit('stores', { list });
}

/** Generators burn, turrets aim, floodlights power up: low-rate field sync. */
function syncDynamicStructures() {
  const list = [];
  for (const s of G.structures) {
    if (s.destroyed) continue;
    if (s.type === 'generator' || s.type === 'turret' || s.type === 'floodlight') list.push(packStructure(s));
  }
  if (list.length) emit('dyn', { list });
}

/** Saves the hosted world; guests' characters ride along in the record. */
export const hostSave = () => saveGame();
