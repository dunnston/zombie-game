/**
 * Raid balance harness. Injected by the browser test rig, not shipped logic.
 *
 * Builds a standard walled compound, forces a raid of a given tier, plays the
 * player as a competent-but-not-superhuman defender, and reports how the raid
 * actually went. Used to tune raid pacing and wall/enemy numbers.
 */
(function install() {
  const D = () => window.DEADLINE;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function clearLevelUp() {
    const { G, api } = D();
    let g = 0;
    while (G.ui.panel === 'levelup' && G.ui.levelChoices && g++ < 30) {
      api.chooseUpgrade(G.ui.levelChoices[0].id);
    }
    G.ui.panel = null;
  }

  /** Finds a fully clear NxN tile plot — no trees, walls, cars or containers. */
  function findClearPlot(G, n) {
    const W = G.world.w;
    const clear = (tx, ty) => {
      for (let j = -n; j <= n; j++) {
        for (let i = -n; i <= n; i++) {
          const x = tx + i, y = ty + j;
          if (x < 2 || y < 2 || x >= W - 2 || y >= W - 2) return false;
          if (G.world.blocked[y * W + x]) return false;
        }
      }
      return true;
    };
    for (let ty = 8; ty < W - 8; ty += 2) {
      for (let tx = 8; tx < W - 8; tx += 2) {
        if (G.world.danger[ty * W + tx] > 2) continue;
        if (clear(tx, ty)) return { tx, ty };
      }
    }
    return { tx: 80, ty: 80 };
  }

  /** Builds a representative mid-game base on genuinely open ground. */
  window.buildTestBase = async function buildTestBase(raidIndex, opts = {}) {
    const d = D(), G = d.G;
    d.newGame(20240917);
    d.giveAll();
    d.god(!!opts.god);
    const plot = findClearPlot(G, 7);
    d.teleport(plot.tx * 32 + 16, plot.ty * 32 + 16);
    await wait(400); clearLevelUp();
    d.teleport(plot.tx * 32 + 16, plot.ty * 32 + 16);
    await wait(200); clearLevelUp();

    const p = G.player;
    G.benchTier = 2;
    G.raidsDone = raidIndex;
    const tx = Math.floor(p.x / 32), ty = Math.floor(p.y / 32);
    const put = (t, x, y) => (d.api.canPlace(t, x, y).ok ? d.api.placeStructure(t, x, y) : null);

    for (let i = -5; i <= 5; i++) {
      if (i !== 0) { put('woodWall', tx + i, ty - 5); put('woodWall', tx + i, ty + 5); }
    }
    for (let j = -4; j <= 4; j++) {
      if (j !== 0) { put('reinforcedWall', tx - 5, ty + j); put('reinforcedWall', tx + 5, ty + j); }
    }
    put('gate', tx, ty - 5); put('gate', tx, ty + 5);
    put('gate', tx - 5, ty); put('gate', tx + 5, ty);
    for (let i = -2; i <= 2; i++) put('spike', tx + i, ty - 6);
    put('workbench', tx - 3, ty - 2);
    put('stash', tx - 3, ty + 2);
    put('bedroll', tx + 3, ty + 3);
    const gen = put('generator', tx + 3, ty - 3);
    put('turret', tx + 2, ty - 1);
    put('turret', tx - 2, ty + 1);
    if (gen) gen.fuel = 100;
    clearLevelUp();

    G.stash.ammoP = 600;
    d.api.slotsAdd(p.hotbar, 'shotgun', 1);
    p.mag.shotgun = 6;
    d.api.slotsAdd(p.bag, 'ammoS', 80);
    d.api.slotsAdd(p.bag, 'bandage', 8);
    d.api.slotsAdd(p.bag, 'medkit', 3);
    d.api.selectSlot(p, p.hotbar.slots.findIndex((s) => s && s.id === 'shotgun'));

    d.setThreat(100);
    await wait(300); clearLevelUp();
    if (G.raid) G.raid.timer = 0.2;
    await wait(300); clearLevelUp();
    return G.structures.length;
  };

  /**
   * Walks the player one second back towards the base on foot. Without this the
   * harness silently stops measuring after the first death: the player respawns
   * across the map, never finds a target within 250px again, and every
   * remaining sample is a flat line that looks like a stalled raid.
   */
  async function walkTowards(d, G, x, y) {
    const p = G.player;
    const dx = x - p.x, dy = y - p.y;
    const keys = [];
    if (Math.abs(dx) > 40) keys.push(dx > 0 ? 'KeyD' : 'KeyA');
    if (Math.abs(dy) > 40) keys.push(dy > 0 ? 'KeyS' : 'KeyW');
    if (!keys.length) { await wait(1000); return; }
    for (const k of keys) d.key(k, true);
    d.key('ShiftLeft', true);
    await wait(1000);
    for (const k of keys) d.key(k, false);
    d.key('ShiftLeft', false);
  }

  /** Plays the raid out, shooting the nearest in-range enemy each tick. */
  window.playRaid = async function playRaid(maxSeconds = 120) {
    const d = D(), G = d.G;
    let p = G.player;
    const startStructures = G.structures.length;
    const home = G.raid ? { x: G.raid.cx, y: G.raid.cy } : { x: p.x, y: p.y };
    const log = [];
    let sec = 0;

    for (let i = 0; i < maxSeconds; i++) {
      p = G.player;
      const target = G.enemies
        .filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 250)
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (target) {
        d.aimAt(target.x, target.y);
        await wait(50);
        d.mouseDown();
        await wait(700);
        d.mouseUp();
        await wait(250);
      } else if (!p.dead && Math.hypot(p.x - home.x, p.y - home.y) > 200) {
        // Died and respawned somewhere else — head back to the fight.
        await walkTowards(d, G, home.x, home.y);
      } else {
        await wait(1000);
      }
      sec++;
      clearLevelUp();
      if (p.hp < p.maxHp * 0.4) { d.tap('KeyQ'); }

      if (i % 5 === 0 || !G.raid) {
        const walls = G.structures.filter((s) => s.def.wall || s.def.gate);
        log.push({
          s: sec,
          wave: G.raid ? G.raid.wave : 'done',
          alive: G.enemies.filter((e) => e.raid && !e.dead).length,
          killed: G.raid ? G.raid.killed : '-',
          lost: startStructures - G.structures.length,
          minWall: walls.length ? Math.min(...walls.map((s) => Math.round((s.hp / s.maxHp) * 100))) : 0,
          hp: Math.round(p.hp),
        });
      }
      if (!G.raid) break;
    }

    const surviving = new Set(G.structures.map((s) => s.type));
    return {
      seconds: sec,
      completed: !D().G.raid,
      raidsDone: G.raidsDone,
      structuresLost: startStructures - G.structures.length,
      keptWorkbench: surviving.has('workbench'),
      keptGenerator: surviving.has('generator'),
      keptTurret: surviving.has('turret'),
      playerHp: Math.round(p.hp),
      deaths: G.stats.deaths,
      log,
      errors: d.errors,
    };
  };
}());
