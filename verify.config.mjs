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
    // Station deep link: the detail panel at every width — end-docked at
    // 1440, full height under the bar at 390 (kit 1.0.0) — carrying the
    // station's name. aceabsar (Absarokee) is active in the live registry
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
    // 390px touch-target pass; open it so they are measured too. (On a phone
    // it sits in the closed ☰ drawer since kit 1.0.0; the legend-drawer
    // probe below opens it there.)
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
    // The end-docked panel starts under the navbar, so its title and ×
    // are not covered (top: --sheet-top, measured by the kit since 1.0.0).
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

    // ── Kit 1.0.0: the phone layout ─────────────────────────────────────
    const touch = (width, height) => ({ viewport: { width, height, touch: true } });
    const hit = (p, sel) => p.evaluate((s) => {
      const e = document.querySelector(s); if (!e || !e.getClientRects().length) return false;
      const r = e.getBoundingClientRect();
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!h && (h === e || e.contains(h));
    }, sel);
    // The rail at the RIGHT edge (844×390): badge, ☰, search top to bottom,
    // each button ≥ 44px and hit-testable; ☰ opens the drawer beside it,
    // focus on the drawer. No control bar: this map has no time controls.
    const ra = await open('', { ...touch(844, 390), ready: rows });
    const r1 = await ra.page.evaluate(() => {
      const nav = document.getElementById('navbar').getBoundingClientRect();
      const btns = ['btn-rail-menu', 'btn-search-toggle'].map((id) => document.getElementById(id).getBoundingClientRect());
      const logo = document.querySelector('.logo-link').getBoundingClientRect();
      return { rail: MCO.viewport.isRail(), left: Math.round(nav.left), right: Math.round(nav.right), w: Math.round(nav.width), iw: innerWidth,
        sizes: btns.map((b) => [Math.round(b.width), Math.round(b.height)]), order: logo.top < btns[0].top && btns[0].top < btns[1].top,
        controlbar: !!document.querySelector('.mco-controlbar') };
    });
    check('844×390: the rail at the right edge', r1.rail && r1.right === r1.iw && r1.w <= 64, JSON.stringify(r1));
    check('844×390: rail order badge → ☰ → search, buttons ≥ 44px', r1.order && r1.sizes.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(r1.sizes));
    check('844×390: ☰ and search hit-testable', (await hit(ra.page, '#btn-rail-menu')) && (await hit(ra.page, '#btn-search-toggle')));
    check('844×390: no control bar (no time controls)', !r1.controlbar);
    await ra.page.click('#btn-rail-menu');
    await ra.page.waitForFunction(() => document.getElementById('nav-drawer').classList.contains('is-open'), null, { timeout: 5000 });
    // Measured once the slide-in has finished: mid-transition the drawer is
    // still offset toward the rail.
    await ra.page.waitForFunction(() => Math.abs(document.getElementById('nav-drawer').getBoundingClientRect().right
      - document.getElementById('navbar').getBoundingClientRect().left) <= 1, null, { timeout: 3000 }).catch(() => {});
    const r2 = await ra.page.evaluate(() => ({ dr: Math.round(document.getElementById('nav-drawer').getBoundingClientRect().right),
      nl: Math.round(document.getElementById('navbar').getBoundingClientRect().left),
      focus: document.getElementById('nav-drawer').contains(document.activeElement) && document.activeElement.tagName !== 'INPUT' }));
    check('844×390: ☰ opens the drawer beside the rail, focus on the drawer', Math.abs(r2.dr - r2.nl) <= 1 && r2.focus, JSON.stringify(r2));
    await ra.close();
    // The station panel on a phone (390×844): one state, full height under
    // the bar, the bar live, a 44px close that closes it.
    const ph = await open('?station=aceabsar', { ...touch(390, 844), ready: sheetOpen });
    const p1 = await ph.page.evaluate(() => {
      const sh = document.querySelector('.mco-sheet'), r = sh.getBoundingClientRect(), nav = document.getElementById('navbar');
      const c = sh.querySelector('[data-close-sheet]').getBoundingClientRect();
      return { state: sh.dataset.state, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
        navBottom: Math.round(nav.getBoundingClientRect().bottom), ih: innerHeight, iw: innerWidth, navInert: !!nav.closest('[inert]'),
        close: [Math.round(c.width), Math.round(c.height)], grip: !!sh.querySelector('.mco-sheet-grip, [data-peek]') };
    });
    check('390×844: panel full, from the bar to the bottom, full width', p1.state === 'full' && Math.abs(p1.top - p1.navBottom) <= 1
      && Math.abs(p1.bottom - p1.ih) <= 1 && p1.left === 0 && p1.right === p1.iw, JSON.stringify(p1));
    check('390×844: the bar stays live (not inert), ☰ hit-testable', !p1.navInert && (await hit(ph.page, '#btn-rail-menu')));
    check('390×844: 44px close, no grip or data-peek', p1.close[0] >= 44 && p1.close[1] >= 44 && !p1.grip, JSON.stringify(p1.close));
    await ph.page.click('.mco-sheet [data-close-sheet]');
    await ph.page.waitForFunction(() => document.querySelector('.mco-sheet').dataset.state === 'closed', null, { timeout: 5000 }).catch(() => {});
    check('390×844: the close button closes the panel', await ph.page.evaluate(() => document.querySelector('.mco-sheet').dataset.state === 'closed'));
    await ph.close();
    // The legend on a phone (MCO.initLegendDrawer): a Legend button on the
    // map, the panel in a "Legend" group at the end of the drawer; the
    // button opens the drawer there with the legend expanded and focus on
    // its title. At 1440 it floats with no button.
    const lp = await open('', { ...touch(390, 844), ready: rows });
    const l1 = await lp.page.evaluate(() => {
      const b = document.querySelector('.mco-legend-btn'), slot = document.querySelector('#nav-drawer > .mco-legend-slot:last-child');
      return { btn: !!b && !b.hidden, inSlot: !!slot && slot.contains(document.getElementById('legend')), name: b && b.textContent.trim() };
    });
    check('390×844: Legend button on the map, legend in the drawer\'s last group', l1.btn && l1.inSlot && l1.name === 'Legend', JSON.stringify(l1));
    check('390×844: Legend button hit-testable', await hit(lp.page, '.mco-legend-btn'));
    await lp.page.click('.mco-legend-btn');
    await lp.page.waitForFunction(() => document.getElementById('nav-drawer').classList.contains('is-open'), null, { timeout: 5000 }).catch(() => {});
    const l2 = await lp.page.evaluate(() => ({ focus: document.activeElement && document.activeElement.id,
      expanded: document.getElementById('legend-toggle-btn').getAttribute('aria-expanded') }));
    check('390×844: Legend button opens the drawer at the legend', l2.focus === 'legend-title' && l2.expanded === 'true', JSON.stringify(l2));
    await lp.close();
    const ld = await open('', { ready: rows });
    check('1440: the legend floats, no Legend button', await ld.page.evaluate(() =>
      !document.getElementById('legend').classList.contains('is-in-drawer') && !!document.getElementById('legend').closest('#map-container')
      && (!document.querySelector('.mco-legend-btn') || document.querySelector('.mco-legend-btn').hidden)));
    await ld.close();
  },
};
