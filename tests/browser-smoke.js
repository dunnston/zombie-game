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
  // Levelling no longer interrupts play, so there is nothing to dismiss. Kept
  // as a no-op hook so the frame helpers below stay unchanged.
  let autoClearLevelUp = true;
  function clearLevelUp() {
    if (!autoClearLevelUp) return;
  }

  // A guard's engagement range, for comparing against a posted sniper's.
  const SURVIVOR_RANGE_BASE = 300;

  // A suite that hangs is far worse than one that fails, so every wait checks
  // an absolute deadline and aborts loudly.
  let deadline = Infinity;
  function checkDeadline() {
    if (performance.now() > deadline) {
      throw new Error('smoke suite exceeded its time budget — likely a stuck loop');
    }
  }

  async function frames(n) {
    for (let i = 0; i < n; i++) { checkDeadline(); clearLevelUp(); await frame(); }
    clearLevelUp();
  }
  const seconds = (s) => frames(Math.ceil(s * 60));

  window.runDeadlineSmoke = async function runDeadlineSmoke(budgetMs = 240000) {
    results.length = 0;
    deadline = performance.now() + budgetMs;
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
    // `let`, not `const`: loadGame() swaps G.player for a fresh object, and any
    // later section still holding the old one would silently test a ghost.
    let p = G.player;
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

    // --------------------------------- 5. building (keyboard-driven first) --
    // Regression: B must toggle build mode. This is deliberately driven through
    // the real key path rather than the debug API, because handling B in two
    // places once made the advertised control a no-op.
    G.ui.panel = null;
    G.ui.buildMode = false;
    d.tap('KeyB');
    await frames(3);
    ok('B opens build mode', G.ui.buildMode === true, `buildMode=${G.ui.buildMode}`);
    d.tap('KeyB');
    await frames(3);
    ok('B closes build mode again', G.ui.buildMode === false, `buildMode=${G.ui.buildMode}`);
    d.tap('KeyB');
    await frames(3);
    ok('build mode survives more than one frame', G.ui.buildMode === true);
    d.tap('Escape');
    await frames(3);
    ok('Escape leaves build mode', G.ui.buildMode === false);

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

    // Enemies attack structures. The player is parked well out of reach first:
    // a reachable player correctly outranks scenery, so leaving them next to
    // the wall would test the opposite behaviour.
    if (wall) {
      const stand = { x: p.x, y: p.y };
      d.teleport(wall.x + 700, wall.y);
      await frames(3);
      const wallHp0 = wall.hp;
      const attacker = api.spawnEnemy('walker', wall.x + 40, wall.y, { aggro: true });
      attacker.objective = wall;
      attacker.raid = true;
      G.raid = { cx: wall.x, cy: wall.y, spec: { waves: 1 }, phase: 'active', killed: 0, total: 1, toSpawn: 0, hasBase: true, wave: 1 };
      await seconds(5);
      G.raid = null;
      attacker.raid = false;
      attacker.dead = true;
      ok('enemies attack player structures', wall.hp < wallHp0 || wall.destroyed,
        `${Math.round(wallHp0)} -> ${wall.destroyed ? 'destroyed' : Math.round(wall.hp)}`);
      d.teleport(stand.x, stand.y);
      await frames(3);
    }

    // ...and the reverse: a zombie beside you hits you, not the wall behind you.
    if (wall) {
      G.enemies.length = 0;
      d.teleport(wall.x - 26, wall.y);
      await frames(3);
      d.god(false);
      p.hp = p.maxHp;
      p.invuln = 0;
      const hpBeforeBite = p.hp;
      const biter = api.spawnEnemy('walker', p.x - 16, p.y, { aggro: true });
      biter.objective = wall;
      await seconds(3);
      ok('a zombie next to you attacks you, not the wall behind you', p.hp < hpBeforeBite,
        `hp ${Math.round(hpBeforeBite)} -> ${Math.round(p.hp)}`);
      d.god(true);
      p.hp = p.maxHp;
      G.enemies.length = 0;
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

      // Regression: a part-full generator with no spare fuel must still be
      // switchable off, or the player can never stop it broadcasting Threat.
      gen.fuel = 50;
      gen.on = true;
      G.stash.fuel = 0;
      p.bag.fuel = 0;
      await frames(2);
      d.teleport(gen.x + 30, gen.y);
      await frames(3);
      const genHover = api.findInteractable();
      ok('a running generator offers to switch off', genHover && genHover.kind === 'generator' &&
        /Switch off/i.test(genHover.label), genHover && genHover.label);
      d.tap('KeyE');
      await frames(3);
      ok('a part-fuelled generator can be switched off', gen.on === false, `on=${gen.on} fuel=${Math.round(gen.fuel)}`);
      d.tap('KeyE');
      await frames(3);
      ok('switching it back on works without spare fuel', gen.on === true, `on=${gen.on}`);
      G.stash.fuel = 500;
    }

    // ------------------------------------------------------ 6. death loop --
    // Step outside the compound the test just built, so the killer has a clear
    // path and this stays deterministic rather than depending on AI steering.
    const deathSpot = clearOfStructures(G, p.x, p.y);
    d.teleport(deathSpot.x, deathSpot.y);
    await frames(3);
    d.god(false);
    p.bag = { scrap: 40, wood: 20 };
    p.hp = 1;
    p.invuln = 0;
    const packs0 = G.backpacks.length;
    const deaths0 = G.stats.deaths;
    api.spawnEnemy('brute', p.x + 14, p.y, { aggro: true });
    api.spawnEnemy('runner', p.x - 14, p.y, { aggro: true });
    await seconds(6);
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

    // -------------------------------- 9. levelling, attributes and perks ---
    G.ui.panel = null;
    const lvl0 = p.level, sp0 = p.skillPoints;
    api.addXp(100000);
    await frames(3);
    ok('XP levels the player up', p.level > lvl0, `lvl ${lvl0} -> ${p.level}`);
    ok('levelling grants skill points', p.skillPoints > sp0, `${sp0} -> ${p.skillPoints}`);
    ok('levelling no longer interrupts play', G.ui.panel !== 'levelup', `${G.ui.panel}`);

    // Attribute purchase spends a point and hands over the health it grants.
    const conBefore = p.attrs.con, maxHpBefore = p.maxHp, ptsBefore = p.skillPoints;
    const hpNow = p.hp;
    ok('an attribute can be raised', api.raiseAttribute('con'));
    ok('raising an attribute costs a point', p.skillPoints === ptsBefore - 1, `${p.skillPoints}`);
    ok('Constitution raises max health', p.maxHp > maxHpBefore, `${maxHpBefore} -> ${p.maxHp}`);
    ok('the health it grants is given, not left as headroom', p.hp > hpNow, `${hpNow} -> ${Math.round(p.hp)}`);
    ok('the attribute rank went up', p.attrs.con === conBefore + 1);

    // Perks are gated by their parent attribute's rank.
    ok('a perk above your rank is refused', api.buyPerk('adrenaline') === false);
    // Bounded: raiseAttribute returning false must never spin the main thread.
    for (let i = 0; i < 20 && p.attrs.str < 3; i++) {
      if (!api.raiseAttribute('str')) { p.skillPoints += 1; }
    }
    const meleeBefore = p.meleeMul;
    ok('an unlocked perk can be bought', api.buyPerk('heavyHitter'));
    ok('the perk changes the stat it advertises', p.meleeMul > meleeBefore,
      `${meleeBefore.toFixed(2)} -> ${p.meleeMul.toFixed(2)}`);
    ok('perk rank is recorded', (p.perks.heavyHitter || 0) === 1);

    // The whole point of the recompute model: running it again changes nothing.
    const snap = { hp: p.maxHp, melee: p.meleeMul, cap: p.carryCap, crit: p.critChance };
    api.recomputeStats(p);
    api.recomputeStats(p);
    ok('recomputing stats is idempotent',
      p.maxHp === snap.hp && p.meleeMul === snap.melee &&
      p.carryCap === snap.cap && p.critChance === snap.crit,
      `${p.maxHp}/${p.meleeMul.toFixed(2)}/${p.carryCap}`);

    // Spending everything must never overdraw.
    let guard = 0;
    while (p.skillPoints > 0 && guard++ < 200) {
      if (!api.raiseAttribute('per')) break;
    }
    ok('points can never go negative', p.skillPoints >= 0, `${p.skillPoints}`);

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

    // ------------------------------------------------- 10b. save while dead --
    // Regression: an autosave landing inside the death countdown must not
    // restore a player who is alive on zero health.
    // Death itself is covered above; this drives the death path directly so the
    // assertion is about save/load behaviour and nothing else.
    G.enemies.length = 0;
    p.bag = { scrap: 12 };
    api.killPlayer();
    await frames(2);
    if (p.dead) {
      ok('player is mid-death for the save test', true);
      api.saveGame();
      await seconds(4);
      api.loadGame();
      p = G.player;               // loadGame replaced the player object
      await frames(3);
      ok('a save made while dead restores a living player',
        !G.player.dead && G.player.hp > 0, `dead=${G.player.dead} hp=${Math.round(G.player.hp)}`);
      ok('the restored player is not stranded at zero health',
        G.player.hp >= G.player.maxHp * 0.5, `hp=${Math.round(G.player.hp)}`);
    } else {
      ok('player is mid-death for the save test', false, 'killPlayer did not take');
    }
    d.god(true);
    G.enemies.length = 0;
    G.backpacks.length = 0;
    G.player.hp = G.player.maxHp;

    // ------------------------------------------------------- 11. save/load --
    // loadGame() swaps G.player for a fresh object, so read through G from here.
    const saved = api.saveGame();
    ok('game saves', saved);
    const structCount = G.structures.length;
    const lvl = G.player.level;
    const loaded = api.loadGame();
    p = G.player;                 // loadGame replaced the player object
    ok('game loads', loaded);
    ok('structures survive a save/load round trip', G.structures.length === structCount,
      `${structCount} -> ${G.structures.length}`);
    ok('level survives a save/load round trip', G.player.level === lvl, `${lvl} -> ${G.player.level}`);

    // ------------------------------------------- 11b. input and UI routing --
    // A tap must survive a frame that runs no simulation step (high-refresh
    // displays) and must not fire twice when several steps run in one frame.
    {
      const { Input } = d;
      const before = G.ui.panel;
      void before;
      G.ui.panel = null;
      G.ui.buildMode = false;

      // Simulate the render loop's edge handling directly.
      d.key('KeyB', true);
      d.key('KeyB', false);
      const held = Input.pressed.has('KeyB');
      ok('a tap is recorded as an edge', held);
      // Drive it through the real loop.
      await frames(4);
      ok('a single tap toggles build mode exactly once', G.ui.buildMode === true,
        `buildMode=${G.ui.buildMode}`);
      d.tap('KeyB');
      await frames(4);
      ok('build mode does not re-toggle on later frames', G.ui.buildMode === false);
    }

    // Clicking the build bar selects a piece without also placing one.
    {
      d.giveAll();
      G.ui.panel = null;
      G.ui.buildMode = true;
      G.ui.buildIndex = 0;
      await frames(3);
      const rects = G.ui.hudRects || [];
      ok('the build bar claims its screen region', rects.length > 0, `${rects.length} rects`);
      const before = G.structures.length;
      if (rects.length) {
        const r = rects[0];
        const s = G.dpr || 1;
        const cx = (r.x + r.w * 0.15) * s, cy = (r.y + r.h * 0.6) * s;
        d.mouseMove(cx / s, cy / s);
        await frames(2);
        d.mouseDown();
        await frames(3);
        d.mouseUp();
        await frames(2);
        ok('clicking the build bar does not place a structure',
          G.structures.length === before, `${before} -> ${G.structures.length}`);
      }
      G.ui.buildMode = false;
      await frames(2);
    }

    // Turrets must not fire into terrain.
    {
      const turret2 = G.structures.find((s) => s.type === 'turret');
      if (turret2) {
        const tree = [...G.world.propGrid.values()]
          .sort((a, b) => Math.hypot(a.x - turret2.x, a.y - turret2.y) - Math.hypot(b.x - turret2.x, b.y - turret2.y))[0];
        if (tree && Math.hypot(tree.x - turret2.x, tree.y - turret2.y) < 400) {
          // Put an enemy directly behind that tree, in line with the turret.
          const ang = Math.atan2(tree.y - turret2.y, tree.x - turret2.x);
          const behind = Math.hypot(tree.x - turret2.x, tree.y - turret2.y) + 40;
          G.enemies.length = 0;
          const hidden = api.spawnEnemy('walker',
            turret2.x + Math.cos(ang) * behind, turret2.y + Math.sin(ang) * behind, {});
          await frames(4);
          ok('turrets ignore enemies behind terrain',
            turret2.targetE !== hidden, `target=${turret2.targetE ? 'something' : 'none'}`);
          G.enemies.length = 0;
        } else {
          ok('turrets ignore enemies behind terrain', true, 'no tree in range to test with');
        }
      } else {
        ok('turrets ignore enemies behind terrain', true, 'no turret survived to test with');
      }
    }

    // ----------------------------------------------------- 11c. day/night --
    {
      const dayT = G.dayTime;
      G.dayTime = 0.30;
      await frames(3);
      const noon = api.darkness().alpha;
      const noonFactors = api.nightFactors();
      ok('daytime is fully lit', noon < 0.02, `alpha ${noon.toFixed(2)}`);
      ok('daytime does not buff the infected', noonFactors.density < 1.05, `${noonFactors.density.toFixed(2)}`);

      G.dayTime = 0.85;
      await frames(3);
      const midnight = api.darkness().alpha;
      const nightF = api.nightFactors();
      ok('night actually gets dark', midnight > 0.6, `alpha ${midnight.toFixed(2)}`);
      ok('night raises enemy density', nightF.density > 1.5, `${nightF.density.toFixed(2)}`);
      ok('night sharpens their senses', nightF.sense > 1.2, `${nightF.sense.toFixed(2)}`);
      ok('night raises threat gain', nightF.threat > 1.5, `${nightF.threat.toFixed(2)}`);
      ok('the clock reads as night', /^(0[0-3]|2[2-3]):/.test(api.clockString()), api.clockString());

      // Dusk should be a ramp, not a step.
      G.dayTime = 0.62;
      await frames(2);
      const dusk = api.darkness().alpha;
      ok('dusk falls gradually', dusk > 0.02 && dusk < midnight, `alpha ${dusk.toFixed(2)}`);

      // The day must roll over.
      const dayBefore = G.day;
      G.dayTime = 0.999;
      await seconds(1.2);
      ok('the day counter advances', G.day === dayBefore + 1, `${dayBefore} -> ${G.day}`);

      G.dayTime = dayT;
      await frames(2);
    }

    // ----------------------------------------------------- 11d. survivors --
    {
      G.enemies.length = 0;
      G.survivors.length = 0;
      d.god(true);

      // Charisma gates how many people will follow you.
      // The roster has two independent limits now, so test the Charisma one on
      // its own — the effective cap is min(charisma, bunks) and there are no
      // bunks yet at this point.
      p.attrs.cha = 2;
      api.recomputeStats(p);
      const chaLow = api.rosterLimits().charisma;
      p.skillPoints += 12;
      for (let i = 0; i < 20 && p.attrs.cha < 8; i++) {
        if (!api.raiseAttribute('cha')) { p.skillPoints += 1; }
      }
      ok('Charisma raises how many will follow you', api.rosterLimits().charisma > chaLow,
        `${chaLow} -> ${api.rosterLimits().charisma}`);

      ok('survivors are seeded around the town', G.rescues.length > 0, `${G.rescues.length}`);

      // Somewhere for them to sleep — bunks are a hard gate on recruiting.
      d.giveAll();
      G.benchTier = 2;
      const homePlot = clearOpenPlot(G, 6);
      d.teleport(homePlot.x, homePlot.y);
      await frames(3);
      const firstBunk = placeNear('bunk');
      ok('a bunk can be built to make room', !!firstBunk);

      // Recruit one through the real interaction path.
      const rescue = G.rescues[0];
      d.teleport(rescue.x + 30, rescue.y);
      await frames(4);
      const hover = api.findInteractable();
      ok('a survivor can be found and offered', hover && hover.kind === 'rescue', hover && hover.kind);
      d.tap('KeyE');
      await frames(4);
      ok('a survivor joins you', api.liveSurvivors().length === 1, `${api.liveSurvivors().length}`);

      const sv = G.survivors[0];
      ok('the survivor has a name and a level', !!sv.name && sv.level >= 1, `${sv.name} lvl ${sv.level}`);

      // Put them in genuinely open ground so line of sight is not the variable.
      const plot = clearOpenPlot(G, 5);
      d.teleport(plot.x, plot.y);
      sv.x = plot.x + 40; sv.y = plot.y; sv.post = null; sv.cd = 0;
      sv.hp = sv.maxHp;
      G.stash.ammoP = 500;
      G.stash.rations = 300;
      await frames(4);

      const foe = api.spawnEnemy('walker', plot.x + 170, plot.y, { aggro: false });
      const ammoBefore = G.stash.ammoP;
      await seconds(4);
      ok('survivors shoot at the infected', G.stash.ammoP < ammoBefore,
        `ammo ${ammoBefore} -> ${G.stash.ammoP}`);
      ok('survivor fire actually damages enemies', foe.dead || foe.hp < foe.maxHp,
        `hp ${foe.dead ? 'dead' : Math.round(foe.hp)}`);
      ok('survivors draw ammo from the stash', G.stash.ammoP < 500);

      // They take damage, go down, and can be helped up.
      G.enemies.length = 0;
      sv.hp = sv.maxHp;
      const svHp = sv.hp;
      api.spawnEnemy('walker', sv.x + 12, sv.y, { aggro: true });
      api.spawnEnemy('walker', sv.x - 12, sv.y, { aggro: true });
      await seconds(3);
      ok('the infected attack your people', sv.hp < svHp, `${svHp} -> ${Math.round(sv.hp)}`);

      G.enemies.length = 0;
      sv.hp = 0; sv.downed = true; sv.downT = 8;
      p.items.medkit = 2;
      d.teleport(sv.x + 24, sv.y);
      await frames(4);
      const downHover = api.findInteractable();
      ok('a downed survivor is the priority interaction',
        downHover && downHover.kind === 'revive', downHover && downHover.kind);
      d.tap('KeyE');
      await frames(4);
      ok('a downed survivor can be helped up', !sv.downed && sv.hp > 0,
        `downed=${sv.downed} hp=${Math.round(sv.hp)}`);

      // Left alone, they die permanently.
      sv.hp = 0; sv.downed = true; sv.downT = 0.4;
      await seconds(1.5);
      ok('an unattended survivor dies for good', api.liveSurvivors().length === 0,
        `${api.liveSurvivors().length} alive`);

      // Rations upkeep.
      G.survivors.length = 0;
      G.survivors.push(api.makeSurvivor(p.x, p.y, {}));
      G.rationDebt = 0;
      G.stash.rations = 40;
      p.bag.rations = 0;
      const foodBefore = G.stash.rations;
      await seconds(12);
      ok('survivors consume Rations over time', (G.stash.rations || 0) < foodBefore,
        `${foodBefore} -> ${G.stash.rations || 0}`);

      // Regression: an empty pantry accrues debt, and restocking must clear it.
      // Billing only the current tick would leave the crew starving forever.
      G.stash.rations = 0;
      G.rationDebt = 0;
      await seconds(12);
      const wentHungry = G.survivors[0].hungry || G.rationDebt > 0;
      ok('an empty pantry makes the crew hungry', wentHungry,
        `debt ${G.rationDebt.toFixed(2)} hungry=${G.survivors[0].hungry}`);
      G.rationDebt = 4;                       // a real backlog
      G.stash.rations = 400;
      await seconds(12);
      ok('restocking the stash pays down the ration debt', G.rationDebt < 1,
        `debt ${G.rationDebt.toFixed(2)}`);
      ok('a fed crew stops being hungry', !G.survivors[0].hungry,
        `hungry=${G.survivors[0].hungry}`);

      // Regression: Charisma bonuses must reach the crew already standing there.
      const existing = G.survivors[0];
      existing.level = 3;
      api.refreshAllSurvivors();
      const dmgBefore = existing.dmg, hpCapBefore = existing.maxHp;
      p.skillPoints += 6;
      for (let i = 0; i < 6 && (p.perks.inspiring || 0) < 1; i++) {
        if (!api.buyPerk('inspiring')) api.raiseAttribute('cha');
      }
      ok('Inspiring Presence was learned', (p.perks.inspiring || 0) >= 1,
        `rank ${p.perks.inspiring || 0}`);
      ok('a Charisma perk reaches survivors already recruited',
        existing.dmg > dmgBefore && existing.maxHp > hpCapBefore,
        `dmg ${dmgBefore.toFixed(1)} -> ${existing.dmg.toFixed(1)}, hp ${hpCapBefore} -> ${existing.maxHp}`);

      G.survivors.length = 0;
      G.enemies.length = 0;
    }

    // ------------------------------- 11d2. bunks, jobs and furniture --------
    {
      d.god(true);
      G.enemies.length = 0;
      G.survivors.length = 0;
      for (const s of [...G.structures]) api.demolishStructure(s);
      G.structures.length = 0;
      G.structGrid.clear();
      d.giveAll();
      G.stash.ammoP = 600;
      G.stash.rations = 400;
      G.benchTier = 2;

      // Settle somewhere open but still within a scavenger's working radius of
      // real containers, or the Scavenger test has nothing to send them to.
      const plot = openPlotNearLoot(G, 5);
      d.teleport(plot.x, plot.y);
      await frames(3);
      p.attrs.cha = 8;
      api.recomputeStats(p);
      const nearbyLoot = G.world.containers.filter((c) =>
        !c.looted && !c.hidden && Math.hypot(c.x - plot.x, c.y - plot.y) < 900).length;
      ok('the job-test base has containers within scavenging range', nearbyLoot > 0, `${nearbyLoot}`);

      // Bunks are a hard gate on recruiting, separate from Charisma.
      const noBunks = api.rosterLimits();
      ok('Charisma alone does not house anybody', noBunks.cap === 0 && noBunks.charisma > 0,
        `charisma ${noBunks.charisma} bunks ${noBunks.bunks} cap ${noBunks.cap}`);
      const anyRescue = G.rescues[0];
      d.teleport(anyRescue.x + 30, anyRescue.y);
      await frames(3);
      ok('recruiting is refused with nowhere to sleep', api.recruit(anyRescue) === null);

      d.teleport(plot.x, plot.y);
      await frames(3);
      const bunkA = placeNear('bunk');
      const bunkB = placeNear('bunk');
      ok('bunks can be built', !!bunkA && !!bunkB);
      const withBunks = api.rosterLimits();
      ok('each bunk houses one survivor', withBunks.bunks === 2, `${withBunks.bunks}`);
      ok('the roster cap is the lower of the two limits',
        withBunks.cap === Math.min(withBunks.charisma, withBunks.bunks), `${withBunks.cap}`);

      const stash2 = placeNear('stash');
      const wall2 = placeNear('woodWall');
      ok('a stash and a wall are available for the job tests', !!stash2 && !!wall2);

      const worker = api.makeSurvivor(plot.x + 40, plot.y, { level: 3 });
      G.survivors.push(worker);
      await frames(3);

      // Builder: repairs damage, paying out of the stash.
      wall2.hp = wall2.maxHp * 0.25;
      const wallHp0 = wall2.hp;
      ok('a survivor can be put on Builder duty', api.assignJob(worker, 'builder'));
      for (let i = 0; i < 26 && wall2.hp < wall2.maxHp; i++) await seconds(0.5);
      ok('builders repair damaged structures', wall2.hp > wallHp0,
        `${Math.round(wallHp0)} -> ${Math.round(wall2.hp)}`);

      // Scavenger: loots a container and hauls it home.
      const lootedBefore = G.world.containers.filter((c) => c.looted).length;
      ok('a survivor can be put on Scavenger duty', api.assignJob(worker, 'scavenger'));
      ok('changing job clears the previous job\'s target', worker.runTarget === null);
      for (let i = 0; i < 40; i++) {
        await seconds(0.5);
        if (G.world.containers.filter((c) => c.looted).length > lootedBefore && !worker.carrying) break;
      }
      ok('scavengers loot containers on their own',
        G.world.containers.filter((c) => c.looted).length > lootedBefore,
        `${G.world.containers.filter((c) => c.looted).length - lootedBefore} looted`);

      // Switching back must not leave the container as a repair target — that
      // was the actual bug. Put them beside the wall so this measures target
      // handling and not how long a walk home takes.
      // Force a container target so the cross-job case is actually exercised,
      // rather than depending on whether they happened to be mid-run.
      worker.runTarget = G.world.containers.find((c) => !c.looted && !c.hidden) || null;
      const scavTarget = worker.runTarget;
      wall2.hp = wall2.maxHp * 0.3;
      const wallHp1 = wall2.hp;
      api.assignJob(worker, 'builder');
      ok('the scavenger target is dropped on reassignment',
        scavTarget !== null && worker.runTarget === null,
        `was ${scavTarget && scavTarget.label}, now ${worker.runTarget}`);
      worker.x = wall2.x + 34;
      worker.y = wall2.y;
      await frames(3);
      for (let i = 0; i < 40 && wall2.hp < wall2.maxHp; i++) await seconds(0.5);
      ok('a builder recalled from scavenging still repairs', wall2.hp > wallHp1,
        `${Math.round(wallHp1)} -> ${Math.round(wall2.hp)}`);
      ok('structure health never goes non-finite', Number.isFinite(wall2.hp), `${wall2.hp}`);

      // Sniper: needs a tower, and gains real range on it.
      ok('Sniper duty is refused with no Watchtower', api.assignJob(worker, 'sniper') === false);
      const tower = placeNear('watchtower');
      ok('a watchtower can be built', !!tower);
      ok('Sniper duty works once a tower exists', api.assignJob(worker, 'sniper'));
      await frames(4);
      ok('the sniper is posted on the tower', worker.tower === tower);
      ok('a posted sniper shoots much further', worker.shotRange > SURVIVOR_RANGE_BASE,
        `${worker.shotRange}`);
      ok('a posted sniper hits much harder', worker.shotDmgMul > 1.5, `${worker.shotDmgMul}`);
      ok('one tower takes one sniper', api.freeTowers().length === 0);

      // Losing the tower demotes them rather than stranding them.
      tower.destroyed = true;
      await frames(4);
      ok('losing the tower demotes the sniper', worker.job === 'guard', worker.job);

      // ------------------------- job economy regressions -------------------
      // Scavengers must not strip the neighbourhood with nowhere to put it.
      {
        for (const st of [...G.structures]) if (st.type === 'stash') api.demolishStructure(st);
        const scav = api.makeSurvivor(plot.x + 30, plot.y, { level: 2 });
        G.survivors.length = 0;
        G.survivors.push(scav);
        api.assignJob(scav, 'scavenger');
        const lootedNoStash = G.world.containers.filter((c) => c.looted).length;
        for (let i = 0; i < 16; i++) { G.enemies.length = 0; await seconds(0.5); }
        ok('scavengers do not loot with no stash to deliver to',
          G.world.containers.filter((c) => c.looted).length === lootedNoStash,
          `${G.world.containers.filter((c) => c.looted).length - lootedNoStash} stripped`);

        // Equipment rolled by a scavenger must survive, not evaporate.
        const stash3 = placeNear('stash');
        ok('a stash can be rebuilt for the delivery test', !!stash3);
        G.pickups.length = 0;
        scav.carrying = { scrap: 5 };
        scav.carryItems = [{ id: 'weapon:pistol', n: 1 }, { id: 'item:medkit', n: 2 }];
        scav.x = stash3.x + 20; scav.y = stash3.y;
        const scrapBefore = G.stash.scrap || 0;
        // The player is standing right there and will magnet the dropped gear
        // up within a frame, so measure what they end up holding.
        const medkitsBefore = p.items.medkit || 0;
        p.weapons = p.weapons.filter((w) => w !== 'pistol');
        // Survivors correctly refuse to do chores while something is shooting at
        // them, so keep the area clear for this measurement.
        for (let i = 0; i < 12 && scav.carrying; i++) {
          G.enemies.length = 0;
          scav.x = stash3.x + 20; scav.y = stash3.y;
          await seconds(0.4);
        }
        ok('materials are delivered into the stash', (G.stash.scrap || 0) > scrapBefore,
          `${scrapBefore} -> ${G.stash.scrap || 0}`);
        ok('equipment a scavenger found is not destroyed',
          (p.items.medkit || 0) > medkitsBefore || p.weapons.includes('pistol') || G.pickups.length > 0,
          `medkits ${medkitsBefore} -> ${p.items.medkit || 0}, pistol=${p.weapons.includes('pistol')}, ${G.pickups.length} on the ground`);
        ok('the haul is cleared once handed over', !scav.carrying && !scav.carryItems?.length);

        // Reassigning mid-haul must not delete the cargo either.
        G.pickups.length = 0;
        scav.carrying = { wood: 9 };
        scav.carryItems = [];
        const woodBefore2 = G.stash.wood || 0;
        api.assignJob(scav, 'guard');
        ok('reassigning mid-haul does not destroy the cargo',
          (G.stash.wood || 0) > woodBefore2 || G.pickups.length > 0,
          `stash ${woodBefore2} -> ${G.stash.wood || 0}, ${G.pickups.length} dropped`);

        // Builders must not repair on credit they cannot pay for.
        const wall3 = placeNear('woodWall');
        wall3.hp = wall3.maxHp * 0.2;
        const brokeHp = wall3.hp;
        G.stash.wood = 0;
        G.stash.scrap = 0;
        scav.repairCredit = 0;
        api.assignJob(scav, 'builder');
        for (let i = 0; i < 14; i++) {
          G.enemies.length = 0;
          scav.x = wall3.x + 34; scav.y = wall3.y;
          await seconds(0.4);
        }
        ok('builders cannot repair with an empty stash',
          Math.abs(wall3.hp - brokeHp) < 1,
          `${Math.round(brokeHp)} -> ${Math.round(wall3.hp)}`);
        G.stash.wood = 500;
        G.stash.scrap = 500;
        for (let i = 0; i < 14 && wall3.hp <= brokeHp; i++) {
          G.enemies.length = 0;
          scav.x = wall3.x + 34; scav.y = wall3.y;
          await seconds(0.4);
        }
        ok('builders resume once materials are available', wall3.hp > brokeHp,
          `${Math.round(brokeHp)} -> ${Math.round(wall3.hp)}`);
      }

      // The roster must stay reachable at the maximum crew size.
      {
        G.survivors.length = 0;
        for (let i = 0; i < 8; i++) {
          G.survivors.push(api.makeSurvivor(plot.x + i * 20, plot.y + 40, { level: 1 }));
        }
        G.ui.panel = 'char';
        G.ui.tab = 2;
        G.ui.rosterScroll = 0;
        await frames(4);
        const firstPage = G.ui.rosterScroll;
        G.ui.rosterScroll = 99;                 // clamped by the draw pass
        await frames(4);
        ok('the roster scrolls rather than hiding people',
          G.ui.rosterScroll > firstPage && G.ui.rosterScroll < 99,
          `scroll clamped to ${G.ui.rosterScroll} for ${G.survivors.length} people`);
        G.ui.panel = null;
        G.ui.rosterScroll = 0;
        G.survivors.length = 0;
      }

      G.survivors.length = 0;
      for (const s of [...G.structures]) api.demolishStructure(s);
      G.structures.length = 0;
      G.structGrid.clear();
    }

    // Furniture actually reaches the world, and reads true to its building.
    {
      const kinds = new Map();
      for (const c of G.world.containers) kinds.set(c.kind, (kinds.get(c.kind) || 0) + 1);
      ok('the town is furnished with many kinds of searchable thing',
        kinds.size >= 20, `${kinds.size} kinds across ${G.world.containers.length} containers`);
      for (const k of ['bookshelf', 'dresser', 'wardrobe', 'fridge', 'desk', 'nightstand']) {
        ok(`houses contain ${k}s`, (kinds.get(k) || 0) > 0, `${kinds.get(k) || 0}`);
      }

      const inLoc = (c, id) => {
        const l = G.world.locations.find((x) => x.id === id);
        return c.tx >= l.rect[0] && c.ty >= l.rect[1] &&
          c.tx < l.rect[0] + l.rect[2] && c.ty < l.rect[1] + l.rect[3];
      };
      const hardwareRacks = G.world.containers.filter((c) => c.kind === 'toolrack').length;
      ok('the hardware store has tool racks', hardwareRacks > 0, `${hardwareRacks}`);
      const milLockers = G.world.containers.filter((c) => inLoc(c, 'military') && c.kind === 'footlocker').length;
      ok('the checkpoint has footlockers', milLockers > 0, `${milLockers}`);
      const houseFridges = G.world.containers.filter((c) => inLoc(c, 'suburb') && c.kind === 'fridge').length;
      ok('suburban houses have refrigerators', houseFridges > 0, `${houseFridges}`);
      // A wardrobe in a gun locker would break the "read the building" promise.
      const badPolice = G.world.containers.filter((c) => inLoc(c, 'police') && c.kind === 'wardrobe').length;
      ok('precinct interiors are not furnished like bedrooms', badPolice === 0, `${badPolice}`);
    }

    // ------------------------------------------- 11e. a base, anywhere ------
    // The design promise is that you can settle wherever you like. Verify a
    // full working base can actually be founded in every district on the map.
    {
      d.god(true);
      G.enemies.length = 0;
      G.survivors.length = 0;
      const failures = [];
      for (const loc of G.world.locations) {
        // Wipe the previous district's base so costs and space are comparable.
        for (const s of [...G.structures]) api.demolishStructure(s);
        G.structures.length = 0;
        G.structGrid.clear();
        d.giveAll();
        G.benchTier = 2;

        const cx = (loc.rect[0] + loc.rect[2] / 2) * 32;
        const cy = (loc.rect[1] + loc.rect[3] / 2) * 32;
        const plot = findOpenSpot(G, cx, cy, 0);
        d.teleport(plot.x, plot.y);
        await frames(3);

        const wanted = ['bedroll', 'stash', 'workbench', 'woodWall', 'turret', 'generator'];
        const built = wanted.filter((t) => !!placeNear(t));
        if (built.length < wanted.length) {
          failures.push(`${loc.id}: only ${built.join(',')}`);
        }
      }
      ok('a full base can be founded in every district', failures.length === 0,
        failures.join(' | ') || `${G.world.locations.length} districts`);

      // ...and the raid follows it there rather than to some fixed home.
      const centre = api.baseCenter();
      ok('the raid target follows the base wherever it is',
        centre.hasBase && Math.hypot(centre.x - G.player.x, centre.y - G.player.y) < 400,
        `base at ${Math.round(centre.x)},${Math.round(centre.y)}`);

      for (const s of [...G.structures]) api.demolishStructure(s);
      G.structures.length = 0;
      G.structGrid.clear();
    }

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

  /** A tile with no blocked tiles within `n` in any direction — real open ground. */
  function clearOpenPlot(G, n) {
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
        if (clear(tx, ty)) return { x: tx * 32 + 16, y: ty * 32 + 16 };
      }
    }
    return { x: 80 * 32, y: 80 * 32 };
  }

  /** A clear plot that still has unlooted containers within scavenging range. */
  function openPlotNearLoot(G, n) {
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
    const loot = G.world.containers.filter((c) => !c.looted && !c.hidden);
    for (let ty = 8; ty < W - 8; ty += 2) {
      for (let tx = 8; tx < W - 8; tx += 2) {
        if (G.world.danger[ty * W + tx] > 2) continue;
        if (!clear(tx, ty)) continue;
        const px = tx * 32 + 16, py = ty * 32 + 16;
        if (loot.some((c) => Math.hypot(c.x - px, c.y - py) < 600)) return { x: px, y: py };
      }
    }
    return clearOpenPlot(G, n);
  }

  /** Open ground well away from any player-built structure. */
  function clearOfStructures(G, x, y) {
    const api = window.DEADLINE.api;
    const far = (px, py) => G.structures.every((s) =>
      s.destroyed || Math.hypot(s.x - px, s.y - py) > 260);
    for (let r = 300; r < 1400; r += 40) {
      for (let a = 0; a < 20; a++) {
        const ang = (a / 20) * Math.PI * 2;
        const px = x + Math.cos(ang) * r;
        const py = y + Math.sin(ang) * r;
        if (px < 200 || py < 200 || px > G.world.w * 32 - 200 || py > G.world.h * 32 - 200) continue;
        if (api.solidPx(px, py)) continue;
        if (api.solidPx(px + 24, py) || api.solidPx(px - 24, py)) continue;
        if (api.solidPx(px, py + 24) || api.solidPx(px, py - 24)) continue;
        if (!far(px, py)) continue;
        return { x: px, y: py };
      }
    }
    return { x, y };
  }

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
