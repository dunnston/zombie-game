#!/usr/bin/env node
/**
 * Runs the browser smoke suite. `npm run smoke`.
 *
 * This exists because hand-rolling a Playwright script each time is what
 * actually cost the time. The suite itself runs in about 3.7 minutes; the
 * failures that ate half-hours were all harness failures, and every one of
 * them is now a fast, loud error instead of a hang:
 *
 *   - the dev server was not running, or had died      -> fails in ~5s
 *   - the page was backgrounded, so rAF ran at ~1fps   -> fails in ~2s
 *     (the suite counts its waits in animation frames; a throttled tab turns
 *      a 4-minute run into an overnight one and looks identical to progress)
 *   - the suite hung on a wait that never came         -> killed at the budget
 *
 * Options:
 *   --url=http://127.0.0.1:5173/   where the game is served
 *   --budget=360                    seconds the suite may take
 *   --headed                        watch it run
 *   --keep                          leave a dev server this script started up
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const TARGET = arg('url', 'http://127.0.0.1:5173/');
const BUDGET_S = Number(arg('budget', '360'));
const ROOT = path.resolve(__dirname, '..');

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* keep looking */ }
  }
  console.error('Playwright not found. Install it, or run the suite by hand per PROJECT.md §9.');
  process.exit(2);
}

const reachable = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
};

async function ensureServer() {
  if (await reachable(TARGET)) return null;
  if (!TARGET.includes('127.0.0.1') && !TARGET.includes('localhost')) {
    console.error(`Nothing is serving ${TARGET} and it is not local, so I will not start one.`);
    process.exit(2);
  }
  // Start it on the port the caller actually asked for, not a hardcoded one.
  const parsed = new URL(TARGET);
  const port = parsed.port || '5173';
  process.stdout.write(`dev server not up — starting vite on ${port}… `);
  const child = spawn('npx', ['vite', '--port', port, '--host', parsed.hostname],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await reachable(TARGET)) { console.log('up'); return child; }
  }
  console.error('\nvite did not come up within 30s.');
  try { process.kill(-child.pid); } catch { /* already gone */ }
  process.exit(2);
}

(async () => {
  const started = Date.now();
  const server = await ensureServer();
  const { chromium } = playwright();
  const browser = await chromium.launch({ headless: !flag('headed'), args: ['--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });

  const bail = async (code, msg) => {
    console.error(msg);
    await browser.close().catch(() => {});
    if (server && !flag('keep')) { try { process.kill(-server.pid); } catch { /* gone */ } }
    process.exit(code);
  };

  try {
    await page.goto(TARGET, { waitUntil: 'load', timeout: 30000 });
  } catch (e) {
    return bail(2, `could not load ${TARGET}: ${e.message}`);
  }
  await page.bringToFront();

  try {
    await page.waitForFunction(() => !!window.DEADLINE, null, { timeout: 30000 });
  } catch {
    return bail(2, 'the page loaded but window.DEADLINE never appeared — the game did not boot.');
  }

  // The suite counts its waits in animation frames, so a throttled page does
  // not fail, it just never finishes. Find out in two seconds instead.
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    (function f() { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); })();
  }));
  if (fps < 30) {
    return bail(2, `the page is running at ${fps}fps — it is throttled or hidden, and the suite would take hours. Run with --headed, or give the tab focus.`);
  }

  // The suite is not part of the bundle — it is injected into the running
  // page, exactly as PROJECT.md §9 describes doing by hand.
  const suitePath = path.join(__dirname, 'browser-smoke.js');
  try {
    await page.evaluate(fs.readFileSync(suitePath, 'utf8'));
  } catch (e) {
    return bail(2, `could not inject ${suitePath}: ${e.message}`);
  }
  if (!(await page.evaluate(() => typeof window.runDeadlineSmoke === 'function'))) {
    return bail(2, 'the suite was injected but did not define runDeadlineSmoke.');
  }

  console.log(`rAF ${fps}/s · running the suite (budget ${BUDGET_S}s)…`);
  let result;
  try {
    result = await page.evaluate(
      (ms) => window.runDeadlineSmoke(ms),
      BUDGET_S * 1000,
    );
  } catch (e) {
    return bail(2, `the suite threw or exceeded its budget: ${e.message}`);
  }

  const errors = await page.evaluate(() => window.DEADLINE.errors);
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  console.log(`\npassed ${result.passed}  failed ${result.failed}  ·  ${secs}s`);
  for (const f of result.failures || []) {
    console.log('FAIL', typeof f === 'string' ? f : `${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  if (errors.length) console.log('DEADLINE.errors', JSON.stringify(errors, null, 1));
  if (pageErrors.length) console.log('page errors', JSON.stringify(pageErrors.slice(0, 10), null, 1));

  if (flag('json')) fs.writeFileSync(path.join(ROOT, 'smoke-result.json'), JSON.stringify(result, null, 1));

  await browser.close();
  if (server && !flag('keep')) { try { process.kill(-server.pid); } catch { /* gone */ } }
  process.exit(result.failed || errors.length || pageErrors.length ? 1 : 0);
})();
