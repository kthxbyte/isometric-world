(function (global) {
  'use strict';

  const TILE_SIZE = 256;
  const SOURCES = {
    aws: {
      name: 'AWS Terrain Tiles (terrarium)',
      url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
    }
  };
  const SOURCE = SOURCES.aws;

  const SAT_SOURCE = {
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Visible window: up to a 2x2 block of tiles around the normalized center
  // (cx, cy) in [0,1]x[0,1] over the tile space at the given zoom.
  function windowRect(zoom, cx, cy) {
    const n = 1 << zoom;
    const w = Math.min(n, 2);
    const maxOrigin = Math.max(0, n - w);
    const x0 = clamp(Math.floor(cx * n - w / 2), 0, maxOrigin);
    const y0 = clamp(Math.floor(cy * n - w / 2), 0, maxOrigin);
    return { n: n, w: w, x0: x0, y0: y0 };
  }

  function tileUrl(z, x, y) {
    return SOURCE.url
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y);
  }

  function decodeTerrarium(r, g, b) {
    return (r * 256 + g + b / 256) - 32768;
  }

  function loadTileImage(z, x, y) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        reject(new Error('Failed to load tile ' + z + '/' + x + '/' + y));
      };
      img.src = tileUrl(z, x, y);
    });
  }

  function readTilePixels(img) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    const meters = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      meters[p] = decodeTerrarium(data[i], data[i + 1], data[i + 2]);
    }
    return meters;
  }

  function loadSatTileImage(z, x, y) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        reject(new Error('Failed to load satellite tile ' + z + '/' + x + '/' + y));
      };
      img.src = SAT_SOURCE.url
        .replace('{z}', z)
        .replace('{y}', y)
        .replace('{x}', x);
    });
  }

  // --- per-tile fetch (cache-aware) so shifts only hit the network for new data ---
  const METERS_CACHE = new Map();
  const SAT_CACHE = new Map();

  function cacheKey(z, x, y) {
    return z + '/' + x + '/' + y;
  }

  function touchEvict(map, key, max) {
    const v = map.get(key);
    if (v) { map.delete(key); map.set(key, v); }
    if (map.size > max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  const MAX_TILES = 24;

  function loadTile(zoom, x, y) {
    const key = cacheKey(zoom, x, y);
    const hit = METERS_CACHE.get(key);
    if (hit) {
      touchEvict(METERS_CACHE, key, MAX_TILES);
      return Promise.resolve(hit);
    }
    return loadTileImage(zoom, x, y)
      .then(readTilePixels)
      .then(function (meters) {
        touchEvict(METERS_CACHE, key, MAX_TILES);
        METERS_CACHE.set(key, meters);
        return meters;
      });
  }

  function loadSatTile(zoom, x, y) {
    const key = cacheKey(zoom, x, y);
    const hit = SAT_CACHE.get(key);
    if (hit) {
      touchEvict(SAT_CACHE, key, MAX_TILES);
      return Promise.resolve(hit);
    }
    return loadSatTileImage(zoom, x, y)
      .then(function (img) {
        const canvas = document.createElement('canvas');
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
        touchEvict(SAT_CACHE, key, MAX_TILES);
        SAT_CACHE.set(key, data);
        return data;
      });
  }

  // Composite the same window of Web-Mercator tiles as the heightmap into an
  // RGBA bitmap, so every heightmap pixel has a matching imagery pixel.
  async function loadSatelliteTiles(zoom, x0, y0, w) {
    const tiles = await Promise.all(
      (function () {
        const out = [];
        for (let dy = 0; dy < w; dy++) {
          for (let dx = 0; dx < w; dx++) {
            out.push(loadSatTile(zoom, x0 + dx, y0 + dy)
              .then(function (data) { return { dx: dx, dy: dy, data: data }; }));
          }
        }
        return out;
      }())
    );
    const G = w * TILE_SIZE;
    const out = new Uint8ClampedArray(G * G * 4);
    tiles.forEach(function (t) {
      const ox = t.dx * TILE_SIZE * 4;
      for (let row = 0; row < TILE_SIZE; row++) {
        out.set(t.data.subarray(row * TILE_SIZE * 4, (row + 1) * TILE_SIZE * 4),
          (t.dy * TILE_SIZE + row) * G * 4 + ox);
      }
    });
    return out;
  }

  function isWindowCached(zoom, x0, y0, w) {
    for (let dy = 0; dy < w; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!METERS_CACHE.has(cacheKey(zoom, x0 + dx, y0 + dy))) return false;
      }
    }
    return true;
  }

  // Warm both caches for the given window (best effort, no throw).
  function preloadWindow(zoom, x0, y0, w, withSat) {
    for (let dy = 0; dy < w; dy++) {
      for (let dx = 0; dx < w; dx++) {
        loadTile(zoom, x0 + dx, y0 + dy).catch(function () {});
        if (withSat && !SAT_CACHE.has(cacheKey(zoom, x0 + dx, y0 + dy))) {
          loadSatTile(zoom, x0 + dx, y0 + dy).catch(function () {});
        }
      }
    }
  }

  // Composition of surrounding tiles that the visible window is dragged across.
  // winX/winY = fractional texel position of the window top-left inside the comp.
  const COMP_MARGIN = 2; // tiles of margin on each side of the visible window

  class Terrain {
    constructor() {
      this.zoom = null;
      this.window = 1; // visible tiles per side (1 or 2)
      this.windowSize = 0; // texels of the visible window (256 or 512)
      this.compTiles = 0;
      this.compOriginX = 0; // tile index of comp top-left
      this.compOriginY = 0;
      this.winX = 0; // float texel, window top-left within comp
      this.winY = 0;
      this.center = { x: 0.5, y: 0.5 };
      this.raw = null; // composition heightmap (compTexels x compTexels)
      this.rawSize = 0;
      this.min = 0;
      this.max = 0;
      this.revision = 0;
    }

    worldWinX() {
      return this.compOriginX * TILE_SIZE + this.winX;
    }

    worldWinY() {
      return this.compOriginY * TILE_SIZE + this.winY;
    }

    windowCenter() {
      const n = 1 << this.zoom;
      return {
        cx: (this.worldWinX() + this.windowSize / 2) / (n * TILE_SIZE),
        cy: (this.worldWinY() + this.windowSize / 2) / (n * TILE_SIZE)
      };
    }

    async load(zoom, cx, cy, onTile) {
      const rect = windowRect(zoom, cx, cy);
      const n = rect.n;
      const compTiles = Math.max(1, Math.min(rect.w + 2 * COMP_MARGIN, n));
      const maxOrigin = Math.max(0, n - compTiles);
      const cox = clamp(rect.x0 - COMP_MARGIN, 0, maxOrigin);
      const coy = clamp(rect.y0 - COMP_MARGIN, 0, maxOrigin);
      const loaders = [];
      const order = [];
      for (let dy = 0; dy < compTiles; dy++) {
        for (let dx = 0; dx < compTiles; dx++) {
          const x = cox + dx;
          const y = coy + dy;
          order.push([x, y]);
          loaders.push(loadTile(zoom, x, y)
            .then(function (meters) { return { dx: dx, dy: dy, meters: meters }; }));
        }
      }

      if (onTile) onTile(0, order.length);

      const tiles = await Promise.all(loaders);

      const G = compTiles * TILE_SIZE;
      const raw = new Float32Array(G * G);
      let min = Infinity;
      let max = -Infinity;

      tiles.forEach(function (t) {
        const x0 = t.dx * TILE_SIZE;
        const y0 = t.dy * TILE_SIZE;
        for (let row = 0; row < TILE_SIZE; row++) {
          const srcOff = row * TILE_SIZE;
          const dstOff = (y0 + row) * G + x0;
          for (let col = 0; col < TILE_SIZE; col++) {
            const v = t.meters[srcOff + col];
            raw[dstOff + col] = v;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      });

      this.zoom = zoom;
      this.window = rect.w;
      this.windowSize = rect.w * TILE_SIZE;
      this.compTiles = compTiles;
      this.compOriginX = cox;
      this.compOriginY = coy;
      this.winX = (rect.x0 - cox) * TILE_SIZE;
      this.winY = (rect.y0 - coy) * TILE_SIZE;
      this.center = { x: cx, y: cy };
      this.raw = raw;
      this.rawSize = G;
      this.min = min;
      this.max = max;
      this.revision++;

      if (onTile) onTile(order.length, order.length);
      return this;
    }

    setWin(wx, wy) {
      this.winX = wx - this.compOriginX * TILE_SIZE;
      this.winY = wy - this.compOriginY * TILE_SIZE;
    }

    // Move the window top-left to world texels (wx, wy), clamped to the world.
    setWinClamped(wx, wy) {
      const n = 1 << this.zoom;
      const max = Math.max(0, n * TILE_SIZE - this.windowSize);
      this.setWin(clamp(wx, 0, max), clamp(wy, 0, max));
    }

    // Which recompose (composition stride) is needed right now, if any.
    strideNeeded() {
      const T = TILE_SIZE;
      if (this.windowSize >= this.rawSize) return null; // whole world visible, no margin
      if (this.winX < T && this.compOriginX > 0) return { axis: 'x', dir: -1 };
      if (this.winX > this.rawSize - this.windowSize - T &&
          this.compOriginX < (1 << this.zoom) - this.compTiles) return { axis: 'x', dir: 1 };
      if (this.winY < T && this.compOriginY > 0) return { axis: 'y', dir: -1 };
      if (this.winY > this.rawSize - this.windowSize - T &&
          this.compOriginY < (1 << this.zoom) - this.compTiles) return { axis: 'y', dir: 1 };
      return null;
    }

    // Sync recompose; returns true if applied.
    tryStride(axis, dir) {
      return this._recompose(axis, dir);
    }

    // Async recompose: fetches the entering strip, then applies.
    async stride(axis, dir) {
      const job = this._stripKeys(axis, dir).map(function (key) {
        return loadTile(key.z, key.x, key.y);
      });
      await Promise.all(job);
      this._recompose(axis, dir);
    }

    _stripKeys(axis, dir) {
      const out = [];
      const ct = this.compTiles;
      const nx = axis === 'x' ? this.compOriginX + dir : this.compOriginX;
      const ny = axis === 'y' ? this.compOriginY + dir : this.compOriginY;
      for (let k = 0; k < ct; k++) {
        const x = axis === 'x' ? nx : this.compOriginX + k;
        const y = axis === 'y' ? ny : this.compOriginY + k;
        out.push({ z: this.zoom, x: x, y: y });
      }
      return out;
    }

    _copyColBlock(dst, G, dstCol, srcCol) {
      const T = TILE_SIZE;
      for (let r = 0; r < G; r++) {
        dst.set(this.raw.subarray(r * G + srcCol * T, r * G + srcCol * T + T),
          r * G + dstCol * T);
      }
    }

    _copyRowBlock(dst, G, dstRow, srcRow) {
      const T = TILE_SIZE;
      for (let r = 0; r < T; r++) {
        dst.set(this.raw.subarray((srcRow * T + r) * G, (srcRow * T + r) * G + G),
          (dstRow * T + r) * G);
      }
    }

    _recompose(axis, dir) {
      const ct = this.compTiles;
      const T = TILE_SIZE;
      const G = this.rawSize;
      const n = 1 << this.zoom;
      if (this.windowSize >= G) return false;
      if (axis === 'x' && (this.compOriginX + dir < 0 || this.compOriginX + dir + ct > n)) return false;
      if (axis === 'y' && (this.compOriginY + dir < 0 || this.compOriginY + dir + ct > n)) return false;

      // entering strip must be cached
      const strip = [];
      const keys = this._stripKeys(axis, dir);
      for (let k = 0; k < keys.length; k++) {
        const m = METERS_CACHE.get(cacheKey(keys[k].z, keys[k].x, keys[k].y));
        if (!m) return false;
        strip.push(m);
      }

      const nw = new Float32Array(this.raw);
      if (axis === 'x') {
        for (let jc = 0; jc < ct; jc++) {
          const src = jc + dir;
          if (src >= 0 && src < ct) this._copyColBlock(nw, G, jc, src);
        }
        const dest = dir === -1 ? 0 : ct - 1;
        for (let k = 0; k < ct; k++) {
          for (let r = 0; r < T; r++) {
            nw.set(strip[k].subarray(r * T, r * T + T), (k * T + r) * G + dest * T);
          }
        }
        this.compOriginX += dir;
        this.winX -= dir * T;
      } else {
        for (let jr = 0; jr < ct; jr++) {
          const src = jr + dir;
          if (src >= 0 && src < ct) this._copyRowBlock(nw, G, jr, src);
        }
        const dest = dir === -1 ? 0 : ct - 1;
        for (let k = 0; k < ct; k++) {
          for (let r = 0; r < T; r++) {
            nw.set(strip[k].subarray(r * T, r * T + T), (dest * T + r) * G + k * T);
          }
        }
        this.compOriginY += dir;
        this.winY -= dir * T;
      }

      this.raw = nw;
      let min = Infinity;
      let max = -Infinity;
      for (let p = 0; p < nw.length; p++) {
        if (nw[p] < min) min = nw[p];
        if (nw[p] > max) max = nw[p];
      }
      this.min = min;
      this.max = max;
      this.revision++;
      return true;
    }

    heightAt(rawX, rawY) {
      const G = this.rawSize;
      const i = Math.max(0, Math.min(G - 1, rawY | 0));
      const j = Math.max(0, Math.min(G - 1, rawX | 0));
      return this.raw[i * G + j];
    }

    sampleAt(rawX, rawY) {
      const G = this.rawSize;
      const sx = Math.max(0, Math.min(G - 1, rawX));
      const sy = Math.max(0, Math.min(G - 1, rawY));
      const x0 = sx | 0;
      const y0 = sy | 0;
      const x1 = Math.min(G - 1, x0 + 1);
      const y1 = Math.min(G - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const a = this.raw[y0 * G + x0];
      const b = this.raw[y0 * G + x1];
      const c = this.raw[y1 * G + x0];
      const d = this.raw[y1 * G + x1];
      const top = a + (b - a) * fx;
      const bot = c + (d - c) * fx;
      return top + (bot - top) * fy;
    }
  }

  global.Terrain = Terrain;
  global.TILE_SIZE = TILE_SIZE;
  global.terrainWindow = windowRect;
  global.loadSatelliteTiles = loadSatelliteTiles;
  global.isWindowCached = isWindowCached;
  global.preloadWindow = preloadWindow;
}(window));