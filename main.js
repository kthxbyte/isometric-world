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
  const kindEl = document.getElementById('rkind');

  const state = { zoom: 1, cx: 0.5, cy: 0.5 };
  const panPx = { x: 0, y: 0 };

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

  function worldPerPx() {
    return 1 / ((1 << state.zoom) * TILE_SIZE);
  }

  function resetPan() {
    panPx.x = 0;
    panPx.y = 0;
    if (active) active.pan = { x: 0, y: 0 };
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

  async function loadWorld() {
    if (!active) return;
    const id = ++reqId;
    const zoom = state.zoom;

    resetPan();

    const rect = terrainWindow(zoom, state.cx, state.cy);
    setStatus('Loading ' + rect.w + '×' + rect.w + ' tile(s) at zoom ' + zoom + '…');
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

      active.render();
      setStatus(
        rect.w + '×' + rect.w + ' tiles @ zoom ' + zoom +
        ' (x' + terrain.originX + ',y' + terrain.originY + ') · elevation ' +
        terrain.min.toFixed(0) + '…' + terrain.max.toFixed(0) + ' m · ' + fmtPos(state.cx, state.cy),
        'ok'
      );
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
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      cx: state.cx,
      cy: state.cy,
      panX: panPx.x,
      panY: panPx.y
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const px = drag.panX + (e.clientX - drag.x);
    const py = drag.panY + (e.clientY - drag.y);
    panPx.x = px;
    panPx.y = py;
    if (active.screenScale() > 0) {
      const k = worldPerPx() / active.screenScale();
      state.cx = clamp01(drag.cx - px * k);
      state.cy = clamp01(drag.cy - py * k);
    }
    if (active) active.pan = { x: px, y: py };
    scheduleRender();
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const px = drag.panX + (e.clientX - drag.x);
    const py = drag.panY + (e.clientY - drag.y);
    const k = active.screenScale() > 0 ? worldPerPx() / active.screenScale() : 0;
    const prevRect = terrainWindow(state.zoom, drag.cx, drag.cy);
    const nextRect = terrainWindow(state.zoom, clamp01(drag.cx - px * k), clamp01(drag.cy - py * k));
    const crossed = prevRect.x0 !== nextRect.x0 || prevRect.y0 !== nextRect.y0;
    drag = null;
    if (crossed) {
      state.cx = clamp01(state.cx);
      state.cy = clamp01(state.cy);
      loadWorld();
    } else {
      panPx.x = px;
      panPx.y = py;
      active.pan = { x: px, y: py };
      scheduleRender();
    }
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