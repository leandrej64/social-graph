const DATA_DIR = 'data';

const DESIRED_SPACE_SIZE = 16000;
function detectMaxSpaceSize() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const max = gl && gl.getParameter(gl.MAX_TEXTURE_SIZE);
    return Number.isFinite(max) && max > 0 ? max : 8192;
  } catch {
    return 8192;
  }
}
const SPACE_SIZE = Math.max(4096, Math.min(DESIRED_SPACE_SIZE, detectMaxSpaceSize() - 1024));
let filtersData = null;
let edges = null;
let graph = null;
let viewState = null;
let renderId = 0;
let simDone = false;

const END_ZOOM_FACTOR = 0.8;
const END_CAMERA_MS = 400;
let recenteredFor = -1;

const CATEGORICAL_PALETTE = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  '#b54fd8',
];
const OTHER_COLOR = '#6b6b6b';
const UNKNOWN_COLOR_RGBA = [0.55, 0.55, 0.55, 0.35];
const DIM_COLOR_RGBA = [0.5, 0.5, 0.5, 0.08];

function hexToRgba(hex, alpha) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
    alpha,
  ];
}

Promise.all([
  fetch(`${DATA_DIR}/filters.json`).then(r => r.json()),
  fetch(`${DATA_DIR}/graph_edges.bin`).then(r => r.arrayBuffer()),
]).then(([filters, edgeBuffer]) => {
  filtersData = filters;
  edges = new Int32Array(edgeBuffer);
  document.getElementById('status').textContent =
    `Loaded: ${filters.node_count.toLocaleString()} profiles, ${(edges.length/2).toLocaleString()} edges`;
  buildPanel(filters);
  applyDefaultFilters();
  setTimeout(initInference, 0);
});

function applyDefaultFilters() {
  const defaults = [
    'f:city:US:los_angeles', 'f:city:US:san_diego', 'f:city:US:san_francisco', 'f:city:US:new_york','f:city:US:seattle','f:city:US:chicago',
    'f:city:DE:berlin', 'f:city:DE:hamburg', 'f:city:DE:munich',
  ];
  for (const id of defaults) {
    const box = document.getElementById(id);
    if (box) box.checked = true;
  }
  document.getElementById('hide-isolated').checked = true;
  applyFilters();
}

function countSpan(count) {
  const s = document.createElement('span');
  s.className = 'count';
  s.textContent = `(${count.toLocaleString()})`;
  return s;
}

function checkbox(id, label, count) {
  const wrap = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = id;
  wrap.appendChild(cb);
  wrap.append(`${label} `, countSpan(count));
  return wrap;
}

function buildPanel(filters) {
  const panel = document.getElementById('panel');
  panel.innerHTML = '';

  panel.appendChild(buildExploreControl());

  const title = document.createElement('h2');
  title.textContent = 'Filters';
  panel.appendChild(title);

  panel.appendChild(checkbox('f:unknown', filters.unknown.label, filters.unknown.indices.length));

  const others = {};
  for (const [code, entry] of Object.entries(filters.countries)) {
    if (filters.highlighted.includes(code)) continue;
    others[code] = entry;
  }

  for (const code of filters.highlighted) {
    const entry = filters.countries[code];
    const section = document.createElement('div');
    section.className = 'highlighted';
    const h3 = document.createElement('h3');
    h3.appendChild(checkboxInline(`f:country:${code}`, entry.label, entry.indices.length));
    section.appendChild(h3);

    const cityEntries = Object.entries(entry.cities);
    const [firstSlug, firstCity] = cityEntries[0];
    section.appendChild(checkbox(`f:city:${code}:${firstSlug}`, firstCity.label, firstCity.indices.length));

    const moreToggle = document.createElement('span');
    moreToggle.className = 'more-toggle';
    moreToggle.textContent = '▸ Show more';
    section.appendChild(moreToggle);

    const cols = document.createElement('div');
    cols.className = 'columns more-content';

    const cityCol = document.createElement('div');
    const cityH4 = document.createElement('h4');
    cityH4.textContent = 'Cities';
    cityCol.appendChild(cityH4);
    for (const [slug, city] of cityEntries.slice(1)) {
      cityCol.appendChild(checkbox(`f:city:${code}:${slug}`, city.label, city.indices.length));
    }
    cols.appendChild(cityCol);

    if (entry.states) {
      const stateCol = document.createElement('div');
      const stateH4 = document.createElement('h4');
      stateH4.textContent = 'States';
      stateCol.appendChild(stateH4);
      for (const [slug, state] of Object.entries(entry.states)) {
        stateCol.appendChild(checkbox(`f:state:${slug}`, state.label, state.indices.length));
      }
      cols.appendChild(stateCol);
    }

    section.appendChild(cols);
    moreToggle.addEventListener('click', () => {
      const open = cols.classList.toggle('open');
      moreToggle.textContent = (open ? '▾ ' : '▸ ') + (open ? 'Show less' : 'Show more');
    });
    panel.appendChild(section);
  }

  const othersToggle = document.createElement('span');
  othersToggle.id = 'others-toggle';
  othersToggle.textContent = '▸ Others';
  panel.appendChild(othersToggle);

  const othersContent = document.createElement('div');
  othersContent.id = 'others-content';
  for (const [code, entry] of Object.entries(others)) {
    const h3 = document.createElement('h3');
    h3.appendChild(checkboxInline(`f:country:${code}`, entry.label, entry.indices.length));
    othersContent.appendChild(h3);
    for (const [slug, city] of Object.entries(entry.cities)) {
      const l = checkbox(`f:city:${code}:${slug}`, city.label, city.indices.length);
      l.style.paddingLeft = '12px';
      othersContent.appendChild(l);
    }
  }
  panel.appendChild(othersContent);

  othersToggle.addEventListener('click', () => {
    const open = othersContent.classList.toggle('open');
    othersToggle.textContent = (open ? '▾ ' : '▸ ') + 'Others';
  });

  const isolatedWrap = document.createElement('label');
  isolatedWrap.style.marginTop = '16px';
  const isolatedCb = document.createElement('input');
  isolatedCb.type = 'checkbox';
  isolatedCb.id = 'hide-isolated';
  isolatedWrap.appendChild(isolatedCb);
  isolatedWrap.append('Hide frontier nodes');
  panel.appendChild(isolatedWrap);

  const applyBtn = document.createElement('button');
  applyBtn.id = 'apply-btn';
  applyBtn.textContent = 'Update graph';
  applyBtn.addEventListener('click', applyFilters);
  panel.appendChild(applyBtn);
}

function checkboxInline(id, label, count) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = id;
  const frag = document.createDocumentFragment();
  frag.appendChild(cb);
  frag.append(` ${label} `, countSpan(count));
  return frag;
}

function selectedGroups() {
  const groups = [];
  if (document.getElementById('f:unknown').checked) {
    groups.push({ key: 'unknown', label: filtersData.unknown.label, indices: filtersData.unknown.indices, isUnknown: true, level: 3 });
  }
  for (const [code, entry] of Object.entries(filtersData.countries)) {
    const countryBox = document.getElementById(`f:country:${code}`);
    if (countryBox && countryBox.checked) {
      groups.push({ key: `country:${code}`, label: entry.label, indices: entry.indices, level: 2 });
    }
    for (const [slug, city] of Object.entries(entry.cities)) {
      const box = document.getElementById(`f:city:${code}:${slug}`);
      if (box && box.checked) {
        groups.push({ key: `city:${code}:${slug}`, label: city.label, indices: city.indices, level: 0 });
      }
    }
    if (entry.states) {
      for (const [slug, state] of Object.entries(entry.states)) {
        const box = document.getElementById(`f:state:${slug}`);
        if (box && box.checked) {
          groups.push({ key: `state:${slug}`, label: state.label, indices: state.indices, level: 1 });
        }
      }
    }
  }
  return groups;
}

let unknownMask = null;

function getUnknownMask() {
  if (!unknownMask) {
    unknownMask = new Uint8Array(filtersData.node_count);
    for (const idx of filtersData.unknown.indices) unknownMask[idx] = 1;
  }
  return unknownMask;
}

function unknownFollowedBy(seedGroups) {
  const n = filtersData.node_count;
  const unknownMask = getUnknownMask();
  const isSeed = new Uint8Array(n);
  for (const g of seedGroups) for (const idx of g.indices) isSeed[idx] = 1;

  const seen = new Uint8Array(n);
  const followed = [];
  for (let e = 0; e < edges.length; e += 2) {
    const t = edges[e + 1];
    if (isSeed[edges[e]] && unknownMask[t] && !seen[t]) { seen[t] = 1; followed.push(t); }
  }
  return followed;
}

function applyFilters() {
  const groups = selectedGroups();
  if (groups.length === 0) {
    document.getElementById('status').textContent = 'Pick at least one filter, then hit "Update graph".';
    return;
  }

  const unknownGroup = groups.find(g => g.isUnknown);
  if (unknownGroup) {
    const seedGroups = groups.filter(g => !g.isUnknown);
    if (seedGroups.length === 0) {
      document.getElementById('status').textContent =
        'Unknown Location shows the profiles followed by the selection: also pick a city, state or country.';
      return;
    }
    unknownGroup.indices = unknownFollowedBy(seedGroups);
  }

  const known = groups.filter(g => !g.isUnknown).sort((a, b) => b.indices.length - a.indices.length);
  const groupColor = {};
  const groupHex = {};
  known.forEach((g, i) => {
    const hex = i < CATEGORICAL_PALETTE.length ? CATEGORICAL_PALETTE[i] : OTHER_COLOR;
    groupColor[g.key] = hexToRgba(hex, 1);
    groupHex[g.key] = hex;
  });
  const hasUnknown = groups.some(g => g.isUnknown);

  const nodeGroup = new Map();
  for (const g of [...groups].sort((a, b) => a.level - b.level)) {
    for (const idx of g.indices) {
      if (!nodeGroup.has(idx)) nodeGroup.set(idx, g);
    }
  }

  const selectedIndices = [...nodeGroup.keys()];
  const localIndex = new Int32Array(filtersData.node_count).fill(-1);
  selectedIndices.forEach((globalIdx, i) => { localIndex[globalIdx] = i; });

  const positions = new Float32Array(selectedIndices.length * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = SPACE_SIZE / 2 + (Math.random() - 0.5) * 2000;

  const colors = new Float32Array(selectedIndices.length * 4);
  const sizes = new Float32Array(selectedIndices.length);
  selectedIndices.forEach((globalIdx, i) => {
    const g = nodeGroup.get(globalIdx);
    const c = g.isUnknown ? UNKNOWN_COLOR_RGBA : groupColor[g.key];
    colors.set(c, i * 4);
    sizes[i] = g.isUnknown ? 2 : 4;
  });

  const linkPairs = [];
  for (let e = 0; e < edges.length; e += 2) {
    const ls = localIndex[edges[e]], lt = localIndex[edges[e + 1]];
    if (ls !== -1 && lt !== -1) linkPairs.push(ls, lt);
  }
  let links = new Int32Array(linkPairs);
  let finalPositions = positions, finalColors = colors, finalSizes = sizes;
  let finalIds = Int32Array.from(selectedIndices);
  let nodeCount = selectedIndices.length;

  if (document.getElementById('hide-isolated').checked) {
    const degree = new Uint32Array(nodeCount);
    for (let e = 0; e < links.length; e += 2) { degree[links[e]]++; degree[links[e + 1]]++; }

    const remap = new Int32Array(nodeCount).fill(-1);
    let kept = 0;
    const keptPositions = [], keptColors = [], keptSizes = [], keptIds = [];
    for (let i = 0; i < nodeCount; i++) {
      if (degree[i] === 0) continue;
      remap[i] = kept;
      keptPositions.push(positions[i*3], positions[i*3+1], positions[i*3+2]);
      keptColors.push(colors[i*4], colors[i*4+1], colors[i*4+2], colors[i*4+3]);
      keptSizes.push(sizes[i]);
      keptIds.push(selectedIndices[i]);
      kept++;
    }

    const remappedLinks = new Int32Array(links.length);
    for (let e = 0; e < links.length; e++) remappedLinks[e] = remap[links[e]];

    finalPositions = new Float32Array(keptPositions);
    finalColors = new Float32Array(keptColors);
    finalSizes = new Float32Array(keptSizes);
    finalIds = new Int32Array(keptIds);
    links = remappedLinks;
    nodeCount = kept;
  }

  document.getElementById('status').textContent =
    `${nodeCount.toLocaleString()} nodes, ${(links.length/2).toLocaleString()} edges`;

  const keys = groups.map(g => g.key);
  const keyIndex = new Map(keys.map((k, i) => [k, i]));
  const nodeKey = new Uint16Array(finalIds.length);
  for (let i = 0; i < finalIds.length; i++) nodeKey[i] = keyIndex.get(nodeGroup.get(finalIds[i]).key);

  viewState = {
    ids: finalIds,
    colors: finalColors,
    raw: finalColors.slice(),
    baseColors: finalColors.slice(),
    sizes: finalSizes,
    baseSizes: finalSizes.slice(),
    groupColor,
    groupHex,
    legendGroups: known,
    hasUnknown,
    knownCount: known.length,
    keys, keyIndex, nodeKey, baseNodeKey: nodeKey.slice(),
    dimFlag: [],
    extras: [],
    inferredCity: new Int16Array(finalIds.length).fill(-1),
    revealing: false,
    links: links, showLinks: !hasUnknown,
    explore: false,
    dimOthers: false,
    selected: -1,
    pinned: -1,
    focus: new Uint8Array(finalIds.length),
    litPoints: [], litSizes: [], seedPoints: [],
    linkPtr: null, linkOrder: null, linkColors: null,
    linksLit: false,
    kind: null, pointOf: null, nCountryOnly: 0, nNoCountry: 0,
    inferredColors: new Map(), extraSlots: 0, otherRow: false,
  };
  renderLegend(viewState);

  renderGraph(finalPositions, finalColors, finalSizes, links, !hasUnknown);
  if (exploreOn) setExplore(true);
}

function registerKey(vs, key) {
  let i = vs.keyIndex.get(key);
  if (i === undefined) { i = vs.keys.length; vs.keys.push(key); vs.keyIndex.set(key, i); }
  return i;
}

function addLegendRow(vs, key, css, text, groupStart) {
  const ki = registerKey(vs, key);
  const row = document.createElement('div');
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.style.background = css;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = text;
  const btn = document.createElement('button');
  btn.className = 'eye';
  btn.type = 'button';
  const sync = () => {
    const off = !!vs.dimFlag[ki];
    row.className = (off ? 'row off' : 'row') + (groupStart ? ' group-start' : '');
    btn.title = off ? 'Show these points again' : 'Dim these points';
  };
  btn.addEventListener('click', () => {
    if (vs !== viewState || !graph) return;
    vs.dimFlag[ki] = !vs.dimFlag[ki];
    sync();
    for (let p = 0; p < vs.nodeKey.length; p++) if (vs.nodeKey[p] === ki) paintPoint(vs, p);
    refreshGraph(vs, false);
  });
  sync();
  row.append(sw, label, btn);
  document.getElementById('legend').appendChild(row);
}

function countryOfKey(key) {
  if (key.startsWith('city:')) return key.split(':')[1];
  if (key.startsWith('country:')) return key.slice('country:'.length);
  if (key.startsWith('state:')) {
    const slug = key.slice('state:'.length);
    for (const [code, entry] of Object.entries(filtersData.countries)) {
      if (entry.states && slug in entry.states) return code;
    }
  }
  return null;
}

function renderLegend(vs) {
  document.getElementById('legend').innerHTML = '';
  const buckets = new Map();
  for (const g of vs.legendGroups) {
    const cc = countryOfKey(g.key);
    if (!buckets.has(cc)) buckets.set(cc, []);
    buckets.get(cc).push(g);
  }
  let firstBucket = true;
  for (const groups of buckets.values()) {
    groups.forEach((g, i) => addLegendRow(vs, g.key, vs.groupHex[g.key], g.label, i === 0 && !firstBucket));
    firstBucket = false;
  }
  if (vs.hasUnknown) addLegendRow(vs, 'unknown', 'rgba(140,140,140,0.5)', 'Unknown Location', !firstBucket);
  for (const e of vs.extras) addLegendRow(vs, e.key, e.css, e.text);
}

function paintPoint(vs, p) {
  const i = p * 4, c = vs.colors, r = vs.raw;
  if (p === vs.selected) {
    c[i] = 1; c[i + 1] = 1; c[i + 2] = 1; c[i + 3] = 1;
  } else if (vs.dimFlag[vs.nodeKey[p]] || (vs.dimOthers && !vs.focus[p])) {
    c[i] = DIM_COLOR_RGBA[0]; c[i + 1] = DIM_COLOR_RGBA[1]; c[i + 2] = DIM_COLOR_RGBA[2]; c[i + 3] = DIM_COLOR_RGBA[3];
  } else {
    c[i] = r[i]; c[i + 1] = r[i + 1]; c[i + 2] = r[i + 2]; c[i + 3] = vs.dimOthers ? 1 : r[i + 3];
  }
}

function repaintAll(vs) {
  for (let p = 0; p < vs.nodeKey.length; p++) paintPoint(vs, p);
}

function renderGraph(positions, colors, sizes, links, showLinks) {
  if (graph) {
    graph.pause();
    graph = null;
    document.getElementById('graph').innerHTML = '';
  }

  const ALPHA_STOP_THRESHOLD = 0.1;
  const myRenderId = ++renderId;
  simDone = false;
  updateInferUi();
  rot.userPaused = false;
  rot.glide = null;
  rotationHint();
  dof.ref = null;
  dof.applied = DOF_BASE;
  document.getElementById('recap').hidden = true;

  graph = new Cosmos.Graph(document.getElementById('graph'), {
    spaceDimensions: 3,
    spaceSize: SPACE_SIZE,
    backgroundColor: '#1d1d1d',
    pointDefaultSize: 4,
    pointSphereShading: true,
    renderLinks: showLinks,
    linkDefaultColor: '#8899aa',
    linkOpacity: 0.3,
    linkDefaultWidth: 0.5,
    simulationRepulsion: 20,
    simulationLinkSpring: 1,
    simulationLinkDistance: 100,
    simulationGravity: 0.25,
    simulationCollision: 0,
    simulationDecay: 1000000,
    onSimulationTick: (() => {
      let tickCount = 0;
      return (alpha) => {
        tickCount++;
        if (tickCount === 1) graph.fitView(0);
        if (alpha < ALPHA_STOP_THRESHOLD) { graph.pause(); markSimDone(myRenderId); }
      };
    })(),
    onSimulationEnd: () => { recenterCamera(); markSimDone(myRenderId); },
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#ffffff',
    hoveredPointCursor: 'pointer',
    onClick: index => onPointClick(myRenderId, index),
    onPointMouseOver: index => onPointHover(myRenderId, index),
    onPointMouseOut: () => onPointHover(myRenderId, undefined),
  });

  graph.setPointPositions(positions, { dimensions: 3 });
  graph.setPointColors(colors);
  graph.setPointSizes(sizes);
  graph.setLinks(links);
  graph.render();
  graph.start();

  setTimeout(() => {
    if (myRenderId !== renderId) return;
    if (graph) { graph.pause(); recenterCamera(); markSimDone(myRenderId); }
  }, 5000);
}

function recenterCamera() {
  if (!graph) return;
  const first = recenteredFor !== renderId;
  recenteredFor = renderId;
  const before = graph.getCameraState();
  graph.fitView(0);
  const fit = graph.getCameraState();
  graph.setCameraState(before, 0);
  const closer = fit.distance < before.distance;
  rot.glide = {
    start: performance.now(),
    from: { target: before.target, distance: before.distance },
    to: {
      target: closer ? fit.target : before.target,
      distance: Math.min(before.distance, fit.distance) * (first ? END_ZOOM_FACTOR : 1),
    },
  };
  if (first) dof.ref = rot.glide.to.distance;

  const pos = graph.getPointPositions({ dimensions: 3 });
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < pos.length; i += 3) { cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
  const n = pos.length / 3;
  cx /= n; cy /= n; cz /= n;
  let maxDist = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - cx, dy = pos[i + 1] - cy, dz = pos[i + 2] - cz;
    maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  console.log('[diag] data centroid:', [cx, cy, cz], 'bounding radius:', maxDist);
  console.log('[diag] camera state after fitView():', graph.getCameraState());
}

const ROTATE_RESUME_MS = 30000;
const ROTATE_MAX_DT = 0.25;
const rot = {
  speed: 5,
  userPaused: false,
  resumeAt: 0,
  glide: null,
  last: 0,
};

const DOF_BASE = 0.1;
const DOF_START = 1.8;
const DOF_FULL = 4;
const dof = {
  max: 0.6,
  ref: null,
  applied: DOF_BASE,
  hint: '',
};

function depthFadeFor(distance) {
  if (!dof.ref) return DOF_BASE;
  const u = Math.min(1, Math.max(0, (dof.ref / distance - DOF_START) / (DOF_FULL - DOF_START)));
  return DOF_BASE + Math.max(0, dof.max - DOF_BASE) * u * u * (3 - 2 * u);
}

function rotationHint() {
  const el = document.getElementById('rot-hint');
  if (el) el.textContent = rot.speed === 0 ? '' : rot.userPaused ? 'Paused, resumes after 30 s without interaction' : 'Rotating';
}

function depthFocusHint(distance) {
  const el = document.getElementById('dof-hint');
  if (!el) return;
  const text = dof.max <= DOF_BASE ? '' : !dof.ref ? '' : dof.ref / distance < DOF_START
    ? `Zoom in past x${DOF_START} to activate` : 'Active';
  if (text !== dof.hint) { dof.hint = text; el.textContent = text; }
}

function rotationTouched(stop) {
  const wasPaused = rot.userPaused;
  rot.glide = null;
  if (stop) rot.userPaused = true;
  if (rot.userPaused) rot.resumeAt = performance.now() + ROTATE_RESUME_MS;
  if (rot.userPaused !== wasPaused) rotationHint();
}

function rotationTick(now) {
  requestAnimationFrame(rotationTick);
  const dt = Math.min(ROTATE_MAX_DT, (now - rot.last) / 1000);
  rot.last = now;
  if (!graph) return;

  const cam = graph.getCameraState();
  if (!cam) return;
  const patch = {};
  if (rot.glide) {
    const g = rot.glide;
    const u = Math.min(1, Math.max(0, (now - g.start) / END_CAMERA_MS));
    const e = u * u * (3 - 2 * u);
    patch.distance = g.from.distance + (g.to.distance - g.from.distance) * e;
    patch.target = g.from.target.map((v, i) => v + (g.to.target[i] - v) * e);
    if (u >= 1) rot.glide = null;
  }
  if (rot.speed > 0) {
    if (rot.userPaused && now >= rot.resumeAt) { rot.userPaused = false; rotationHint(); }
    if (!rot.userPaused) patch.azimuth = cam.azimuth + rot.speed * Math.PI / 180 * dt;
  }

  const distance = patch.distance !== undefined ? patch.distance : cam.distance;
  const fade = depthFadeFor(distance);
  if (Math.abs(fade - dof.applied) > 0.01) {
    graph.config.pointDepthFade = fade;
    dof.applied = fade;
    if (patch.azimuth === undefined && patch.distance === undefined) patch.azimuth = cam.azimuth;
  }
  depthFocusHint(distance);

  if (patch.azimuth !== undefined || patch.distance !== undefined) graph.setCameraState(patch);
}

(() => {
  const el = document.getElementById('graph');
  el.addEventListener('pointerdown', () => rotationTouched(true), true);
  el.addEventListener('pointermove', e => { if (e.buttons) rotationTouched(false); }, true);
  el.addEventListener('pointerup', () => rotationTouched(false), true);
  el.addEventListener('wheel', () => rotationTouched(false), { capture: true, passive: true });
  requestAnimationFrame(rotationTick);
})();

(() => {
  const panel = document.getElementById('panel'), btn = document.getElementById('panel-toggle');
  btn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', collapsed);
    btn.innerHTML = collapsed ? '&lsaquo;' : '&rsaquo;';
    btn.setAttribute('aria-label', collapsed ? 'Show filters panel' : 'Hide filters panel');
    document.getElementById('readme-link').classList.toggle('panel-open', !collapsed);
  });
})();

const SELECTED_SIZE = 10;
const FOCUS_MIN_SIZE = 4;
const LINK_LIT = [0.85, 0.92, 1, 1];
const LINK_OUT = [0.53, 0.6, 0.667, 0.03];
const LINK_BASE = [0.533, 0.6, 0.667, 1];
const RECAP_LIST_MAX = 200;
const HOVER_LINKS_MAX = 60000;

// Push changed point colours and sizes (and link colours) to the GPU.
// cosmos's graph.render() reprocesses every array of the graph; this does
// what render() does for just these, ~10x cheaper on big views. It relies
// on cosmos 2.5.1 internals and falls back to render() if they're absent.
// Two details matter: update() must be called with no argument (it would
// overwrite the simulation's alpha), and the transition duration must be
// 0, otherwise colours animate and quick successive changes get lost.
function refreshGraph(vs, links) {
  const g = graph;
  if (!g) return;
  g.setPointColors(vs.colors);
  g.setPointSizes(vs.sizes);
  if (links) g.setLinkColors(vs.linkColors);
  const D = g.graph;
  if (!(D && D.updatePointColor && D.updatePointSize && D.updateLinkColor && g.transition && g.transition.setDurationOverride)) {
    g.render();
    return;
  }
  D.updatePointColor();
  D.updatePointSize();
  if (links) D.updateLinkColor();
  g.transition.setDurationOverride(0);
  g.update();
  g.transition.start();
  g.requestRender();
}

function ensureLinkIndex(vs) {
  if (!vs.showLinks || vs.linkPtr) return;
  const L = vs.links, nL = L.length / 2, n = vs.ids.length;
  const ptr = new Int32Array(n + 1);
  for (let i = 0; i < L.length; i += 2) ptr[L[i] + 1]++;
  for (let q = 0; q < n; q++) ptr[q + 1] += ptr[q];
  const fill = ptr.slice(0, n), order = new Int32Array(nL);
  for (let i = 0; i < nL; i++) order[fill[L[2 * i]]++] = i;
  vs.linkPtr = ptr;
  vs.linkOrder = order;
  vs.linkColors = new Float32Array(nL * 4);
  fillLinks(vs, LINK_BASE);
}

function fillLinks(vs, c) {
  const a = vs.linkColors;
  for (let i = 0; i < a.length; i += 4) { a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = c[3]; }
}

function colourSeedLinks(vs, seedPoints, c) {
  const a = vs.linkColors;
  for (const s of seedPoints) {
    for (let k = vs.linkPtr[s]; k < vs.linkPtr[s + 1]; k++) {
      const o = vs.linkOrder[k] * 4;
      a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; a[o + 3] = c[3];
    }
  }
}

function locationOf(g) {
  const T = initInference(), vs = viewState;
  const countryLabel = ci => filtersData.countries[T.codes[ci]].label;
  const p = vs.pointOf ? vs.pointOf[g] : -1;
  const inferred = p >= 0 ? vs.inferredCity[p] : -1;
  const city = T.cityId[g] >= 0 ? T.cityId[g] : inferred;
  if (city >= 0) {
    const c = T.cities[city], tag = T.cityId[g] >= 0 ? '' : ' (inferred)';
    return { text: `${c.label}, ${countryLabel(c.country)}${tag}`, rank: tag ? 1 : 0 };
  }
  const ci = T.countryIdx[g];
  if (T.stateId[g] >= 0) {
    const s = T.stateLabels[T.stateId[g]];
    return { text: ci >= 0 ? `${s}, ${countryLabel(ci)}` : s, rank: 2 };
  }
  if (ci >= 0) return { text: `${countryLabel(ci)} (city unknown)`, rank: 3 };
  return { text: 'Unknown location', rank: 4 };
}

function categoryOf(vs, g) {
  const T = inf;
  if (T.cityId[g] < 0) {
    const p = vs.pointOf[g];
    if (p >= 0 && vs.inferredCity[p] >= 0) return T.inferredCat0 + vs.inferredCity[p];
  }
  return T.catOf[g];
}

function egoOf(g) {
  const T = initInference();
  const followings = [], seedsOf = [];
  for (let k = T.outPtr[g]; k < T.outPtr[g + 1]; k++) if (T.outIdx[k] !== g) followings.push(T.outIdx[k]);
  for (let k = T.inPtr[g]; k < T.inPtr[g + 1]; k++) if (T.inIdx[k] !== g) seedsOf.push(T.inIdx[k]);
  if (followings.length > 0) return { isSeed: true, seeds: [g], seedsOf, net: followings };

  const seen = new Set([g, ...seedsOf]), net = [];
  for (const s of seedsOf) {
    for (let k = T.outPtr[s]; k < T.outPtr[s + 1]; k++) {
      const t = T.outIdx[k];
      if (!seen.has(t)) { seen.add(t); net.push(t); }
    }
  }
  return { isSeed: false, seeds: seedsOf, seedsOf, net };
}

function repaintPoints(vs, list) {
  for (const q of list) paintPoint(vs, q);
}

function applyFocus(vs, p, withLinks) {
  prepareView();
  ensureLinkIndex(vs);
  const ego = egoOf(vs.ids[p]);

  const prev = vs.litPoints, prevSeeds = vs.seedPoints;
  for (let i = 0; i < prev.length; i++) { vs.focus[prev[i]] = 0; vs.sizes[prev[i]] = vs.litSizes[i]; }

  const lit = [], sizes0 = [], seeds = [];
  const light = id => {
    const q = vs.pointOf[id];
    if (q >= 0 && !vs.focus[q]) { vs.focus[q] = 1; lit.push(q); }
    return q;
  };
  light(vs.ids[p]);
  for (const s of ego.seeds) { const q = light(s); if (q >= 0) seeds.push(q); }
  for (const t of ego.net) light(t);
  for (const q of lit) { sizes0.push(vs.sizes[q]); if (vs.sizes[q] < FOCUS_MIN_SIZE) vs.sizes[q] = FOCUS_MIN_SIZE; }
  vs.sizes[p] = SELECTED_SIZE;

  const wasDark = vs.dimOthers;
  vs.selected = p;
  vs.dimOthers = true;
  vs.litPoints = lit; vs.litSizes = sizes0; vs.seedPoints = seeds;
  if (wasDark) { repaintPoints(vs, prev); repaintPoints(vs, lit); }
  else repaintAll(vs);

  let linksChanged = false;
  if (vs.showLinks) {
    if (!wasDark) { fillLinks(vs, LINK_OUT); vs.linksLit = false; linksChanged = true; }
    else if (vs.linksLit) { colourSeedLinks(vs, prevSeeds, LINK_OUT); vs.linksLit = false; linksChanged = true; }
    if (withLinks) { colourSeedLinks(vs, seeds, LINK_LIT); vs.linksLit = true; linksChanged = true; }
  }
  refreshGraph(vs, linksChanged);
  return ego;
}

function dropFocus(vs) {
  if (vs.selected < 0) return;
  const prev = vs.litPoints, prevSeeds = vs.seedPoints;
  for (let i = 0; i < prev.length; i++) { vs.focus[prev[i]] = 0; vs.sizes[prev[i]] = vs.litSizes[i]; }
  vs.selected = -1;
  vs.litPoints = []; vs.litSizes = []; vs.seedPoints = [];
  vs.dimOthers = vs.explore;
  let linksChanged = false;
  if (vs.dimOthers) {
    repaintPoints(vs, prev);
    if (vs.showLinks && vs.linksLit) { colourSeedLinks(vs, prevSeeds, LINK_OUT); linksChanged = true; }
  } else {
    repaintAll(vs);
    if (vs.showLinks) { fillLinks(vs, LINK_BASE); linksChanged = true; }
  }
  vs.linksLit = false;
  refreshGraph(vs, linksChanged);
}

function clearSelection() {
  const vs = viewState;
  document.getElementById('recap').hidden = true;
  if (!vs) return;
  vs.pinned = -1;
  dropFocus(vs);
}

let exploreOn = false;

function buildExploreControl() {
  const box = document.createElement('div');
  box.id = 'explore-box';
  box.innerHTML = '<button id="explore-btn" type="button" aria-pressed="false"></button>';
  box.querySelector('#explore-btn').addEventListener('click', () => setExplore(!exploreOn));
  queueMicrotask(syncExploreButton);
  return box;
}

function syncExploreButton() {
  const btn = document.getElementById('explore-btn');
  if (!btn) return;
  btn.classList.toggle('on', exploreOn);
  btn.setAttribute('aria-pressed', String(exploreOn));
  btn.textContent = exploreOn ? 'Exploring — click to exit' : 'Explore';
  btn.title = exploreOn
    ? 'Hover a point to light its sub-network. Click to pin it, click again to release.'
    : 'Darkens the graph, then lights the sub-network of whatever you hover.';
}

function setExplore(on) {
  exploreOn = on;
  syncExploreButton();
  const vs = viewState;
  if (!vs || !graph || vs.explore === on) return;
  if (!on) {
    clearSelection();
    vs.explore = false;
    vs.dimOthers = false;
    repaintAll(vs);
    if (vs.showLinks) { ensureLinkIndex(vs); fillLinks(vs, LINK_BASE); vs.linksLit = false; }
    refreshGraph(vs, vs.showLinks);
    return;
  }
  prepareView();
  vs.explore = true;
  vs.dimOthers = true;
  repaintAll(vs);
  if (vs.showLinks) {
    ensureLinkIndex(vs);
    fillLinks(vs, LINK_OUT);
    vs.linksLit = vs.pinned >= 0;
    if (vs.linksLit) colourSeedLinks(vs, vs.seedPoints, LINK_LIT);
  }
  refreshGraph(vs, vs.showLinks);
}

function previewNode(vs, t) {
  if (t === vs.selected) return;
  if (t < 0 || t >= vs.ids.length) { dropFocus(vs); document.getElementById('recap').hidden = true; return; }
  showRecap(vs, vs.ids[t], applyFocus(vs, t, vs.links.length / 2 <= HOVER_LINKS_MAX), false);
}

let hoverTarget = -1, hoverQueued = false;
function onPointHover(id, index) {
  const vs = viewState;
  if (id !== renderId || !vs || !vs.explore || vs.pinned >= 0 || vs.revealing) return;
  hoverTarget = index === undefined ? -1 : index;
  if (hoverQueued) return;
  hoverQueued = true;
  queueMicrotask(() => {
    hoverQueued = false;
    const v = viewState;
    if (v && v.explore && v.pinned < 0 && !v.revealing) previewNode(v, hoverTarget);
  });
}

function onPointClick(id, index) {
  const vs = viewState;
  if (id !== renderId || !vs || vs.revealing) return;
  if (vs.pinned >= 0) {
    vs.pinned = -1;
    document.getElementById('recap').hidden = true;
    dropFocus(vs);
    if (vs.explore && index !== undefined) previewNode(vs, index);
    return;
  }
  if (index === undefined || index >= vs.ids.length) return;
  vs.pinned = index;
  const ego = vs.selected === index && (vs.linksLit || !vs.showLinks) ? egoOf(vs.ids[index]) : applyFocus(vs, index, true);
  showRecap(vs, vs.ids[index], ego, true);
}

function showRecap(vs, g, ego, full) {
  const T = inf, box = document.getElementById('recap');
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const row = (cls, a, b) => { const r = el('div', cls); r.append(el('span', '', a), el('span', '', b)); return r; };
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  box.replaceChildren();

  const head = el('div', 'head');
  const id = el('span', 'id', `ID ${g}`);
  id.title = 'Index of this profile in the data files. Not the real account id, which is not in the data.';
  head.append(id, el('span', 'badge', ego.isSeed ? 'Seed' : 'Following'));
  if (full) {
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.title = 'Release (click again, or Esc)';
    close.addEventListener('click', clearSelection);
    head.append(close);
  }
  box.append(head, el('div', 'loc', locationOf(g).text));

  if (ego.isSeed) {
    const also = ego.seedsOf.length ? ` · also followed by ${plural(ego.seedsOf.length, 'seed')}` : '';
    box.append(el('div', 'muted', `Follows ${plural(ego.net.length, 'profile')}${also}`));
  } else {
    box.append(el('h4', '', `Followed by ${plural(ego.seeds.length, 'seed')}`));
    const list = el('div', 'list');
    for (const s of ego.seeds.slice(0, 10)) list.append(row('li', `#${s}`, locationOf(s).text));
    if (ego.seeds.length > 10) list.append(el('div', 'muted', `… and ${ego.seeds.length - 10} more`));
    box.append(list);
  }

  const members = ego.net, counts = new Int32Array(T.catLabels.length);
  let shown = 0;
  for (const t of members) { counts[categoryOf(vs, t)]++; if (vs.pointOf[t] >= 0) shown++; }
  box.append(el('h4', '', ego.isSeed ? 'Followings' : 'Their followings'));
  box.append(el('div', 'muted', `${plural(members.length, 'profile')} · ${shown.toLocaleString()} shown on screen`));
  const used = [];
  for (let c = 0; c < counts.length; c++) if (counts[c]) used.push(c);
  used.sort((a, b) => counts[b] - counts[a]);
  for (const c of used.slice(0, 6)) box.append(row('bd', T.catLabels[c], `${counts[c].toLocaleString()} (${Math.round(100 * counts[c] / members.length)}%)`));
  if (used.length > 6) {
    const rest = members.length - used.slice(0, 6).reduce((s, c) => s + counts[c], 0);
    box.append(row('bd muted', `${used.length - 6} other locations`, rest.toLocaleString()));
  }

  if (full && members.length) {
    const buckets = [[], [], [], [], []];
    for (const t of members) buckets[T.catRank[categoryOf(vs, t)]].push(t);
    const shownIds = [];
    for (const b of buckets) {
      if (shownIds.length >= RECAP_LIST_MAX) break;
      b.sort((x, y) => x - y);
      for (const t of b) { shownIds.push(t); if (shownIds.length >= RECAP_LIST_MAX) break; }
    }
    const list = el('div', 'list');
    for (const t of shownIds) list.append(row('li', `#${t}`, locationOf(t).text));
    if (members.length > shownIds.length) list.append(el('div', 'muted', `… and ${(members.length - shownIds.length).toLocaleString()} more`));
    box.append(list);
  }

  const wasHidden = box.hidden;
  box.hidden = false;
  if (wasHidden || full) {
    const top = Math.max(12, document.getElementById('legend').getBoundingClientRect().bottom + 10);
    const infer = document.getElementById('infer');
    const reserved = infer.hidden ? 12 : innerHeight - infer.getBoundingClientRect().top + 8;
    box.style.left = '12px';
    box.style.top = top + 'px';
    box.style.maxHeight = Math.max(180, innerHeight - top - reserved) + 'px';
  }
  box.scrollTop = 0;
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') clearSelection(); });

const INFERRED_ALPHA = 1;
const INFERRED_SIZE = 4;
const INFER_PULSE_SIZE = 6;
const INFER_PULSE_MS = 350;
const INFER_DURATION_MS = 3500;
let inf = null;
let inferRun = 0;

function initInference() {
  if (inf) return inf;
  const n = filtersData.node_count;
  const codes = Object.keys(filtersData.countries);
  const cities = [];
  const cityId = new Int16Array(n).fill(-1);
  const countryIdx = new Int16Array(n).fill(-1);
  const hasState = new Uint8Array(n);
  const stateId = new Int16Array(n).fill(-1);
  const stateLabels = [];
  codes.forEach((code, ci) => {
    const entry = filtersData.countries[code];
    for (const idx of entry.indices) countryIdx[idx] = ci;
    for (const [slug, c] of Object.entries(entry.cities)) {
      const id = cities.length;
      cities.push({ key: `city:${code}:${slug}`, label: c.label, country: ci, share: c.indices.length / entry.indices.length });
      for (const idx of c.indices) if (cityId[idx] < 0) cityId[idx] = id;
    }
    if (entry.states) {
      for (const s of Object.values(entry.states)) {
        const id = stateLabels.length;
        stateLabels.push(s.label);
        for (const idx of s.indices) { hasState[idx] = 1; if (stateId[idx] < 0) stateId[idx] = id; }
      }
    }
  });

  const nC = cities.length;
  const seedRow = new Int32Array(n).fill(-1);
  const seedIdList = [];
  for (let e = 0; e < edges.length; e += 2) {
    const s = edges[e], d = edges[e + 1];
    if (s !== d && cityId[d] >= 0 && seedRow[s] < 0) { seedRow[s] = seedIdList.length; seedIdList.push(s); }
  }
  const counts = new Uint32Array(seedIdList.length * nC);
  for (let e = 0; e < edges.length; e += 2) {
    const s = edges[e], d = edges[e + 1];
    if (s !== d && cityId[d] >= 0) counts[seedRow[s] * nC + cityId[d]]++;
  }

  const outPtr = new Int32Array(n + 1);
  for (let e = 0; e < edges.length; e += 2) outPtr[edges[e] + 1]++;
  for (let i = 0; i < n; i++) outPtr[i + 1] += outPtr[i];
  const fill = outPtr.slice(0, n);
  const outIdx = new Int32Array(edges.length / 2);
  for (let e = 0; e < edges.length; e += 2) outIdx[fill[edges[e]]++] = edges[e + 1];

  const inPtr = new Int32Array(n + 1);
  for (let e = 0; e < edges.length; e += 2) inPtr[edges[e + 1] + 1]++;
  for (let i = 0; i < n; i++) inPtr[i + 1] += inPtr[i];
  const fillIn = inPtr.slice(0, n);
  const inIdx = new Int32Array(edges.length / 2);
  for (let e = 0; e < edges.length; e += 2) inIdx[fillIn[edges[e + 1]]++] = edges[e];

  const catLabels = [], catRank = [];
  const addCat = (label, rank) => { catLabels.push(label); catRank.push(rank); return catLabels.length - 1; };
  const cityCat = cities.map(c => addCat(c.label, 0));
  const stateCat = stateLabels.map(s => addCat(`${s} (state)`, 2));
  const countryCat = codes.map(code => addCat(`${filtersData.countries[code].label} (city unknown)`, 3));
  const unknownCat = addCat('Unknown', 4);
  const inferredCat0 = catLabels.length;
  cities.forEach(c => addCat(`${c.label} (inferred)`, 1));
  const catOf = new Uint16Array(n).fill(unknownCat);
  for (let i = 0; i < n; i++) {
    if (cityId[i] >= 0) catOf[i] = cityCat[cityId[i]];
    else if (stateId[i] >= 0) catOf[i] = stateCat[stateId[i]];
    else if (countryIdx[i] >= 0) catOf[i] = countryCat[countryIdx[i]];
  }

  inf = {
    codes, cities, cityId, countryIdx, hasState, stateId, stateLabels,
    catOf, catLabels, catRank, inferredCat0,
    seedIds: Int32Array.from(seedIdList), nSeeds: seedIdList.length, counts,
    outPtr, outIdx, inPtr, inIdx,
  };
  return inf;
}

function prepareView() {
  const vs = viewState;
  if (vs.kind) return;
  const T = initInference();
  const mask = getUnknownMask();
  vs.kind = new Uint8Array(vs.ids.length);
  vs.pointOf = new Int32Array(filtersData.node_count).fill(-1);
  for (let i = 0; i < vs.ids.length; i++) {
    const g = vs.ids[i];
    vs.pointOf[g] = i;
    if (T.cityId[g] >= 0 || T.hasState[g]) continue;
    if (T.countryIdx[g] >= 0) { vs.kind[i] = 1; vs.nCountryOnly++; }
    else if (mask[g]) { vs.kind[i] = 2; vs.nNoCountry++; }
  }
}

function markSimDone(id) {
  if (id !== renderId || simDone) return;
  simDone = true;
  updateInferUi();
}

function updateInferUi() {
  const box = document.getElementById('infer');
  inferRun++;
  document.getElementById('infer-panel').hidden = true;
  document.getElementById('infer-status').textContent = '';
  if (!simDone || !viewState) { box.hidden = true; return; }
  prepareView();
  box.hidden = viewState.nCountryOnly + viewState.nNoCountry === 0;
}

function restoreBase(vs) {
  setExplore(false);
  clearSelection();
  vs.raw.set(vs.baseColors);
  vs.nodeKey.set(vs.baseNodeKey);
  vs.sizes.set(vs.baseSizes);
  vs.inferredCity.fill(-1);
  for (const e of vs.extras) vs.dimFlag[vs.keyIndex.get(e.key)] = false;
  vs.extras = [];
  vs.inferredColors.clear();
  vs.extraSlots = 0;
  vs.otherRow = false;
  repaintAll(vs);
  renderLegend(vs);
}

function inferredStyle(vs, cityIdx) {
  let s = vs.inferredColors.get(cityIdx);
  if (s) return s;
  const city = inf.cities[cityIdx];
  let base = vs.groupColor[city.key], key = city.key;
  if (!base) {
    const slot = vs.knownCount + vs.extraSlots;
    if (slot < CATEGORICAL_PALETTE.length) {
      vs.extraSlots++;
      base = hexToRgba(CATEGORICAL_PALETTE[slot], 1);
      const e = { key, css: CATEGORICAL_PALETTE[slot], text: `${city.label} (inferred)` };
      vs.extras.push(e);
      addLegendRow(vs, e.key, e.css, e.text);
    } else {
      base = hexToRgba(OTHER_COLOR, 1);
      key = 'other-inferred';
      if (!vs.otherRow) {
        vs.otherRow = true;
        const e = { key, css: OTHER_COLOR, text: 'Other inferred cities' };
        vs.extras.push(e);
        addLegendRow(vs, e.key, e.css, e.text);
      }
    }
  }
  s = { col: [base[0], base[1], base[2], INFERRED_ALPHA], keyIdx: registerKey(vs, key) };
  vs.inferredColors.set(cityIdx, s);
  return s;
}

function runInference() {
  const vs = viewState, g = graph;
  if (!vs || !g || !simDone) return;
  const T = initInference();
  prepareView();
  const status = document.getElementById('infer-status');

  const X = +document.getElementById('infer-x').value;
  const Y = +document.getElementById('infer-y').value / 100;
  const alpha = +document.getElementById('infer-alpha').value;
  const includeNoCountry = document.getElementById('infer-nocountry').checked;
  const eligible = vs.nCountryOnly + (includeNoCountry ? vs.nNoCountry : 0);
  const run = ++inferRun;

  restoreBase(vs);
  g.setPointColors(vs.colors);
  g.setPointSizes(vs.sizes);
  g.render();
  if (eligible === 0) {
    status.textContent = 'Nothing to infer here: only profiles with no country are shown, tick "Include profiles with no country".';
    return;
  }

  const nC = T.cities.length;
  const w = T.cities.map(c => c.share ** -alpha);
  const qual = [];
  for (let r = 0; r < T.nSeeds; r++) {
    let n = 0, total = 0, best = -1, bestV = 0;
    for (let c = 0; c < nC; c++) {
      const k = T.counts[r * nC + c];
      if (!k) continue;
      n += k;
      const v = k * w[c];
      total += v;
      if (v > bestV) { bestV = v; best = c; }
    }
    if (n >= X && best >= 0 && bestV / total >= Y) qual.push([bestV / total, r, best]);
  }
  qual.sort((a, b) => b[0] - a[0]);
  if (qual.length === 0) {
    status.textContent = 'No seed passes these thresholds: lower X or Y.';
    return;
  }

  const claimed = new Uint8Array(vs.ids.length);
  const pts = [], cts = [];
  for (const [, r, c] of qual) {
    const s = T.seedIds[r], cityCountry = T.cities[c].country;
    for (let k = T.outPtr[s]; k < T.outPtr[s + 1]; k++) {
      const t = T.outIdx[k], p = vs.pointOf[t];
      if (p < 0 || claimed[p]) continue;
      const kind = vs.kind[p];
      if (kind === 1) { if (T.countryIdx[t] !== cityCountry) continue; }
      else if (kind !== 2 || !includeNoCountry) continue;
      claimed[p] = 1;
      pts.push(p);
      cts.push(c);
    }
  }
  const total = pts.length;
  if (total === 0) {
    status.textContent = 'No shown profile is followed by a qualifying seed.';
    return;
  }

  const start = performance.now();
  const pulseShare = INFER_PULSE_MS / INFER_DURATION_MS;
  let shown = 0;
  let settled = 0;
  const step = () => {
    if (run !== inferRun || g !== graph || vs !== viewState) return;
    const progress = Math.min(1, (performance.now() - start) / INFER_DURATION_MS);
    const target = progress >= 1 ? total : Math.floor(total * progress);
    const settleTo = progress >= 1 ? total : Math.min(target, Math.floor(total * Math.max(0, progress - pulseShare)));

    for (let i = shown; i < target; i++) {
      const s = inferredStyle(vs, cts[i]);
      vs.raw.set(s.col, pts[i] * 4);
      vs.nodeKey[pts[i]] = s.keyIdx;
      vs.inferredCity[pts[i]] = cts[i];
      paintPoint(vs, pts[i]);
      vs.sizes[pts[i]] = INFER_PULSE_SIZE;
    }
    for (let i = settled; i < settleTo; i++) vs.sizes[pts[i]] = INFERRED_SIZE;
    shown = target;
    settled = Math.max(settled, settleTo);

    refreshGraph(vs, false);

    const pct = (100 * shown / eligible).toFixed(1);
    status.textContent = progress < 1
      ? `Inferring... ${shown.toLocaleString()} of ${eligible.toLocaleString()} (${pct}%)`
      : `${total.toLocaleString()} of ${eligible.toLocaleString()} profiles inferred (${pct}%), from ${qual.length.toLocaleString()} seeds`;
    if (progress < 1) requestAnimationFrame(step);
    else vs.revealing = false;
  };
  vs.revealing = true;
  requestAnimationFrame(step);
}

function resetInference() {
  const vs = viewState;
  if (!vs || !graph) return;
  inferRun++;
  vs.revealing = false;
  restoreBase(vs);
  graph.setPointColors(vs.colors);
  graph.setPointSizes(vs.sizes);
  graph.render();
  document.getElementById('infer-status').textContent = '';
}

(() => {
  const $ = id => document.getElementById(id);
  const bind = (id, fmt) => {
    const input = $(id), label = $(id + '-val');
    const sync = () => { label.textContent = fmt(input.value); };
    input.addEventListener('input', sync);
    sync();
  };
  bind('infer-x', v => v);
  bind('infer-y', v => v + '%');
  bind('infer-alpha', v => (+v).toFixed(2));
  $('infer-open').addEventListener('click', () => { $('infer-panel').hidden = !$('infer-panel').hidden; });
  $('infer-run').addEventListener('click', runInference);
  $('infer-reset').addEventListener('click', resetInference);
})();
