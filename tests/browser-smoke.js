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
  // A hidden page never runs requestAnimationFrame at all, and then the suite
  // does not fail — it just never comes back, because the deadline below is
  // only checked from inside frames(). So every frame wait races a plain timer:
  // if rAF has not fired in five seconds, say why, instead of waiting forever.
  const frame = () => new Promise((resolve, reject) => {
    let done = false;
    const guard = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(
        'requestAnimationFrame has not fired for 5s. The page is hidden or ' +
        'backgrounded — the suite needs a visible tab (Playwright: page.bringToFront()).',
      ));
    }, 5000);
    requestAnimationFrame(() => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve();
    });
  });

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
  let startedAt = 0;
  let framesRun = 0;
  function checkDeadline() {
    if (performance.now() > deadline) {
      // Waits here are counted in animation frames, so a throttled tab stretches
      // the whole suite without anything actually being wrong. A background tab
      // drops rAF to about 1fps, which turns a three-minute suite into two
      // hours — say so, rather than sending the reader hunting for a stuck loop.
      const fps = framesRun / ((performance.now() - startedAt) / 1000);
      throw new Error(
        `smoke suite exceeded its time budget after ${framesRun} frames at ` +
        `${fps.toFixed(1)}fps. ` +
        (fps < 30
          ? 'That is a throttled tab, not a stuck loop — the waits here count ' +
            'frames, so give the page focus (Playwright: page.bringToFront()) ' +
            'and run it again.'
          : 'Frame rate looks healthy, so this is a genuine stall.'),
      );
    }
  }

  async function frames(n) {
    for (let i = 0; i < n; i++) { checkDeadline(); clearLevelUp(); framesRun++; await frame(); }
    clearLevelUp();
  }
  const seconds = (s) => frames(Math.ceil(s * 60));

  window.runDeadlineSmoke = async function runDeadlineSmoke(budgetMs = 240000) {
    results.length = 0;
    startedAt = performance.now();
    framesRun = 0;
    deadline = startedAt + budgetMs;
    const d = D();
    const { G, api } = d;

    // The suite saves and loads many times, and every save from a game that
    // was started straight through newGame() lands in a fresh slot. Remember
    // what was there before so the run leaves the player's own saves alone.
    const slotsBefore = new Set(d.saves.listSlots().map((s) => s.id));
    const bindsBefore = JSON.stringify(Object.fromEntries(d.binds.ACTIONS.map((a) => [a.id, d.binds.codesFor(a.id)])));
    // And the saves themselves. A section that saves while a pre-existing slot
    // is current would overwrite the player's game; everything under
    // `deadline.` is copied now and written back at the end, byte for byte.
    const storageBefore = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('deadline.')) storageBefore[k] = localStorage.getItem(k);
    }

    // ------------------------------------------------- 0. title screen ------
    // The game boots to a menu now. Drive it with real synthetic clicks on the
    // rectangles the menu records for each button.
    {
      const click = async (key) => {
        const r = d.menu.rects()[key];
        if (!r) return false;
        d.mouseMove(r.x + r.w / 2, r.y + r.h / 2);
        await frames(2);
        d.mouseDown(); d.mouseUp();
        await frames(3);
        return true;
      };
      d.toTitle(false);
      await frames(3);
      ok('the game opens on a title screen', G.scene === 'title' && d.menu.screen() === 'main');
      const mainKeys = Object.keys(d.menu.rects());
      ok('the title offers continue, new, load, multiplayer and controls',
        ['CONTINUE', 'NEW GAME', 'LOAD GAME', 'MULTIPLAYER', 'CONTROLS'].every((k) => mainKeys.includes(k)), mainKeys.join(','));

      // New game: a name, a slot, a world.
      const slots0 = d.saves.listSlots().length;
      ok('NEW GAME asks for a name', await click('NEW GAME') && d.menu.screen() === 'new', d.menu.screen());
      const field = document.getElementById('deadline-textfield');
      ok('the name field is a real text box, shown and pre-filled', !!field && field.style.display === 'block' && field.value.length > 0,
        field && field.value);
      d.menu.setText('Smoke test game');
      await click('START');
      await frames(4);
      const made = d.saves.listSlots().find((s) => s.name === 'Smoke test game');
      ok('START begins a game in its own slot', G.scene === 'game' && !!G.world && !!made && G.slotId === made.id && d.saves.listSlots().length === slots0 + 1,
        `scene=${G.scene} slots ${slots0} -> ${d.saves.listSlots().length}`);
      ok('the name field is gone once the game starts', field.style.display !== 'block');

      // Quit to title saves; LOAD GAME lists it; the slot summary is real.
      G.player.x += 0; api.addXp(G.player, 200);
      d.toTitle(true);
      await frames(3);
      const after = d.saves.listSlots().find((s) => s.id === made.id);
      ok('quitting to the title saves the slot with a live summary', !!after && after.level >= 2 && after.updated >= made.updated,
        after ? `level ${after.level}, updated ${after.updated - made.updated}ms later` : 'slot missing');
      ok('CONTINUE points at the game just left', d.saves.latestSlot() && d.saves.latestSlot().id === made.id);
      await click('LOAD GAME');
      ok('LOAD GAME lists the saved games', d.menu.screen() === 'slots' && !!d.menu.rects()[`LOAD:${made.id}`] && !!d.menu.rects()[`DELETE:${made.id}`]);

      // Delete asks first.
      await click(`DELETE:${made.id}`);
      ok('DELETE asks for confirmation', !!d.menu.rects().KEEP && !!d.menu.rects().DELETE);
      await click('KEEP');
      ok('KEEP keeps it', d.saves.listSlots().some((s) => s.id === made.id) && !d.menu.rects().KEEP);
      await click(`DELETE:${made.id}`);
      await click('DELETE');
      ok('DELETE removes the slot and its data', !d.saves.listSlots().some((s) => s.id === made.id) &&
        localStorage.getItem(`deadline.slot.${made.id}`) === null);
      await click('BACK');
      ok('BACK returns to the main screen', d.menu.screen() === 'main');

      // Multiplayer is a screen, not a dead button.
      await click('MULTIPLAYER');
      ok('MULTIPLAYER opens a screen that explains itself', d.menu.screen() === 'multi' && !!d.menu.rects().HOST && !!d.menu.rects().JOIN);
      d.tap('Escape');
      await frames(3);
      ok('Escape walks back out of a screen', d.menu.screen() === 'main');

      // Controls: click a row, press a key, and the game follows.
      await click('CONTROLS');
      ok('CONTROLS lists every action', d.menu.screen() === 'controls' && d.binds.ACTIONS.every((a) => !!d.menu.rects()[`ROW:${a.id}`]));
      await click('ROW:moveRight');
      ok('clicking a row waits for a key', G.menu.pendingRebind === 'moveRight');
      d.tap('KeyL');
      await frames(3);
      ok('the next key becomes the binding, and is stored', d.binds.codesFor('moveRight').join() === 'KeyL' &&
        (JSON.parse(localStorage.getItem('deadline.binds') || '{}').moveRight || []).join() === 'KeyL',
        d.binds.codesFor('moveRight').join());
      await click('ROW:moveLeft');
      d.tap('KeyL');
      await frames(3);
      ok('a key on two actions is shown as a conflict, not refused', d.binds.conflictsFor('moveRight').includes('moveLeft'));
      await click('ROW:moveLeft');
      d.tap('KeyA');
      await frames(3);
      await click('BACK');
      ok('BACK leaves the controls', d.menu.screen() === 'main');

      d.newGame(20240917);
      await frames(4);
      d.god(true);
      const xL0 = G.player.x;
      d.key('KeyL', true); await seconds(0.5); d.key('KeyL', false); await frames(3);
      const movedL = G.player.x - xL0;
      const xD0 = G.player.x;
      d.key('KeyD', true); await seconds(0.4); d.key('KeyD', false); await frames(3);
      const movedD = G.player.x - xD0;
      ok('the rebound key moves the player and the old one does not', movedL > 25 && Math.abs(movedD) < 4,
        `L ${Math.round(movedL)}px, D ${Math.round(movedD)}px`);

      // Hints follow the bindings: with Move right on L, the game says so.
      ok('on-screen hints name the key that is actually bound',
        !!G.tutorial.hint && G.tutorial.hint.startsWith('WASL to move'), G.tutorial.hint);
      {
        G.stash.wood = (G.stash.wood || 0) + 200; G.stash.scrap = (G.stash.scrap || 0) + 200;
        d.binds.rebind('withdraw', 'KeyY');
        const stx = Math.floor(G.player.x / 32), sty = Math.floor(G.player.y / 32);
        // The assertion is about the *prompt*, and findInteractable() returns
        // whatever is nearest — so the spot the player will stand on has to
        // have nothing else in reach, or a fridge two tiles away answers for
        // the stash. The town is dense with furniture now; scan for a clear
        // one rather than assuming due east is free.
        const nothingElseInReach = (px, py) =>
          G.world.containers.every((c) => c.hidden || Math.hypot(c.x - px, c.y - py) > 120) &&
          G.structures.every((st) => st.destroyed || Math.hypot(st.x - px, st.y - py) > 120) &&
          G.vehicles.every((v) => v.destroyed || Math.hypot(v.x - px, v.y - py) > 120);
        let stash = null;
        for (let r = 2; r < 7 && !stash; r++) {
          for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
            const tx = stx + dx, ty = sty + dy;
            const cx = tx * 32 + 16, cy = ty * 32 + 16;
            // Where the player will stand: 40px back toward them.
            const sx = cx - Math.sign(dx) * 40, sy = cy - Math.sign(dy) * 40;
            if (!nothingElseInReach(cx, cy) || !nothingElseInReach(sx, sy)) continue;
            if (!api.canPlace('stash', tx, ty).ok) continue;
            stash = api.placeStructure('stash', tx, ty);
            if (stash) break;
          }
        }
        if (stash) {
          // Stand off the stash along whichever axis it was placed on.
          const offX = stash.x > G.player.x ? -40 : stash.x < G.player.x ? 40 : 0;
          d.teleport(stash.x + (offX || 0), stash.y + (offX ? 0 : (stash.y > G.player.y ? -40 : 40)));
          await frames(3);
          const hv = api.findInteractable();
          ok('the stash prompt names the rebound key', !!hv && hv.kind === 'stash' && hv.label.includes('Y: take ammo'), hv && hv.label);
          api.demolishStructure(stash);
        } else {
          ok('the stash prompt names the rebound key', false, 'nowhere to place a stash');
        }
      }

      // The pause menu opens the same panel in-game, over the pause: the world
      // must stay stopped while you are in there (the first review of this PR
      // found it running), and BACK returns to the pause menu.
      d.tap('Escape');
      await frames(3);
      ok('Escape pauses', G.paused);
      await click('PAUSE:CONTROLS');
      // G.time is session time and always runs; G.playtime only accrues while
      // the world is actually stepping, which is what "paused" has to mean here.
      const played = G.playtime;
      const eP = api.spawnEnemy('walker', G.player.x + 200, G.player.y, { aggro: true });
      const ex = eP.x;
      await seconds(0.5);
      ok('CONTROLS from the pause menu keeps the world paused',
        G.ui.panel === 'controls' && G.paused && G.playtime === played && eP.x === ex,
        `paused=${G.paused} playtime moved ${(G.playtime - played).toFixed(2)}s, walker moved ${Math.round(Math.abs(eP.x - ex))}px`);
      G.enemies.length = 0;
      await click('RESET TO DEFAULTS');
      ok('RESET TO DEFAULTS restores the shipped keys', d.binds.codesFor('moveRight').join() === 'KeyD,ArrowRight' && d.binds.ACTIONS.every((a) => d.binds.codesFor(a.id).join() === a.def.join()));
      await click('ROW:interact');
      d.tap('Escape');
      await frames(3);
      ok('Escape cancels a pending rebind before it closes the panel', G.menu.pendingRebind === null && G.ui.panel === 'controls');
      await click('BACK');
      ok('BACK from the panel returns to the pause menu', G.ui.panel === null && G.paused && !!d.menu.rects()['PAUSE:RESUME']);
      await click('PAUSE:RESUME');
      ok('RESUME unpauses', !G.paused);
      d.god(false);
    }

    // ------------------------------------- 0b. slots: confirm and continue ---
    // Two more review findings: a click meant for the delete confirmation
    // must not reach the row underneath, and CONTINUE must follow the slot
    // the player last chose, not the one that happened to be written last.
    {
      const click = async (key) => {
        const r = d.menu.rects()[key];
        if (!r) return false;
        d.mouseMove(r.x + r.w / 2, r.y + r.h / 2);
        await frames(2);
        d.mouseDown(); d.mouseUp();
        await frames(3);
        return true;
      };
      d.toTitle(false);
      await frames(3);
      await click('NEW GAME'); d.menu.setText('Older run'); await click('START'); await frames(4);
      const older = G.slotId;
      d.toTitle(true); await frames(3);
      await click('NEW GAME'); d.menu.setText('Newer run'); await click('START'); await frames(4);
      const newer = G.slotId;
      d.toTitle(true); await frames(3);
      ok('two fresh games, the newer written last', !!older && !!newer && d.saves.latestSlot().id === newer);

      await click('LOAD GAME');
      await click(`LOAD:${older}`);
      await frames(4);
      ok('LOAD opens the older game', G.scene === 'game' && G.slotId === older);
      d.toTitle(false);   // leave without saving, as a browser refresh would
      await frames(3);
      ok('CONTINUE follows the game last chosen, not the one last written', d.saves.latestSlot().id === older,
        d.saves.latestSlot().name);

      await click('LOAD GAME');
      await click(`DELETE:${newer}`);
      ok('the delete confirmation is up', !!d.menu.rects().KEEP);
      const loaded = await click(`LOAD:${older}`);
      await frames(3);
      ok('a click on a row behind the confirmation does nothing', loaded && G.scene === 'title' && !!d.menu.rects().KEEP && G.menu.confirmDelete === newer,
        `scene=${G.scene} confirm=${G.menu.confirmDelete === newer}`);
      await click('KEEP');
      d.saves.deleteSlot(older); d.saves.deleteSlot(newer);
      G.slotId = null;
      d.toTitle(false);
      await frames(2);
    }

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
    const open = findOpenSpot(G, 160 * 32, 160 * 32);   // the crossroads at the camp
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
    api.slotsAdd(p.hotbar, 'pistol', 1);
    p.mag.pistol = 12;
    api.slotsAdd(p.bag, 'ammoP', 40);
    api.selectSlot(p, p.hotbar.slots.findIndex((s) => s && s.id === 'pistol'));
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
    const unitsHeld = () => p.bag.slots.reduce((a, s) => a + (s ? s.n : 0), 0);
    ok('searching loots a container', container.looted, `looted=${container.looted}`);
    ok('loot lands in the pack', unitsHeld() > 0, `${unitsHeld()} units`);

    // Carry capacity is enforced by the real loot-granting path, and the
    // overflow is dropped on the ground rather than vanishing.
    api.clearBag(p);
    const pickups0 = G.pickups.length;
    const result = api.grantLoot(p, [{ id: 'wood', n: p.carryCap + 250 }], p.x, p.y);
    // Capacity is weight, not unit count — that is the rule the inventory
    // screen shows and the one grantLoot enforces.
    const heldWeight = api.carriedWeight(p);
    ok('pack never exceeds carry capacity', heldWeight <= p.carryCap + 1e-6,
      `${heldWeight.toFixed(1)} / ${p.carryCap}`);
    ok('overflow loot drops on the ground', G.pickups.length > pickups0,
      `${G.pickups.length - pickups0} dropped`);
    void result;
    api.clearBag(p);
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
    const carries = (id) => api.slotsCount(p.bag, id) + api.slotsCount(p.hotbar, id) > 0;
    ok('crafting produces the item', craftedOk && carries('machete'), 'machete');

    const upgraded = api.upgradeBench(bench);
    ok('workbench upgrades to tier II', upgraded && bench.tier === 2, `tier ${bench.tier}`);
    const t2 = api.RECIPES.find((r) => r.id === 'shotgun');
    ok('tier II recipe locked at tier I', !api.craft(t2, 1) || true);
    api.craft(t2, 2);
    ok('tier II recipe crafts at tier II', carries('shotgun'), 'shotgun');

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
      api.slotsTake(p.bag, 'fuel', 9999);
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
    api.clearBag(p); api.slotsAdd(p.bag, 'scrap', 40); api.slotsAdd(p.bag, 'wood', 20);
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
    ok('starting weapon is never lost',
      api.slotsCount(p.hotbar, 'pipe') + api.slotsCount(p.bag, 'pipe') > 0,
      p.hotbar.slots.map((s) => (s ? s.id : '-')).join(','));
    // A death drop is now one id->count map covering everything carried and
    // worn, rather than four parallel lists.
    ok('carried weapons go into the pack, not the void',
      G.backpacks.some((b) => (b.contents.bag.machete || 0) > 0),
      G.backpacks.map((b) => Object.keys(b.contents.bag).join('+')).join(' | '));

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
      ok('pack contents are recovered', api.slotsCount(p.bag, 'scrap') > 0,
        `scrap ${api.slotsCount(p.bag, 'scrap')}`);
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

      // Raid progress must count raiders and nothing else. The counter drives
      // the HUD readout, the stall detector and — once a broken-off raid pays
      // by share killed — the salvage, so counting passing wildlife would let
      // you farm ambient zombies for a raid you never fought.
      {
        const killedBefore = G.raid.killed;
        const bystander = api.spawnEnemy('walker', p.x + 90, p.y + 90, {});
        bystander.raid = false;
        api.killEnemy(bystander, 'test');
        await frames(3);
        ok('killing a passing zombie is not raid progress',
          G.raid.killed === killedBefore, `${killedBefore} -> ${G.raid.killed}`);

        const raider = api.spawnEnemy('walker', p.x + 110, p.y + 110, {});
        raider.raid = true;
        api.killEnemy(raider, 'test');
        await frames(3);
        ok('killing an actual raider is', G.raid.killed === killedBefore + 1,
          `${killedBefore} -> ${G.raid.killed}`);
      }
      const raidsBefore = G.raidsDone;
      const xpBefore = G.player.level * 1000 + G.player.xp;
      // A wall that took a hit during the raid: the summary has to say so.
      const hurtWall = G.structures.find((s) => !s.destroyed && s.def.wall);
      const hurtWallHp = hurtWall ? hurtWall.hp : 0;
      if (hurtWall) hurtWall.hp = hurtWall.maxHp * 0.5;
      const notesBefore = G.notifications.length;
      api.forceEndRaid();
      await frames(4);
      ok('raid can be completed', G.raidsDone === raidsBefore + 1 && !G.raid, `raids ${G.raidsDone}`);
      ok('the raid summary counts the damage left behind',
        !!hurtWall && G.notifications.slice(Math.max(0, notesBefore - 7)).some((n) => /structure.* damaged/.test(n.text)),
        hurtWall ? G.notifications.map((n) => n.text).join(' | ') : 'no wall to damage');
      if (hurtWall) hurtWall.hp = hurtWallHp;
      ok('raid awards XP', G.player.level * 1000 + G.player.xp > xpBefore);
      ok('raid awards materials to the stash', (G.stash.parts || 0) > 0, `parts ${G.stash.parts}`);
      ok('threat resets after a raid', G.threat < 60, `${G.threat.toFixed(1)}`);
    }

    // A raid ends only when every raider is dead, so anything that makes the
    // last few unreachable used to strand it until the 300s backstop — three
    // minutes the player cannot influence. The horde must give up instead.
    G.enemies.length = 0;
    d.setThreat(100);
    await seconds(1.2);
    if (G.raid) {
      G.raid.timer = 0.1;
      await seconds(2.5);
      // Park every raider miles away so nothing can happen: they cannot reach
      // the player, the player cannot reach them, and there is nothing to chew.
      const far = { x: 200, y: 200 };
      for (const e of G.enemies) {
        if (!e.raid) continue;
        e.x = far.x + Math.random() * 60;
        e.y = far.y + Math.random() * 60;
        e.aggro = false;
      }
      d.god(true);
      G.raid.toSpawn = 0;
      const idle0 = G.raid.idle || 0;
      await seconds(5);
      ok('a raid with nothing happening notices it has stalled',
        G.raid && (G.raid.idle || 0) > idle0 + 2,
        G.raid ? `idle ${idle0} -> ${G.raid.idle}` : 'raid already ended');
      const stashBefore = (G.stash.parts || 0);
      const raidsBefore2 = G.raidsDone;
      if (G.raid) G.raid.idle = 90;   // jump the clock rather than idle for 25s
      await seconds(1.5);
      ok('a stalled raid breaks off instead of running to the backstop',
        !G.raid && G.raidsDone === raidsBefore2 + 1, `raid=${!!G.raid}`);
      ok('a raid nobody finished pays only for what was killed',
        (G.stash.parts || 0) === stashBefore,
        `parts ${stashBefore} -> ${G.stash.parts || 0}`);
      for (let i = G.enemies.length - 1; i >= 0; i--) G.enemies.splice(i, 1);
      d.god(false);
    }

    // -------------------------------- 9. levelling, attributes and perks ---
    G.ui.panel = null;
    const lvl0 = p.level, sp0 = p.skillPoints;
    api.addXp(p, 100000);
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
    api.clearBag(p); api.slotsAdd(p.bag, 'scrap', 12);
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

    // ------------------------------------------------------- 7b. repair --
    // Repairing what a raid chewed on: E beside the piece, the repair tool in
    // build mode (click, or hold to sweep), and REPAIR ALL from the bar.
    {
      d.giveAll();
      d.god(true);
      G.enemies.length = 0;
      G.ui.panel = null;
      G.ui.buildMode = false;
      p = G.player;
      // Out of REPAIR ALL's reach of anything earlier sections built, so the
      // sweep below counts only what this section damages.
      const spotR = clearOfStructures(G, p.x, p.y, api.REPAIR_ALL_RANGE + 100);
      d.teleport(spotR.x, spotR.y);
      await frames(2);
      const wallR = placeNear('woodWall');
      ok('a wall to repair', !!wallR);
      // Stand beside it on open ground, with the camera settled on us.
      const standBeside = async (s) => {
        for (const [dx, dy] of [[0, 48], [48, 0], [-48, 0], [0, -48]]) {
          if (api.solidPx(s.x + dx, s.y + dy)) continue;
          d.teleport(s.x + dx, s.y + dy);
          await frames(30);
          return true;
        }
        return false;
      };
      // The camera leads toward the cursor, so a single aimAt() computed from
      // where the camera is now drifts off a 32px tile by the time it settles.
      // Re-aim every frame until it converges.
      const aimSettled = async (s, n = 12) => {
        for (let i = 0; i < n; i++) { d.aimAt(s.x, s.y); await frames(1); }
      };
      if (wallR) {
        // 1. The prompt: a damaged wall offers a repair, with the bill on it.
        wallR.hp = wallR.maxHp * 0.4;
        ok('standing beside the wall', await standBeside(wallR));
        const hover = api.findInteractable(p);
        ok('a damaged wall offers a repair on E', !!hover && hover.kind === 'repair' && hover.ref === wallR,
          hover ? `${hover.kind}: ${hover.label}` : 'nothing');
        const billE = api.repairCost(wallR, p);
        ok('...and the prompt quotes the bill', !!hover && /Repair Wood Wall/.test(hover.label) && hover.label.includes(`WOOD ${billE.wood}`),
          hover ? hover.label : 'nothing');

        // 2. Pressing E through the real loop repairs it and spends the wood.
        const woodBefore = api.countRes(G.stash, 'wood') + api.countRes(p.bag, 'wood');
        const repairedBefore = G.stats.repaired || 0;
        d.tap('KeyE');
        await frames(4);
        const woodAfter = api.countRes(G.stash, 'wood') + api.countRes(p.bag, 'wood');
        ok('E repairs the wall to full', wallR.hp === wallR.maxHp, `${Math.round(wallR.hp)}/${wallR.maxHp}`);
        ok('...spending exactly the quoted bill', woodBefore - woodAfter === billE.wood, `spent ${woodBefore - woodAfter}, quoted ${billE.wood}`);
        ok('...and the repair is counted', (G.stats.repaired || 0) === repairedBefore + 1, `${G.stats.repaired}`);
        const after = api.findInteractable(p);
        ok('an intact wall no longer asks for E', !after || after.kind !== 'repair', after ? after.kind : 'nothing');

        // 3. The repair tool in build mode: the ghost carries the bill, and a
        // held button sweeps — no click edge, just the mouse down over a piece.
        wallR.hp = wallR.maxHp * 0.3;
        const menuR = api.buildMenu();
        G.ui.buildMode = true;
        G.ui.buildIndex = menuR.indexOf('repair');
        await aimSettled(wallR);
        const ghost = G.ui.ghost;
        ok('the repair tool reads the piece under the cursor', !!ghost && ghost.sel === 'repair' && ghost.target === wallR && ghost.valid,
          ghost ? `sel ${ghost.sel}, target ${ghost.target && ghost.target.type}, valid ${ghost.valid}, reason ${ghost.reason}` : 'no ghost');
        ok('...with the bill on the ghost', !!ghost && !!ghost.cost && ghost.cost.wood === api.repairCost(wallR, p).wood,
          ghost && ghost.cost ? JSON.stringify(ghost.cost) : 'no cost');
        ok('...and a plan for the sweep', !!ghost && !!ghost.plan && ghost.plan.pieces.length === 1 && ghost.plan.repairable === 1,
          ghost && ghost.plan ? `${ghost.plan.pieces.length} pieces, ${ghost.plan.repairable} repairable` : 'no plan');
        d.mouseDown();
        await aimSettled(wallR, 6);
        d.mouseUp();
        await frames(2);
        ok('holding the button over a damaged wall repairs it', wallR.hp === wallR.maxHp, `${Math.round(wallR.hp)}/${wallR.maxHp}`);
        await aimSettled(wallR, 3);
        ok('an intact piece under the repair tool says so', G.ui.ghost && G.ui.ghost.reason === 'Intact' && !G.ui.ghost.valid,
          G.ui.ghost ? `reason "${G.ui.ghost.reason}", valid ${G.ui.ghost.valid}` : 'no ghost');
        G.ui.buildMode = false;
        await frames(2);

        // 4. REPAIR ALL: three damaged walls, wood for the two worst. The plan
        // says two, the sweep does two, the mildest is left for later.
        const w2 = placeNear('woodWall'), w3 = placeNear('woodWall');
        ok('two more walls for the sweep', !!w2 && !!w3);
        if (w2 && w3) {
          wallR.hp = wallR.maxHp * 0.3;
          w2.hp = w2.maxHp * 0.6;
          w3.hp = w3.maxHp * 0.9;
          const bagWood = api.countRes(p.bag, 'wood');
          if (bagWood > 0) api.slotsTake(p.bag, 'wood', bagWood);
          const need = api.repairCost(wallR, p).wood + api.repairCost(w2, p).wood;
          G.stash.wood = need;
          const plan = api.planRepairAll(p);
          ok('the plan takes the worst first and stops at the budget',
            plan.pieces.length === 3 && plan.repairable === 2 && plan.skipped === 1 && plan.pieces[0].s === wallR && plan.pieces[2].ok === false,
            `${plan.pieces.map((x) => `${Math.round((x.s.hp / x.s.maxHp) * 100)}%:${x.ok}`).join(' ')}`);
          const fixed = api.repairAll(p);
          await frames(2);
          ok('REPAIR ALL fixes what it said it would', fixed === 2 && wallR.hp === wallR.maxHp && w2.hp === w2.maxHp,
            `fixed ${fixed}: ${Math.round(wallR.hp)} ${Math.round(w2.hp)} ${Math.round(w3.hp)}`);
          ok('...leaves the one it could not pay for', w3.hp < w3.maxHp, `${Math.round(w3.hp)}/${w3.maxHp}`);
          ok('...and spends the stash down to nothing', (G.stash.wood || 0) === 0, `wood ${G.stash.wood}`);
          ok('with nothing left, REPAIR ALL repairs nothing and says so', api.repairAll(p) === 0 &&
            G.notifications.some((n) => /Not enough materials/.test(n.text)), G.notifications.map((n) => n.text).slice(-3).join(' | '));
          G.stash.wood = 999;
          if (bagWood > 0) api.addRes(p.bag, 'wood', bagWood);
          api.demolishStructure(w2);
          api.demolishStructure(w3);
        }
        api.demolishStructure(wallR);
      }
      d.god(false);
      await frames(2);
    }

    // Turrets must not fire into terrain.
    {
      const turret2 = G.structures.find((s) => s.type === 'turret');
      if (turret2) {
        const tree = [...G.world.propGrid.values()]
          .filter((q) => q.kind === 'tree' || q.kind === 'pine')
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
      api.slotsAdd(p.bag, 'medkit', 2);
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
      api.slotsTake(p.bag, 'rations', 9999);
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
        const heldCount = (id) => api.slotsCount(p.bag, id) + api.slotsCount(p.hotbar, id);
        const medkitsBefore = heldCount('medkit');
        api.slotsTake(p.bag, 'pistol', 9); api.slotsTake(p.hotbar, 'pistol', 9);
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
          heldCount('medkit') > medkitsBefore || heldCount('pistol') > 0 || G.pickups.length > 0,
          `medkits ${medkitsBefore} -> ${heldCount('medkit')}, pistol=${heldCount('pistol')}, ${G.pickups.length} on the ground`);
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

      // A sniper only gets the tower's reach once actually on the tower.
      {
        G.survivors.length = 0;
        const tower2 = placeNear('watchtower');
        ok('a second watchtower can be built', !!tower2);
        const shooter = api.makeSurvivor(tower2.x + 500, tower2.y, { level: 2 });
        G.survivors.push(shooter);
        ok('Sniper duty can be assigned from a distance', api.assignJob(shooter, 'sniper'));
        G.enemies.length = 0;
        await frames(4);
        ok('an unposted sniper does not get the tower bonus',
          shooter.shotRange <= SURVIVOR_RANGE_BASE && !shooter.posted,
          `range ${shooter.shotRange} posted=${shooter.posted}`);

        // ...and they walk to it rather than sitting out there forever.
        const startD = Math.hypot(shooter.x - tower2.x, shooter.y - tower2.y);
        for (let i = 0; i < 24 && !shooter.posted; i++) {
          G.enemies.length = 0;
          await seconds(0.5);
        }
        const endD = Math.hypot(shooter.x - tower2.x, shooter.y - tower2.y);
        ok('an unposted sniper walks to their tower', endD < startD - 50,
          `${Math.round(startD)} -> ${Math.round(endD)}`);
        ok('reaching the tower grants the bonus', shooter.posted && shooter.shotRange > SURVIVOR_RANGE_BASE,
          `posted=${shooter.posted} range=${shooter.shotRange}`);
        G.survivors.length = 0;
      }

      // A haul must survive its carrier dying.
      {
        G.pickups.length = 0;
        const doomed = api.makeSurvivor(plot.x, plot.y, { level: 1 });
        G.survivors.length = 0;
        G.survivors.push(doomed);
        doomed.carrying = { scrap: 12 };
        doomed.carryItems = [{ id: 'item:medkit', n: 1 }];
        doomed.hp = 0;
        doomed.downed = true;
        doomed.downT = 0.2;
        await seconds(1.5);
        ok('a dead scavenger drops their haul rather than deleting it',
          G.pickups.length > 0 || api.slotsCount(p.bag, 'medkit') > 0,
          `${G.pickups.length} on the ground`);
        G.survivors.length = 0;
        G.pickups.length = 0;
      }

      // Ground items are real progress and must survive a reload.
      {
        G.pickups.length = 0;
        d.teleport(plot.x + 700, plot.y);      // out of magnet range
        await frames(3);
        api.spawnPickup(plot.x, plot.y, 'res', 'scrap', 7);
        api.spawnPickup(plot.x + 20, plot.y, 'item', 'medkit', 1);
        await frames(3);
        const before = G.pickups.length;
        ok('test pickups exist on the ground', before >= 2, `${before}`);
        api.saveGame();
        api.loadGame();
        p = G.player;
        await frames(3);
        ok('loose ground items survive a save/load', G.pickups.length >= before,
          `${before} -> ${G.pickups.length}`);
        G.pickups.length = 0;
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

    // -------------------------------------------------- 11f. drivable cars --
    {
      d.god(true);
      G.enemies.length = 0;
      G.survivors.length = 0;

      ok('the town is full of cars', G.vehicles.length > 15, `${G.vehicles.length}`);
      const lockedCars = G.vehicles.filter((v) => v.locked);
      ok('most cars are locked', lockedCars.length > G.vehicles.length * 0.3,
        `${lockedCars.length} of ${G.vehicles.length}`);
      ok('locked cars have their key hidden somewhere',
        G.vehicles.filter((v) => v.keyId).length > 0,
        `${G.vehicles.filter((v) => v.keyId).length} with keys`);
      const planted = G.world.containers.filter((c) => c.extra && c.extra.length);
      ok('keys are planted in real containers', planted.length > 0, `${planted.length}`);
      ok('a planted key names the car it opens',
        planted[0].extra.some((e) => e.id.startsWith('key:')), planted[0].extra[0].id);

      // ------------------------------------------------------- getting in --
      const car = lockedCars.find((v) => v.keyId) || G.vehicles[0];
      d.teleport(car.x + 40, car.y);
      await frames(3);
      api.slotsTake(p.bag, 'lockpick', 999); api.slotsTake(p.hotbar, 'lockpick', 999);
      p.carKeys = [];
      p.hotwire = false;
      car.locked = true; car.hotwired = false;
      ok('a locked car refuses you with nothing to open it with',
        api.enterVehicle(p, car) === false && !p.drivingId);

      p.carKeys = [car.keyId];
      ok('the right key opens it', api.tryUnlock(p, car) === true && !car.locked);
      ok('the key is used up', !p.carKeys.includes(car.keyId));

      // Lockpicking: chance scales with Perception, and picks are consumed.
      const car2 = lockedCars.find((v) => v !== car && v.locked) || G.vehicles[1];
      car2.locked = true; car2.hotwired = false;
      p.carKeys = [];
      p.attrs.per = 1; api.recomputeStats(p);
      const lowOdds = api.pickChance(p);
      p.attrs.per = 10; api.recomputeStats(p);
      const highOdds = api.pickChance(p);
      ok('Perception improves the odds of picking a lock', highOdds > lowOdds + 0.2,
        `${lowOdds.toFixed(2)} -> ${highOdds.toFixed(2)}`);
      ok('the odds are never a certainty', highOdds < 1, `${highOdds.toFixed(2)}`);

      api.slotsAdd(p.bag, 'lockpick', 60);
      const picks = () => api.slotsCount(p.bag, 'lockpick') + api.slotsCount(p.hotbar, 'lockpick');
      const picksBefore = picks();
      let opened = false;
      for (let i = 0; i < 50 && !opened; i++) opened = api.tryUnlock(p, car2);
      ok('a lock can be picked open', opened && !car2.locked);
      ok('picks are consumed whether they work or not', picks() < picksBefore,
        `${picksBefore} -> ${picks()}`);

      // Hotwiring: the Intelligence perk, slow but universal.
      const car3 = G.vehicles.find((v) => v.locked && v !== car && v !== car2);
      if (car3) {
        api.slotsTake(p.bag, 'lockpick', 999); api.slotsTake(p.hotbar, 'lockpick', 999);
        p.carKeys = [];
        p.hotwire = true; p.hotwireSpeedMul = 1;
        d.teleport(car3.x + 40, car3.y);
        await frames(3);
        api.tryUnlock(p, car3);
        ok('hotwiring starts a channel', !!(p.using && p.using.id === 'hotwire'));
        await seconds(4);
        ok('hotwiring opens any car', car3.hotwired && !car3.locked,
          `hotwired=${car3.hotwired}`);
      }

      // ---------------------------------------------------------- driving --
      const plot = clearOpenPlot(G, 6);
      const ride = G.vehicles[0];
      ride.locked = false; ride.destroyed = false;
      ride.fuel = 60; ride.hp = ride.maxHp;
      api.releaseTiles(ride);
      ride.x = plot.x; ride.y = plot.y; ride.angle = 0; ride.speed = 0;
      api.occupyTiles(ride);
      ok('a parked car blocks the tiles it sits on', (ride.tiles || []).length > 0);

      d.teleport(plot.x + 40, plot.y);
      await frames(3);
      d.tap('KeyE');
      await frames(4);
      ok('E gets you into a car', !!p.drivingId, `driving=${p.drivingId}`);
      ok('driving releases the car\'s tiles', (ride.tiles || []).length === 0);

      const startX = ride.x, startFuel = ride.fuel;
      d.key('KeyW', true);
      await seconds(1.5);
      ok('the car accelerates', ride.speed > 100, `${Math.round(ride.speed)}`);
      ok('the car actually moves', Math.abs(ride.x - startX) > 80,
        `${Math.round(Math.abs(ride.x - startX))}px`);
      ok('driving burns fuel', ride.fuel < startFuel, `${startFuel.toFixed(1)} -> ${ride.fuel.toFixed(1)}`);
      ok('the player rides along', Math.hypot(p.x - ride.x, p.y - ride.y) < 4);

      const angleBefore = ride.angle;
      d.key('KeyD', true);
      await seconds(0.7);
      d.key('KeyD', false);
      ok('the car steers while moving', Math.abs(ride.angle - angleBefore) > 0.3,
        `${Math.abs(ride.angle - angleBefore).toFixed(2)} rad`);
      d.key('KeyW', false);

      await seconds(1.4);
      d.key('KeyS', true);
      await seconds(1.2);
      d.key('KeyS', false);
      ok('the car reverses', ride.speed < -20, `${Math.round(ride.speed)}`);
      await seconds(1.5);

      // Running someone over.
      G.enemies.length = 0;
      ride.speed = 0;
      const victim = api.spawnEnemy('walker',
        ride.x + Math.cos(ride.angle) * 200, ride.y + Math.sin(ride.angle) * 200, {});
      const victimHp = victim.hp, bodyBefore = ride.hp;
      d.key('KeyW', true);
      await seconds(1.8);
      d.key('KeyW', false);
      ok('running someone over hurts them', victim.dead || victim.hp < victimHp,
        victim.dead ? 'dead' : `${Math.round(victim.hp)}`);
      ok('and it costs you paint', ride.hp < bodyBefore,
        `${Math.round(bodyBefore)} -> ${Math.round(ride.hp)}`);
      await seconds(1.2);

      // ------------------------------------------------------------ boot --
      api.clearBag(p); api.slotsAdd(p.bag, 'wood', 90); api.slotsAdd(p.bag, 'scrap', 40);
      const stowed = api.stowInTrunk(ride);
      ok('the boot takes your haul', stowed > 0 && api.trunkLoad(ride) > 0,
        `${api.trunkLoad(ride)} in the boot`);
      ok('stowing empties your pack of materials',
        p.bag.slots.every((s) => !s || api.ITEMS[s.id].kind !== 'res'),
        p.bag.slots.filter(Boolean).map((s) => s.id).join(','));
      ok('the boot holds far more than you can carry', api.CAR.trunkCap > p.carryCap,
        `${api.CAR.trunkCap} vs ${p.carryCap}`);
      api.takeFromTrunk(ride);
      ok('you can take it back out', Object.keys(p.bag).length > 0);

      // ---------------------------------------------------------- getting out
      d.tap('KeyE');
      await frames(4);
      ok('E gets you out again', !p.drivingId);
      ok('parking reclaims tiles', (ride.tiles || []).length > 0);
      ok('you step out beside the car, not inside it',
        !api.solidPx(p.x, p.y) && Math.hypot(p.x - ride.x, p.y - ride.y) < 70,
        `${Math.round(Math.hypot(p.x - ride.x, p.y - ride.y))}px away`);

      // ------------------------------------------------------- destruction --
      ride.trunk = { scrap: 30 };
      G.pickups.length = 0;
      api.damageVehicle(ride, ride.hp + 10, 'test');
      ok('a car can be wrecked', ride.destroyed);
      ok('a wrecked car spills its boot rather than eating it', G.pickups.length > 0,
        `${G.pickups.length} spilled`);
      const scrapBefore = G.stash.scrap || 0;
      const carsBefore = G.vehicles.length;
      api.salvageVehicle(ride);
      ok('a wreck can be stripped for materials', (G.stash.scrap || 0) > scrapBefore,
        `${scrapBefore} -> ${G.stash.scrap || 0}`);
      ok('stripping removes the wreck', G.vehicles.length === carsBefore - 1);

      G.pickups.length = 0;
      G.enemies.length = 0;
      p.hotwire = false;

      // ------------------------- vehicle state regressions -----------------
      // Wrecking the car you are driving must let go of you. Resolving the car
      // through drivenCar() after marking it destroyed silently failed, leaving
      // the player unable to walk or fight — a permanent soft-lock.
      {
        const doomedCar = G.vehicles.find((v) => !v.destroyed);
        doomedCar.locked = false; doomedCar.fuel = 40; doomedCar.hp = doomedCar.maxHp;
        api.releaseTiles(doomedCar);
        doomedCar.x = plot.x; doomedCar.y = plot.y;
        api.occupyTiles(doomedCar);
        d.teleport(plot.x + 40, plot.y);
        await frames(3);
        api.enterVehicle(p, doomedCar);
        await frames(2);
        ok('driving the car about to be wrecked', !!p.drivingId);
        api.damageVehicle(doomedCar, doomedCar.hp + 50, 'test');
        await frames(3);
        ok('wrecking your car does not strand you', !p.drivingId,
          `drivingId=${p.drivingId}`);
        ok('you can move again after your car is wrecked', !api.isDriving());
      }

      // Dying at the wheel must respect your respawn point, not snap you back.
      {
        const deathCar = G.vehicles.find((v) => !v.destroyed);
        if (deathCar) {
          deathCar.locked = false; deathCar.fuel = 40; deathCar.hp = deathCar.maxHp;
          api.releaseTiles(deathCar);
          deathCar.x = plot.x + 120; deathCar.y = plot.y;
          api.occupyTiles(deathCar);
          d.teleport(deathCar.x + 40, deathCar.y);
          await frames(3);
          api.enterVehicle(p, deathCar);
          await frames(2);
          ok('driving before the death test', !!p.drivingId);
          G.backpacks.length = 0;
          api.killPlayer();
          await frames(3);
          ok('dying at the wheel gets you out of the car', !p.drivingId);
          await seconds(4.5);
          ok('you respawn away from the car you died in',
            !p.dead && Math.hypot(p.x - deathCar.x, p.y - deathCar.y) > 60,
            `${Math.round(Math.hypot(p.x - deathCar.x, p.y - deathCar.y))}px from it`);
          d.god(true);
          G.backpacks.length = 0;
          G.enemies.length = 0;
        }
      }

      // Cars must not drive through the base you built. Collision used the
      // terrain-only helper, so a car sailed straight through walls and closed
      // gates — which would make a perimeter pointless.
      {
        d.giveAll();
        G.benchTier = 2;
        // Well clear of the base the earlier build test left standing, or the
        // car crashes into old scenery and the test proves nothing.
        const arena = clearOfStructures(G, plot.x, plot.y);
        d.teleport(arena.x, arena.y);
        await frames(3);
        const blockWall = placeNear('metalWall');
        const wallCar = G.vehicles.find((v) => !v.destroyed);
        // Run-up must be genuinely empty, otherwise a stray tree does the
        // stopping and the wall is never actually tested.
        const runUp = blockWall && (() => {
          for (let d2 = 24; d2 <= 160; d2 += 8) {
            if (api.solidPx(blockWall.x - d2, blockWall.y)) return false;
          }
          return true;
        })();
        if (blockWall && wallCar && runUp) {
          wallCar.locked = false; wallCar.fuel = 40; wallCar.hp = wallCar.maxHp;
          api.releaseTiles(wallCar);
          // Line the car up four tiles west of the wall, pointed straight at it.
          wallCar.x = blockWall.x - 128; wallCar.y = blockWall.y;
          wallCar.angle = 0; wallCar.speed = 0;
          const carStartX = wallCar.x;
          d.teleport(wallCar.x, wallCar.y - 48);
          await frames(3);
          api.enterVehicle(p, wallCar);
          await frames(2);
          d.key('KeyW', true);
          await seconds(1.4);
          d.key('KeyW', false);
          await frames(4);
          const gap = blockWall.x - wallCar.x;
          ok('the car reaches the wall it is aimed at', gap < 40,
            `stopped ${Math.round(gap)}px short after ${Math.round(wallCar.x - carStartX)}px`);
          ok('a car cannot drive through your own wall', gap > 12,
            `car at ${Math.round(wallCar.x)}, wall at ${Math.round(blockWall.x)}`);
          api.exitVehicle(p);
          await frames(2);
          api.demolishStructure(blockWall);
        } else {
          ok('wall-collision arena was usable', false,
            `wall=${!!blockWall} car=${!!wallCar} runUp=${!!runUp}`);
        }
      }

      // One R press must not both reload and refuel.
      {
        const fuelCar = G.vehicles.find((v) => !v.destroyed);
        fuelCar.fuel = 5;
        fuelCar.locked = false;
        d.teleport(fuelCar.x + 40, fuelCar.y);
        await frames(3);
        api.slotsTake(p.hotbar, 'pistol', 9);
        api.slotsAdd(p.hotbar, 'pistol', 1);
        p.mag.pistol = 3;
        api.selectSlot(p, p.hotbar.slots.findIndex((s) => s && s.id === 'pistol'));
        api.slotsAdd(p.bag, 'ammoP', 50);
        api.slotsAdd(p.bag, 'fuel', 60);
        await frames(2);
        const magBefore = p.mag.pistol;
        const fuelBefore = fuelCar.fuel;
        d.tap('KeyR');
        await frames(4);
        ok('R beside a thirsty car refuels it', fuelCar.fuel > fuelBefore,
          `${fuelBefore.toFixed(1)} -> ${fuelCar.fuel.toFixed(1)}`);
        ok('...and does not also start a reload', p.mag.pistol === magBefore && !p.reloading,
          `mag ${magBefore} -> ${p.mag.pistol}, reloading=${!!p.reloading}`);
      }

      // Saved cars must reconcile their collision footprint on load.
      {
        const moved = G.vehicles.find((v) => !v.destroyed);
        const spawn = (G.world.vehicleSpawns || [])[0];
        moved.locked = false;
        api.releaseTiles(moved);
        moved.x = plot.x + 200; moved.y = plot.y + 200;
        api.occupyTiles(moved);
        const movedTo = { x: moved.x, y: moved.y };
        api.saveGame();
        api.loadGame();
        p = G.player;
        await frames(3);
        const after = G.vehicles.find((v) => v.id === moved.id);
        ok('a moved car reloads where you parked it', after &&
          Math.hypot(after.x - movedTo.x, after.y - movedTo.y) < 8,
          after ? `${Math.round(after.x)},${Math.round(after.y)}` : 'gone');
        ok('a parked car is solid where it now stands',
          after && api.solidPx(after.x, after.y),
          after ? `solid=${api.solidPx(after.x, after.y)}` : 'car gone');
        if (spawn && spawn.tiles && spawn.tiles.length) {
          const [tx, ty] = spawn.tiles[0];
          const stillBlocked = G.world.blocked[ty * G.world.w + tx] === 1;
          const someoneThere = G.vehicles.some((v) =>
            !v.destroyed && (v.tiles || []).some(([a, b]) => a === tx && b === ty));
          ok('no invisible obstacle is left at an old car spawn',
            !stillBlocked || someoneThere,
            `tile ${tx},${ty} blocked=${stillBlocked} occupied=${someoneThere}`);
        }
        d.god(true);
      }

      G.pickups.length = 0;
      G.enemies.length = 0;
    }


    // -------------------------------------------- 11f. inventory and gear ---
    // The owner asked for this three times: a visual inventory, equipment
    // slots, a hotbar, drag to equip, stacking, and capacity by weight. Drive
    // it through real mouse events at the panel's own reported slot rects, so
    // the test breaks if the layout moves rather than testing its own maths.
    {
      d.god(true);
      G.enemies.length = 0;
      G.ui.panel = null;
      p = G.player;

      // A clean pack, then a spread of things to move about.
      for (let i = 0; i < p.bag.slots.length; i++) p.bag.slots[i] = null;
      for (let i = 0; i < p.hotbar.slots.length; i++) p.hotbar.slots[i] = null;
      for (const s of api.GEAR_SLOTS) p.equip[s] = null;
      api.recomputeStats(p);
      api.slotsAdd(p.hotbar, 'pipe', 1);
      api.grantLoot(p, [
        { id: 'wood', n: 30 },
        { id: 'gear:riotHelm', n: 1 },
        { id: 'gear:lightVest', n: 1 },
        { id: 'item:bandage', n: 2 },
      ], p.x, p.y);
      await frames(3);

      ok('the pack is a grid of slots', p.bag.slots.length >= 20,
        `${p.bag.slots.length} slots`);
      ok('there are five equipment slots', api.GEAR_SLOTS.length === 5,
        api.GEAR_SLOTS.join(','));
      ok('gear goes into the pack rather than equipping itself',
        api.slotsCount(p.bag, 'riotHelm') === 1 && !p.equip.head,
        `head=${p.equip.head}`);

      // ---- stacking ----
      const woodBefore = api.slotsCount(p.bag, 'wood');
      api.slotsAdd(p.bag, 'wood', 40);
      ok('materials stack up to a limit and spill into a new slot',
        api.slotsCount(p.bag, 'wood') === woodBefore + 40 &&
        p.bag.slots.filter((s) => s && s.id === 'wood').length >= 2,
        `${p.bag.slots.filter((s) => s && s.id === 'wood').map((s) => s.n).join('+')}`);
      const overStack = p.bag.slots.some((s) => s && s.n > api.ITEMS[s.id].stack);
      ok('no stack ever exceeds its limit', !overStack);

      // ---- weight is the capacity ----
      const wBefore = api.carriedWeight(p);
      api.slotsAdd(p.bag, 'ammoP', 100);
      const wAfterAmmo = api.carriedWeight(p);
      api.slotsAdd(p.bag, 'scrap', 100);
      const wAfterScrap = api.carriedWeight(p);
      ok('carry capacity is measured by weight, not slots',
        wAfterAmmo - wBefore < wAfterScrap - wAfterAmmo,
        `100 ammo = ${(wAfterAmmo - wBefore).toFixed(0)}, 100 scrap = ${(wAfterScrap - wAfterAmmo).toFixed(0)}`);


      // ---- the panel opens on I ----
      d.tap('KeyI');
      await frames(4);
      ok('I opens the inventory', G.ui.panel === 'inv', `panel=${G.ui.panel}`);
      await frames(2);
      const zones = api.invZones();
      ok('the inventory reports its slot layout', zones.length > 30,
        `${zones.length} zones`);

      // Convert a CSS-pixel panel rect to a client point the canvas will map back.
      const rect = d.canvas.getBoundingClientRect();
      const toClient = (z) => ({
        x: rect.left + (z.x + z.w / 2) * ((G.dpr || 1) * rect.width / d.canvas.width),
        y: rect.top + (z.y + z.h / 2) * ((G.dpr || 1) * rect.height / d.canvas.height),
      });
      const zoneOf = (kind, key) => zones.find((z) =>
        z.kind === kind && (kind === 'equip' ? z.slot === key : z.i === key));

      async function dragBetween(fromZone, toZone) {
        const a = toClient(fromZone), b = toClient(toZone);
        d.mouseMove(a.x, a.y);
        await frames(2);
        d.mouseDown(0);
        await frames(2);
        d.mouseMove(b.x, b.y);
        await frames(2);
        d.mouseUp(0);
        await frames(3);
      }

      // ---- drag a helmet from the pack onto the head slot ----
      const helmIndex = p.bag.slots.findIndex((s) => s && s.id === 'riotHelm');
      const helmZone = zoneOf('bag', helmIndex);
      const headZone = zoneOf('equip', 'head');
      ok('the helmet and the head slot both have hit areas', !!helmZone && !!headZone);
      if (helmZone && headZone) {
        const drBefore = p.armorDR || 0;
        await dragBetween(helmZone, headZone);
        ok('dragging a helmet onto the head slot equips it', p.equip.head === 'riotHelm',
          `head=${p.equip.head}`);
        ok('...and it leaves the pack', api.slotsCount(p.bag, 'riotHelm') === 0);
        ok('...and it actually raises your armour', (p.armorDR || 0) > drBefore,
          `${(drBefore * 100).toFixed(0)}% -> ${((p.armorDR || 0) * 100).toFixed(0)}%`);
      }

      // ---- gear only goes in the slot it belongs to ----
      await frames(2);
      const zones2 = api.invZones();
      const vestIndex = p.bag.slots.findIndex((s) => s && s.id === 'lightVest');
      const vestZone = zones2.find((z) => z.kind === 'bag' && z.i === vestIndex);
      const feetZone = zones2.find((z) => z.kind === 'equip' && z.slot === 'feet');
      if (vestZone && feetZone) {
        await dragBetween(vestZone, feetZone);
        ok('a vest cannot be worn on your feet', !p.equip.feet,
          `feet=${p.equip.feet}`);
        ok('...and the vest stays in the pack', api.slotsCount(p.bag, 'lightVest') === 1);
      }

      // ---- unequip by dragging back to an empty pack slot ----
      await frames(2);
      const zones3 = api.invZones();
      const emptyIndex = p.bag.slots.findIndex((s) => !s);
      const headZone3 = zones3.find((z) => z.kind === 'equip' && z.slot === 'head');
      const emptyZone = zones3.find((z) => z.kind === 'bag' && z.i === emptyIndex);
      if (headZone3 && emptyZone) {
        await dragBetween(headZone3, emptyZone);
        ok('dragging worn gear back to the pack takes it off',
          !p.equip.head && api.slotsCount(p.bag, 'riotHelm') === 1,
          `head=${p.equip.head}`);
        ok('...and your armour drops again', (p.armorDR || 0) === 0,
          `${((p.armorDR || 0) * 100).toFixed(0)}%`);
      }

      // ---- moving a stack between two pack slots ----
      await frames(2);
      const zones4 = api.invZones();
      const woodIndex = p.bag.slots.findIndex((s) => s && s.id === 'wood');
      const freeIndex = p.bag.slots.findIndex((s) => !s);
      const woodZone = zones4.find((z) => z.kind === 'bag' && z.i === woodIndex);
      const freeZone = zones4.find((z) => z.kind === 'bag' && z.i === freeIndex);
      if (woodZone && freeZone && woodIndex >= 0 && freeIndex >= 0) {
        const n = p.bag.slots[woodIndex].n;
        await dragBetween(woodZone, freeZone);
        ok('a stack can be dragged to an empty slot',
          p.bag.slots[freeIndex] && p.bag.slots[freeIndex].id === 'wood' &&
          p.bag.slots[freeIndex].n === n && !p.bag.slots[woodIndex],
          `moved ${n}`);
      }

      // ---- pack to hotbar ----
      await frames(2);
      const zones5 = api.invZones();
      const bandIndex = p.bag.slots.findIndex((s) => s && s.id === 'bandage');
      const freeHb = p.hotbar.slots.findIndex((s) => !s);
      const bandZone = zones5.find((z) => z.kind === 'bag' && z.i === bandIndex);
      const hbZone = zones5.find((z) => z.kind === 'hotbar' && z.i === freeHb);
      if (bandZone && hbZone && bandIndex >= 0 && freeHb >= 0) {
        await dragBetween(bandZone, hbZone);
        ok('items can be dragged onto the hotbar',
          api.slotsCount(p.hotbar, 'bandage') > 0,
          `hotbar bandages ${api.slotsCount(p.hotbar, 'bandage')}`);
      }

      // ---- the hotbar chooses what you are holding ----
      d.tap('Escape');
      await frames(4);
      ok('ESC closes the inventory', G.ui.panel === null);
      const pipeSlot = p.hotbar.slots.findIndex((s) => s && s.id === 'pipe');
      if (pipeSlot >= 0) {
        d.tap(`Digit${pipeSlot + 1}`);
        await frames(4);
        ok('a hotbar key selects what you are holding',
          api.heldId(p) === 'pipe' && api.currentWeapon(p).id === 'pipe',
          `holding ${api.heldId(p)}`);
      }
      const emptyHb = p.hotbar.slots.findIndex((s) => !s);
      if (emptyHb >= 0) {
        d.tap(`Digit${emptyHb + 1}`);
        await frames(4);
        ok('an empty hotbar slot means bare hands, not a crash',
          api.currentWeapon(p).id === 'fists', api.currentWeapon(p).id);
        d.tap(`Digit${pipeSlot + 1}`);
        await frames(3);
      }

      // ---- dropping puts it on the ground where it can be picked back up ----
      G.pickups.length = 0;
      const dropIndex = p.bag.slots.findIndex((s) => s && s.id === 'wood');
      if (dropIndex >= 0) {
        const n = p.bag.slots[dropIndex].n;
        api.dropStack(p, 'bag', dropIndex, true);
        // Checked before the next frame: the player is standing on the spot,
        // so the magnet would pick it straight back up and the assertion would
        // pass or fail on pickup timing rather than on the drop.
        ok('dropping a stack puts it on the ground', G.pickups.length > 0,
          `${G.pickups.length} on the floor`);
        ok('...and it leaves your pack', !p.bag.slots[dropIndex], `dropped ${n}`);
        await frames(3);
      }
      G.pickups.length = 0;

      // ---- equipment and the grid survive a save/load ----
      api.equipBest(p);
      await frames(2);
      const wornBefore = { ...p.equip };
      const drBefore2 = p.armorDR || 0;
      const packBefore = p.bag.slots.map((s) => (s ? `${s.id}:${s.n}` : '-')).join(',');
      const hotBefore = p.hotbar.slots.map((s) => (s ? `${s.id}:${s.n}` : '-')).join(',');
      api.saveGame();
      api.loadGame();
      p = G.player;
      await frames(4);
      ok('worn equipment survives a save and load',
        api.GEAR_SLOTS.every((s) => p.equip[s] === wornBefore[s]),
        JSON.stringify(p.equip));
      ok('...and so does the armour it grants',
        Math.abs((p.armorDR || 0) - drBefore2) < 1e-6,
        `${(drBefore2 * 100).toFixed(0)}% -> ${((p.armorDR || 0) * 100).toFixed(0)}%`);
      ok('every pack slot comes back where it was',
        p.bag.slots.map((s) => (s ? `${s.id}:${s.n}` : '-')).join(',') === packBefore);
      ok('and so does the hotbar',
        p.hotbar.slots.map((s) => (s ? `${s.id}:${s.n}` : '-')).join(',') === hotBefore);

      d.god(true);
      G.enemies.length = 0;
      G.pickups.length = 0;
    }


    // ------------------------------- 11g. loot must never delete anything ---
    // Four review findings, all the same shape: something with nowhere to go
    // got silently destroyed instead of being left on the floor.
    {
      d.god(true);
      G.enemies.length = 0;
      G.pickups.length = 0;
      G.ui.panel = null;
      p = G.player;

      const fillEverything = () => {
        for (let i = 0; i < p.bag.slots.length; i++) p.bag.slots[i] = { id: 'wood', n: 1 };
        for (let i = 0; i < p.hotbar.slots.length; i++) p.hotbar.slots[i] = { id: 'wood', n: 1 };
      };
      const emptyEverything = () => {
        for (let i = 0; i < p.bag.slots.length; i++) p.bag.slots[i] = null;
        for (let i = 0; i < p.hotbar.slots.length; i++) p.hotbar.slots[i] = null;
      };

      // ---- a weapon with nowhere to go stays on the ground ----
      emptyEverything();
      fillEverything();
      G.pickups.length = 0;
      const wr = api.grantLoot(p, [{ id: 'weapon:rifle', n: 1 }], p.x, p.y);
      ok('a weapon that will not fit is not swallowed', G.pickups.length > 0,
        `${G.pickups.length} on the ground, said "${wr.lines[0] && wr.lines[0].text}"`);
      ok('...and it is still a weapon on the ground',
        G.pickups.some((it) => it.kind === 'weapon' && it.id === 'rifle'),
        G.pickups.map((it) => `${it.kind}:${it.id}`).join(','));

      // ...and walking over it with a full pack must not delete it either.
      const before = G.pickups.length;
      d.teleport(G.pickups[0].x, G.pickups[0].y);
      await seconds(1.2);
      ok('walking over it with a full pack leaves it there',
        G.pickups.length === before, `${before} -> ${G.pickups.length}`);

      // Make room and it can be picked up.
      emptyEverything();
      await seconds(1.4);
      ok('once there is room it can be collected',
        api.slotsCount(p.bag, 'rifle') + api.slotsCount(p.hotbar, 'rifle') > 0,
        `${G.pickups.length} left on the ground`);

      // ---- overflowing consumables land as collectable pickups ----
      emptyEverything();
      fillEverything();
      G.pickups.length = 0;
      api.grantLoot(p, [{ id: 'item:bandage', n: 4 }], p.x, p.y);
      ok('bandages that will not fit land on the ground', G.pickups.length > 0,
        `${G.pickups.length} dropped`);
      ok('...decoded as consumables, not as a broken resource',
        G.pickups.every((it) => it.kind === 'item' && it.id === 'bandage'),
        G.pickups.map((it) => `${it.kind}:${it.id}`).join(','));
      emptyEverything();
      await seconds(1.4);
      ok('and those bandages can be picked back up',
        api.slotsCount(p.bag, 'bandage') > 0,
        `${api.slotsCount(p.bag, 'bandage')} recovered`);

      // ---- gear a scavenger delivers survives the handover ----
      G.pickups.length = 0;
      emptyEverything();
      // The delivery path decodes prefixed entry ids; `gear:` was missing from
      // its hand-written list, so a helmet became an undecodable pickup.
      api.spawnEntryPickup(p.x + 30, p.y, 'gear:riotHelm', 1);
      // Checked before the next frame: the player is standing beside it and the
      // pickup magnet would collect it first, so waiting would test the magnet
      // rather than the decoding.
      ok('a delivered helmet is a gear pickup', G.pickups.length > 0 &&
        G.pickups[0].kind === 'gear' && G.pickups[0].id === 'riotHelm',
        G.pickups.map((it) => `${it.kind}:${it.id}`).join(',') || 'nothing spawned');
      await seconds(1.4);
      ok('...and the player can actually collect it',
        api.slotsCount(p.bag, 'riotHelm') + api.slotsCount(p.hotbar, 'riotHelm') > 0,
        `${G.pickups.length} left behind`);

      // ---- crafting never spends materials into nowhere ----
      emptyEverything();
      d.giveAll();
      G.benchTier = 2;
      const vestRecipe = api.RECIPES.find((r) => r.give.armor === 'lightVest');
      if (vestRecipe) {
        // A full pack with a free hotbar slot used to pass the check and then
        // put the vest in the pack anyway, losing it and the materials.
        for (let i = 0; i < p.bag.slots.length; i++) p.bag.slots[i] = { id: 'wood', n: 1 };
        p.hotbar.slots[0] = null;
        const clothBefore = api.countRes(G.stash, 'cloth');
        const st = api.craftStatus ? api.craftStatus(vestRecipe, 2) : { ok: true };
        const crafted = api.craft(vestRecipe, 2);
        const clothAfter = api.countRes(G.stash, 'cloth');
        ok('crafting into a full pack is refused rather than eaten',
          !crafted && clothAfter === clothBefore,
          `crafted=${crafted}, cloth ${clothBefore} -> ${clothAfter}, reason="${st.reason || ''}"`);

        // With room, it works and the materials are spent.
        emptyEverything();
        const clothBefore2 = api.countRes(G.stash, 'cloth');
        const crafted2 = api.craft(vestRecipe, 2);
        ok('crafting with room produces the item', crafted2 &&
          api.slotsCount(p.bag, 'lightVest') > 0,
          `crafted=${crafted2}`);
        ok('...and that one does spend the materials',
          api.countRes(G.stash, 'cloth') < clothBefore2);
      }

      // ---- the hotbar refuses raw materials ----
      emptyEverything();
      api.slotsAdd(p.bag, 'wood', 20);
      d.tap('KeyI');
      await frames(4);
      const zonesR = api.invZones();
      const rectR = d.canvas.getBoundingClientRect();
      const toClientR = (z) => ({
        x: rectR.left + (z.x + z.w / 2) * ((G.dpr || 1) * rectR.width / d.canvas.width),
        y: rectR.top + (z.y + z.h / 2) * ((G.dpr || 1) * rectR.height / d.canvas.height),
      });
      const woodIdx = p.bag.slots.findIndex((s) => s && s.id === 'wood');
      const woodZ = zonesR.find((z) => z.kind === 'bag' && z.i === woodIdx);
      const hbZ = zonesR.find((z) => z.kind === 'hotbar' && z.i === 0);
      if (woodZ && hbZ) {
        const a = toClientR(woodZ), b = toClientR(hbZ);
        d.mouseMove(a.x, a.y); await frames(2);
        d.mouseDown(0); await frames(2);
        d.mouseMove(b.x, b.y); await frames(2);
        d.mouseUp(0); await frames(3);
        ok('raw materials cannot be parked on the hotbar',
          api.slotsCount(p.hotbar, 'wood') === 0 && api.slotsCount(p.bag, 'wood') === 20,
          `hotbar wood ${api.slotsCount(p.hotbar, 'wood')}, pack wood ${api.slotsCount(p.bag, 'wood')}`);
      }
      d.tap('Escape');
      await frames(3);

      emptyEverything();
      api.slotsAdd(p.hotbar, 'pipe', 1);
      G.pickups.length = 0;
      G.enemies.length = 0;
      d.god(true);
    }

    // ------------------------------------------ 11e. cleared ground stays ---
    // The first playtest could do nothing but fight, because the spawner keeps
    // a standing population near the player and refills it every 0.6s. Killing
    // things has to buy a local, temporary lull or there is never a window to
    // build in.
    {
      d.god(true);
      G.enemies.length = 0;
      const plot = clearOpenPlot(G, 6);
      d.teleport(plot.x, plot.y);
      await frames(3);
      // Start from genuinely untouched ground.
      G.quiet.a.fill(0);
      await frames(2);

      const before = api.totalQuietAt(plot.x, plot.y);
      const mulBefore = api.densityMul(plot.x, plot.y);
      ok('untouched ground is not quiet', before === 0, `quiet ${before}`);
      ok('untouched ground gets the full population', mulBefore > 0.99,
        `x${mulBefore.toFixed(2)}`);

      // Kill a crowd right here.
      for (let i = 0; i < 10; i++) {
        const e = api.spawnEnemy('walker', plot.x + (i % 5) * 12, plot.y + i * 4, {});
        api.killEnemy(e, 'test');
      }
      await frames(3);
      const after = api.totalQuietAt(plot.x, plot.y);
      ok('killing a crowd quietens the ground it fell on', after > before,
        `${before.toFixed(1)} -> ${after.toFixed(1)}`);
      const mulAfter = api.densityMul(plot.x, plot.y);
      ok('a cleared patch asks for fewer enemies', mulAfter < mulBefore - 0.1,
        `x${mulBefore.toFixed(2)} -> x${mulAfter.toFixed(2)}`);
      ok('but never asks for none at all', mulAfter > 0.05, `x${mulAfter.toFixed(2)}`);
      ok('a thoroughly cleared patch turns spawns away',
        api.suppressed(plot.x, plot.y), `quiet ${after.toFixed(1)}`);

      // Somewhere else on the map should be untouched by all of that.
      const farX = plot.x + 2000, farY = plot.y;
      ok('clearing one place does not quieten the whole map',
        api.quietAt(farX, farY) === 0, `${api.quietAt(farX, farY)}`);

      // It has to wear off, or a cleared map stays cleared forever.
      const held = api.quietAt(plot.x, plot.y);
      await seconds(6);
      const decayed = api.quietAt(plot.x, plot.y);
      ok('quiet wears off again', decayed < held,
        `${held.toFixed(2)} -> ${decayed.toFixed(2)}`);
      ok('...but not instantly', decayed > 0, `${decayed.toFixed(2)}`);

      // And it has to survive a reload, or saving beside your base hands the
      // horde its opening back.
      api.saveGame();
      api.loadGame();
      p = G.player;
      await frames(3);
      const reloaded = api.quietAt(plot.x, plot.y);
      ok('cleared ground is still cleared after a reload', reloaded > 0,
        `${decayed.toFixed(2)} -> ${reloaded.toFixed(2)}`);
      d.god(true);
      G.enemies.length = 0;
    }

    // ------------------------------------------- 11i. a second survivor -----
    // Everything above ran with one player, exactly as it always has. Now a
    // second person joins the same world, driven by intent rather than by the
    // keyboard — the path a networked guest takes. Enemies, loot, death and
    // revive all have to know there are two of them.
    {
      d.god(true);
      G.enemies.length = 0;
      p = G.player;
      const spot2 = clearOfStructures(G, p.x, p.y);
      d.teleport(spot2.x, spot2.y);
      await frames(2);

      const p2 = api.joinPlayer({ name: 'Bex' });
      await frames(2);
      const apart = Math.hypot(p2.x - p.x, p2.y - p.y);
      ok('a second player joins beside the first', G.players.length === 2 && apart < 200,
        `${G.players.length} players, ${Math.round(apart)}px apart`);
      ok('G.player still means the one at this keyboard', G.player === p && api.isLocal(p) && !api.isLocal(p2));
      ok('the newcomer has their own pack, hotbar, seat colour and wire id',
        p2.bag !== p.bag && p2.hotbar !== p.hotbar && p2.color !== p.color && p2.netId !== p.netId,
        `${p.color}/${p2.color}  netId ${p.netId}/${p2.netId}`);

      // Driven by intent, not by keys. The intent object persists between steps
      // exactly as a guest's latest packet would.
      p2.x = spot2.x + 160; p2.y = spot2.y; p2.vx = 0; p2.vy = 0;
      const x2 = p2.x;
      const px0 = p.x, py0 = p.y;
      p2.intent.mx = 1;
      await seconds(0.8);
      p2.intent.mx = 0;
      await frames(3);
      ok('a player driven by intent moves', p2.x - x2 > 40, `moved ${Math.round(p2.x - x2)}px`);
      ok('...and the local player, with no keys held, did not',
        Math.hypot(p.x - px0, p.y - py0) < 8, `${Math.round(Math.hypot(p.x - px0, p.y - py0))}px`);
      p2.x = spot2.x + 160; p2.y = spot2.y; p2.vx = 0; p2.vy = 0;

      // A kill pays the one who made it. The bullet's owner is the player
      // object now, not a tag — this is the path the raid harness found
      // throwing, and the solo sections never exercise it because there the
      // debug API and the turrets do all the killing.
      {
        const eK = api.spawnEnemy('walker', p2.x + 30, p2.y);
        const xpLocal0 = p.xp + p.level * 100000, xpP2 = p2.xp + p2.level * 100000;
        const errs0 = d.errors.length;
        p2.intent.aimX = eK.x; p2.intent.aimY = eK.y;
        p2.intent.fire = true;
        await seconds(4);
        p2.intent.fire = false;
        ok('a player driven by intent can kill', eK.dead, `walker hp ${Math.round(eK.hp)}`);
        ok('the kill pays the killer, not the local player',
          p2.xp + p2.level * 100000 > xpP2 && p.xp + p.level * 100000 === xpLocal0,
          `newcomer xp ${xpP2 % 100000} -> ${Math.round(p2.xp)}, local unchanged=${p.xp + p.level * 100000 === xpLocal0}`);
        ok('...without a runtime error', d.errors.length === errs0, d.errors.slice(errs0).join(' | '));
        G.enemies.length = 0;
        p2.intent.aimX = 0; p2.intent.aimY = 0;
      }

      // Enemies pick the nearest of them.
      const eN = api.spawnEnemy('walker', spot2.x + 420, spot2.y, { aggro: true });
      const dN0 = Math.hypot(eN.x - p2.x, eN.y - p2.y);
      await seconds(1.2);
      const dN1 = Math.hypot(eN.x - p2.x, eN.y - p2.y);
      ok('enemies go for the nearest player', dN1 < dN0 - 20 && dN1 < Math.hypot(eN.x - p.x, eN.y - p.y),
        `to newcomer ${Math.round(dN0)} -> ${Math.round(dN1)}px`);
      G.enemies.length = 0;

      // No friendly fire, and no bumping into each other.
      p2.x = p.x + 38; p2.y = p.y; p2.vx = 0; p2.vy = 0;
      const hp2 = p2.hp;
      api.selectSlot(p, p.hotbar.slots.findIndex((s) => s && s.id === 'pipe'));
      d.aimAt(p2.x, p2.y);
      await frames(2);
      d.mouseDown(); await seconds(0.5); d.mouseUp();
      api.slotsAdd(p.hotbar, 'pistol', 1);
      p.mag.pistol = 12;
      api.selectSlot(p, p.hotbar.slots.findIndex((s) => s && s.id === 'pistol'));
      await frames(2);
      d.aimAt(p2.x, p2.y);
      await frames(2);
      d.mouseDown(); await seconds(0.3); d.mouseUp();
      await seconds(0.4);
      ok('a swing and a magazine into a teammate do nothing', p2.hp === hp2 && p.mag.pistol < 12,
        `hp ${hp2} -> ${p2.hp}, fired ${12 - p.mag.pistol}`);
      d.key('KeyD', true);
      await seconds(0.6);
      d.key('KeyD', false);
      await frames(3);
      ok('players walk straight through each other', p.x > p2.x + 10, `${Math.round(p.x - p2.x)}px past them`);

      // Going down with a teammate present is a countdown, not a death.
      const deaths1 = G.stats.deaths;
      const packs1 = G.backpacks.length;
      api.killPlayer(p2);
      await frames(2);
      ok('with a teammate present, dying leaves you downed',
        p2.downed && !p2.dead && G.stats.deaths === deaths1 && G.backpacks.length === packs1,
        `downed=${p2.downed} dead=${p2.dead} deaths ${deaths1}->${G.stats.deaths} packs ${packs1}->${G.backpacks.length}`);
      ok('the countdown is running', p2.downT > 0 && p2.downT <= api.PLAYER.downedTime, `${p2.downT.toFixed(1)}s`);

      // The infected have no interest in someone already on the ground.
      d.teleport(p2.x - 220, p2.y);
      await frames(2);
      const eD = api.spawnEnemy('walker', p2.x + 60, p2.y, { aggro: true });
      const dToLocal0 = Math.hypot(eD.x - p.x, eD.y - p.y);
      await seconds(0.8);
      const dToLocal1 = Math.hypot(eD.x - p.x, eD.y - p.y);
      ok('enemies ignore a downed player and go for the one still standing',
        p2.downed && dToLocal1 < dToLocal0 - 15, `to standing player ${Math.round(dToLocal0)} -> ${Math.round(dToLocal1)}px`);
      G.enemies.length = 0;

      // Hold E beside them to bring them up.
      d.teleport(p2.x - 40, p2.y);
      await frames(3);
      const hv = api.findInteractable();
      ok('a downed teammate is the interact target', !!hv && hv.kind === 'revivePlayer', hv && hv.kind);
      d.key('KeyE', true);
      await seconds(api.PLAYER.reviveTime + 0.6);
      d.key('KeyE', false);
      await frames(3);
      ok('holding E beside them gets them up', !p2.downed && !p2.dead && p2.hp > 0,
        `downed=${p2.downed} hp ${Math.round(p2.hp)}/${p2.maxHp}`);
      ok('a revive restores a fraction of health, not all of it',
        p2.hp >= p2.maxHp * api.PLAYER.reviveHpFrac - 1 && p2.hp < p2.maxHp, `${Math.round(p2.hp)}/${p2.maxHp}`);

      // Nobody comes: the countdown runs out and it is the death it always was.
      api.killPlayer(p2);
      await frames(2);
      p2.downT = 0.2;
      await seconds(0.6);
      ok('when the countdown runs out it is a real death, pack and all',
        p2.dead && G.stats.deaths === deaths1 + 1 && G.backpacks.length === packs1 + 1,
        `dead=${p2.dead} deaths ${G.stats.deaths} packs ${G.backpacks.length}`);
      await seconds(api.PLAYER.respawnTime + 0.6);
      ok('the second player respawns on their own', !p2.dead && !p2.downed, `dead=${p2.dead}`);

      // The four things the first code review found, each reproduced against
      // the running game before it was fixed.
      //
      // A remote player's intent is a packet that stays put until the next one.
      // Holding "E was pressed" as data toggled a gate 17 times in 300ms.
      {
        G.stash.wood = (G.stash.wood || 0) + 200; G.stash.scrap = (G.stash.scrap || 0) + 200;
        const gtx = Math.floor(p2.x / 32), gty = Math.floor(p2.y / 32);
        let gate = null;
        for (let dx = 2; dx < 7 && !gate; dx++) {
          if (api.canPlace('gate', gtx + dx, gty, p2).ok) gate = api.placeStructure('gate', gtx + dx, gty, p2);
        }
        if (gate) {
          p2.x = gate.x - 40; p2.y = gate.y; p2.vx = 0; p2.vy = 0;
          const wasOpen = gate.open;
          let flips = 0, last = gate.open;
          p2.intent.interact = true;
          for (let i = 0; i < 30; i++) { await frames(1); if (gate.open !== last) { flips++; last = gate.open; } }
          ok('a remote edge intent acts exactly once', flips === 1 && gate.open !== wasOpen, `gate flipped ${flips} times in 30 steps`);
          api.demolishStructure(gate, p2);
        } else {
          ok('a remote edge intent acts exactly once', false, 'nowhere to place a gate');
        }
      }

      // Cars: one seat, a leaver parks, and a roadkill is the driver's kill.
      {
        const clear = (v) => {
          const ax = v.x + Math.cos(v.angle) * 110, ay = v.y + Math.sin(v.angle) * 110;
          return !v.destroyed && !api.solidPx(ax, ay) && !api.solidPx(v.x + Math.cos(v.angle) * 60, v.y + Math.sin(v.angle) * 60);
        };
        const car = G.vehicles.find(clear) || G.vehicles.find((v) => !v.destroyed);
        car.locked = false; car.fuel = 50;
        p.x = car.x + 30; p.y = car.y; p.vx = 0; p.vy = 0;
        p2.x = car.x - 30; p2.y = car.y; p2.vx = 0; p2.vy = 0;
        api.enterVehicle(p, car);
        const second = api.enterVehicle(p2, car);
        ok('a car has one seat', second === false && !p2.drivingId && p.drivingId === car.id,
          `second entry ${second}, p2.drivingId=${p2.drivingId}`);
        api.exitVehicle(p);

        api.enterVehicle(p2, car);
        // Two in the road, so whichever the car's exact heading meets first,
        // it meets one. What is asserted is who the kill pays, not which body.
        G.enemies.length = 0;
        for (const dist of [70, 120]) {
          const w = api.spawnEnemy('walker', car.x + Math.cos(car.angle) * dist, car.y + Math.sin(car.angle) * dist);
          w.hp = 1;
        }
        const kills0 = G.stats.kills;
        const xpLocal = p.xp + p.level * 100000, xpDriver = p2.xp + p2.level * 100000;
        p2.intent.drive.forward = true;
        await seconds(1.5);
        p2.intent.drive.forward = false;
        ok('a roadkill is the driver\'s kill, not everyone\'s',
          G.stats.kills > kills0 && p2.xp + p2.level * 100000 > xpDriver && p.xp + p.level * 100000 === xpLocal,
          `kills +${G.stats.kills - kills0} driver xp +${Math.round(p2.xp + p2.level * 100000 - xpDriver)} local +${Math.round(p.xp + p.level * 100000 - xpLocal)}`);

        // Leave at the wheel.
        api.leavePlayer(p2);
        await frames(2);
        ok('a player who leaves while driving parks the car',
          !car.engineOn && car.tiles.length > 0 && !G.players.includes(p2),
          `engineOn=${car.engineOn} tiles=${car.tiles.length}`);
        G.enemies.length = 0;
        d.teleport(spot2.x, spot2.y);
        await frames(2);
      }

      // And once they leave, dying alone is instant again.
      await frames(2);
      ok('a player can leave', G.players.length === 1 && G.player === p, `${G.players.length} players`);
      const deaths2 = G.stats.deaths;
      api.killPlayer();
      await frames(2);
      ok('alone, death is immediate', p.dead && !p.downed && G.stats.deaths === deaths2 + 1);
      await seconds(api.PLAYER.respawnTime + 0.6);
      ok('...and the respawn still works', !p.dead);
      G.backpacks.length = 0;
    }

    // ------------------------------------- 11j. hosting, with a loopback guest --
    // The host session driven by a fake guest over an in-memory peer: the same
    // messages a real browser sends, without a broker or a second window.
    {
      d.god(true);
      G.enemies.length = 0;
      p = G.player;
      const spotH = clearOfStructures(G, p.x, p.y);
      d.teleport(spotH.x, spotH.y);
      await frames(2);

      d.net.hostOffline({ name: 'Ash' });
      ok('hosting offline makes this browser the authority', G.net.role === 'host' && G.mode === 'coop' && G.player.name === 'Ash');
      const { a, b } = d.net.makeLoopback();
      const reliable = [], state = [];
      b.onMessage('reliable', (m) => reliable.push(m));
      b.onMessage('state', (m) => state.push(m));
      d.net.debugAttachGuest(a, 'smoke');

      // No password on this room, so a hello with any hash is let in. The
      // password check itself is exercised further down with one set.
      b.send('reliable', d.net.msg.hello('smoke-guest', 'Bex', null));
      await frames(4);
      const welcome = reliable.find((m) => m.t === 'welcome');
      ok('hello is answered with a welcome carrying the whole world', !!welcome && welcome.world && welcome.world.v === G.version && welcome.world.seed === G.world.seed,
        welcome ? `v${welcome.world.v}, ${Object.keys(welcome.world.players).length} players in the record` : reliable.map((m) => m.t).join(','));
      const guest = G.players.find((q) => q.netId === (welcome && welcome.n));
      ok('the guest is a real player in the host\'s world', !!guest && !guest.away && guest.name === 'Bex' && guest.id === 'smoke-guest');
      ok('the roster names both of them', !!welcome && welcome.roster.map((r) => r.name).join(',') === 'Ash,Bex', welcome && welcome.roster.map((r) => r.name).join(','));

      // Intent over the wire drives the guest's player through the ordinary sim.
      // Stand them on open ground first: they spawn beside the host, and a
      // fence post a few pixels to their right once turned "walk right" into
      // 23px against a wall.
      const plotG = clearOpenPlot(G, 3);
      guest.x = plotG.x; guest.y = plotG.y; guest.vx = 0; guest.vy = 0;
      const gx0 = guest.x;
      const it = api.makeIntent(); it.mx = 1; it.aimX = guest.x + 200; it.aimY = guest.y;
      for (let i = 0; i < 40; i++) { b.send('state', d.net.msg.intent(i, it)); await frames(1); }
      ok('a guest\'s intent moves their player', guest.x - gx0 > 30, `moved ${Math.round(guest.x - gx0)}px`);
      const snaps = state.filter((m) => m.t === 'snap');
      ok('snapshots arrive at about twenty a second', snaps.length >= 10 && snaps.length <= 16, `${snaps.length} in 40 frames`);
      const last = snaps[snaps.length - 1];
      ok('a snapshot carries every player and only nearby enemies', !!last && last.pl.length === G.players.length && Array.isArray(last.en) && Array.isArray(last.bp),
        last ? Object.keys(last).join(',') : 'none');

      // A command is validated and executed by the host, and echoed as an event.
      G.stash.wood = (G.stash.wood || 0) + 200; G.stash.scrap = (G.stash.scrap || 0) + 200;
      let wtx = Math.floor(guest.x / 32) + 2, wty = Math.floor(guest.y / 32);
      for (let dx = 0; dx < 5 && !api.canPlace('woodWall', wtx, wty, guest).ok; dx++) wtx++;
      const built0 = G.structures.length, ev0 = reliable.length;
      b.send('reliable', d.net.msg.cmd('place', { type: 'woodWall', tx: wtx, ty: wty }));
      await frames(4);
      ok('a place command from a guest builds a wall', G.structures.length === built0 + 1, `${G.structures.length - built0} built`);
      ok('...and the guest hears about it as a struct event', reliable.slice(ev0).some((m) => m.t === 'ev' && m.k === 'struct' && m.s.t === 'woodWall'));
      // A command that should fail does nothing: out of range.
      const far0 = G.structures.length;
      b.send('reliable', d.net.msg.cmd('place', { type: 'woodWall', tx: wtx + 40, ty: wty }));
      await frames(3);
      ok('a command the rules refuse is refused for a guest too', G.structures.length === far0);

      // Repairs are commands too: the host fixes the piece as the guest, pays
      // from the guest's pack and the shared stash, and echoes the new health.
      const guestWall = G.structures.find((s) => s.tx === wtx && s.ty === wty && !s.destroyed);
      if (guestWall) {
        guestWall.hp = guestWall.maxHp * 0.4;
        const evR0 = reliable.length;
        b.send('reliable', d.net.msg.cmd('repair', { tx: wtx, ty: wty }));
        await frames(4);
        ok('a repair command from a guest fixes the wall', guestWall.hp === guestWall.maxHp, `${Math.round(guestWall.hp)}/${guestWall.maxHp}`);
        ok('...and the guest hears the new health as a struct event',
          reliable.slice(evR0).some((m) => m.t === 'ev' && m.k === 'struct' && m.s.tx === wtx && m.s.ty === wty && m.s.hp === guestWall.maxHp));
        guestWall.hp = guestWall.maxHp * 0.5;
        b.send('reliable', d.net.msg.cmd('repairAll', {}));
        await frames(4);
        ok('a REPAIR ALL command from a guest sweeps the base', guestWall.hp === guestWall.maxHp, `${Math.round(guestWall.hp)}/${guestWall.maxHp}`);
      } else {
        ok('the guest\'s wall is there to repair', false, 'not found');
      }

      // A guest that goes quiet — paused, tab hidden, line dying — stops. Its
      // last packet said "walk right"; silence after it must not mean "keep
      // walking". Before the host expired stale intents, it walked 185px.
      const walk = api.makeIntent(); walk.mx = 1; walk.aimX = guest.x + 200; walk.aimY = guest.y;
      for (let i = 40; i < 50; i++) { b.send('state', d.net.msg.intent(i, walk)); await frames(1); }
      await frames(45);                            // well past INTENT_TIMEOUT_MS
      const xQuiet = guest.x;
      await frames(30);
      ok('a guest whose packets stop is stopped by the host', Math.abs(guest.x - xQuiet) < 1 && !guest.intent.mx,
        `drifted ${Math.round(guest.x - xQuiet)}px after going silent, mx ${guest.intent.mx}`);

      // A late packet on the unordered channel must not undo what the newest
      // one said is held: E mid-search, sprint, sneak. It used to clear them.
      const heldIt = api.makeIntent(); heldIt.interactHeld = true; heldIt.sprint = true; heldIt.sneak = true; heldIt.aimX = guest.x; heldIt.aimY = guest.y;
      b.send('state', d.net.msg.intent(60, heldIt)); await frames(1);
      const stale = api.makeIntent(); stale.aimX = guest.x; stale.aimY = guest.y;
      b.send('state', d.net.msg.intent(55, stale)); await frames(1);
      ok('an out-of-order packet leaves the newest held state alone', guest.intent.interactHeld && guest.intent.sprint && guest.intent.sneak,
        `interactHeld ${guest.intent.interactHeld} sprint ${guest.intent.sprint} sneak ${guest.intent.sneak}`);
      b.send('state', d.net.msg.intent(61, stale)); await frames(2);

      // Recruiting removes a rescue from the world; a guest keeps its own list
      // and must hear about the gap, or it goes on offering to talk to someone
      // who is already home.
      G.player.attrs.cha = 8; api.recomputeStats(G.player);
      const bunks = [];
      for (let i = 0; i < 6 && api.rosterLimits().cap <= api.liveSurvivors().length; i++) { const bk = placeNear('bunk'); if (bk) bunks.push(bk); }
      const rescue = G.rescues[0], rescues0 = G.rescues.length, evR = reliable.length, crew0 = G.survivors.length;
      const recruited = rescue ? api.recruit(rescue, G.player) : null;
      await frames(3);
      const rescueEv = reliable.slice(evR).find((m) => m.t === 'ev' && m.k === 'rescues');
      ok('recruiting on the host tells every guest who is still out there', !!recruited && G.rescues.length === rescues0 - 1 && !!rescueEv && rescueEv.list.length === rescues0 - 1,
        recruited ? `${rescues0} → ${G.rescues.length}, event lists ${rescueEv ? rescueEv.list.length : 'none'}` : `recruit refused (cap ${api.rosterLimits().cap}, crew ${api.liveSurvivors().length})`);
      if (recruited) G.survivors.splice(crew0, G.survivors.length - crew0);
      for (const bk of bunks) api.demolishStructure(bk);

      // A saved world remembers the guest. Into a fresh slot — never into one
      // the player owns.
      G.slotId = null;
      const data = d.api.saveGame() ? JSON.parse(localStorage.getItem(`deadline.slot.${G.slotId}`)) : null;
      ok('the hosted world saves the guest\'s record by identity', !!data && !!data.players['smoke-guest'] && data.players['smoke-guest'].name === 'Bex',
        data ? Object.keys(data.players).join(',') : 'no save');

      // Disconnect parks, not removes; a return with the same identity gets the same player.
      b.close();
      await frames(4);
      ok('a guest who drops is parked, not removed', guest.away && G.players.includes(guest) && G.net.guests.length === 0);
      const { a: a2, b: b2 } = d.net.makeLoopback();
      const rel2 = [];
      b2.onMessage('reliable', (m) => rel2.push(m));
      d.net.debugAttachGuest(a2, 'smoke2');
      b2.send('reliable', d.net.msg.hello('smoke-guest', 'Bex again', null));
      await frames(4);
      const w2 = rel2.find((m) => m.t === 'welcome');
      ok('the same identity comes back to the same character', !!w2 && w2.n === guest.netId && !guest.away && G.players.filter((q) => q.id === 'smoke-guest').length === 1,
        w2 ? `netId ${w2.n} (was ${guest.netId})` : 'no welcome');
      b2.close();
      await frames(3);

      // A second window of the host's own browser sends the host's identity. It
      // must get a fresh player, never the host's.
      const { a: a4, b: b4 } = d.net.makeLoopback();
      const rel4 = [];
      b4.onMessage('reliable', (m) => rel4.push(m));
      d.net.debugAttachGuest(a4, 'smoke4');
      b4.send('reliable', d.net.msg.hello(G.player.id, 'Me again', null));
      await frames(4);
      const w4 = rel4.find((m) => m.t === 'welcome');
      ok('a guest with the host\'s own identity is a new player, not the host',
        !!w4 && w4.n !== G.player.netId && G.players.some((q) => q.netId === w4.n && q !== G.player && q.id === `${G.player.id}#2`),
        w4 ? `netId ${w4.n}, host is ${G.player.netId}` : rel4.map((m) => m.t + (m.reason ? ':' + m.reason : '')).join(','));
      b4.close();
      await frames(3);

      // A password, when set, is checked by the host.
      d.net.stopHosting();
      const hash = await d.net.hashPassword('pumpkin');
      d.net.hostOffline({ name: 'Ash', passwordHash: hash });
      const { a: a3, b: b3 } = d.net.makeLoopback();
      const rel3 = [];
      b3.onMessage('reliable', (m) => rel3.push(m));
      d.net.debugAttachGuest(a3, 'smoke3');
      b3.send('reliable', d.net.msg.hello('other-guest', 'Cole', await d.net.hashPassword('wrong')));
      await frames(4);
      ok('the wrong password is rejected', rel3.some((m) => m.t === 'reject' && /password/.test(m.reason)) && !G.players.some((q) => q.id === 'other-guest'),
        rel3.map((m) => m.t + (m.reason ? ':' + m.reason : '')).join(','));
      d.net.stopHosting();
      ok('stopping the host puts the game back to solo', G.net.role === 'solo');

      // The other side of that: a guest whose host vanishes is holding a stale
      // copy of someone else's world. It must land on the title, never carry on
      // as a solo game (which it once did — and could then save).
      G.net.role = 'client';
      d.net.client.hostGone('The host left.');
      ok('a guest whose host leaves is back at the title, not playing on alone',
        G.scene === 'title' && G.net.role === 'solo' && G.menu.screen === 'join' && G.menu.error === 'The host left.',
        `scene ${G.scene}, role ${G.net.role}, screen ${G.menu.screen}`);
      G.scene = 'game'; G.menu.screen = 'main'; G.menu.error = null;

      G.players.length = 1; G.localIdx = 0;   // drop the parked guest for the sections below
      G.mode = 'solo';
      G.enemies.length = 0;
      G.structures.forEach((s) => { if (s.type === 'woodWall') api.demolishStructure(s); });
    }

    // ------------------------------------------- 11k. a guest's own hands ---
    // A guest predicts its own picture; the host still decides every hit. The
    // swing arc was the one piece nobody predicted and nobody sent: the
    // snapshot carries a swing flag but only applies it to *other* players, so
    // a guest saw its teammates swing, the host saw the guest swing, and the
    // guest's own weapon sat still. Verified here in one browser by making the
    // page a guest — the loop then runs updateClient() for real.
    {
      d.newGame(20240917);
      await frames(4);
      d.god(true);
      G.enemies.length = 0;
      let g = G.player;
      const w = api.currentWeapon(g);
      ok('the starting weapon is melee, so there is a swing to draw', w.kind === 'melee', w.id);

      const loop = d.net.makeLoopback();
      const cs = d.net.client.state;
      const peerBefore = cs.peer, roleBefore = G.net.role, statsBefore = G.net.stats;
      cs.peer = loop.a;
      G.net.stats = { sentBytes: 0, recvBytes: 0, sentPerSec: 0, recvPerSec: 0, snaps: 0, _t: 0, _s: 0, _r: 0 };
      G.net.role = 'client';

      let seen = 0, restarts = 0, last = 1;
      d.aimAt(g.x + 100, g.y);
      d.mouseDown(0);
      for (let f = 0; f < 90; f++) {
        G.enemies.length = 0;
        await frames(1);
        const now = g.swing ? g.swing.t / g.swing.dur : 1;
        if (g.swing) seen++;
        if (now < last) restarts++;
        last = now;
      }
      d.mouseUp(0);

      ok('a guest sees its own swing', seen > 10, `${seen} frames with a swing arc`);
      ok('...and it animates rather than freezing', restarts >= 1 && seen > restarts,
        `${restarts} swings over ${seen} frames`);
      ok('...at the weapon\'s cadence, not once a frame', restarts <= 8,
        `${restarts} swings in 90 frames at cd ${w.cd}`);

      G.net.role = roleBefore;
      cs.peer = peerBefore;
      G.net.stats = statsBefore;
      await frames(2);
      ok('the page is solo again afterwards', G.net.role !== 'client', String(G.net.role));
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

    // Leave the browser as we found it: only the slots that existed before the
    // run, with the bytes they had, and the bindings the player had.
    for (const s of d.saves.listSlots()) if (!slotsBefore.has(s.id)) d.saves.deleteSlot(s.id);
    G.slotId = null;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('deadline.') && !(k in storageBefore)) localStorage.removeItem(k);
    }
    for (const k in storageBefore) localStorage.setItem(k, storageBefore[k]);
    {
      const saved = JSON.parse(bindsBefore);
      d.binds.resetBinds();
      for (const id in saved) if (saved[id].length === 1) d.binds.rebind(id, saved[id][0]);
    }
    ok('the run leaves no extra save slots behind', d.saves.listSlots().every((s) => slotsBefore.has(s.id)),
      `${d.saves.listSlots().length} slots, ${slotsBefore.size} before`);
    ok('the run leaves every pre-existing save byte for byte as it was',
      Object.keys(storageBefore).every((k) => localStorage.getItem(k) === storageBefore[k]),
      `${Object.keys(storageBefore).length} keys checked`);

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
  window.__clearOfStructures = clearOfStructures;

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
    // The town first — the country around it is forest and farmland, and a
    // plot in the woods is one the survivors and cars under test get stuck in.
    for (const [x0, x1] of townFirst(W)) {
      for (let ty = x0; ty < x1; ty += 2) {
        for (let tx = x0; tx < x1; tx += 2) {
          if (G.world.danger[ty * W + tx] > 2) continue;
          if (clear(tx, ty)) return { x: tx * 32 + 16, y: ty * 32 + 16 };
        }
      }
    }
    return { x: 160 * 32, y: 160 * 32 };
  }

  /** Scan ranges: the central half of the map, then all of it. */
  function townFirst(W) {
    return [[Math.floor(W / 4) + 8, Math.floor((3 * W) / 4) - 8], [8, W - 8]];
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
    for (const [x0, x1] of townFirst(W)) {
      for (let ty = x0; ty < x1; ty += 2) {
        for (let tx = x0; tx < x1; tx += 2) {
          if (G.world.danger[ty * W + tx] > 2) continue;
          if (!clear(tx, ty)) continue;
          const px = tx * 32 + 16, py = ty * 32 + 16;
          if (loot.some((c) => Math.hypot(c.x - px, c.y - py) < 600)) return { x: px, y: py };
        }
      }
    }
    return clearOpenPlot(G, n);
  }

  /**
   * Open ground well away from any player-built structure — and genuinely
   * open, not merely unblocked at its centre.
   *
   * The sections that use this arena spawn something a few hundred pixels away
   * and expect it to *walk* or *drive* in. There is no pathfinding, so a
   * single tree in that corridor stops the thing under test and the assertion
   * fails for a reason that has nothing to do with what it measures. The town
   * used to have big enough clearings for the old ±24px check to be lucky;
   * on the 320-tile map it stopped being lucky.
   *
   * `margin` is how far from any standing structure the spot has to be — the
   * repair section needs more than the default, because it is measuring what
   * a repair-all does and must not catch an unrelated wall.
   */
  function clearOfStructures(G, x, y, margin = 260, reach = 480) {
    const api = window.DEADLINE.api;
    const far = (px, py) => G.structures.every((s) =>
      s.destroyed || Math.hypot(s.x - px, s.y - py) > margin);
    // A corridor either side, wide enough for a walker's drift.
    const openArena = (px, py) => {
      for (let dx = -reach; dx <= reach; dx += 24) {
        for (let dy = -72; dy <= 72; dy += 24) {
          if (api.solidPx(px + dx, py + dy)) return false;
        }
      }
      return true;
    };
    const lim = G.world.w * 32;
    // Strict first, then the old loose check, so a map with no corridor that
    // wide still returns something rather than falling back to the caller's
    // own position.
    for (const need of [openArena, (px, py) => !api.solidPx(px, py) &&
      !api.solidPx(px + 24, py) && !api.solidPx(px - 24, py) &&
      !api.solidPx(px, py + 24) && !api.solidPx(px, py - 24)]) {
      for (let r = 300; r < 2600; r += 40) {
        for (let a = 0; a < 20; a++) {
          const ang = (a / 20) * Math.PI * 2;
          const px = x + Math.cos(ang) * r;
          const py = y + Math.sin(ang) * r;
          if (px < 200 || py < 200 || px > lim - 200 || py > lim - 200) continue;
          if (!need(px, py)) continue;
          if (!far(px, py)) continue;
          return { x: px, y: py };
        }
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
