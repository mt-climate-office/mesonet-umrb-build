# mesonet-umrb-build

The Montana Mesonet UMRB Build Status map: a static MapLibre single-page app at
the repo root (GitHub Pages root). No build step, no runtime dependencies beyond
the API, the MCO data CDN, and the CDN-pinned libraries in `index.html`.

## House style

This app consumes mco-web-style (pinned + SRI in `index.html`; currently
**v0.11.0** — check the tag in that file rather than trusting this line). Design
tokens, a11y mandates, and interaction conventions: see HOUSE-STYLE.md in
https://github.com/mt-climate-office/mco-web-style — tokens only (no raw hexes),
`--accent` is fill-only, `aria-pressed` drives toggle styling, canvas data needs
a live region + sr-only table twin. To change shared styling, change the kit and
bump the pinned version here; never patch a local copy.

App-local by deliberate kit decision (do NOT extract): the cell-status ramp
(`VIEWS` in `app.js`, with separate light/dark hexes per status — the one place
raw hexes are allowed, as data-vis colors), the cell/station search combobox,
and the legend rendering.

## Data

One absolute API URL under `API_BASE` at the top of `app.js`
(`https://mesonet2.climate.umt.edu/api/v2`): `/stations/status/live?type=json`,
a live read of the AirTable "Station Status" view served by the mesonet-db-rds
API (`api/app/app/registry.py` there; 120 s cache, falls back to the synced
stations table). The page is cross-origin to the API everywhere — GitHub Pages
origin and the `mesonet.climate.umt.edu/umrb/` proxy alike — so `API_BASE` must
also be listed in the meta CSP `connect-src`, and the API must keep answering
with CORS `*`. If the API host changes, change both.

Grid geometry (`data/mt_grids_simple.geojson`, 205 ACE cells keyed by `Cell`)
and the Montana outline are vendored; `data/README.md` has the regeneration
recipe. County / watershed / tribal overlays stream as FlatGeobuf from
`data.climate.umt.edu` on demand.

Known registry defect (fix in AirTable, not here): `acesfork` is tagged `E-9`,
but the E row stops at E-6 and the point falls outside the grid, so it renders
as an orphan station with an explicit "no drawn cell" note.

## Deploying — read before you push

Pushing `main` **is a production deploy, on two URLs**: GitHub Pages publishes
the repo root from `main`, and the same page is reverse-proxied at
`mesonet.climate.umt.edu/umrb/` (mesonet_app Caddyfile on the legacy host;
`pages_apps` in mesonet-gateway terraform on the CloudFront host). The old
`/api/v2/map/status/` path 301s here from the mesonet-db-rds API, and the
mco-website UMRB page iframes this URL.

`.github/workflows/preview.yml` runs nightly and **commits `assets/og-card.png`
back to `main`** — always pull/rebase before pushing, or you race it. Each of
those commits is itself a Pages redeploy.

`scripts/generate_preview.py` screenshots the live Pages origin (1200×630 layout at 2×, so 2400×1260) with
`?theme=light`, pre-setting `mco-status-seen-intro` so the intro modal stays
shut, and waits on the same `#sr-cell-rows` readiness signal as the harness.
That param, that localStorage key, and that table id are a contract — renaming
any of them silently breaks the social card in production.

## Verification

There is no CI for the page. Before any push, run the manual gates from
mco-web-style `MIGRATING.md` § "Verification recipe": `node --check app.js`,
`npx html-validate@9 index.html`, and the app's `consumer-verify.mjs` harness
(untracked; install `playwright` + `@axe-core/playwright` with `--no-save`).

The harness serves the repo root on a local port and intercepts the API URL in
the browser (`ctx.route`) to answer it from `fixtures/status.json` — also
untracked, because Pages serves everything committed. Refresh it with a `curl`
of the live endpoint when the buildout moves. flatgeobuf's streaming reader
aborts each `.fgb` request once it has what it needs and Chrome logs the
teardown as an error; that is the only expected console noise. `renderEvidence`
must be a **function**, not a string: a string is `eval`'d in-page and the CSP
has no `'unsafe-eval'`.
