# DEADLINE — start here

**Read `PROJECT.md` before doing anything else.** It is the living source of
truth: what this game is, what is built, why decisions were made, what is next,
and what we have learned. This file is deliberately short — it is loaded into
every session automatically, and its only jobs are to point at that document and
to state the things that are expensive to rediscover.

## The project in one line

A top-down browser survival / base-defence game. Explore → scavenge → fight →
build → defend → push somewhere worse. Vanilla JS, Canvas2D, Vite. No art or
audio assets — everything is generated in code.

## Keep the document alive

`PROJECT.md` is only useful if it stays true. Before you finish a piece of work:

- Update **§3 Where we are** and **§7 Roadmap**, and add a **§11 Changelog** line.
- Add a **§6 Decision log** row for any choice a future session might reverse
  without knowing the reasoning.
- Add anything learned to **§8 Lessons** and to `tasks/lessons.md`.

If the code contradicts `PROJECT.md`, the code is right — fix the document and
mention it.

## Design pillars (these settle arguments)

1. Survival **without** survival-game chores. No thirst, hunger, sleep or long
   timers. Upkeep lives at the base, not on a bar above the player.
2. Danger is the only gate. Nothing is level-locked.
3. Fun over realism.
4. Readability over fidelity.
5. Every system ships finished. Cut breadth, not quality.
6. Getting stronger should make the world more dangerous, not less.
7. Build anywhere — the base is wherever your structures are.

## Invariants — breaking these causes subtle bugs

1. Static collision is tile-based in one `Uint8Array`; player structures live in
   a separate destructible map.
2. Bullets use **terrain-only** collision, so they pass over your own walls.
   This is deliberate. Water and fences are the exception the other way: solid
   to feet, transparent to bullets (`bulletBlocksPx`).
3. `damage.js` exists to break an import cycle. Route damage through it.
4. `recomputeStats()` is the **only** source of player stat modifiers. Never
   mutate a stat on purchase.
5. Edge input must be consumed by exactly one simulation step.
6. UI is authored in CSS pixels and scaled by `devicePixelRatio`.
7. Save files identify containers by ordinal index — changing how many the
   generator makes **invalidates every save** and needs a version bump.
8. There is no pathfinding. Anything that walks to a target needs give-up logic.

## Verifying

Both suites must report **zero failures**. The assertion counts grow with every
round, so treat the numbers as informational and the failure count as the gate —
`PROJECT.md` §9 records what the current branch should produce.

- `npm test` — pure logic, under Node. **Under a second.**
- `npm run smoke` — the browser suite. **About four minutes.** Starts a dev
  server if one is not up, and fails fast and loudly rather than hanging.
- `tests/raid-harness.js` — raid balance reference figures. If they move, that
  needs a reason.

### How much is enough

Match the check to the change. Running the four-minute suite after every edit
is what slows a session down, and it was doing that far more than it was
catching anything.

| When | What to run |
| --- | --- |
| While working | `npm test`, plus a **targeted** browser check of the one thing you changed (20–40s) |
| Before you commit | `npm test` |
| Before you push for review | `npm run smoke` **once**, plus the raid harness if you touched combat, raids, structures or enemies |
| After a review fix | `npm test`, and `npm run smoke` only if the fix touched the UI, the render loop, or shared helpers the suite uses |

**Run the full suite once per branch, not once per change.** If it passed and
you then changed one number in `config.js`, the Node suite covers you.

**A targeted browser check beats the full suite** for "does my thing work":
drive the specific mechanic through the real input path and assert the
outcome. That is seconds, not minutes, and it is what actually found the bugs
this project has hit.

**Never hand-roll a Playwright script.** Use `npm run smoke`, or copy its
preflight. The half-hours lost to this were all the same three harness
failures — a dev server that had quietly died, a backgrounded page whose
`requestAnimationFrame` had throttled to 1fps, and a wait with no deadline.
`tests/run-smoke.cjs` fails on all three within seconds.

## Working agreements

- Test by **running the game**, not by reading the code. Every serious bug in
  this project was invisible in review.
- Assert on outcomes (`raid completes`, `killed > 0`), not on calls.
- Reproduce a review finding against the running game before fixing it.
- Branch, PR, wait for the Codex review, address it, then merge.
- The owner has still not played this. Their feel feedback outranks the roadmap.
- Check `notes.md` at the start of a session — it's where the owner and their
  co-dev jot quick feedback/ideas (often from a phone). Triage it into
  `PROJECT.md` or `tasks/todo.md` and clear entries once actioned.
