(function () {
  'use strict';

  const statusEl = document.getElementById('status');
  const zoomEl = document.getElementById('zoom');
  const resEl = document.getElementById('res');
  const resVal = document.getElementById('res-val');
  const scaleEl = document.getElementById('scale');
  const scaleVal = document.getElementById('scale-val');
  const verticalEl = document.getElementById('vertical');
  const verticalVal = document.getElementById('vertical-val');
  const yawEl = document.getElementById('yaw');
  const yawVal = document.getElementById('yaw-val');
  const rotateEl = document.getElementById('rotate');
  const waterEl = document.getElementById('water');
  const satEl = document.getElementById('sat');
  const kindEl = document.getElementById('rkind');
  const placesEl = document.getElementById('rp');
  const savePlaceEl = document.getElementById('save-place');
  const forgetPlaceEl = document.getElementById('forget-place');
  const placeSearchEl = document.getElementById('place-search');
  const searchGoEl = document.getElementById('search-go');
  const searchResultsEl = document.getElementById('search-results');
  const searchPickEl = document.getElementById('search-pick');
  const hudEl = document.getElementById('hud');
  const hudToggleEl = document.getElementById('hud-toggle');

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

  // On narrow screens the toolbar is a slide-in drawer; keep it in sync with
  // the toggle button. On desktop these classes have no visual effect.
  function setHudOpen(open) {
    hudEl.classList.toggle('open', !!open);
    hudToggleEl.classList.toggle('open', !!open);
    hudToggleEl.setAttribute('aria-expanded', String(!!open));
    hudToggleEl.textContent = open ? '\u2715' : '\u2630';
  }

  // --- Places: an ever-growing list of bookmarked views to jump back to ---
  const BUILTIN_PLACES = [
    { id: 'torres-del-paine', name: 'Torres del Paine, Patagonia', zoom: 13, texX: 622272, texY: 1393133, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'ojos-del-salado', name: 'Ojos del Salado, Chile\'s Highest', zoom: 12, texX: 324643, texY: 606373, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'licancabur', name: 'Licancabur & Atacama Altiplano', zoom: 12, texX: 326564, texY: 592628, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'villarrica', name: 'Villarrica Volcano, Lake District', zoom: 12, texX: 314748, texY: 649411, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'cerro-san-valentin', name: 'Cerro San Valentín, Patagonia', zoom: 13, texX: 621301, texY: 1356124, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'central-chile', name: 'Central Chile: Coast Range → Andes', zoom: 10, texX: 78934, texY: 159837, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'grand-canyon', name: 'Grand Canyon, Arizona', zoom: 13, texX: 395333, texY: 822237, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'mount-fuji', name: 'Mount Fuji, Japan', zoom: 12, texX: 928372, texY: 414046, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'mount-everest', name: 'Mount Everest, Himalaya', zoom: 12, texX: 777468, texY: 439323, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'matterhorn', name: 'Matterhorn, Alps', zoom: 13, texX: 1093191, texY: 746283, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'denali', name: 'Denali, Alaska', zoom: 12, texX: 84448, texY: 285732, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'mauna-kea', name: 'Mauna Kea, Hawaii', zoom: 12, texX: 71454, texY: 465369, vertical: 80, yaw: 0, seaLevel: true },
    { id: 'k2', name: 'K2, Karakoram', zoom: 12, texX: 747149, texY: 412184, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'kilimanjaro', name: 'Kilimanjaro, Tanzania', zoom: 12, texX: 633094, texY: 533227, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'aconcagua', name: 'Aconcagua, Argentina', zoom: 12, texX: 320365, texY: 625008, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'milford-sound', name: 'Milford Sound, New Zealand', zoom: 13, texX: 2026839, texY: 1340056, vertical: 80, yaw: 0, seaLevel: true },
    { id: 'nanga-parbat', name: 'Nanga Parbat, Pakistan', zoom: 12, texX: 741546, texY: 414494, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'annapurna', name: 'Annapurna I, Nepal', zoom: 12, texX: 768431, texY: 437306, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'mont-blanc', name: 'Mont Blanc, France/Italy', zoom: 12, texX: 544284, texY: 373744, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'mount-rainier', name: 'Mount Rainier, Washington', zoom: 12, texX: 169635, texY: 369442, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'teide', name: 'Teide, Tenerife', zoom: 12, texX: 475814, texY: 438377, vertical: 80, yaw: 0, seaLevel: true },
    { id: 'elbrus', name: 'Mount Elbrus, Russia', zoom: 12, texX: 647901, texY: 383889, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'puncak-jaya', name: 'Puncak Jaya, New Guinea', zoom: 12, texX: 923863, texY: 536192, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'damavand', name: 'Damavand, Iran', zoom: 12, texX: 676066, texY: 411937, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'chimborazo', name: 'Chimborazo, Ecuador', zoom: 12, texX: 294714, texY: 528567, vertical: 80, yaw: 0, seaLevel: false },
    { id: 'grand-teton', name: 'Grand Teton, Wyoming', zoom: 13, texX: 403105, texY: 764657, vertical: 80, yaw: 0, seaLevel: false }
  ];
  const STORE_KEY = 'isoworld.places.v1';
  let savedPlaces = [];
  const placeById = new Map();

  function loadPlaces() {
    savedPlaces = [];
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) savedPlaces = arr;
      }
    } catch (err) { /* corrupt store: start fresh */ }
  }

  function persistPlaces() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(savedPlaces));
    } catch (err) { /* storage unavailable: keep in-memory only */ }
  }

  function populatePlaces() {
    placeById.clear();
    placesEl.length = 0;
    const pick = document.createElement('option');
    pick.value = '';
    pick.textContent = '— pick a place —';
    pick.selected = true;
    placesEl.add(pick);
    BUILTIN_PLACES.forEach(function (p) {
      placeById.set(p.id, p);
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      placesEl.add(o);
    });
    const group = document.createElement('optgroup');
    group.label = 'Saved';
    savedPlaces.forEach(function (p) {
      placeById.set(p.id, p);
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      group.appendChild(o);
    });
    placesEl.add(group);
  }

  function applyPlace() {
    const p = placeById.get(placesEl.value);
    if (!p || !active) return;
    if (p.zoom != null) {
      state.zoom = p.zoom;
      zoomEl.value = String(p.zoom);
    }
    if (p.vertical != null) {
      verticalEl.value = String(p.vertical);
      verticalVal.textContent = String(p.vertical);
      active.vertical = p.vertical;
    }
    if (p.yaw != null) {
      yawEl.value = String(p.yaw);
      yawVal.textContent = String(p.yaw);
      active.yaw = (p.yaw * Math.PI) / 180;
    }
    if (typeof p.seaLevel === 'boolean') {
      waterEl.checked = p.seaLevel;
      active.seaLevel = p.seaLevel;
    }
    if (p.texX != null && p.texY != null) {
      gotoPosition(p.zoom, p.texX, p.texY);
    } else {
      loadWorld();
    }
  }

  // Center the view, in world-texel coordinates at the given zoom, exactly on a
  // point (a place bookmark or a geocoded location).
  function gotoPosition(zoom, texX, texY) {
    const n = 1 << zoom;
    state.zoom = zoom;
    zoomEl.value = String(zoom);
    state.cx = texX / (n * 256);
    state.cy = texY / (n * 256);
    setHudOpen(false);
    loadWorld().then(function () {
      const t = active && active.terrain;
      if (!t) return;
      // restore the exact (possibly mid-drag) window position
      t.setWinClamped(texX - t.windowSize / 2, texY - t.windowSize / 2);
      const c = t.windowCenter();
      state.cx = c.cx;
      state.cy = c.cy;
      bumpStatus();
      scheduleRender();
    }).catch(function (err) {
      setStatus('Could not load location: ' + err.message, 'error');
    });
  }

  // --- Geocoding search: OpenStreetMap Nominatim → lat/lon → view ---
  function latToMercY(latDeg) {
    const r = latDeg * Math.PI / 180;
    return 0.5 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / (2 * Math.PI);
  }

  // Pick the smallest zoom whose 2×2-tile window fits the result bounding box,
  // with a little margin so the place is not cropped at the view edges.
  function fitZoomToBBox(bb) {
    const south = Number(bb[0]);
    const north = Number(bb[1]);
    const west = Number(bb[2]);
    const east = Number(bb[3]);
    const lngSpan = Math.abs(east - west);
    const mercSpan = Math.abs(latToMercY(south) - latToMercY(north));
    const margin = 1.3;
    const zLng = Math.ceil(Math.log2(720 / (lngSpan * margin)));
    const zLat = Math.ceil(Math.log2(2 / (mercSpan * margin)));
    return Math.max(3, Math.min(13, Math.max(zLng, zLat)));
  }

  let searchHits = [];
  let searchToken = 0;

  function jumpToHit(hit) {
    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    const bb = hit.boundingbox || [lat, lat, lon, lon];
    const zoom = fitZoomToBBox(bb);
    const n = 1 << zoom;
    const W = n * 256;
    const texX = Math.round(((lon + 180) / 360) * W);
    const texY = Math.round(latToMercY(lat) * W);
    setStatus('Search: ' + hit.display_name);
    gotoPosition(zoom, texX, texY);
  }

  function fillSearchPick(hits) {
    searchPickEl.length = 0;
    hits.forEach(function (h, i) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = h.display_name;
      searchPickEl.add(o);
    });
  }

  function geocodeSearch() {
    const q = placeSearchEl.value.trim();
    if (!q) return;
    const token = ++searchToken;
    setStatus('Searching "' + q + '"…');
    fetch('https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({ q: q, format: 'jsonv2', limit: '5' }), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('geocoding failed (' + res.status + ')');
        return res.json();
      })
      .then(function (hits) {
        if (token !== searchToken) return;
        searchHits = hits || [];
        if (!searchHits.length) {
          searchResultsEl.hidden = true;
          setStatus('No matches for "' + q + '"', 'error');
          return;
        }
        fillSearchPick(searchHits);
        searchResultsEl.hidden = false;
        jumpToHit(searchHits[0]);
      })
      .catch(function (err) {
        if (token !== searchToken) return;
        searchResultsEl.hidden = true;
        setStatus('Search error: ' + err.message, 'error');
      });
  }

  function saveCurrentPlace() {
    const t = active && active.terrain;
    if (!t || !t.raw) return;
    const c = t.windowCenter();
    const n = 1 << t.zoom;
    const texX = Math.round(c.cx * n * 256);
    const texY = Math.round(c.cy * n * 256);
    const name = (window.prompt('Name for this place', 'Place ' + (savedPlaces.length + 1)) || '').trim();
    if (!name) return;
    const id = 'u' + Date.now().toString(36);
    savedPlaces.push({
      id: id,
      name: name,
      zoom: t.zoom,
      texX: texX,
      texY: texY,
      vertical: active.vertical,
      yaw: ((Math.round(active.yaw * 180 / Math.PI) % 360) + 360) % 360,
      seaLevel: active.seaLevel
    });
    persistPlaces();
    populatePlaces();
    placesEl.value = id;
    setStatus('Saved place: ' + name, 'ok');
  }

  function forgetSelectedPlace() {
    const p = placeById.get(placesEl.value);
    if (!p || BUILTIN_PLACES.some(function (b) { return b.id === p.id; })) {
      setStatus('Pick a user-saved place to forget', '');
      return;
    }
    if (!window.confirm('Forget "' + p.name + '"?')) return;
    savedPlaces = savedPlaces.filter(function (s) { return s.id !== p.id; });
    persistPlaces();
    populatePlaces();
    const last = savedPlaces[savedPlaces.length - 1];
    placesEl.value = last ? last.id : '';
    setStatus('Forgot place: ' + p.name, 'ok');
  }

  function reflectControls() {
    resVal.textContent = resEl.value;
    scaleVal.textContent = scaleEl.value + '%';
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
    to.zoomFactor = from.zoomFactor;
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
    setHudOpen(false);
    loadWorld();
  });

  resEl.addEventListener('input', function () {
    resVal.textContent = resEl.value;
    active.size = Number(resEl.value);
    active.grid = null;
    scheduleRender();
  });
  scaleEl.addEventListener('input', function () {
    scaleVal.textContent = scaleEl.value + '%';
    if (active) active.zoomFactor = Number(scaleEl.value) / 100;
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

  placesEl.addEventListener('change', applyPlace);
  savePlaceEl.addEventListener('click', saveCurrentPlace);
  forgetPlaceEl.addEventListener('click', forgetSelectedPlace);

  searchGoEl.addEventListener('click', geocodeSearch);
  placeSearchEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      geocodeSearch();
    }
  });
  searchPickEl.addEventListener('change', function () {
    const h = searchHits[Number(searchPickEl.value)];
    if (h) jumpToHit(h);
  });

  hudToggleEl.addEventListener('click', function () {
    setHudOpen(!hudEl.classList.contains('open'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && hudEl.classList.contains('open')) setHudOpen(false);
  });

  // In-app documentation: renders README.md (markdown.js) in a full-screen
  // overlay with a table of contents; deep-linkable at #docs/readme.
  const docs = new Docs({
    onOpen: function () { setHudOpen(false); }
  });
  docs.fromHash();

  window.addEventListener('resize', scheduleRender);
  window.addEventListener('load', function () {
    reflectControls();
    loadPlaces();
    populatePlaces();
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
    if (e.target === canvas && hudEl.classList.contains('open')) setHudOpen(false);
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