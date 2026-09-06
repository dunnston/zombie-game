// Getting bytes between two browsers.
//
// A `Peer` is one connection to one other player: two channels — `reliable`
// (ordered) and `state` (unordered, best effort) — with the same four calls
// whatever is underneath. Two implementations:
//
//   WebRTC   the real thing. Introduced through the signalling broker
//            (server/signal.js), then browser to browser.
//   Loopback two peers wired together in memory. The smoke suite drives the
//            host session through this; no second browser, no broker.

import { makeStats } from './protocol.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** The broker URL: `?signal=wss://…` beats the build-time env, which beats localhost. */
export function signalUrl() {
  try {
    const q = new URLSearchParams(globalThis.location ? globalThis.location.search : '');
    if (q.get('signal')) return q.get('signal');
  } catch { /* no location */ }
  const env = (import.meta && import.meta.env && import.meta.env.VITE_SIGNAL_URL) || null;
  return env || 'ws://localhost:8787';
}

// --------------------------------------------------------------------- Peer --

/** Shared behaviour: listeners and byte counting. Subclasses supply `_send`. */
class PeerBase {
  constructor(label) {
    this.label = label;
    this.stats = makeStats();
    this.open = false;
    this._on = { reliable: [], state: [], close: [], open: [] };
  }
  onMessage(channel, fn) { this._on[channel].push(fn); return this; }
  onClose(fn) { this._on.close.push(fn); return this; }
  onOpen(fn) { this._on.open.push(fn); if (this.open) fn(); return this; }
  send(channel, obj) {
    if (!this.open) return false;
    const text = JSON.stringify(obj);
    this.stats.sentBytes += text.length;
    return this._send(channel, text);
  }
  _deliver(channel, text) {
    this.stats.recvBytes += text.length;
    let obj;
    try { obj = JSON.parse(text); } catch { return; }
    for (const fn of this._on[channel]) fn(obj);
  }
  _opened() {
    if (this.open) return;
    this.open = true;
    for (const fn of this._on.open) fn();
  }
  _closed() {
    if (!this.open && this._closedOnce) return;
    this._closedOnce = true;
    this.open = false;
    for (const fn of this._on.close) fn();
  }
}

// ---------------------------------------------------------------- loopback --

class LoopbackPeer extends PeerBase {
  constructor(label) { super(label); this.other = null; }
  _send(channel, text) {
    const o = this.other;
    if (!o || !o.open) return false;
    // Asynchronous like a network, ordered like the reliable channel; the state
    // channel is allowed to be lossy but here it simply is not.
    queueMicrotask(() => o._deliver(channel, text));
    return true;
  }
  close() {
    const o = this.other;
    this._closed();
    if (o) queueMicrotask(() => o._closed());
  }
}

/** Two connected peers. `a` is the host's end, `b` the guest's. */
export function makeLoopback() {
  const a = new LoopbackPeer('loop-host'), b = new LoopbackPeer('loop-guest');
  a.other = b; b.other = a;
  a._opened(); b._opened();
  return { a, b };
}

// ------------------------------------------------------------------- WebRTC --

class RtcPeer extends PeerBase {
  constructor(label, pc) {
    super(label);
    this.pc = pc;
    this.ch = { reliable: null, state: null };
    this._pending = 2;
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') this._closed();
    });
  }
  _attach(channel) {
    const name = channel.label === 'state' ? 'state' : 'reliable';
    this.ch[name] = channel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('message', (e) => this._deliver(name, typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)));
    channel.addEventListener('close', () => this._closed());
    const ready = () => { if (--this._pending <= 0) this._opened(); };
    if (channel.readyState === 'open') ready(); else channel.addEventListener('open', ready, { once: true });
  }
  _send(channel, text) {
    const ch = this.ch[channel];
    if (!ch || ch.readyState !== 'open') return false;
    try { ch.send(text); return true; } catch { return false; }
  }
  close() {
    try { this.pc.close(); } catch { /* ignore */ }
    this._closed();
  }
}

function newPc() {
  return new RTCPeerConnection({ iceServers: ICE });
}

// ------------------------------------------------------------------- broker --

function openSocket(url) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error('the signalling server did not answer')); }, 6000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`could not reach the signalling server at ${url}`)); }, { once: true });
  });
}

const sendWs = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

/**
 * Registers a room with the broker and turns every joining guest into a Peer.
 * Returns { code, close } once the broker has issued the code.
 *
 * @param {object} h  { onPeer(peer, gid), onGuestLeft(gid), onError(err) }
 */
export async function hostRoom(url, h) {
  const ws = await openSocket(url);
  const pcs = new Map();  // gid -> { pc, peer }

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no room code from the signalling server')), 6000);
    ws.addEventListener('message', function onFirst(e) {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'code') { clearTimeout(timer); ws.removeEventListener('message', onFirst); resolve(m.code); }
      else if (m.t === 'nope') { clearTimeout(timer); ws.removeEventListener('message', onFirst); reject(new Error(m.reason)); }
    });
    sendWs(ws, { t: 'host' });
  });

  ws.addEventListener('message', async (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    try {
      if (m.t === 'join') {
        const pc = newPc();
        const peer = new RtcPeer(`guest ${m.gid}`, pc);
        pcs.set(m.gid, { pc, peer });
        // The host opens both channels; the guest receives them.
        peer._attach(pc.createDataChannel('reliable', { ordered: true }));
        peer._attach(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
        pc.addEventListener('icecandidate', (ev) => { if (ev.candidate) sendWs(ws, { t: 'ice', gid: m.gid, cand: ev.candidate }); });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWs(ws, { t: 'offer', gid: m.gid, sdp: pc.localDescription });
        h.onPeer(peer, m.gid);
      } else if (m.t === 'answer') {
        const ent = pcs.get(m.gid);
        if (ent) await ent.pc.setRemoteDescription(m.sdp);
      } else if (m.t === 'ice') {
        const ent = pcs.get(m.gid);
        if (ent && m.cand) await ent.pc.addIceCandidate(m.cand).catch(() => {});
      } else if (m.t === 'guest-left') {
        const ent = pcs.get(m.gid);
        // The broker socket closing does not mean the game connection did —
        // only tell the session if the direct channel never came up.
        if (ent && !ent.peer.open) { ent.peer.close(); pcs.delete(m.gid); }
        if (h.onGuestLeft) h.onGuestLeft(m.gid);
      }
    } catch (err) {
      if (h.onError) h.onError(err);
    }
  });
  ws.addEventListener('close', () => { if (h.onBrokerClosed) h.onBrokerClosed(); });

  return {
    code,
    close() {
      for (const { peer } of pcs.values()) peer.close();
      pcs.clear();
      try { ws.close(); } catch { /* ignore */ }
    },
  };
}

/**
 * Joins a room by code and resolves with the Peer once both channels are open.
 * Rejects with a readable reason if the code is wrong, the room is full, or the
 * connection never comes up (a symmetric NAT with no TURN server, usually).
 */
export async function joinRoom(url, code, opts = {}) {
  const ws = await openSocket(url);
  const timeoutMs = opts.timeoutMs || 15000;
  return new Promise((resolve, reject) => {
    let pc = null, peer = null, done = false;
    const fail = (err) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } if (peer) peer.close(); reject(err); };
    const timer = setTimeout(() => fail(new Error('could not connect to the host — they may be behind a firewall this version cannot cross')), timeoutMs);

    ws.addEventListener('message', async (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      try {
        if (m.t === 'nope') { fail(new Error(m.reason)); return; }
        if (m.t === 'joined') return;
        if (m.t === 'host-left') { fail(new Error('the host left before you connected')); return; }
        if (m.t === 'offer') {
          pc = newPc();
          peer = new RtcPeer('host', pc);
          pc.addEventListener('datachannel', (ev) => peer._attach(ev.channel));
          pc.addEventListener('icecandidate', (ev) => { if (ev.candidate) sendWs(ws, { t: 'ice', cand: ev.candidate }); });
          peer.onOpen(() => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            // The broker has done its job; the game runs peer to peer from here.
            try { ws.close(); } catch { /* ignore */ }
            resolve(peer);
          });
          await pc.setRemoteDescription(m.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWs(ws, { t: 'answer', sdp: pc.localDescription });
        } else if (m.t === 'ice' && pc && m.cand) {
          await pc.addIceCandidate(m.cand).catch(() => {});
        }
      } catch (err) { fail(err); }
    });
    ws.addEventListener('close', () => { if (!done && !pc) fail(new Error('lost the signalling server')); });
    sendWs(ws, { t: 'join', code });
  });
}
