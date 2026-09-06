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

  let active = null;

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
  }

  function setRenderer(kind) {
    const canvas = makeCanvas();
    const next = createRenderer(kind, canvas);
    if (active) copyState(active, next);
    active = next;
    scheduleRender();
    return next;
  }

  let loading = false;

  async function loadWorld() {
    if (loading) return;
    if (!active) return;
    loading = true;

    const zoom = Number(zoomEl.value);
    active.size = Number(resEl.value);
    active.vertical = Number(verticalEl.value);
    active.yaw = (Number(yawEl.value) * Math.PI) / 180;

    setStatus('Loading ' + (1 << (zoom * 2)) + ' tile(s) at zoom ' + zoom + '…');
    try {
      const terrain = new Terrain();
      await terrain.load(zoom, function (done, total) {
        if (total > 1) setStatus('Fetching tiles ' + done + '/' + total + '…');
      });
      active.terrain = terrain;
      active.grid = null;
      active.render();
      setStatus(
        'Done. Elevation range ' + terrain.min.toFixed(0) + ' to ' + terrain.max.toFixed(0) + ' m',
        'ok'
      );
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    }
    loading = false;
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

  zoomEl.addEventListener('change', loadWorld);
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