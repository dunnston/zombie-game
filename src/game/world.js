// Builds the map. The layout is authored (fixed seed + hand-placed districts) so
// the player can learn the town, while the small details are procedural.
//
// All static collision is tile-based: `blocked[i] === 1` stops players, enemies
// and bullets. Player-built structures live in a separate, destructible map.

import {
  TILE, WORLD_TILES, WORLD_SIZE, T, SOLID_TILES, CONTAINERS, FURNISHING,
} from './config.js';
import { makeRng, clamp } from '../core/util.js';

const W = WORLD_TILES;

export const LOCATIONS = [
  { id: 'camp',      name: 'ROADSIDE CAMP',       tier: 1, rect: [66, 66, 28, 28], desc: 'Quiet crossroads. Good first base.' },
  { id: 'suburb',    name: 'PINE HOLLOW SUBURBS', tier: 1, rect: [6, 6, 62, 58],   desc: 'Empty homes. Wood, cloth, odds and ends.' },
  { id: 'residenceE',name: 'EAST TERRACES',       tier: 2, rect: [96, 6, 56, 44],  desc: 'Denser housing. More of them here.' },
  { id: 'commercial',name: 'MARKET ROW',          tier: 2, rect: [92, 56, 60, 34], desc: 'Shops and a hardware store. Loud crowds.' },
  { id: 'gas',       name: 'FUEL STOP',           tier: 2, rect: [30, 82, 26, 22], desc: 'Fuel and scrap. Watch the pumps.' },
  { id: 'police',    name: 'PRECINCT 12',         tier: 3, rect: [98, 96, 40, 34], desc: 'Guns, ammo and armour. Heavily infested.' },
  { id: 'hospital',  name: 'ST. MARTHA HOSPITAL', tier: 3, rect: [10, 108, 46, 42],desc: 'Medicine. The halls are full.' },
  { id: 'industrial',name: 'DOCK YARD',           tier: 3, rect: [64, 118, 30, 36],desc: 'Electronics and parts. Brutes work here.' },
  { id: 'military',  name: 'CHECKPOINT DELTA',    tier: 4, rect: [124, 124, 32, 32],desc: 'Military hardware. You will need a plan.' },
];

export function createWorld(seed = 20240917) {
  const rng = makeRng(seed);
  const world = {
    w: W, h: W, seed,
    tiles: new Uint8Array(W * W).fill(T.GRASS),
    blocked: new Uint8Array(W * W),
    props: [],
    propGrid: new Map(),        // "tx,ty" -> harvestable prop
    chopped: [],                // tiles harvested this run, for the save file
    containers: [],
    locations: LOCATIONS.map((l) => ({ ...l, discovered: false })),
    danger: new Uint8Array(W * W).fill(1),
    spawnTiles: [],
  };

  const idx = (x, y) => y * W + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < W;

  const set = (x, y, t) => {
    if (!inBounds(x, y)) return;
    world.tiles[idx(x, y)] = t;
    world.blocked[idx(x, y)] = SOLID_TILES.has(t) ? 1 : 0;
  };
  const block = (x, y, v = 1) => { if (inBounds(x, y)) world.blocked[idx(x, y)] = v; };
  const fill = (x, y, w, h, t) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t);
  };
  world.set = set;

  // ------------------------------------------------------------- terrain --
  // Grass variation: patches of dirt and rough ground so it isn't a flat field.
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const n = Math.sin(x * 0.09) * Math.cos(y * 0.11) + Math.sin((x + y) * 0.05) * 0.7;
      if (n > 1.1) set(x, y, T.DIRT);
      else if (n < -1.25) set(x, y, T.GRAVEL);
    }
  }

  // Pond in the north-west woods — a landmark and a soft barrier.
  for (let y = 20; y < 34; y++) {
    for (let x = 74; x < 92; x++) {
      const dx = (x - 83) / 9, dy = (y - 27) / 7;
      if (dx * dx + dy * dy < 1) set(x, y, T.WATER);
      else if (dx * dx + dy * dy < 1.35) set(x, y, T.DIRT);
    }
  }

  // ---------------------------------------------------------------- roads --
  // `mark` records centre-line tiles so the renderer can paint road markings.
  world.mark = new Uint8Array(W * W);
  const roadH = (y, thickness) => {
    fill(0, y - 1, W, thickness + 2, T.SIDEWALK);
    fill(0, y, W, thickness, T.ROAD);
    const cy = y + (thickness >> 1);
    for (let x = 0; x < W; x++) world.mark[idx(x, cy)] = 1;
  };
  const roadV = (x, thickness) => {
    fill(x - 1, 0, thickness + 2, W, T.SIDEWALK);
    fill(x, 0, thickness, W, T.ROAD);
    const cx = x + (thickness >> 1);
    for (let y = 0; y < W; y++) world.mark[idx(cx, y)] = 2;
  };
  roadH(78, 5); roadH(26, 4); roadH(114, 4);
  roadV(78, 5); roadV(26, 4); roadV(114, 4);
  // Slip road out to the checkpoint.
  fill(116, 138, 40, 4, T.ROAD);
  fill(138, 116, 4, 40, T.ROAD);

  // Road markings are drawn by the renderer from tile type; nothing to store.

  // ------------------------------------------------------------ buildings --
  /**
   * Stamps a rectangular building: solid perimeter, floor inside, doorway gaps.
   * Returns the interior tile list so callers can place loot.
   */
  function building(bx, by, bw, bh, opts = {}) {
    const floor = opts.floor ?? T.FLOOR_WOOD;
    fill(bx, by, bw, bh, floor);
    for (let x = bx; x < bx + bw; x++) { set(x, by, T.WALL); set(x, by + bh - 1, T.WALL); }
    for (let y = by; y < by + bh; y++) { set(bx, y, T.WALL); set(bx + bw - 1, y, T.WALL); }

    // Doorways — at least one, always on an outer wall.
    const doors = opts.doors ?? 1;
    for (let d = 0; d < doors; d++) {
      const side = opts.doorSides ? opts.doorSides[d % opts.doorSides.length] : rng.int(0, 3);
      const width = opts.doorWidth ?? 2;
      if (side === 0) { const x = bx + rng.int(1, Math.max(1, bw - width - 1)); for (let i = 0; i < width; i++) set(x + i, by, floor); }
      if (side === 1) { const x = bx + rng.int(1, Math.max(1, bw - width - 1)); for (let i = 0; i < width; i++) set(x + i, by + bh - 1, floor); }
      if (side === 2) { const y = by + rng.int(1, Math.max(1, bh - width - 1)); for (let i = 0; i < width; i++) set(bx, y + i, floor); }
      if (side === 3) { const y = by + rng.int(1, Math.max(1, bh - width - 1)); for (let i = 0; i < width; i++) set(bx + bw - 1, y + i, floor); }
    }

    // Interior partitions for anything big enough to have rooms.
    if (opts.rooms && bw > 9 && bh > 7) {
      const vx = bx + Math.floor(bw / 2) + rng.int(-1, 1);
      for (let y = by + 1; y < by + bh - 1; y++) set(vx, y, T.WALL);
      const gap = by + rng.int(2, bh - 4);
      set(vx, gap, floor); set(vx, gap + 1, floor);
      if (bh > 11) {
        const hy = by + Math.floor(bh / 2);
        for (let x = bx + 1; x < bx + bw - 1; x++) if (x !== vx) set(x, hy, T.WALL);
        const g2 = bx + rng.int(2, Math.max(3, bw - 4));
        set(g2, hy, floor); set(g2 + 1, hy, floor);
      }
    }

    const interior = [];
    for (let y = by + 1; y < by + bh - 1; y++) {
      for (let x = bx + 1; x < bx + bw - 1; x++) {
        if (world.tiles[idx(x, y)] === floor) interior.push([x, y]);
      }
    }
    return interior;
  }

  function addContainer(tx, ty, kind) {
    if (!inBounds(tx, ty) || world.blocked[idx(tx, ty)]) return null;
    const def = CONTAINERS[kind];
    if (!def) return null;
    const c = {
      id: world.containers.length,
      kind, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
      tx, ty, looted: false, sprite: def.sprite, label: def.label,
      rolls: def.rolls, table: def.table,
    };
    world.containers.push(c);
    block(tx, ty, 1);
    return c;
  }

  /**
   * Furnishes a building's interior. `kinds` is either a plain list or a
   * FURNISHING key, in which case fittings are drawn from that building type's
   * weighted table — so a house fills with wardrobes and a precinct with
   * filing cabinets.
   *
   * Furniture goes against walls, because that is where furniture goes, and
   * because it keeps the middle of a room walkable during a fight.
   */
  function stock(interior, kinds, n) {
    const table = typeof kinds === 'string' ? FURNISHING[kinds] : null;
    const list = table ? null : kinds;
    const pickKind = () => {
      if (list) return rng.pick(list);
      let total = 0;
      for (const [, w] of table) total += w;
      let r = rng() * total;
      for (const [k, w] of table) { r -= w; if (r <= 0) return k; }
      return table[0][0];
    };

    const nearWall = interior.filter(([x, y]) =>
      world.blocked[idx(x - 1, y)] || world.blocked[idx(x + 1, y)] ||
      world.blocked[idx(x, y - 1)] || world.blocked[idx(x, y + 1)]);
    const pool = nearWall.length > n ? nearWall : interior;
    const used = new Set();
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 25 && pool.length) {
      const [x, y] = rng.pick(pool);
      const k = `${x},${y}`;
      if (used.has(k)) continue;
      used.add(k);
      if (addContainer(x, y, pickKind())) placed++;
    }
  }

  // ------------------------------------------------------ district: camp --
  // The starting crossroads: a couple of shacks, a wreck, and easy pickings.
  {
    const i1 = building(70, 70, 8, 7, { doors: 1 });
    stock(i1, 'house', 4);
    const i2 = building(84, 84, 7, 6, { doors: 1 });
    stock(i2, 'house', 4);
    const i3 = building(68, 86, 9, 6, { doors: 2 });
    stock(i3, 'house', 5);
  }

  // ---------------------------------------------------- district: suburbs --
  {
    const lots = [
      [10, 10, 13, 10], [28, 8, 12, 9], [46, 10, 14, 11],
      [10, 30, 12, 10], [30, 30, 15, 11], [50, 32, 12, 9],
      [12, 48, 14, 11], [34, 50, 13, 10], [52, 50, 12, 9],
      [8, 66, 12, 9], [40, 66, 11, 8],
    ];
    for (const [x, y, w, h] of lots) {
      const interior = building(x, y, w, h, { doors: rng.int(1, 2), rooms: true });
      stock(interior, 'house', rng.int(5, 8));
      // Driveway + a parked car out front.
      fill(x + 2, y + h, 3, 3, T.GRAVEL);
      if (rng.chance(0.55)) addCar(x + 2, y + h + 1, 0);
    }
  }

  // ------------------------------------------------- district: east homes --
  {
    const lots = [
      [98, 8, 14, 11], [118, 8, 13, 10], [136, 10, 13, 11],
      [98, 26, 12, 10], [118, 26, 14, 11], [136, 28, 13, 10],
      [100, 42, 15, 8], [122, 42, 14, 8], [140, 42, 10, 8],
    ];
    for (const [x, y, w, h] of lots) {
      const interior = building(x, y, w, h, { doors: rng.int(1, 2), rooms: true });
      stock(interior, 'house', rng.int(6, 9));
      if (rng.chance(0.5)) addCar(x + 3, y + h + 1, 0);
    }
  }

  // ------------------------------------------------- district: market row --
  {
    // Convenience store
    const conv = building(94, 58, 16, 12, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 2] });
    stock(conv, 'store', 11);
    fill(94, 71, 16, 4, T.LOT);

    // Hardware store — the wood/scrap jackpot for early base building.
    const hard = building(116, 56, 20, 14, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 3], rooms: true });
    stock(hard, 'hardware', 14);
    fill(116, 71, 20, 5, T.LOT);
    addCar(120, 72, 0); addCar(128, 72, 0);

    // Electronics / pawn shop
    const pawn = building(140, 58, 12, 11, { floor: T.FLOOR_TILE, doors: 1 });
    stock(pawn, 'pawn', 8);

    // Strip-mall parking
    fill(92, 82, 60, 6, T.LOT);
    for (let i = 0; i < 7; i++) addCar(94 + i * 8, 83, 0);
  }

  // -------------------------------------------------- district: fuel stop --
  {
    const shop = building(30, 84, 11, 8, { floor: T.FLOOR_TILE, doors: 1, doorSides: [1] });
    stock(shop, 'store', 7);
    fill(30, 93, 24, 8, T.LOT);
    // Canopy pumps
    for (let i = 0; i < 4; i++) addContainer(34 + i * 4, 96, 'fuelPump');
    addCar(44, 94, 0); addCar(48, 99, 0);
    addWreck(40, 99);
  }

  // ---------------------------------------------------- district: police --
  {
    const main = building(100, 98, 24, 18, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 2], rooms: true });
    stock(main, 'police', 14);
    // Armoury annex — safes behind a second wall
    const arm = building(126, 100, 10, 9, { floor: T.FLOOR_TILE, doors: 1, doorSides: [2] });
    stock(arm, ['gunSafe', 'gunSafe', 'policeLocker', 'footlocker'], 6);
    // Motor pool
    fill(100, 118, 30, 6, T.LOT);
    for (let i = 0; i < 5; i++) addCar(102 + i * 6, 119, 0);
    // Sandbag line at the front
    for (let x = 100; x < 124; x += 1) if (x % 5 !== 0) set(x, 96, T.RUBBLE);
  }

  // -------------------------------------------------- district: hospital --
  {
    const main = building(14, 112, 30, 22, { floor: T.FLOOR_TILE, doors: 3, doorSides: [0, 2, 3], rooms: true });
    stock(main, 'hospital', 18);
    const wing = building(16, 138, 20, 10, { floor: T.FLOOR_TILE, doors: 1 });
    stock(wing, 'hospital', 8);
    fill(46, 116, 10, 18, T.LOT);
    addWreck(48, 120); addCar(48, 128, 0);
  }

  // ------------------------------------------------ district: industrial --
  {
    const warehouse = building(64, 120, 26, 20, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 3] });
    stock(warehouse, 'industrial', 15);
    // Interior storage rows made of rubble stacks
    for (let y = 126; y < 136; y += 4) for (let x = 68; x < 86; x++) if (x % 7 !== 0) set(x, y, T.RUBBLE);
    fill(64, 142, 26, 8, T.LOT);
    addWreck(68, 144); addCar(76, 144, 0); addWreck(84, 145);
  }

  // -------------------------------------------------- district: military --
  {
    // Fenced compound with a single vehicle gate.
    const cx = 126, cy = 126, cw = 28, ch = 28;
    for (let x = cx; x < cx + cw; x++) { set(x, cy, T.WALL); set(x, cy + ch - 1, T.WALL); }
    for (let y = cy; y < cy + ch; y++) { set(cx, y, T.WALL); set(cx + cw - 1, y, T.WALL); }
    fill(cx + 1, cy + 1, cw - 2, ch - 2, T.GRAVEL);
    // Gate on the north wall, facing the slip road.
    for (let i = 0; i < 4; i++) set(cx + 12 + i, cy, T.GRAVEL);

    // Command hut
    const hut = building(cx + 4, cy + 5, 10, 8, { floor: T.FLOOR_TILE, doors: 1, doorSides: [1] });
    stock(hut, 'military', 7);
    // Barracks
    const bar = building(cx + 16, cy + 16, 10, 9, { floor: T.FLOOR_TILE, doors: 1, doorSides: [0] });
    stock(bar, 'military', 7);
    // Open crate stacks + sandbags
    for (let i = 0; i < 7; i++) addContainer(cx + 4 + i * 3, cy + 21, 'militaryCrate');
    for (let i = 0; i < 4; i++) addContainer(cx + 18 + i * 2, cy + 4, 'militaryCrate');
    for (let x = cx + 3; x < cx + 25; x++) if (x % 4 !== 0) set(x, cy + 2, T.RUBBLE);
    addWreck(cx + 17, cy + 9); addWreck(cx + 21, cy + 11);
  }

  // ------------------------------------------------------- cars and props --
  function addCar(tx, ty, rot) {
    if (!inBounds(tx, ty)) return;
    const horizontal = rot === 0;
    const tw = horizontal ? 2 : 1, th = horizontal ? 1 : 2;
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      if (!inBounds(tx + i, ty + j) || world.blocked[idx(tx + i, ty + j)]) return;
    }
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) block(tx + i, ty + j, 1);
    world.props.push({
      kind: 'car', si: rng.int(0, 3), rot: horizontal ? 0 : Math.PI / 2,
      x: (tx + tw / 2) * TILE, y: (ty + th / 2) * TILE,
    });
    // Roughly half the cars have a lootable boot.
    if (rng.chance(0.55)) {
      const c = {
        id: world.containers.length, kind: 'carTrunk',
        x: (tx + tw / 2) * TILE, y: (ty + th / 2) * TILE,
        tx, ty, looted: false, sprite: 'trunk', label: 'Car Trunk',
        rolls: CONTAINERS.carTrunk.rolls, table: 'carTrunk', hidden: true,
      };
      world.containers.push(c);
    }
  }

  function addWreck(tx, ty) {
    if (!inBounds(tx, ty) || world.blocked[idx(tx, ty)] || world.blocked[idx(tx + 1, ty)]) return;
    block(tx, ty, 1); block(tx + 1, ty, 1);
    world.props.push({ kind: 'wreck', si: rng.int(0, 1), rot: 0, x: (tx + 1) * TILE, y: (ty + 0.5) * TILE });
  }

  // Roadside wrecks on the main arteries — cover and obstacles.
  for (let i = 0; i < 26; i++) {
    const along = rng.int(4, W - 6);
    if (rng.chance(0.5)) addWreck(along, rng.chance(0.5) ? 79 : 27);
    else addWreck(rng.chance(0.5) ? 79 : 115, along);
  }

  // Woodland: dense at the map edges, thinning toward the centre.
  for (let i = 0; i < 5200; i++) {
    const x = rng.int(1, W - 2), y = rng.int(1, W - 2);
    const t = world.tiles[idx(x, y)];
    if (t !== T.GRASS && t !== T.DIRT) continue;
    if (world.blocked[idx(x, y)]) continue;
    // Edge bias — the outskirts should feel like woods.
    const edge = Math.min(x, y, W - 1 - x, W - 1 - y);
    const p = clamp(0.62 - edge / 90, 0.05, 0.62);
    if (!rng.chance(p)) continue;
    if (rng.chance(0.72)) {
      block(x, y, 1);
      // Trees are choppable: they gate sight lines and turret fire, and they
      // are the renewable-ish wood supply that early base building runs on.
      const tree = {
        kind: 'tree', si: rng.int(0, 3), rot: 0, tx: x, ty: y,
        x: (x + 0.5) * TILE, y: (y + 0.5) * TILE,
        hp: 70, maxHp: 70, harvest: 'wood', flash: 0,
      };
      world.props.push(tree);
      world.propGrid.set(`${x},${y}`, tree);
    } else {
      world.props.push({ kind: rng.chance(0.7) ? 'bush' : 'rock', si: rng.int(0, 2), rot: rng.range(0, 6.28), x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
    }
  }

  // ---------------------------------------------------------- danger map --
  for (const loc of world.locations) {
    const [lx, ly, lw, lh] = loc.rect;
    const pad = 6;
    for (let y = ly - pad; y < ly + lh + pad; y++) {
      for (let x = lx - pad; x < lx + lw + pad; x++) {
        if (!inBounds(x, y)) continue;
        const inside = x >= lx && y >= ly && x < lx + lw && y < ly + lh;
        const t = inside ? loc.tier : Math.max(1, loc.tier - 1);
        const i = idx(x, y);
        if (t > world.danger[i]) world.danger[i] = t;
      }
    }
  }

  // -------------------------------------------------- player spawn points --
  // Open outdoor tiles in tier-1 land, away from walls — used for the random
  // starting spawn and for respawns before a bedroll exists.
  for (let y = 4; y < W - 4; y += 2) {
    for (let x = 4; x < W - 4; x += 2) {
      const i = idx(x, y);
      if (world.blocked[i] || world.danger[i] > 1) continue;
      const t = world.tiles[i];
      if (t !== T.GRASS && t !== T.DIRT && t !== T.GRAVEL && t !== T.ROAD && t !== T.SIDEWALK) continue;
      let clear = true;
      for (let j = -2; j <= 2 && clear; j++) {
        for (let i2 = -2; i2 <= 2; i2++) {
          if (world.blocked[idx(clamp(x + i2, 0, W - 1), clamp(y + j, 0, W - 1))]) { clear = false; break; }
        }
      }
      if (clear) world.spawnTiles.push([x, y]);
    }
  }

  // Sort container ids so save data stays stable across loads.
  world.containers.forEach((c, i) => { c.id = i; });

  return world;
}

// -------------------------------------------------------------- accessors --

export const tileAt = (world, px, py) => {
  const x = px >> 5, y = py >> 5;
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return T.WALL;
  return world.tiles[y * world.w + x];
};

export function isBlockedTile(world, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return true;
  return world.blocked[ty * world.w + tx] === 1;
}

export function isBlockedPx(world, px, py) {
  return isBlockedTile(world, Math.floor(px / TILE), Math.floor(py / TILE));
}

export function dangerAtPx(world, px, py) {
  const x = clamp(Math.floor(px / TILE), 0, world.w - 1);
  const y = clamp(Math.floor(py / TILE), 0, world.h - 1);
  return world.danger[y * world.w + x];
}

export function locationAtPx(world, px, py) {
  const tx = px / TILE, ty = py / TILE;
  for (const l of world.locations) {
    const [x, y, w, h] = l.rect;
    if (tx >= x && ty >= y && tx < x + w && ty < y + h) return l;
  }
  return null;
}

/** The harvestable prop occupying a tile, if any. */
export const propAtTile = (world, tx, ty) => world.propGrid.get(`${tx},${ty}`) || null;

/** Removes a harvested prop and frees the tile it was blocking. */
export function removeProp(world, prop) {
  const i = world.props.indexOf(prop);
  if (i >= 0) world.props.splice(i, 1);
  world.propGrid.delete(`${prop.tx},${prop.ty}`);
  world.chopped.push(`${prop.tx},${prop.ty}`);
  if (prop.tx >= 0 && prop.ty >= 0 && prop.tx < world.w && prop.ty < world.h) {
    world.blocked[prop.ty * world.w + prop.tx] = 0;
  }
}

export const WORLD_PX = WORLD_SIZE;
