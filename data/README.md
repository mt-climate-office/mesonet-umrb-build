# Vendored geometry for the UMRB status map

These files ship with the page so the grid draws immediately and the map does
not go blank when the CDN is slow. The optional county / watershed / tribal-land
overlays are *not* vendored — they stream from
`https://data.climate.umt.edu/mesonet/fgb/` on demand.

## `mt_grids_simple.geojson`

The ACE grid cells, derived from the canonical FlatGeobuf:

```sh
curl -O https://data.climate.umt.edu/mesonet/fgb/mt_grids.fgb
ogr2ogr -f GeoJSON -lco COORDINATE_PRECISION=5 -lco RFC7946=YES \
  mt_grids_raw.geojson mt_grids.fgb
# -target 1 selects the polygon layer; RFC7946 conversion emits two stray
# polyline records that mapshaper would otherwise write to a second file.
mapshaper -i mt_grids_raw.geojson -target 1 \
  -simplify visvalingam 5% keep-shapes \
  -o precision=0.00001 format=geojson mt_grids_simple.geojson
```

205 cells, ~356 KB (~79 KB gzipped). Most cells are simple quads; the size comes
from the handful clipped to the basin boundary. 5% simplification is well below
what is visible at this map's zoom range — drop it further only if the clipped
edges start to matter.

Regenerate whenever the ACE grid itself changes. The page keys cells by the
`Cell` property (`H-8` style, unpadded).

## `mt_state_simple.geojson`

Montana's boundary, byte-identical to `data/mt_state_simple.geojson` in the
sibling [mesonet-maintenance](https://github.com/mt-climate-office/mesonet-maintenance) repo. Keep the two
in sync if either is ever re-exported.
