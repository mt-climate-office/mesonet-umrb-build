/* ==========================================================================
   UMRB Build Status — application code.

   Classic script, NOT a module: the kit ships mco-core.js / mco-map.js as
   plain globals (MCO, MCO.map), and a classic script keeps this file in the
   same execution mode. Loaded at the end of <body>, after the kit, so the DOM
   and the MCO globals are already there. MapLibre is NOT: since kit 0.8.0 it
   is MapLibre 6 (ES modules only), imported by MCO.map.loadMapLibre(). The
   UI below (theme, modal, search, legend) is wired first and never waits on
   it; the map itself is built in initMap() once the library has arrived.

   Extracted from the inline <script type="module"> during the mco-web-style
   migration (kit @0.6.0) — an external file is what lets the page ship a
   meta CSP without 'unsafe-inline'.
   ========================================================================== */
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  // Absolute: this page is a static GitHub Pages site (proxied at
  // mesonet.climate.umt.edu/umrb/), so the API is always cross-origin. The
  // status feed is a live AirTable read that only the mesonet-db-rds API
  // serves; it answers with CORS `*`. The host must also appear in the meta
  // CSP connect-src in index.html.
  const API_BASE   = 'https://mesonet2.climate.umt.edu/api/v2';
  const STATUS_URL = `${API_BASE}/stations/status/live?type=json`;
  const DASH_URL   = (s) => `https://mesonet.climate.umt.edu/dash/${encodeURIComponent(s)}`;
  const GRIDS_URL  = 'data/mt_grids_simple.geojson';
  const STATE_URL  = 'data/mt_state_simple.geojson';

  const SEARCH_FLY_ZOOM  = 9;      // zoom when search/deep-link flies to a cell
  const SEARCH_FLY_SPEED = 1.4;
  const CELL_LABEL_MINZOOM    = 6; // grid cell IDs
  const OVERLAY_LABEL_MINZOOM = 8; // county / watershed / reservation names

  const NULL_COLOR = '#9aa3b3';

  // Cells are drawn as partially-transparent fills, so what you see is the
  // category color composited over the basemap. Both numbers are needed in JS
  // (not just CSS) so the legend can show the composited color rather than the
  // raw one. The fills sit *beneath* the basemap's own label layers (see
  // firstSymbolLayerId), which is what lets the alpha run this high without
  // burying the town and river names.
  const FILL_OPACITY = { dark: 0.78, light: 0.78 };
  // Flat stand-in for the CARTO Dark Matter / Positron land color.
  const BASEMAP_BG   = { dark: '#0e1116', light: '#fbfaf8' };

  // Cells whose station is installed and maintained by NDAWN rather than the
  // Mesonet. They carry no row in the station registry, so they are matched by
  // cell ID and shown as operational with their own popup note.
  const NDAWN_CELLS = new Set(['S-2', 'R-2', 'S-3', 'S-4']);

  // ── The buildout ramp ────────────────────────────────────────────────────
  // These categories are not seven unrelated things — they are one ordered
  // progression, from a cell nobody has claimed to a station that is running:
  //
  //   available → pending 2027 → install 2026 → contracted
  //             → ground game → structure → operational
  //
  // So they get one ramp rather than seven hand-picked hues: Fabio Crameri's
  // `roma`, from the Scientific colour maps, sampled at seven even positions.
  // The hues are the kit's roma — MCO.palette 'roma' (kit 0.12.0, Crameri v8,
  // 11 stops) — read at t = stage/6, with "Build in progress" at t = 0.75
  // (below). The hexes in VIEWS are derived OFFLINE, because the lightness
  // remap below has no runtime equivalent in the kit; they stay hard-coded.
  // Checked against MCO.palette.colorAt('roma', t) at those positions (kit
  // 0.12.0): OKLab hue agrees within 1.3° for every stage in both themes,
  // except 'Available cell' on light (3.1°, the deepest point of the remap).
  // Only lightness (and with it chroma) moves.
  // roma is perceptually uniform (adjacent steps differ by an equal, visible
  // amount), readable in grayscale, and CVD-tested by construction — worst-case
  // pairwise ΔE in CAM02-UCS is 14.6 (light) / 16.0 (dark) under simulated
  // deuteranopia, protanopia and tritanopia. For comparison a rainbow scores
  // ~3, and viridis over these same seven stages scored ~7.
  //   Crameri, F. (2018). Scientific colour maps. doi:10.5281/zenodo.1243862
  //
  // roma diverges from dark red-brown through a pale middle to deep blue, which
  // suits the data: the two ends are the terminal states (nobody has claimed
  // this cell / a station is running) and the pale, most salient middle is the
  // work actually in flight. Running it in this direction also keeps the old
  // Leaflet map's strongest cue — an unclaimed cell still reads red.
  //
  // A diverging ramp is the one shape that fights a two-theme map: its pale
  // middle sinks into Positron and its dark ends sink into Dark Matter. Sliding
  // the sampled span per theme (what a sequential ramp would do) cannot fix
  // that, so instead both themes take the SAME seven hues with their CAM02-UCS
  // lightness remapped into a band that clears a contrast floor against that
  // theme's basemap. Hue, chroma and the diverging shape survive; only the
  // lightness envelope moves.
  //
  //   light: J' ∈ [20, 76]      dark: J' ∈ [34, 90]
  //
  // The public view merges the two construction milestones into one bucket, so
  // its "Build in progress" is sampled at the MIDPOINT of the two internal
  // stages it covers, then put through the same lightness remap. That is what
  // keeps the two views legible against each other: the public band sits
  // exactly where its two halves came from, rather than being a seventh
  // unrelated color.
  const VIEWS = {
    public: {
      cats: [
        { key: 'active',       light: '#001e8d', dark: '#1b47aa', label: 'Operational' },
        { key: 'building',     light: '#0481ab', dark: '#44a5d0', label: 'Build in progress' },
        { key: 'contracted',   light: '#97c09b', dark: '#c0ebc4', label: 'Installation pending' },
        { key: 'candidate-26', light: '#a69338', dark: '#ceb95a', label: 'Install 2026' },
        { key: 'candidate-27', light: '#8b5308', dark: '#b2742a', label: 'Pending 2027' },
        { key: 'unassigned',   light: '#690500', dark: '#95290d', label: 'Available cell' },
      ],
    },
    internal: {
      cats: [
        { key: 'active',       light: '#001e8d', dark: '#1b47aa', label: 'Operational' },
        { key: 'structures',   light: '#0065a1', dark: '#3887c5', label: 'Station structure complete' },
        { key: 'ground',       light: '#37a0b2', dark: '#64c7d9', label: 'Ground game complete' },
        { key: 'contracted',   light: '#97c09b', dark: '#c0ebc4', label: 'Installation pending' },
        { key: 'candidate-26', light: '#a69338', dark: '#ceb95a', label: 'Install 2026' },
        { key: 'candidate-27', light: '#8b5308', dark: '#b2742a', label: 'Pending 2027' },
        { key: 'unassigned',   light: '#690500', dark: '#95290d', label: 'Available cell' },
      ],
    },
  };
  const VIEW_NAMES = Object.keys(VIEWS);

  // Registry `status` → category key. Everything not listed (inactive,
  // decommissioned, pending, or no station at all) falls through to
  // 'unassigned', i.e. the cell is available — same rule as the Leaflet map.
  function categoryFor(status, view) {
    switch (status) {
      case 'active':       return 'active';
      case 'contracted':   return 'contracted';
      case 'ground':       return view === 'internal' ? 'ground'     : 'building';
      case 'structures':   return view === 'internal' ? 'structures' : 'building';
      case 'candidate-26': return 'candidate-26';
      case 'candidate-27': return 'candidate-27';
      default:             return 'unassigned';
    }
  }

  // Reference overlays. Streamed from the MCO data service as FlatGeobuf only
  // when their chip is switched on, then cached in memory for the session.
  const OVERLAYS = [
    { key: 'tribal',   label: 'Tribal lands', url: 'https://data.climate.umt.edu/mesonet/fgb/mt_tribes.fgb' },
    { key: 'counties', label: 'Counties',     url: 'https://data.climate.umt.edu/mesonet/fgb/mt_counties.fgb' },
    { key: 'hucs',     label: 'Watersheds',   url: 'https://data.climate.umt.edu/mesonet/fgb/mt_hucs.fgb' },
  ];
  const OVERLAY_BY_KEY = new Map(OVERLAYS.map(o => [o.key, o]));

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const refreshStampEl = document.getElementById('refresh-stamp');
  const layerFiltersEl = document.getElementById('layer-filters');
  const legendRowsEl   = document.getElementById('legend-rows');
  const searchInput    = document.getElementById('search-input');
  const searchDropdown = document.getElementById('search-dropdown');
  const infoModal      = document.getElementById('info-modal');
  const brandFlagEl    = document.getElementById('brand-flag');

  // Say what a detail opened via click, search, or deep-link contains, through
  // the kit's one announcer (MCO.announce, kit 0.8.0): its live regions exist
  // from load, and it clears before setting so reopening the same cell is
  // read again — the hand-made #sr-announce region did neither.
  function announceCell(cellId) {
    const c = cellById.get(cellId);
    if (!c) return;
    const label = catLabel(c.cat);
    const s = c.stationId ? stationById.get(c.stationId) : null;
    MCO.announce(s
      ? `Cell ${cellId}, ${label}, ${s.name}.`
      : `Cell ${cellId}, ${label}.`);
  }
  // Same, for a detail opened on a station dot rather than a cell.
  function announceStation(stationId) {
    const s = stationById.get(stationId);
    if (!s) return;
    const cell = s.ace_grid ? normalizeCell(s.ace_grid) : null;
    const known = cell ? cellById.get(cell) : null;
    const label = catLabel(known ? known.cat : categoryFor(s.status, activeView));
    MCO.announce(known
      ? `${s.name || s.station}, ${label}, cell ${cell}.`
      : `${s.name || s.station}, ${label}, no cell in this grid.`);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    // Parse as a local calendar date; the registry stores plain YYYY-MM-DD, and
    // `new Date('2024-05-01')` would otherwise be read as UTC midnight and slip
    // a day west of Greenwich.
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return '—';
    return new Date(y, m - 1, d)
      .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  }
  // The family stamp (kit 0.21.0): "Updated 2:45 PM MST", in Mountain time
  // whatever the viewer's zone, with the date when it is not today there.
  // The status feed carries no observation time (it is a live read of the
  // registry), so the time is when this page read it — the kit's rule for
  // a feed without a data time. At ≤1400px the kit hides the word
  // "Updated" visually; screen readers still hear the whole phrase.
  function refreshStamp() {
    MCO.formatUpdatedMT(Date.now(), { into: refreshStampEl });
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  // High-contrast is a dark-family theme, so this tests `!== 'light'` rather
  // than `=== 'dark'`. The old `=== 'dark'` form is exactly what dropped a
  // high-contrast viewer onto the light basemap; MCO.map.cartoStyleUrl() now
  // owns that decision.
  const isDark = () => MCO.getTheme() !== 'light';

  // Three states (kit 0.10.0): dark → light → high contrast → dark, so high
  // contrast is reachable from the page, not only from ?theme=. The icon and
  // the aria-label name the theme a press switches TO.
  MCO.initThemeToggle({
    button:   document.getElementById('btn-theme'),
    iconSun:  document.getElementById('icon-sun'),
    iconMoon: document.getElementById('icon-moon'),
    iconContrast: document.getElementById('icon-contrast'),
    cycle: true,
    onChange: () => {
      // The library still loading: initMap reads the theme when it runs.
      // Otherwise swap the basemap; onStyleLoad() puts our layers back.
      if (map) map.setStyle(MCO.map.cartoStyleUrl());
      pushState();
    },
  });

  // ── Storage keys ─────────────────────────────────────────────────────────
  // This page shares an origin with mesonet-status (mesonet.climate.umt.edu,
  // /umrb/ beside /status/), and until kit 0.21.0 it stored its settings
  // under status's prefix. 'mco-status-seen-intro', '-labels' and '-legend'
  // are keys status itself uses, so the two apps were reading each other's
  // choices: seeing one intro suppressed the other. Every key is now
  // 'mco-umrb-*' (kit rule: mco-<app>-*).
  //   - Keys only this page wrote ('-stations', '-overlays') migrate: the
  //     old value is read once, written under the new key, and removed.
  //   - Keys status also owns ('-labels', '-legend') are copied once and
  //     left in place: removing them would erase status's own setting.
  //   - The intro flag is NOT carried over: the old one cannot tell which of
  //     the two intros a visitor saw, so this page's intro shows once more
  //     under its own key. Status's flag is left alone.
  const KEY = {
    intro:    'mco-umrb-seen-intro',
    stations: 'mco-umrb-stations',
    overlays: 'mco-umrb-overlays',
    labels:   'mco-umrb-labels',
    legend:   'mco-umrb-legend',
    migrated: 'mco-umrb-keys-migrated',
  };
  function migrateKey(oldKey, newKey, removeOld) {
    try {
      const v = localStorage.getItem(oldKey);
      if (v == null) return;
      if (localStorage.getItem(newKey) == null) localStorage.setItem(newKey, v);
      if (removeOld) localStorage.removeItem(oldKey);
    } catch (e) { /* storage unavailable: nothing to migrate */ }
  }
  // Once per browser, so a status setting made later is never copied over.
  if (MCO.lsGet(KEY.migrated) == null) {
    migrateKey('mco-status-stations', KEY.stations, true);
    migrateKey('mco-status-overlays', KEY.overlays, true);
    migrateKey('mco-status-labels',   KEY.labels,   false);
    migrateKey('mco-status-legend',   KEY.legend,   false);
    MCO.lsSet(KEY.migrated, '1');
  }

  // ── Info modal ───────────────────────────────────────────────────────────
  // The kit owns backdrop-click, [data-close-modal] delegation, focus on the
  // close button and opener-captured focus restore — and, since 0.21.0, the
  // first-visit intro: it opens once per key, marks it seen as it opens,
  // and stands down on a deep link (skip) or once focus has left <body>.
  const btnInfo = document.getElementById('btn-info');
  // In the compact drawer (or the landscape rail's) the info button sits in
  // the drawer: close it before the dialog opens (capture, so it runs
  // first), and when the dialog closes onto the now-hidden button, land on
  // ☰ instead.
  btnInfo.addEventListener('click', () => {
    if (rail.isOpen()) rail.close({ restoreFocus: false });
  }, true);
  infoModal.addEventListener('close', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if ((rail.isRail() || rail.isDrawerMode()) && (!a || a === document.body || !a.getClientRects().length)) {
        document.getElementById('btn-rail-menu').focus();
      }
    }, 0);
  });
  document.getElementById('info-credit').textContent =
    MCO.credit({ source: 'Station status: MCO station registry' });

  // A deep link means the visitor was sent to something specific — don't
  // bury it under the intro.
  const _bootParams = MCO.urlParams();
  const _isDeepLink = ['cell', 'station', 'lng', 'lat', 'zoom']
    .some((k) => _bootParams.has(k));
  MCO.initInfoModal({
    dialog: infoModal, trigger: btnInfo,
    intro: { key: KEY.intro, skip: _isDeepLink },
  });

  // ── State ────────────────────────────────────────────────────────────────
  let stations    = [];            // raw /stations/status/live response
  let stationById = new Map();     // station slug → registry row
  let cellById    = new Map();     // cell ID → { cat, stationId, center }
  let dataUnavailable = false;     // true if the status fetch failed/empty
  let _gridsFC  = null;            // raw grid geometry, fetched once
  let _stateFC  = null;
  let _mapReady = false;

  async function preloadOverlay(sourceId, url, save) {
    try {
      const fc = await MCO.fetchJSON(url);
      save(fc);
      // If the source still has the URL data (initial load), swap to the
      // in-memory copy so subsequent re-adds don't refetch.
      const src = map.getSource(sourceId);
      if (src) src.setData(fc);
    } catch { /* the state outline is decorative — silent failure is fine */ }
  }

  // ── URL state ────────────────────────────────────────────────────────────
  // URL params take precedence over localStorage take precedence over defaults.
  // All enum-string values are matched case-insensitively. Lists may be separated
  // by spaces (which '+' decodes to via URLSearchParams), commas, or both.
  // Read once at boot. getLower / splitTokens are the kit's — this file used to
  // carry byte-identical copies of both.
  const urlParams = MCO.urlParams();
  const getLower = (key) => MCO.getParamLower(key, urlParams);
  const splitTokens = MCO.splitTokens;

  // Internal view. Historically toggled by a bare `?internal=1`; that keeps
  // working, and `?view=internal` is accepted too. Deliberately has no button:
  // the extra construction milestones it exposes are pre-announcement detail,
  // so you reach this view by knowing the URL. Not persisted to localStorage —
  // a shared machine should never stay in it.
  const activeView = (() => {
    if (getLower('view') === 'internal') return 'internal';
    const raw = getLower('internal');
    if (raw != null && !['', '0', 'false', 'no', 'off'].includes(raw)) return 'internal';
    return 'public';
  })();
  brandFlagEl.hidden = activeView !== 'internal';

  // ?kbd=off disables the single-character '/' shortcut (WCAG 2.1.4 — a
  // speech-input user can misfire it just by dictating a sentence). Read up
  // here with the rest of the URL state, not down in the keyboard section:
  // pushState() emits it and can run during init, which would put a late
  // `const` in its temporal dead zone.
  const kbdShortcuts = getLower('kbd') !== 'off';

  const _initLng    = parseFloat(urlParams.get('lng'));
  const _initLat    = parseFloat(urlParams.get('lat'));
  const _initZoom   = parseFloat(urlParams.get('zoom'));
  const _hasInitPos = Number.isFinite(_initLng) && Number.isFinite(_initLat) && Number.isFinite(_initZoom);
  // Station IDs in the API are lowercase; cell IDs are uppercase (H-8).
  const _initStation = getLower('station');
  const _initCell    = urlParams.get('cell') ? normalizeCell(urlParams.get('cell')) : null;

  // ── Legend category visibility (Plotly-style toggles) ────────────────────
  // Each view has its own visible-category set. Missing URL param = all visible.
  // The URL param name for a view's cat set is `cat-<view>` (e.g. cat-public).
  const catParamKey = (view) => `cat-${view}`;
  function allCatKeys(view) { return VIEWS[view].cats.map(c => c.key); }
  function parseCatSet(view) {
    const allKeys = allCatKeys(view);
    const tokens = splitTokens(urlParams.get(catParamKey(view)));
    if (tokens === null) return new Set(allKeys);
    // Case-insensitive match against the view's keys.
    const lowerToKey = new Map(allKeys.map(k => [k.toLowerCase(), k]));
    const set = new Set(tokens.map(t => lowerToKey.get(t)).filter(Boolean));
    return set.size ? set : new Set();   // an explicit empty list = nothing visible
  }
  const visibleCatsByView = {};
  for (const view of VIEW_NAMES) visibleCatsByView[view] = parseCatSet(view);
  function currentCats()    { return visibleCatsByView[activeView]; }
  function currentAllCats() { return allCatKeys(activeView); }
  const catByKey = (key) => VIEWS[activeView].cats.find(c => c.key === key) || null;
  function catLabel(key) {
    const c = catByKey(key);
    return c ? c.label : key;
  }
  // Every category carries both theme variants — see the VIEWS comment for why
  // the two themes sample different spans of the same ramp.
  function catColor(key) {
    const c = catByKey(key);
    if (!c) return NULL_COLOR;
    return isDark() ? c.dark : c.light;
  }

  // ── Color math (legend swatches) ─────────────────────────────────────────
  const parseHex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex    = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const relLum   = (c) => {
    const s = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  };
  // The color a cell actually appears as: the category color alpha-composited
  // over the basemap, exactly as MapLibre draws it. Used for legend swatches so
  // the chip reads as the same color as the cells it controls.
  function swatchColor(key) {
    const theme = isDark() ? 'dark' : 'light';
    const a  = FILL_OPACITY[theme];
    const bg = parseHex(BASEMAP_BG[theme]);
    const c  = parseHex(catColor(key));
    return toHex(c.map((v, i) => v * a + bg[i] * (1 - a)));
  }
  // Pills are solid, so their label has to flip between light and dark text
  // depending on the fill. Picking whichever of white / black has more
  // contrast clears WCAG 1.4.3 AA for every fill in both views and every
  // theme (worst case 4.73:1). The dark option used to be #1a1a2e, which
  // left three mid-lightness fills under 4.5:1 — "Pending 2027" on dark
  // (#b2742a, 4.41:1), "Build in progress" on light (#0481ab, 4.44:1) and
  // "Station structure complete" on dark (#3887c5, 4.42:1). Found by axe
  // on the orphan-station popup; no earlier scan opened a popup.
  function readableOn(hex) {
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const l = relLum(parseHex(hex));
    return ratio(l, 1) >= ratio(l, 0) ? '#ffffff' : '#000000';
  }

  // ── Layer toggles (station dots + reference overlays) ─────────────────────
  let stationsOn = (() => {
    const u = getLower('stations');
    if (u === 'on' || u === 'off') return u === 'on';
    const saved = MCO.lsGet(KEY.stations);
    return saved == null ? true : saved === 'on';   // dots are on by default
  })();
  const activeOverlays = (() => {
    const tokens = splitTokens(urlParams.get('overlays'));
    if (tokens !== null) return new Set(tokens.filter(t => OVERLAY_BY_KEY.has(t)));
    try {
      const saved = JSON.parse(MCO.lsGet(KEY.overlays) || 'null');
      if (Array.isArray(saved)) return new Set(saved.filter(t => OVERLAY_BY_KEY.has(t)));
    } catch {}
    return new Set();
  })();

  let _selectedCell = _initCell;
  // A station detail and a cell detail are mutually exclusive — only one
  // is open at a time, and each owns its own URL parameter.
  let _selectedStation = null;

  // A station dot's category: its own registry status (a cell's category is
  // its first-claiming station's, so a second station in a cell keeps its own).
  function stationCat(s) { return categoryFor(s.status, activeView); }

  // Grid cells are labelled LETTER-NUMBER with no zero padding (H-8), but the
  // registry sometimes carries a padded form (H-08). Normalize to the map's
  // spelling — same rule the Leaflet map applied inline.
  function normalizeCell(raw) {
    return String(raw).trim().toUpperCase().replace(/-0+(\d)/, '-$1');
  }

  // ── Map init ─────────────────────────────────────────────────────────────
  // Created by initMap() once MapLibre 6 has loaded (see Boot). Everything
  // that touches the map before then checks for it.
  let map = null;

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function addCustomLayers() {
    if (!map.getSource('cells'))    map.addSource('cells',    { type: 'geojson', data: emptyFC() });
    if (!map.getSource('stations')) map.addSource('stations', { type: 'geojson', data: emptyFC() });
    if (!map.getSource('state')) {
      map.addSource('state', { type: 'geojson', data: _stateFC || STATE_URL });
    }
    if (!_stateFC) preloadOverlay('state', STATE_URL, fc => _stateFC = fc);

    // Themed live-shaded topography, underneath everything we draw. The UMRB
    // cells run at 0.78 alpha, so relief reads through the fills and across the
    // gaps between them — which is most of what orients an eastern-Montana
    // extent that has few basemap labels.
    MCO.map.addHillshade(map);

    // CARTO draws its own dashed county boundaries (pale orange on Positron,
    // z9+). We draw counties as a toggleable overlay, so the basemap's copy is
    // a duplicate that can't be turned off — hide it. Re-run on every style
    // load, because setStyle brings it back.
    if (map.getLayer('boundary_county')) {
      map.setLayoutProperty('boundary_county', 'visibility', 'none');
    }

    // Everything from here to 'state-line' goes beneath the basemap's labels.
    const belowLabels = MCO.map.firstSymbolLayerId(map);

    // Grid cells are the subject of this map, so they sit at the bottom of our
    // stack and everything else reads on top of them.
    if (!map.getLayer('cells-fill')) {
      map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', paint: cellFillPaint() },
                   belowLabels);
    }
    if (!map.getLayer('cells-line')) {
      map.addLayer({
        id: 'cells-line', type: 'line', source: 'cells',
        layout: { 'line-join': 'round' },
        paint: cellLinePaint(),
      }, belowLabels);
    }

    // Montana state boundary — heavier line so the state shape reads as the
    // dominant frame. No fill (the basemap already provides context).
    if (!map.getLayer('state-line')) {
      map.addLayer({
        id: 'state-line', type: 'line', source: 'state',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: stateLinePaint(),
      }, belowLabels);
    }

    // Reference overlays live between the grid and the state outline; their
    // sources/layers are created lazily by loadOverlay() and inserted beneath
    // 'state-line', so it has to exist first.
    reapplyOverlays();

    if (!map.getLayer('cells-label')) {
      map.addLayer({
        id: 'cells-label', type: 'symbol', source: 'cells',
        minzoom: CELL_LABEL_MINZOOM,
        layout: cellLabelLayout(),
        paint: cellLabelPaint(),
      });
    }

    // Station dots last so they always win against fills and outlines.
    // A colocated site (stations within ~11 m) is one dot with a count
    // badge that fans out on hover or first tap (MCO.map.colocation, kit
    // 0.21.0). The registry has no such site today, so the badge and the
    // spider normally draw nothing; they are there so a second station at
    // a site never hides under the first.
    coloc.addSources();
    if (!map.getLayer('stations-spider-lines')) {
      map.addLayer({ id: 'stations-spider-lines', type: 'line', source: coloc.spiderLinesSource,
                     paint: MCO.map.colocation.spiderLinePaint() });
    }
    if (!map.getLayer('stations-layer')) {
      map.addLayer({ id: 'stations-layer', type: 'circle', source: 'stations',
                     filter: MCO.map.colocation.ANCHOR_ONLY, paint: stationPaint() });
    }
    for (const l of MCO.map.colocation.badgeLayers({ id: 'stations-badge', source: 'stations' })) {
      if (!map.getLayer(l.id)) map.addLayer(l);
    }
    if (!map.getLayer('stations-spider')) {
      map.addLayer({ id: 'stations-spider', type: 'circle', source: coloc.spiderSource, paint: stationPaint() });
    }

    applyAllFilters();
    applyLabelsVisibility();
    applyStationsVisibility();
  }

  // ── Paint expression generators ──────────────────────────────────────────
  // Simple match on the cell category → the active view's category colors.
  function paintColorForView() {
    const expr = ['match', ['get', 'cat']];
    for (const c of VIEWS[activeView].cats) expr.push(c.key, catColor(c.key));
    expr.push(NULL_COLOR);   // fallback
    return expr;
  }

  function cellFillPaint() {
    return {
      'fill-color': paintColorForView(),
      // Slightly hotter in dark mode: the same alpha over a dark basemap reads
      // considerably duller than it does over Positron.
      'fill-opacity': FILL_OPACITY[isDark() ? 'dark' : 'light'],
    };
  }
  function cellLinePaint() {
    return {
      'line-color':   isDark() ? '#0d1117' : '#1a1a2e',
      'line-width':   0.8,
      'line-opacity': isDark() ? 0.55 : 0.45,
    };
  }
  function cellLabelLayout() {
    return {
      'text-field': ['get', 'cell'],
      'text-font':  ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size':  ['interpolate', ['linear'], ['zoom'], 6, 9, 10, 12, 14, 14],
      'text-padding': 2,
      'text-allow-overlap': false,
      'text-optional': true,
    };
  }
  function cellLabelPaint() {
    return {
      'text-color':      isDark() ? '#e8ecf0' : '#1a1a2e',
      'text-halo-color': isDark() ? '#161b22' : '#ffffff',
      'text-halo-width': 1.4,
      'text-halo-blur':  0.4,
    };
  }
  // The dot marks *where* a station is; the cell behind it carries the status.
  // So it is deliberately achromatic: pure lightness contrast separates it
  // from the colored categories, and a hue would only duplicate one of them.
  //
  // The kit's one station circle (MCO.map.stationPaint, kit 0.21.0): no
  // network encoding, as everywhere in the family. Its colors are read from
  // tokens at paint time: the fill is this page's --c-station and the edge is
  // --bg-deep, the basemap-dark (or -light) opposite of the fill. The kit's
  // default edge (--dot-stroke) is white on the dark themes — right for a
  // colored dot, invisible around a white one. The radius ramp stays this
  // map's: the dots sit inside cells and must not cover them at low zoom.
  function stationPaint() {
    return {
      ...MCO.map.stationPaint({
        fill:   MCO.cssVar('--c-station'),
        stroke: MCO.cssVar('--bg-deep'),
        radius: ['interpolate', ['linear'], ['zoom'], 4, 2.5, 7, 4, 10, 6, 14, 8],
      }),
      'circle-opacity': 0.95,
    };
  }
  // The state outline is the kit's shared boundary treatment, not app data —
  // same neutral line every MCO map draws Montana with.
  function stateLinePaint() { return MCO.map.overlayPaints().stateLine; }
  // County and watershed boundaries are context, not data: one muted line,
  // now off the kit's --text-muted token rather than a hardcoded pair.
  // Tribal lands are the exception — see overlayPaintsFor().
  function overlayLinePaint() { return MCO.map.overlayPaints().countiesLine; }
  function overlayLabelPaint() {
    return {
      'text-color':      isDark() ? '#9aa3b3' : '#4a5262',
      'text-halo-color': isDark() ? '#161b22' : '#ffffff',
      'text-halo-width': 1.4,
      'text-halo-blur':  0.3,
    };
  }

  // Theme changes go through map.setStyle(), which wipes every custom layer;
  // addCustomLayers() then rebuilds them and each paint generator above reads
  // the new theme. So there is deliberately no in-place repaint path here.

  // ── Data fetch ───────────────────────────────────────────────────────────
  // Grid geometry ships with the page and never changes within a session, so it
  // is fetched once; station status is re-read on every Refresh.
  function fetchStatus() {
    return MCO.fetchJSON(STATUS_URL, { cache: 'no-store' });
  }

  async function loadAll() {
    try {
      const [grids, status] = await Promise.all([
        _gridsFC ? Promise.resolve(_gridsFC) : MCO.fetchJSON(GRIDS_URL),
        fetchStatus().catch(() => null),
      ]);
      _gridsFC = grids;

      const rows = Array.isArray(status) ? status : [];
      dataUnavailable = rows.length === 0;
      stations = rows;
      if (dataUnavailable) {
        showDataNotice('warning', 'Station status unavailable',
          'Showing the grid without status.');
      } else {
        closeDataNotice();
      }

      indexData();
      populateSearch();
      rebuildCells();
      applyAllFilters();
      renderLegend();
      refreshStamp();
      MCO.ready();   // first meaningful state: the grid is shaded (idempotent)

      // Deep-link from ?cell=… / ?station=… . loadAll() only runs after the
      // map's first style.load, so the layers always exist by this point.
      // ?station= opens the station itself; ?cell= opens the cell. Resolving a
      // station down to its cell (the old behaviour) lost the distinction and
      // dropped any station whose ace_grid is not in the drawn grid.
      // The kit's flyToAndOpen waits for the map to be idle with the target
      // in view; this page used to open on the first moveend, which under
      // reduced motion fired before it was listened for, so the link zoomed,
      // opened nothing, and lost ?station= from the URL. With a camera in the
      // link (lng/lat/zoom) it keeps that camera, and opens without moving
      // when the target is in view. url 'replace': the link's history entry
      // is the page's own, so closing must never step Back off the site.
      const zoom = _hasInitPos ? map.getZoom() : SEARCH_FLY_ZOOM;
      if (!_deepLinkConsumed && _initStation && stationById.has(_initStation)) {
        _deepLinkConsumed = true;
        flyToStation(_initStation, { url: 'replace', zoom });
      } else if (!_deepLinkConsumed && _initCell && cellById.has(_initCell)) {
        _deepLinkConsumed = true;
        flyToCell(_initCell, { url: 'replace', zoom });
      } else {
        // Push initial URL so it's clean even if the user hasn't interacted yet
        pushState();
      }
    } catch (err) {
      console.error(err);
      dataUnavailable = true;
      showDataNotice('danger', 'Error', `The map data failed to load (${err.message}).`);
      // Still render whatever we have — an unshaded grid is better than nothing.
      indexData();
      populateSearch();
      rebuildCells();
      applyAllFilters();
      renderLegend();
      MCO.ready();
    }
  }
  // Only consume the deep link once (initial load); Refresh shouldn't refly.
  let _deepLinkConsumed = false;

  // A failed or empty load is a persistent kit notice over the map (kit
  // 0.8.0, .mco-notice) with a Retry, rather than the page's own amber card:
  // the tone word is visible text, it is announced once (assertively — a
  // load failure), and it can be dismissed. One at a time; a good load
  // closes it.
  let _dataNotice = null;
  function closeDataNotice() {
    if (_dataNotice) { const n = _dataNotice; _dataNotice = null; n.close(); }
  }
  function showDataNotice(tone, toneLabel, text) {
    closeDataNotice();
    const n = MCO.notice({
      tone, toneLabel, text,
      container: document.getElementById('map-container'), place: 'over',
      politeness: 'assertive',
      action: { label: 'Retry', onClick: () => { closeDataNotice(); refreshData(); } },
      onClose: () => { if (_dataNotice === n) _dataNotice = null; },
    });
    _dataNotice = n;
  }

  // Build the station lookup and the cell → status join in one pass.
  function indexData() {
    stationById.clear();
    cellById.clear();

    // Station registry, keyed by slug. Rows without usable coordinates are kept
    // (they can still own a cell) but never get a dot.
    for (const s of stations) {
      if (!s || !s.station) continue;
      const lat = Number(s.latitude), lon = Number(s.longitude);
      s.latitude  = Number.isFinite(lat) ? lat : null;
      s.longitude = Number.isFinite(lon) ? lon : null;
      stationById.set(s.station, s);
    }

    // Cell → first station claiming it. First-claim-wins matches the Leaflet
    // map's Array.find(); a cell double-booked in the registry is a data issue
    // to fix upstream rather than something to guess at here.
    const stationByCell = new Map();
    for (const s of stations) {
      if (!s || !s.ace_grid) continue;
      const key = normalizeCell(s.ace_grid);
      if (!stationByCell.has(key)) stationByCell.set(key, s);
    }

    for (const f of (_gridsFC ? _gridsFC.features : [])) {
      const cell = normalizeCell(f.properties.Cell);
      const s = stationByCell.get(cell) || null;
      const ndawn = !s && NDAWN_CELLS.has(cell);
      cellById.set(cell, {
        cell,
        stationId: s ? s.station : null,
        // An NDAWN cell has a station on the ground, just not one of ours.
        cat: ndawn ? 'active' : categoryFor(s && s.status, activeView),
        ndawn,
        center: featureCenter(f),
      });
    }
  }

  // Cheap representative point: the centroid of the feature's bounding box.
  // Grid cells are near-rectangular, so this lands inside the cell and is all
  // flyTo needs.
  function featureCenter(f) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (a) => {
      if (typeof a[0] === 'number') {
        if (a[0] < minX) minX = a[0];
        if (a[0] > maxX) maxX = a[0];
        if (a[1] < minY) minY = a[1];
        if (a[1] > maxY) maxY = a[1];
        return;
      }
      for (const el of a) walk(el);
    };
    walk(f.geometry.coordinates);
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  function rebuildCells() {
    if (!map || !map.getSource('cells') || !_gridsFC) return;

    const cellFeatures = _gridsFC.features.map(f => {
      const cell = normalizeCell(f.properties.Cell);
      const c = cellById.get(cell);
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: { cell, cat: c ? c.cat : 'unassigned' },
      };
    });
    map.getSource('cells').setData({ type: 'FeatureCollection', features: cellFeatures });

    // Station dots. Parity with the Leaflet map: decommissioned stations and
    // rows with no cell assignment are omitted, so the dots always correspond
    // to the buildout the grid is describing. The colocation module groups
    // them and writes the 'stations' source.
    coloc.setData(stations.filter(s => s && s.status !== 'decommissioned' && s.ace_grid
      && s.longitude != null && s.latitude != null));

    rebuildSrTable(cellFeatures);
  }

  // Screen-reader twin of the canvas. WebGL paints to a bitmap that assistive
  // tech cannot read at all, so without this the map's entire content is
  // invisible to a non-sighted user (HOUSE-STYLE §5). One row per cell, built
  // from the same features the map just drew so the two cannot disagree.
  // Rebuilt silently on every repaint — it is not wired to a live region,
  // because announcing a 200-row table on each refresh tick would be noise.
  function rebuildSrTable(cellFeatures) {
    const tbody = document.getElementById('sr-cell-rows');
    if (!tbody) return;
    const rows = cellFeatures
      .slice()
      .sort((a, b) => a.properties.cell.localeCompare(b.properties.cell, 'en', { numeric: true }))
      .map((f) => {
        const cell = f.properties.cell;
        const info = cellById.get(cell);
        const station = info && info.stationId ? stationById.get(info.stationId) : null;
        const name = station ? (station.name || station.station) : '—';
        return `<tr><td>${MCO.escapeHTML(cell)}</td>`
             + `<td>${MCO.escapeHTML(catLabel(f.properties.cat))}</td>`
             + `<td>${MCO.escapeHTML(name)}</td></tr>`;
      });
    tbody.innerHTML = rows.join('');
  }

  // ── Reference overlays (lazy FlatGeobuf) ─────────────────────────────────
  const _overlayFC = new Map();     // key → FeatureCollection, cached per session
  const _overlayLoading = new Set();

  // Stream a .fgb into a FeatureCollection. flatgeobuf.deserialize yields one
  // GeoJSON feature at a time off the response body.
  async function fetchOverlay(o) {
    const res = await fetch(o.url);
    if (!res.ok) throw new Error(`${o.label} fetch failed (${res.status})`);
    const features = [];
    for await (const f of flatgeobuf.deserialize(res.body)) features.push(f);
    return { type: 'FeatureCollection', features };
  }

  // Tribal lands carry the house treatment rather than the generic reference
  // line: a distinct earth-toned fill and outline, and labels shortened from
  // the Census spelling to common usage ("Blackfeet Indian Reservation" →
  // "Blackfeet"). Every other MCO map draws them this way, and a reservation
  // boundary is not the same kind of object as a watershed.
  function overlayPaintsFor(key) {
    const kit = MCO.map.overlayPaints();
    if (key !== 'tribal') {
      return { line: overlayLinePaint(), label: overlayLabelPaint(), fill: null };
    }
    return { line: kit.tribalLine, label: kit.tribalLabelPaint, fill: kit.tribalFill };
  }

  function addOverlayLayers(key) {
    const o = OVERLAY_BY_KEY.get(key);
    const fc = _overlayFC.get(key);
    if (!o || !fc) return;
    const srcId = `ov-${key}`;
    if (!map.getSource(srcId)) map.addSource(srcId, { type: 'geojson', data: fc });
    // Insert beneath the state outline so Montana's border stays dominant.
    const before = map.getLayer('state-line') ? 'state-line' : undefined;
    const paints = overlayPaintsFor(key);
    if (paints.fill && !map.getLayer(`${srcId}-fill`)) {
      map.addLayer({
        id: `${srcId}-fill`, type: 'fill', source: srcId, paint: paints.fill,
      }, before);
    }
    if (!map.getLayer(`${srcId}-line`)) {
      map.addLayer({
        id: `${srcId}-line`, type: 'line', source: srcId,
        layout: { 'line-join': 'round' },
        paint: paints.line,
      }, before);
    }
    if (!map.getLayer(`${srcId}-label`)) {
      map.addLayer({
        id: `${srcId}-label`, type: 'symbol', source: srcId,
        minzoom: OVERLAY_LABEL_MINZOOM,
        layout: key === 'tribal' ? MCO.map.TRIBAL_LABEL_LAYOUT : {
          'text-field': ['coalesce', ['get', 'name'], ['get', 'NAME'], ''],
          // The kit's tribal-label face (0.15.1): CARTO 404s 'Open Sans Semibold'.
          'text-font':  ['Montserrat SemiBold', 'Open Sans Bold'],
          'text-size':  ['interpolate', ['linear'], ['zoom'], 8, 10, 12, 13],
          'text-letter-spacing': 0.05,
          'text-max-width': 8,
          'text-padding': 2,
          'text-allow-overlap': false,
        },
        paint: paints.label,
      }, before);
    }
  }

  function removeOverlayLayers(key) {
    const srcId = `ov-${key}`;
    for (const lid of [`${srcId}-fill`, `${srcId}-line`, `${srcId}-label`]) {
      if (map.getLayer(lid)) map.removeLayer(lid);
    }
    if (map.getSource(srcId)) map.removeSource(srcId);
  }

  // Re-add every switched-on overlay from the in-memory cache. Called after
  // setStyle(), which wipes all custom sources and layers.
  function reapplyOverlays() {
    for (const key of activeOverlays) {
      if (_overlayFC.has(key)) addOverlayLayers(key);
      else loadOverlay(key);
    }
  }

  async function loadOverlay(key) {
    if (_overlayFC.has(key)) { addOverlayLayers(key); return; }
    if (_overlayLoading.has(key)) return;
    const o = OVERLAY_BY_KEY.get(key);
    _overlayLoading.add(key);
    setChipBusy(key, true);
    try {
      _overlayFC.set(key, await fetchOverlay(o));
      // The user may have switched it back off while it was in flight.
      if (activeOverlays.has(key)) addOverlayLayers(key);
    } catch (err) {
      console.error(err);
      activeOverlays.delete(key);
      setChipPressed(key, false);
      MCO.showToast(`Could not load ${o.label.toLowerCase()}`);
    } finally {
      _overlayLoading.delete(key);
      setChipBusy(key, false);
    }
  }

  // ── Layer chip UI ────────────────────────────────────────────────────────
  function chipEl(key) { return layerFiltersEl.querySelector(`.mco-chip[data-layer="${key}"]`); }
  function setChipBusy(key, busy) {
    const el = chipEl(key);
    if (el) el.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  function setChipPressed(key, on) {
    const el = chipEl(key);
    if (el) el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function buildLayerChips() {
    layerFiltersEl.innerHTML = '';
    const entries = [
      { key: 'stations', label: 'Stations', pressed: () => stationsOn },
      ...OVERLAYS.map(o => ({ key: o.key, label: o.label, pressed: () => activeOverlays.has(o.key) })),
    ];
    for (const e of entries) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mco-chip';
      chip.dataset.layer = e.key;
      chip.textContent = e.label;
      chip.setAttribute('aria-pressed', e.pressed() ? 'true' : 'false');
      chip.addEventListener('click', () => {
        const on = chip.getAttribute('aria-pressed') !== 'true';
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (e.key === 'stations') {
          stationsOn = on;
          MCO.lsSet(KEY.stations, on ? 'on' : 'off');
          applyStationsVisibility();
        } else {
          if (on) { activeOverlays.add(e.key); loadOverlay(e.key); }
          else    { activeOverlays.delete(e.key); removeOverlayLayers(e.key); }
          MCO.lsSet(KEY.overlays, JSON.stringify([...activeOverlays]));
        }
        pushState();
      });
      layerFiltersEl.appendChild(chip);
    }
  }

  const STATION_LAYERS = ['stations-layer', 'stations-badge-disc', 'stations-badge',
                          'stations-spider', 'stations-spider-lines'];
  function applyStationsVisibility() {
    if (!map) return;
    if (!stationsOn && coloc) coloc.close();
    for (const lid of STATION_LAYERS) {
      if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', stationsOn ? 'visible' : 'none');
    }
  }

  // Legend category visibility is the only filter; it applies to the cell fill,
  // its outline and label, and the station dots sitting inside those cells, so
  // isolating a status leaves a coherent picture. Stations are filtered in
  // the colocation module (visible()), not by layer filter, so a hidden
  // station also leaves its site's count.
  function applyAllFilters() {
    if (!map || !map.getLayer('cells-fill')) return;
    const catMatch = ['in', ['get', 'cat'], ['literal', [...currentCats()]]];
    for (const lid of ['cells-fill', 'cells-line', 'cells-label']) {
      if (map.getLayer(lid)) map.setFilter(lid, catMatch);
    }
    if (coloc) coloc.refresh();
    updateEmptyState();
  }

  // Show a small callout when the filter state hides everything, so the user
  // knows the empty map is intentional and how to recover. The kit's
  // .mco-empty shell, floated over the map (data-place="over"); filled with
  // DOM nodes, not an HTML string.
  const emptyStateEl = document.getElementById('empty-state');
  function updateEmptyState() {
    if (!emptyStateEl || cellById.size === 0) {
      if (emptyStateEl) emptyStateEl.hidden = true;
      return;
    }
    emptyStateEl.textContent = '';
    if (currentCats().size === 0) {
      const strong = document.createElement('strong');
      strong.textContent = 'All legend categories hidden.';
      emptyStateEl.append(strong, ' Click a legend row to show cells.');
    } else if (![...cellById.values()].some(c => currentCats().has(c.cat))) {
      emptyStateEl.textContent = 'No grid cells match the current filters.';
    }
    emptyStateEl.hidden = !emptyStateEl.textContent;
  }

  // ── Search (MCO.initSearchBox + flyToAndOpen + detail) ─────────────────
  // The kit's APG combobox (kit 0.8.0) on the dashboard's model: ranking,
  // aria-activedescendant, a disabled "No matches" option, polite result
  // counts, and Esc that closes, then clears, then passes through. This page
  // and the maintenance map carried near-identical hand-rolled copies.
  // Items are the stations a search can land on; a station's cell is a
  // keyword, so typing "G-12" finds the station in that cell.
  let _searchItems = [];
  const SEARCH_MAX_RESULTS = 8;

  function populateSearch() {
    _searchItems = stations
      .filter(s => s && s.station && s.status !== 'decommissioned')
      .map((s) => {
        const cell = s.ace_grid ? normalizeCell(s.ace_grid) : null;
        return {
          id: s.station,
          label: s.name || s.station,
          keywords: cell ? [cell] : [],
          meta: `${s.station} · ${cell || 'no cell'}`,
        };
      });
    if (searchBox) searchBox.refresh();
  }

  // A hidden category would fly the user to a blank patch of map — turn it
  // back on rather than silently landing on nothing.
  function ensureCatVisible(cat) {
    if (currentCats().has(cat)) return;
    currentCats().add(cat);
    refreshLegendVisuals();
    applyAllFilters();
  }

  // One flight at a time (MCO.map.flyToAndOpen, kit 0.21.0): it opens the
  // detail once the map is idle with the target in view. While it is in the
  // air the URL already carries the target (_pendingDetail), so a moveend
  // on the way cannot strip ?station= off a deep link.
  let _flightAC = null;
  let _pendingDetail = null;
  function cancelFlight() {
    _pendingDetail = null;
    if (_flightAC) { _flightAC.abort(); _flightAC = null; }
  }
  function flyAndOpen(center, zoom, pending, ensureVisible, open) {
    cancelFlight();
    const ac = _flightAC = new AbortController();
    _pendingDetail = pending;
    MCO.map.flyToAndOpen(map, {
      center, zoom, speed: SEARCH_FLY_SPEED, signal: ac.signal,
      ensureVisible,
      open: () => { if (_flightAC === ac) _flightAC = null; _pendingDetail = null; open(); },
    }).then((ok) => { if (!ok && _flightAC === ac) { _flightAC = null; _pendingDetail = null; } });
  }

  // Searching a station lands on the STATION, not on its cell — the two only
  // differ for a station whose ace_grid names no drawn cell, and that is exactly
  // the case the old cell-only path dead-ended on with a toast and no detail.
  function flyToStation(stationId, { url = 'auto', zoom = SEARCH_FLY_ZOOM } = {}) {
    const s = stationById.get(stationId);
    if (!s || s.longitude == null || s.latitude == null) {
      MCO.showToast(`${(s && (s.name || s.station)) || stationId} has no location`);
      return;
    }
    const cell = s.ace_grid ? normalizeCell(s.ace_grid) : null;
    const known = cell ? cellById.get(cell) : null;
    const cat = known ? known.cat : categoryFor(s.status, activeView);
    flyAndOpen([s.longitude, s.latitude], zoom, { station: stationId },
      () => ensureCatVisible(cat), () => openStation(stationId, { url }));
  }

  const searchBox = MCO.initSearchBox({
    input: searchInput,
    listbox: searchDropdown,
    items: () => _searchItems,
    label: 'Stations',
    limit: SEARCH_MAX_RESULTS,
    onSelect: (id) => {
      // Leave the field (and the compact or rail drawer) so the detail the
      // flight ends on isn't sitting under an open search.
      if (rail.isOpen()) rail.close({ restoreFocus: false });
      searchInput.blur();
      flyToStation(id);
    },
  });

  // The compact bar (kit 0.21.0) and the landscape rail (0.10.0): the bar's
  // contents move into a drawer — a right drawer under a one-row bar on a
  // phone, a drawer beside the 56px rail on a landscape phone. The drawer
  // contract (focus in, everything else inert, Esc / scrim / ☰ close, focus
  // back to the button that opened it) is the kit's. The search button
  // opens the drawer on the field. On a compact bar ≤640px is always rail
  // or drawer mode, so there is no collapsing overlay field any more
  // (MCO.initSearchCollapse retired here).
  const railMenuBtn = document.getElementById('btn-rail-menu');
  const rail = MCO.initNavRail({
    toggle: railMenuBtn,
    drawer: document.getElementById('nav-drawer'),
    scrim:  document.getElementById('rail-scrim'),
    search: { toggle: document.getElementById('btn-search-toggle'), input: searchInput },
  });

  // With ?kbd=off the '/' shortcut is disabled, so advertising it would be a
  // lie. (The kit already hides this hint inside the compact overlay bar.)
  if (!kbdShortcuts) {
    const kbdHint = document.querySelector('#search-wrap .search-kbd');
    if (kbdHint) kbdHint.hidden = true;
  }

  function flyToCell(cellId, { url = 'auto', zoom = SEARCH_FLY_ZOOM } = {}) {
    const c = cellById.get(cellId);
    if (!c) { MCO.showToast('Grid cell not found'); return; }
    flyAndOpen(c.center, zoom, { cell: cellId },
      () => ensureCatVisible(c.cat), () => openCell(cellId, { url }));
  }

  // ── Detail content ───────────────────────────────────────────────────────
  // Built with DOM APIs, never HTML strings (HOUSE-STYLE §7): the shell, title,
  // subtitle, the .mco-facts list and the dashboard action come from the
  // kit's MCO.map.popupContent(); this map adds its status pill and notes.
  // Every API value goes in as text.

  // The status pill, filled from the active category color. Pills are solid,
  // so the label picks whichever of light/dark text reads better on the fill.
  function statusPill(cat) {
    const color = catColor(cat);
    const pill = document.createElement('span');
    pill.className = 'pop-pill';
    pill.style.background = color;
    pill.style.color = readableOn(color);
    pill.textContent = catLabel(cat);
    return pill;
  }
  function note(cls, ...parts) {
    const el = document.createElement('p');
    el.className = cls;
    el.append(...parts);
    return el;
  }
  // popupContent(o) plus the pill and any notes, slotted in after the
  // subtitle (or the title) and before the facts.
  function buildPopup(o, cat, notes) {
    const frag = MCO.map.popupContent(o);
    const root = frag.querySelector('.mco-popup');
    const head = root.querySelector('.mco-popup-sub') || root.querySelector('.mco-popup-title');
    head.after(statusPill(cat), ...(notes || []));
    return frag;
  }
  const dashAction = (s) => [{ label: 'Open dashboard', href: DASH_URL(s.station) }];

  function cellPopupContent(cellId) {
    const c = cellById.get(cellId);
    if (!c) return null;
    const s = c.stationId ? stationById.get(c.stationId) : null;
    const title = `Grid cell ${cellId}`;

    if (c.ndawn) {
      const a = document.createElement('a');
      a.href = 'https://ndawn.ndsu.nodak.edu/';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'NDAWN';
      return buildPopup({ title }, c.cat, [note('pop-note', 'Station installed and maintained by ', a, '.')]);
    }
    if (!s) {
      return buildPopup({ title }, c.cat, [note('pop-empty', 'No station assigned to this cell yet.')]);
    }
    // An operational station has a real location and history; everything else
    // is a proposal, so the location is labelled as such and the install-date /
    // dashboard rows are omitted (there is nothing to link to yet).
    const live = c.cat === 'active';
    return buildPopup({
      title: s.name || s.station,
      subtitle: `${s.station} · cell ${cellId}`,
      facts: stationFacts(s, live),
      actions: live ? dashAction(s) : [],
    }, c.cat);
  }

  // Shared facts for the cell detail above and the station detail below.
  // `live` means "a real, installed station" — everything else is a proposal,
  // so the location reads as proposed and there is no install date to show.
  function stationFacts(s, live) {
    const coords = (s.longitude != null && s.latitude != null)
      ? `${s.longitude.toFixed(4)}, ${s.latitude.toFixed(4)}` : '—';
    const facts = [[live ? 'Location' : 'Proposed', coords]];
    if (live && Number.isFinite(Number(s.elevation))) {
      facts.push(['Elevation', `${Math.round(Number(s.elevation) * 3.281).toLocaleString()} ft`]);
    }
    if (live && s.date_installed) facts.push(['Installed', fmtDate(s.date_installed)]);
    if (s.nwsli_id) facts.push(['NWSLI', s.nwsli_id]);
    return facts;
  }

  // Station-first detail, used when the click lands on a dot rather than a cell.
  // The cell detail answers "what is happening in this cell"; a dot invites the
  // question "what is this station", so it gets its own answer. It also works
  // for a station whose ace_grid names no drawn cell — the cell detail cannot,
  // because it keys entirely off cellById and simply returns nothing.
  function stationPopupContent(stationId) {
    const s = stationById.get(stationId);
    if (!s) return null;
    const cell = s.ace_grid ? normalizeCell(s.ace_grid) : null;
    const known = cell ? cellById.get(cell) : null;
    const cat = known ? known.cat : categoryFor(s.status, activeView);
    const live = cat === 'active';

    // A station whose ace_grid names a cell this map does not draw. Say so
    // rather than leaving a dot floating with no explanation — it means the
    // station registry and the ACE grid geometry disagree, which is worth
    // someone noticing rather than silently rendering.
    const notes = [];
    if (cell && !known) {
      const strong = document.createElement('strong');
      strong.textContent = `Cell ${cell}`;
      notes.push(note('pop-note', strong, " is not in this map's grid — the station registry and the ACE grid geometry disagree."));
    }
    return buildPopup({
      title: s.name || s.station,
      subtitle: cell ? `${s.station} · cell ${cell}` : `${s.station} · no cell assigned`,
      facts: stationFacts(s, live),
      actions: live ? dashAction(s) : [],
    }, cat, notes);
  }

  // ── Detail: the kit's sheet at every width ──────────────────────────────
  // One selection (a cell or a station, each with its own URL parameter) and
  // one surface showing it: MCO.initSheet, docked at the end edge on desktop
  // and a bottom sheet on compact (kit 0.21.0; the anchored MapLibre popup
  // this page showed on desktop retired). The body is popupContent(). On
  // compact it opens at peek (title, sub, status pill), drags or steps (the
  // grip) to full, and closes on ×, Esc or a drag down; the map stays
  // usable at peek.
  //
  // History (HOUSE-STYLE §4): the first open from "no detail" pushes an
  // entry, so Back closes it; switching cell or station while it is open
  // replaces. Closing a pushed detail steps Back off its own entry rather
  // than leaving a dead one that would reopen it. A deep link replaces: its
  // entry is the page's own.
  // The end-docked sheet starts under the navbar (top: --chrome-h); this
  // navbar is not sticky, so the kit does not publish its height itself.
  MCO.metrics.observe('--chrome-h', document.getElementById('navbar'));
  const detailSheetEl = document.getElementById('detail-sheet');
  const sheetTitleEl  = document.getElementById('detail-sheet-title');
  const sheetBodyEl   = detailSheetEl.querySelector('.mco-sheet-body');
  let _detailClosing = false;  // a programmatic close: not the user dismissing it
  const sheet = MCO.initSheet({
    sheet: detailSheetEl,
    // Where focus goes when the sheet closes with no usable opener (a
    // ?station= / ?cell= deep link opens it with focus on <body>): <main>,
    // the skip-link target, which holds the map.
    fallbackFocus: document.getElementById('main'),
    onState: (st) => {
      if (st === 'closed' && !_detailClosing) closeDetail();
    },
  });

  function detailContent() {
    if (_selectedCell) return cellPopupContent(_selectedCell);
    if (_selectedStation) return stationPopupContent(_selectedStation);
    return null;
  }
  // The sheet has its own title element, so the body's title moves there;
  // the status pill marks the peek height.
  function fillSheet(frag) {
    const root = frag.querySelector('.mco-popup');
    const t = root.querySelector('.mco-popup-title');
    sheetTitleEl.textContent = t ? t.textContent : '';
    if (t) t.remove();
    const pill = root.querySelector('.pop-pill');
    if (pill) pill.dataset.peek = '';
    sheetBodyEl.replaceChildren(frag);
  }
  // Re-render whatever is open (a theme switch recolors the pill).
  function refreshDetail() {
    if (sheet.state() === 'closed') return;
    const content = detailContent();
    if (content) fillSheet(content);
  }

  // url: 'auto' pushes the first open and replaces after that; 'replace'
  // for a deep link; 'none' when Back/Forward already moved the URL.
  function showDetail(url) {
    const content = detailContent();
    if (!content) return;
    fillSheet(content);
    sheet.open('peek', { opener: document.activeElement });
    if (url === 'none') return;
    if (url === 'auto' && !(history.state && history.state.mcoDetail)) pushState({ push: true });
    else pushState();
  }

  function openStation(stationId, { url = 'auto' } = {}) {
    if (!stationById.has(stationId)) return;
    cancelFlight();
    _selectedCell = null;
    _selectedStation = stationId;
    showDetail(url);
    announceStation(stationId);
  }

  function openCell(cellId, { url = 'auto' } = {}) {
    if (!cellById.has(cellId)) return;
    cancelFlight();
    _selectedStation = null;
    _selectedCell = cellId;
    showDetail(url);
    announceCell(cellId);
  }

  // Close the detail and clear the selection. fromHistory: Back/Forward
  // already moved the URL, so just reflect it. Returns whether anything was
  // open.
  function closeDetail({ fromHistory = false } = {}) {
    cancelFlight();
    if (!_selectedCell && !_selectedStation) return false;
    _selectedCell = null;
    _selectedStation = null;
    if (sheet.state() !== 'closed') {
      _detailClosing = true;
      sheet.close();
      _detailClosing = false;
    }
    if (fromHistory) return true;
    if (history.state && history.state.mcoDetail) { _steppingBack = true; history.back(); }
    else pushState();
    return true;
  }
  // Set while closeDetail steps Back off the detail's own entry: the entry
  // it lands on still carries the camera from before the detail opened.
  let _steppingBack = false;

  // ── URL state push ───────────────────────────────────────────────────────
  // Lists are space-joined; URLSearchParams encodes spaces as '+', giving tidy
  // URLs like overlays=counties+hucs. Enum-string values are lowercase.
  // Every parameter has a default and none is written while it matches, so a
  // fresh load carries no query string at all (HOUSE-STYLE §4).
  // {push: true} adds a history entry (the detail opening, see showDetail);
  // everything else replaces.
  function pushState({ push = false } = {}) {
    const params = {};
    if (activeView === 'internal') params.internal = '1';
    // Per-view category sets: only serialize when not the full set.
    for (const view of VIEW_NAMES) {
      const set = visibleCatsByView[view];
      if (set.size !== allCatKeys(view).length) {
        params[catParamKey(view)] = [...set].join(' ');
      }
    }
    if (activeOverlays.size) params.overlays = [...activeOverlays].join(' ');
    if (!stationsOn) params.stations = 'off';
    if (labelsOn) params.labels = 'on';
    // The legend's default is viewport-dependent (collapsed on a phone), so
    // emit it only when it differs from what a fresh load here would pick.
    if (legendCollapsed !== MCO.viewport.isCompact()) params.legend = legendCollapsed ? 'collapsed' : 'open';
    if (!kbdShortcuts) params.kbd = 'off';
    // The theme's default is the OS preference, so emit it only when the user
    // has gone against that. Their own choice is remembered in localStorage
    // either way — the parameter exists so a shared link can carry a
    // deliberate one, not so every link imposes the sender's theme.
    const theme = MCO.getTheme();
    if (theme && theme !== MCO.osTheme()) params.theme = theme;
    // The camera's default is the fitted Montana extent. Emitted as a set,
    // because the parser needs all three to position the map.
    // cameraParamsIfDefault (kit 0.8.0) writes nothing while the camera is
    // where a fresh load would put it; this file used to carry that as
    // atDefaultExtent().
    if (_mapReady) Object.assign(params, MCO.map.cameraParamsIfDefault(map));
    if (_selectedCell) params.cell = _selectedCell;
    else if (_selectedStation) params.station = _selectedStation;
    else if (_pendingDetail) Object.assign(params, _pendingDetail);
    if (push) MCO.pushUrlState(params, { state: { mcoDetail: _selectedStation || _selectedCell } });
    else MCO.replaceUrlState(params);
  }

  // Back/Forward: the cell or station is the only drill-down state, so the
  // detail follows the URL; the rest of the view stays as it is and is
  // mirrored back into the restored entry.
  MCO.onUrlState((p) => {
    // Our own step Back (× on a pushed detail): just mirror the live view.
    if (!p.has('station') && !p.has('cell') && _steppingBack) {
      _steppingBack = false;
      pushState();
      return;
    }
    const st = MCO.getParamLower('station', p);
    const cell = p.get('cell') ? normalizeCell(p.get('cell')) : null;
    if (st && stationById.has(st)) {
      if (st === _selectedStation) return;
      openStation(st, { url: 'none' });
    } else if (cell && cellById.has(cell)) {
      if (cell === _selectedCell) return;
      openCell(cell, { url: 'none' });
    } else if (!closeDetail({ fromHistory: true })) {
      return;
    } else {
      MCO.announce('Details closed.');
    }
    pushState();
  });

  // Global keyboard shortcut: / focuses search. (Esc is the kit's: the
  // sheet, the drawer, the dialog and the spider each take their turn on
  // MCO.escStack.)
  window.addEventListener('keydown', (e) => {
    if (kbdShortcuts && e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = e.target;
      const inField =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (inField) return;
      e.preventDefault();
      // On a phone (the compact drawer or the landscape rail) the field
      // lives in the closed drawer: open it on the field.
      if (rail.isRail() || rail.isDrawerMode()) { rail.open(searchInput); return; }
      searchInput.focus();
      searchInput.select();
    }
  });
  // The kit's combobox owns the list keys. An Escape it did not consume (the
  // list is closed and the field already empty) leaves the field on the
  // desktop bar; in a drawer it passes through, and the drawer closes.
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!rail.isOpen()) searchInput.blur();
  });

  // ── Refresh (manual data reload) ─────────────────────────────────────────
  function refreshData() {
    if (!_mapReady) return;   // the first load is still on its way
    refreshStampEl.textContent = 'Loading…';
    loadAll();
  }
  document.getElementById('btn-refresh').addEventListener('click', refreshData);

  // ── Labels toggle ────────────────────────────────────────────────────────
  let labelsOn = (() => {
    const u = getLower('labels');
    if (u === 'on' || u === 'off') return u === 'on';
    return MCO.lsGet(KEY.labels) === 'on';
  })();
  const labelsBtn = document.getElementById('btn-labels');
  labelsBtn.setAttribute('aria-pressed', labelsOn ? 'true' : 'false');
  function applyLabelsVisibility() {
    if (map && map.getLayer('cells-label')) {
      map.setLayoutProperty('cells-label', 'visibility', labelsOn ? 'visible' : 'none');
    }
  }
  labelsBtn.addEventListener('click', () => {
    labelsOn = !labelsOn;
    labelsBtn.setAttribute('aria-pressed', labelsOn ? 'true' : 'false');
    MCO.lsSet(KEY.labels, labelsOn ? 'on' : 'off');
    applyLabelsVisibility();
    pushState();
  });

  // ── Legend collapse/expand ───────────────────────────────────────────────
  // MCO.initCollapsible owns the animation, [hidden] (so collapsed rows leave
  // the tab order), aria-expanded, and persistence.
  const legendToggleBtn = document.getElementById('legend-toggle-btn');
  let legendCollapsed = (() => {
    const u = getLower('legend');
    if (u === 'open' || u === 'collapsed') return u === 'collapsed';
    // The kit persists '1'/'0'; this page shipped 'collapsed'/'expanded'.
    // Read both, or every returning visitor silently reverts to expanded
    // (MIGRATING § gotchas).
    const saved = MCO.lsGet(KEY.legend);
    if (saved === 'collapsed' || saved === '1') return true;
    if (saved === 'expanded'  || saved === '0') return false;
    return MCO.viewport.isCompact();   // no preference: start collapsed on a phone
  })();

  // apply() runs once at init and calls onChange with it. Don't let that first
  // call reach pushState: it would rewrite the URL before the deep-link handler
  // has set _selectedCell, stripping ?cell= off the very link that opened it.
  let _legendInit = true;
  MCO.initCollapsible({
    toggle: legendToggleBtn,
    body: document.getElementById('legend-body'),
    storageKey: KEY.legend,
    startCollapsed: legendCollapsed,
    onChange: (collapsed) => {
      legendCollapsed = collapsed;
      legendToggleBtn.setAttribute('aria-label', collapsed ? 'Expand legend' : 'Collapse legend');
      if (!_legendInit) pushState();
    },
  });
  _legendInit = false;

  // ── Legend (Plotly-style toggles) ────────────────────────────────────────
  // The rows are the kit's .mco-legend-row, wired by MCO.initLegendToggles
  // (kit 0.8.0): click toggles a category, double-click — or Shift+Enter, the
  // keyboard twin — isolates it, double-click the isolated one to show all.
  // Every change is announced. Off dims the SWATCH and strikes the label; the
  // old `.legend-row.off { opacity: 0.4 }` dimmed the whole row and put its
  // label at 2.7:1 (WCAG 1.4.3).
  //
  // The rows are built once — the categories are fixed per view — and only
  // their swatch colors (composited against the basemap, so theme-dependent)
  // and counts are refreshed after that.
  let legendCtl = null;

  function categoryCounts() {
    const counts = {};
    for (const c of cellById.values()) counts[c.cat] = (counts[c.cat] || 0) + 1;
    return counts;
  }

  function buildLegend() {
    legendRowsEl.textContent = '';
    // Every category is listed, including ones no cell is currently in. The
    // legend is the key to the color scheme, not a summary of what's on screen
    // — dropping empty rows would hide what a color means until it happens to
    // be in use, and make the public and internal keys look inconsistent.
    for (const r of VIEWS[activeView].cats) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mco-legend-row';
      row.dataset.key = r.key;
      const sw = document.createElement('span');
      sw.className = 'mco-legend-swatch';
      sw.setAttribute('aria-hidden', 'true');
      const lb = document.createElement('span');
      lb.className = 'mco-legend-label';
      lb.textContent = r.label;
      const ct = document.createElement('span');
      ct.className = 'mco-legend-count';
      row.append(sw, lb, ct);
      legendRowsEl.appendChild(row);
    }

    // Station dots aren't a cell status, so they get a non-interactive row
    // (their visibility lives on the Stations chip instead).
    const stat = document.createElement('div');
    stat.className = 'legend-static';
    const ssw = document.createElement('span');
    ssw.className = 'mco-legend-swatch';
    ssw.dataset.shape = 'circle';
    ssw.style.setProperty('--swatch', 'var(--c-station)');
    ssw.setAttribute('aria-hidden', 'true');
    const slb = document.createElement('span');
    slb.className = 'mco-legend-label';
    slb.textContent = 'Station location';
    stat.append(ssw, slb);
    legendRowsEl.appendChild(stat);

    const hint = document.createElement('div');
    hint.className = 'legend-hint';
    hint.textContent = 'Click to toggle · Double-click to isolate';
    legendRowsEl.appendChild(hint);

    const note = document.createElement('div');
    note.className = 'legend-note';
    note.textContent = 'Cell status subject to change';
    legendRowsEl.appendChild(note);

    legendCtl = MCO.initLegendToggles({
      rows: legendRowsEl.querySelectorAll('.mco-legend-row'),
      visible: currentCats(),
      noun: 'statuses',
      onChange: (vis) => {
        const set = currentCats();
        set.clear();
        for (const k of vis) set.add(k);
        applyAllFilters();
        pushState();
      },
    });
  }

  function renderLegend() {
    if (!legendCtl) buildLegend();
    const counts = categoryCounts();
    for (const row of legendRowsEl.querySelectorAll('.mco-legend-row')) {
      const key = row.dataset.key;
      row.querySelector('.mco-legend-swatch').style.setProperty('--swatch', swatchColor(key));
      row.querySelector('.mco-legend-count').textContent = String(counts[key] || 0);
    }
  }

  // Sync the rows to currentCats() after code outside the legend changed it
  // (a search or deep link re-showing a hidden status). Silent: no
  // announcement, no onChange.
  function refreshLegendVisuals() {
    if (legendCtl) legendCtl.set(currentCats());
  }

  // Every style.load: the first one, a theme switch, the blank-basemap
  // fallback, a basemap Retry.
  function onStyleLoad() {
    addCustomLayers();     // (also re-adds the active overlays)
    if (!_mapReady) {
      _mapReady = true;
      zoomFloor.refresh();
      // Kick off the data fetch once layers exist, so rebuildCells never
      // lands before its source.
      loadAll();
      return;
    }
    rebuildCells();        // repopulate the now-empty cells source
    // Swatch and pill colors are composited against the basemap, so they
    // have to be regenerated rather than just left alone.
    renderLegend();
    refreshDetail();
  }

  // ── Map construction (after MapLibre 6 has loaded) ─────────────────────
  let zoomFloor = null;
  let coloc = null;
  function initMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: MCO.map.cartoStyleUrl(),
      ...MCO.map.initialCamera(urlParams),
    });
    MCO.map.addNavigation(map);                 // zoom buttons, no compass
    MCO.map.addFitControl(map);

    // ── Map event wiring ─────────────────────────────────────────────────────
    // Keeps Montana filling the viewport: snaps back when the user zooms out past
    // the fitted extent, and recomputes that floor after a resize settles (the
    // zoom that fits MT is viewport-dependent).
    zoomFloor = MCO.map.installZoomFloor(map);

    // Colocation + the one click dispatcher (MCO.map.colocation, kit 0.21.0).
    // A station dot opens the station; a stacked site also fans out. A click
    // on no station falls through to the cell under it, so a dot and its
    // cell can't double-fire. A dot is a station, so it opens the station:
    // only a cell click resolves through cellById, which is also why a
    // station whose ace_grid names no drawn cell stays clickable.
    coloc = MCO.map.colocation(map, {
      source: 'stations',
      visible: (s) => currentCats().has(stationCat(s)),
      properties: (s) => ({
        station: s.station,
        name:    s.name || s.station,
        cell:    normalizeCell(s.ace_grid),
        cat:     stationCat(s),
      }),
      anchorLayers: ['stations-layer', 'stations-badge', 'stations-badge-disc'],
      spiderLayers: ['stations-spider'],
      onSelect: (id) => openStation(id),
      onEmpty: (e) => {
        const feats = map.getLayer('cells-fill')
          ? map.queryRenderedFeatures(e.point, { layers: ['cells-fill'] }) : [];
        const cell = feats.length ? normalizeCell(feats[0].properties.cell) : null;
        if (cell && cellById.has(cell)) openCell(cell);
        else closeDetail();
      },
    });

    // Chips first: addCustomLayers() kicks off any saved overlay fetches, and
    // those want a chip to hang their busy/error state on.
    buildLayerChips();

    // A dead basemap no longer strands the page: the kit retries the style,
    // then falls back to a blank --bg-deep style (which DOES load, so the grid
    // still draws) with a Retry notice (kit 0.8.0). That fallback, a theme
    // switch, and a Retry all replace the style, and every replacement wipes
    // our sources and layers, so they are re-added on EVERY style.load — not
    // once on 'load', which never fires at all if the first style fails.
    MCO.map.watchBasemap(map, { styleUrl: MCO.map.cartoStyleUrl });
    map.on('style.load', onStyleLoad);

    // Reflect every pan/zoom in the URL so the view is sharable
    map.on('moveend', () => pushState());

    // ── Hover tooltip ────────────────────────────────────────────────────────
    // The kit's cursor tooltip (kit 0.8.0) owns the mousemove dispatcher,
    // cursor+14 positioning (flipped at the viewport edge), cursor: pointer and
    // the mouseleave cleanup, and sets every line with textContent. A dot is
    // queried before the cell under it. Decorative (aria-hidden): the same
    // facts reach AT through the detail announcement and the table twin.
    MCO.map.initCursorTooltip(map, {
      element: document.getElementById('tooltip'),
      layers: ['stations-spider', 'stations-layer', 'cells-fill'],
      render: (f) => {
        if (f.layer.id !== 'cells-fill') {
          // Hovering a dot asks about the station, and must work even when
          // its ace_grid names no drawn cell.
          const s = stationById.get(f.properties.station);
          if (!s) return null;
          const cell = s.ace_grid ? normalizeCell(s.ace_grid) : null;
          const known = cell ? cellById.get(cell) : null;
          return {
            name: s.name || s.station,
            sub:  cell ? `${s.station} · cell ${cell}` : `${s.station} · no cell assigned`,
            line: known
              ? (known.ndawn ? 'Operational (NDAWN)' : catLabel(known.cat))
              : `${catLabel(categoryFor(s.status, activeView))} · cell not in this grid`,
          };
        }
        const cell = normalizeCell(f.properties.cell);
        const c = cellById.get(cell);
        if (!c) return null;
        const s = c.stationId ? stationById.get(c.stationId) : null;
        return {
          name: s ? (s.name || s.station) : `Grid cell ${cell}`,
          sub:  s ? `${s.station} · cell ${cell}` : cell,
          line: c.ndawn ? 'Operational (NDAWN)' : catLabel(c.cat),
        };
      },
    });

  }

  // The library failed to import (offline, CDN down, SRI mismatch). The rest
  // of the page is already wired; say so persistently, with a retry —
  // loadMapLibre() lets a later call try the import again.
  function onMapLibreFail(err) {
    console.error(err);
    MCO.ready();
    const n = MCO.notice({
      tone: 'danger', text: 'The map library failed to load.',
      container: document.getElementById('map-container'), place: 'over',
      action: { label: 'Retry', onClick: () => { n.close(); bootMap(); } },
    });
  }
  function bootMap() {
    MCO.map.loadMapLibre().then(initMap, onMapLibreFail).catch((err) => {
      // The library loaded but the map could not start — MapLibre 6 needs
      // WebGL2 and throws GPUInitializationError without it.
      console.error(err);
      MCO.ready();
      MCO.notice({
        tone: 'danger', text: 'The map could not start. It needs a browser with WebGL2.',
        container: document.getElementById('map-container'), place: 'over',
      });
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  // The map's 'load' event drives layer creation and the data fetch — see
  // map.on('load') in initMap().
  renderLegend();
  bootMap();

})();
