// verify.config.mjs — config for the mco-web-style verify harness
// (tools/verify/ in the kit checkout; nothing here is a runtime dependency).
// Run from the kit checkout, beside this repo:
//   node tools/verify/axe-matrix.mjs --config ../mesonet-umrb-build/verify.config.mjs
//   node tools/verify/keyboard.mjs   --config ../mesonet-umrb-build/verify.config.mjs
// `root` resolves from the current directory, so it assumes that layout;
// pass --root to override. The feed is LIVE (mesonet2.climate.umt.edu,
// cross-origin AirTable read) — the harness records no fixtures.

// Render evidence: the sr-only twin is rebuilt from the same features
// rebuildCells() hands the map, so "every cell has a row AND at least one is
// Operational" proves the grid geometry arrived and the live status feed
// joined onto it. A grid with no feed would be 205 rows of "Available cell".
const dataDrew = () => {
  const rows = [...document.querySelectorAll('#sr-cell-rows tr')];
  return rows.length >= 200
    && rows.some((r) => /Operational/.test(r.textContent))
    && /^Updated .* M[SD]T$/.test(document.getElementById('refresh-stamp')?.textContent || '');
};

export default {
  root: '../mesonet-umrb-build',
  page: 'index.html',
  // The intro modal opens on a first visit; seed its seen-key so it does not
  // sit over every scenario. (Its own behavior is exercised by keyboard.mjs
  // through the info button.)
  storage: { 'mco-umrb-seen-intro': '1' },
  scenarios: [
    { name: 'default', query: '', ready: dataDrew },
    // Station deep link (kit 0.21.0): the detail sheet at every width —
    // end-docked at 1440, the bottom sheet at 390 — carrying the station's
    // name. aceabsar (Absarokee) is active in the live registry
    // (/stations/status/live, checked 2026-11-03).
    {
      name: 'station', query: '?station=aceabsar',
      ready: () => {
        const el = document.querySelector('.mco-sheet:not([hidden]):not([data-state="closed"])');
        return !!el && /Absarokee/i.test(el.textContent);
      },
    },
    // The same link under a camera that does not show the station: the
    // flight must still end with the sheet open.
    {
      name: 'station-camera', query: '?station=aceabsar&lng=-104.5&lat=48.5&zoom=7',
      ready: () => {
        const el = document.querySelector('.mco-sheet:not([hidden]):not([data-state="closed"])');
        return !!el && /Absarokee/i.test(el.textContent);
      },
    },
    // The compact drawer open (at 390; at 1440 there is no drawer and the
    // bar is checked as is). The ready function opens it once the data has
    // drawn: scenarios carry no actions, and it runs in the page.
    {
      name: 'drawer-open', query: '',
      ready: () => {
        const rows = document.querySelectorAll('#sr-cell-rows tr').length >= 200;
        if (!rows) return false;
        const menu = document.getElementById('btn-rail-menu');
        const drawer = document.getElementById('nav-drawer');
        if (!menu.getClientRects().length) return true;   // desktop: no drawer
        if (!drawer.classList.contains('is-open')) menu.click();
        return drawer.classList.contains('is-open') && document.activeElement && drawer.contains(document.activeElement);
      },
    },
    // A chip toggle: Stations off. The dots, badge and spider hide and the
    // URL carries stations=off. (An overlay chip would stream a .fgb, whose
    // aborted read Chrome logs as an error; see CLAUDE.md.)
    {
      name: 'chip-toggle', query: '',
      ready: () => {
        const rows = document.querySelectorAll('#sr-cell-rows tr').length >= 200;
        if (!rows) return false;
        const chip = document.querySelector('#layer-filters .mco-chip[data-layer="stations"]');
        if (!chip) return false;
        if (chip.getAttribute('aria-pressed') === 'true') chip.click();
        return chip.getAttribute('aria-pressed') === 'false' && /stations=off/.test(location.search);
      },
    },
    { name: 'internal', query: '?internal=1', ready: dataDrew },
    // The legend starts collapsed on a phone, which hides its rows from the
    // 390px touch-target pass; open it so they are measured too.
    { name: 'legend-open', query: '?legend=open', ready: dataDrew },
  ],
  exemptTargets: '',
  allowProblems: [],
  dialogOpener: '.mco-btn-info',
  shortcuts: [{ key: '/', effect: () => document.activeElement?.id === 'search-input' || !!document.querySelector('.mco-search-collapse.is-open, [aria-expanded="true"].mco-search-toggle') }],
  probes: async ({ open, check }) => {
    const sheetOpen = () => {
      const el = document.querySelector('.mco-sheet');
      return !!el && !el.hidden && el.dataset.state !== 'closed';
    };
    const s = await open('?station=aceabsar');
    check('?station= re-emitted in the URL', await s.page.evaluate(() => /station=aceabsar/.test(location.search)));
    // The end-docked sheet starts under the navbar, so its title and ×
    // are not covered (top: --chrome-h, published by app.js).
    await s.page.waitForFunction(sheetOpen, null, { timeout: 20000 });
    check('?station= sheet head clear of the navbar', await s.page.evaluate(() =>
      document.querySelector('.mco-sheet-head').getBoundingClientRect().top
        >= Math.round(document.getElementById('navbar').getBoundingClientRect().bottom) - 1));
    // Back closes a detail opened from "no detail": the search pick pushes
    // one history entry, and Back closes the sheet in the same document.
    await s.page.keyboard.press('Escape');
    await s.page.waitForTimeout(500);
    check('Esc closes the deep-linked sheet and drops ?station=', await s.page.evaluate(() =>
      document.querySelector('.mco-sheet').dataset.state === 'closed' && !/station=/.test(location.search)));
    const h0 = await s.page.evaluate(() => history.length);
    await s.page.fill('#search-input', 'aceabsar');
    await s.page.keyboard.press('ArrowDown');
    await s.page.keyboard.press('Enter');
    await s.page.waitForFunction(sheetOpen, null, { timeout: 20000 });
    check('a search pick pushes one history entry', (await s.page.evaluate(() => history.length)) === h0 + 1);
    await s.page.evaluate(() => { window.__sameDoc = true; history.back(); });
    await s.page.waitForFunction(() => document.querySelector('.mco-sheet').dataset.state === 'closed', null, { timeout: 5000 }).catch(() => {});
    check('Back closes the sheet in the same document', await s.page.evaluate(() =>
      window.__sameDoc === true && document.querySelector('.mco-sheet').dataset.state === 'closed'
        && !/station=/.test(location.search)));
    await s.close();
    const k = await open('?kbd=off');
    check('?kbd=off sticks in the URL', await k.page.evaluate(() => /kbd=off/.test(location.search)));
    await k.close();
    // No horizontal overflow at 320px (touch): the page must not scroll
    // sideways (WebKit) or widen its layout viewport past the device width
    // (Chromium mobile grows innerWidth instead of scrolling), so both are
    // compared against 320. Checked with the intro open, the drawer open,
    // the legend open, and a station sheet open. The sr-only twin <table>
    // once carried .sr-only itself and laid out at ~348px.
    const W = 320;
    const vp = { viewport: { width: W, height: 568, touch: true } };
    const wide = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    const fits = (m) => m.sw <= W && m.iw === W;
    const rows = () => document.querySelectorAll('#sr-cell-rows tr').length >= 200;
    const o = await open('', { ...vp, ready: rows });
    let m = await wide(o.page);
    check('320px: no horizontal overflow (default)', fits(m), JSON.stringify(m));
    await o.page.click('#btn-rail-menu');
    await o.page.waitForFunction(() => document.getElementById('nav-drawer').classList.contains('is-open'), null, { timeout: 5000 });
    m = await wide(o.page);
    check('320px: no horizontal overflow (drawer open)', fits(m), JSON.stringify(m));
    await o.close();
    const intro = await open('', { ...vp, storage: {}, ready: () => !!document.querySelector('dialog[open]') && document.querySelectorAll('#sr-cell-rows tr').length >= 200 });
    m = await wide(intro.page);
    check('320px: no horizontal overflow (intro open)', fits(m), JSON.stringify(m));
    await intro.close();
    const lg = await open('?legend=open', { ...vp, ready: () => document.querySelector('#legend .mco-panel-toggle')?.getAttribute('aria-expanded') === 'true' && document.querySelectorAll('#sr-cell-rows tr').length >= 200 });
    m = await wide(lg.page);
    check('320px: no horizontal overflow (legend open)', fits(m), JSON.stringify(m));
    await lg.close();
    const st = await open('?station=aceabsar', { ...vp, ready: sheetOpen });
    m = await wide(st.page);
    check('320px: no horizontal overflow (station sheet)', fits(m), JSON.stringify(m));
    await st.close();
  },
};
