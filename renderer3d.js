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
    'attribute vec2 a_pos;',
    'uniform sampler2D u_heights;',
    'uniform float u_raw;',
    'uniform vec2 u_uv0;',
    'uniform vec2 u_texel;',
    'uniform float u_vertical;',
    'uniform vec2 u_rot;',
    'uniform vec2 u_scale;',
    'uniform vec2 u_off;',
    'uniform vec2 u_pan;',
    'uniform vec2 u_size;',
    'uniform vec2 u_depth;',
    'uniform vec3 u_light;',
    'varying float v_h;',
    'varying float v_light;',
    'varying vec2 v_uv;',
    'const float COL = ' + ISO_COL + ';',
    'const float ROW = ' + ISO_ROW + ';',
    'void main() {',
    '  vec2 uv = a_pos / u_raw + u_uv0;',
    '  float hC = texture2D(u_heights, uv).r;',
    '  float hR = texture2D(u_heights, uv + vec2(u_texel.x, 0.0)).r;',
    '  float hL = texture2D(u_heights, uv - vec2(u_texel.x, 0.0)).r;',
    '  float hU = texture2D(u_heights, uv + vec2(0.0, u_texel.y)).r;',
    '  float hD = texture2D(u_heights, uv - vec2(0.0, u_texel.y)).r;',
    '  float dx = (hR - hL) * 0.5 * u_vertical;',
    '  float dz = (hU - hD) * 0.5 * u_vertical;',
    '  vec3 normal = normalize(vec3(-dx, 1.0, -dz));',
    '  float hz = hC * u_vertical;',
    '  float xr = a_pos.x * u_rot.x - a_pos.y * u_rot.y;',
    '  float yr = a_pos.x * u_rot.y + a_pos.y * u_rot.x;',
    '  float d = xr + yr;',
    '  float sx = (xr - yr) * COL;',
    '  float sy = (xr + yr) * ROW - hz;',
    '  vec2 pix = vec2(sx, sy) * u_scale + u_off + u_pan;',
    '  vec2 ndc = vec2(',
    '    pix.x / u_size.x * 2.0 - 1.0,',
    '    1.0 - pix.y / u_size.y * 2.0',
    '  );',
    '  gl_Position = vec4(ndc, 1.0 - (d - u_depth.x) * u_depth.y * 2.0, 1.0);',
    '  v_h = hC;',
    '  v_uv = uv;',
    '  v_light = 0.22 + 0.78 * max(0.0, dot(normal, u_light));',
    '}'
  ].join('\n');

  const FRAG_SRC = [
    'precision highp float;',
    'uniform sampler2D u_ramp;',
    'uniform sampler2D u_sat;',
    'uniform float u_satOn;',
    'varying float v_h;',
    'varying float v_light;',
    'varying vec2 v_uv;',
    'void main() {',
    '  vec3 base = texture2D(u_ramp, vec2(v_h, 0.5)).rgb;',
    '  if (u_satOn > 0.5) { base = texture2D(u_sat, v_uv).rgb; }',
    '  gl_FragColor = vec4(base * v_light, 1.0);',
    '}'
  ].join('\n');

  const SEA_VERT_SRC = [
    'precision highp float;',
    'attribute vec2 a_pos;',
    'uniform float u_seaH;',
    'uniform vec2 u_rot;',
    'uniform vec2 u_scale;',
    'uniform vec2 u_off;',
    'uniform vec2 u_pan;',
    'uniform vec2 u_size;',
    'uniform vec2 u_depth;',
    'const float COL = ' + ISO_COL + ';',
    'const float ROW = ' + ISO_ROW + ';',
    'void main() {',
    '  float hz = u_seaH;',
    '  float xr = a_pos.x * u_rot.x - a_pos.y * u_rot.y;',
    '  float yr = a_pos.x * u_rot.y + a_pos.y * u_rot.x;',
    '  float d = xr + yr;',
    '  float sx = (xr - yr) * COL;',
    '  float sy = (xr + yr) * ROW - hz;',
    '  vec2 pix = vec2(sx, sy) * u_scale + u_off + u_pan;',
    '  vec2 ndc = vec2(',
    '    pix.x / u_size.x * 2.0 - 1.0,',
    '    1.0 - pix.y / u_size.y * 2.0',
    '  );',
    '  gl_Position = vec4(ndc, 1.0 - (d - u_depth.x) * u_depth.y * 2.0, 1.0);',
    '}'
  ].join('\n');

  const SEA_FRAG_SRC = [
    'precision highp float;',
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

  function bindAttribs(gl, glObj, locPos) {
    if (locPos >= 0) {
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 2, glObj.FLOAT, false, 8, 0);
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
      this.size = 512;
      this.vertical = 20;
      this.yaw = 0;
      this.seaLevel = false;
      this.zoomFactor = 1;
      this.pan = { x: 0, y: 0 };
      this.windowSize = 0;

      this.texTerrain = null;
      this.lastRev = -1;
      this.gridS = 0;
      this.gridWin = 0;
      this.layout = null;
      this.useUintExt = !!gl.getExtension('OES_element_index_uint');

      this.heightTex = null;
      this.rampTex = this.buildRampTexture(gl);
      this.satTex = null;
      this.satReady = false;

      const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
      this.prog = link(gl, vs, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
      const svs = compile(gl, gl.VERTEX_SHADER, SEA_VERT_SRC);
      this.seaProg = link(gl, svs, compile(gl, gl.FRAGMENT_SHADER, SEA_FRAG_SRC));

      this.posLoc = gl.getAttribLocation(this.prog, 'a_pos');
      this.seaPosLoc = gl.getAttribLocation(this.seaProg, 'a_pos');

      this.uniforms = uniformLocations(gl, this.prog,
        ['u_heights', 'u_ramp', 'u_sat', 'u_satOn', 'u_raw', 'u_uv0', 'u_texel', 'u_vertical', 'u_rot',
          'u_scale', 'u_off', 'u_pan', 'u_size', 'u_depth', 'u_light']);
      this.seaUniforms = uniformLocations(gl, this.seaProg,
        ['u_seaH', 'u_rot', 'u_scale', 'u_off', 'u_pan', 'u_size', 'u_depth', 'u_color']);

      this.posBuf = gl.createBuffer();
      this.idxBuf = gl.createBuffer();
      this.seaBuf = gl.createBuffer();

      canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
      canvas.addEventListener('webglcontextrestored', function () {
        this.texTerrain = null;
        this.gridS = 0;
        this.satTex = null;
        this.satReady = false;
      }.bind(this));
    }

    buildRampTexture(gl) {
      const data = new Uint8Array(256 * 4);
      const ramp = global.isoRampColorRgb;
      for (let i = 0; i < 256; i++) {
        const c = ramp(i / 255);
        data[i * 4] = Math.round(c[0] * 255);
        data[i * 4 + 1] = Math.round(c[1] * 255);
        data[i * 4 + 2] = Math.round(c[2] * 255);
        data[i * 4 + 3] = 255;
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    buildTerrain(terrain) {
      const gl = this.gl;
      if (this.heightTex) gl.deleteTexture(this.heightTex);

      const G = terrain.rawSize;
      const range = Math.max(1, terrain.max - terrain.min);
      const data = new Uint8Array(G * G * 2);
      const raw = terrain.raw;
      for (let p = 0; p < G * G; p++) {
        let v = Math.round(((raw[p] - terrain.min) / range) * 65535);
        if (v < 0) v = 0;
        if (v > 65535) v = 65535;
        data[p * 2] = v >> 8;
        data[p * 2 + 1] = v & 255;
      }

      this.heightTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, G, G, 0,
        gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.rawSize = G;
      this.windowSize = terrain.windowSize || G;
      this.texTerrain = terrain;
      this._reportMeshSpikes(terrain, range);
    }

    _reportMeshSpikes(terrain, range) {
      // Diagnose "spikes all over" by sampling the mesh grid over the window and
      // flagging vertices whose height jumps more than a threshold vs neighbors.
      const G = this.rawSize;
      const N = this.windowSize || G;
      if (G < 4 || N < 4) return;
      const S = this.gridS || 256;
      const w0 = terrain.winX, w1 = terrain.winY;
      const vh = this.vertical || 20;
      const th = Math.max(60, range * 0.25);
      const raw = terrain.raw;
      let count = 0;
      const samples = [];
      for (let i = 1; i < S - 1; i++) {
        const yy = Math.max(0, Math.min(G - 1, ((w1 + ((i + 0.5) / S) * N)) | 0));
        for (let j = 1; j < S - 1; j++) {
          const xx = Math.max(0, Math.min(G - 1, ((w0 + ((j + 0.5) / S) * N)) | 0));
          const z = raw[yy * G + xx];
          const n = (raw[(yy - 1) * G + xx] + raw[(yy + 1) * G + xx] +
            raw[yy * G + xx - 1] + raw[yy * G + xx + 1]) * 0.25;
          const d = Math.abs(z - n);
          if (d > th) {
            count++;
            if (samples.length < 4) {
              samples.push({ xx: xx, yy: yy, z: Math.round(z), nb: Math.round(n), d: Math.round(d) });
            }
          }
        }
      }
      const key = terrain.revision + '|' + terrain.compOriginX + ',' + terrain.compOriginY +
        '|' + w0.toFixed(2) + ',' + w1.toFixed(2) + '|' + terrain.min + '..' + terrain.max;
      if (key !== this._lastSpikeKey) {
        this._lastSpikeKey = key;
        console.log('[mesh-spikes] ' + JSON.stringify({
          zoom: terrain.zoom,
          comp: [terrain.compOriginX, terrain.compOriginY],
          win: [Math.round(w0), Math.round(w1)],
          elevM: [Math.round(terrain.min), Math.round(terrain.max)],
          rangeM: Math.round(range),
          vertical: vh,
          threshM: Math.round(th),
          gridS: S,
          spikeTexels: count,
          samples: samples,
          blocksMin: this._compBlockMinMax(terrain).lo,
          blocksMax: this._compBlockMinMax(terrain).hi
        }));
      }
    }

    // Per-tile-block min/max of the current comp; identifies which tiles supply
    // the comp extreme values and their coordinates in the comp block grid.
    _compBlockMinMax(terrain) {
      const ct = terrain.compTiles;
      const G = terrain.rawSize;
      const T = terrain.rawSize / ct;
      const raw = terrain.raw;
      const lo = [];
      const hi = [];
      for (let dy = 0; dy < ct; dy++) {
        for (let dx = 0; dx < ct; dx++) {
          let mn = Infinity, mx = -Infinity;
          const y0 = dy * T, x0 = dx * T;
          for (let r = 0; r < T; r++) {
            const o = (y0 + r) * G + x0;
            for (let c = 0; c < T; c++) {
              const v = raw[o + c];
              if (v < mn) mn = v;
              if (v > mx) mx = v;
            }
          }
          const b = { dx: dx, dy: dy, x: terrain.compOriginX + dx, y: terrain.compOriginY + dy, min: Math.round(mn), max: Math.round(mx) };
          lo.push(b);
          hi.push(b);
        }
      }
      lo.sort((a, b) => a.min - b.min);
      hi.sort((a, b) => b.max - a.max);
      return { lo: lo.slice(0, 4), hi: hi.slice(0, 4) };
    }

    setSatellite(data) {
      const gl = this.gl;
      if (this.satTex) {
        gl.deleteTexture(this.satTex);
        this.satTex = null;
      }
      this.satReady = false;
      if (!data) return;

      const G = this.rawSize || (this.texTerrain && this.texTerrain.rawSize);
      if (!G) return;
      this.satTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.satTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, G, G, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.satReady = true;
    }

    buildGrid(S) {
      const gl = this.gl;
      const N = this.windowSize || this.rawSize;
      S = Math.max(2, Math.min(S, N));
      if (S > 256 && !this.useUintExt) S = 256;

      const pos = new Float32Array(S * S * 2);
      for (let i = 0; i < S; i++) {
        const v = (i + 0.5) / S;
        for (let j = 0; j < S; j++) {
          const u = (j + 0.5) / S;
          const o = (i * S + j) * 2;
          pos[o] = (u - 0.5) * N;
          pos[o + 1] = (v - 0.5) * N;
        }
      }

      const cell = S - 1;
      const useUint32 = S * S > 65535;
      const is32 = useUint32 && this.useUintExt;
      const idx = is32 ? new Uint32Array(cell * cell * 6) : new Uint16Array(cell * cell * 6);
      let o = 0;
      for (let i = 0; i < cell; i++) {
        for (let j = 0; j < cell; j++) {
          const a = i * S + j;
          const b = a + 1;
          const c = a + S;
          const d = a + S + 1;
          idx[o++] = a; idx[o++] = b; idx[o++] = d;
          idx[o++] = a; idx[o++] = d; idx[o++] = c;
        }
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

      this.gridS = S;
      this.gridWin = this.windowSize;
      this.indexType = is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      this.indexCount = idx.length;

      const h = N / 2;
      const sea = new Float32Array([-h, -h, h, -h, h, h, -h, -h, h, h, -h, h]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seaBuf);
      gl.bufferData(gl.ARRAY_BUFFER, sea, gl.STATIC_DRAW);
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

    computeLayout() {
      const half = (this.windowSize || this.rawSize) / 2;
      const ca = Math.cos(this.yaw);
      const sa = Math.sin(this.yaw);
      const a = Math.abs(ca + sa) + Math.abs(ca - sa);
      const maxD = half * a;
      const syBase = maxD * ISO_ROW;
      const sxHalf = a * half * ISO_COL;

      const spanX = sxHalf * 2;
      const spanY = syBase * 2 + this.vertical;
      const span = Math.max(spanX, spanY);
      const pad = 80;
      const scale = Math.min((this.cssW - pad * 2) / span, (this.cssH - pad * 2) / span * 1.6) * this.zoomFactor;
      const midY = -this.vertical / 2;

      return {
        scale: scale,
        ox: this.cssW / 2,
        oy: this.cssH / 2 - midY * scale,
        minD: -maxD,
        invD: maxD > 0 ? 1 / (2 * maxD) : 0
      };
    }

    screenScale() {
      return this.layout ? this.layout.scale : 0;
    }

    setCommon(gl, u, layout) {
      gl.uniform2f(u.u_rot, Math.cos(this.yaw), Math.sin(this.yaw));
      gl.uniform2f(u.u_scale, layout.scale, layout.scale);
      gl.uniform2f(u.u_off, layout.ox, layout.oy);
      gl.uniform2f(u.u_pan, this.pan.x, this.pan.y);
      gl.uniform2f(u.u_size, this.cssW, this.cssH);
      gl.uniform2f(u.u_depth, layout.minD, layout.invD);
    }

    drawMesh(layout) {
      const gl = this.gl;
      gl.useProgram(this.prog);
      this.setCommon(gl, this.uniforms, layout);
      gl.uniform1i(this.uniforms.u_heights, 0);
      gl.uniform1i(this.uniforms.u_ramp, 1);
      gl.uniform1i(this.uniforms.u_sat, 2);
      gl.uniform1f(this.uniforms.u_satOn, this.satReady ? 1.0 : 0.0);
      gl.uniform1f(this.uniforms.u_raw, this.rawSize);
      const t = this.texTerrain;
      const wHalf = (this.windowSize || this.rawSize) / 2;
      gl.uniform2f(this.uniforms.u_uv0,
        (wHalf + (t ? t.winX : this.windowSize / 2)) / this.rawSize,
        (wHalf + (t ? t.winY : this.windowSize / 2)) / this.rawSize);
      gl.uniform2f(this.uniforms.u_texel, 1 / this.rawSize, 1 / this.rawSize);
      gl.uniform1f(this.uniforms.u_vertical, this.vertical);
      gl.uniform3f(this.uniforms.u_light, LIGHT[0], LIGHT[1], LIGHT[2]);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.satReady ? this.satTex : this.rampTex);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      bindAttribs(gl, gl, this.posLoc);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);
    }

    drawSea(layout) {
      const gl = this.gl;
      const t = this.texTerrain;
      const range = Math.max(1, t.max - t.min);
      const seaHn = (0 - t.min) / range;
      if (seaHn <= 0) return;

      gl.useProgram(this.seaProg);
      this.setCommon(gl, this.seaUniforms, layout);
      gl.uniform1f(this.seaUniforms.u_seaH, seaHn * this.vertical - 0.35);
      gl.uniform4f(this.seaUniforms.u_color, SEA_COLOR[0], SEA_COLOR[1], SEA_COLOR[2], 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.seaBuf);
      bindAttribs(gl, gl, this.seaPosLoc);
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
      if (t !== this.texTerrain || (t.revision || 0) !== this.lastRev) {
        this.buildTerrain(t);
        this.lastRev = t.revision || 0;
      }
      if (!this.heightTex) return;
      let want = Math.max(2, Math.min(this.size, t.rawSize));
      if (!this.useUintExt && want > 256) want = 256;
      if (want !== this.gridS || this.gridWin !== this.windowSize) this.buildGrid(want);
      if (!this.gridS) return;

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      const layout = this.computeLayout();
      this.layout = layout;
      if (this.seaLevel) this.drawSea(layout);
      this.drawMesh(layout);
    }
  }

  global.WebGLRenderer = WebGLRenderer;
}(window));