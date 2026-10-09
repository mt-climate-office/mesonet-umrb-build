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
    && /^loaded /.test(document.getElementById('refresh-stamp')?.textContent || '');
};

export default {
  root: '../mesonet-umrb-build',
  page: 'index.html',
  // The intro modal opens on a first visit; seed its seen-key so it does not
  // sit over every scenario. (Its own behavior is exercised by keyboard.mjs
  // through the info button.)
  storage: { 'mco-status-seen-intro': '1' },
  scenarios: [
    { name: 'default', query: '', ready: dataDrew },
    // Station deep link: a station popup (desktop) or the station sheet
    // (compact, kit 0.9.0 pass 2) carrying that station's name.
    {
      name: 'station', query: '?station=aceabsar',
      ready: () => {
        const el = document.querySelector('.maplibregl-popup, .mco-sheet:not([hidden]):not([data-state="closed"])');
        return !!el && /Absarokee/i.test(el.textContent);
      },
    },
    { name: 'internal', query: '?internal=1', ready: dataDrew },
  ],
  exemptTargets: '',
  allowProblems: [],
  dialogOpener: '.mco-btn-info',
  shortcuts: [{ key: '/', effect: () => document.activeElement?.id === 'search-input' || !!document.querySelector('.mco-search-collapse.is-open, [aria-expanded="true"].mco-search-toggle') }],
  probes: async ({ open, check }) => {
    const s = await open('?station=aceabsar');
    check('?station= re-emitted in the URL', await s.page.evaluate(() => /station=aceabsar/.test(location.search)));
    await s.close();
    const k = await open('?kbd=off');
    check('?kbd=off sticks in the URL', await k.page.evaluate(() => /kbd=off/.test(location.search)));
    await k.close();
  },
};
