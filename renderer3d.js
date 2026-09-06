(function (global) {
  'use strict';

  const ISO_COL = Math.cos(Math.PI / 6);
  const ISO_ROW = Math.sin(Math.PI / 6);

  const LIGHT = (function () {
    const v = [0.45, 0.9, 0.35];
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }());

  const SEA_COLOR = [0.102, 0.275, 0.502];

  const VERT_SRC = [
    'precision highp float;',
    'attribute vec3 a_pos;',
    'attribute vec3 a_color;',
    'attribute vec3 a_normal;',
    'varying vec3 v_color;',
    'varying float v_light;',
    'uniform vec2 u_rot;',
    'uniform vec2 u_scale;',
    'uniform vec2 u_off;',
    'uniform vec2 u_size;',
    'uniform vec2 u_depth;',
    'uniform vec3 u_light;',
    'const float COL = ' + ISO_COL + ';',
    'const float ROW = ' + ISO_ROW + ';',
    'void main() {',
    '  float xr = a_pos.x * u_rot.x - a_pos.y * u_rot.y;',
    '  float yr = a_pos.x * u_rot.y + a_pos.y * u_rot.x;',
    '  float d = xr + yr;',
    '  float sx = (xr - yr) * COL;',
    '  float sy = (xr + yr) * ROW - a_pos.z;',
    '  vec2 ndc = vec2(',
    '    (sx * u_scale.x + u_off.x) / u_size.x * 2.0 - 1.0,',
    '    1.0 - (sy * u_scale.y + u_off.y) / u_size.y * 2.0',
    '  );',
    '  gl_Position = vec4(ndc, (d - u_depth.x) * u_depth.y * 2.0 - 1.0, 1.0);',
    '  v_color = a_color;',
    '  v_light = 0.22 + 0.78 * max(0.0, dot(a_normal, u_light));',
    '}'
  ].join('\n');

  const FRAG_SRC = [
    'precision mediump float;',
    'varying vec3 v_color;',
    'varying float v_light;',
    'void main() {',
    '  gl_FragColor = vec4(v_color * v_light, 1.0);',
    '}'
  ].join('\n');

  const SEA_FRAG_SRC = [
    'precision mediump float;',
    'uniform vec4 u_color;',
    'void main() {',
    '  gl_FragColor = u_color;',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || 'unknown error';
      gl.deleteShader(sh);
      throw new Error('Shader compile error: ' + log);
    }
    return sh;
  }

  function link(gl, vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + (gl.getProgramInfoLog(prog) || ''));
    }
    return prog;
  }

  function uniformLocations(gl, prog, names) {
    const out = {};
    names.forEach(function (n) { out[n] = gl.getUniformLocation(prog, n); });
    return out;
  }

  function attributeLocations(gl, prog) {
    const out = {};
    ['a_pos', 'a_color', 'a_normal'].forEach(function (n) {
      out[n] = gl.getAttribLocation(prog, n);
    });
    return out;
  }

  function bindAttribs(gl, locs) {
    const stride = 9 * 4;
    if (locs.a_pos >= 0) {
      gl.enableVertexAttribArray(locs.a_pos);
      gl.vertexAttribPointer(locs.a_pos, 3, gl.FLOAT, false, stride, 0);
    }
    if (locs.a_color >= 0) {
      gl.enableVertexAttribArray(locs.a_color);
      gl.vertexAttribPointer(locs.a_color, 3, gl.FLOAT, false, stride, 12);
    }
    if (locs.a_normal >= 0) {
      gl.enableVertexAttribArray(locs.a_normal);
      gl.vertexAttribPointer(locs.a_normal, 3, gl.FLOAT, false, stride, 24);
    }
  }

  class WebGLRenderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
      if (!gl) {
        this.available = false;
        this.gl = null;
        return;
      }
      this.available = true;
      this.gl = gl;
      this.drawable = canvas;

      this.terrain = null;
      this.grid = null;
      this.gridSize = 0;
      this.size = 96;
      this.yaw = 0;
      this.seaLevel = true;
      this.dirty = true;

      let _vertical = 48;
      Object.defineProperty(this, 'vertical', {
        get: function () { return _vertical; },
        set: function (v) {
          if (v !== _vertical) {
            _vertical = v;
            this.dirty = true;
          }
        }
      });

      const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
      this.prog = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
      this.seaProg = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, SEA_FRAG_SRC));

      this.locs = attributeLocations(gl, this.prog);
      this.seaLocs = attributeLocations(gl, this.seaProg);

      this.uniforms = uniformLocations(gl, this.prog,
        ['u_rot', 'u_scale', 'u_off', 'u_size', 'u_depth', 'u_light']);
      this.seaUniforms = uniformLocations(gl, this.seaProg,
        ['u_rot', 'u_scale', 'u_off', 'u_size', 'u_depth', 'u_color']);

      this.buf = gl.createBuffer();
      this.seaBuf = gl.createBuffer();
      this.seaData = new Float32Array(6 * 9);

      canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
      canvas.addEventListener('webglcontextrestored', function () { this.dirty = true; }.bind(this));
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.drawable.clientWidth || window.innerWidth;
      const h = this.drawable.clientHeight || window.innerHeight;
      this.cssW = w;
      this.cssH = h;
      const bw = w * dpr;
      const bh = h * dpr;
      this.width = bw;
      this.height = bh;
      if (this.drawable.width !== bw || this.drawable.height !== bh) {
        this.drawable.width = bw;
        this.drawable.height = bh;
      }
    }

    rebuildGrid() {
      const t = this.terrain;
      if (!t) return;
      const W = Math.max(2, this.size);
      const step = t.rawSize / (W - 1);
      this.grid = new Float32Array(W * W);
      for (let i = 0; i < W; i++) {
        const rawY = i * step;
        for (let j = 0; j < W; j++) {
          const rawX = j * step;
          this.grid[i * W + j] = t.sampleAt(rawX, rawY);
        }
      }
      this.gridSize = W;
      this.dirty = true;
    }

    rebuildMesh() {
      const W = this.gridSize;
      if (!W) return;
      const cells = W - 1;
      const arr = new Float32Array(cells * cells * 6 * 9);
      const half = (W - 1) / 2;
      const g = this.grid;
      const range = Math.max(1, this.terrain.max - this.terrain.min);
      const min = this.terrain.min;
      const zs = this.vertical;
      const ramp = global.isoRampColorRgb;

      const hn = new Float32Array(W * W);
      const col = new Float32Array(W * W * 3);
      for (let p = 0; p < W * W; p++) {
        const v = (g[p] - min) / range;
        hn[p] = v;
        const c = ramp(v);
        col[p * 3] = c[0];
        col[p * 3 + 1] = c[1];
        col[p * 3 + 2] = c[2];
      }

      function put(o, wx, wy, hz, cb, n) {
        arr[o] = wx;
        arr[o + 1] = wy;
        arr[o + 2] = hz;
        arr[o + 3] = col[cb];
        arr[o + 4] = col[cb + 1];
        arr[o + 5] = col[cb + 2];
        arr[o + 6] = n[0];
        arr[o + 7] = n[1];
        arr[o + 8] = n[2];
      }

      function faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        return [nx / len, ny / len, nz / len];
      }

      let o = 0;
      const n1 = [0, 0, 0];
      const n2 = [0, 0, 0];
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          const wxA = j - half, wyA = i - half;
          const wxB = j + 1 - half, wyB = i - half;
          const wxC = j + 1 - half, wyC = i + 1 - half;
          const wxD = j - half, wyD = i + 1 - half;
          const hA = hn[i * W + j] * zs;
          const hB = hn[i * W + j + 1] * zs;
          const hC = hn[(i + 1) * W + j + 1] * zs;
          const hD = hn[(i + 1) * W + j] * zs;

          const f1 = faceNormal(wxA, wyA, hA, wxB, wyB, hB, wxC, wyC, hC);
          const f2 = faceNormal(wxA, wyA, hA, wxC, wyC, hC, wxD, wyD, hD);
          n1[0] = f1[0]; n1[1] = f1[1]; n1[2] = f1[2];
          n2[0] = f2[0]; n2[1] = f2[1]; n2[2] = f2[2];

          put(o, wxA, wyA, hA, (i * W + j) * 3, n1); o += 9;
          put(o, wxB, wyB, hB, (i * W + j + 1) * 3, n1); o += 9;
          put(o, wxC, wyC, hC, ((i + 1) * W + j + 1) * 3, n1); o += 9;
          put(o, wxA, wyA, hA, (i * W + j) * 3, n2); o += 9;
          put(o, wxC, wyC, hC, ((i + 1) * W + j + 1) * 3, n2); o += 9;
          put(o, wxD, wyD, hD, ((i + 1) * W + j) * 3, n2); o += 9;
        }
      }

      this.meshArr = arr;
      this.vertCount = cells * cells * 6;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, arr, this.gl.DYNAMIC_DRAW);
      this.dirty = false;
    }

    computeLayout() {
      const W = this.gridSize;
      const t = this.terrain;
      const half = (W - 1) / 2;
      const range = Math.max(1, t.max - t.min);
      const ca = Math.cos(this.yaw);
      const sa = Math.sin(this.yaw);
      const zs = this.vertical;
      const g = this.grid;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let minD = Infinity, maxD = -Infinity;
      for (let i = 0; i < W; i++) {
        const wy = i - half;
        for (let j = 0; j < W; j++) {
          const wx = j - half;
          const hz = ((g[i * W + j] - t.min) / range) * zs;
          const xr = wx * ca - wy * sa;
          const yr = wx * sa + wy * ca;
          const d = xr + yr;
          const sx = (xr - yr) * ISO_COL;
          const sy = (xr + yr) * ISO_ROW - hz;
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
          if (d < minD) minD = d;
          if (d > maxD) maxD = d;
        }
      }

      const span = Math.max(maxX - minX, maxY - minY);
      const pad = 80;
      const scale = Math.min((this.cssW - pad * 2) / span, (this.cssH - pad * 2) / span * 1.6);
      return {
        scale: scale,
        ox: this.cssW / 2 - (minX + maxX) / 2 * scale,
        oy: this.cssH / 2 - (minY + maxY) / 2 * scale,
        minD: minD,
        invD: maxD > minD ? 1 / (maxD - minD) : 0
      };
    }

    setCommon(gl, u, layout) {
      gl.uniform2f(u.u_rot, Math.cos(this.yaw), Math.sin(this.yaw));
      gl.uniform2f(u.u_scale, layout.scale, layout.scale);
      gl.uniform2f(u.u_off, layout.ox, layout.oy);
      gl.uniform2f(u.u_size, this.cssW, this.cssH);
      gl.uniform2f(u.u_depth, layout.minD, layout.invD);
    }

    drawMesh(layout) {
      const gl = this.gl;
      gl.useProgram(this.prog);
      this.setCommon(gl, this.uniforms, layout);
      gl.uniform3f(this.uniforms.u_light, LIGHT[0], LIGHT[1], LIGHT[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      bindAttribs(gl, this.locs);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertCount);
    }

    drawSea(layout) {
      const gl = this.gl;
      const W = this.gridSize;
      const t = this.terrain;
      const range = Math.max(1, t.max - t.min);
      const seaHn = (0 - t.min) / range;
      if (seaHn <= 0) return;

      const wz = seaHn * this.vertical - 0.35;
      const half = (W - 1) / 2;
      const d = this.seaData;

      putSea(d, 0, -half, -half, wz);
      putSea(d, 9, half, -half, wz);
      putSea(d, 18, half, half, wz);
      putSea(d, 0, -half, -half, wz);
      putSea(d, 18, half, half, wz);
      putSea(d, 27, -half, half, wz);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.seaBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.seaData, gl.DYNAMIC_DRAW);

      gl.useProgram(this.seaProg);
      this.setCommon(gl, this.seaUniforms, layout);
      gl.uniform4f(this.seaUniforms.u_color, SEA_COLOR[0], SEA_COLOR[1], SEA_COLOR[2], 1);
      bindAttribs(gl, this.seaLocs);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    render() {
      if (!this.gl) return;
      const gl = this.gl;
      this.resize();
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.disable(gl.CULL_FACE);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const t = this.terrain;
      if (!t) return;
      if (!this.grid || this.gridSize !== this.size) this.rebuildGrid();
      if (this.dirty) this.rebuildMesh();
      if (!this.meshArr) return;

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      const layout = this.computeLayout();
      this.drawMesh(layout);
      if (this.seaLevel) this.drawSea(layout);
    }
  }

  function putSea(arr, o, wx, wy, hz) {
    arr[o] = wx;
    arr[o + 1] = wy;
    arr[o + 2] = hz;
    arr[o + 3] = SEA_COLOR[0];
    arr[o + 4] = SEA_COLOR[1];
    arr[o + 5] = SEA_COLOR[2];
    arr[o + 6] = 0;
    arr[o + 7] = 0;
    arr[o + 8] = 1;
  }

  global.WebGLRenderer = WebGLRenderer;
}(window));