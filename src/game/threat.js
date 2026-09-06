// The Threat meter. Doing loud, powerful things attracts a horde; lying low
// bleeds it back down. Threat is what schedules raids — never a calendar.

import { THREAT } from './config.js';
import { G, notify, baseOwner } from './state.js';
import { sfx } from '../core/audio.js';
import { nightFactors } from './daynight.js';

const TIER_NAMES = ['LOW', 'RISING', 'HIGH', 'CRITICAL'];
const TIER_COLORS = ['#8fae6a', '#d9c46a', '#d98a4a', '#e05a4a'];

/**
 * @param actor  the player whose noise this is, for their Threat perks. Things
 *               nobody did personally — a running generator, a turret — read
 *               the base owner's.
 */
export function addThreat(amount, reason = '', actor = null) {
  const src = actor || baseOwner();
  if (!src || G.raid) return;
  const mul = src.threatMul ?? 1;
  // Noise carries further in the dark, and more of them are awake to hear it.
  G.threat = Math.min(THREAT.max, G.threat + amount * mul * nightFactors().threat);
  checkTier(reason);
}

export function threatTier(v = G.threat) {
  if (v >= THREAT.warnAt[2]) return 3;
  if (v >= THREAT.warnAt[1]) return 2;
  if (v >= THREAT.warnAt[0]) return 1;
  return 0;
}

export const threatLabel = (v = G.threat) => TIER_NAMES[threatTier(v)];
export const threatColor = (v = G.threat) => TIER_COLORS[threatTier(v)];

function checkTier() {
  const t = threatTier();
  if (t > G.threatTier) {
    G.threatTier = t;
    if (t === 1) notify('THREAT RISING — they are starting to gather', '#d9c46a', true, 'all');
    if (t === 2) { notify('THREAT HIGH — fortify now', '#d98a4a', true, 'all'); sfx('raidWarn'); }
    if (t === 3) { notify('THREAT CRITICAL — a horde is forming', '#e05a4a', true, 'all'); sfx('raidWarn'); }
  } else if (t < G.threatTier) {
    G.threatTier = t;
  }
}

export function updateThreat(dt) {
  if (G.raid) return;
  // Once the meter is full it stays pinned until the raid actually launches —
  // otherwise decay would shave it back below the threshold every frame and a
  // raid could never fire.
  if (G.threat >= THREAT.max) return;
  // Passive bleed-off, but never below zero and never while a raid is live.
  if (G.threat > 0) {
    G.threat = Math.max(0, G.threat - THREAT.decayPerSec * dt);
    checkTier();
  }
}

export const raidReady = () => !G.raid && G.threat >= THREAT.max;

export function resetThreatAfterRaid() {
  G.threat = THREAT.postRaidReset;
  G.threatTier = threatTier();
}
