(function () {
  'use strict';

  const statusEl = document.getElementById('status');
  const zoomEl = document.getElementById('zoom');
  const resEl = document.getElementById('res');
  const resVal = document.getElementById('res-val');
  const verticalEl = document.getElementById('vertical');
  const verticalVal = document.getElementById('vertical-val');
  const yawEl = document.getElementById('yaw');
  const yawVal = document.getElementById('yaw-val');
  const rotateEl = document.getElementById('rotate');
  const waterEl = document.getElementById('water');
  const satEl = document.getElementById('sat');
  const kindEl = document.getElementById('rkind');

  const state = { zoom: 1, cx: 0.5, cy: 0.5 };

  let active = null;
  let reqId = 0;

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function centerToLonLat(cx, cy) {
    const lon = (cx - 0.5) * 360;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180 / Math.PI;
    return { lon: lon, lat: lat };
  }

  function fmtPos(cx, cy) {
    const p = centerToLonLat(cx, cy);
    return p.lat.toFixed(2) + '°, ' + p.lon.toFixed(2) + '°';
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || '';
  }

  function reflectControls() {
    resVal.textContent = resEl.value;
    verticalVal.textContent = verticalEl.value;
    yawVal.textContent = yawEl.value;
  }

  function scheduleRender() {
    cancelAnimationFrame(scheduleRender._raf);
    scheduleRender._raf = requestAnimationFrame(function () {
      if (active) active.render();
    });
  }

  // Convert a pointer delta (CSS px) into the world-texel delta of the visible
  // window, using the inverse of the iso projection matrix for the current yaw:
  //   M = s * [ COL(ca-sa)  -COL(sa+ca) ; ROW(sa+ca)  ROW(ca-sa) ]
  function pxToWin(dx, dy) {
    const s = active ? active.screenScale() : 0;
    if (!s || s <= 0) return { x: 0, y: 0 };
    const ca = Math.cos(active.yaw);
    const sa = Math.sin(active.yaw);
    const a = (ca - sa) * ISO_COL;
    const b = (sa + ca) * ISO_COL;
    const c = (sa + ca) * ISO_ROW;
    const d = (ca - sa) * ISO_ROW;
    const det = s * (a * d + c * b);
    if (det === 0) return { x: 0, y: 0 };
    return {
      x: (d * dx + b * dy) / det,
      y: (-c * dx + a * dy) / det
    };
  }

  let strideBusy = false;

  // Recompose the composition (shift by one tile and stream in the entering
  // strip) so the visible window keeps flowing across fresh tiles.
  function strideIfNeeded() {
    const t = active && active.terrain;
    if (!t || !t.raw) return;
    for (let guard = 0; guard < 2 * t.compTiles; guard++) {
      const need = t.strideNeeded();
      if (!need) break;
      if (t.tryStride(need.axis, need.dir)) continue;
      if (strideBusy) return;
      strideBusy = true;
      const id = reqId;
      const terrain = t;
      const axis = need.axis;
      const dir = need.dir;
      t.stride(axis, dir).then(function () {
        strideBusy = false;
        if (id !== reqId || active.terrain !== terrain) return;
        afterStride(terrain);
      }).catch(function (err) {
        strideBusy = false;
        if (id !== reqId || active.terrain !== terrain) return;
        setStatus('Tile stream error: ' + err.message, 'error');
      });
      return;
    }
    afterStride(t);
  }

  function afterStride(t) {
    refreshSatellite();
    bumpStatus();
    scheduleRender();
  }

  function refreshSatellite() {
    if (!satEl.checked || !active || active.kind !== 'webgl' || !active.terrain) return;
    const t = active.terrain;
    loadSatelliteTiles(t.zoom, t.compOriginX, t.compOriginY, t.compTiles)
      .then(function (data) {
        if (active.terrain === t && active.setSatellite) {
          active.setSatellite(data);
          scheduleRender();
        }
      })
      .catch(function () {
        if (active.terrain === t && active.setSatellite) {
          active.setSatellite(null);
        }
      });
  }

  let lastPreloadAt = 0;
  function maybePreload() {
    const t = active && active.terrain;
    if (!t || !t.raw) return;
    const now = Date.now();
    if (now - lastPreloadAt < 300) return;
    lastPreloadAt = now;
    const c = t.windowCenter();
    const n = 1 << t.zoom;
    const size = Math.min(n, 4);
    const maxOrigin = Math.max(0, n - size);
    preloadWindow(t.zoom,
      clamp(Math.floor(c.cx * n) - 2, 0, maxOrigin),
      clamp(Math.floor(c.cy * n) - 2, 0, maxOrigin),
      size, satEl.checked);
  }

  function makeCanvas() {
    const old = document.getElementById('view');
    if (old) old.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'view';
    document.body.insertBefore(canvas, document.getElementById('hud'));
    return canvas;
  }

  function createRenderer(kind, canvas) {
    let renderer;
    if (kind === 'webgl') {
      renderer = new WebGLRenderer(canvas);
      if (!renderer.available) {
        throw new Error('WebGL is not supported by this browser');
      }
    } else {
      renderer = new Renderer(canvas);
    }
    renderer.kind = kind;
    return renderer;
  }

  function copyState(from, to) {
    to.terrain = from.terrain;
    to.grid = from.grid;
    to.gridSize = from.gridSize;
    to.size = from.size;
    to.vertical = from.vertical;
    to.yaw = from.yaw;
    to.seaLevel = from.seaLevel;
    to.pan = { x: from.pan ? from.pan.x : 0, y: from.pan ? from.pan.y : 0 };
  }

  function setRenderer(kind) {
    const canvas = makeCanvas();
    const next = createRenderer(kind, canvas);
    if (active) copyState(active, next);
    active = next;
    scheduleRender();
    return next;
  }

  function terrainSummary(t) {
    const c = t.windowCenter();
    return t.window + '×' + t.window + ' view @ zoom ' + t.zoom +
      ' (win ' + Math.floor(t.worldWinX()) + ',' + Math.floor(t.worldWinY()) +
      ' · ' + t.compTiles + '×' + t.compTiles + ' comp) · elevation ' +
      t.min.toFixed(0) + '…' + t.max.toFixed(0) + ' m · ' + fmtPos(c.cx, c.cy);
  }

  function bumpStatus() {
    if (!active || !active.terrain) return;
    setStatus(terrainSummary(active.terrain), 'ok');
  }

  function loadSatellite() {
    if (!active || !active.terrain || !satEl.checked || active.kind !== 'webgl') return;
    const t = active.terrain;
    setStatus('Loading satellite imagery…');
    loadSatelliteTiles(t.zoom, t.compOriginX, t.compOriginY, t.compTiles)
      .then(function (data) {
        if (active.terrain !== t || !satEl.checked || active.kind !== 'webgl') return;
        active.setSatellite(data);
        scheduleRender();
        bumpStatus();
      })
      .catch(function () {
        if (active.terrain !== t || !satEl.checked || active.kind !== 'webgl') return;
        active.setSatellite(null);
        setStatus('Satellite imagery unavailable; using terrain ramp', 'ok');
      });
  }

  async function loadWorld() {
    if (!active) return;
    strideBusy = false;
    const id = ++reqId;
    const zoom = state.zoom;

    const rect = terrainWindow(zoom, state.cx, state.cy);
    setStatus('Loading ' + rect.w + '×' + rect.w + ' tile view at zoom ' + zoom + '…');
    try {
      const terrain = new Terrain();
      await terrain.load(zoom, state.cx, state.cy, function (done, total) {
        if (total > 1) setStatus('Fetching tiles ' + done + '/' + total + '…');
      });
      if (id !== reqId) return;

      active.terrain = terrain;
      active.grid = null;

      resEl.max = String(terrain.rawSize);
      if (active.kind === 'webgl') {
        resEl.value = String(terrain.rawSize);
        reflectControls();
        active.size = terrain.rawSize;
      }
      if (active.gridWindowChange) active.gridWindowChange = true;
      if (active.gridWin !== undefined) active.gridWin = 0;

      const c = terrain.windowCenter();
      state.cx = c.cx;
      state.cy = c.cy;

      active.render();
      bumpStatus();
      if (satEl.checked) loadSatellite();
    } catch (err) {
      if (id !== reqId) return;
      setStatus('Error: ' + err.message, 'error');
    }
  }

  kindEl.addEventListener('change', function () {
    const kind = kindEl.value;
    if (active && active.kind === kind) return;
    try {
      setRenderer(kind);
      if (satEl.checked && active.terrain && active.kind === 'webgl') loadSatellite();
    } catch (err) {
      setStatus('Renderer error: ' + err.message, 'error');
      kindEl.value = '2d';
      if (!(active && active.kind === '2d')) setRenderer('2d');
    }
  });

  zoomEl.addEventListener('change', function () {
    state.zoom = Number(zoomEl.value);
    loadWorld();
  });

  resEl.addEventListener('input', function () {
    resVal.textContent = resEl.value;
    active.size = Number(resEl.value);
    active.grid = null;
    scheduleRender();
  });
  verticalEl.addEventListener('input', function () {
    verticalVal.textContent = verticalEl.value;
    active.vertical = Number(verticalEl.value);
    scheduleRender();
  });
  yawEl.addEventListener('input', function () {
    yawVal.textContent = yawEl.value;
    active.yaw = (Number(yawEl.value) * Math.PI) / 180;
    scheduleRender();
  });
  waterEl.addEventListener('change', function () {
    active.seaLevel = waterEl.checked;
    scheduleRender();
  });
  satEl.addEventListener('change', function () {
    if (!active) return;
    if (satEl.checked) {
      loadSatellite();
    } else {
      if (active.setSatellite) active.setSatellite(null);
      scheduleRender();
    }
  });

  window.addEventListener('resize', scheduleRender);
  window.addEventListener('load', function () {
    reflectControls();
    kindEl.value = 'webgl';
    try {
      setRenderer(kindEl.value);
    } catch (err) {
      kindEl.value = '2d';
      setRenderer('2d');
    }
    loadWorld();
  });

  let drag = null;

  function onPointerDown(e) {
    if (!active || drag) return;
    const canvas = document.getElementById('view');
    if (e.target !== canvas) return;
    const t = active.terrain;
    if (!t || !t.raw) return;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      winX: t.worldWinX(),
      winY: t.worldWinY()
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const inv = pxToWin(e.clientX - drag.x, e.clientY - drag.y);
    const t = active.terrain;
    t.setWinClamped(drag.winX - inv.x, drag.winY - inv.y);
    const c = t.windowCenter();
    state.cx = c.cx;
    state.cy = c.cy;
    strideIfNeeded();
    maybePreload();
    scheduleRender();
    bumpStatus();
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    strideIfNeeded();
    maybePreload();
    scheduleRender();
    bumpStatus();
  }

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

  function tick() {
    if (rotateEl.checked && active) {
      let deg = (active.yaw * 180) / Math.PI % 360;
      deg = (deg + 0.3) % 360;
      yawEl.value = Math.round(deg);
      yawVal.textContent = yawEl.value;
      active.yaw = (deg * Math.PI) / 180;
      scheduleRender();
    }
    requestAnimationFrame(tick);
  }
  tick();
}());