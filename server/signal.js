// The signalling broker. Not a game server.
//
// Two browsers cannot find each other from a six-character code alone, so this
// process introduces them: the host registers and gets a code, a guest joins
// with the code, and the broker relays the WebRTC offer/answer/ICE blobs
// between them until a direct connection exists. Then it is out of the loop —
// game traffic never comes here, and this can go down mid-game with no effect.
//
// It holds nothing but the live room table. No passwords (the host checks
// those after the direct channel is up), no game state, no accounts.
//
//   npm run signal            → ws://localhost:8787
//   PORT=9000 npm run signal
//
// Wire (JSON, one object per message):
//   host  → { t:'host' }                        broker → { t:'code', code }
//   guest → { t:'join', code }                  broker → { t:'joined', gid } | { t:'nope', reason }
//   host  → { t:'offer'|'ice', gid, ... }        relayed to that guest as { t, ... }
//   guest → { t:'answer'|'ice', ... }            relayed to the host as { t, gid, ... }
//   host socket closes                          every guest gets { t:'host-left' }
//   guest socket closes                         host gets { t:'guest-left', gid }

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8787);
// No 0/O/1/I: a code is read aloud or typed from a screenshot.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
const MAX_GUESTS = 3;

/** @type {Map<string, { host: import('ws').WebSocket, guests: Map<string, import('ws').WebSocket>, seq: number }>} */
const rooms = new Map();

export function makeCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return s;
}

export const isCode = (s) => typeof s === 'string' && s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c));

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function newCode() {
  for (let i = 0; i < 50; i++) {
    const c = makeCode();
    if (!rooms.has(c)) return c;
  }
  return null;
}

export function startBroker(port = PORT) {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    let role = null;      // 'host' | 'guest'
    let code = null;
    let gid = null;

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || typeof m.t !== 'string') return;

      if (m.t === 'host' && !role) {
        code = newCode();
        if (!code) { send(ws, { t: 'nope', reason: 'no room codes free' }); return; }
        role = 'host';
        rooms.set(code, { host: ws, guests: new Map(), seq: 0 });
        send(ws, { t: 'code', code });
        return;
      }

      if (m.t === 'join' && !role) {
        const want = String(m.code || '').toUpperCase();
        const room = rooms.get(want);
        if (!isCode(want) || !room) { send(ws, { t: 'nope', reason: 'no game with that code' }); return; }
        if (room.guests.size >= MAX_GUESTS) { send(ws, { t: 'nope', reason: 'that game is full' }); return; }
        role = 'guest';
        code = want;
        gid = `g${++room.seq}`;
        room.guests.set(gid, ws);
        send(ws, { t: 'joined', gid });
        send(room.host, { t: 'join', gid });
        return;
      }

      const room = code && rooms.get(code);
      if (!room) return;

      // Relay only the handshake message types, only within the room.
      if (m.t !== 'offer' && m.t !== 'answer' && m.t !== 'ice') return;
      if (role === 'host') {
        const g = room.guests.get(m.gid);
        if (g) send(g, { t: m.t, sdp: m.sdp, cand: m.cand });
      } else if (role === 'guest') {
        send(room.host, { t: m.t, gid, sdp: m.sdp, cand: m.cand });
      }
    });

    ws.on('close', () => {
      const room = code && rooms.get(code);
      if (!room) return;
      if (role === 'host') {
        for (const g of room.guests.values()) send(g, { t: 'host-left' });
        rooms.delete(code);
      } else if (role === 'guest') {
        room.guests.delete(gid);
        send(room.host, { t: 'guest-left', gid });
      }
    });
  });

  return wss;
}

// Run directly: `node server/signal.js`. Imported by the tests: nothing starts.
if (process.argv[1] && /signal\.js$/.test(process.argv[1])) {
  startBroker(PORT);
  console.log(`DEADLINE signalling broker on ws://localhost:${PORT} — it only introduces players; game traffic goes browser to browser.`);
}
