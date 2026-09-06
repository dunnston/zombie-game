// The host's outgoing event queue.
//
// Simulation code that changes something a guest must hear about calls
// emit(kind, fields). In solo, and on a guest, this is a no-op. On the host the
// queue is flushed to every connected guest after each update. Keeping the call
// in the sim modules and the sending in host.js means no sim module imports the
// network.

import { G } from '../game/state.js';

const queue = [];

/** True when this browser is the authority and guests are listening. */
export const hosting = () => !!(G.net && G.net.role === 'host');

/** Queues an event for every guest (or, with `to`, for one netId). */
export function emit(kind, fields = {}, to = null) {
  if (!hosting()) return;
  queue.push({ t: 'ev', k: kind, ...fields, _to: to });
}

/** Takes everything queued since the last flush. */
export function drainEvents() {
  if (queue.length === 0) return [];
  const out = queue.slice();
  queue.length = 0;
  return out;
}

export function clearEvents() { queue.length = 0; }

/**
 * notify() with a scope: 'local' (the default everywhere) reaches only this
 * screen; 'all' is world news — raids, the day turning, someone joining — and
 * is repeated to every guest.
 */
export function broadcastNotify(text, color, big) {
  emit('notify', { text, color, big: !!big });
}
