# UMRB Build Status

A live buildout-status map for the [Montana Mesonet](https://climate.umt.edu/mesonet/) in the Upper Missouri River Basin, built and operated by the [Montana Climate Office](https://climate.umt.edu).

**Live:** [mesonet.climate.umt.edu/umrb](https://mesonet.climate.umt.edu/umrb/) —
the canonical URL. The same page is also served from its GitHub Pages origin at
[mt-climate-office.github.io/mesonet-umrb-build](https://mt-climate-office.github.io/mesonet-umrb-build/).

## About

The Upper Missouri River Basin is divided into ACE grid cells, each sized to hold one Mesonet station. Each cell is shaded by how far along its station is — operational, scheduled for a given install year, under construction, or still available — and dots mark the actual station locations. Cell assignments are provisional and change as siting work proceeds. Station status is read live from the Montana Climate Office station registry on every page load.

Two views:

- **Public** (default) — Operational · Build in progress · Installation pending · Install 2026 · Pending 2027 · Available cell.
- **Internal** (`?internal=1`) — splits "Build in progress" into *Station structure complete* and *Ground game complete*.

Other features:

- **Search box** for cells and stations with a themed dropdown, keyboard navigation (`↑` `↓` `Enter`), and a `/` global shortcut (`?kbd=off` disables it).
- **Interactive legend** — click a row to hide that status; double-click (or <kbd>Shift</kbd>+<kbd>Enter</kbd>) to isolate it.
- **Layer chips** toggle station dots and the county, watershed (HUC6), and tribal-land reference overlays, streamed as FlatGeobuf from the MCO data service.
- **Hover** a cell for its status; **click** for station details and a dashboard link. `?station=` opens a station popup even when its `ace_grid` names no drawn cell.
- **Toggleable grid-cell labels**; hillshade relief; Montana outline.
- **Light / dark / high-contrast** themes on neutral [CARTO](https://carto.com/basemaps) basemaps; honors `prefers-reduced-motion` and `prefers-color-scheme`.
- Screen-reader table twin of the map (one row per cell) and a first-visit help dialog.

## Sharable URLs

Every piece of UI state is mirrored to the URL. Parameters appear only when they differ from the default, so the default view has a clean URL.

| Param | Values | Notes |
|---|---|---|
| `internal` | `1` | Internal view (also `view=internal`) |
| `cat-public` | list of `active`, `building`, `contracted`, `candidate-26`, `candidate-27`, `unassigned` | Visible Public-view statuses; omitted = all |
| `cat-internal` | list of `active`, `structures`, `ground`, `contracted`, `candidate-26`, `candidate-27`, `unassigned` | Visible Internal-view statuses |
| `overlays` | list of `tribal`, `counties`, `hucs` | Reference overlays turned on |
| `stations` | `off` | Hide station dots |
| `labels` | `on` \| `off` | Grid-cell labels |
| `legend` | `open` \| `collapsed` | Legend panel state |
| `theme` | `light` \| `dark` \| `high-contrast` | Emitted only when it differs from the OS preference |
| `kbd` | `off` | Disables the `/` search shortcut |
| `lng`, `lat`, `zoom` | floats | Camera, emitted as a set when not at the Montana extent |
| `cell` | cell id (e.g. `H-8`) | Opens that cell's popup on load |
| `station` | station id (e.g. `aceabsar`) | Opens that station's popup on load |

Precedence per setting: URL param > `localStorage` > built-in default. Enum values are matched case-insensitively; list params accept `+`, spaces, or commas.

## Data sources

Read live on every page load from the Montana Mesonet API (`mesonet2.climate.umt.edu`), cross-origin with CORS `*`:

| Endpoint | Provides |
|---|---|
| `GET /api/v2/stations/status/live?type=json` | One row per station in the AirTable "Station Status" view — status, coordinates, install date, and `ace_grid` cell assignment — served by the [mesonet-db-rds](https://github.com/mt-climate-office/mesonet-db-rds) API (120 s server-side cache, falls back to the synced stations table) |

Reference overlays stream on demand from `https://data.climate.umt.edu/mesonet/fgb/` (counties, HUC6 watersheds, tribal lands). The ACE grid cells and the Montana outline are vendored in `data/` so the grid draws immediately; see `data/README.md` for how to regenerate them.

## Development

A single static page with no build step. Serve the repo root with any static server:

```sh
python -m http.server 8000
```

Open <http://localhost:8000>. The API is called cross-origin, so no backend is needed locally.

Before pushing, run the manual verification gate (see `CLAUDE.md`): `node --check app.js`, `npx html-validate@9 index.html`, and the untracked `consumer-verify.mjs` harness, which answers the API from `fixtures/status.json` (also untracked; a `curl` capture of the live endpoint).

## Deployment

Published by GitHub Pages from the `main` branch (root), and reverse-proxied under
`mesonet.climate.umt.edu/umrb/` by the mesonet_app Caddyfile and the
[mesonet-gateway](https://github.com/mt-climate-office/mesonet-gateway) CloudFront
distribution. **Pushing `main` is a production deploy.**

`.github/workflows/preview.yml` runs nightly (and on manual dispatch): it runs
`scripts/generate_preview.py`, which screenshots the live page in the light theme
at 1200×630, and **commits the result to `assets/og-card.png` on `main`** — the
`og:image` social card. Pull before pushing, or you race it. To run it locally:

```sh
pip install playwright
playwright install chromium
python scripts/generate_preview.py
```

## History

This page was previously served by the legacy Mesonet API at `/api/v2/map/status/`; its
earlier commits (back to the original Leaflet map) live in
[mesonet_app](https://github.com/mt-climate-office/mesonet_app) under
`apiv2/app/app/static/status/`. The old URL now redirects here.

## Tooling

- [MapLibre GL JS](https://maplibre.org) v5.18 and [flatgeobuf](https://flatgeobuf.org) via CDN.
- [mco-web-style](https://github.com/mt-climate-office/mco-web-style) design kit (pinned, SRI).
- [CARTO Basemaps](https://carto.com/basemaps) Positron + Dark Matter.
- Vanilla JS / HTML / CSS — no bundler, no framework.

## License

[MIT](LICENSE) — Copyright (c) 2026–present Montana Climate Office
