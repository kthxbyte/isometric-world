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
    const x0 = clamp(Math.round(cx * n - (w - 1) / 2), 0, maxOrigin);
    const y0 = clamp(Math.round(cy * n - (w - 1) / 2), 0, maxOrigin);
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

  // Composite the same window of Web-Mercator tiles as the heightmap into an
  // RGBA bitmap, so every heightmap pixel has a matching imagery pixel.
  async function loadSatelliteTiles(zoom, x0, y0, w) {
    const loaders = [];
    for (let dy = 0; dy < w; dy++) {
      for (let dx = 0; dx < w; dx++) {
        loaders.push(loadSatTileImage(zoom, x0 + dx, y0 + dy)
          .then(function (img) { return { dx: dx, dy: dy, img: img }; }));
      }
    }
    const tiles = await Promise.all(loaders);
    const G = w * TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = G;
    canvas.height = G;
    const ctx = canvas.getContext('2d');
    tiles.forEach(function (t) {
      ctx.drawImage(t.img, t.dx * TILE_SIZE, t.dy * TILE_SIZE);
    });
    return ctx.getImageData(0, 0, G, G).data;
  }

  class Terrain {
    constructor() {
      this.zoom = null;
      this.window = 1;
      this.originX = 0;
      this.originY = 0;
      this.center = { x: 0.5, y: 0.5 };
      this.raw = null;
      this.rawSize = 0;
      this.min = 0;
      this.max = 0;
    }

    async load(zoom, cx, cy, onTile) {
      const rect = windowRect(zoom, cx, cy);
      const loaders = [];
      const order = [];
      for (let dy = 0; dy < rect.w; dy++) {
        for (let dx = 0; dx < rect.w; dx++) {
          const x = rect.x0 + dx;
          const y = rect.y0 + dy;
          order.push([x, y]);
          loaders.push(loadTileImage(zoom, x, y)
            .then(readTilePixels)
            .then(function (meters) { return { dx: dx, dy: dy, meters: meters }; }));
        }
      }

      if (onTile) onTile(0, order.length);

      const tiles = await Promise.all(loaders);

      const G = rect.w * TILE_SIZE;
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
      this.originX = rect.x0;
      this.originY = rect.y0;
      this.center = { x: cx, y: cy };
      this.raw = raw;
      this.rawSize = G;
      this.min = min;
      this.max = max;

      if (onTile) onTile(order.length, order.length);
      return this;
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
}(window));