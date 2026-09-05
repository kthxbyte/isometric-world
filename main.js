(function () {
  'use strict';

  const canvas = document.getElementById('view');
  const renderer = new Renderer(canvas);

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
      renderer.render();
    });
  }

  let loading = false;

  async function loadWorld() {
    if (loading) return;
    loading = true;

    const zoom = Number(zoomEl.value);
    renderer.size = Number(resEl.value);
    renderer.vertical = Number(verticalEl.value);
    renderer.yaw = (Number(yawEl.value) * Math.PI) / 180;

    setStatus('Loading ' + (1 << (zoom * 2)) + ' tile(s) at zoom ' + zoom + '…');
    try {
      const terrain = new Terrain();
      await terrain.load(zoom, function (done, total) {
        if (total > 1) setStatus('Fetching tiles ' + done + '/' + total + '…');
      });
      renderer.terrain = terrain;
      renderer.grid = null;
      renderer.render();
      setStatus(
        'Done. Elevation range ' + terrain.min.toFixed(0) + ' to ' + terrain.max.toFixed(0) + ' m',
        'ok'
      );
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    }
    loading = false;
  }

  zoomEl.addEventListener('change', loadWorld);
  resEl.addEventListener('input', function () {
    resVal.textContent = resEl.value;
    renderer.size = Number(resEl.value);
    renderer.grid = null;
    scheduleRender();
  });
  verticalEl.addEventListener('input', function () {
    verticalVal.textContent = verticalEl.value;
    renderer.vertical = Number(verticalEl.value);
    scheduleRender();
  });
  yawEl.addEventListener('input', function () {
    yawVal.textContent = yawEl.value;
    renderer.yaw = (Number(yawEl.value) * Math.PI) / 180;
    scheduleRender();
  });
  waterEl.addEventListener('change', function () {
    renderer.seaLevel = waterEl.checked;
    scheduleRender();
  });

  window.addEventListener('resize', scheduleRender);
  window.addEventListener('load', function () {
    reflectControls();
    renderer.resize();
    loadWorld();
  });

  function tick() {
    if (rotateEl.checked) {
      let deg = (renderer.yaw * 180) / Math.PI % 360;
      deg = (deg + 0.3) % 360;
      yawEl.value = Math.round(deg);
      yawVal.textContent = yawEl.value;
      renderer.yaw = (deg * Math.PI) / 180;
      scheduleRender();
    }
    requestAnimationFrame(tick);
  }
  tick();
}());
