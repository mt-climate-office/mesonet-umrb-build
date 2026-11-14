#!/usr/bin/env node
/* Consumer-app verification skeleton (MIGRATING.md § Verification recipe).
   COPY this file into the app repo being migrated (keep it untracked), fill
   in CONFIG, extend the app-specific section, and run it before the deploy
   gate. It is a starting point, not a complete gate — the URL-param matrix
   and any app automation are yours to add.

   Tracked in this repo (it was untracked until kit 1.0.0, and went stale
   unseen); its dependencies and fixtures/ stay out of git:
     npm init -y && npm i --no-save playwright @axe-core/playwright
     npx playwright install chromium
     mkdir -p fixtures && curl -fsS -o fixtures/status.json \
       'https://mesonet2.climate.umt.edu/api/v2/stations/status/live?type=json'
   Then: node consumer-verify.mjs
*/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

/* ── CONFIG — edit per app ────────────────────────────────────────────── */
const CONFIG = {
  // Served straight out of the repo root — the same layout GitHub Pages
  // publishes, so every in-page path resolves identically here and in prod.
  root: process.cwd(),
  pagePath: '/',
  themes: ['dark', 'light', 'high-contrast'],
  // This page's own intro key since kit 0.21.0 (app.js KEY.intro; it used
  // status's 'mco-status-seen-intro' before). Seeding the old key left the
  // intro open over every check below.
  initLocalStorage: { 'mco-umrb-seen-intro': '1' },
  // The live status feed is cross-origin on the mesonet-db-rds API; open()
  // below answers it from fixtures/status.json so the run is deterministic.
  // Without the fixture the fetch fails, #data-banner appears, and the map
  // still draws all 205 grid cells from the packaged geometry — the sr-table
  // is the proof the canvas painted either way.
  renderEvidence: () => document.querySelectorAll('#sr-cell-rows tr').length > 200,
  settleMs: 4000,               // extra time for tiles/hillshade after evidence
  screenshotDir: './verify-out',
};
/* Local stand-in for the API endpoint, keyed by the absolute URL the page
   fetches (app.js API_BASE), matched on origin + path so the query string is
   free to change. fixtures/status.json is a verbatim capture of
   <API_BASE>/stations/status/live?type=json — refresh it with curl when the
   buildout moves. Gitignored: GitHub Pages serves everything committed. */
const API_BASE = 'https://mesonet2.climate.umt.edu/api/v2';
const FIXTURES = {
  [`${API_BASE}/stations/status/live`]: 'fixtures/status.json',
};
const fixtureFor = (url) => {
  const u = new URL(url);
  return FIXTURES[u.origin + u.pathname] || FIXTURES[u.origin + u.pathname + '/'];
};
/* ─────────────────────────────────────────────────────────────────────── */

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(CONFIG.root, p));
    if (!f.startsWith(CONFIG.root)) { res.writeHead(403).end(); return; }
    // Read BEFORE writing headers. The other order sends a 200 and only then
    // discovers the file is missing, so the catch tries to write 404 headers
    // onto a response already committed and the whole server dies with
    // ERR_HTTP_HEADERS_SENT — which any 404-by-design request triggers.
    const body = await readFile(f);
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${CONFIG.pagePath}`;

const browser = await chromium.launch();

/* Every browser context goes through here so the cross-origin API is answered
   from fixtures/ instead of the network — including the app-specific blocks
   below that open their own contexts rather than using open(). */
async function newContext(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route(`${API_BASE}/**`, async (route) => {
    const fx = fixtureFor(route.request().url());
    if (!fx) return route.continue();
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: await readFile(join(CONFIG.root, fx)) });
  });
  return ctx;
}
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

/* Console noise that is expected when running against a static server. Each
   entry is justified — nothing here may be a CSP violation, which is the whole
   reason this check exists. The status feed is answered from fixtures/, so a
   failure there is now REAL and deliberately not filtered.
   - flatgeobuf's streaming reader aborts the .fgb request once it has consumed
     the features it needs, and Chrome reports the teardown as an error */
const EXPECTED_CONSOLE = [
  /mt_\w+\.fgb/,
];
const realErrors = (errors) =>
  errors.filter((e) => !EXPECTED_CONSOLE.some((re) => re.test(e)));

async function open({ query = '', viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await newContext({ viewport });
  await ctx.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, CONFIG.initLocalStorage);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + query, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(CONFIG.renderEvidence, null, { timeout: 30000 });
  await page.waitForTimeout(CONFIG.settleMs);
  return { ctx, page, errors };
}

/* ── Baseline: three themes — console (CSP!), axe, screenshot ──────────── */
for (const theme of CONFIG.themes) {
  const { ctx, page, errors } = await open({ query: `?theme=${theme}` });
  // With the meta CSP live, ANY blocked endpoint or stale inline-script hash
  // surfaces here — a non-empty list usually means the CSP is wrong.
  check(`[${theme}] console clean`, realErrors(errors).length === 0, realErrors(errors).slice(0, 3).join(' | '));
  const r = await new AxeBuilder({ page }).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(`[${theme}] axe 0 serious/critical`, bad.length === 0,
    bad.map((v) => `${v.id}:${v.nodes[0]?.target.join(' ')}`).join(' | '));
  await page.screenshot({ path: `${CONFIG.screenshotDir}/${theme}.png` });
  await ctx.close();
}

/* ── Baseline: compact viewport ────────────────────────────────────────── */
{
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 720 }, query: '?theme=dark' });
  check('[compact] console clean', realErrors(errors).length === 0, realErrors(errors).slice(0, 3).join(' | '));
  await page.screenshot({ path: `${CONFIG.screenshotDir}/compact.png` });
  await ctx.close();
}

/* ── App-specific (REQUIRED — extend for your app) ─────────────────────────
   Assert, at minimum (see mesonet-status's migration for worked examples):
   - every URL param honored on load AND re-emitted after interaction;
     defaults elided; deep links suppress the intro modal
   - ?kbd=off gates single-key shortcuts and sticks across pushState
   - legacy localStorage encodings honored at boot (collapse state, etc.)
   - side-by-side screenshots vs the LIVE production page — list expected
     deltas; anything else is a regression
   - the repo's own page-driving automation (export/preview jobs) still works
*/
/* Clean URL: a default load must leave no query string behind. */
{
  const { ctx, page } = await open();
  check('default load emits a clean URL', !page.url().includes('?'), page.url());
  await ctx.close();
}

/* Deep links: ?cell= must survive the boot pushState (the legend's init
   onChange used to fire pushState before _selectedCell was set, which stripped
   it) and must suppress the first-visit intro modal. */
{
  const ctx = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();   // NO seeded localStorage — a fresh visitor
  await page.goto(base + '?cell=H-8', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(CONFIG.renderEvidence, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  check('?cell= survives boot pushState', page.url().includes('cell=H-8'), page.url());
  check('deep link suppresses the intro modal',
    !(await page.evaluate(() => document.getElementById('info-modal').open)));
  await ctx.close();
}

/* First visit with no deep link still auto-opens the intro, and marks it seen
   AT OPEN rather than on close. */
{
  const ctx = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1200);
  check('first visit auto-opens the intro',
    await page.evaluate(() => document.getElementById('info-modal').open));
  check('intro marked seen at open (not on close)',
    (await page.evaluate(() => localStorage.getItem('mco-umrb-seen-intro'))) === '1');
  // ...under this page's key only: status's flag is its own (app.js KEY).
  check('intro does not write status\'s seen-key',
    (await page.evaluate(() => localStorage.getItem('mco-status-seen-intro'))) === null);
  await ctx.close();
}

/* ?kbd=off gates the single-character shortcut (WCAG 2.1.4) and round-trips
   through pushState instead of being silently dropped. */
{
  const { ctx, page } = await open({ query: '?kbd=off' });
  await page.keyboard.press('/');
  await page.waitForTimeout(200);
  check('?kbd=off gates the / shortcut',
    !(await page.evaluate(() => document.activeElement.id === 'search-input')));
  check('?kbd=off hides the / hint',
    await page.evaluate(() => document.querySelector('#search-wrap .search-kbd').hidden));
  await page.evaluate(() => document.getElementById('btn-labels').click());
  await page.waitForTimeout(200);
  check('?kbd=off re-emitted after a state change', page.url().includes('kbd=off'), page.url());
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await page.keyboard.press('/');
  await page.waitForTimeout(200);
  check('/ focuses search by default',
    await page.evaluate(() => document.activeElement.id === 'search-input'));
  await ctx.close();
}

/* Legacy legend encoding: this page shipped 'collapsed'/'expanded' before the
   kit's '1'/'0'. A returning visitor must keep their collapsed legend. */
{
  const ctx = await newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('mco-umrb-seen-intro', '1');
    // Pre-kit spelling under status's prefix, which the page copies once to
    // mco-umrb-legend (app.js migrateKey).
    localStorage.setItem('mco-status-legend', 'collapsed');
  });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(CONFIG.renderEvidence, null, { timeout: 30000 });
  check('legacy legend value honored at boot',
    (await page.evaluate(() =>
      document.getElementById('legend-toggle-btn').getAttribute('aria-expanded'))) === 'false');
  check('collapsed legend body leaves the tab order',
    await page.evaluate(() => document.getElementById('legend-body').hidden));
  await ctx.close();
}

/* Shared theme key: the page must read mco-theme, not the old per-app key, so
   a theme chosen on the maintenance map carries over to this one. */
{
  const ctx = await newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('mco-umrb-seen-intro', '1');
    localStorage.setItem('mco-theme', 'light');
  });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load', timeout: 45000 });
  check('shared mco-theme key drives the theme',
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await ctx.close();
}

/* Search on a phone (kit 0.21.0 compact drawer; MCO.initSearchCollapse and
   its overlay field retired here): the field lives in the closed ☰ drawer,
   the bar shows the search button, and '/' opens the drawer on the field
   rather than focusing an input that is not rendered. */
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 720 }, query: '?theme=dark' });
  const toggleVisible = await page.evaluate(() =>
    document.getElementById('btn-search-toggle').getClientRects().length > 0);
  const fieldHidden = await page.evaluate(() =>
    document.getElementById('search-input').getClientRects().length === 0
      && !document.getElementById('nav-drawer').classList.contains('is-open'));
  check('[390px] search collapses to its toggle (field in the closed drawer)', toggleVisible && fieldHidden,
    JSON.stringify({ toggleVisible, fieldHidden }));
  await page.keyboard.press('/');
  await page.waitForTimeout(500);
  check('[390px] / opens the drawer and focuses the field',
    await page.evaluate(() => document.activeElement.id === 'search-input'
      && document.getElementById('nav-drawer').classList.contains('is-open')));
  await page.screenshot({ path: `${CONFIG.screenshotDir}/compact-search-open.png` });
  await ctx.close();
}

/* Station interaction: a dot is clickable and hoverable in its own right, and
   that has to hold for the station whose ace_grid names no drawn cell — the
   case that used to dead-end because the handler resolved through cellById.
   The detail is the kit's panel (.mco-sheet, MCO.initSheet) at every width
   since kit 0.21.0, which retired the anchored MapLibre popup. */
const detailText = () => {
  const el = document.querySelector('.mco-sheet');
  return el && !el.hidden && el.dataset.state !== 'closed' ? el.innerText : null;
};
{
  const { ctx, page } = await open({ query: '?station=acesfork' });
  await page.waitForFunction(detailText, null, { timeout: 20000 }).catch(() => {});
  const popup = await page.evaluate(detailText);
  check('orphaned station opens the detail panel', popup !== null, String(popup));
  check('orphan detail names the missing cell',
    !!popup && /E-9/.test(popup) && /not in this map's grid/i.test(popup),
    String(popup).slice(0, 160));
  check('?station= round-trips in the URL', page.url().includes('station=acesfork'), page.url());
  await page.screenshot({ path: `${CONFIG.screenshotDir}/station-orphan.png` });
  await ctx.close();
}

/* A normal station dot: click opens the station (not its cell), hover shows a
   tooltip naming it. Driven through the search box, which is the one route that
   does not depend on guessing a pixel. */
{
  const { ctx, page } = await open();
  await page.click('#search-input');
  await page.fill('#search-input', 'Augusta');
  await page.waitForTimeout(500);
  // The kit's combobox rows (MCO.initSearchBox, kit 0.8.0) are role=option.
  const opt = await page.$('#search-dropdown [role="option"]');
  check('search offers a station match', opt !== null);
  if (opt) {
    await opt.click();
    await page.waitForFunction(detailText, null, { timeout: 20000 }).catch(() => {});
    const popup = await page.evaluate(detailText);
    check('search opens the station detail', !!popup && /Augusta/i.test(popup), String(popup).slice(0, 120));
    check('station detail carries a cell reference',
      !!popup && /cell\s+\S+/i.test(popup), String(popup).slice(0, 160));
    check('station selection emits ?station=', /station=/.test(page.url()), page.url());
  }
  await ctx.close();
}


/* Tooltip line classes: the hover tooltip is the kit's MCO.map.initCursorTooltip
   (kit 0.8.0, "Pass 2"), which writes <span>s classed .tooltip-name,
   .tooltip-sub and .tooltip-val; this map's own .tooltip-line is gone. The
   name is the first line, so it may stay inline; the sub and value lines
   must be display:block or they run onto the name's row — assert the styling
   exists rather than eyeballing it. */
{
  const { ctx, page } = await open();
  const styles = await page.evaluate((CLASSES) => {
    const tip = document.getElementById('tooltip');
    const out = {};
    for (const cls of CLASSES) {
      const el = document.createElement('span');
      el.className = cls;
      tip.appendChild(el);
      const cs = getComputedStyle(el);
      out[cls] = { display: cs.display, fontSize: cs.fontSize };
      el.remove();
    }
    return out;
  }, ['tooltip-sub', 'tooltip-val']);
  for (const cls of Object.keys(styles)) {
    check(`tooltip .${cls} is styled (display:block)`, styles[cls].display === 'block',
      JSON.stringify(styles[cls]));
  }
  await ctx.close();
}

/* Hillshade and the tribal overlay are both newly adopted. Deliberately NOT
   asserted by reaching into the map instance: this app keeps its map inside an
   IIFE and the house convention (see mesonet-explorer's suite) is to observe
   through the DOM, the URL and the network rather than ship a debug global to
   production. So: prove the tiles were actually requested, and leave the
   rendering itself to the screenshots.

   The DEM request is also the CSP's real test — s3.amazonaws.com has to be in
   connect-src, not just img-src, because MapLibre fetches raster-dem tiles. */
{
  const ctx = await newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('mco-umrb-seen-intro', '1'));
  const page = await ctx.newPage();
  const hosts = new Set();
  const blocked = [];
  page.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch {} });
  page.on('requestfailed', (r) => blocked.push(`${r.url()} — ${r.failure()?.errorText}`));
  await page.goto(base + '?overlays=tribal', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(CONFIG.renderEvidence, null, { timeout: 30000 });
  await page.waitForTimeout(4000);
  check('hillshade DEM tiles requested (CSP connect-src)',
    hosts.has('s3.amazonaws.com'), [...hosts].join(', '));
  check('tribal overlay streamed from the data service',
    hosts.has('data.climate.umt.edu'), [...hosts].join(', '));
  check('tribal chip reads as on',
    (await page.evaluate(() => {
      // The kit's .mco-chip, keyed by data-layer (app.js chipEl).
      const c = document.querySelector('#layer-filters .mco-chip[data-layer="tribal"]');
      return c && c.getAttribute('aria-pressed');
    })) === 'true');
  // The status feed is served from fixtures/, so any blocked request other
  // than flatgeobuf's own stream teardown is real.
  const unexpected = blocked.filter((b) => !/mt_\w+\.fgb/.test(b));
  check('no unexpected blocked requests', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
  await page.screenshot({ path: `${CONFIG.screenshotDir}/overlays-tribal.png` });
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
