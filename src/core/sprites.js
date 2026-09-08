// Every visual asset in the game is generated here at boot into offscreen
// canvases. Nothing is loaded from disk or network.
// Convention: entity sprites face +X (right); the renderer rotates them.

import { TAU, hash2 } from './util.js';

export const Sprites = {};

function mk(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  draw(g, c.width, c.height);
  return c;
}

/** White silhouette of a sprite, used for the hit flash. */
function whiten(src, tint = '#ffffff') {
  return mk(src.width, src.height, (g, w, h) => {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
  });
}

/** Deterministic speckle pass — cheap grit that keeps flat colours from looking sterile. */
function speckle(g, w, h, n, colors, seed = 0, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const r1 = hash2(seed + i * 3, 17);
    const r2 = hash2(seed + i * 3 + 1, 91);
    const r3 = hash2(seed + i * 3 + 2, 233);
    g.fillStyle = colors[Math.floor(r3 * colors.length) % colors.length];
    g.fillRect(Math.floor(r1 * w), Math.floor(r2 * h), 1, 1);
  }
  g.restore();
}

function ellipse(g, x, y, rx, ry, fill, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, TAU);
  g.fillStyle = fill;
  g.fill();
  g.restore();
}

function roundRect(g, x, y, w, h, r, fill, stroke = null, lw = 1) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}

// ------------------------------------------------------------------ zombies -

function zombieSprite(def, scale) {
  const s = def.r * 2 * scale;
  const pad = 10;
  const size = Math.ceil(s + pad * 2);
  return mk(size, size, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const r = def.r * scale;

    // Reaching arms (drawn first so the torso overlaps them)
    g.strokeStyle = def.dark;
    g.lineCap = 'round';
    g.lineWidth = Math.max(3, r * 0.34);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + r * 0.1, cy + side * r * 0.55);
      g.lineTo(cx + r * 1.05, cy + side * r * 0.42);
      g.stroke();
    }
    // Hands
    for (const side of [-1, 1]) {
      ellipse(g, cx + r * 1.12, cy + side * r * 0.42, r * 0.2, r * 0.2, '#8e9a72');
    }

    // Torso — wider across the shoulders than deep, reads as top-down
    ellipse(g, cx - r * 0.05, cy, r * 0.86, r * 0.99, def.dark);
    ellipse(g, cx - r * 0.05, cy, r * 0.74, r * 0.86, def.body);

    // Torn shirt highlight
    g.save();
    g.globalAlpha = 0.35;
    ellipse(g, cx - r * 0.3, cy - r * 0.2, r * 0.35, r * 0.42, '#ffffff22');
    g.restore();

    // Head, pushed forward
    ellipse(g, cx + r * 0.42, cy, r * 0.52, r * 0.5, def.dark);
    ellipse(g, cx + r * 0.44, cy, r * 0.43, r * 0.41, '#9db07a');

    // Jaw / eyes
    g.fillStyle = '#231c18';
    g.fillRect(cx + r * 0.66, cy - r * 0.3, Math.max(1, r * 0.16), Math.max(1, r * 0.16));
    g.fillRect(cx + r * 0.66, cy + r * 0.16, Math.max(1, r * 0.16), Math.max(1, r * 0.16));

    // Blood
    g.fillStyle = '#71212199';
    g.beginPath();
    g.arc(cx + r * 0.2, cy + r * 0.4, r * 0.28, 0, TAU);
    g.fill();

    speckle(g, w, h, Math.floor(r * 5), ['#00000033', '#ffffff22', '#4a2b2b55'], def.hp, 0.7);
  });
}

function behemothSprite(def) {
  const base = zombieSprite(def, 1);
  return mk(base.width, base.height, (g, w, h) => {
    g.drawImage(base, 0, 0);
    const cx = w / 2, cy = h / 2, r = def.r;
    // Bone plating across the shoulders
    g.fillStyle = '#c9c2ab';
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.ellipse(cx - r * 0.35, cy + i * r * 0.32, r * 0.22, r * 0.13, 0, 0, TAU);
      g.fill();
    }
    g.strokeStyle = '#8d3d3d';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r * 0.95, 0, TAU);
    g.stroke();
  });
}

// -------------------------------------------------------------------- props -

function treeSprite(seed) {
  const size = 56;
  return mk(size, size, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    // Trunk
    g.fillStyle = '#3b2c1e';
    g.fillRect(cx - 3, cy - 3, 6, 8);
    const layers = [
      { r: 21, c: '#1f2c17' }, { r: 17, c: '#2b3d1f' },
      { r: 12, c: '#374d26' }, { r: 7, c: '#425b2c' },
    ];
    for (const L of layers) {
      g.beginPath();
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * TAU;
        const rr = L.r * (0.78 + hash2(seed + i, L.r) * 0.42);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.94;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = L.c;
      g.fill();
    }
    speckle(g, w, h, 60, ['#4d6b3399', '#16200f88'], seed, 0.6);
  });
}

/** A conifer: stacked, narrowing tiers with a short trunk. The forest's tree. */
function pineSprite(seed) {
  const size = 56;
  return mk(size, size, (g, w, h) => {
    const cx = w / 2, cy = h / 2 + 4;
    g.fillStyle = '#2e2216';
    g.fillRect(cx - 2.5, cy + 6, 5, 8);
    const tiers = [
      { r: 22, y: 8, c: '#16240f' }, { r: 18, y: 2, c: '#1e3015' },
      { r: 13, y: -4, c: '#27401b' }, { r: 8, y: -9, c: '#324f22' }, { r: 4, y: -13, c: '#3d5c2a' },
    ];
    for (const L of tiers) {
      g.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU - Math.PI / 2;
        const rr = L.r * (0.72 + hash2(seed + i, L.r) * 0.5);
        const x = cx + Math.cos(a) * rr;
        const y = cy + L.y + Math.sin(a) * rr * 0.62;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = L.c;
      g.fill();
    }
    speckle(g, w, h, 40, ['#4a6b3399', '#0e160888'], seed, 0.5);
  });
}

/** A round hay bale, seen from a little above. */
function hayBaleSprite(seed) {
  return mk(30, 26, (g, w, h) => {
    ellipse(g, 15, 15, 12, 8, '#7a6428');
    ellipse(g, 15, 12, 12, 8, '#a8893a');
    g.strokeStyle = '#7a6428aa';
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(15, 12, 4 + i * 3.5, 2.5 + i * 2.2, 0, 0, TAU);
      g.stroke();
    }
    speckle(g, w, h, 20, ['#c9a84a88', '#5a481c88'], seed, 0.6);
  });
}

/** A grain silo: a tall drum with a domed cap, drawn as its two-tile footprint. */
function siloSprite() {
  return mk(64, 80, (g, w, h) => {
    const grad = g.createLinearGradient(8, 0, 56, 0);
    grad.addColorStop(0, '#5d6570'); grad.addColorStop(0.45, '#8f98a3'); grad.addColorStop(1, '#4e555e');
    g.fillStyle = grad;
    g.fillRect(10, 18, 44, 54);
    ellipse(g, 32, 72, 22, 8, '#4a5059');
    g.fillStyle = grad;
    g.fillRect(10, 18, 44, 50);
    ellipse(g, 32, 18, 22, 9, '#7d8692');
    ellipse(g, 32, 14, 16, 6, '#98a1ad');
    g.strokeStyle = '#3a4048aa';
    g.lineWidth = 1;
    for (let y = 30; y < 70; y += 12) { g.beginPath(); g.moveTo(10, y); g.lineTo(54, y); g.stroke(); }
    g.fillStyle = '#2f343a';
    g.fillRect(28, 56, 8, 12);
  });
}

/** A tuft of reeds for the water's edge. Scenery only. */
function reedSprite(seed) {
  return mk(22, 26, (g, w, h) => {
    for (let i = 0; i < 6; i++) {
      const x = 4 + hash2(seed, i) * 14;
      const top = 3 + hash2(seed + 7, i) * 8;
      g.strokeStyle = i % 2 ? '#5d7a3a' : '#4a6530';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, 24); g.lineTo(x + (hash2(seed, i + 3) - 0.5) * 4, top); g.stroke();
      if (i % 3 === 0) { g.fillStyle = '#6b4f2a'; g.fillRect(x - 1, top, 2.5, 5); }
    }
  });
}

function bushSprite(seed) {
  return mk(28, 28, (g, w, h) => {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + hash2(seed, i);
      ellipse(g, 14 + Math.cos(a) * 5, 14 + Math.sin(a) * 4, 7, 6,
        i % 2 ? '#2f4020' : '#3a4f28');
    }
  });
}

function rockSprite(seed) {
  return mk(26, 26, (g, w, h) => {
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const rr = 9 + hash2(seed + i, 3) * 4;
      const x = 13 + Math.cos(a) * rr, y = 13 + Math.sin(a) * rr * 0.85;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = '#565349';
    g.fill();
    g.fillStyle = '#6b675b';
    g.beginPath();
    g.ellipse(11, 11, 5, 4, -0.4, 0, TAU);
    g.fill();
  });
}

/**
 * Ground litter. Small, low-contrast enough not to clutter the screen, but
 * with a warm rim so the eye catches it against grass — this is the first
 * thing a new player has to notice, so it errs toward visible.
 */
function litterSprite(kind, seed) {
  return mk(22, 20, (g, w, h) => {
    if (kind === 'sticks') {
      g.strokeStyle = '#6b4e2e'; g.lineWidth = 2.2;
      for (let i = 0; i < 3; i++) {
        const a = hash2(seed, i) * Math.PI;
        const cx = 8 + hash2(seed + i, 4) * 6, cy = 8 + hash2(seed + i, 7) * 5;
        const dx = Math.cos(a) * 7, dy = Math.sin(a) * 4;
        g.beginPath(); g.moveTo(cx - dx, cy - dy); g.lineTo(cx + dx, cy + dy); g.stroke();
      }
      g.strokeStyle = '#8a6a3c'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(4, 12); g.lineTo(17, 9); g.stroke();
    } else if (kind === 'stone') {
      for (let i = 0; i < 3; i++) {
        const cx = 7 + hash2(seed + i, 3) * 8, cy = 8 + hash2(seed + i, 5) * 6;
        const r = 2.6 + hash2(seed + i, 11) * 2.2;
        ellipse(g, cx, cy, r, r * 0.8, i ? '#6b675b' : '#7d766b');
        ellipse(g, cx - r * 0.3, cy - r * 0.3, r * 0.4, r * 0.3, '#8d867a');
      }
    } else {
      // Fiber: a tuft of dry grass.
      g.strokeStyle = '#8a9a4a'; g.lineWidth = 1.6;
      for (let i = 0; i < 6; i++) {
        const x = 5 + i * 2.4 + hash2(seed, i) * 1.5;
        g.beginPath(); g.moveTo(x, 16);
        g.quadraticCurveTo(x + (hash2(seed + i, 2) - 0.5) * 6, 9, x + (hash2(seed + i, 3) - 0.5) * 9, 3);
        g.stroke();
      }
      g.strokeStyle = '#6d7a38'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(6, 16); g.lineTo(16, 16); g.stroke();
    }
  });
}

/** A boulder: a rock the size of a car, with a lit cap and a long shadow side. */
function boulderSprite(seed) {
  return mk(46, 44, (g, w, h) => {
    const cx = 23, cy = 24;
    g.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const rr = 17 + hash2(seed + i, 5) * 5;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.84;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = '#4e4a44'; g.fill();
    // Lit cap, offset up-left, so it reads as a dome from above.
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const rr = 11 + hash2(seed + i, 9) * 3.5;
      const x = cx - 2 + Math.cos(a) * rr, y = cy - 3 + Math.sin(a) * rr * 0.8;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = '#66605a'; g.fill();
    g.fillStyle = '#797168';
    g.beginPath(); g.ellipse(cx - 5, cy - 7, 6, 4, -0.4, 0, TAU); g.fill();
    // Fracture lines: where a pickaxe would go.
    g.strokeStyle = '#2f2c28'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(cx - 9, cy + 8); g.lineTo(cx - 1, cy - 2); g.lineTo(cx + 7, cy + 5); g.stroke();
    speckle(g, w, h, 60, ['#00000044', '#ffffff18'], seed, 0.7);
  });
}

/** A thicket: bramble, taller and denser than a bush, with cane tips. */
function thicketSprite(seed) {
  return mk(40, 38, (g, w, h) => {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + hash2(seed, i);
      const r = 6 + hash2(seed + i, 2) * 5;
      ellipse(g, 20 + Math.cos(a) * 9, 20 + Math.sin(a) * 7, r, r * 0.85,
        i % 3 === 0 ? '#25331a' : i % 3 === 1 ? '#2f4020' : '#3a4f28');
    }
    // Canes standing proud of the mass.
    g.strokeStyle = '#4d5f30'; g.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) {
      const bx = 8 + hash2(seed + i, 11) * 24, by = 26 + hash2(seed + i, 13) * 6;
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + 2, by - 10, bx + 5, by - 17); g.stroke();
    }
    speckle(g, w, h, 40, ['#16200f88', '#5c7a3a66'], seed, 0.6);
  });
}

function carSprite(color, dark, wrecked) {
  return mk(74, 40, (g, w, h) => {
    // Body
    roundRect(g, 4, 6, 66, 28, 7, dark);
    roundRect(g, 6, 8, 62, 24, 6, color);
    // Roof / cabin
    roundRect(g, 22, 10, 28, 20, 4, '#00000055');
    roundRect(g, 24, 12, 24, 16, 3, wrecked ? '#2a2f33' : '#5c7684');
    // Windscreen glints
    if (!wrecked) {
      g.fillStyle = '#8fb3c299';
      g.fillRect(26, 13, 8, 6);
    }
    // Bonnet lines
    g.strokeStyle = '#00000044';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(52, 9); g.lineTo(52, 31); g.stroke();
    g.beginPath(); g.moveTo(20, 9); g.lineTo(20, 31); g.stroke();
    // Wheels
    g.fillStyle = '#171717';
    g.fillRect(14, 2, 12, 6); g.fillRect(48, 2, 12, 6);
    g.fillRect(14, 32, 12, 6); g.fillRect(48, 32, 12, 6);
    // Lights
    g.fillStyle = wrecked ? '#4a4a44' : '#d8cf9a';
    g.fillRect(67, 11, 3, 5); g.fillRect(67, 24, 3, 5);

    if (wrecked) {
      g.fillStyle = '#2a2622';
      g.beginPath(); g.moveTo(40, 8); g.lineTo(56, 16); g.lineTo(44, 30); g.lineTo(34, 18); g.closePath(); g.fill();
      speckle(g, w, h, 90, ['#00000066', '#5a4a3a88', '#7a3a2a55'], 7, 0.8);
    }
    speckle(g, w, h, 50, ['#00000033', '#ffffff18'], 3, 0.5);
  });
}

/** Dry stone: irregular blocks, mortarless, a lighter cap where the light lands. */
function stoneWallSprite() {
  return mk(32, 32, (g, w, h) => {
    g.fillStyle = '#4e4a44';
    g.fillRect(0, 0, 32, 32);
    // Courses of blocks, offset row to row.
    let y = 0, row = 0;
    while (y < 32) {
      const bh = 7 + (row % 2);
      let x = row % 2 ? -4 : 0;
      while (x < 32) {
        const bw = 9 + ((hash2(row * 7, x) * 5) | 0);
        const t = hash2(x, row * 3);
        g.fillStyle = t > 0.66 ? '#6d675e' : t > 0.33 ? '#635d55' : '#59544c';
        g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
        x += bw;
      }
      y += bh; row++;
    }
    g.fillStyle = '#7d766b';
    g.fillRect(0, 0, 32, 3);
    g.fillStyle = '#00000044';
    g.fillRect(0, 29, 32, 3);
    speckle(g, w, h, 40, ['#00000033', '#ffffff14'], 11, 0.6);
  });
}

// --------------------------------------------------------------- containers -

function containerSprite(kind) {
  const S = 30;
  return mk(S, S, (g, w, h) => {
    const base = {
      cabinet: ['#5c4630', '#775a3d'], toolbox: ['#7a4a22', '#a8672f'],
      shelf: ['#4d4a44', '#6a6659'], medcab: ['#b9bec0', '#dfe4e6'],
      crate: ['#4f5a4a', '#67765f'], trunk: ['#454a50', '#5d646c'],
      locker: ['#2f4459', '#3f5a76'], safe: ['#3a3d40', '#54585c'],
      milcrate: ['#4a5233', '#636d44'], pump: ['#7a3b2c', '#a4503b'],
      logs: ['#4a3620', '#6a4f2d'], drum: ['#5a3a2a', '#8a4a30'],
    }[kind] || ['#5a5245', '#726858'];

    roundRect(g, 2, 2, S - 4, S - 4, 3, base[0]);
    roundRect(g, 3.5, 3.5, S - 7, S - 7, 2, base[1]);

    g.strokeStyle = '#00000055';
    g.lineWidth = 1;

    if (kind === 'cabinet' || kind === 'locker') {
      g.beginPath(); g.moveTo(S / 2, 4); g.lineTo(S / 2, S - 4); g.stroke();
      g.fillStyle = '#2b2b2b';
      g.fillRect(S / 2 - 4, S / 2 - 1, 3, 3);
      g.fillRect(S / 2 + 2, S / 2 - 1, 3, 3);
    } else if (kind === 'shelf') {
      for (let y = 8; y < S - 4; y += 7) { g.beginPath(); g.moveTo(4, y); g.lineTo(S - 4, y); g.stroke(); }
      g.fillStyle = '#a8916d'; g.fillRect(6, 5, 4, 3); g.fillRect(14, 12, 5, 3); g.fillRect(9, 19, 6, 3);
    } else if (kind === 'toolbox') {
      g.fillStyle = '#2f2f2f'; g.fillRect(9, 3, 12, 4);
      g.beginPath(); g.moveTo(4, 14); g.lineTo(S - 4, 14); g.stroke();
    } else if (kind === 'medcab') {
      g.fillStyle = '#c9333f';
      g.fillRect(S / 2 - 2, 8, 4, 14); g.fillRect(S / 2 - 7, 13, 14, 4);
    } else if (kind === 'safe') {
      g.fillStyle = '#8c8f93';
      g.beginPath(); g.arc(S / 2, S / 2, 5, 0, TAU); g.fill();
      g.fillStyle = '#2d2f31';
      g.beginPath(); g.arc(S / 2, S / 2, 2.4, 0, TAU); g.fill();
      g.strokeStyle = '#22242699'; g.strokeRect(5, 5, S - 10, S - 10);
    } else if (kind === 'milcrate') {
      g.strokeStyle = '#2b3320'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(4, 10); g.lineTo(S - 4, 10); g.stroke();
      g.beginPath(); g.moveTo(4, S - 10); g.lineTo(S - 4, S - 10); g.stroke();
      g.fillStyle = '#c7c07a'; g.font = 'bold 8px monospace'; g.fillText('AMMO', 4, S / 2 + 3);
    } else if (kind === 'crate') {
      g.strokeStyle = '#2f3a2b'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(3, 3); g.lineTo(S - 3, S - 3); g.stroke();
      g.beginPath(); g.moveTo(S - 3, 3); g.lineTo(3, S - 3); g.stroke();
    } else if (kind === 'trunk') {
      g.beginPath(); g.moveTo(4, 11); g.lineTo(S - 4, 11); g.stroke();
      g.fillStyle = '#8b9199'; g.fillRect(S / 2 - 3, 14, 6, 2);
    } else if (kind === 'logs') {
      // Log ends, stacked.
      for (const [x, y] of [[8, 9], [15, 9], [22, 9], [11.5, 16], [18.5, 16], [15, 23]]) {
        g.fillStyle = '#8a6a3c'; g.beginPath(); g.arc(x, y, 3.6, 0, TAU); g.fill();
        g.fillStyle = '#c9a56a'; g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill();
        g.fillStyle = '#8a6a3c'; g.beginPath(); g.arc(x, y, 0.9, 0, TAU); g.fill();
      }
    } else if (kind === 'drum') {
      g.fillStyle = '#3a2418'; g.fillRect(6, 8, S - 12, 3); g.fillRect(6, 19, S - 12, 3);
      g.fillStyle = '#d8b23a'; g.fillRect(9, 12, 6, 5);
    } else if (kind === 'pump') {
      g.fillStyle = '#1f1f1f'; g.fillRect(6, 6, S - 12, 9);
      g.fillStyle = '#d8b23a'; g.fillRect(8, 8, S - 16, 5);
      g.fillStyle = '#33342f'; g.fillRect(S / 2 - 2, 18, 4, 8);
    }
    speckle(g, w, h, 34, ['#00000044', '#ffffff1c'], kind.length * 13, 0.6);
  });
}

// --------------------------------------------------------------- structures -

function plankWall(colA, colB, dark) {
  return mk(32, 32, (g) => {
    g.fillStyle = dark;
    g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? colA : colB;
      g.fillRect(1, i * 8 + 1, 30, 6);
      g.fillStyle = '#00000033';
      g.fillRect(1, i * 8 + 6, 30, 1);
    }
    g.fillStyle = '#00000055';
    g.fillRect(6, 0, 2, 32);
    g.fillRect(24, 0, 2, 32);
    speckle(g, 32, 32, 40, ['#00000044', '#ffffff20'], 5, 0.6);
  });
}

function metalWallSprite() {
  return mk(32, 32, (g) => {
    g.fillStyle = '#3f4449'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#565c62'; g.fillRect(1, 1, 30, 30);
    g.strokeStyle = '#2b2f33'; g.lineWidth = 1;
    for (let i = 4; i < 32; i += 7) { g.beginPath(); g.moveTo(i, 1); g.lineTo(i, 31); g.stroke(); }
    g.fillStyle = '#7e858c';
    [[4, 4], [27, 4], [4, 27], [27, 27]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 1.8, 0, TAU); g.fill(); });
    speckle(g, 32, 32, 44, ['#00000055', '#ffffff22', '#6b4a2a44'], 9, 0.6);
  });
}

function reinforcedWallSprite() {
  const base = plankWall('#6b512f', '#5c4527', '#33261a');
  return mk(32, 32, (g) => {
    g.drawImage(base, 0, 0);
    g.fillStyle = '#71787f';
    g.fillRect(0, 6, 32, 5);
    g.fillRect(0, 21, 32, 5);
    g.fillStyle = '#8d949b';
    g.fillRect(0, 6, 32, 1); g.fillRect(0, 21, 32, 1);
    g.fillStyle = '#3a3f44';
    for (let x = 3; x < 32; x += 8) { g.fillRect(x, 8, 2, 2); g.fillRect(x, 23, 2, 2); }
  });
}

function gateSprite(open) {
  return mk(32, 32, (g) => {
    if (open) {
      g.fillStyle = '#00000022'; g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#5a4a30';
      g.fillRect(0, 0, 6, 32); g.fillRect(26, 0, 6, 32);
      g.fillStyle = '#7a6440';
      g.fillRect(1, 1, 4, 30); g.fillRect(27, 1, 4, 30);
      g.strokeStyle = '#8ec06a99'; g.lineWidth = 1;
      g.setLineDash([3, 3]); g.beginPath(); g.moveTo(16, 2); g.lineTo(16, 30); g.stroke(); g.setLineDash([]);
    } else {
      g.fillStyle = '#33261a'; g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#6d5533'; g.fillRect(1, 1, 30, 30);
      g.strokeStyle = '#3d2f1d'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(2, 2); g.lineTo(30, 30); g.stroke();
      g.beginPath(); g.moveTo(30, 2); g.lineTo(2, 30); g.stroke();
      g.fillStyle = '#8b939b';
      g.fillRect(0, 13, 32, 6);
      g.fillStyle = '#5c6369'; g.fillRect(0, 17, 32, 2);
      g.fillStyle = '#c8b06a'; g.fillRect(14, 14, 4, 4);
    }
  });
}

function barricadeSprite() {
  return mk(32, 32, (g) => {
    g.fillStyle = '#00000000'; g.fillRect(0, 0, 32, 32);
    const planks = [[0, 6, 32, 7, -0.12], [0, 18, 32, 7, 0.16]];
    for (const [x, y, w, h, rot] of planks) {
      g.save();
      g.translate(16, y + h / 2); g.rotate(rot); g.translate(-16, -(y + h / 2));
      g.fillStyle = '#4a3722'; g.fillRect(x, y, w, h);
      g.fillStyle = '#6f5533'; g.fillRect(x, y + 1, w, h - 2);
      g.fillStyle = '#2b2b2b';
      g.fillRect(5, y + 2, 2, 2); g.fillRect(25, y + 2, 2, 2);
      g.restore();
    }
    g.fillStyle = '#57422a'; g.fillRect(4, 0, 5, 32); g.fillRect(23, 0, 5, 32);
    g.fillStyle = '#6f5533'; g.fillRect(5, 0, 3, 32); g.fillRect(24, 0, 3, 32);
  });
}

function spikeSprite() {
  return mk(32, 32, (g) => {
    g.fillStyle = '#2f2a20'; roundRect(g, 2, 2, 28, 28, 3, '#332c22');
    const pts = [[8, 8], [22, 8], [8, 22], [22, 22], [15, 15]];
    for (const [x, y] of pts) {
      g.beginPath();
      g.moveTo(x, y - 7); g.lineTo(x + 4, y + 5); g.lineTo(x - 4, y + 5);
      g.closePath();
      g.fillStyle = '#a8adb3'; g.fill();
      g.beginPath();
      g.moveTo(x, y - 7); g.lineTo(x + 1.5, y + 5); g.lineTo(x - 1, y + 5);
      g.closePath();
      g.fillStyle = '#d5dade'; g.fill();
    }
    g.fillStyle = '#7d232399';
    g.beginPath(); g.arc(12, 20, 3, 0, TAU); g.fill();
    g.beginPath(); g.arc(21, 12, 2, 0, TAU); g.fill();
  });
}

function workbenchSprite(tier2) {
  return mk(32, 32, (g) => {
    roundRect(g, 1, 4, 30, 24, 2, '#3a2c1c');
    g.fillStyle = '#6b5232'; g.fillRect(2, 5, 28, 21);
    g.fillStyle = '#7d6039'; g.fillRect(2, 5, 28, 3);
    // Vice
    g.fillStyle = '#5a6067'; g.fillRect(3, 8, 6, 7);
    g.fillStyle = '#82898f'; g.fillRect(4, 9, 4, 5);
    // Tools on the top
    g.fillStyle = '#9aa2ab'; g.fillRect(13, 9, 12, 2);
    g.fillStyle = '#8a5a2a'; g.fillRect(13, 13, 8, 2);
    g.fillStyle = '#c9a227'; g.fillRect(23, 17, 5, 5);
    if (tier2) {
      g.fillStyle = '#59b8c4'; g.fillRect(12, 17, 8, 6);
      g.fillStyle = '#8fe3ec'; g.fillRect(13, 18, 6, 2);
      g.strokeStyle = '#59b8c4'; g.lineWidth = 1.5; g.strokeRect(1.5, 4.5, 29, 23);
      g.fillStyle = '#d8e88a'; g.font = 'bold 7px monospace'; g.fillText('II', 25, 12);
    }
    g.fillStyle = '#2b2015'; g.fillRect(2, 26, 5, 5); g.fillRect(25, 26, 5, 5);
  });
}

function stashSprite() {
  return mk(32, 32, (g) => {
    roundRect(g, 2, 5, 28, 23, 3, '#2f3a2b');
    g.fillStyle = '#4b5a3f'; g.fillRect(3, 6, 26, 20);
    g.fillStyle = '#5f7150'; g.fillRect(3, 6, 26, 6);
    g.strokeStyle = '#26301f'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(3, 12); g.lineTo(29, 12); g.stroke();
    g.fillStyle = '#c9a227'; g.fillRect(14, 13, 4, 4);
    g.fillStyle = '#8a9478'; g.fillRect(6, 16, 8, 2); g.fillRect(6, 20, 12, 2);
    speckle(g, 32, 32, 30, ['#00000044', '#ffffff18'], 21, 0.6);
  });
}

/**
 * A wooden chest and a steel locker, read from above. Both have to be
 * tellable from the Supply Stash at a glance in a crowded compound — the
 * stash is olive with a brass catch, the chest is plank-brown with iron
 * bands, and the locker is grey steel with a vent and a handle.
 */
function chestSprite() {
  return mk(32, 32, (g) => {
    roundRect(g, 3, 7, 26, 20, 2, '#3a2a18');
    g.fillStyle = '#7a5730'; g.fillRect(4, 8, 24, 18);
    g.fillStyle = '#8f6839'; g.fillRect(4, 8, 24, 7);       // domed lid
    g.strokeStyle = '#2a1d10'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(4, 15); g.lineTo(28, 15); g.stroke();
    g.fillStyle = '#4a4238';                                 // iron bands
    g.fillRect(8, 8, 2, 18); g.fillRect(22, 8, 2, 18);
    g.fillStyle = '#c9a227'; g.fillRect(14, 14, 4, 5);       // hasp
    speckle(g, 32, 32, 26, ['#00000044', '#ffffff14'], 23, 0.55);
  });
}

function lockerSprite() {
  return mk(32, 32, (g) => {
    roundRect(g, 4, 4, 24, 25, 2, '#2b3038');
    g.fillStyle = '#5b636d'; g.fillRect(5, 5, 22, 23);
    g.fillStyle = '#6d757f'; g.fillRect(5, 5, 22, 5);
    g.strokeStyle = '#232830'; g.lineWidth = 1;
    for (let y = 8; y <= 12; y += 2) { g.beginPath(); g.moveTo(9, y); g.lineTo(23, y); g.stroke(); }
    g.beginPath(); g.moveTo(16, 5); g.lineTo(16, 28); g.stroke();   // door seam
    g.fillStyle = '#aeb6bd'; g.fillRect(17, 16, 4, 2);              // handle
    speckle(g, 32, 32, 24, ['#00000044', '#ffffff18'], 29, 0.5);
  });
}

function bedrollSprite() {
  return mk(32, 32, (g) => {
    roundRect(g, 3, 6, 26, 21, 5, '#4a3d55');
    roundRect(g, 4.5, 7.5, 23, 18, 4, '#65547a');
    g.fillStyle = '#8d7aa3'; roundRect(g, 6, 8, 20, 6, 3, '#8d7aa3');
    g.strokeStyle = '#3a2f45'; g.lineWidth = 1;
    for (let y = 16; y < 26; y += 4) { g.beginPath(); g.moveTo(5, y); g.lineTo(27, y); g.stroke(); }
    g.fillStyle = '#d8cf9a'; g.beginPath(); g.arc(16, 4, 2, 0, TAU); g.fill();
  });
}

function bunkSprite() {
  return mk(32, 32, (g) => {
    // A bunk bed from above: frame, two mattresses, a folded blanket.
    roundRect(g, 2, 3, 28, 26, 2, '#3a2c1c');
    g.fillStyle = '#5c4630'; g.fillRect(3.5, 4.5, 25, 23);
    for (const y of [6, 17]) {
      roundRect(g, 5, y, 22, 9, 2, '#d8d2c0');
      g.fillStyle = '#b8b2a0'; g.fillRect(6, y + 1, 20, 2.5);   // pillow
      g.fillStyle = '#6a7a8a'; g.fillRect(6, y + 4.5, 20, 4);   // blanket
    }
    g.fillStyle = '#8d949b';
    g.fillRect(3, 3, 26, 1.5);
    g.fillRect(3, 15, 26, 1.5);
  });
}

function watchtowerSprite() {
  return mk(32, 32, (g) => {
    // Legs splaying out from under the platform.
    g.strokeStyle = '#3a2c1c';
    g.lineWidth = 3;
    for (const [x, y] of [[5, 5], [27, 5], [5, 27], [27, 27]]) {
      g.beginPath(); g.moveTo(16, 16); g.lineTo(x, y); g.stroke();
    }
    // Platform.
    roundRect(g, 4, 4, 24, 24, 3, '#3a2c1c');
    g.fillStyle = '#6b5233'; g.fillRect(6, 6, 20, 20);
    g.strokeStyle = '#4a3722';
    g.lineWidth = 1;
    for (let i = 8; i < 26; i += 4) {
      g.beginPath(); g.moveTo(6, i); g.lineTo(26, i); g.stroke();
    }
    // Rail and a sandbag on the corner.
    g.strokeStyle = '#84673f';
    g.lineWidth = 2;
    g.strokeRect(7, 7, 18, 18);
    g.fillStyle = '#7a7250';
    roundRect(g, 18, 8, 7, 5, 2, '#7a7250');
    // Ladder.
    g.fillStyle = '#4a3722'; g.fillRect(14, 26, 5, 6);
    g.fillStyle = '#84673f';
    for (let y = 27; y < 32; y += 2) g.fillRect(14, y, 5, 1);
  });
}

function generatorSprite() {
  return mk(32, 32, (g) => {
    roundRect(g, 2, 6, 28, 22, 3, '#2b2f33');
    g.fillStyle = '#4a5157'; g.fillRect(3, 7, 26, 19);
    g.fillStyle = '#5e666d'; g.fillRect(3, 7, 26, 4);
    // Vents
    g.fillStyle = '#22262a';
    for (let y = 13; y < 25; y += 3) g.fillRect(6, y, 13, 2);
    // Exhaust
    g.fillStyle = '#7a6a55'; g.fillRect(23, 3, 5, 7);
    g.fillStyle = '#3a332a'; g.fillRect(24, 3, 3, 5);
    // Fuel gauge
    g.fillStyle = '#1a1d20'; g.fillRect(21, 14, 7, 10);
    g.fillStyle = '#d2762c'; g.fillRect(22, 20, 5, 3);
    speckle(g, 32, 32, 30, ['#00000055', '#ffffff18'], 33, 0.6);
  });
}

function turretBaseSprite() {
  return mk(32, 32, (g) => {
    g.fillStyle = '#2a2e31';
    g.beginPath(); g.arc(16, 16, 14, 0, TAU); g.fill();
    g.fillStyle = '#3c434a';
    g.beginPath(); g.arc(16, 16, 12, 0, TAU); g.fill();
    g.strokeStyle = '#22262a'; g.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.beginPath(); g.moveTo(16 + Math.cos(a) * 7, 16 + Math.sin(a) * 7);
      g.lineTo(16 + Math.cos(a) * 12, 16 + Math.sin(a) * 12); g.stroke();
    }
    g.fillStyle = '#565e66';
    g.beginPath(); g.arc(16, 16, 6, 0, TAU); g.fill();
  });
}

function turretHeadSprite() {
  return mk(34, 20, (g) => {
    const cy = 10;
    roundRect(g, 4, cy - 6, 16, 12, 3, '#2e3439');
    roundRect(g, 5, cy - 5, 14, 10, 2, '#4c545c');
    // Barrel
    g.fillStyle = '#22262a'; g.fillRect(18, cy - 2.5, 15, 5);
    g.fillStyle = '#6b747c'; g.fillRect(18, cy - 1.5, 14, 2);
    // Ammo box
    g.fillStyle = '#3a4a30'; g.fillRect(3, cy - 8, 8, 5);
    // Sensor eye
    g.fillStyle = '#d94f4f';
    g.beginPath(); g.arc(11, cy, 2.2, 0, TAU); g.fill();
  });
}

// ---------------------------------------------------------------- furniture -
// Household and workplace fittings the player can search. Each one has to be
// recognisable at a glance from directly above, at roughly 30px.

const WOOD_D = '#4a3722';
const WOOD_M = '#6b5233';
const WOOD_L = '#84673f';

function furnitureSprite(kind) {
  const S = 30;
  return mk(S, S, (g, w, h) => {
    const body = (dark, mid) => {
      roundRect(g, 2, 3, S - 4, S - 7, 2, dark);
      g.fillStyle = mid;
      g.fillRect(3.5, 4.5, S - 7, S - 10);
    };

    if (kind === 'bookshelf') {
      body(WOOD_D, WOOD_M);
      // Shelves seen from above: rows of book spines.
      const spines = ['#8a4a3a', '#3f5a72', '#6a7a3a', '#7a6a3a', '#5a3a5a', '#3a6a5a'];
      for (let row = 0; row < 3; row++) {
        const y = 6 + row * 7;
        g.fillStyle = '#2e2318';
        g.fillRect(4, y + 5, S - 8, 1.5);
        let x = 5;
        while (x < S - 6) {
          const bw = 1.5 + hash2(row * 31 + x, 7) * 2.2;
          g.fillStyle = spines[Math.floor(hash2(x, row) * spines.length)];
          g.fillRect(x, y, bw, 5);
          x += bw + 0.8;
        }
      }
    } else if (kind === 'dresser') {
      body(WOOD_D, WOOD_L);
      g.strokeStyle = '#3a2c1c';
      g.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        const y = 4 + i * 7;
        g.beginPath(); g.moveTo(4, y); g.lineTo(S - 4, y); g.stroke();
      }
      g.fillStyle = '#c9a227';
      for (let i = 0; i < 3; i++) {
        g.fillRect(S / 2 - 5, 7 + i * 7, 4, 1.8);
        g.fillRect(S / 2 + 1, 7 + i * 7, 4, 1.8);
      }
    } else if (kind === 'wardrobe') {
      body('#3a2c1c', WOOD_M);
      g.strokeStyle = '#2e2318';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(S / 2, 4); g.lineTo(S / 2, S - 4); g.stroke();
      g.fillStyle = '#c9a227';
      g.fillRect(S / 2 - 4, S / 2 - 1, 2.5, 5);
      g.fillRect(S / 2 + 1.5, S / 2 - 1, 2.5, 5);
      g.fillStyle = '#00000033';
      g.fillRect(4, 4, S - 8, 3);
    } else if (kind === 'desk') {
      body('#3a2c1c', WOOD_L);
      // Monitor, keyboard, scattered paper.
      g.fillStyle = '#2b2f33'; g.fillRect(5, 5, 11, 8);
      g.fillStyle = '#4a6a7a'; g.fillRect(6, 6, 9, 6);
      g.fillStyle = '#22262a'; g.fillRect(5, 15, 12, 4);
      g.fillStyle = '#d8d2c0';
      g.fillRect(19, 7, 7, 5);
      g.fillRect(18, 14, 8, 5);
      g.fillStyle = '#00000022'; g.fillRect(19, 8, 7, 1); g.fillRect(19, 10, 5, 1);
    } else if (kind === 'filing') {
      body('#3f4449', '#6a7178');
      g.strokeStyle = '#2b2f33';
      g.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const y = 3 + i * 5.5;
        g.beginPath(); g.moveTo(4, y); g.lineTo(S - 4, y); g.stroke();
      }
      g.fillStyle = '#aeb5bb';
      for (let i = 0; i < 4; i++) g.fillRect(S / 2 - 4, 5 + i * 5.5, 8, 1.8);
      g.fillStyle = '#d8d2c0'; g.fillRect(6, 4, 5, 2);
    } else if (kind === 'fridge') {
      body('#8d949b', '#cdd3d8');
      g.strokeStyle = '#8d949b';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(4, 12); g.lineTo(S - 4, 12); g.stroke();
      g.fillStyle = '#6b7178';
      g.fillRect(S - 9, 6, 2.5, 5);
      g.fillRect(S - 9, 15, 2.5, 8);
      // Magnets and a note.
      g.fillStyle = '#d94f4f'; g.fillRect(7, 16, 3, 3);
      g.fillStyle = '#d8c86a'; g.fillRect(12, 18, 3, 3);
      g.fillStyle = '#eee8d8'; g.fillRect(7, 6, 6, 4);
    } else if (kind === 'nightstand') {
      roundRect(g, 6, 7, 18, 16, 2, WOOD_D);
      g.fillStyle = WOOD_L; g.fillRect(7.5, 8.5, 15, 13);
      g.strokeStyle = '#3a2c1c'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(8, 16); g.lineTo(22, 16); g.stroke();
      g.fillStyle = '#c9a227'; g.fillRect(13, 12, 4, 1.6);
      // Lamp seen from above.
      g.fillStyle = '#3a3f44';
      g.beginPath(); g.arc(15, 11, 4, 0, TAU); g.fill();
      g.fillStyle = '#e8d89a';
      g.beginPath(); g.arc(15, 11, 2.6, 0, TAU); g.fill();
    } else if (kind === 'vanity') {
      body('#b9bec0', '#e2e6e8');
      // Basin.
      g.fillStyle = '#9aa2a8';
      g.beginPath(); g.ellipse(S / 2, S / 2 + 1, 8, 6.5, 0, 0, TAU); g.fill();
      g.fillStyle = '#cfd6da';
      g.beginPath(); g.ellipse(S / 2, S / 2 + 1, 6.5, 5, 0, 0, TAU); g.fill();
      g.fillStyle = '#2b2f33';
      g.beginPath(); g.arc(S / 2, S / 2 + 1, 1.6, 0, TAU); g.fill();
      g.fillStyle = '#8d949b'; g.fillRect(S / 2 - 1.5, 6, 3, 5);
    } else if (kind === 'footlocker') {
      body('#3a4128', '#5c6640');
      g.strokeStyle = '#2b3320';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(3, 11); g.lineTo(S - 3, 11); g.stroke();
      g.fillStyle = '#8d949b';
      g.fillRect(6, 9, 5, 4);
      g.fillRect(S - 11, 9, 5, 4);
      g.fillStyle = '#c7c07a';
      g.font = 'bold 7px monospace';
      g.fillText('US', 12, 22);
    } else if (kind === 'vending') {
      body('#5a2a2a', '#8a3a3a');
      // Glass front with product rows.
      g.fillStyle = '#1e2428'; g.fillRect(5, 5, 14, S - 12);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) {
          g.fillStyle = ['#d8c86a', '#6ac4a8', '#d97a5a', '#8ab0d8'][(r + c) % 4];
          g.fillRect(6.5 + c * 4.2, 6.5 + r * 4.4, 3, 3.4);
        }
      }
      g.fillStyle = '#2b2f33'; g.fillRect(21, 6, 5, 10);
      g.fillStyle = '#d8d2c0'; g.fillRect(21, 18, 5, 4);
    } else if (kind === 'toolrack') {
      g.fillStyle = '#6b5233'; g.fillRect(2, 4, S - 4, S - 9);
      g.fillStyle = '#7d6039'; g.fillRect(3, 5, S - 6, S - 11);
      // Pegboard holes.
      g.fillStyle = '#3a2c1c';
      for (let y = 7; y < S - 8; y += 4) for (let x = 5; x < S - 5; x += 4) g.fillRect(x, y, 1, 1);
      // Hanging tools.
      g.fillStyle = '#9aa2ab'; g.fillRect(6, 7, 2, 11);
      g.fillStyle = '#5a4a2a'; g.fillRect(5, 17, 4, 3);
      g.fillStyle = '#8d949b'; g.fillRect(13, 8, 9, 2);
      g.fillStyle = '#c9a227'; g.fillRect(12, 14, 3, 8);
      g.fillStyle = '#9aa2ab';
      g.beginPath(); g.moveTo(20, 14); g.lineTo(24, 20); g.lineTo(18, 20); g.closePath(); g.fill();
    } else if (kind === 'displaycase') {
      body('#3a3f44', '#59606a');
      // Glass with a sheen.
      g.fillStyle = '#8fb3c255'; g.fillRect(4, 5, S - 8, S - 12);
      g.fillStyle = '#b8d8e855';
      g.beginPath(); g.moveTo(5, S - 8); g.lineTo(S - 9, 5); g.lineTo(S - 5, 5); g.lineTo(9, S - 8); g.closePath(); g.fill();
      // Goods inside.
      g.fillStyle = '#c9a227'; g.fillRect(7, 9, 7, 3);
      g.fillStyle = '#59b8c4'; g.fillRect(16, 8, 6, 5);
      g.fillStyle = '#9aa2ab'; g.fillRect(8, 16, 12, 3);
    } else {
      body(WOOD_D, WOOD_M);
    }

    speckle(g, w, h, 26, ['#00000033', '#ffffff14'], kind.length * 17, 0.5);
  });
}

function floodlightSprite() {
  return mk(32, 32, (g) => {
    // Tripod legs
    g.strokeStyle = '#3a3f44';
    g.lineWidth = 2.5;
    for (const a of [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83]) {
      g.beginPath();
      g.moveTo(16, 18);
      g.lineTo(16 + Math.cos(a) * 11, 20 + Math.sin(a) * 9);
      g.stroke();
    }
    // Head
    roundRect(g, 6, 4, 20, 14, 3, '#2e3438');
    roundRect(g, 7.5, 5.5, 17, 11, 2, '#565e66');
    // Lens
    const grd = g.createLinearGradient(9, 7, 23, 15);
    grd.addColorStop(0, '#fff6cf');
    grd.addColorStop(1, '#d8bd6a');
    g.fillStyle = grd;
    g.fillRect(9, 7, 14, 8);
    g.strokeStyle = '#22262a';
    g.lineWidth = 1;
    g.strokeRect(9, 7, 14, 8);
    g.fillStyle = '#8d949b';
    g.fillRect(14, 17, 4, 3);
  });
}

/** Top-down survivor. Deliberately reads as a person, not a zombie. */
function survivorSprite(tint) {
  const size = 34;
  return mk(size, size, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    // Rifle held across the front
    g.fillStyle = '#2b2f33';
    g.fillRect(cx + 2, cy - 1.6, 15, 3.2);
    g.fillStyle = '#4a3a28';
    g.fillRect(cx - 2, cy - 1.4, 5, 2.8);
    // Body
    g.fillStyle = '#14180f';
    g.beginPath(); g.ellipse(cx, cy, 10.5, 9, 0, 0, TAU); g.fill();
    g.fillStyle = tint;
    g.beginPath(); g.ellipse(cx, cy, 9, 7.6, 0, 0, TAU); g.fill();
    // Webbing
    g.fillStyle = '#3a4230';
    g.fillRect(cx - 2.5, cy - 6.5, 3, 13);
    // Head with a bandana
    g.fillStyle = '#14180f';
    g.beginPath(); g.arc(cx + 3, cy, 5.6, 0, TAU); g.fill();
    g.fillStyle = '#d8bb92';
    g.beginPath(); g.arc(cx + 3, cy, 4.7, 0, TAU); g.fill();
    g.fillStyle = '#8a4a4a';
    g.beginPath(); g.arc(cx + 2.4, cy, 4.7, -2.1, 2.1); g.fill();
  });
}

function backpackSprite() {
  return mk(28, 28, (g) => {
    roundRect(g, 5, 4, 18, 21, 4, '#3d3527');
    roundRect(g, 6.5, 5.5, 15, 18, 3, '#5e5238');
    g.fillStyle = '#3d3527'; g.fillRect(9, 12, 12, 6);
    g.fillStyle = '#7a6a48'; g.fillRect(9, 12, 12, 2);
    g.fillStyle = '#c9a227'; g.fillRect(13, 14, 3, 3);
    g.strokeStyle = '#2e281d'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(10, 4); g.lineTo(10, 1); g.stroke();
    g.beginPath(); g.moveTo(18, 4); g.lineTo(18, 1); g.stroke();
  });
}

function corpseSprite(def) {
  const s = def.r * 2 + 16;
  return mk(s, s, (g, w, h) => {
    const cx = w / 2, cy = h / 2, r = def.r;
    g.globalAlpha = 0.9;
    // Blood pool
    g.fillStyle = '#4a1414';
    g.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU, rr = r * (1.0 + hash2(i, def.hp) * 0.7);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.8;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    // Body
    ellipse(g, cx, cy, r * 0.8, r * 0.6, def.dark, 0.5);
    ellipse(g, cx + r * 0.5, cy - r * 0.3, r * 0.34, r * 0.32, '#6d7a58');
  });
}

// ------------------------------------------------------------------- build --

let built = false;

export function buildSprites() {
  if (built) return Sprites;
  built = true;

  const { ENEMIES } = Sprites._cfg;

  for (const id of ['walker', 'runner', 'brute']) {
    Sprites[`z_${id}`] = zombieSprite(ENEMIES[id], 1);
    Sprites[`z_${id}_flash`] = whiten(Sprites[`z_${id}`]);
    Sprites[`corpse_${id}`] = corpseSprite(ENEMIES[id]);
  }
  Sprites.z_behemoth = behemothSprite(ENEMIES.behemoth);
  Sprites.z_behemoth_flash = whiten(Sprites.z_behemoth);
  Sprites.corpse_behemoth = corpseSprite(ENEMIES.behemoth);

  Sprites.trees = [0, 1, 2, 3].map((i) => treeSprite(i * 37 + 11));
  Sprites.bushes = [0, 1, 2].map((i) => bushSprite(i * 19 + 5));
  Sprites.rocks = [0, 1].map((i) => rockSprite(i * 23 + 3));
  Sprites.boulders = [0, 1, 2].map((i) => boulderSprite(i * 29 + 7));
  Sprites.litter = {
    sticks: [0, 1, 2].map((i) => litterSprite('sticks', i * 17 + 2)),
    stone: [0, 1, 2].map((i) => litterSprite('stone', i * 13 + 5)),
    fiber: [0, 1, 2].map((i) => litterSprite('fiber', i * 19 + 9)),
  };
  Sprites.thickets = [0, 1, 2].map((i) => thicketSprite(i * 31 + 13));
  Sprites.pines = [0, 1, 2, 3].map((i) => pineSprite(i * 41 + 7));
  Sprites.hay = [0, 1, 2].map((i) => hayBaleSprite(i * 17 + 9));
  Sprites.reeds = [0, 1, 2].map((i) => reedSprite(i * 29 + 13));
  Sprites.silo = siloSprite();

  Sprites.cars = [
    carSprite('#7a3f3a', '#4d2724', false),
    carSprite('#3f5a7a', '#26374d', false),
    carSprite('#6f6f66', '#454540', false),
    carSprite('#5c6b45', '#3a442b', false),
  ];
  Sprites.wrecks = [carSprite('#5a4a42', '#372d28', true), carSprite('#4a4f55', '#2d3135', true)];

  const FURNITURE = [
    'bookshelf', 'dresser', 'wardrobe', 'desk', 'filing', 'fridge',
    'nightstand', 'vanity', 'footlocker', 'vending', 'toolrack', 'displaycase',
  ];
  const FIXTURES = ['cabinet', 'toolbox', 'shelf', 'medcab', 'crate', 'trunk', 'locker', 'safe', 'milcrate', 'pump', 'logs', 'drum'];

  for (const k of [...FIXTURES, ...FURNITURE]) {
    Sprites[`c_${k}`] = FURNITURE.includes(k) ? furnitureSprite(k) : containerSprite(k);
    Sprites[`c_${k}_empty`] = mk(30, 30, (g, w, h) => {
      g.globalAlpha = 0.55;
      g.drawImage(Sprites[`c_${k}`], 0, 0);
      g.globalAlpha = 1;
      g.strokeStyle = '#00000088'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(6, 6); g.lineTo(w - 6, h - 6); g.stroke();
    });
  }

  Sprites.s_woodWall = plankWall('#7a5c35', '#6b512f', '#33261a');
  Sprites.s_stoneWall = stoneWallSprite();
  Sprites.s_reinforcedWall = reinforcedWallSprite();
  Sprites.s_metalWall = metalWallSprite();
  Sprites.s_barricade = barricadeSprite();
  Sprites.s_gate = gateSprite(false);
  Sprites.s_gate_open = gateSprite(true);
  Sprites.s_spike = spikeSprite();
  Sprites.s_workbench = workbenchSprite(false);
  Sprites.s_workbench2 = workbenchSprite(true);
  Sprites.s_stash = stashSprite();
  Sprites.s_chest = chestSprite();
  Sprites.s_locker = lockerSprite();
  Sprites.s_bedroll = bedrollSprite();
  Sprites.s_bunk = bunkSprite();
  Sprites.s_watchtower = watchtowerSprite();
  Sprites.s_generator = generatorSprite();
  Sprites.s_turret = turretBaseSprite();
  Sprites.s_floodlight = floodlightSprite();
  Sprites.turretHead = turretHeadSprite();
  Sprites.backpack = backpackSprite();

  Sprites.survivors = ['#7a8fa8', '#8a7f6a', '#7f8a6a', '#8a6f7a'].map(survivorSprite);
  Sprites.survivorFlash = Sprites.survivors.map((s) => whiten(s));

  return Sprites;
}

/** Injects config without creating an import cycle between sprites and config. */
export function primeSprites(cfg) { Sprites._cfg = cfg; }

export function structureSprite(type, st) {
  if (type === 'gate') return st && st.open ? Sprites.s_gate_open : Sprites.s_gate;
  if (type === 'workbench') return st && st.tier >= 2 ? Sprites.s_workbench2 : Sprites.s_workbench;
  return Sprites[`s_${type}`] || Sprites.s_woodWall;
}
