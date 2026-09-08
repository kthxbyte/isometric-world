(function (global) {
  'use strict';

  const ISO_COL = Math.cos(Math.PI / 6);
  const ISO_ROW = Math.sin(Math.PI / 6);

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(c1, c2, t) {
    return [
      lerp(c1[0], c2[0], t),
      lerp(c1[1], c2[1], t),
      lerp(c1[2], c2[2], t)
    ];
  }

  const PALETTE = [
    { at: 0.00, color: hexToRgb('#08306b') },
    { at: 0.12, color: hexToRgb('#1c6fa8') },
    { at: 0.22, color: hexToRgb('#3182bd') },
    { at: 0.30, color: hexToRgb('#2c7a41') },
    { at: 0.42, color: hexToRgb('#63a832') },
    { at: 0.55, color: hexToRgb('#c8d451') },
    { at: 0.68, color: hexToRgb('#b4985a') },
    { at: 0.80, color: hexToRgb('#a68060') },
    { at: 0.90, color: hexToRgb('#e8e4dc') },
    { at: 1.00, color: hexToRgb('#ffffff') }
  ];

  function rampColorRgb(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < PALETTE.length - 1; i++) {
      const lo = PALETTE[i];
      const hi = PALETTE[i + 1];
      if (t >= lo.at && t <= hi.at) {
        const f = (t - lo.at) / (hi.at - lo.at);
        const c = mix(lo.color, hi.color, f);
        return [c[0] / 255, c[1] / 255, c[2] / 255];
      }
    }
    return [1, 1, 1];
  }

  function rampColor(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < PALETTE.length - 1; i++) {
      const lo = PALETTE[i];
      const hi = PALETTE[i + 1];
      if (t >= lo.at && t <= hi.at) {
        const f = (t - lo.at) / (hi.at - lo.at);
        const c = mix(lo.color, hi.color, f);
        return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
      }
    }
    return 'rgb(255,255,255)';
  }

  class Renderer {
    constructor(canvas) {
      this.terrainRev = -1;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.terrain = null;
      this.size = 512;
      this.vertical = 20;
      this.yaw = 0;
      this.seaLevel = false;
      this.pan = { x: 0, y: 0 };
      this.fitScale = 0;
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth || window.innerWidth;
      const h = this.canvas.clientHeight || window.innerHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.width = w * dpr;
      this.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.cssW = w;
      this.cssH = h;
    }

    effectiveSize() {
      const maxRaw = this.terrain ? this.terrain.rawSize : 4096;
      return Math.max(2, Math.min(this.size, maxRaw, 256));
    }

    screenScale() {
      return this.fitScale;
    }

    rebuildGrid() {
      const t = this.terrain;
      if (!t) return;
      const W = this.effectiveSize();
      const win = t.windowSize || t.rawSize;
      const step = win / (W - 1);
      this.grid = new Float32Array(W * W);
      for (let i = 0; i < W; i++) {
        const rawY = (t.winY || 0) + i * step;
        for (let j = 0; j < W; j++) {
          const rawX = (t.winX || 0) + j * step;
          this.grid[i * W + j] = t.sampleAt(rawX, rawY);
        }
      }
      this.gridSize = W;
      this.gridWinX = t.winX | 0;
      this.gridWinY = t.winY | 0;
    }

    project(wx, wy, wz, out) {
      const a = this.yaw;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const xr = wx * ca - wy * sa;
      const yr = wx * sa + wy * ca;
      out.x = (xr - yr) * ISO_COL;
      out.y = (xr + yr) * ISO_ROW - wz;
    }

    paintOrderIndex(i, j) {
      const a = this.yaw;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const wx = j;
      const wy = i;
      const xr = wx * ca - wy * sa;
      const yr = wx * sa + wy * ca;
      return xr + yr;
    }

    drawTerrain() {
      const t = this.terrain;
      if (!t) return;
      if (!this.grid || this.gridSize !== this.effectiveSize() ||
          (t.revision || 0) !== this.terrainRev ||
          (t.winX | 0) !== this.gridWinX || (t.winY | 0) !== this.gridWinY) {
        this.rebuildGrid();
        this.terrainRev = t.revision || 0;
      }

      const W = this.gridSize;
      const ctx = this.ctx;

      const hRange = Math.max(1, t.max - t.min);
      const extent = W - 1;
      const half = extent / 2;
      const hNorm = (h) => (h - t.min) / hRange;
      const zScale = this.vertical / (Math.max(1, this.size / 64) * 1.0);

      const proj = { x: 0, y: 0 };
      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

      const pts = new Float32Array(W * W * 2);
      for (let i = 0; i < W; i++) {
        for (let j = 0; j < W; j++) {
          const wx = j - half;
          const wy = i - half;
          const wz = hNorm(this.grid[i * W + j]) * zScale;
          this.project(wx, wy, wz, proj);
          const pi = (i * W + j) * 2;
          pts[pi] = proj.x;
          pts[pi + 1] = proj.y;
          if (proj.x < bounds.minX) bounds.minX = proj.x;
          if (proj.x > bounds.maxX) bounds.maxX = proj.x;
          if (proj.y < bounds.minY) bounds.minY = proj.y;
          if (proj.y > bounds.maxY) bounds.maxY = proj.y;
        }
      }

      const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      const pad = 80;
      const scale = Math.min((this.cssW - pad * 2) / span, (this.cssH - pad * 2) / span * 1.6);
      this.fitScale = scale;
      const ox = this.cssW / 2 - (bounds.minX + bounds.maxX) / 2 * scale + this.pan.x;
      const oy = this.cssH / 2 - (bounds.minY + bounds.maxY) / 2 * scale + this.pan.y;

      const sx = (i, j) => pts[(i * W + j) * 2] * scale + ox;
      const sy = (i, j) => pts[(i * W + j) * 2 + 1] * scale + oy;

      const terrainColor = {};
      for (let i = 0; i < W; i++) {
        for (let j = 0; j < W; j++) {
          terrainColor[i * W + j] = rampColor(hNorm(this.grid[i * W + j]));
        }
      }

      const cells = [];
      for (let i = 0; i < W - 1; i++) {
        for (let j = 0; j < W - 1; j++) {
          cells.push({ i: i, j: j, key: this.paintOrderIndex(i, j) });
        }
      }
      cells.sort(function (a, b) { return a.key - b.key; });

      if (this.seaLevel) {
        ctx.fillStyle = 'rgba(26, 70, 128, 1)';
        ctx.beginPath();
        ctx.moveTo(sx(0, 0), sy(0, 0));
        ctx.lineTo(sx(0, W - 1), sy(0, W - 1));
        ctx.lineTo(sx(W - 1, W - 1), sy(W - 1, W - 1));
        ctx.lineTo(sx(W - 1, 0), sy(W - 1, 0));
        ctx.closePath();
        ctx.fill();
      }

      for (let c = 0; c < cells.length; c++) {
        const { i, j } = cells[c];
        ctx.fillStyle = terrainColor[i * W + j];
        ctx.beginPath();
        ctx.moveTo(sx(i, j), sy(i, j));
        ctx.lineTo(sx(i, j + 1), sy(i, j + 1));
        ctx.lineTo(sx(i + 1, j + 1), sy(i + 1, j + 1));
        ctx.lineTo(sx(i + 1, j), sy(i + 1, j));
        ctx.closePath();
        ctx.fill();
      }
    }

    render() {
      this.resize();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      if (this.terrain) this.drawTerrain();
    }
  }

  global.Renderer = Renderer;
  global.isoRampColorRgb = rampColorRgb;
  global.ISO_COL = ISO_COL;
  global.ISO_ROW = ISO_ROW;
}(window));
