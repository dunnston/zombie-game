// Builds the map. The layout is authored (fixed seed + hand-placed districts) so
// the player can learn the town, while the small details are procedural.
//
// The world is 320 tiles square. The original 160-tile town sits in the middle
// (offset by TOWN_X/TOWN_Y) and the country wraps around it:
//
//              forest · lumber camp · lake · (forest)
//     farms |                                     | Crown Heights
//     river |               THE TOWN              | Downtown
//     ranch |                                     | Galleria Mall
//              orchard · outskirts · junkyard
//
// Danger runs roughly west to east: the farms are the quietest ground on the
// map and the downtown core is the worst. The river down the west side is a
// soft barrier — crossable at two bridges, shootable across, never walkable.
//
// All static collision is tile-based: `blocked[i] === 1` stops players and
// enemies. Bullets ask `SHOOT_OVER` (water, fences) before stopping. Player-
// built structures live in a separate, destructible map.

import {
  TILE, WORLD_TILES, WORLD_SIZE, T, SOLID_TILES, CONTAINERS, FURNISHING,
} from './config.js';
import { makeRng, clamp } from '../core/util.js';

const W = WORLD_TILES;

/** Where the original town's (0,0) landed. Town coordinates below are already shifted. */
export const TOWN_X = 80, TOWN_Y = 80, TOWN_W = 160;

// Order matters: `locationAtPx` returns the first match, so the small named
// places inside the forest come before the forest itself.
export const LOCATIONS = [
  // ------------------------------------------------------------ the town --
  { id: 'camp',      name: 'ROADSIDE CAMP',       tier: 1, rect: [146, 146, 28, 28], desc: 'Quiet crossroads. Good first base.' },
  { id: 'suburb',    name: 'PINE HOLLOW SUBURBS', tier: 1, rect: [86, 86, 62, 58],   desc: 'Empty homes. Wood, cloth, odds and ends.' },
  { id: 'residenceE',name: 'EAST TERRACES',       tier: 2, rect: [176, 86, 56, 44],  desc: 'Denser housing. More of them here.' },
  { id: 'commercial',name: 'MARKET ROW',          tier: 2, rect: [172, 136, 60, 34], desc: 'Shops and a hardware store. Loud crowds.' },
  { id: 'gas',       name: 'FUEL STOP',           tier: 2, rect: [110, 162, 26, 22], desc: 'Fuel and scrap. Watch the pumps.' },
  { id: 'police',    name: 'PRECINCT 12',         tier: 3, rect: [178, 176, 40, 34], desc: 'Guns, ammo and armour. Heavily infested.' },
  { id: 'hospital',  name: 'ST. MARTHA HOSPITAL', tier: 3, rect: [90, 188, 46, 42],  desc: 'Medicine. The halls are full.' },
  { id: 'industrial',name: 'DOCK YARD',           tier: 3, rect: [144, 198, 30, 36], desc: 'Electronics and parts. Brutes work here.' },
  { id: 'military',  name: 'CHECKPOINT DELTA',    tier: 4, rect: [204, 204, 32, 32], desc: 'Military hardware. You will need a plan.' },
  // --------------------------------------------------------- the country --
  { id: 'farms',     name: 'HOLLOW CREEK FARMS',  tier: 1, rect: [2, 66, 52, 106],   desc: 'Fields and barns across the river. Food, fuel, quiet.' },
  { id: 'ranch',     name: 'SADDLEBACK RANCH',    tier: 1, rect: [2, 206, 52, 50],   desc: 'Paddocks and a stable. The end of the lane.' },
  { id: 'lumber',    name: 'GRAYSON LUMBER',      tier: 2, rect: [88, 14, 44, 38],   desc: 'Log stacks and a sawmill. Wood by the ton.' },
  { id: 'lake',      name: 'LOON LAKE',           tier: 2, rect: [170, 8, 54, 46],   desc: 'A lodge on the shore. Quiet, until it is not.' },
  { id: 'junkyard',  name: 'RUST BELT SALVAGE',   tier: 2, rect: [166, 250, 48, 42], desc: 'Wrecks stacked three high. Scrap and parts.' },
  { id: 'forest',    name: 'BLACKPINE FOREST',    tier: 2, rect: [0, 0, W, 62], label: [150, 6], desc: 'Deep woods. Cabins, and things between the trees.' },
  // ------------------------------------------------------------ the city --
  { id: 'heights',   name: 'CROWN HEIGHTS',       tier: 3, rect: [240, 62, 80, 68],  desc: 'Apartment blocks. Crowded, floor after floor.' },
  { id: 'downtown',  name: 'DOWNTOWN',            tier: 4, rect: [240, 132, 80, 82], desc: 'Office towers and the bank. The whole city died here.' },
  { id: 'mall',      name: 'GALLERIA MALL',       tier: 3, rect: [240, 216, 80, 54], desc: 'Shops, a drugstore and an outfitters. Everyone came here.' },
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
    vehicleSpawns: [],          // turned into drivable cars at game start
    locations: LOCATIONS.map((l) => ({ ...l, discovered: false })),
    danger: new Uint8Array(W * W).fill(1),
    spawnTiles: [],
  };

  const idx = (x, y) => y * W + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < W;
  const tileAt = (x, y) => (inBounds(x, y) ? world.tiles[idx(x, y)] : T.WALL);

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

  // Tiles the woodland pass must leave alone: yards, trails, orchard rows.
  const noTree = new Uint8Array(W * W);
  const clearing = (x, y, w, h) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (inBounds(i, j)) noTree[idx(i, j)] = 1;
  };

  // ------------------------------------------------------------- terrain --
  // Grass variation: patches of dirt and rough ground so it isn't a flat field.
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const n = Math.sin(x * 0.09) * Math.cos(y * 0.11) + Math.sin((x + y) * 0.05) * 0.7;
      if (n > 1.1) set(x, y, T.DIRT);
      else if (n < -1.25) set(x, y, T.GRAVEL);
    }
  }

  // --------------------------------------------------------------- water --
  const isGround = (t) => t === T.GRASS || t === T.DIRT || t === T.GRAVEL;

  /** An elliptical body of water with a sandy shore, slightly wobbled. */
  function lake(cx, cy, rx, ry, wobble = 0.12) {
    for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) {
      for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
        const a = Math.atan2(y - cy, x - cx);
        const k = 1 + Math.sin(a * 3 + cx) * wobble + Math.cos(a * 5 + cy) * wobble * 0.5;
        const dx = (x - cx) / (rx * k), dy = (y - cy) / (ry * k);
        const d = dx * dx + dy * dy;
        if (d < 1) set(x, y, T.WATER);
        else if (d < 1.45 && isGround(tileAt(x, y))) set(x, y, T.SAND);
      }
    }
  }

  // The Marrow: a meandering river down the west side of the map. Everything
  // rural is on its far bank; the town side gets a wooded strip.
  const riverCentre = (y) => 66 + 5 * Math.sin(y * 0.05) + 2.5 * Math.sin(y * 0.13 + 1.7);
  const riverHalf = (y) => 3.2 + 0.9 * Math.sin(y * 0.08 + 0.5);
  for (let y = 0; y < W; y++) {
    const xc = riverCentre(y), hw = riverHalf(y);
    for (let x = Math.floor(xc - hw - 3); x <= xc + hw + 3; x++) {
      const d = Math.abs(x + 0.5 - xc);
      if (d < hw) set(x, y, T.WATER);
      else if (d < hw + 1.6 && isGround(tileAt(x, y))) set(x, y, T.SAND);
    }
  }
  world.riverCentre = riverCentre;

  lake(197, 28, 22, 14);          // Loon Lake, in the forest north of town
  lake(150, 95, 6, 5, 0.18);      // the town pond, beside the suburbs
  lake(14, 118, 5, 4, 0.2);       // a farm pond
  lake(28, 238, 4, 3, 0.2);       // the ranch's stock pond

  // ---------------------------------------------------------------- roads --
  // `mark` records centre-line tiles so the renderer can paint road markings.
  // Roads are laid over the river, which is what makes a bridge.
  world.mark = new Uint8Array(W * W);
  const roadH = (y, thickness, x0 = 0, x1 = W) => {
    fill(x0, y - 1, x1 - x0, thickness + 2, T.SIDEWALK);
    fill(x0, y, x1 - x0, thickness, T.ROAD);
    const cy = y + (thickness >> 1);
    for (let x = x0; x < x1; x++) world.mark[idx(x, cy)] = 1;
  };
  const roadV = (x, thickness, y0 = 0, y1 = W) => {
    fill(x - 1, y0, thickness + 2, y1 - y0, T.SIDEWALK);
    fill(x, y0, thickness, y1 - y0, T.ROAD);
    const cx = x + (thickness >> 1);
    for (let y = y0; y < y1; y++) world.mark[idx(cx, y)] = 2;
  };
  /** Unpaved: a gravel lane or a dirt track, no sidewalk, kept clear of trees. */
  const lane = (x, y, w, h, t = T.GRAVEL) => { fill(x, y, w, h, t); clearing(x - 1, y - 1, w + 2, h + 2); };
  /** A dirt footpath between waypoints, two tiles wide. */
  function trail(points) {
    for (let i = 1; i < points.length; i++) {
      let [x, y] = points[i - 1];
      const [tx, ty] = points[i];
      let guard = 0;
      while ((x !== tx || y !== ty) && guard++ < 600) {
        if (x !== tx && (y === ty || rng.chance(0.5))) x += Math.sign(tx - x); else y += Math.sign(ty - y);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
          if (isGround(tileAt(x + dx, y + dy)) || tileAt(x + dx, y + dy) === T.SAND) set(x + dx, y + dy, T.DIRT);
          if (inBounds(x + dx, y + dy)) noTree[idx(x + dx, y + dy)] = 1;
        }
      }
    }
  }

  // The town grid, extended into the country where it makes sense.
  roadH(158, 5);                       // the highway: farms — bridge — town — downtown
  roadH(106, 4, 26, W);                // north road: farm lane — bridge — town — Crown Heights
  roadH(194, 4, 82, 240);              // south road: ends at the riverbank
  roadV(158, 5);                       // main street: forest — town — junkyard — south
  roadV(106, 4, 44, 250);              // west street: lumber yard down to the orchard
  roadV(194, 4, 52, 248);              // east street: the lake lodge down to the junkyard gate
  // City avenues and cross-streets.
  roadV(262, 4, 60, 222);
  roadV(290, 4, 60, 272);
  roadH(84, 4, 240, W);
  roadH(130, 4, 240, W);
  roadH(184, 4, 240, W);
  roadH(218, 4, 196, W);               // the checkpoint slip road runs on into the mall district
  fill(218, 196, 4, 40, T.ROAD);       // ...and its spur up to the compound gate
  // Country lanes.
  lane(28, 66, 3, 190);                // the farm lane, north farm down to the ranch
  lane(20, 78, 8, 3); lane(20, 174, 8, 3); lane(20, 216, 8, 3); // farm drives
  lane(31, 76, 6, 3); lane(31, 172, 6, 3); lane(31, 212, 4, 3);

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

    // Partition lines: their gap tiles are the only way between rooms, so the
    // furnishing pass must never put a wardrobe in one.
    const vs = [], hs = [];
    if (opts.grid && bw > 13 && bh > 13) {
      // A tower floor: a lattice of rooms off a corridor, every wall with a gap.
      // No line closer than five tiles to the far wall: a two-tile room is one
      // that two wardrobes can seal.
      const step = opts.grid === true ? 7 : opts.grid;
      for (let vx = bx + step; vx < bx + bw - 5; vx += step) vs.push(vx);
      for (let hy = by + step; hy < by + bh - 5; hy += step) hs.push(hy);
      for (const vx of vs) for (let y = by + 1; y < by + bh - 1; y++) set(vx, y, T.WALL);
      for (const hy of hs) for (let x = bx + 1; x < bx + bw - 1; x++) set(x, hy, T.WALL);
      // Gaps: one per wall segment between crossings.
      const xs = [bx, ...vs, bx + bw - 1], ys = [by, ...hs, by + bh - 1];
      for (const vx of vs) for (let k = 1; k < ys.length; k++) {
        const y0 = ys[k - 1] + 1, y1 = ys[k] - 1;
        if (y1 - y0 >= 2) { const g = rng.int(y0, y1 - 1); set(vx, g, floor); set(vx, g + 1, floor); }
      }
      for (const hy of hs) for (let k = 1; k < xs.length; k++) {
        const x0 = xs[k - 1] + 1, x1 = xs[k] - 1;
        if (x1 - x0 >= 2) { const g = rng.int(x0, x1 - 1); set(g, hy, floor); set(g + 1, hy, floor); }
      }
    } else if (opts.rooms && bw > 9 && bh > 7) {
      // Interior partitions for anything big enough to have rooms.
      const vx = bx + Math.floor(bw / 2) + rng.int(-1, 1);
      vs.push(vx);
      for (let y = by + 1; y < by + bh - 1; y++) set(vx, y, T.WALL);
      if (bh > 11) {
        // Four rooms: every one of them gets a way into a neighbour, or the
        // corner with the loot in it is sealed for good.
        const hy = by + Math.floor(bh / 2);
        hs.push(hy);
        for (let x = bx + 1; x < bx + bw - 1; x++) if (x !== vx) set(x, hy, T.WALL);
        const gapAt = (y) => { set(vx, y, floor); set(vx, y + 1, floor); };
        gapAt(by + rng.int(1, Math.max(1, hy - by - 3)));
        gapAt(hy + rng.int(1, Math.max(1, by + bh - hy - 4)));
        const g2 = bx + rng.int(1, Math.max(1, vx - bx - 3));
        set(g2, hy, floor); set(g2 + 1, hy, floor);
        const g3 = vx + rng.int(1, Math.max(1, bx + bw - vx - 4));
        set(g3, hy, floor); set(g3 + 1, hy, floor);
      } else {
        const gap = by + rng.int(2, bh - 4);
        set(vx, gap, floor); set(vx, gap + 1, floor);
      }
    }

    // The furnishable interior: floor tiles that are not on a wall line and
    // not beside an opening in one. Two cabinets either side of a doorway
    // would otherwise wall it off as surely as bricks.
    const vset = new Set(vs), hset = new Set(hs);
    const onLine = (x, y) => x === bx || x === bx + bw - 1 || y === by || y === by + bh - 1 || vset.has(x) || hset.has(y);
    const opening = (x, y) => onLine(x, y) && world.tiles[idx(x, y)] === floor;
    const interior = [];
    for (let y = by + 1; y < by + bh - 1; y++) {
      for (let x = bx + 1; x < bx + bw - 1; x++) {
        if (onLine(x, y) || world.tiles[idx(x, y)] !== floor) continue;
        if (opening(x - 1, y) || opening(x + 1, y) || opening(x, y - 1) || opening(x, y + 1)) continue;
        interior.push([x, y]);
      }
    }
    return interior;
  }

  /** A rail fence around a rectangle, with the listed tiles left open as gates. */
  function fenceRect(fx, fy, fw, fh, gates = []) {
    const open = new Set(gates.map(([x, y]) => `${x},${y}`));
    const post = (x, y) => { if (!open.has(`${x},${y}`) && isGround(tileAt(x, y))) set(x, y, T.FENCE); };
    for (let x = fx; x < fx + fw; x++) { post(x, fy); post(x, fy + fh - 1); }
    for (let y = fy; y < fy + fh; y++) { post(fx, y); post(fx + fw - 1, y); }
  }

  /** Tilled ground in rows. Walkable, buildable, and nothing grows on it. */
  const field = (x, y, w, h) => { fill(x, y, w, h, T.FIELD); };

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

  // ------------------------------------------------------- cars and props --
  /**
   * Cars are spawned as vehicle definitions rather than scenery, because they
   * can be driven away. The tiles they sit on are still blocked while parked,
   * and `tiles` records exactly which ones this car claimed so they can be
   * released when it moves without clearing a tree that was already there.
   */
  function addCar(tx, ty, rot) {
    if (!inBounds(tx, ty)) return;
    const horizontal = rot === 0;
    const tw = horizontal ? 2 : 1, th = horizontal ? 1 : 2;
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      if (!inBounds(tx + i, ty + j) || world.blocked[idx(tx + i, ty + j)]) return;
    }
    const tiles = [];
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        block(tx + i, ty + j, 1);
        tiles.push([tx + i, ty + j]);
      }
    }
    world.vehicleSpawns.push({
      x: (tx + tw / 2) * TILE,
      y: (ty + th / 2) * TILE,
      rot: horizontal ? 0 : Math.PI / 2,
      si: rng.int(0, 3),
      tiles,
      seed: rng.int(1, 0x7fffffff),
    });
  }

  function addWreck(tx, ty) {
    if (!inBounds(tx, ty) || world.blocked[idx(tx, ty)] || world.blocked[idx(tx + 1, ty)]) return;
    block(tx, ty, 1); block(tx + 1, ty, 1);
    world.props.push({ kind: 'wreck', si: rng.int(0, 1), rot: 0, x: (tx + 1) * TILE, y: (ty + 0.5) * TILE });
  }

  /** A choppable tree on one tile. Pines and broadleaves harvest the same. */
  function plantTree(x, y, pine = false) {
    if (!inBounds(x, y) || world.blocked[idx(x, y)]) return null;
    const t = world.tiles[idx(x, y)];
    if (t !== T.GRASS && t !== T.DIRT) return null;
    block(x, y, 1);
    // Trees are choppable: they gate sight lines and turret fire, and they
    // are the renewable-ish wood supply that early base building runs on.
    const tree = {
      kind: pine ? 'pine' : 'tree', si: rng.int(0, 3), rot: 0, tx: x, ty: y,
      x: (x + 0.5) * TILE, y: (y + 0.5) * TILE,
      hp: 70, maxHp: 70, harvest: 'wood', flash: 0,
    };
    world.props.push(tree);
    world.propGrid.set(`${x},${y}`, tree);
    return tree;
  }

  /** Solid scenery that is not harvestable: hay bales (1 tile), silos (2×2). */
  function addScenery(kind, tx, ty, w = 1, h = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!inBounds(tx + i, ty + j) || world.blocked[idx(tx + i, ty + j)]) return null;
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) block(tx + i, ty + j, 1);
    const p = { kind, si: rng.int(0, 2), rot: 0, x: (tx + w / 2) * TILE, y: (ty + h / 2) * TILE };
    world.props.push(p);
    return p;
  }
  const hay = (tx, ty) => addScenery('hay', tx, ty);
  const silo = (tx, ty) => addScenery('silo', tx, ty, 2, 2);

  // ======================================================================
  //                                THE TOWN
  // ======================================================================
  // Coordinates here are the original town's, shifted by (+80, +80).

  // ------------------------------------------------------ district: camp --
  // The starting crossroads: a couple of shacks, a wreck, and easy pickings.
  {
    const i1 = building(150, 150, 8, 7, { doors: 1 });
    stock(i1, 'house', 4);
    const i2 = building(164, 164, 7, 6, { doors: 1 });
    stock(i2, 'house', 4);
    const i3 = building(148, 166, 9, 6, { doors: 2 });
    stock(i3, 'house', 5);
  }

  // ---------------------------------------------------- district: suburbs --
  {
    const lots = [
      [90, 90, 13, 10], [108, 88, 12, 9], [126, 90, 14, 11],
      [90, 110, 12, 10], [110, 110, 15, 11], [130, 112, 12, 9],
      [92, 128, 14, 11], [114, 130, 13, 10], [132, 130, 12, 9],
      [88, 146, 12, 9], [120, 146, 11, 8],
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
      [178, 88, 14, 11], [198, 88, 13, 10], [216, 90, 13, 11],
      [178, 106, 12, 10], [198, 106, 14, 11], [216, 108, 13, 10],
      [180, 122, 15, 8], [202, 122, 14, 8], [220, 122, 10, 8],
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
    const conv = building(174, 138, 16, 12, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 2] });
    stock(conv, 'store', 11);
    fill(174, 151, 16, 4, T.LOT);

    // Hardware store — the wood/scrap jackpot for early base building.
    const hard = building(196, 136, 20, 14, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 3], rooms: true });
    stock(hard, 'hardware', 14);
    fill(196, 151, 20, 5, T.LOT);
    addCar(200, 152, 0); addCar(208, 152, 0);

    // Electronics / pawn shop
    const pawn = building(220, 138, 12, 11, { floor: T.FLOOR_TILE, doors: 1 });
    stock(pawn, 'pawn', 8);

    // Strip-mall parking
    fill(172, 162, 60, 6, T.LOT);
    for (let i = 0; i < 7; i++) addCar(174 + i * 8, 163, 0);
  }

  // -------------------------------------------------- district: fuel stop --
  {
    const shop = building(110, 164, 11, 8, { floor: T.FLOOR_TILE, doors: 1, doorSides: [1] });
    stock(shop, 'store', 7);
    fill(110, 173, 24, 8, T.LOT);
    // Canopy pumps
    for (let i = 0; i < 4; i++) addContainer(114 + i * 4, 176, 'fuelPump');
    addCar(124, 174, 0); addCar(128, 179, 0);
    addWreck(120, 179);
  }

  // ---------------------------------------------------- district: police --
  {
    const main = building(180, 178, 24, 18, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 2], rooms: true });
    stock(main, 'police', 14);
    // Armoury annex — safes behind a second wall
    const arm = building(206, 180, 10, 9, { floor: T.FLOOR_TILE, doors: 1, doorSides: [2] });
    stock(arm, ['gunSafe', 'gunSafe', 'policeLocker', 'footlocker'], 6);
    // Motor pool
    fill(180, 198, 30, 6, T.LOT);
    for (let i = 0; i < 5; i++) addCar(182 + i * 6, 199, 0);
    // Sandbag line at the front
    for (let x = 180; x < 204; x += 1) if (x % 5 !== 0) set(x, 176, T.RUBBLE);
  }

  // -------------------------------------------------- district: hospital --
  {
    const main = building(94, 192, 30, 22, { floor: T.FLOOR_TILE, doors: 3, doorSides: [0, 2, 3], rooms: true });
    stock(main, ['pharmacy', 'hospitalCrate'], 4);   // the dispensary, guaranteed
    stock(main, 'hospital', 14);
    const wing = building(96, 218, 20, 10, { floor: T.FLOOR_TILE, doors: 1 });
    stock(wing, 'hospital', 8);
    fill(126, 196, 10, 18, T.LOT);
    addWreck(128, 200); addCar(128, 208, 0);
  }

  // ------------------------------------------------ district: industrial --
  {
    const warehouse = building(144, 200, 26, 20, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 3] });
    stock(warehouse, 'industrial', 15);
    // Interior storage rows made of rubble stacks
    for (let y = 206; y < 216; y += 4) for (let x = 148; x < 166; x++) if (x % 7 !== 0) set(x, y, T.RUBBLE);
    fill(144, 222, 26, 8, T.LOT);
    addWreck(148, 224); addCar(156, 224, 0); addWreck(164, 225);
  }

  // -------------------------------------------------- district: military --
  {
    // Fenced compound with a single vehicle gate.
    const cx = 206, cy = 206, cw = 28, ch = 28;
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

  // ======================================================================
  //                        THE COUNTRY — west of the river
  // ======================================================================

  // ------------------------------------------------------ district: farms --
  {
    // North farmstead, above the north road.
    let h = building(8, 74, 12, 9, { doors: 1, doorSides: [3], rooms: true });
    stock(h, 'house', 7);
    let b = building(34, 72, 14, 10, { floor: T.DIRT, doors: 1, doorSides: [2], doorWidth: 3 });
    stock(b, 'barn', 8);
    silo(49, 73);
    for (let i = 0; i < 5; i++) hay(36 + i * 2 + rng.int(0, 1), 84 + rng.int(0, 1));
    addCar(22, 84, 0);                       // the farm truck
    field(6, 88, 20, 12);
    field(34, 88, 16, 12);
    // Windbreak: a row of trees between the north fields and the middle ones.
    for (let x = 6; x < 52; x += 2) if (x < 27 || x > 31) plantTree(x, 102, rng.chance(0.4));
    // A fenced paddock with the winter's hay.
    fenceRect(34, 106, 16, 9, [[41, 106], [42, 106]]);
    for (let i = 0; i < 4; i++) hay(37 + i * 3, 110);
    field(4, 126, 22, 14);
    field(34, 118, 16, 24);
    // Feed store on the highway, with drums out back and a lot out front.
    const feed = building(34, 146, 14, 9, { floor: T.FLOOR_TILE, doors: 2, doorSides: [1, 2] });
    stock(feed, 'farmstore', 9);
    fill(32, 155, 18, 2, T.LOT);
    addContainer(49, 148, 'fuelDrum'); addContainer(49, 150, 'fuelDrum');
    addCar(36, 155, 0); addCar(44, 155, 0);
    // South farmstead, below the highway.
    h = building(8, 170, 11, 8, { doors: 1, doorSides: [3], rooms: true });
    stock(h, 'house', 6);
    b = building(36, 168, 12, 9, { floor: T.DIRT, doors: 1, doorSides: [2], doorWidth: 3 });
    stock(b, 'barn', 7);
    silo(49, 169);
    const coop = building(22, 170, 5, 4, { doors: 1, doorSides: [1] });
    stock(coop, ['cabinet', 'crate'], 1);
    field(4, 182, 22, 14);
    field(32, 182, 18, 12);
    for (let i = 0; i < 4; i++) hay(34 + i * 3, 196);
    for (let x = 6; x < 52; x += 2) if (x < 27 || x > 31) plantTree(x, 200, rng.chance(0.4));
  }

  // ------------------------------------------------------ district: ranch --
  {
    const h = building(8, 212, 12, 8, { doors: 1, doorSides: [3], rooms: true });
    stock(h, 'house', 6);
    const stable = building(32, 208, 16, 8, { floor: T.DIRT, doors: 2, doorSides: [1, 2], doorWidth: 3 });
    stock(stable, 'barn', 8);
    addCar(22, 220, 0);
    // The big paddock, with the stock pond inside it and gates on two sides.
    fenceRect(6, 224, 44, 28, [[28, 224], [29, 224], [30, 224], [6, 236], [6, 237]]);
    for (let i = 0; i < 7; i++) hay(9 + rng.int(0, 38), 228 + rng.int(0, 21));
    clearing(6, 224, 44, 28);
    // The lane ends here, at the paddock gate.
  }

  // ---------------------------------------------------------- the orchard --
  // Rows of fruit trees south of the hospital: a wood farm, if you want one.
  {
    clearing(86, 246, 50, 28);
    for (let y = 250; y < 272; y += 4) for (let x = 88; x < 134; x += 4) {
      if (x >= 104 && x <= 111) continue;   // the west street runs through
      plantTree(x + rng.int(0, 1), y + rng.int(0, 1), false);
    }
    const shed = building(114, 246, 8, 5, { floor: T.DIRT, doors: 1, doorSides: [1] });
    stock(shed, ['logPile', 'toolbox', 'crate'], 2);
  }

  // ======================================================================
  //                        THE FOREST — north of town
  // ======================================================================

  // ------------------------------------------------ district: lumber camp --
  {
    lane(94, 22, 32, 26, T.DIRT);          // the yard
    const mill = building(96, 24, 14, 9, { floor: T.FLOOR_WOOD, doors: 1, doorSides: [1], doorWidth: 3 });
    stock(mill, 'lumber', 8);
    const bunk = building(114, 26, 10, 7, { doors: 1, doorSides: [1] });
    stock(bunk, 'cabin', 5);
    // Log stacks in two rows across the yard.
    for (let i = 0; i < 8; i++) addContainer(96 + i * 2, 38, 'logPile');
    for (let i = 0; i < 7; i++) addContainer(97 + i * 2, 41, 'logPile');
    addContainer(124, 40, 'fuelDrum'); addContainer(124, 42, 'fuelDrum');
    addCar(114, 44, 0);                    // the log truck
    addWreck(120, 46);
  }

  // ------------------------------------------------------- district: lake --
  {
    // The lodge and its boathouse on the south shore; the east street ends
    // between them at a gravel turnaround.
    const lodge = building(174, 44, 13, 8, { doors: 2, doorSides: [0, 1], rooms: true });
    stock(lodge, 'cabin', 8);
    const boat = building(206, 43, 7, 5, { floor: T.FLOOR_WOOD, doors: 1, doorSides: [0] });
    stock(boat, ['crate', 'toolbox', 'footlocker'], 2);
    lane(188, 50, 12, 4);
    addCar(190, 51, 0); addWreck(196, 52);
    // A plank jetty out over the water.
    for (let y = 43; y >= 35; y--) { set(197, y, T.FLOOR_WOOD); set(198, y, T.FLOOR_WOOD); }
    clearing(172, 42, 44, 12);
  }

  // ------------------------------------------------- hunting cabins + trails --
  {
    const cabins = [[24, 20, 7, 6], [140, 12, 7, 6], [228, 30, 7, 6], [46, 46, 6, 5]];
    for (const [x, y, w, h] of cabins) {
      const c = building(x, y, w, h, { doors: 1 });
      stock(c, 'cabin', 3);
      clearing(x - 2, y - 2, w + 4, h + 4);
    }
    trail([[27, 27], [27, 66]]);                    // NW cabin down to the farm lane
    trail([[49, 52], [49, 66]]);                    // riverside cabin to the lane's head
    trail([[143, 19], [143, 30], [156, 30]]);       // mid cabin east to main street
    trail([[231, 37], [231, 60], [239, 60]]);       // east cabin down to the city's edge
    trail([[110, 52], [110, 44]]);                  // yard to the west street's head
    trail([[176, 52], [176, 60], [193, 60]]);       // lodge to the east street
  }

  // ======================================================================
  //                          THE CITY — east of town
  // ======================================================================

  // -------------------------------------------------- district: heights --
  {
    const blocks = [
      [242, 64, 18, 16], [266, 64, 22, 16], [294, 64, 22, 16],
      [242, 90, 18, 14], [266, 90, 22, 14], [294, 90, 22, 14],
      [242, 112, 18, 14], [294, 112, 22, 14],
    ];
    for (const [x, y, w, h] of blocks) {
      const i = building(x, y, w, h, { floor: T.FLOOR_TILE, doors: 2, doorSides: [rng.int(0, 1), rng.int(2, 3)], grid: 6 });
      stock(i, 'apartment', rng.int(9, 13));
    }
    const corner = building(266, 112, 22, 14, { floor: T.FLOOR_TILE, doors: 2, doorSides: [1, 3] });
    stock(corner, 'store', 9);
    // Kerbside cars and the wrecks of people who did not make it out.
    for (const y of [83, 109, 129]) for (let x = 244; x < 316; x += 9) if (rng.chance(0.55)) addCar(x, y, 0); else addWreck(x, y);
  }

  // ------------------------------------------------- district: downtown --
  {
    // Towers either side of the highway, the bank on the corner.
    let t = building(242, 134, 18, 20, { floor: T.FLOOR_TILE, doors: 2, doorSides: [1, 3], grid: 6 });
    stock(t, 'office', 12);
    const bank = building(266, 136, 22, 18, { floor: T.FLOOR_TILE, doors: 2, doorSides: [1, 2], rooms: true });
    stock(bank, ['safe', 'safe', 'safe', 'gunSafe'], 4);   // the vault, guaranteed
    stock(bank, 'bank', 9);
    t = building(294, 134, 24, 20, { floor: T.FLOOR_TILE, doors: 2, doorSides: [1, 2], grid: 7 });
    stock(t, 'office', 13);
    // The army's last stand where the highway enters downtown.
    for (let y = 157; y < 164; y++) if (y !== 160) set(247, y, T.RUBBLE);
    addContainer(249, 156, 'militaryCrate'); addContainer(249, 164, 'militaryCrate'); addContainer(251, 157, 'militaryCrate');
    addWreck(252, 160); addWreck(258, 158); addWreck(244, 162);
    // Plaza: paving, a dead fountain, and the last vending machines in town.
    fill(242, 164, 20, 19, T.LOT);
    for (let y = 170; y < 177; y++) for (let x = 248; x < 256; x++) {
      const dx = (x - 251.5) / 3.5, dy = (y - 173) / 3;
      if (dx * dx + dy * dy < 1) set(x, y, T.WATER);
    }
    addContainer(243, 165, 'vending'); addContainer(260, 165, 'vending'); addContainer(243, 181, 'vending');
    for (let i = 0; i < 6; i++) set(244 + rng.int(0, 16), 165 + rng.int(0, 17), T.RUBBLE);
    t = building(266, 164, 22, 18, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 1], grid: 6 });
    stock(t, 'office', 12);
    // Parking garage: a slab of cars.
    fill(294, 164, 26, 19, T.LOT);
    for (let y = 166; y < 182; y += 4) for (let x = 296; x < 316; x += 5) if (rng.chance(0.5)) addCar(x, y, 0); else if (rng.chance(0.6)) addWreck(x, y);
    // South of the cross-street: city hall and two more towers.
    t = building(242, 188, 18, 24, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 3], grid: 6 });
    stock(t, 'office', 14);
    const hall = building(266, 190, 22, 24, { floor: T.FLOOR_TILE, doors: 3, doorSides: [0, 2, 3], grid: 7 });
    stock(hall, 'office', 15);
    t = building(294, 190, 24, 24, { floor: T.FLOOR_TILE, doors: 2, doorSides: [0, 2], grid: 7 });
    stock(t, 'office', 14);
    // Streets choked with wrecks.
    for (let i = 0; i < 18; i++) {
      const x = rng.int(242, 316), y = rng.pick([131, 132, 159, 160, 161, 185, 186]);
      addWreck(x, y);
    }
    for (const y of [137, 150, 168, 178, 196, 206]) if (rng.chance(0.7)) addWreck(290 + rng.int(0, 2), y);
  }

  // ----------------------------------------------------- district: mall --
  {
    const mall = building(242, 224, 46, 20, { floor: T.FLOOR_TILE, doors: 4, doorSides: [0, 1, 2, 3], doorWidth: 3, grid: 8 });
    stock(mall, 'mall', 22);
    fill(242, 246, 46, 20, T.LOT);
    for (let y = 248; y < 264; y += 4) for (let x = 244; x < 286; x += 5) {
      if (rng.chance(0.45)) addCar(x, y, 0); else if (rng.chance(0.5)) addWreck(x, y);
    }
    const drug = building(294, 226, 22, 12, { floor: T.FLOOR_TILE, doors: 2, doorSides: [1, 2] });
    stock(drug, 'drugstore', 9);
    // The outfitters: the city's gun shop, and the reason to come this far.
    const guns = building(294, 244, 22, 12, { floor: T.FLOOR_TILE, doors: 1, doorSides: [2] });
    stock(guns, 'gunshop', 9);
    fill(294, 258, 22, 6, T.LOT);
    addCar(296, 259, 0); addWreck(304, 260); addCar(310, 259, 0);
  }

  // ======================================================================
  //                        THE SOUTH — the junkyard
  // ======================================================================
  {
    const cx = 166, cy = 250, cw = 48, ch = 42;
    for (let x = cx; x < cx + cw; x++) { set(x, cy, T.WALL); set(x, cy + ch - 1, T.WALL); }
    for (let y = cy; y < cy + ch; y++) { set(cx, y, T.WALL); set(cx + cw - 1, y, T.WALL); }
    fill(cx + 1, cy + 1, cw - 2, ch - 2, T.GRAVEL);
    // Gate on the north wall where the east street ends.
    for (let i = 0; i < 4; i++) set(194 + i, cy, T.GRAVEL);
    const crusher = building(cx + 4, cy + 4, 12, 8, { floor: T.GRAVEL, doors: 1, doorSides: [3] });
    stock(crusher, 'junk', 6);
    const office = building(cx + 34, cy + 4, 10, 7, { floor: T.FLOOR_WOOD, doors: 1, doorSides: [2] });
    stock(office, 'junk', 4);
    // Rows of wrecks with the odd toolbox and drum between them.
    for (let y = cy + 14; y < cy + ch - 4; y += 5) {
      for (let x = cx + 3; x < cx + cw - 4; x += 4) {
        if (rng.chance(0.78)) addWreck(x, y);
        else if (rng.chance(0.5)) addContainer(x, y, rng.pick(['toolbox', 'fuelDrum', 'crate', 'electronics']));
      }
    }
    addCar(cx + 20, cy + 6, 0);
  }

  // ------------------------------------------------ wrecks on the arteries --
  // Roadside wrecks on the main arteries — cover and obstacles.
  for (let i = 0; i < 70; i++) {
    const along = rng.int(4, W - 6);
    const r = rng();
    if (r < 0.3) addWreck(along, 159);                      // the highway
    else if (r < 0.5) addWreck(Math.max(28, along), 107);      // the north road
    else if (r < 0.8) addWreck(159, along);                 // main street
    else addWreck(195, clamp(along, 54, 246));
  }

  // ------------------------------------------------------------ woodland --
  // How likely a random tile is to grow something, by where it is. Trees are
  // the forest's whole character, the town's edges are wooded as they always
  // were, and farmland is open because someone cleared it.
  const inTown = (x, y) => x >= TOWN_X && y >= TOWN_Y && x < TOWN_X + TOWN_W && y < TOWN_Y + TOWN_W;
  function growth(x, y) {
    if (noTree[idx(x, y)]) return 0;
    if (y < 62) return 0.85;                                  // the forest
    if (x >= 240 && y < 272) return 0.03;                     // the city: a street tree
    if (x < 56 && y < 260) return 0.05;                       // farmland
    if (inTown(x, y)) {
      const edge = Math.min(x - TOWN_X, y - TOWN_Y, TOWN_X + TOWN_W - 1 - x, TOWN_Y + TOWN_W - 1 - y);
      return clamp(0.62 - edge / 90, 0.05, 0.62);
    }
    const border = Math.min(x, y, W - 1 - x, W - 1 - y);
    return border < 12 ? 0.7 : 0.4;                           // the outskirts
  }
  /**
   * A bush or a rock: walk-through scenery you can break for fiber, sticks or
   * stone. One per tile, so a swing always has one thing to hit.
   */
  function plantScenery(x, y) {
    if (world.propGrid.has(`${x},${y}`)) return null;
    const bush = rng.chance(0.7);
    const prop = {
      kind: bush ? 'bush' : 'rock', si: rng.int(0, 2), rot: rng.range(0, 6.28), tx: x, ty: y,
      x: (x + 0.5) * TILE, y: (y + 0.5) * TILE,
      hp: bush ? 24 : 45, maxHp: bush ? 24 : 45, harvest: bush ? 'fiber' : 'stone', flash: 0,
    };
    world.props.push(prop);
    world.propGrid.set(`${x},${y}`, prop);
    return prop;
  }

  /**
   * The big stuff: a boulder needs a pickaxe, a thicket needs a scythe. Both
   * are worth several times what the loose scenery beside them gives, which is
   * the whole point of carrying the tool.
   *
   * A boulder blocks — it is a rock the size of a car, and it should break a
   * sight line. A thicket does not; standing in one is how you use it.
   */
  function plantBig(x, y, kind) {
    if (!inBounds(x, y) || world.blocked[idx(x, y)] || world.propGrid.has(`${x},${y}`)) return null;
    const t = world.tiles[idx(x, y)];
    if (t !== T.GRASS && t !== T.DIRT && t !== T.GRAVEL && t !== T.SAND) return null;
    const boulder = kind === 'boulder';
    const prop = {
      kind, si: rng.int(0, 2), rot: boulder ? 0 : rng.range(0, 6.28), tx: x, ty: y,
      x: (x + 0.5) * TILE, y: (y + 0.5) * TILE,
      hp: boulder ? 150 : 90, maxHp: boulder ? 150 : 90,
      harvest: boulder ? 'boulder' : 'thicket', flash: 0,
    };
    if (boulder) block(x, y, 1);
    world.props.push(prop);
    world.propGrid.set(`${x},${y}`, prop);
    return prop;
  }

  function grow(x, y) {
    const t = world.tiles[idx(x, y)];
    if (t !== T.GRASS && t !== T.DIRT) return;
    if (world.blocked[idx(x, y)] || world.propGrid.has(`${x},${y}`)) return;
    const p = growth(x, y);
    if (p <= 0 || !rng.chance(p)) return;
    if (rng.chance(0.72)) plantTree(x, y, rng.chance(y < 62 ? 0.7 : 0.15));
    else plantScenery(x, y);
  }
  for (let i = 0; i < 26000; i++) grow(rng.int(1, W - 2), rng.int(1, W - 2));
  // A second pass over the forest so it is thicker than any town edge.
  for (let i = 0; i < 2600; i++) grow(rng.int(1, W - 2), rng.int(1, 60));

  // Boulders: rocky ground first — the gravel patches, the riverbanks and the
  // forest floor — so "where do I mine?" has a readable answer from the map.
  for (let i = 0; i < 5200; i++) {
    const x = rng.int(2, W - 3), y = rng.int(2, W - 3);
    if (noTree[idx(x, y)]) continue;
    const t = world.tiles[idx(x, y)];
    const rocky = t === T.GRAVEL || t === T.SAND;
    const wild = y < 62 || x < 56 || (x > 236 && y > 272) || Math.min(x, y, W - 1 - x, W - 1 - y) < 20;
    const p = rocky ? 0.34 : wild ? 0.07 : 0.02;
    if (rng.chance(p)) plantBig(x, y, 'boulder');
  }
  // Thickets: the wet and the wild — riverbanks, the forest, hedgerows out on
  // the farm edges. Not in the town, where someone used to mow.
  for (let i = 0; i < 5200; i++) {
    const x = rng.int(2, W - 3), y = rng.int(2, W - 3);
    if (noTree[idx(x, y)]) continue;
    const t = world.tiles[idx(x, y)];
    const damp = t === T.SAND || Math.abs(x - riverCentre(y)) < 12;
    const wild = y < 62 || x < 56 || Math.min(x, y, W - 1 - x, W - 1 - y) < 20;
    const p = damp ? 0.26 : wild ? 0.09 : 0.015;
    if (rng.chance(p)) plantBig(x, y, 'thicket');
  }
  // Reeds along every shore: scenery, not an obstacle.
  for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (world.tiles[idx(x, y)] !== T.SAND || world.blocked[idx(x, y)]) continue;
    if (!rng.chance(0.16)) continue;
    world.props.push({ kind: 'reed', si: rng.int(0, 2), rot: 0, x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
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
      if (t !== T.GRASS && t !== T.DIRT && t !== T.GRAVEL && t !== T.ROAD && t !== T.SIDEWALK && t !== T.FIELD) continue;
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

/** Removes a harvested prop and frees the tile, if it was the thing blocking it. */
export function removeProp(world, prop) {
  const i = world.props.indexOf(prop);
  if (i >= 0) world.props.splice(i, 1);
  world.propGrid.delete(`${prop.tx},${prop.ty}`);
  world.chopped.push(`${prop.tx},${prop.ty}`);
  const solid = prop.kind === 'tree' || prop.kind === 'pine';
  if (solid && prop.tx >= 0 && prop.ty >= 0 && prop.tx < world.w && prop.ty < world.h) {
    world.blocked[prop.ty * world.w + prop.tx] = 0;
  }
}

export const WORLD_PX = WORLD_SIZE;
