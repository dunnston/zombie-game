// Every tunable number and every content definition lives here.
// Pure data + pure helpers, so the balance tests can import it under Node.

export const TILE = 32;
export const WORLD_TILES = 160;
export const WORLD_SIZE = TILE * WORLD_TILES; // 5120px square

// ---------------------------------------------------------------- terrain ---

export const T = {
  GRASS: 0, ROAD: 1, SIDEWALK: 2, DIRT: 3, FLOOR_WOOD: 4,
  WALL: 5, WATER: 6, RUBBLE: 7, LOT: 8, FLOOR_TILE: 9, GRAVEL: 10,
};

export const TERRAIN = {
  [T.GRASS]:      { a: '#38472a', b: '#31402552' },
  [T.ROAD]:       { a: '#2b2c2e', b: '#33343664' },
  [T.SIDEWALK]:   { a: '#474742', b: '#50504b64' },
  [T.DIRT]:       { a: '#463c2d', b: '#4f442f64' },
  [T.FLOOR_WOOD]: { a: '#463726', b: '#50402c64' },
  [T.WALL]:       { a: '#6a6055', b: '#75695c64' },
  [T.WATER]:      { a: '#22384a', b: '#2b445864' },
  [T.RUBBLE]:     { a: '#3a3730', b: '#45413864' },
  [T.LOT]:        { a: '#313236', b: '#3a3b4064' },
  [T.FLOOR_TILE]: { a: '#54544f', b: '#5d5d5764' },
  [T.GRAVEL]:     { a: '#3e3d38', b: '#4a4941aa' },
};

export const SOLID_TILES = new Set([T.WALL, T.WATER]);

// -------------------------------------------------------------- resources ---

// `wt` is weight per unit — carrying capacity is measured in weight, not slot
// count, so a pack full of ammunition is not a pack full of scrap.
// `stack` is how many fit in one inventory slot.
export const RES = {
  wood:   { name: 'Wood',        short: 'WOOD', color: '#a3763f', wt: 1, stack: 50 },
  scrap:  { name: 'Scrap',       short: 'SCRP', color: '#9aa2ab', wt: 1, stack: 50 },
  cloth:  { name: 'Cloth',       short: 'CLTH', color: '#c2a98a', wt: 1, stack: 50 },
  elec:   { name: 'Electronics', short: 'ELEC', color: '#59b8c4', wt: 1, stack: 30 },
  med:    { name: 'Medical',     short: 'MED',  color: '#d9575f', wt: 1, stack: 30 },
  parts:  { name: 'Weapon Parts',short: 'PART', color: '#c9a227', wt: 1, stack: 20 },
  mil:    { name: 'Military',    short: 'MIL',  color: '#7fa14a', wt: 1, stack: 20 },
  fuel:   { name: 'Fuel',        short: 'FUEL', color: '#d2762c', wt: 1, stack: 20 },
  rations:{ name: 'Rations',     short: 'FOOD', color: '#c4a86a', wt: 1, stack: 20 },
  ammoP:  { name: '9mm Rounds',  short: '9MM',  color: '#d8c98a', wt: 0.2, stack: 120 },
  ammoS:  { name: 'Shells',      short: 'SHEL', color: '#c9584e', wt: 0.3, stack: 60 },
  ammoR:  { name: 'Rifle Rounds',short: 'RIFL', color: '#b8a05a', wt: 0.25, stack: 90 },
};

export const RES_IDS = Object.keys(RES);
export const AMMO_IDS = ['ammoP', 'ammoS', 'ammoR'];

/** Total carry weight of a resource bag. */
export function bagWeight(bag) {
  let w = 0;
  for (const id in bag) {
    const def = RES[id];
    if (def) w += bag[id] * def.wt;
  }
  return w;
}

// ---------------------------------------------------------------- weapons ---
// dps figures in comments are approximate, for balance reference.

export const WEAPONS = {
  fists: {
    id: 'fists', name: 'Fists', kind: 'melee', dmg: 9, cd: 0.42,
    range: 34, arc: 1.0, knock: 70, xpMul: 1, color: '#c8b89a',
  },
  pipe: {
    id: 'pipe', name: 'Steel Pipe', kind: 'melee', dmg: 24, cd: 0.40,
    range: 48, arc: 1.15, knock: 150, color: '#9aa2ab',
  },
  machete: {
    id: 'machete', name: 'Machete', kind: 'melee', dmg: 40, cd: 0.34,
    range: 54, arc: 1.0, knock: 110, bleed: true, color: '#cfd6dd',
  },
  sledge: {
    id: 'sledge', name: 'Sledgehammer', kind: 'melee', dmg: 78, cd: 0.86,
    range: 60, arc: 1.7, knock: 340, shake: 5, structureMul: 1.0, color: '#8d7a5e',
  },
  pistol: {
    id: 'pistol', name: 'M9 Pistol', kind: 'gun', dmg: 27, cd: 0.17, mag: 12,
    reload: 1.15, spread: 0.035, ammo: 'ammoP', speed: 1150, life: 0.55,
    knock: 55, shake: 1.6, pellets: 1, threat: 1.0, noise: 420, color: '#71787f',
  },
  smg: {
    id: 'smg', name: 'Scrap SMG', kind: 'gun', dmg: 17, cd: 0.075, mag: 30,
    reload: 1.6, spread: 0.075, ammo: 'ammoP', speed: 1100, life: 0.5,
    knock: 40, shake: 1.2, pellets: 1, threat: 0.6, noise: 400, color: '#6b7178',
  },
  shotgun: {
    id: 'shotgun', name: 'Pump Shotgun', kind: 'gun', dmg: 16, cd: 0.75, mag: 6,
    reload: 0.5, shellReload: true, spread: 0.20, ammo: 'ammoS', speed: 980,
    life: 0.30, knock: 230, shake: 6.5, pellets: 8, threat: 2.4, noise: 620, color: '#5e5148',
  },
  rifle: {
    id: 'rifle', name: 'Hunting Rifle', kind: 'gun', dmg: 78, cd: 0.52, mag: 8,
    reload: 1.9, spread: 0.012, ammo: 'ammoR', speed: 1700, life: 0.9,
    knock: 120, shake: 4.2, pellets: 1, pierce: 2, threat: 2.0, noise: 700, color: '#4c4136',
  },
  carbine: {
    id: 'carbine', name: 'Military Carbine', kind: 'gun', dmg: 36, cd: 0.105, mag: 40,
    reload: 2.3, spread: 0.045, ammo: 'ammoR', speed: 1500, life: 0.8,
    knock: 70, shake: 2.0, pellets: 1, pierce: 1, threat: 1.1, noise: 560, color: '#4a5340',
  },
};

// ------------------------------------------------------------------- gear ---
// Five slots, three tiers each. A full tier-3 set reaches 0.70 damage
// reduction; a full tier-1 set 0.23. Body is far and away the biggest
// contributor, so the vest is still the piece worth hunting, but the other
// four slots are what take you from "survivable" to "armoured".

export const GEAR_SLOTS = ['head', 'body', 'hands', 'legs', 'feet'];

export const GEAR_SLOT_NAMES = {
  head: 'Head', body: 'Body', hands: 'Hands', legs: 'Legs', feet: 'Feet',
};

export const GEAR = {
  // head
  hardHat:    { id: 'hardHat',    name: 'Hard Hat',      slot: 'head',  dr: 0.05, wt: 3, tier: 1, color: '#c9a227' },
  riotHelm:   { id: 'riotHelm',   name: 'Riot Helmet',   slot: 'head',  dr: 0.10, wt: 5, tier: 2, color: '#4d5866' },
  milHelm:    { id: 'milHelm',    name: 'Combat Helmet', slot: 'head',  dr: 0.15, wt: 6, tier: 3, color: '#5b6640' },
  // body — the old armour set, rescaled so it is one slot of five
  lightVest:  { id: 'lightVest',  name: 'Padded Vest',   slot: 'body',  dr: 0.10, wt: 6, tier: 1, color: '#6f7a52' },
  heavyVest:  { id: 'heavyVest',  name: 'Riot Armor',    slot: 'body',  dr: 0.20, wt: 11, tier: 2, color: '#4d5866' },
  milVest:    { id: 'milVest',    name: 'Plate Carrier', slot: 'body',  dr: 0.28, wt: 14, tier: 3, color: '#5b6640' },
  // hands
  workGloves: { id: 'workGloves', name: 'Work Gloves',   slot: 'hands', dr: 0.02, wt: 1, tier: 1, color: '#a3763f' },
  tacGloves:  { id: 'tacGloves',  name: 'Tactical Gloves', slot: 'hands', dr: 0.04, wt: 2, tier: 2, color: '#4d5866' },
  armGuards:  { id: 'armGuards',  name: 'Arm Guards',    slot: 'hands', dr: 0.07, wt: 4, tier: 3, color: '#5b6640' },
  // legs
  denimPants: { id: 'denimPants', name: 'Work Trousers', slot: 'legs',  dr: 0.04, wt: 2, tier: 1, color: '#4a5a72' },
  paddedLegs: { id: 'paddedLegs', name: 'Padded Leggings', slot: 'legs', dr: 0.08, wt: 5, tier: 2, color: '#6f7a52' },
  milGreaves: { id: 'milGreaves', name: 'Combat Trousers', slot: 'legs', dr: 0.12, wt: 7, tier: 3, color: '#5b6640' },
  // feet
  workBoots:  { id: 'workBoots',  name: 'Work Boots',    slot: 'feet',  dr: 0.02, wt: 3, tier: 1, color: '#6b4a2f' },
  combatBoots:{ id: 'combatBoots',name: 'Combat Boots',  slot: 'feet',  dr: 0.05, wt: 4, tier: 2, color: '#3f4a38' },
  milBoots:   { id: 'milBoots',   name: 'Assault Boots', slot: 'feet',  dr: 0.08, wt: 5, tier: 3, color: '#5b6640' },
};

/** No amount of scavenging should make you immune. */
export const MAX_GEAR_DR = 0.72;

export const GEAR_IDS = Object.keys(GEAR);

export const CONSUMABLES = {
  bandage: { id: 'bandage', name: 'Bandage', heal: 28, time: 0.9, color: '#d8cfc0' },
  medkit:  { id: 'medkit',  name: 'Medkit',  heal: 80, time: 1.6, color: '#d9575f' },
  // Not a healing item — used on car doors. Kept here so it rides along in the
  // same inventory the rest of the small stuff uses.
  lockpick: { id: 'lockpick', name: 'Lockpick', heal: 0, time: 0, color: '#9aa2ab', tool: true },
};

// ---------------------------------------------------------------- enemies ---

// `structMul` scales damage against player structures only. Walkers and runners
// are a threat to *you*; brutes are what actually breaches a wall. That split is
// what makes the tier-3 raid feel like a step change.
export const ENEMIES = {
  walker: {
    id: 'walker', name: 'Walker', hp: 58, speed: 60, dmg: 13, atkCd: 1.0,
    atkRange: 26, r: 12, xp: 10, sense: 330, knockResist: 0, structMul: 0.5,
    body: '#5c6b45', dark: '#3d4a2e', threat: 0.35,
  },
  runner: {
    id: 'runner', name: 'Runner', hp: 44, speed: 132, dmg: 11, atkCd: 0.65,
    atkRange: 25, r: 11, xp: 18, sense: 430, knockResist: 0.15, structMul: 0.4,
    body: '#7a5a3c', dark: '#513a26', threat: 0.5,
  },
  brute: {
    id: 'brute', name: 'Brute', hp: 300, speed: 52, dmg: 34, atkCd: 1.35,
    atkRange: 34, r: 19, xp: 55, sense: 380, knockResist: 0.75, structMul: 2.2,
    body: '#6b4b52', dark: '#452f34', threat: 1.1,
  },
  behemoth: {
    id: 'behemoth', name: 'Behemoth', hp: 1100, speed: 46, dmg: 58, atkCd: 1.6,
    atkRange: 44, r: 27, xp: 200, sense: 900, knockResist: 0.95, structMul: 4.0,
    body: '#7d4348', dark: '#4a262b', threat: 2.5, boss: true,
  },
};

// ------------------------------------------------------------- structures ---

export const STRUCTURES = {
  bedroll: {
    id: 'bedroll', name: 'Bedroll', cost: { wood: 15, cloth: 12 }, hp: 90,
    solid: false, tier: 1, threat: 1,
    desc: 'Sets your respawn point. Only the newest one is active.',
  },
  bunk: {
    id: 'bunk', name: 'Bunk', cost: { wood: 22, cloth: 14 }, hp: 140,
    solid: true, tier: 1, threat: 1, protect: true, houses: 1,
    desc: 'Somewhere for one survivor to sleep. No bunk, no recruit.',
  },
  watchtower: {
    id: 'watchtower', name: 'Watchtower', cost: { wood: 45, scrap: 20 }, hp: 420,
    solid: true, tier: 1, threat: 2, protect: true, post: 'sniper',
    sniperRange: 520, sniperDmg: 1.9,
    desc: 'Assign a survivor here and they cover the whole approach.',
  },
  stash: {
    id: 'stash', name: 'Supply Stash', cost: { wood: 25, scrap: 8 }, hp: 220,
    solid: true, tier: 1, threat: 2, protect: true,
    desc: 'Shared storage. Deposit everything with one key.',
  },
  workbench: {
    id: 'workbench', name: 'Workbench', cost: { wood: 30, scrap: 18 }, hp: 300,
    solid: true, tier: 1, threat: 3, protect: true,
    desc: 'Unlocks crafting while you stand near it. Upgradeable.',
  },
  barricade: {
    id: 'barricade', name: 'Barricade', cost: { wood: 8 }, hp: 160,
    solid: true, tier: 1, threat: 0.5, wall: true,
    desc: 'Cheap, fast, and flimsy. Good for funnelling.',
  },
  woodWall: {
    id: 'woodWall', name: 'Wood Wall', cost: { wood: 16 }, hp: 340,
    solid: true, tier: 1, threat: 1, wall: true,
    desc: 'The bread-and-butter wall.',
  },
  reinforcedWall: {
    id: 'reinforcedWall', name: 'Reinforced Wall', cost: { wood: 12, scrap: 22 }, hp: 920,
    solid: true, tier: 1, threat: 1.5, wall: true,
    desc: 'Wood and sheet metal. Buys you real time.',
  },
  metalWall: {
    id: 'metalWall', name: 'Steel Wall', cost: { scrap: 45, parts: 2 }, hp: 2100,
    solid: true, tier: 2, threat: 2, wall: true,
    desc: 'Brutes still get through — eventually.',
  },
  gate: {
    id: 'gate', name: 'Gate', cost: { wood: 22, scrap: 12 }, hp: 560,
    solid: true, tier: 1, threat: 1.5, gate: true,
    desc: 'Stand next to it and press E to open or close.',
  },
  spike: {
    id: 'spike', name: 'Spike Trap', cost: { wood: 12, scrap: 10 }, hp: 200,
    solid: false, tier: 1, threat: 1.5, trap: true, trapDmg: 26, trapCd: 0.55,
    desc: 'Shreds anything that walks over it. Wears out.',
  },
  turret: {
    id: 'turret', name: 'Auto Turret', cost: { scrap: 50, elec: 28, parts: 6 }, hp: 340,
    solid: true, tier: 2, threat: 5, protect: true, powered: true,
    range: 330, dmg: 22, fireCd: 0.28, turretMag: 40, turretReload: 2.2,
    desc: 'Needs a powered Generator within 260px. Eats 9mm from your stash.',
  },
  floodlight: {
    id: 'floodlight', name: 'Floodlight', cost: { scrap: 22, elec: 12 }, hp: 200,
    solid: false, tier: 2, threat: 2, powered: true, lightRadius: 260,
    desc: 'Pushes back the dark. Needs a powered Generator within 260px.',
  },
  generator: {
    id: 'generator', name: 'Generator', cost: { scrap: 38, elec: 16 }, hp: 380,
    solid: true, tier: 2, threat: 4, protect: true, powerRadius: 260,
    fuelBurn: 0.35, fuelMax: 100,
    desc: 'Burns Fuel to power turrets nearby. Loud — raises Threat while running.',
  },
};

export const BUILD_ORDER = [
  'woodWall', 'barricade', 'reinforcedWall', 'metalWall', 'gate', 'spike',
  'workbench', 'stash', 'bedroll', 'bunk', 'watchtower',
  'generator', 'turret', 'floodlight',
];

// --------------------------------------------------------------- crafting ---
// `bench`: 0 = craftable by hand, 1 = needs workbench, 2 = needs upgraded workbench.

export const RECIPES = [
  { id: 'bandage', name: 'Bandage x2', bench: 0, cost: { cloth: 4 }, give: { item: 'bandage', n: 2 }, xp: 3 },
  { id: 'pipe', name: 'Steel Pipe', bench: 1, cost: { wood: 6, scrap: 10 }, give: { weapon: 'pipe' }, xp: 12 },
  { id: 'ammoP', name: '9mm x24', bench: 1, cost: { scrap: 9, parts: 1 }, give: { res: { ammoP: 24 } }, xp: 6 },
  { id: 'medkit', name: 'Medkit', bench: 1, cost: { med: 5, cloth: 5 }, give: { item: 'medkit', n: 1 }, xp: 8 },
  { id: 'machete', name: 'Machete', bench: 1, cost: { scrap: 24, parts: 1 }, give: { weapon: 'machete' }, xp: 25 },
  { id: 'pistol', name: 'M9 Pistol', bench: 1, cost: { scrap: 28, parts: 4 }, give: { weapon: 'pistol' }, xp: 35 },
  { id: 'lightVest', name: 'Padded Vest', bench: 1, cost: { cloth: 22, scrap: 12 }, give: { armor: 'lightVest' }, xp: 25 },
  { id: 'workGloves', name: 'Work Gloves', bench: 0, cost: { cloth: 8 }, give: { armor: 'workGloves' }, xp: 8 },
  { id: 'denimPants', name: 'Work Trousers', bench: 0, cost: { cloth: 14 }, give: { armor: 'denimPants' }, xp: 10 },
  { id: 'workBoots', name: 'Work Boots', bench: 1, cost: { cloth: 10, scrap: 6 }, give: { armor: 'workBoots' }, xp: 12 },
  { id: 'hardHat', name: 'Hard Hat', bench: 1, cost: { scrap: 14 }, give: { armor: 'hardHat' }, xp: 14 },
  { id: 'paddedLegs', name: 'Padded Leggings', bench: 1, cost: { cloth: 24, scrap: 10 }, give: { armor: 'paddedLegs' }, xp: 26 },
  { id: 'ammoS', name: 'Shells x14', bench: 1, cost: { scrap: 12, parts: 1 }, give: { res: { ammoS: 14 } }, xp: 7 },
  { id: 'lockpick', name: 'Lockpicks x3', bench: 1, cost: { scrap: 8, parts: 1 }, give: { item: 'lockpick', n: 3 }, xp: 6 },
  { id: 'rationPack', name: 'Ration Pack x8', bench: 1, cost: { med: 2, cloth: 3 }, give: { res: { rations: 8 } }, xp: 5 },
  { id: 'fuel', name: 'Fuel x25', bench: 1, cost: { scrap: 10, elec: 4 }, give: { res: { fuel: 25 } }, xp: 6 },

  { id: 'sledge', name: 'Sledgehammer', bench: 2, cost: { wood: 18, scrap: 38, parts: 2 }, give: { weapon: 'sledge' }, xp: 45 },
  { id: 'smg', name: 'Scrap SMG', bench: 2, cost: { scrap: 48, parts: 8, elec: 10 }, give: { weapon: 'smg' }, xp: 60 },
  { id: 'shotgun', name: 'Pump Shotgun', bench: 2, cost: { scrap: 44, parts: 6, wood: 12 }, give: { weapon: 'shotgun' }, xp: 60 },
  { id: 'ammoR', name: 'Rifle Rounds x18', bench: 2, cost: { scrap: 14, parts: 2 }, give: { res: { ammoR: 18 } }, xp: 8 },
  { id: 'rifle', name: 'Hunting Rifle', bench: 2, cost: { scrap: 62, parts: 12, mil: 3 }, give: { weapon: 'rifle' }, xp: 90 },
  { id: 'heavyVest', name: 'Riot Armor', bench: 2, cost: { scrap: 46, cloth: 20, mil: 4 }, give: { armor: 'heavyVest' }, xp: 70 },
  { id: 'carbine', name: 'Military Carbine', bench: 2, cost: { scrap: 85, parts: 18, mil: 14, elec: 12 }, give: { weapon: 'carbine' }, xp: 150 },
  { id: 'milVest', name: 'Plate Carrier', bench: 2, cost: { scrap: 40, mil: 12, cloth: 15 }, give: { armor: 'milVest' }, xp: 120 },
];

export const BENCH_UPGRADE_COST = { scrap: 55, elec: 20, parts: 5 };

// ------------------------------------------------------------ loot tables ---
// Each entry: { id, min, max, w }. `id` may be a resource, or 'weapon:<id>' /
// 'item:<id>' / 'armor:<id>' for equipment drops.

export const LOOT = {
  cabinet: [
    { id: 'rations', min: 2, max: 5, w: 18 },
    { id: 'cloth', min: 3, max: 8, w: 30 }, { id: 'wood', min: 4, max: 10, w: 28 },
    { id: 'scrap', min: 2, max: 6, w: 24 }, { id: 'med', min: 1, max: 2, w: 10 },
    { id: 'item:bandage', min: 1, max: 2, w: 8 },
  ],
  kitchen: [
    { id: 'rations', min: 3, max: 8, w: 34 },
    { id: 'cloth', min: 2, max: 6, w: 26 }, { id: 'scrap', min: 3, max: 8, w: 30 },
    { id: 'med', min: 1, max: 3, w: 14 }, { id: 'elec', min: 1, max: 2, w: 10 },
    { id: 'item:bandage', min: 1, max: 1, w: 10 },
  ],
  toolbox: [
    { id: 'scrap', min: 6, max: 14, w: 34 }, { id: 'wood', min: 8, max: 18, w: 30 },
    { id: 'parts', min: 1, max: 2, w: 16 }, { id: 'elec', min: 1, max: 3, w: 12 },
    { id: 'weapon:pipe', min: 1, max: 1, w: 6 },
  ],
  shelf: [
    { id: 'rations', min: 4, max: 10, w: 32 },
    { id: 'cloth', min: 4, max: 10, w: 28 }, { id: 'med', min: 2, max: 5, w: 24 },
    { id: 'scrap', min: 3, max: 7, w: 22 }, { id: 'item:bandage', min: 1, max: 3, w: 16 },
    { id: 'elec', min: 1, max: 3, w: 10 },
  ],
  pharmacy: [
    { id: 'med', min: 5, max: 12, w: 40 }, { id: 'item:medkit', min: 1, max: 2, w: 24 },
    { id: 'item:bandage', min: 2, max: 4, w: 24 }, { id: 'cloth', min: 3, max: 7, w: 12 },
  ],
  electronics: [
    { id: 'elec', min: 5, max: 12, w: 40 }, { id: 'parts', min: 1, max: 3, w: 24 },
    { id: 'scrap', min: 6, max: 14, w: 26 }, { id: 'fuel', min: 5, max: 12, w: 10 },
  ],
  carTrunk: [
    { id: 'scrap', min: 4, max: 10, w: 34 }, { id: 'fuel', min: 4, max: 12, w: 26 },
    { id: 'parts', min: 1, max: 1, w: 14 }, { id: 'cloth', min: 2, max: 5, w: 16 },
    { id: 'elec', min: 1, max: 2, w: 10 },
  ],
  policeLocker: [
    { id: 'ammoP', min: 14, max: 30, w: 30 }, { id: 'ammoS', min: 6, max: 14, w: 20 },
    { id: 'parts', min: 2, max: 4, w: 16 }, { id: 'gear:lightVest', min: 1, max: 1, w: 8 },
    { id: 'gear:heavyVest', min: 1, max: 1, w: 5 }, { id: 'med', min: 2, max: 5, w: 10 },
    { id: 'gear:riotHelm', min: 1, max: 1, w: 7 }, { id: 'gear:tacGloves', min: 1, max: 1, w: 7 },
    { id: 'gear:combatBoots', min: 1, max: 1, w: 6 }, { id: 'gear:paddedLegs', min: 1, max: 1, w: 6 },
  ],
  gunSafe: [
    { id: 'weapon:pistol', min: 1, max: 1, w: 22 }, { id: 'weapon:shotgun', min: 1, max: 1, w: 16 },
    { id: 'weapon:rifle', min: 1, max: 1, w: 8 }, { id: 'ammoP', min: 20, max: 40, w: 22 },
    { id: 'ammoS', min: 10, max: 20, w: 18 }, { id: 'parts', min: 3, max: 6, w: 14 },
  ],
  militaryCrate: [
    { id: 'rations', min: 6, max: 14, w: 14 },
    { id: 'mil', min: 4, max: 10, w: 32 }, { id: 'ammoR', min: 12, max: 26, w: 24 },
    { id: 'parts', min: 3, max: 7, w: 18 }, { id: 'elec', min: 5, max: 12, w: 12 },
    { id: 'weapon:carbine', min: 1, max: 1, w: 4 }, { id: 'armor:milVest', min: 1, max: 1, w: 5 },
    { id: 'item:medkit', min: 1, max: 2, w: 5 },
  ],
  hospitalCrate: [
    { id: 'rations', min: 3, max: 8, w: 12 },
    { id: 'med', min: 8, max: 16, w: 36 }, { id: 'item:medkit', min: 1, max: 3, w: 26 },
    { id: 'elec', min: 3, max: 8, w: 16 }, { id: 'parts', min: 1, max: 3, w: 12 },
    { id: 'mil', min: 1, max: 3, w: 10 },
  ],
  fuelPump: [{ id: 'fuel', min: 12, max: 26, w: 100 }],
  // Palletised stock: bulk building material rather than anything personal.
  crate: [
    { id: 'wood', min: 8, max: 18, w: 30 },
    { id: 'scrap', min: 8, max: 18, w: 30 },
    { id: 'elec', min: 2, max: 6, w: 16 },
    { id: 'parts', min: 1, max: 3, w: 12 },
    { id: 'cloth', min: 4, max: 10, w: 12 },
  ],

  // ------------------------------------------------------------ furniture --
  // Each table should read true to the thing you are opening: a fridge holds
  // food, a wardrobe holds clothes, a tool rack holds tools.
  bookshelf: [
    { id: 'cloth', min: 3, max: 8, w: 34 },      // paper and dust jackets
    { id: 'elec', min: 1, max: 3, w: 16 },       // an old radio, a calculator
    { id: 'rations', min: 1, max: 3, w: 14 },    // someone's hidden snacks
    { id: 'med', min: 1, max: 2, w: 12 },
    { id: 'parts', min: 1, max: 1, w: 8 },
    { id: 'item:bandage', min: 1, max: 2, w: 16 },
  ],
  dresser: [
    { id: 'cloth', min: 5, max: 12, w: 46 },
    { id: 'item:bandage', min: 1, max: 3, w: 20 },
    { id: 'med', min: 1, max: 3, w: 14 },
    { id: 'scrap', min: 1, max: 4, w: 12 },
    { id: 'ammoP', min: 3, max: 8, w: 8 },       // a bedside pistol's spare rounds
  ],
  wardrobe: [
    { id: 'cloth', min: 8, max: 16, w: 46 },
    { id: 'item:bandage', min: 1, max: 3, w: 16 },
    { id: 'gear:lightVest', min: 1, max: 1, w: 5 },
    { id: 'gear:denimPants', min: 1, max: 1, w: 12 },
    { id: 'gear:workBoots', min: 1, max: 1, w: 10 },
    { id: 'gear:hardHat', min: 1, max: 1, w: 6 },
    { id: 'gear:workGloves', min: 1, max: 1, w: 10 },
    { id: 'scrap', min: 1, max: 3, w: 10 },
    { id: 'rations', min: 1, max: 3, w: 8 },
  ],
  desk: [
    { id: 'elec', min: 2, max: 6, w: 34 },
    { id: 'parts', min: 1, max: 2, w: 20 },
    { id: 'cloth', min: 2, max: 5, w: 18 },
    { id: 'scrap', min: 2, max: 6, w: 16 },
    { id: 'ammoP', min: 4, max: 10, w: 12 },
  ],
  filing: [
    { id: 'cloth', min: 4, max: 10, w: 34 },
    { id: 'elec', min: 1, max: 3, w: 18 },
    { id: 'parts', min: 1, max: 2, w: 16 },
    { id: 'ammoP', min: 5, max: 12, w: 18 },
    { id: 'med', min: 1, max: 3, w: 14 },
  ],
  fridge: [
    { id: 'rations', min: 6, max: 14, w: 58 },
    { id: 'med', min: 1, max: 3, w: 20 },
    { id: 'cloth', min: 1, max: 3, w: 12 },
    { id: 'fuel', min: 1, max: 3, w: 10 },
  ],
  nightstand: [
    { id: 'med', min: 2, max: 5, w: 30 },
    { id: 'item:bandage', min: 1, max: 2, w: 22 },
    { id: 'ammoP', min: 4, max: 10, w: 20 },
    { id: 'cloth', min: 1, max: 4, w: 16 },
    { id: 'elec', min: 1, max: 2, w: 12 },
  ],
  vanity: [
    { id: 'med', min: 3, max: 7, w: 44 },
    { id: 'item:bandage', min: 1, max: 3, w: 26 },
    { id: 'cloth', min: 2, max: 6, w: 22 },
    { id: 'item:medkit', min: 1, max: 1, w: 8 },
  ],
  footlocker: [
    { id: 'mil', min: 3, max: 8, w: 28 },
    { id: 'ammoR', min: 8, max: 18, w: 20 },
    { id: 'gear:milVest', min: 1, max: 1, w: 6 },
    { id: 'gear:milHelm', min: 1, max: 1, w: 6 },
    { id: 'gear:armGuards', min: 1, max: 1, w: 6 },
    { id: 'gear:milGreaves', min: 1, max: 1, w: 6 },
    { id: 'gear:milBoots', min: 1, max: 1, w: 6 },
    { id: 'parts', min: 2, max: 5, w: 14 },
    { id: 'item:medkit', min: 1, max: 2, w: 8 },
    { id: 'rations', min: 3, max: 8, w: 6 },
  ],
  vending: [
    { id: 'rations', min: 5, max: 12, w: 62 },
    { id: 'scrap', min: 2, max: 5, w: 22 },
    { id: 'elec', min: 1, max: 2, w: 16 },
  ],
  toolrack: [
    { id: 'parts', min: 2, max: 5, w: 34 },
    { id: 'scrap', min: 6, max: 14, w: 32 },
    { id: 'wood', min: 5, max: 12, w: 22 },
    { id: 'weapon:pipe', min: 1, max: 1, w: 6 },
    { id: 'weapon:machete', min: 1, max: 1, w: 4 },
  ],
  displaycase: [
    { id: 'elec', min: 4, max: 10, w: 34 },
    { id: 'parts', min: 2, max: 5, w: 26 },
    { id: 'weapon:pistol', min: 1, max: 1, w: 10 },
    { id: 'ammoP', min: 10, max: 22, w: 18 },
    { id: 'scrap', min: 3, max: 8, w: 14 },
  ],
};

// Container archetypes: how they look and how many rolls they give.
export const CONTAINERS = {
  cabinet:      { table: 'cabinet', rolls: [1, 2], sprite: 'cabinet', label: 'Cabinet' },
  kitchen:      { table: 'kitchen', rolls: [1, 2], sprite: 'cabinet', label: 'Kitchen Unit' },
  toolbox:      { table: 'toolbox', rolls: [1, 3], sprite: 'toolbox', label: 'Toolbox' },
  shelf:        { table: 'shelf', rolls: [1, 2], sprite: 'shelf', label: 'Shelving' },
  pharmacy:     { table: 'pharmacy', rolls: [2, 3], sprite: 'medcab', label: 'Medicine Cabinet' },
  electronics:  { table: 'electronics', rolls: [2, 3], sprite: 'crate', label: 'Parts Bin' },
  crate:        { table: 'crate', rolls: [1, 3], sprite: 'crate', label: 'Supply Crate' },
  safe:         { table: 'gunSafe', rolls: [2, 3], sprite: 'safe', label: 'Floor Safe' },
  // Personnel lockers: someone's kit, not the armoury.
  locker:       { table: 'dresser', rolls: [1, 2], sprite: 'locker', label: 'Staff Locker' },
  medcab:       { table: 'vanity', rolls: [1, 2], sprite: 'medcab', label: 'Medicine Cabinet' },
  carTrunk:     { table: 'carTrunk', rolls: [1, 2], sprite: 'trunk', label: 'Car Trunk' },
  policeLocker: { table: 'policeLocker', rolls: [2, 3], sprite: 'locker', label: 'Police Locker' },
  gunSafe:      { table: 'gunSafe', rolls: [2, 3], sprite: 'safe', label: 'Gun Safe' },
  militaryCrate:{ table: 'militaryCrate', rolls: [3, 4], sprite: 'milcrate', label: 'Military Crate' },
  hospitalCrate:{ table: 'hospitalCrate', rolls: [2, 4], sprite: 'medcab', label: 'Supply Cabinet' },
  fuelPump:     { table: 'fuelPump', rolls: [1, 2], sprite: 'pump', label: 'Fuel Pump' },

  bookshelf:    { table: 'bookshelf', rolls: [1, 2], sprite: 'bookshelf', label: 'Bookshelf' },
  dresser:      { table: 'dresser', rolls: [1, 2], sprite: 'dresser', label: 'Dresser' },
  wardrobe:     { table: 'wardrobe', rolls: [1, 3], sprite: 'wardrobe', label: 'Wardrobe' },
  desk:         { table: 'desk', rolls: [1, 2], sprite: 'desk', label: 'Desk' },
  filing:       { table: 'filing', rolls: [1, 3], sprite: 'filing', label: 'Filing Cabinet' },
  fridge:       { table: 'fridge', rolls: [1, 2], sprite: 'fridge', label: 'Refrigerator' },
  nightstand:   { table: 'nightstand', rolls: [1, 1], sprite: 'nightstand', label: 'Nightstand' },
  vanity:       { table: 'vanity', rolls: [1, 2], sprite: 'vanity', label: 'Bathroom Vanity' },
  footlocker:   { table: 'footlocker', rolls: [2, 3], sprite: 'footlocker', label: 'Footlocker' },
  vending:      { table: 'vending', rolls: [2, 3], sprite: 'vending', label: 'Vending Machine' },
  toolrack:     { table: 'toolrack', rolls: [1, 3], sprite: 'toolrack', label: 'Tool Rack' },
  displaycase:  { table: 'displaycase', rolls: [2, 3], sprite: 'displaycase', label: 'Display Case' },
};

/**
 * What furnishes each kind of building, as weighted picks. Placement uses these
 * so a house fills with beds and wardrobes while a precinct fills with lockers
 * and filing cabinets — the point being that you learn to read a building's
 * exterior and know what is worth searching inside.
 */
export const FURNISHING = {
  house: [
    ['cabinet', 12], ['dresser', 14], ['wardrobe', 12], ['bookshelf', 12],
    ['nightstand', 12], ['fridge', 9], ['kitchen', 9], ['vanity', 8],
    ['desk', 6], ['toolbox', 4], ['shelf', 4],
  ],
  store: [
    ['shelf', 26], ['vending', 14], ['displaycase', 10], ['fridge', 12],
    ['kitchen', 8], ['cabinet', 8], ['filing', 6], ['pharmacy', 8], ['desk', 6],
  ],
  hardware: [
    ['toolrack', 24], ['toolbox', 22], ['shelf', 18], ['crate', 14],
    ['displaycase', 8], ['desk', 6], ['filing', 4],
  ],
  pawn: [
    ['displaycase', 30], ['electronics', 24], ['shelf', 14], ['desk', 12],
    ['filing', 8], ['safe', 6],
  ],
  police: [
    ['policeLocker', 24], ['filing', 20], ['locker', 14], ['desk', 14],
    ['gunSafe', 8], ['vending', 6], ['shelf', 6], ['footlocker', 6],
  ],
  hospital: [
    ['pharmacy', 24], ['hospitalCrate', 20], ['medcab', 16], ['vanity', 10],
    ['filing', 8], ['desk', 8], ['vending', 6], ['fridge', 6], ['bookshelf', 4],
  ],
  industrial: [
    ['electronics', 24], ['crate', 20], ['toolrack', 16], ['toolbox', 14],
    ['filing', 8], ['desk', 8], ['shelf', 6],
  ],
  military: [
    ['militaryCrate', 26], ['footlocker', 24], ['gunSafe', 10], ['filing', 8],
    ['desk', 8], ['electronics', 8], ['vending', 4],
  ],
};

// ------------------------------------------------------------- progression ---

/**
 * XP to go from `level` to the next one.
 *
 * The first playtest reached level 7 in about ten minutes, which spent the
 * whole attribute tree before the player had seen the map. The shape wanted is
 * "the first few come quickly, then it bites": levels 2 and 3 are cheaper than
 * they used to be, and by level 7 the run costs roughly two and a half times
 * what it did. The old curve's 1.7 exponent on a small coefficient was too
 * close to linear to ever slow down.
 */
export function xpForLevel(level) {
  return Math.floor(55 + 45 * Math.pow(level - 1, 2.35));
}

export const UPGRADES = [
  { id: 'tough', cat: 'COMBAT', name: 'Thick Skin', desc: '+28 Max Health, healed instantly', max: 5,
    apply: (p) => { p.maxHp += 28; p.hp += 28; } },
  { id: 'brawler', cat: 'COMBAT', name: 'Brawler', desc: '+30% melee damage', max: 4,
    apply: (p) => { p.meleeMul += 0.30; } },
  { id: 'gunslinger', cat: 'COMBAT', name: 'Gunslinger', desc: '+22% firearm damage', max: 4,
    apply: (p) => { p.gunMul += 0.22; } },
  { id: 'fasthands', cat: 'COMBAT', name: 'Fast Hands', desc: '-25% reload time', max: 3,
    apply: (p) => { p.reloadMul *= 0.75; } },
  { id: 'gunsmith', cat: 'COMBAT', name: 'Trigger Discipline', desc: '+15% fire rate, -20% recoil', max: 3,
    apply: (p) => { p.fireRateMul *= 0.87; p.spreadMul *= 0.80; } },

  { id: 'scavenger', cat: 'SCAVENGING', name: 'Scavenger', desc: '+35% resources from containers', max: 4,
    apply: (p) => { p.lootMul += 0.35; } },
  { id: 'packrat', cat: 'SCAVENGING', name: 'Pack Rat', desc: '+80 carry capacity', max: 4,
    apply: (p) => { p.carryCap += 80; } },
  { id: 'quickhands', cat: 'SCAVENGING', name: 'Quick Search', desc: '-45% search time, +20% pickup range', max: 2,
    apply: (p) => { p.searchMul *= 0.55; p.pickupRange += 20; } },

  { id: 'engineer', cat: 'BUILDING', name: 'Engineer', desc: '-25% structure cost', max: 3,
    apply: (p) => { p.buildCostMul *= 0.75; } },
  { id: 'fortifier', cat: 'BUILDING', name: 'Fortifier', desc: '+45% structure health', max: 4,
    apply: (p) => { p.structHpMul += 0.45; } },
  { id: 'gunner', cat: 'BUILDING', name: 'Fire Control', desc: '+30% turret damage and range', max: 3,
    apply: (p) => { p.turretMul += 0.30; } },

  { id: 'marathon', cat: 'SURVIVAL', name: 'Marathon', desc: '+45 stamina, faster recovery', max: 4,
    apply: (p) => { p.maxStam += 45; p.stam = p.maxStam; p.stamRegen += 5; } },
  { id: 'fleet', cat: 'SURVIVAL', name: 'Fleet Footed', desc: '+11% movement speed', max: 4,
    apply: (p) => { p.speedMul += 0.11; } },
  { id: 'medic', cat: 'SURVIVAL', name: 'Field Medic', desc: '+60% healing, heal 40% faster', max: 3,
    apply: (p) => { p.healMul += 0.60; p.healSpeedMul *= 0.60; } },
  { id: 'lowprofile', cat: 'SURVIVAL', name: 'Low Profile', desc: '-25% Threat generated, quieter', max: 3,
    apply: (p) => { p.threatMul *= 0.75; p.noiseMul *= 0.75; } },
];

// ----------------------------------------------------------------- threat ---

export const THREAT = {
  max: 100,
  // Decay has to be slower than a scavenging run generates, or the meter never
  // moves for a player who explores instead of building — which would gut the
  // "your activity summons the horde" premise. ~7/min bleed-off still makes
  // deliberately lying low a real option.
  decayPerSec: 0.12,
  killWalk: 0.35,
  perGunshot: 1.0,            // scaled per-weapon by WEAPONS[].threat
  perBuild: 1.0,              // scaled per-structure by STRUCTURES[].threat
  perCraft: 0.4,
  perLoot: 0.45,
  generatorPerSec: 0.55,
  turretPerShot: 0.06,
  postRaidReset: 14,
  warnAt: [40, 70, 90],
};

export const RAIDS = [
  // Raid 1 — a scare, not a threat.
  { name: 'SCATTERED HORDE', waves: 2, base: 8, growth: 3, mix: { walker: 1 }, reward: { scrap: 30, wood: 30, parts: 2 }, xp: 120 },
  // Raid 2 — runners force you to actually aim.
  { name: 'RUNNING HORDE', waves: 3, base: 11, growth: 4, mix: { walker: 0.65, runner: 0.35 }, reward: { scrap: 45, parts: 3, elec: 10 }, xp: 220 },
  // Raid 3 — first brute; walls start mattering.
  { name: 'HEAVY HORDE', waves: 3, base: 14, growth: 5, mix: { walker: 0.55, runner: 0.3, brute: 0.15 }, reward: { scrap: 60, parts: 5, elec: 15, mil: 3 }, xp: 360 },
  // Raid 4+
  { name: 'SIEGE', waves: 4, base: 18, growth: 6, mix: { walker: 0.45, runner: 0.33, brute: 0.22 }, reward: { scrap: 80, parts: 7, elec: 20, mil: 6 }, xp: 520 },
  { name: 'BEHEMOTH SIEGE', waves: 4, base: 22, growth: 7, mix: { walker: 0.4, runner: 0.32, brute: 0.25, behemoth: 0.03 }, reward: { scrap: 110, parts: 10, elec: 28, mil: 12 }, xp: 800 },
];

/** Raids past the authored list keep scaling instead of stopping. */
export function raidSpec(index) {
  if (index < RAIDS.length) return RAIDS[index];
  const last = RAIDS[RAIDS.length - 1];
  const over = index - RAIDS.length + 1;
  return {
    ...last,
    name: `BEHEMOTH SIEGE +${over}`,
    base: last.base + over * 5,
    growth: last.growth + over,
    xp: Math.round(last.xp * (1 + over * 0.35)),
    reward: Object.fromEntries(Object.entries(last.reward).map(([k, v]) => [k, Math.round(v * (1 + over * 0.3))])),
  };
}

// ----------------------------------------------------------------- player ---

export const PLAYER = {
  maxHp: 100,
  r: 13,
  speed: 176,
  sprintMul: 1.62,
  maxStam: 100,
  stamDrain: 26,
  stamRegen: 20,
  stamRegenDelay: 0.65,
  carryCap: 200,
  // The grid is generous enough that weight is normally what stops you, but
  // finite enough that carrying thirty kinds of thing still has a cost.
  invSlots: 30,
  hotbarSlots: 6,
  pickupRange: 46,
  interactRange: 76,
  searchTime: 1.05,
  invulnAfterHit: 0.32,
  respawnTime: 3.0,
};

// viewHeight is measured in CSS pixels of world height on screen; the camera
// multiplies by devicePixelRatio so a HiDPI display shows the same framing.
export const CAMERA = { follow: 7.5, viewHeight: 580, minZoom: 0.9, maxZoom: 2.6 };
