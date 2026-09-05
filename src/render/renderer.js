// World rendering. Everything is drawn in world space inside one camera
// transform; the HUD layer draws afterwards in screen space.

import { TILE, TERRAIN, T, WEAPONS, STRUCTURES, ENEMIES } from '../game/config.js';
import { G } from '../game/state.js';
import { Sprites, structureSprite } from '../core/sprites.js';
import { FX } from '../core/particles.js';
import { hash2, clamp, TAU } from '../core/util.js';
import { currentWeapon } from '../game/player.js';
import { buildMenu } from '../game/building.js';
import { darkness } from '../game/daynight.js';

const drawList = [];

export function render(ctx, W, H) {
  const cam = G.camera;
  const world = G.world;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0c09';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  // Nearest-neighbour keeps the hand-drawn sprites crisp instead of muddy when
  // the camera scales them up.
  ctx.imageSmoothingEnabled = false;
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-(cam.x + cam.shakeX), -(cam.y + cam.shakeY));

  const halfW = W / 2 / cam.zoom, halfH = H / 2 / cam.zoom;
  const view = {
    x0: cam.x - halfW - TILE, y0: cam.y - halfH - TILE,
    x1: cam.x + halfW + TILE, y1: cam.y + halfH + TILE,
  };

  drawGround(ctx, world, view);
  drawDecals(ctx, view);
  drawCorpses(ctx, view);
  drawWalls(ctx, world, view);

  // --------------------------------------------------------- sorted layer --
  drawList.length = 0;
  for (const p of world.props) {
    if (p.x < view.x0 - 40 || p.x > view.x1 + 40 || p.y < view.y0 - 40 || p.y > view.y1 + 40) continue;
    drawList.push({ y: p.y, kind: 'prop', ref: p });
  }
  for (const c of world.containers) {
    if (c.hidden) continue;
    if (c.x < view.x0 || c.x > view.x1 || c.y < view.y0 || c.y > view.y1) continue;
    drawList.push({ y: c.y, kind: 'container', ref: c });
  }
  for (const s of G.structures) {
    if (s.destroyed) continue;
    if (s.x < view.x0 - 40 || s.x > view.x1 + 40 || s.y < view.y0 - 40 || s.y > view.y1 + 40) continue;
    drawList.push({ y: s.y, kind: 'structure', ref: s });
  }
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (e.x < view.x0 - 60 || e.x > view.x1 + 60 || e.y < view.y0 - 60 || e.y > view.y1 + 60) continue;
    drawList.push({ y: e.y, kind: 'enemy', ref: e });
  }
  for (const b of G.backpacks) drawList.push({ y: b.y, kind: 'backpack', ref: b });
  for (const s of G.survivors) {
    if (s.dead) continue;
    drawList.push({ y: s.y, kind: 'survivor', ref: s });
  }
  for (const r of G.rescues) {
    if (r.x < view.x0 - 60 || r.x > view.x1 + 60 || r.y < view.y0 - 60 || r.y > view.y1 + 60) continue;
    drawList.push({ y: r.y, kind: 'rescue', ref: r });
  }
  if (!G.player.dead) drawList.push({ y: G.player.y, kind: 'player', ref: G.player });

  drawList.sort((a, b) => a.y - b.y);
  for (const d of drawList) {
    switch (d.kind) {
      case 'prop': drawProp(ctx, d.ref); break;
      case 'container': drawContainer(ctx, d.ref); break;
      case 'structure': drawStructure(ctx, d.ref); break;
      case 'enemy': drawEnemy(ctx, d.ref); break;
      case 'backpack': drawBackpack(ctx, d.ref); break;
      case 'survivor': drawSurvivor(ctx, d.ref); break;
      case 'rescue': drawRescue(ctx, d.ref); break;
      case 'player': drawPlayer(ctx, d.ref); break;
      default: break;
    }
  }

  drawPickups(ctx);
  drawBullets(ctx);
  drawParticles(ctx);
  if (G.ui.buildMode) drawBuildGhost(ctx);
  drawInteractPrompt(ctx);

  ctx.restore();

  drawNight(ctx, W, H);
  drawPostEffects(ctx, W, H);
}

// ------------------------------------------------------------------- night --

let lightCanvas = null;

/**
 * Darkness is a full-screen wash with holes punched in it by light sources,
 * composited on an offscreen buffer. Anything with a light gets a soft radial
 * hole, so a powered base reads as an island of safety in the dark.
 */
function drawNight(ctx, W, H) {
  const { alpha, color } = darkness();
  if (alpha <= 0.01) return;

  if (!lightCanvas) lightCanvas = document.createElement('canvas');
  if (lightCanvas.width !== W || lightCanvas.height !== H) {
    lightCanvas.width = W;
    lightCanvas.height = H;
  }
  const lg = lightCanvas.getContext('2d');
  lg.setTransform(1, 0, 0, 1, 0, 0);
  lg.globalCompositeOperation = 'source-over';
  lg.clearRect(0, 0, W, H);
  lg.fillStyle = color;
  lg.globalAlpha = alpha;
  lg.fillRect(0, 0, W, H);
  lg.globalAlpha = 1;

  const cam = G.camera;
  const z = cam.zoom;
  const toScreenX = (wx) => (wx - (cam.x + cam.shakeX)) * z + W / 2;
  const toScreenY = (wy) => (wy - (cam.y + cam.shakeY)) * z + H / 2;

  lg.globalCompositeOperation = 'destination-out';

  const hole = (wx, wy, radius, strength = 1) => {
    const sx = toScreenX(wx), sy = toScreenY(wy);
    const r = radius * z;
    if (sx < -r || sy < -r || sx > W + r || sy > H + r) return;
    const grd = lg.createRadialGradient(sx, sy, 0, sx, sy, r);
    grd.addColorStop(0, `rgba(0,0,0,${strength})`);
    grd.addColorStop(0.55, `rgba(0,0,0,${strength * 0.75})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    lg.fillStyle = grd;
    lg.beginPath();
    lg.arc(sx, sy, r, 0, TAU);
    lg.fill();
  };

  // No light source clears the dark completely — even a floodlit yard should
  // still read as night, or the whole cycle stops mattering.
  const p = G.player;
  if (!p.dead) hole(p.x, p.y, 175, 0.72);

  for (const s of G.structures) {
    if (s.destroyed) continue;
    if (s.type === 'floodlight' && s.powered) hole(s.x, s.y, s.def.lightRadius, 0.92);
    else if (s.type === 'generator' && s.running) hole(s.x, s.y, 130, 0.66);
    else if (s.type === 'turret' && s.powered) hole(s.x, s.y, 95, 0.5);
    else if (s.type === 'workbench') hole(s.x, s.y, 70, 0.38);
  }

  // Your people carry torches too.
  for (const s of G.survivors) {
    if (!s.dead && !s.downed) hole(s.x, s.y, 110, 0.5);
  }

  // Muzzle flashes briefly light the world around them.
  for (const f of FX.parts) {
    if (f.kind === 'muzzle') hole(f.x, f.y, 190, 0.7);
  }

  lg.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(lightCanvas, 0, 0);
}

// ------------------------------------------------------------------ ground --

function drawGround(ctx, world, view) {
  const x0 = Math.max(0, Math.floor(view.x0 / TILE));
  const y0 = Math.max(0, Math.floor(view.y0 / TILE));
  const x1 = Math.min(world.w - 1, Math.ceil(view.x1 / TILE));
  const y1 = Math.min(world.h - 1, Math.ceil(view.y1 / TILE));

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * world.w + tx;
      const t = world.tiles[i];
      if (t === T.WALL) continue;                      // drawn in drawWalls
      const pal = TERRAIN[t] || TERRAIN[T.GRASS];
      const px = tx * TILE, py = ty * TILE;
      ctx.fillStyle = pal.a;
      ctx.fillRect(px, py, TILE, TILE);

      const h = hash2(tx, ty);
      if (h > 0.62) {
        ctx.fillStyle = pal.b;
        const s = 6 + h * 14;
        ctx.fillRect(px + ((h * 97) % (TILE - s)), py + ((h * 53) % (TILE - s)), s, s);
      }
      if (t === T.WATER) {
        ctx.fillStyle = '#3a5c7288';
        const w = 10 + Math.sin(G.time * 1.4 + tx * 0.7 + ty) * 5;
        ctx.fillRect(px + 4, py + 10 + Math.sin(G.time + tx) * 2, w, 2);
      }
      if (t === T.GRASS && h > 0.9) {
        ctx.fillStyle = '#4a5c3399';
        ctx.fillRect(px + 12, py + 12, 2, 5);
        ctx.fillRect(px + 17, py + 14, 2, 4);
      }
      const mk = world.mark[i];
      if (mk && t === T.ROAD) {
        ctx.fillStyle = '#b8a44a55';
        if (mk === 1) { if (tx % 3 !== 2) ctx.fillRect(px + 4, py + 14, 20, 3); }
        else if (ty % 3 !== 2) ctx.fillRect(px + 14, py + 4, 3, 20);
      }
    }
  }
}

function drawWalls(ctx, world, view) {
  const x0 = Math.max(0, Math.floor(view.x0 / TILE));
  const y0 = Math.max(0, Math.floor(view.y0 / TILE));
  const x1 = Math.min(world.w - 1, Math.ceil(view.x1 / TILE));
  const y1 = Math.min(world.h - 1, Math.ceil(view.y1 / TILE));

  // Drop shadow pass, then the wall bodies — reads as extruded from above.
  ctx.fillStyle = '#00000055';
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (world.tiles[ty * world.w + tx] !== T.WALL) continue;
      ctx.fillRect(tx * TILE + 3, ty * TILE + 5, TILE, TILE);
    }
  }
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * world.w + tx;
      if (world.tiles[i] !== T.WALL) continue;
      const px = tx * TILE, py = ty * TILE;
      const h = hash2(tx * 3, ty * 7);
      ctx.fillStyle = h > 0.5 ? '#5f564c' : '#655c51';
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = '#7a7064';
      ctx.fillRect(px, py, TILE, 4);
      ctx.fillStyle = '#00000033';
      ctx.fillRect(px, py + TILE - 4, TILE, 4);
      if (h > 0.78) { ctx.fillStyle = '#4a4238'; ctx.fillRect(px + 6, py + 10, 12, 7); }
    }
  }
}

function drawDecals(ctx, view) {
  for (const d of FX.decals) {
    if (d.x < view.x0 || d.x > view.x1 || d.y < view.y0 || d.y > view.y1) continue;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.r, d.r * 0.72, d.rot, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawCorpses(ctx, view) {
  for (const c of G.corpses) {
    if (c.x < view.x0 || c.x > view.x1 || c.y < view.y0 || c.y > view.y1) continue;
    const spr = Sprites[`corpse_${c.type}`];
    if (!spr) continue;
    ctx.save();
    ctx.globalAlpha = clamp(1 - (c.t - c.life * 0.7) / (c.life * 0.3), 0.15, 0.85);
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
    ctx.restore();
  }
}

// ------------------------------------------------------------------- props --

function drawProp(ctx, p) {
  let spr = null;
  if (p.kind === 'tree') spr = Sprites.trees[p.si % Sprites.trees.length];
  else if (p.kind === 'bush') spr = Sprites.bushes[p.si % Sprites.bushes.length];
  else if (p.kind === 'rock') spr = Sprites.rocks[p.si % Sprites.rocks.length];
  else if (p.kind === 'car') spr = Sprites.cars[p.si % Sprites.cars.length];
  else if (p.kind === 'wreck') spr = Sprites.wrecks[p.si % Sprites.wrecks.length];
  if (!spr) return;

  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.rot) ctx.rotate(p.rot);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(3, 6, spr.width * 0.36, spr.height * 0.26, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);

  // Chopping feedback: a shudder on impact and a bar once it's wounded.
  if (p.hitAt !== undefined && G.time - p.hitAt < 0.12) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff';
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(spr, -spr.width / 2 + 1, -spr.height / 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (p.maxHp && p.hp < p.maxHp) {
    const frac = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = '#00000099';
    ctx.fillRect(p.x - 15, p.y - 26, 30, 4);
    ctx.fillStyle = '#a3763f';
    ctx.fillRect(p.x - 14, p.y - 25, 28 * frac, 2);
  }
}

function drawContainer(ctx, c) {
  const spr = Sprites[`c_${c.sprite}${c.looted ? '_empty' : ''}`];
  if (!spr) return;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.fillRect(-13, -8, 28, 22);
  ctx.globalAlpha = 1;
  ctx.drawImage(spr, -spr.width / 2, -spr.height / 2 - 2);
  if (!c.looted) {
    // Soft pulse so unsearched loot is findable at a glance.
    const pulse = 0.25 + Math.sin(G.time * 2.6 + c.id) * 0.14;
    ctx.globalAlpha = clamp(pulse, 0.08, 0.42);
    ctx.strokeStyle = '#e8d488';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-15, -17, 30, 30);
  }
  ctx.restore();
}

// -------------------------------------------------------------- structures --

function drawStructure(ctx, s) {
  const spr = structureSprite(s.type, s);
  ctx.save();
  ctx.translate(s.x, s.y);

  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.fillRect(-14, -10, 30, 24);
  ctx.globalAlpha = 1;

  if (spr) ctx.drawImage(spr, -16, -16);

  if (s.type === 'turret') {
    const head = Sprites.turretHead;
    ctx.save();
    ctx.rotate(s.aim || 0);
    ctx.drawImage(head, -10, -head.height / 2);
    ctx.restore();
    if (!s.powered) {
      ctx.fillStyle = '#e05a4a';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('NO PWR', -18, -18);
    } else if (s.starved) {
      ctx.fillStyle = '#d9c46a';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('NO AMMO', -21, -18);
    }
  }
  if (s.type === 'generator' && s.running) {
    // A running-light and a shudder, not a glowing blob.
    const t = Math.sin(G.time * 24) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(255,190,90,${0.55 + t * 0.45})`;
    ctx.beginPath();
    ctx.arc(9, -9, 2.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(220,150,60,${0.12 + t * 0.12})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 21 + t * 2, 0, TAU);
    ctx.stroke();
    // Fuel gauge on the casing.
    const f = s.fuel / s.def.fuelMax;
    ctx.fillStyle = '#12150f';
    ctx.fillRect(-9, 11, 18, 3);
    ctx.fillStyle = f > 0.3 ? '#d2762c' : '#c94a3a';
    ctx.fillRect(-9, 11, 18 * f, 3);
  }
  if (s.type === 'floodlight') {
    if (s.powered) {
      ctx.fillStyle = 'rgba(255,242,190,0.9)';
      ctx.fillRect(-7, -11, 14, 8);
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = '#fff2be';
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#e05a4a';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('NO PWR', -18, -18);
    }
  }
  if (s.type === 'bedroll' && G.player.spawnStructure === s) {
    ctx.strokeStyle = `rgba(160,220,140,${0.35 + Math.sin(G.time * 2) * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-15, -15, 30, 30);
  }

  // Damage: cracks, then a health bar once it has actually been hit.
  const frac = s.hp / s.maxHp;
  if (frac < 0.999) {
    ctx.globalAlpha = clamp((1 - frac) * 0.75, 0, 0.7);
    ctx.strokeStyle = '#14100c';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-12, -12 + (1 - frac) * 6); ctx.lineTo(2, 2); ctx.lineTo(-4, 12);
    ctx.moveTo(12, -8); ctx.lineTo(4, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (frac < 0.98 && (G.raid || G.time - (s.lastHit || -99) < 6 || G.ui.buildMode)) {
      ctx.fillStyle = '#00000099';
      ctx.fillRect(-15, -22, 30, 4);
      ctx.fillStyle = frac > 0.5 ? '#7ec46a' : frac > 0.25 ? '#d9c46a' : '#e05a4a';
      ctx.fillRect(-14, -21, 28 * frac, 2);
    }
  }
  if (s.flash > 0) {
    ctx.globalAlpha = s.flash * 4;
    ctx.fillStyle = '#fff';
    ctx.fillRect(-16, -16, 32, 32);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ----------------------------------------------------------------- enemies --

function drawEnemy(ctx, e) {
  const spr = e.flash > 0 ? Sprites[`z_${e.type}_flash`] : Sprites[`z_${e.type}`];
  if (!spr) return;
  const bob = Math.sin(e.anim * 2.4) * 0.06;
  const lunge = e.windup > 0 ? 1 + (0.24 - e.windup) * 1.6 : 1;

  ctx.save();
  ctx.translate(e.x, e.y);

  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(2, 5, e.def.r * 0.95, e.def.r * 0.62, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.rotate(e.angle);
  const sc = (1 + bob) * lunge;
  ctx.scale(sc, sc);
  ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
  ctx.restore();

  // Health bar for anything that's been hurt.
  if (e.hp < e.maxHp) {
    const w = e.def.r * 2.2;
    const frac = clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = '#00000099';
    ctx.fillRect(e.x - w / 2 - 1, e.y - e.def.r - 11, w + 2, 4);
    ctx.fillStyle = e.def.boss ? '#e0704a' : frac > 0.5 ? '#b7e08a' : frac > 0.25 ? '#d9c46a' : '#e05a4a';
    ctx.fillRect(e.x - w / 2, e.y - e.def.r - 10, w * frac, 2);
  }
  if (e.raid && G.raid) {
    ctx.fillStyle = '#e05a4a99';
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - e.def.r - 16);
    ctx.lineTo(e.x - 4, e.y - e.def.r - 22);
    ctx.lineTo(e.x + 4, e.y - e.def.r - 22);
    ctx.closePath();
    ctx.fill();
  }
}

// ------------------------------------------------------------------ player --

function drawPlayer(ctx, p) {
  const w = currentWeapon(p);
  const moving = Math.hypot(p.vx, p.vy) > 20;
  const t = G.time;
  const step = moving ? Math.sin(t * (p.sprinting ? 17 : 11)) : 0;

  // A ring on the ground. In a crowd of similarly-sized zombies this is the
  // single most important readability cue. Drawn as a dark ring under a light
  // one so it stays visible on both grass and pale shop floors.
  ctx.save();
  const ringA = p.sneaking ? 0.22 : 0.42;
  ctx.globalAlpha = ringA * 0.8;
  ctx.strokeStyle = '#05070a';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 3, 19, 12, 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = ringA;
  ctx.strokeStyle = '#dff0ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 3, 19, 12, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(p.x, p.y);

  // Shadow
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(2, 5, 13, 9, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.rotate(p.angle);

  // Legs
  ctx.fillStyle = '#2e3626';
  ctx.fillRect(-5, -9 + step * 2.6, 11, 6);
  ctx.fillRect(-5, 3 - step * 2.6, 11, 6);

  // Melee swing arc
  if (p.swing) {
    const k = p.swing.t / p.swing.dur;
    const a0 = -p.swing.arc / 2, a1 = p.swing.arc / 2;
    const a = a0 + (a1 - a0) * k;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.5;
    ctx.strokeStyle = '#e8e2cf';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, p.swing.range * 0.85, a - 0.5, a + 0.15);
    ctx.stroke();
    ctx.restore();
  }

  // Weapon in hand
  drawWeapon(ctx, w, p);

  // Torso — dark outline then a light jacket, so the survivor reads as a
  // brighter, higher-contrast shape than any of the infected.
  ctx.fillStyle = '#15190f';
  ctx.beginPath();
  ctx.ellipse(0, 0, 13.5, 11.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = p.armor
    ? (p.armor === 'milVest' ? '#7d8b58' : p.armor === 'heavyVest' ? '#6d7c8e' : '#96a271')
    : '#8a9668';
  ctx.beginPath();
  ctx.ellipse(0, 0, 11.5, 9.8, 0, 0, TAU);
  ctx.fill();
  // Shoulder highlight
  ctx.fillStyle = '#b3bd8d';
  ctx.beginPath();
  ctx.ellipse(-2.5, 0, 7.5, 8.2, 0, 0, TAU);
  ctx.fill();
  // Chest rig
  ctx.fillStyle = '#3c4630';
  ctx.fillRect(-3, -8.5, 4, 17);
  ctx.fillStyle = '#d0b45a';
  ctx.fillRect(-2.4, -2, 2.8, 4);

  // Head + cap, pushed forward so facing is obvious at a glance
  ctx.fillStyle = '#15190f';
  ctx.beginPath();
  ctx.arc(4, 0, 7, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e0c49c';
  ctx.beginPath();
  ctx.arc(4, 0, 6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#4d5a3c';
  ctx.beginPath();
  ctx.arc(3, 0, 6, -2.0, 2.0);
  ctx.fill();
  // Cap brim points where you are facing
  ctx.fillStyle = '#3c4630';
  ctx.fillRect(8, -3.5, 3.5, 7);

  ctx.restore();

  // Hurt flash
  if (p.hurtFlash > 0) {
    ctx.save();
    ctx.globalAlpha = p.hurtFlash * 1.6;
    ctx.fillStyle = '#ff5a4a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  if (p.invuln > 0.05 && Math.floor(G.time * 12) % 2 === 0) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#9fd0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 17, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Channel bars (searching / bandaging)
  const chan = p.searching || p.using;
  if (chan) {
    const frac = clamp(chan.t / chan.dur, 0, 1);
    ctx.fillStyle = '#00000099';
    ctx.fillRect(p.x - 20, p.y - 30, 40, 6);
    ctx.fillStyle = p.using ? '#7ce08a' : '#e8d488';
    ctx.fillRect(p.x - 19, p.y - 29, 38 * frac, 4);
  }
}

function drawWeapon(ctx, w, p) {
  ctx.save();
  const recoil = p.attackCd > 0 && w.kind === 'gun' ? -Math.min(3, p.attackCd * 22) : 0;
  ctx.translate(10 + recoil, 5);
  if (w.kind === 'melee') {
    if (w.id === 'fists') { ctx.restore(); return; }
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(0, -2, 6, 4);
    ctx.fillStyle = w.color;
    if (w.id === 'sledge') { ctx.fillRect(6, -1.6, 13, 3.2); ctx.fillRect(17, -5, 6, 10); }
    else if (w.id === 'machete') { ctx.fillRect(5, -1.4, 20, 3); ctx.fillRect(22, -2.4, 4, 5); }
    else ctx.fillRect(5, -1.6, 17, 3.2);
  } else {
    ctx.fillStyle = '#22262a';
    ctx.fillRect(-2, -2.6, 8, 5.2);
    ctx.fillStyle = w.color;
    const len = w.id === 'rifle' ? 26 : w.id === 'shotgun' ? 22 : w.id === 'carbine' ? 21 : w.id === 'smg' ? 16 : 12;
    ctx.fillRect(4, -1.9, len, 3.8);
    ctx.fillStyle = '#15181a';
    ctx.fillRect(4 + len - 3, -2.4, 3, 4.8);
    if (w.id === 'shotgun' || w.id === 'rifle' || w.id === 'carbine') {
      ctx.fillStyle = '#3a2f22';
      ctx.fillRect(-6, -2.2, 6, 4.4);
    }
  }
  ctx.restore();
}

function drawSurvivor(ctx, s) {
  const idx = (s.id || 0) % Sprites.survivors.length;
  const spr = s.flash > 0 ? Sprites.survivorFlash[idx] : Sprites.survivors[idx];

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(2, 5, 11, 7, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (s.downed) {
    // Flat on their back, waiting for you.
    ctx.rotate(s.angle + Math.PI / 2);
    ctx.globalAlpha = 0.75;
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
    ctx.restore();
    const frac = clamp(s.downT / 8, 0, 1);
    ctx.fillStyle = '#00000099';
    ctx.fillRect(s.x - 18, s.y - 26, 36, 5);
    ctx.fillStyle = '#e05a4a';
    ctx.fillRect(s.x - 17, s.y - 25, 34 * frac, 3);
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e05a4a';
    ctx.fillText(`${s.name} DOWN`, s.x, s.y - 30);
    ctx.textAlign = 'left';
    return;
  }

  ctx.rotate(s.angle);
  ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
  ctx.restore();

  // Friendly marker so you never mistake one for something to shoot.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#9fe0b0';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(s.x, s.y + 3, 15, 9, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();

  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = s.hungry ? '#e0904a' : '#b8d8a8';
  ctx.fillText(`${s.name} ${s.level}`, s.x, s.y - 20);
  if (s.outOfAmmo) {
    ctx.fillStyle = '#d9c46a';
    ctx.fillText('NO AMMO', s.x, s.y - 30);
  }
  ctx.textAlign = 'left';

  if (s.hp < s.maxHp) {
    const frac = clamp(s.hp / s.maxHp, 0, 1);
    ctx.fillStyle = '#00000099';
    ctx.fillRect(s.x - 15, s.y - 17, 30, 4);
    ctx.fillStyle = frac > 0.5 ? '#7ec46a' : frac > 0.25 ? '#d9c46a' : '#e05a4a';
    ctx.fillRect(s.x - 14, s.y - 16, 28 * frac, 2);
  }
}

function drawRescue(ctx, r) {
  const bob = Math.sin(G.time * 2.4 + r.x) * 2;
  ctx.save();
  ctx.translate(r.x, r.y + bob);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, 9 - bob, 10, 6, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Huddled, hood up.
  ctx.fillStyle = '#2a2f26';
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#4d5744';
  ctx.beginPath(); ctx.ellipse(0, -1, 7, 6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#d8bb92';
  ctx.beginPath(); ctx.arc(0, -2, 3.4, 0, TAU); ctx.fill();
  ctx.restore();

  const pulse = 0.4 + Math.sin(G.time * 2.6) * 0.25;
  ctx.strokeStyle = `rgba(160,224,180,${pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(r.x, r.y, 24, 0, TAU);
  ctx.stroke();
}

function drawBackpack(ctx, b) {
  const bob = Math.sin(G.time * 3 + b.id) * 2;
  ctx.save();
  ctx.translate(b.x, b.y + bob);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, 10 - bob, 12, 6, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  const pulse = 0.35 + Math.sin(G.time * 3) * 0.2;
  ctx.strokeStyle = `rgba(230,190,90,${pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, TAU);
  ctx.stroke();
  ctx.drawImage(Sprites.backpack, -14, -14);
  ctx.restore();
}

// ----------------------------------------------------------------- effects --

function drawPickups(ctx) {
  for (const it of G.pickups) {
    const bob = Math.sin(G.time * 5 + it.bob) * 2.5;
    ctx.save();
    ctx.translate(it.x, it.y + bob);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 7 - bob, 6, 3, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    const color = pickupColor(it);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#00000088';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(6, 0); ctx.lineTo(0, 6); ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.25 + Math.sin(G.time * 4 + it.bob) * 0.12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function pickupColor(it) {
  if (it.kind === 'res') return (({ ammoP: '#d8c98a', ammoS: '#c9584e', ammoR: '#b8a05a' })[it.id]) ||
    (RES_COLORS[it.id] || '#c9c2ab');
  if (it.kind === 'item') return '#d9575f';
  if (it.kind === 'weapon') return '#ffe08a';
  return '#9fd0ff';
}

const RES_COLORS = {
  wood: '#a3763f', scrap: '#9aa2ab', cloth: '#c2a98a', elec: '#59b8c4',
  med: '#d9575f', parts: '#c9a227', mil: '#7fa14a', fuel: '#d2762c',
};

function drawBullets(ctx) {
  for (const b of G.bullets) {
    const len = b.trail;
    const vx = b.vx, vy = b.vy;
    const m = Math.hypot(vx, vy) || 1;
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = b.size;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - (vx / m) * len, b.y - (vy / m) * len);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawParticles(ctx) {
  for (const p of FX.parts) {
    const k = 1 - p.t / p.life;
    ctx.globalAlpha = clamp(k, 0, 1) * (p.kind === 'smoke' ? 0.4 : 1);
    if (p.kind === 'muzzle') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(p.size * 2.2, -p.size * 0.55);
      ctx.lineTo(p.size * 2.9, 0);
      ctx.lineTo(p.size * 2.2, p.size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.kind === 'smoke') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    } else if (p.kind === 'debris') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot || 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;

  for (const r of FX.ring) {
    const k = r.t / r.life;
    ctx.globalAlpha = (1 - k) * 0.8;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * k, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  for (const t of FX.texts) {
    const k = t.t / t.life;
    ctx.globalAlpha = clamp(1 - k * k, 0, 1);
    ctx.font = `bold ${t.size}px 'Courier New', monospace`;
    ctx.fillStyle = '#000';
    ctx.fillText(t.str, t.x + 1, t.y + 1);
    ctx.fillStyle = t.color;
    ctx.fillText(t.str, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// ------------------------------------------------------------- build ghost --

function drawBuildGhost(ctx) {
  const g = G.ui.ghost;
  if (!g) return;
  const p = G.player;

  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#b7e08a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 190, 0, TAU);
  ctx.stroke();
  ctx.restore();

  if (g.sel === 'repair' || g.sel === 'demolish') {
    const s = g.target;
    if (!s) return;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = g.valid ? (g.sel === 'repair' ? '#7ce08a' : '#e0904a') : '#e05a4a';
    ctx.lineWidth = 2;
    ctx.strokeRect(s.tx * TILE + 1, s.ty * TILE + 1, TILE - 2, TILE - 2);
    ctx.restore();
    return;
  }

  const spr = structureSprite(g.sel, null);
  ctx.save();
  ctx.globalAlpha = 0.55;
  if (spr) ctx.drawImage(spr, g.tx * TILE, g.ty * TILE);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = g.valid ? '#7ce08a' : '#e05a4a';
  ctx.lineWidth = 2;
  ctx.strokeRect(g.tx * TILE + 1, g.ty * TILE + 1, TILE - 2, TILE - 2);
  if (!g.valid && g.reason) {
    ctx.globalAlpha = 1;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(g.reason, g.tx * TILE + 17, g.ty * TILE - 5);
    ctx.fillStyle = '#e05a4a';
    ctx.fillText(g.reason, g.tx * TILE + 16, g.ty * TILE - 6);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function drawInteractPrompt(ctx) {
  const h = G.ui.hover;
  if (!h || G.ui.buildMode || G.player.searching) return;
  const ref = h.ref;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px "Courier New", monospace';
  const label = `E — ${h.label}`;
  const wpx = ctx.measureText(label).width + 12;
  // Sits well clear of the target so it never covers the player standing beside it.
  const y = ref.y - 46;
  ctx.fillStyle = '#0e120bdd';
  ctx.fillRect(ref.x - wpx / 2, y - 11, wpx, 15);
  ctx.strokeStyle = '#6f8f4a';
  ctx.lineWidth = 1;
  ctx.strokeRect(ref.x - wpx / 2, y - 11, wpx, 15);
  ctx.fillStyle = '#e6f0d8';
  ctx.fillText(label, ref.x, y);
  // Little stalk pointing at the thing it refers to.
  ctx.strokeStyle = '#6f8f4a99';
  ctx.beginPath();
  ctx.moveTo(ref.x, y + 4);
  ctx.lineTo(ref.x, ref.y - 18);
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = 'left';
}

// ------------------------------------------------------------ post effects --

function drawPostEffects(ctx, W, H) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Danger tint — the further you stray, the redder the world reads.
  const tier = G.ui.dangerTier || 1;
  if (tier > 1) {
    ctx.globalAlpha = (tier - 1) * 0.032;
    ctx.fillStyle = tier >= 4 ? '#ff2a1a' : '#ff5a2a';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // Vignette
  const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // Low-health pulse
  const p = G.player;
  if (p && !p.dead && p.hp / p.maxHp < 0.35) {
    const a = (0.35 - p.hp / p.maxHp) * 0.9 * (0.55 + Math.sin(G.time * 6) * 0.45);
    ctx.globalAlpha = clamp(a, 0, 0.45);
    ctx.fillStyle = '#8c1a1a';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  if (G.flash.t > 0) {
    ctx.globalAlpha = clamp(G.flash.t * 0.5, 0, 0.6);
    ctx.fillStyle = G.flash.color;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

export const _debug = { drawList, buildMenu, WEAPONS, STRUCTURES, ENEMIES };
