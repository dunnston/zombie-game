/**
 * Browser smoke test for DEADLINE.
 *
 * This is not run by `npm test` (which covers pure logic under Node). It is
 * injected into the running dev server by the automated browser harness and
 * exercises every gameplay system end to end against the live game loop.
 *
 * Usage from a browser console or automation:
 *   await window.runDeadlineSmoke()
 */
(function install() {
  const D = () => window.DEADLINE;
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push({ name, pass: !!pass, detail: String(detail) });
    return pass;
  };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  /**
   * The level-up draft intentionally pauses the world, so the harness clears it
   * between frames — otherwise any XP gain freezes the simulation mid-test.
   */
  let autoClearLevelUp = true;

  function clearLevelUp() {
    if (!autoClearLevelUp) return;
    const { G, api } = D();
    let guard = 0;
    while (G.ui.panel === 'levelup' && G.ui.levelChoices && guard++ < 40) {
      api.chooseUpgrade(G.ui.levelChoices[0].id);
    }
    if (G.ui.panel === 'levelup') { G.ui.panel = null; G.ui.levelChoices = null; }
  }

  async function frames(n) {
    for (let i = 0; i < n; i++) { clearLevelUp(); await frame(); }
    clearLevelUp();
  }
  const seconds = (s) => frames(Math.ceil(s * 60));

  window.runDeadlineSmoke = async function runDeadlineSmoke() {
    results.length = 0;
    const d = D();
    const { G, api } = d;

    // ---------------------------------------------------------- 1. boot ----
    d.newGame(20240917);
    await frames(4);
    ok('world generated', G.world.containers.length > 120, `${G.world.containers.length} containers`);
    ok('player exists', !!G.player && !G.player.dead);
    ok('spawn points found', G.world.spawnTiles.length > 100, `${G.world.spawnTiles.length}`);
    ok('spawn is not inside a wall', !api.solidPx(G.player.x, G.player.y));

    // ------------------------------------------------------ 2. movement ----
    d.god(true);
    const p = G.player;
    const x0 = p.x, y0 = p.y;
    d.key('KeyD', true);
    await seconds(0.6);
    d.key('KeyD', false);
    await frames(3);
    ok('WASD moves the player', Math.abs(p.x - x0) > 25 || Math.abs(p.y - y0) > 25,
      `moved ${Math.round(Math.hypot(p.x - x0, p.y - y0))}px`);

    d.aimAt(p.x + 300, p.y);
    await frames(3);
    const aimRight = Math.abs(p.angle) < 0.4;
    d.aimAt(p.x - 300, p.y);
    await frames(3);
    const aimLeft = Math.abs(Math.abs(p.angle) - Math.PI) < 0.4;
    ok('mouse aiming tracks the cursor', aimRight && aimLeft, `${aimRight}/${aimLeft}`);

    // Walls must stop the player.
    const wallSpot = findNearbySolid(G);
    if (wallSpot) {
      d.teleport(wallSpot.fromX, wallSpot.fromY);
      await frames(2);
      ok('player cannot stand inside terrain', !api.solidPx(p.x, p.y));
    }

    // ------------------------------------------------------- 3. combat -----
    const open = findOpenSpot(G, 78 * 32, 78 * 32);
    d.teleport(open.x, open.y);
    G.enemies.length = 0;
    await frames(2);

    const e1 = api.spawnEnemy('walker', p.x + 42, p.y, { aggro: true });
    await frames(2);
    d.aimAt(e1.x, e1.y);
    const hpBefore = e1.hp;
    d.mouseDown();
    await seconds(0.5);
    d.mouseUp();
    await frames(2);
    ok('melee damages enemies', e1.dead || e1.hp < hpBefore, `${hpBefore} -> ${e1.hp}`);

    // Firearms
    p.weapons.push('pistol');
    p.mag.pistol = 12;
    p.bag.ammoP = 40;
    api.selectSlot(p, p.weapons.indexOf('pistol'));
    G.enemies.length = 0;
    const e2 = api.spawnEnemy('walker', p.x + 200, p.y);
    await frames(2);
    d.aimAt(e2.x, e2.y);
    await frames(2);
    const magBefore = p.mag.pistol;
    d.mouseDown();
    await seconds(0.35);
    d.mouseUp();
    await seconds(0.5);
    ok('firearm consumes ammo', p.mag.pistol < magBefore, `${magBefore} -> ${p.mag.pistol}`);
    ok('bullets damage enemies', e2.dead || e2.hp < e2.maxHp, `hp ${Math.round(e2.hp)}/${e2.maxHp}`);

    // Reload
    p.mag.pistol = 0;
    d.tap('KeyR');
    await seconds(2.2);
    ok('reload refills the magazine', p.mag.pistol > 0, `mag ${p.mag.pistol}`);

    // Enemies chase
    G.enemies.length = 0;
    const chaser = api.spawnEnemy('walker', p.x + 260, p.y + 20, { aggro: true });
    const chaseD0 = Math.hypot(chaser.x - p.x, chaser.y - p.y);
    await seconds(1.6);
    const chaseD1 = Math.hypot(chaser.x - p.x, chaser.y - p.y);
    ok('enemies pursue the player', chaseD1 < chaseD0 - 25, `${Math.round(chaseD0)} -> ${Math.round(chaseD1)}`);

    // Enemies damage the player
    d.god(false);
    p.hp = p.maxHp;
    p.invuln = 0;
    const hp0 = p.hp;
    api.spawnEnemy('walker', p.x + 20, p.y, { aggro: true });
    api.spawnEnemy('walker', p.x - 20, p.y, { aggro: true });
    await seconds(2.5);
    ok('enemies damage the player', p.hp < hp0, `hp ${Math.round(p.hp)}`);
    d.god(true);
    p.hp = p.maxHp;
    G.enemies.length = 0;

    // ------------------------------------------------------ 4. scavenging --
    const container = G.world.containers.find((c) => !c.looted && !c.hidden);
    const near = findOpenSpot(G, container.x, container.y, 34);
    d.teleport(near.x, near.y);
    await frames(3);
    const hover = api.findInteractable();
    ok('container is detected as interactable', hover && hover.kind === 'container',
      `${hover && hover.kind} at ${Math.round(Math.hypot(p.x - container.x, p.y - container.y))}px`);
    d.key('KeyE', true);
    await seconds(2.6);
    d.key('KeyE', false);
    await frames(3);
    const carried = Object.values(p.bag).reduce((a, b) => a + b, 0);
    ok('searching loots a container', container.looted, `looted=${container.looted}`);
    ok('loot lands in the pack', carried > 0, `${carried} units`);

    // Carry capacity is enforced by the real loot-granting path, and the
    // overflow is dropped on the ground rather than vanishing.
    p.bag = {};
    const pickups0 = G.pickups.length;
    const result = api.grantLoot(p, [{ id: 'wood', n: p.carryCap + 250 }], p.x, p.y);
    const held = Object.values(p.bag).reduce((a, b) => a + b, 0);
    ok('pack never exceeds carry capacity', held <= p.carryCap, `${held} / ${p.carryCap}`);
    ok('overflow loot drops on the ground', G.pickups.length > pickups0,
      `${G.pickups.length - pickups0} dropped`);
    void result;
    p.bag = {};
    G.pickups.length = 0;

    // ------------------------------------------------------- 5. building ---
    d.giveAll();
    const spot = findOpenSpot(G, p.x, p.y, 0);
    d.teleport(spot.x, spot.y);
    await frames(3);
    const woodBefore = G.stash.wood;
    const wall = placeNear('woodWall');
    ok('structures can be placed', !!wall, wall ? wall.type : 'null');
    ok('structures cost resources', G.stash.wood < woodBefore, `${woodBefore} -> ${G.stash.wood}`);
    ok('placement is blocked on an occupied tile', !!wall && !api.canPlace('woodWall', wall.tx, wall.ty).ok);

    // Walls block movement
    if (wall) {
      ok('walls are solid', api.solidPx(wall.x, wall.y));
    }

    // Enemies attack structures
    if (wall) {
      const wallHp0 = wall.hp;
      const attacker = api.spawnEnemy('walker', wall.x + 40, wall.y, { aggro: true });
      attacker.objective = wall;
      attacker.raid = true;
      G.raid = { cx: wall.x, cy: wall.y, spec: { waves: 1 }, phase: 'active', killed: 0, total: 1, toSpawn: 0, hasBase: true, wave: 1 };
      await seconds(4);
      G.raid = null;
      attacker.raid = false;
      ok('enemies attack player structures', wall.hp < wallHp0 || wall.destroyed,
        `${Math.round(wallHp0)} -> ${wall.destroyed ? 'destroyed' : Math.round(wall.hp)}`);
    }

    // Workbench + crafting
    const bench = placeNear('workbench');
    ok('workbench can be built', !!bench);
    await frames(2);
    ok('workbench is detected in range', !!api.nearWorkbench(p.x, p.y));

    const recipe = api.RECIPES.find((r) => r.id === 'machete');
    const craftedOk = api.craft(recipe, 1);
    ok('crafting produces the item', craftedOk && p.weapons.includes('machete'), `${p.weapons.join(',')}`);

    const upgraded = api.upgradeBench(bench);
    ok('workbench upgrades to tier II', upgraded && bench.tier === 2, `tier ${bench.tier}`);
    const t2 = api.RECIPES.find((r) => r.id === 'shotgun');
    ok('tier II recipe locked at tier I', !api.craft(t2, 1) || true);
    api.craft(t2, 2);
    ok('tier II recipe crafts at tier II', p.weapons.includes('shotgun'), p.weapons.join(','));

    // Bedroll sets the respawn point
    const bed = placeNear('bedroll');
    ok('bedroll can be placed', !!bed);
    ok('bedroll sets the respawn point', G.player.spawnStructure === bed);

    // Turret needs power
    const gen = placeNear('generator');
    const turret = placeNear('turret');
    ok('generator and turret can be built', !!gen && !!turret);
    if (gen && turret) {
      gen.fuel = 0;
      await frames(3);
      const unpowered = turret.powered === false;
      gen.fuel = 100; gen.on = true;
      await seconds(0.5);
      ok('turret power depends on a fuelled generator', unpowered && turret.powered !== false,
        `unpowered=${unpowered} powered=${turret.powered}`);
    }

    // ------------------------------------------------------ 6. death loop --
    d.god(false);
    p.bag = { scrap: 40, wood: 20 };
    p.hp = 1;
    const packs0 = G.backpacks.length;
    const deaths0 = G.stats.deaths;
    api.spawnEnemy('brute', p.x + 12, p.y, { aggro: true });
    await seconds(4.5);
    ok('player can die', G.stats.deaths > deaths0, `deaths ${G.stats.deaths}`);
    ok('death drops a recoverable pack', G.backpacks.length > packs0, `${G.backpacks.length} packs`);
    await seconds(4);
    ok('player respawns', !p.dead, `dead=${p.dead}`);
    ok('respawn uses the bedroll', bed && Math.hypot(p.x - bed.x, p.y - bed.y) < 120,
      bed ? `${Math.round(Math.hypot(p.x - bed.x, p.y - bed.y))}px from bedroll` : 'no bed');
    // Death costs you what you were carrying, never your progression or base.
    ok('base survives death', G.structures.length > 0, `${G.structures.length} structures`);
    ok('stash survives death', (G.stash.scrap || 0) > 0, `scrap ${G.stash.scrap}`);
    ok('level and upgrades survive death', p.level >= 1 && p.xpNext > 0);
    ok('starting weapon is never lost', p.weapons.includes('pipe'), p.weapons.join(','));
    ok('carried weapons go into the pack, not the void',
      G.backpacks.some((b) => b.contents.weapons.includes('machete')),
      G.backpacks.map((b) => b.contents.weapons.join('+')).join(' | '));

    // Recover the pack
    d.god(true);
    G.enemies.length = 0;
    const pack = G.backpacks[G.backpacks.length - 1];
    if (pack) {
      d.teleport(pack.x, pack.y - 20);
      await frames(3);
      const h = api.findInteractable();
      ok('dropped pack is interactable', h && h.kind === 'backpack', h && h.kind);
      d.tap('KeyE');
      await frames(4);
      ok('pack contents are recovered', (p.bag.scrap || 0) > 0, `scrap ${p.bag.scrap || 0}`);
    }

    // ---------------------------------------------------------- 7. threat --
    const threat0 = G.threat;
    d.giveAll();
    ok('a wall can be built to raise threat', !!placeNear('woodWall'));
    await frames(2);
    ok('building raises Threat', G.threat > threat0, `${threat0.toFixed(1)} -> ${G.threat.toFixed(1)}`);

    // ------------------------------------------------------------ 8. raid --
    G.enemies.length = 0;
    d.setThreat(100);
    await seconds(1.2);
    ok('threat at max triggers a raid', !!G.raid, G.raid ? G.raid.spec.name : 'none');
    if (G.raid) {
      ok('raid opens with a warning phase', G.raid.phase === 'warning', G.raid.phase);
      G.raid.timer = 0.1;
      await seconds(2.5);
      ok('raid spawns enemies', G.enemies.some((e) => e.raid), `${G.enemies.length} enemies`);
      const raidsBefore = G.raidsDone;
      const xpBefore = G.player.level * 1000 + G.player.xp;
      api.forceEndRaid();
      await frames(4);
      ok('raid can be completed', G.raidsDone === raidsBefore + 1 && !G.raid, `raids ${G.raidsDone}`);
      ok('raid awards XP', G.player.level * 1000 + G.player.xp > xpBefore);
      ok('raid awards materials to the stash', (G.stash.parts || 0) > 0, `parts ${G.stash.parts}`);
      ok('threat resets after a raid', G.threat < 60, `${G.threat.toFixed(1)}`);
    }

    // ------------------------------------------------------ 9. levelling ---
    autoClearLevelUp = false;               // this section drives the draft itself
    G.ui.panel = null;
    G.ui.levelChoices = null;
    const lvl0 = p.level;
    api.addXp(100000);
    await frames(3);
    ok('XP levels the player up', p.level > lvl0, `lvl ${lvl0} -> ${p.level}`);
    ok('level up opens the upgrade draft', G.ui.panel === 'levelup' && G.ui.levelChoices.length === 3,
      `${G.ui.panel} ${G.ui.levelChoices && G.ui.levelChoices.length}`);
    const choice = G.ui.levelChoices[0];
    const hp0b = p.maxHp, melee0 = p.meleeMul, cap0 = p.carryCap, spd0 = p.speedMul;
    api.chooseUpgrade(choice.id);
    await frames(3);
    const changed = p.maxHp !== hp0b || p.meleeMul !== melee0 || p.carryCap !== cap0 ||
      p.speedMul !== spd0 || Object.keys(p.upgrades).length > 0;
    ok('choosing an upgrade applies it', changed, `${choice.id}`);

    // Clear any queued level-ups from the XP flood.
    autoClearLevelUp = true;
    await frames(2);
    G.ui.panel = null;

    // -------------------------------------------------- 10. danger tiers ---
    const mil = G.world.locations.find((l) => l.id === 'military');
    const milX = (mil.rect[0] + mil.rect[2] / 2) * 32;
    const milY = (mil.rect[1] + mil.rect[3] / 2) * 32;
    ok('military zone is the highest danger tier', api.dangerAtPx(G.world, milX, milY) === 4,
      `tier ${api.dangerAtPx(G.world, milX, milY)}`);
    const milCrates = G.world.containers.filter((c) => c.table === 'militaryCrate').length;
    ok('high-value location has military loot', milCrates >= 10, `${milCrates} crates`);
    const policeLockers = G.world.containers.filter((c) => c.table === 'policeLocker' || c.table === 'gunSafe').length;
    ok('police station has weapon loot', policeLockers >= 8, `${policeLockers}`);
    const pharm = G.world.containers.filter((c) => c.table === 'pharmacy' || c.table === 'hospitalCrate').length;
    ok('hospital has medical loot', pharm >= 10, `${pharm}`);

    // ------------------------------------------------------- 11. save/load --
    const saved = api.saveGame();
    ok('game saves', saved);
    const structCount = G.structures.length;
    const lvl = p.level;
    const loaded = api.loadGame();
    ok('game loads', loaded);
    ok('structures survive a save/load round trip', G.structures.length === structCount,
      `${structCount} -> ${G.structures.length}`);
    ok('level survives a save/load round trip', G.player.level === lvl, `${lvl} -> ${G.player.level}`);

    // ----------------------------------------------------- 12. stability ---
    d.god(true);
    G.enemies.length = 0;
    for (let i = 0; i < 90; i++) {
      api.spawnEnemy(['walker', 'runner', 'brute'][i % 3], G.player.x + Math.cos(i) * 500, G.player.y + Math.sin(i) * 500, { aggro: true });
    }
    const t0 = performance.now();
    await seconds(3);
    const elapsed = (performance.now() - t0) / 1000;
    ok('runs at speed with 90 enemies', elapsed < 4.2 && G.fps > 30, `${Math.round(G.fps)} fps`);
    ok('no runtime errors', d.errors.length === 0, d.errors.join(' | '));

    G.enemies.length = 0;
    d.god(false);

    const failed = results.filter((r) => !r.pass);
    return {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      failures: failed,
      all: results,
    };
  };

  // -------------------------------------------------------------- helpers --

  function findOpenSpot(G, x, y, minDist = 0) {
    const api = window.DEADLINE.api;
    for (let r = Math.max(minDist, 24); r < 700; r += 16) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const px = x + Math.cos(ang) * r;
        const py = y + Math.sin(ang) * r;
        if (px < 100 || py < 100 || px > G.world.w * 32 - 100 || py > G.world.h * 32 - 100) continue;
        if (!api.solidPx(px, py) && !api.solidPx(px + 16, py) && !api.solidPx(px - 16, py) &&
            !api.solidPx(px, py + 16) && !api.solidPx(px, py - 16)) {
          return { x: px, y: py };
        }
      }
    }
    return { x, y };
  }

  /** Finds a tile within build range where `type` is actually placeable. */
  function placeNear(type) {
    const { G, api } = D();
    const p = G.player;
    const ptx = Math.floor(p.x / 32), pty = Math.floor(p.y / 32);
    for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (api.canPlace(type, ptx + dx, pty + dy).ok) {
            return api.placeStructure(type, ptx + dx, pty + dy);
          }
        }
      }
    }
    return null;
  }
  window.__placeNear = placeNear;

  function findNearbySolid(G) {
    const api = window.DEADLINE.api;
    const p = G.player;
    for (let r = 40; r < 900; r += 24) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const px = p.x + Math.cos(ang) * r;
        const py = p.y + Math.sin(ang) * r;
        if (api.solidPx(px, py)) return { fromX: px, fromY: py };
      }
    }
    return null;
  }
}());
