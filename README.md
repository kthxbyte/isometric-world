# Isometric World

A zero-dependency, client-only 2.5D isometric viewer for real-world terrain. It streams
**AWS Open Data Terrain Tiles** (Nextzen "terrarium" height rasters), converts the byte
encoding into an elevation field on the GPU (WebGL), and
can **drape Esri satellite/imagery tiles** over that same field with texel-exact alignment.
A Nominatim-powered search box flies to any city, country, or landmark.

No build step, no bundler, no runtime dependencies. Serve the folder over HTTP and open
`index.html`.

## Features

- Drag to pan across the entire world at zoom levels 0–13; the 2×2-tile view window flows
  seamlessly across the composition as you pan ("stride" recomposition).
- Satellite imagery toggle — imagery is stitched from the **same tile
  window** as the heightmap and aligned in texture space, so every terrain texel has a
  matching imagery texel.
- WebGL-only rendering: a (WebGL2/WebGL1) vertex-shader heightfield with per-vertex
  lighting and satellite draping.
- Controls: sampling density, vertical exaggeration, yaw/rotation (and auto-rotate),
  sea-level fill, **map scale** (pure visual zoom that changes neither mesh density nor the
  number of texels used), place bookmarks, and geocoding search.
- 26 curated built-in places + user bookmarks persisted to `localStorage`.
- Portable/portrait-friendly: the toolbar collapses to a slide-in drawer under 640 px.

---

## Architecture

| File | Role |
| --- | --- |
| `terrain.js` | Tile pipeline: fetch + PNG decode → elevation meters, Web-Mercator geometry, composition ("comp") buffer, stride/recompose streaming, tile LRU caches, satellite stitching. |
| `renderer3d.js` | WebGL renderer: height texture upload, per-vertex shading, ramp/imagery fragment shading, sea-level plane, fit-to-screen layout. |
| `main.js` | App glue: renderer lifecycle, controls, drag/pan inversion, places, geocoding search, preload/warm strategy. |
| `index.html` / `style.css` | Static HUD; the only DOM the app needs. |

The data flow, roughly:

```
[terrarium tile z/x/y.png]           [Esri World Imagery z/y/x]
   fetch() bytes                          <img> crossOrigin
   ↓ DecompressionStream('deflate')       ↓ canvas drawImage
   ↓ PNG unfilter (Paeth etc.)            ↓ getImageData
   ↓ decodeTerrarium(r,g,b)               ↓ RGBA tile
   ↓ Float32 elevation tile               ↓ (same comp window)
   ↓                                      ↓
   ┌───────────────────────────────────────────────┐
   │  composition buffer (up to 6×6 tiles)         │
   │  raw  = Float32Array(N×N) elevation meters    │
   └───────────────────────────────────────────────┘
   ↓                         ↓ (WebGL: stitched comp RGBA)
 16-bit norm →       height texture       imagery texture
 LUMINANCE_ALPHA      (per-vertex          (per-fragment
 texture               normals+light)       override)
 iso projection + shading
```

---

## Data sources

### Elevation — AWS Terrain Tiles (Terrarium)

```
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
```

Serves standard Web-Mercator XYZ tiles (256×256, 8-bit RGB). The **terrarium encoding** packs the
elevation, in **meters**, into the three color channels:

```
meters = (R·256 + G + B/256) − 32768
```

- The 16 bits of integer precision ride in `R` and `G` (scale ~1 m per bit … precision is
  ~1/256 m at the low end), while `B` carries fractional sub-meter detail.
- Values below sea level decode to **negative meters** (the ocean is genuinely negative,
  down to the trench), which the renderer consumes directly.
- The tiles are derived from NASA SRTM and ASTER data and redistributed by Nextzen on the
  AWS Open Data program; see **Attribution**.

### Satellite — Esri World Imagery

```
https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
```

Served in the same Web-Mercator XYZ numbering (Esri writes it `{z}/{y}/{x}`; y is the same
row index as the height tiles). This makes alignment trivial: **the imagery and the height
field share one tile grid.**

### Placenames — OpenStreetMap Nominatim

Geocoding is done against the public Nominatim endpoint (`format=jsonv2`), picking the top
match and fitting the render zoom to the result's `boundingbox`. The app keeps this
on-demand (no debounce-storm) and displays the required ODbL attribution.

### Attribution

- Terrain Tiles by **Nextzen** (AWS Open Data), derived from **NASA SRTM** and **ASTER**.
- World Imagery © **Esri**, Maxar, Earthstar Geographics, and the GIS User Community.
- Search/geocoding © **OpenStreetMap contributors** (ODbL) via **Nominatim** (nominatim.org).

---

## The heightmap pipeline (`terrain.js`)

### Byte-exact PNG decoding

The raster bytes matter: `R`,`G`,`B` **are** the elevation. The naive path
(`<img>` → `canvas.drawImage` → `getImageData`) is not used as the primary decoder because
browser color management can transform the pixel bytes during decode/draw (sRGB conversion,
gamma, premultiplication), silently corrupting the encoded elevation values.

Instead the primary path is a hand-rolled PNG decoder running over the raw network bytes:

1. `fetch(tileUrl)` → `arrayBuffer`.
2. Parse chunk headers, locate `IHDR` + `IDAT`s.
3. Concatenate `IDAT` payloads and inflate with `DecompressionStream('deflate')`
   (PNG IDAT is a zlib stream, so the raw `deflate` decoder is the correct mapping).
4. Un-filter the scanlines (implementing filters 0–4: None, Sub, Up, Average, **Paeth**).
5. Reassemble `R`,`G`,`B` per texel and apply `decodeTerrarium`.

Validated: it reproduces `pngjs` output exactly for real-world tiles (e.g. ocean tiles
decode to `-7…+228 m`, inland to `95…1152 m`, matching true values), while canvas readback
previously mangled the byte channel values.

A secondary `<img>`+canvas fallback is kept for browsers without `DecompressionStream`
(becoming a known-quality tradeoff rather than a silent degradation: the fallback is the
only path and we document that it can tint channel values).

Tiles are cached in an LRU `Map` (24 tiles max) keyed by `z/x/y`, so striding re-hits the
network only for genuinely new tiles.

### Web-Mercator ↔ texel coordinates

The world is the full Mercator square at zoom `z`: `n = 2^z` tiles per side,
`n·256` texels per side.

```
cx = (lon + 180) / 360
cy = 0.5 − asinh(tan(lat·π/180)) / (2π)
texX = round(cx · n·256)
texY = round(cy · n·256)
```

`(cx, cy) ∈ [0,1]²` is the app's canonical "ground truth" position; every jump — place
bookmark, geocoder result — is reduced to integer world texels `texX/texY` at a zoom, then
converted back to `cx/cy`. The inverse (`centerToLonLat`) recovers latitude via
`atan(sinh(π(1−2cy)))`.

### Window, composition ("comp"), and streaming

Rendering only needs a **window** — at most `2×2` tiles — but striding across a fresh 2-tile
window on every pan would thrash the network. So the app maintains a larger
**composition buffer**:

- `windowRect(zoom, cx, cy)` computes the 2×2 visible-window tile origin, clamped to the
  world (`windowSize` = 512 texels above zoom 0).
- `Terrain.load` fetches `compTiles×compTiles` = `window + 2×COMP_MARGIN` per side
  (up to **6×6 tiles**, margins clamped at world edges) into one `Float32Array` comp.
- `winX/winY` are float texels pointing at the visible window **within** the comp
  (`worldWinX = compOriginX·256 + winX`).

As you drag, the window floats freely over the comp. Only when it comes within one tile of a
comp edge does the app **stride**:

1. `strideNeeded()` decides axis/direction.
2. `stride(axis, dir)` fetches just the entering strip (one tile column/row, `compTiles`
   tiles) into the LRU cache.
3. `_recompose` copies the retained `compTiles−1` strips/shifts into place and splices in
   the new strip — a row/column shift, `O(N²)` memcpy, no refetch of already-visible data.
4. `revision++` signals the renderer to re-upload the height texture.

A throttled `preloadWindow` (4×4 tiles around the view center, 300 ms debounce) warms the
cache so stride usually finds its strip already resident. `strideIfNeeded` prefers a
synchronous in-cache recompose and only blocks on the network when the strip isn't cached.

### Min/max normalization — one global knob per comp

`Terrain.min/max` are computed over the **entire comp**. The renderer normalizes elevation
by this single range (`(h − min)/(max − min)`), which is what makes one corroded SRTM tile
able to flatten a whole scene — see **Data-quality notes**.

---

## Draping satellite imagery over the height field

Satellite alignment is the cleverest part of the tile pipeline and is solved by *sharing*.

- `loadSatelliteTiles(zoom, compOriginX, compOriginY, compTiles)` fetches **exactly the same
  comp rectangle of tiles** used for the heights and stitches them into one
  `G×G` RGBA buffer (`G = compTiles·256`).
- The WebGL renderer uploads that as one texture. The fragment shader receives the same UV
  used to sample the height texture:
  ```
  u_uv0   = (windowHalf + comp winX/Y) / rawSize
  v_uv    = a_pos / u_raw + u_uv0
  base    = texture2D(u_ramp, v_h)     // elevation ramp
  if (u_satOn) base = texture2D(u_sat, v_uv)   // imagery, same UV
  ```
  Because the height texels and imagery texels came from the same tile grid with the same
  origin, this is **texel-exact**: no bias, no re-projection, no drift as you pan.

- On recompose the satellite is refreshed for the new comp origin (`afterStride` →
  `refreshSatellite` → `setSatellite(data)`), so imagery stays lock-step with heights.
- A `setSatellite(null)` fallback demotes to the elevation ramp if imagery fails.

---

## Rendering

### Projection model

The renderer uses a dimetric-ish projection with 30° iso axes:

```
xr = wx·cos(yaw) − wy·sin(yaw)     // rotate terrain by "yaw"
yr = wx·sin(yaw) + wy·cos(yaw)
sx = (xr − yr) · cos(30°)
sy = (xr + yr) · sin(30°) − hz·vertical
depth = xr + yr                    // used for depth buffer / painter sort
```

`wx,wy` are mesh coordinates in texel units, `hz` is normalized elevation × vertical
exaggeration. `sx,sy` are pre-scale screen pixels; a fit-to-screen factor (`fitScale`)
scales into CSS pixels with padding. The **map-scale slider** multiplies that factor only —
a pure visual zoom that touches neither mesh resolution (`size`) nor the texel window.

Drag inversion (`pxToWin`) inverts the affine map `M = scale·[cos/sin matrix]` so pointer
deltas become exact world-texel deltas for the current yaw and scale:

```
a=(ca−sa)·COL  b=(sa+ca)·COL  c=(sa+ca)·ROW  d=(ca−sa)·ROW
det = s·(a·d + c·b)
ΔtexX = (d·dx + b·dy)/det ,  ΔtexY = (−c·dx + a·dy)/det
```

### WebGL path (`renderer3d.js`)

- Elevations are quantized to the comp range and uploaded as a `GL_LUMINANCE_ALPHA` texture
  (high/low bytes → L/A channels). The vertex shader samples this height field; the GPU's
  linear filter interpolates between texels.
  - *Precision note:* the shader currently reads only the L (high) byte of each sample, i.e.
    8-bit elevation resolution across the comp's `min..max` range. For a 0–4 km range that's
    ~15 m per level — fine for regional views; a future refinement could decode both bytes.
- Per-vertex **normals are computed in the shader** via central differences of the height
  field (`hR−hL`, `hU−hD`), giving directional hill-shading cheaply at full grid resolution.
- Lighting is a fixed directional light (normalized `[0.45,0.9,0.35]`):
  `light = 0.22 + 0.78·max(0, n̂·l̂)`.
- Color comes from a 256×1 **ramp texture** (`isoRampColorRgb`): bathymetric blues → greens
  → tan → light scree → white, indexed by normalized height — or the satellite texture when
  enabled.
- Depth is repurposed: `gl_Position.z = 1 − (depth − minD)·invD·2` with `minD=−maxD`,
  `invD=1/(2·maxD)`, `GL_DEPTH_TEST + GL_LEQUAL` gives correct iso occlusion; vertices sort
  themselves by distance for free.
- A flat **sea-level plane** (`SEA_*` shaders) is drawn at `0 m` (its normalized height)
  before the mesh when `seaLevel` is on and the comp dips below sea level.
- Grid rebuilds only on `gridS`/`windowSize` changes — panning resamples per-vertex on the
  GPU (`u_uv0` slides), no CPU work.

---

## Data-quality notes

SRTM has nodata/processing artifacts that leak into the terrarium tiles as wildly wrong
values (often ~6500–7000 m where reality is a few hundred, or vice-versa). Key behaviors to
know:

- Because color normalization is `comp`-wide, **one bad tile in the comp flattens the whole
  view's relief** (the range knob swallows real detail).
- The toolchain includes an internal spike probe (`_reportMeshSpikes`) that flags mesh
  vertices jumping more than ~25% of the comp range vs. their neighbors — visible in the
  console as `[mesh-spikes]`.
- Curated places were picked (and their frames chosen) to *avoid* artifact tiles. One
  documented example: the Torres del Paine towers at z13 live in tile `(2431,5447)`, which
  carries a bogus 6752 m spike; the built-in view is framed just north of it.
- High values are sometimes legitimate: ~6900 m near Santiago at z9/z10 is the real Andes
  giants (Tupungato 6570 m, etc.), and comps that dip to `-7700 m` around Copiapó are the
  genuine Atacama trench.

---

## Places & geocoding

- **Built-ins** are stored as `{zoom, texX, texY, vertical, yaw, seaLevel}` entries
  (vertical 80, most with `seaLevel:false` except coast/island views). Selecting one:
  `gotoPosition` snaps zoom + window to the exact integer texels via `setWinClamped`.
- **Saved places** live in `localStorage` (`isoworld.places.v1`) beside the built-ins.
- **Search** runs Nominatim, picks the best `display_name`, and computes the load zoom from
  the result `boundingbox`:
  ```
  zLng = ⌈log2(720 / (lngSpan·margin))⌉
  zLat = ⌈log2(2  / (mercSpan·margin))⌉     (mercSpan from cy of the box)
  zoom = clamp(max(zLng, zLat), 3, 13)
  ```
  The window is `720/2^z` degrees of longitude and `2/2^z` in Mercator-cy units.

---

## Running & validation

```
python3 -m http.server 8000     # or any static server
# open http://localhost:8000
```

Serving matters: the app fetches tiles with `crossOrigin`/`fetch`, so `file://` will not
work for remote tiles (and browsers send a CORS-safe request with an Origin header, which
both AWS S3 and Esri answer with `Access-Control-Allow-Origin`).

This README is also viewable inside the app: the **Docs** button in the toolbar renders it
through the bundled `markdown.js` parser (escape-first, no external libraries), with a
table of contents and keyboard navigation; it deep-links at `#docs/readme`.

Validation is done with the standalone Node harnesses in `/tmp/opencode` (not part of the
repo): a tile-proof decode comparison against `pngjs`, and round-trip checks that every
built-in place recenters to its exact `texX/texY` without clamping.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Salvador Muñoz.

**Author:** Salvador Muñoz, with the extremely helpful assistance of OpenCode Zen
(Big Pickle).

**Attribution for the data used is mandatory and is included in the UI footer** — see the
Attribution section above for the three providers.