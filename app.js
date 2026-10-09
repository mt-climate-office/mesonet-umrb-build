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

  // Say what a popup opened via click, search, or deep-link contains, through
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
  // Same, for a popup opened on a station dot rather than a cell.
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
  function refreshStamp() {
    // Mountain Time, not viewer-local. This is an operations map for a Montana
    // network: "loaded 14:05" has to mean the same clock to a field tech in
    // Bozeman and a collaborator in DC (HOUSE-STYLE § time).
    refreshStampEl.textContent = `loaded ${MCO.hhmmNowMT()} MT`;
    // At ≤1400px the stamp is icon-only (index.html § Responsive): the
    // wrapper's title carries the time for pointer users.
    refreshStampEl.parentElement.title = `Last refreshed: ${refreshStampEl.textContent}`;
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

  // ── Info modal ───────────────────────────────────────────────────────────
  // The kit owns backdrop-click, [data-close-modal] delegation, and
  // opener-captured focus restore.
  const btnInfo = document.getElementById('btn-info');
  // On the landscape-phone rail the info button sits in the drawer: close the
  // drawer before the dialog opens (capture, so it runs first), and when the
  // dialog closes onto the now-hidden button, land on the rail's menu button.
  btnInfo.addEventListener('click', () => {
    if (rail.isOpen()) rail.close({ restoreFocus: false });
  }, true);
  infoModal.addEventListener('close', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (rail.isRail() && (!a || a === document.body || !a.getClientRects().length)) {
        document.getElementById('btn-rail-menu').focus();
      }
    }, 0);
  });
  const infoModalCtl = MCO.initInfoModal({ dialog: infoModal, trigger: btnInfo });

  // Mark the intro seen AT OPEN, not on close. Someone who reads the modal and
  // then navigates away without closing it has still seen it; the old
  // close-handler version re-opened the intro for that visitor every single
  // visit.
  const markIntroSeen = () => MCO.lsSet('mco-status-seen-intro', '1');
  btnInfo.addEventListener('click', markIntroSeen);

  // First-visit auto-open: show the help on load so a new visitor knows what
  // the colors mean. A deep link means the visitor was sent to something
  // specific — don't bury it under the intro.
  const _bootParams = MCO.urlParams();
  const _isDeepLink = ['cell', 'station', 'lng', 'lat', 'zoom']
    .some((k) => _bootParams.has(k));
  if (!MCO.lsGet('mco-status-seen-intro') && !_isDeepLink) {
    // Defer one tick so the page is rendered before the dialog steals focus.
    setTimeout(() => {
      if (!infoModal.open) { infoModalCtl.open(); markIntroSeen(); }
    }, 350);
  }

  // ── State ────────────────────────────────────────────────────────────────
  let stations    = [];            // raw /stations/status/live response
  let stationById = new Map();     // station slug → registry row
  let cellById    = new Map();     // cell ID → { cat, stationId, center }
  let dataUnavailable = false;     // true if the status fetch failed/empty
  let _gridsFC  = null;            // raw grid geometry, fetched once
  let _stateFC  = null;
  let _mapReady = false;
  let _popup = null;

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
    const saved = MCO.lsGet('mco-status-stations');
    return saved == null ? true : saved === 'on';   // dots are on by default
  })();
  const activeOverlays = (() => {
    const tokens = splitTokens(urlParams.get('overlays'));
    if (tokens !== null) return new Set(tokens.filter(t => OVERLAY_BY_KEY.has(t)));
    try {
      const saved = JSON.parse(MCO.lsGet('mco-status-overlays') || 'null');
      if (Array.isArray(saved)) return new Set(saved.filter(t => OVERLAY_BY_KEY.has(t)));
    } catch {}
    return new Set();
  })();

  let _selectedCell = _initCell;
  // A station popup and a cell popup are mutually exclusive — only one popup
  // exists at a time, and each owns its own URL parameter.
  let _selectedStation = null;

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
    if (!map.getLayer('stations-layer')) {
      map.addLayer({ id: 'stations-layer', type: 'circle', source: 'stations', paint: stationPaint() });
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
  // So it is deliberately achromatic — any hue would either duplicate the ramp
  // or, if warm, collide with the ramp's yellow end under deuteranopia (ΔE ~3).
  // Pure lightness contrast separates it from every category for every kind of
  // color vision (worst case ΔE 26).
  //
  // Shape and size come from the kit's marker paint (MCO.map.markerPaint,
  // kit 0.9.0): every UMRB station is a Mesonet HydroMet station, a filled
  // circle. Its colors are read from tokens at paint time instead of the
  // hard-coded pairs this used to carry: the fill is this page's --c-station
  // and the edge is --bg-deep, the basemap-dark (or -light) opposite of the
  // fill. The kit's own edge (--dot-stroke) is white on the dark themes —
  // right for a colored network dot, invisible around a white one.
  function stationPaint() {
    return {
      ...MCO.map.markerPaint('hydromet', {
        fill:   MCO.cssVar('--c-station'),
        radius: ['interpolate', ['linear'], ['zoom'], 4, 2.5, 7, 4, 10, 6, 14, 8],
      }),
      'circle-stroke-color': MCO.cssVar('--bg-deep'),
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
      // map's 'load' handler, so the layers always exist by this point.
      // ?station= opens the station itself; ?cell= opens the cell. Resolving a
      // station down to its cell (the old behaviour) lost the distinction and
      // dropped any station whose ace_grid is not in the drawn grid.
      if (!_deepLinkConsumed && _initStation && stationById.has(_initStation)) {
        _deepLinkConsumed = true;
        if (_hasInitPos) openStationPopup(_initStation);
        else             flyToStation(_initStation);
      } else if (!_deepLinkConsumed && _initCell && cellById.has(_initCell)) {
        _deepLinkConsumed = true;
        if (_hasInitPos) openPopupFor(_initCell);
        else             flyToCell(_initCell);
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
  // flyTo / popup anchoring needs.
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
    // to the buildout the grid is describing.
    const stationFeatures = [];
    for (const s of stations) {
      if (!s || s.status === 'decommissioned' || !s.ace_grid) continue;
      if (s.longitude == null || s.latitude == null) continue;
      stationFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
        properties: {
          station: s.station,
          name:    s.name || s.station,
          cell:    normalizeCell(s.ace_grid),
          cat:     categoryFor(s.status, activeView),
        },
      });
    }
    map.getSource('stations').setData({ type: 'FeatureCollection', features: stationFeatures });

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
          'text-font':  ['Open Sans Semibold', 'Arial Unicode MS Bold'],
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
          MCO.lsSet('mco-status-stations', on ? 'on' : 'off');
          applyStationsVisibility();
        } else {
          if (on) { activeOverlays.add(e.key); loadOverlay(e.key); }
          else    { activeOverlays.delete(e.key); removeOverlayLayers(e.key); }
          MCO.lsSet('mco-status-overlays', JSON.stringify([...activeOverlays]));
        }
        pushState();
      });
      layerFiltersEl.appendChild(chip);
    }
  }

  function applyStationsVisibility() {
    if (map && map.getLayer('stations-layer')) {
      map.setLayoutProperty('stations-layer', 'visibility', stationsOn ? 'visible' : 'none');
    }
  }

  // Legend category visibility is the only filter; it applies to the cell fill,
  // its outline and label, and the station dots sitting inside those cells, so
  // isolating a status leaves a coherent picture.
  function applyAllFilters() {
    if (!map || !map.getLayer('cells-fill')) return;
    const catMatch = ['in', ['get', 'cat'], ['literal', [...currentCats()]]];
    for (const lid of ['cells-fill', 'cells-line', 'cells-label', 'stations-layer']) {
      if (map.getLayer(lid)) map.setFilter(lid, catMatch);
    }
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

  // ── Search (MCO.initSearchBox + flyTo + popup) ──────────────────────────
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

  // Searching a station lands on the STATION, not on its cell — the two only
  // differ for a station whose ace_grid names no drawn cell, and that is exactly
  // the case the old cell-only path dead-ended on with a toast and no popup.
  function flyToStation(stationId) {
    const s = stationById.get(stationId);
    if (!s || s.longitude == null || s.latitude == null) {
      MCO.showToast(`${(s && (s.name || s.station)) || stationId} has no location`);
      return;
    }
    // A hidden category would fly the user to a blank patch of map — turn it
    // back on rather than silently landing on nothing.
    const cell = s.ace_grid ? normalizeCell(s.ace_grid) : null;
    const known = cell ? cellById.get(cell) : null;
    const cat = known ? known.cat : categoryFor(s.status, activeView);
    if (!currentCats().has(cat)) {
      currentCats().add(cat);
      refreshLegendVisuals();
      applyAllFilters();
    }
    map.flyTo({
      center: [s.longitude, s.latitude], zoom: SEARCH_FLY_ZOOM,
      speed: SEARCH_FLY_SPEED, animate: !MCO.reducedMotion(),
    });
    map.once('moveend', () => openStationPopup(stationId));
  }

  const searchBox = MCO.initSearchBox({
    input: searchInput,
    listbox: searchDropdown,
    items: () => _searchItems,
    label: 'Stations',
    limit: SEARCH_MAX_RESULTS,
    onSelect: (id) => {
      // Leave the field (and the compact overlay bar, or the rail's drawer)
      // so the popup the flight ends on isn't sitting under an open search.
      if (searchCtl.isOpen()) searchCtl.close({ restoreFocus: false });
      if (rail.isOpen()) rail.close({ restoreFocus: false });
      searchInput.blur();
      flyToStation(id);
    },
  });

  // Below 640px the field collapses into a disclosure button grouped with the
  // other nav buttons and reopens as a full-width overlay bar under the navbar.
  const searchCtl = MCO.initSearchCollapse({
    wrap:    document.getElementById('search-wrap'),
    toggle:  document.getElementById('btn-search-toggle'),
    input:   searchInput,
    onClose: () => searchBox.close(),
  });

  // Landscape-phone rail (kit 0.10.0): the bar's contents move into a drawer
  // beside a 56px rail. The drawer contract (focus in, everything else inert,
  // Esc / scrim / toggle close, focus back to the toggle) is the kit's.
  const railMenuBtn = document.getElementById('btn-rail-menu');
  const rail = MCO.initNavRail({
    toggle: railMenuBtn,
    drawer: document.getElementById('nav-drawer'),
    scrim:  document.getElementById('rail-scrim'),
  });
  document.getElementById('btn-rail-search').addEventListener('click', () => rail.open(searchInput));

  // With ?kbd=off the '/' shortcut is disabled, so advertising it would be a
  // lie. (The kit already hides this hint inside the compact overlay bar.)
  if (!kbdShortcuts) {
    const kbdHint = document.querySelector('#search-wrap .search-kbd');
    if (kbdHint) kbdHint.hidden = true;
  }

  function flyToCell(cellId) {
    const c = cellById.get(cellId);
    if (!c) { MCO.showToast('Grid cell not found'); return; }
    // A hidden category would fly the user to a blank patch of map — turn it
    // back on rather than silently landing on nothing.
    if (!currentCats().has(c.cat)) {
      currentCats().add(c.cat);
      refreshLegendVisuals();
      applyAllFilters();
    }
    map.flyTo({
      center: c.center, zoom: SEARCH_FLY_ZOOM,
      speed: SEARCH_FLY_SPEED, animate: !MCO.reducedMotion(),
    });
    map.once('moveend', () => openPopupFor(cellId));
  }

  // ── Popup ────────────────────────────────────────────────────────────────
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

  // Shared facts for the cell popup above and the station popup below.
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

  // Station-first popup, used when the click lands on a dot rather than a cell.
  // The cell popup answers "what is happening in this cell"; a dot invites the
  // question "what is this station", so it gets its own answer. It also works
  // for a station whose ace_grid names no drawn cell — the cell popup cannot,
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

  // ── Detail: anchored popup on desktop, bottom sheet on compact ─────────
  // One selection (a cell or a station, each with its own URL parameter) and
  // one surface showing it. Above the compact breakpoint that is a MapLibre
  // popup anchored to the feature; on compact it is the kit's bottom sheet
  // (MCO.initSheet, kit 0.9.0) with the SAME popupContent() body — an
  // anchored 320px popup covers most of a phone map and its tip points at a
  // cell the finger is on top of. The sheet opens at peek (title, sub, status
  // pill), drags or steps (the grip) to full, and closes on ×, Esc or a drag
  // down; the map stays usable at peek.
  const detailSheetEl = document.getElementById('detail-sheet');
  const sheetTitleEl  = document.getElementById('detail-sheet-title');
  const sheetBodyEl   = detailSheetEl.querySelector('.mco-sheet-body');
  let _detail = null;          // 'popup' | 'sheet' | null — what is showing
  let _detailClosing = false;  // a programmatic close: not the user dismissing it
  const sheet = MCO.initSheet({
    sheet: detailSheetEl,
    fallbackFocus: document.getElementById('map'),
    onState: (st) => {
      if (st !== 'closed') return;
      if (_detail === 'sheet' && !_detailClosing) {
        _detail = null;
        clearSelection();
      }
      // The kit restores focus to the opener. Opened from a deep link, the
      // opener is <body> (the kit's overlay takes document.activeElement
      // when no opener is given, so its fallbackFocus never applies), and
      // focus stays on <body> or on the now-hidden grip. Land on the map
      // canvas instead (WCAG 2.4.3).
      setTimeout(() => {
        const a = document.activeElement;
        if (map && !_detail && (!a || a === document.body || detailSheetEl.contains(a))) map.getCanvas().focus();
      }, 0);
    },
  });

  function detailContent() {
    if (_selectedCell) return cellPopupContent(_selectedCell);
    if (_selectedStation) return stationPopupContent(_selectedStation);
    return null;
  }
  // The sheet has its own title element, so the popup body's title moves
  // there; the status pill marks the peek height.
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
    const content = detailContent();
    if (!content) return;
    if (_detail === 'popup' && _popup) _popup.setDOMContent(content);
    else if (_detail === 'sheet') fillSheet(content);
  }

  // Take down the current surface without touching the selection or the URL.
  function dismissDetail(restoreFocus) {
    _detailClosing = true;
    if (_popup) {
      // Removing a popup that holds focus drops it to <body>; hand it to the
      // map instead (WCAG 2.4.3).
      const had = _popup.getElement().contains(document.activeElement);
      _popup.remove();
      _popup = null;
      if (had && restoreFocus) map.getCanvas().focus();
    }
    if (_detail === 'sheet') sheet.close({ restoreFocus: !!restoreFocus });
    _detail = null;
    _detailClosing = false;
  }

  function clearSelection() {
    if (!_selectedCell && !_selectedStation) return;
    _selectedCell = null;
    _selectedStation = null;
    pushState();
  }

  function showDetail(lngLat) {
    const content = detailContent();
    if (!content) return;
    if (MCO.viewport.isCompact()) {
      fillSheet(content);
      _detail = 'sheet';
      sheet.open('peek', { opener: document.activeElement });
      return;
    }
    const p = new maplibregl.Popup({ closeOnClick: false, maxWidth: '320px', offset: 12 })
      .setLngLat(lngLat)
      .setDOMContent(content)
      .addTo(map);
    p.on('close', () => {
      if (_detailClosing || _popup !== p) return;
      _popup = null;
      _detail = null;
      clearSelection();
    });
    _popup = p;
    _detail = 'popup';
  }

  function openStationPopup(stationId, lngLat) {
    const s = stationById.get(stationId);
    if (!s) return;
    dismissDetail(false);
    _selectedCell = null;
    _selectedStation = stationId;
    showDetail(lngLat || [s.longitude, s.latitude]);
    announceStation(stationId);
    pushState();
  }

  function openPopupFor(cellId, lngLat) {
    const c = cellById.get(cellId);
    if (!c) return;
    dismissDetail(false);
    _selectedStation = null;
    _selectedCell = cellId;
    showDetail(lngLat || c.center);
    announceCell(cellId);
    pushState();
  }

  // The user closed the detail (Esc, an empty-map click): take it down and
  // clear the selection.
  function closePopup() {
    if (!_detail) return;
    dismissDetail(true);
    clearSelection();
  }

  // ── URL state push ───────────────────────────────────────────────────────
  // Lists are space-joined; URLSearchParams encodes spaces as '+', giving tidy
  // URLs like overlays=counties+hucs. Enum-string values are lowercase.
  // Every parameter has a default and none is written while it matches, so a
  // fresh load carries no query string at all (HOUSE-STYLE §4).
  function pushState() {
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
    if (_selectedStation) params.station = _selectedStation;
    MCO.replaceUrlState(params);
  }

  // Global keyboard shortcuts: Esc closes things; / focuses search.
  // Escape is unaffected by ?kbd=off — it's a modifier-free key, but it only
  // acts on already-open UI, so it can't be misfired into.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePopup(); return; }
    if (kbdShortcuts && e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = e.target;
      const inField =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (inField) return;
      e.preventDefault();
      // On the landscape-phone rail the field lives in the closed drawer.
      if (rail.isRail()) { rail.open(searchInput); return; }
      // When the field is collapsed the overlay has to open first — otherwise
      // '/' focuses an input that is display:none and the keystroke is lost.
      if (searchCtl.isCollapsed()) { searchCtl.open(); return; }
      searchInput.focus();
      searchInput.select();
    }
  });
  // The kit's combobox owns the list keys. An Escape it did not consume (the
  // list is closed and the field already empty) dismisses the compact overlay
  // bar and hands focus back to the toggle — blurring alone would strand
  // focus behind a still-open overlay.
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (searchCtl.isOpen()) { e.stopPropagation(); searchCtl.close(); return; }
    searchInput.blur();
  });

  // ── Refresh (manual data reload) ─────────────────────────────────────────
  function refreshData() {
    if (!_mapReady) return;   // the first load is still on its way
    refreshStampEl.textContent = 'loading…';
    loadAll();
  }
  document.getElementById('btn-refresh').addEventListener('click', refreshData);

  // ── Labels toggle ────────────────────────────────────────────────────────
  let labelsOn = (() => {
    const u = getLower('labels');
    if (u === 'on' || u === 'off') return u === 'on';
    return MCO.lsGet('mco-status-labels') === 'on';
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
    MCO.lsSet('mco-status-labels', labelsOn ? 'on' : 'off');
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
    const saved = MCO.lsGet('mco-status-legend');
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
    storageKey: 'mco-status-legend',
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
    map.on('moveend', pushState);

    // ── Click handling ───────────────────────────────────────────────────────
    // One dispatcher so a station dot and the cell beneath it can't double-fire.
    map.on('click', (e) => {
      const layers = ['stations-layer', 'cells-fill'].filter(l => map.getLayer(l));
      const feats = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
      if (feats.length === 0) { closePopup(); return; }
      const f = feats.find(x => x.layer.id === 'stations-layer') || feats[0];
      // A dot is a station, so it opens the station. Only a cell click resolves
      // through cellById — which is also why a station whose ace_grid names no
      // drawn cell used to be unclickable: the lookup failed and the handler bailed.
      if (f.layer.id === 'stations-layer') {
        openStationPopup(f.properties.station, f.geometry.coordinates.slice());
        return;
      }
      const cell = normalizeCell(f.properties.cell);
      if (!cellById.has(cell)) { closePopup(); return; }
      openPopupFor(cell, e.lngLat);
    });

    // ── Hover tooltip ────────────────────────────────────────────────────────
    // The kit's cursor tooltip (kit 0.8.0) owns the mousemove dispatcher,
    // cursor+14 positioning (flipped at the viewport edge), cursor: pointer and
    // the mouseleave cleanup, and sets every line with textContent. A dot is
    // queried before the cell under it. Decorative (aria-hidden): the same
    // facts reach AT through the popup announcement and the table twin.
    MCO.map.initCursorTooltip(map, {
      element: document.getElementById('tooltip'),
      layers: ['stations-layer', 'cells-fill'],
      render: (f) => {
        if (f.layer.id === 'stations-layer') {
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
