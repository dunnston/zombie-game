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

  Sprites.cars = [
    carSprite('#7a3f3a', '#4d2724', false),
    carSprite('#3f5a7a', '#26374d', false),
    carSprite('#6f6f66', '#454540', false),
    carSprite('#5c6b45', '#3a442b', false),
  ];
  Sprites.wrecks = [carSprite('#5a4a42', '#372d28', true), carSprite('#4a4f55', '#2d3135', true)];

  for (const k of ['cabinet', 'toolbox', 'shelf', 'medcab', 'crate', 'trunk', 'locker', 'safe', 'milcrate', 'pump']) {
    Sprites[`c_${k}`] = containerSprite(k);
    Sprites[`c_${k}_empty`] = mk(30, 30, (g, w, h) => {
      g.globalAlpha = 0.55;
      g.drawImage(Sprites[`c_${k}`], 0, 0);
      g.globalAlpha = 1;
      g.strokeStyle = '#00000088'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(6, 6); g.lineTo(w - 6, h - 6); g.stroke();
    });
  }

  Sprites.s_woodWall = plankWall('#7a5c35', '#6b512f', '#33261a');
  Sprites.s_reinforcedWall = reinforcedWallSprite();
  Sprites.s_metalWall = metalWallSprite();
  Sprites.s_barricade = barricadeSprite();
  Sprites.s_gate = gateSprite(false);
  Sprites.s_gate_open = gateSprite(true);
  Sprites.s_spike = spikeSprite();
  Sprites.s_workbench = workbenchSprite(false);
  Sprites.s_workbench2 = workbenchSprite(true);
  Sprites.s_stash = stashSprite();
  Sprites.s_bedroll = bedrollSprite();
  Sprites.s_generator = generatorSprite();
  Sprites.s_turret = turretBaseSprite();
  Sprites.turretHead = turretHeadSprite();
  Sprites.backpack = backpackSprite();

  return Sprites;
}

/** Injects config without creating an import cycle between sprites and config. */
export function primeSprites(cfg) { Sprites._cfg = cfg; }

export function structureSprite(type, st) {
  if (type === 'gate') return st && st.open ? Sprites.s_gate_open : Sprites.s_gate;
  if (type === 'workbench') return st && st.tier >= 2 ? Sprites.s_workbench2 : Sprites.s_workbench;
  return Sprites[`s_${type}`] || Sprites.s_woodWall;
}
