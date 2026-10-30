import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { Q, TIERS } from './engine/quality.js';
import { PostFX } from './engine/PostFX.js';
import { GpuTimer } from './engine/gpuTimer.js';
import { PlanarReflection } from './engine/PlanarReflection.js';
import { CameraRig } from './engine/camera.js';
import { screenshot, createRecorder } from './engine/capture.js';
import { createUrlState } from './engine/urlState.js';
import { SkySystem } from './scene/sky.js';
import { createArena, REFLECT_LAYER } from './scene/arena.js';
import { U, ARENA, packWorld, lights, forces, impacts, occluders, arenaRaycast } from './vfx/common.js';
import { bakeNoise } from './vfx/noise.js';
import { GroundField } from './vfx/GroundField.js';
import { Particles } from './vfx/Particles.js';
import { TrailRibbons, AnalyticRibbons } from './vfx/Ribbons.js';
import { Bolts } from './vfx/Bolts.js';
import { Volumes } from './vfx/Volumes.js';
import { Shockwaves } from './vfx/Shockwaves.js';
import { FxTarget, DEBUG_VIEWS } from './vfx/FxTarget.js';
import { Lens } from './vfx/Lens.js';
import { Spikes } from './vfx/Spikes.js';
import { Sigils } from './vfx/Sigils.js';
import { Metaballs } from './vfx/Metaballs.js';
import { Casts } from './spells/cast.js';
import { SPELLS, ENTRIES, ELEMENTS } from './spells/index.js';
import { COMBOS } from './spells/combos.js';

const args = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const loading = $('loading');

const renderer = new THREE.WebGLRenderer({
  antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance',
});
renderer.autoClear = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);
document.body.classList.toggle('mobile', Q.mobile);
if (!renderer.extensions.has('EXT_color_buffer_float')) loading.textContent = 'This device can not render to float textures, so the spells can not run.';
// phones drop the context under memory pressure; every simulation state is gone, so start over
renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 60;
controls.minDistance = 1.5;
controls.maxPolarAngle = Math.PI * 0.495;
const rig = new CameraRig();
const reducedPref = matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- scenes (PLAN 2.3) ----------------------------------------------------------------
const scenes = { opaque: new THREE.Scene(), refract: new THREE.Scene(), lines: new THREE.Scene(), fx: new THREE.Scene() };

const sky = new SkySystem(renderer);
sky.setPreset('dusk');
bakeNoise(renderer, Q);
const ground = new GroundField(renderer, Q.groundSize);
const arena = createArena({ renderer, sky });
scenes.opaque.environment = sky.cube;
scenes.opaque.add(sky.background, arena.group);
scenes.refract.environment = sky.cube;
scenes.refract.add(arena.refractGroup);
U.uSkyCube.value = sky.cube;

const reflection = new PlanarReflection(REFLECT_LAYER);
reflection.scale = Q.reflectionScale;
const emptyReflection = new THREE.DataTexture(new Uint8Array(4), 1, 1);
emptyReflection.needsUpdate = true;

const particles = new Particles(renderer, { ground });
const trails = new TrailRibbons({ max: 64, points: 48 });
const bolts = new Bolts();
const volumes = new Volumes();
const shocks = new Shockwaves();
const spikes = new Spikes({ max: 48 });
const sigils = new Sigils({ max: 8 });
const metaballs = new Metaballs({ max: 4 });
const fxTarget = new FxTarget(renderer);
const lens = new Lens(renderer);
const post = new PostFX(renderer);
post.viewCamera = camera;   // motion blur reprojects through it
post.params.bloomLevels = Q.bloomLevels;
post.params.anamorphic = Q.anamorphic ? 1 : 0;
post.params.meterEvery = Q.mobile ? 3 : 1;   // a phone pays for passes; exposure can adapt at 20 Hz

// the shared world every spell gets (PLAN 2.4). Spells only touch what's in here.
let seed = Number(args.get('seed')) || 1;
const fx = {
  renderer, camera, scenes, U, Q, ARENA, sky, arena, ground, particles, trails, bolts, volumes, shocks, spikes, sigils, metaballs,
  lights, forces, impacts, occluders, rig, post, lens, fxTarget, AnalyticRibbons,
  dummies: arena.dummies, pool: arena.pool, spells: {}, reduced: reducedPref,
  systems: [],   // extra GPU systems: { update(dt, camera) }, run in the timed sim section every frame
  rand() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; },
  // reduced-motion aware flash (WCAG 2.3.1: at most 3 flashes per second)
  flash(amount) {
    const now = performance.now();
    fx._flashes = (fx._flashes ?? []).filter((t) => now - t < 1000);
    if (fx.reduced && (fx._flashes.length >= 3 || amount > 0.3)) amount = Math.min(amount, 0.15);
    fx._flashes.push(now);
    post.params.flash = Math.min(2, Math.max(post.params.flash ?? 0, amount));
  },
};

// ground probes: the 3 dummies + every live cast's target, read back async (2-3 frames late).
// fx.groundAt(x, z) returns the 8 field values (heat, char, wet, frost, crack, acid, corruption,
// glow) at the nearest probe within 1 m, or null. Casts are probed from charge, so by impact
// their target has data.
const probePts = Array.from({ length: 16 }, () => [0, 0]);
const probeXZ = Array.from({ length: 16 }, () => new THREE.Vector2());
let probeN = 0, probeReadN = 0;
const probeOut = new Float32Array(8), probeList = [];
fx.groundAt = (x, z) => {
  let best = -1, bd = 1;
  for (let i = 0; i < Math.min(probeReadN, ground.probeCount); i++) {
    const d = Math.hypot(probeXZ[i].x - x, probeXZ[i].y - z);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return null;
  for (let k = 0; k < 8; k++) probeOut[k] = ground.probes[best * 8 + k];
  return probeOut;
};
function updateProbes(casts) {
  // what was read back corresponds to the points set ~3 frames ago; points change slowly, so
  // keep the last set's positions for lookups (good to well under 1 m)
  probeReadN = probeN;
  for (let i = 0; i < probeN; i++) probeXZ[i].set(probePts[i][0], probePts[i][1]);
  probeN = 0;
  for (const d of ARENA.dummies) { probePts[probeN][0] = d.x; probePts[probeN][1] = d.z; probeN++; }
  for (const c of casts.list) if (c.alive && probeN < 16) { probePts[probeN][0] = c.to.x; probePts[probeN][1] = c.to.z; probeN++; }
  probeList.length = 0;
  for (let i = 0; i < probeN; i++) probeList.push(probePts[i]);
  ground.setProbes(probeList);
}

// shared meshes go in first, so what each spell's create() adds can be told apart
scenes.lines.add(bolts.cores, trails.lines, sigils.mesh);
scenes.opaque.add(spikes.opaque);
scenes.refract.add(spikes.refract, metaballs.group);
scenes.fx.add(bolts.glows, trails.fx, shocks.mesh, volumes.group);
for (const s of SPELLS) {
  s.defaults = { ...s.params };
  s.params = { ...s.params };
  for (const [k, def] of Object.entries(s.kinds ?? {})) particles.addKind(`${s.id}.${k}`, def);
  fx.spells[s.id] = s;
}
// every spell allocates in create(). Remember the scene objects it added: its programs are
// compiled and warmed on their own (warmSpell), current spell first, the rest in the background.
const sceneObjects = () => { const set = new Set(); for (const sc of Object.values(scenes)) sc.traverse((o) => set.add(o)); return set; };
for (const s of SPELLS) {
  const before = sceneObjects();
  s.inst = s.create(fx);
  s.objects = [...sceneObjects()].filter((o) => !before.has(o));
  s.roots = s.objects.filter((o) => before.has(o.parent));
  s.warm = false;
}
particles.build();
scenes.lines.add(particles.glow);
scenes.fx.add(particles.media);
scenes.opaque.add(...particles.debris);
scenes.refract.add(scenes.lines);   // drawn in the refract call (see renderFrame)
const casts = new Casts(fx);
fx.casts = casts;

// ambient wind: always force slot 0, pushes every responsive particle
const wind = forces.acquire();
Object.assign(wind, { type: 0, p: [0, 0.35, 0.25, 0] });
wind.dir.set(1, 0, 0.3).normalize();
const env = { timeOfDay: 'dusk', wind: 0, windAngle: 20, wetness: 0 };

// --- targets ---------------------------------------------------------------------------
let hdrRT = null;
const size = new THREE.Vector2();
function makeTargets() {
  renderer.getDrawingBufferSize(size);
  hdrRT?.dispose();
  hdrRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType, samples: Q.msaa, generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
  });
  U.uSceneColor.value = hdrRT.texture;
  U.uSceneDepth.value = hdrRT.depthTexture;
  U.uResolution.value.copy(size);
  reflection.scale = Q.reflectionScale;
  reflection.setSize(size.x, size.y);
  fxTarget.setSize(size.x, size.y, Q.fxScale * (auto.fx ?? 1));
  post.setSize(size.x, size.y);
  lens.setSize?.(size.x, size.y);
}
function resize() {
  // ?mp=3.3 renders that many megapixels whatever the window (the budget's reference size)
  const mp = parseFloat(args.get('mp'));
  renderer.setPixelRatio(mp ? Math.sqrt((mp * 1e6) / (window.innerWidth * window.innerHeight)) : Math.min(window.devicePixelRatio, 2) * Q.resolution);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  if (Q.mobile) camera.fov = camera.aspect < 1 ? 70 : 50;   // portrait: keep the arena in frame
  camera.updateProjectionMatrix();
  makeTargets();
}
window.addEventListener('resize', resize);
U.uNearFar.value.set(camera.near, camera.far);

let sunDirty = true;
function applySun() {
  sky.update();
  arena.updateSun();   // sets uSunDir/uSunColor/uAmbient (the moon at night) and the shadow map
  post.params.maxExposure = sky.night ? 6 : 20;   // night: don't blow the orb out to white
  sunDirty = false;
}

// --- camera presets -------------------------------------------------------------------
const views = {
  Overview: [2.5, 6.5, 25, 0, 1, 0],   // between the two pillars flanking the pedestal
  Shoulder: [1.4, 2.3, 15.5, 0, 1.3, 1],
  'Target close-up': [-4.5, 1.9, 7.5, 0, 1.1, 2],
  'Low hero': [5.5, 0.7, 9.5, -0.5, 2.2, 0],
  'Top-down': [0, 34, 0.5, 0, 0, 0],
  Phone: [-1.6, 3.2, 12.5, 0, 1.6, 1],   // portrait: past the pedestal, the spell fills the width
};
function setView(name) {
  const v = Array.isArray(name) ? name : views[name] ?? views.Overview;   // a preset's name, or [x, y, z, target x, y, z]
  camera.position.set(v[0], v[1], v[2]);
  controls.target.set(v[3], v[4], v[5]);
  controls.update();
}

// --- state + url -------------------------------------------------------------------------
const ui = {
  element: ENTRIES[0].element, spell: ENTRIES[0].spell.id, form: ENTRIES[0].form, entry: ENTRIES[0].key, target: 'dummy 1', autoCast: false, interval: 2.5,
  combo: COMBOS[0]?.name ?? '', timeScale: 1, paused: false, view: Q.mobile ? 'Phone' : 'Overview', exposure: 1, debug: 'off',
  reduced: reducedPref, autoLadder: Q.mobile,
};
const url = createUrlState({ spell: ui.spell, q: Q.tier, tod: 'dusk', cam: ui.view });
const hashState = url.read();
const spellById = (id) => SPELLS.find((s) => s.id === id) ?? SPELLS[0];
function writeUrl() {
  const s = spellById(ui.spell), st = { spell: s.id, form: ui.form, q: Q.tier, tod: env.timeOfDay, cam: ui.view };
  for (const k in s.params) if (s.params[k] !== s.defaults[k]) st[`${s.id}.${k}`] = s.params[k];
  url.write(st);
}
if (hashState.spell && SPELLS.some((s) => s.id === hashState.spell)) ui.spell = hashState.spell;
for (const [k, v] of Object.entries(hashState)) {
  const [id, key] = k.split('.');
  if (key && fx.spells[id] && key in fx.spells[id].params) fx.spells[id].params[key] = v;
}
if (hashState.form) ui.form = hashState.form;
ui.entry = (ENTRIES.find((e) => e.spell.id === ui.spell && e.form === ui.form) ?? ENTRIES.find((e) => e.spell.id === ui.spell) ?? ENTRIES[0]).key;
if (hashState.tod) env.timeOfDay = hashState.tod;
if (hashState.cam && views[hashState.cam]) ui.view = hashState.cam;

// --- casting ------------------------------------------------------------------------------
const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _ndc = new THREE.Vector2();
let pendingCasts = 0;
function targetPoint(name, out) {
  const i = { 'dummy 1': 0, 'dummy 2': 1, 'dummy 3': 2 }[name] ?? 0;
  return { point: out.copy(ARENA.dummies[i]).setY(1.1), index: i };
}
function castAt(point, index = -1, held = false) {
  const s = spellById(ui.spell), form = ui.form;
  if (s.warm) return casts.cast(s, point, { form, target: index, held });
  // not compiled yet: cast the moment it is, rather than stall a frame compiling
  const p = point.clone();
  pendingCasts++;
  loading.textContent = `Preparing ${s.name}…`;
  warmSpell(s).then(() => {
    if (!--pendingCasts) loading.textContent = '';
    casts.cast(s, p, { form, target: index, held: held && spaceHeld });
  });
  return null;
}
function castCurrent(held = false) {
  const t = targetPoint(ui.target, _v);
  return castAt(t.point, t.index, held);
}
function pick(clientX, clientY) {
  _ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  _dir.set(_ndc.x, _ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
  const t = arenaRaycast(camera.position, _dir, 120);
  if (t < 0) return null;
  const p = camera.position.clone().addScaledVector(_dir, t);
  // a dummy hit targets its torso
  const di = ARENA.dummies.findIndex((d) => Math.hypot(p.x - d.x, p.z - d.z) < ARENA.dummyRadius + 0.15 && p.y < ARENA.dummyHeight + 0.1);
  if (di >= 0) return { point: ARENA.dummies[di].clone().setY(Math.min(Math.max(p.y, 0.6), 1.6)), index: di };
  return { point: p, index: -1 };
}

// --- GUI ----------------------------------------------------------------------------------
const gui = new GUI({ title: 'Ultra Elements' });
if (Q.mobile) gui.close();
let fSpell = null, entryCtrl = null, presetCtrl = null;
function applyParams(s, values) {   // the defaults plus a preset (or nothing), pushed to the live spell and the panel
  Object.assign(s.params, s.defaults, values);
  for (const k in s.params) s.inst.onParam?.(k, s.params[k]);
  fSpell.controllersRecursive().forEach((c) => c.updateDisplay());
  writeUrl();
}
function buildSpellFolder() {
  fSpell?.destroy();
  const s = spellById(ui.spell);
  fSpell = gui.addFolder(`${s.name} settings`);
  fSpell.domElement.classList.add('spell');   // the reel's lab demos show only this folder
  presetCtrl = s.presets ? fSpell.add({ preset: '' }, 'preset', ['', ...Object.keys(s.presets)]).onChange((name) => name && applyParams(s, s.presets[name])) : null;
  for (const k of Object.keys(s.params)) {
    const v = s.params[k], r = s.ranges?.[k];
    let c;
    if (typeof v === 'string' && v.startsWith('#')) c = fSpell.addColor(s.params, k);
    else if (Array.isArray(r) && typeof r[0] === 'string') c = fSpell.add(s.params, k, r);
    else if (typeof v === 'number' && r) c = fSpell.add(s.params, k, r[0], r[1], r[2]);
    else c = fSpell.add(s.params, k);
    c.onChange((val) => { s.inst.onParam?.(k, val); writeUrl(); });
  }
  fSpell.add({ reset() { presetCtrl?.setValue(''); applyParams(s); } }, 'reset').name('reset to defaults');
}
// the browser: an element (category), then one entry per (spell module, form) in it
const lastEntry = {};
const entryOptions = (el) => Object.fromEntries(ENTRIES.filter((e) => e.element === el).map((e) => [e.name, e.key]));
function selectEntry(key) {
  const e = ENTRIES.find((x) => x.key === key) ?? ENTRIES[0];
  const newSpell = e.spell.id !== ui.spell || !fSpell;
  Object.assign(ui, { entry: e.key, spell: e.spell.id, form: e.form, element: e.element });
  lastEntry[e.element] = e.key;
  entryCtrl?.options(entryOptions(e.element));
  gui.controllers.forEach((c) => c.updateDisplay());
  if (newSpell) buildSpellFolder();
  updateBar();
  arena.setFocus?.(new THREE.Color(e.spell.hue), 2.5);
  $('castBtn').style.setProperty('--hue', hueOf[e.element]);
  prioritizeWarm(e.spell);
  if (Q.mobile && ready) warmSpell(e.spell);   // no background warm on phones: compile on selection
  writeUrl();
}
function selectElement(id) {
  const key = lastEntry[id] ?? ENTRIES.find((x) => x.element === id)?.key;
  if (key) selectEntry(key);
}

gui.add(ui, 'element', Object.fromEntries(ELEMENTS.filter((el) => ENTRIES.some((e) => e.element === el.id)).map((el) => [el.name, el.id]))).onChange(selectElement);
entryCtrl = gui.add(ui, 'entry', entryOptions(ui.element)).name('spell').onChange(selectEntry);
gui.add({ cast: () => castCurrent() }, 'cast').name('cast (space)');
gui.add(ui, 'target', ['dummy 1', 'dummy 2', 'dummy 3']).name('target (or click)');
gui.add(ui, 'autoCast').name('auto-cast (F)');
gui.add(ui, 'interval', 0.5, 8, 0.1).name('auto interval');
if (COMBOS.length) {
  gui.add(ui, 'combo', COMBOS.map((c) => c.name)).name('combo demo');
  gui.add({ play: () => playCombo(ui.combo) }, 'play').name('play combo');
}
gui.add(ui, 'view', Object.keys(views)).name('camera').onChange((v) => { setView(v); writeUrl(); });
gui.add({ link: () => { writeUrl(); navigator.clipboard?.writeText(location.href); } }, 'link').name('copy link');
let wantShot = false;
gui.add({ shot: () => (wantShot = true) }, 'shot').name('screenshot');
const recorder = createRecorder(renderer.domElement);
const recCtrl = gui.add({ rec: () => { recorder.recording ? recorder.stop() : recorder.start(); recCtrl.name(recorder.recording ? 'stop recording' : 'record video'); } }, 'rec').name('record video');

const fEnv = gui.addFolder('Arena & sky');
fEnv.add(env, 'timeOfDay', ['dusk', 'night', 'noon']).name('time of day').onChange((v) => { sky.setPreset(v); sunDirty = true; post._snap = true; writeUrl(); });
fEnv.add(env, 'wind', 0, 12, 0.1).name('ambient wind m/s');
fEnv.add(env, 'windAngle', -180, 180, 1).name('wind direction');
fEnv.add({ soak: () => ground.splat({ x: 0, z: 0, radius: 19, wet: 0.9, pattern: 'noise', seed: 3 }) }, 'soak').name('soak the floor');
fEnv.add({ clear: () => { ground.clear(); impacts.clear(); casts.clear(); } }, 'clear').name('clean arena');

const fTime = gui.addFolder('Time');
fTime.add(ui, 'timeScale', 0, 2, 0.01).name('time scale');
fTime.add(ui, 'paused');
fTime.add({ step: () => (stepOnce = true) }, 'step').name('step frame');

const fCam = gui.addFolder('Camera');
fCam.add(ui, 'reduced').name('reduce flashes & shake').onChange((v) => { rig.reduced = v; fx.reduced = v; });
rig.reduced = ui.reduced;
fCam.add(camera, 'fov', 25, 90, 1).onChange(() => camera.updateProjectionMatrix());

const fPost = gui.addFolder('Post');
fPost.add(ui, 'exposure', 0.25, 4, 0.01).name('exposure comp');
fPost.add(post.params, 'autoExposure');
fPost.add(post.params, 'bloomStrength', 0, 0.6, 0.001);
fPost.add(post.params, 'bloomThreshold', 0, 10, 0.01);
if ('tonemap' in post.params) fPost.add(post.params, 'tonemap', ['agx', 'neutral']);
for (const k of ['ca', 'vignette', 'lensDirt', 'anamorphic', 'motionBlur']) if (k in post.params) fPost.add(post.params, k, 0, 1, 0.01);
fPost.add(post.params, 'contrast', 0.7, 1.6, 0.01);
fPost.add(post.params, 'saturation', 0, 2, 0.01);
fPost.add(fxTarget.params, 'distortion', 0, 2, 0.01).name('FX distortion');
fPost.add(fxTarget.params, 'ca', 0, 3, 0.01).name('distortion CA');
fPost.add(fxTarget.params, 'smokeOccludesGlow', 0, 1, 0.01).name('smoke occludes glow');

const fQ = gui.addFolder('Quality');
fQ.add(Q, 'tier', Object.keys(TIERS)).name('tier (reloads)').onChange((t) => { const a = new URLSearchParams(location.search); a.set('q', t); location.search = a.toString(); });
const resCtrl = fQ.add(Q, 'resolution', 0.25, 1, 0.05).onFinishChange(resize);
fQ.add(Q, 'msaa', [2, 4, 8]).onChange(makeTargets);
fQ.add(Q, 'fxScale', [0.33, 0.5, 1]).name('FX buffer scale').onChange(makeTargets);
fQ.add(Q, 'emission', 0.1, 2, 0.01).name('particle budget');
fQ.add(Q, 'reflections');
fQ.add(Q, 'reflectFx').name('FX in reflections');
fQ.add(ui, 'autoLadder').name('auto quality');
fQ.add(ui, 'debug', Object.keys(DEBUG_VIEWS)).name('debug view').onChange((v) => (U.uDebug.value = DEBUG_VIEWS[v]));
[fEnv, fTime, fCam, fPost, fQ].forEach((f) => f.close());

// --- spell bar --------------------------------------------------------------------------
// two rows: the current element's spells (or search hits) above the element tabs
const bar = $('bar'), barSpells = document.createElement('div'), barEls = document.createElement('div');
const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: `search ${ENTRIES.length} spells` });
barSpells.className = 'spells';
barEls.className = 'els';
bar.append(barSpells, barEls);
const hueOf = Object.fromEntries(ELEMENTS.map((el) => [el.id, el.hue]));
for (const el of ELEMENTS) {
  if (!ENTRIES.some((e) => e.element === el.id)) continue;
  const b = document.createElement('button');
  b.type = 'button';
  b.style.setProperty('--hue', el.hue);
  b.innerHTML = `<b>${el.key.toUpperCase()}</b>${el.name}`;
  b.onclick = () => { search.value = ''; selectElement(el.id); };
  b.dataset.id = el.id;
  barEls.appendChild(b);
}
barEls.appendChild(search);
search.oninput = () => updateBar();
function updateBar() {
  for (const b of barEls.querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === ui.element);
  const q = search.value.trim().toLowerCase();
  const list = q ? ENTRIES.filter((e) => e.name.toLowerCase().includes(q) || e.spell.name.toLowerCase().includes(q) || e.element.includes(q)).slice(0, 24)
    : ENTRIES.filter((e) => e.element === ui.element);
  barSpells.replaceChildren(...list.map((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.setProperty('--hue', hueOf[e.element]);
    b.textContent = e.name;
    b.classList.toggle('on', e.key === ui.entry);
    b.onclick = () => selectEntry(e.key);
    return b;
  }));
  if (Q.mobile) for (const b of bar.querySelectorAll('.on')) b.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// --- combos -------------------------------------------------------------------------------
const comboQueue = [];
function playCombo(name) {
  const c = COMBOS.find((x) => x.name === name);
  if (!c) return;
  Promise.all(c.steps.map((st) => warmSpell(spellById(st.spell)))).then(() => {
    let t = 0;
    for (const step of c.steps) { t += step.delay ?? 0; comboQueue.push({ at: elapsed + t, step }); }
    if (c.view) setView(c.view);
  });
}
function runCombos() {
  for (let i = comboQueue.length - 1; i >= 0; i--) {
    const q = comboQueue[i];
    if (elapsed < q.at) continue;
    comboQueue.splice(i, 1);
    const s = spellById(q.step.spell);
    const to = q.step.to ? _v.fromArray(q.step.to) : targetPoint(`dummy ${(q.step.target ?? 0) + 1}`, _v).point;
    casts.cast(s, to, { form: q.step.form ?? s.forms?.[0], target: q.step.target ?? -1, held: !!q.step.hold });
    if (q.step.hold) setTimeout(() => casts.releaseHeld(), q.step.hold * 1000);
  }
}

// --- input ------------------------------------------------------------------------------------
// attract: the landing page casts every entry in turn. ?reel is the showreel for recording: one pass,
// a camera cut per spell, a caption, no lab chrome outside the lab demos (&clean hides the perf panel too, &record saves a video).
const reel = args.has('reel');
let attract = reel || (!args.has('shot') && !args.has('bench') && !args.has('clips') && !location.hash && !args.has('noattract'));
const REEL_VIEWS = { projectile: ['Shoulder', 'Low hero'], beam: ['Shoulder', 'Low hero'], strike: ['Target close-up', 'Overview'], area: ['Overview', 'Target close-up'], self: ['Low hero', 'Overview'] };
const caption = $('caption');
// running order for the attract loop and the reel: four hand-picked openers, the rest in a seeded
// random order (never one element twice running), Supernova to close. The reel is cut to about three
// minutes: the openers, the finale and the two lab demos run full length, the rest are paced to fit.
const REEL_LEAD = ['Glacial Spike', 'Aegis', 'Portal', 'Toxic Bloom'], REEL_LAST = 'Supernova';
const REEL_SECONDS = 183, REEL_INTRO = 2.5, REEL_TAIL = 1.5;   // every spell, at most 3:10 (the 3.2 s floor and start-up add a few s)
const REEL_SEED = 1480283;   // picked offline: no element twice within two slots, the big area spells spread through the first two thirds, the lab demos a third and five sixths in
// follow-ups fired at the same dummy (s after the previous one): the shield is there to be hit
const REEL_FOLLOW = { Aegis: [{ spell: 'arcane', form: 'Arcane Barrage', delay: 1.3 }] };
// fixed [camera, dummy] where the usual alternation frames a spell badly: the finale needs the middle dummy, from low
const REEL_SHOT = { Supernova: ['Low hero', 1] };
// lab demos: the slot plays out with the settings panel up and its sliders and presets moved live between
// casts (times in s from the slot's start); the spell goes back to its defaults when the slot ends
const REEL_LAB = {
  Fireball: { note: 'Open-source lab · every spell is tunable', length: 11.5, steps: [
    { at: 0.9, over: 1.6, set: { temperature: 6500, size: 1.6 } }, { at: 2.7, cast: true },
    { at: 4.6, preset: 'soulfire' }, { at: 4.9, cast: true },
    { at: 6.9, preset: 'hellfire' }, { at: 7.2, cast: true },
  ] },
  Thunderstrike: { note: 'Lightning · presets, colour, shape', length: 8.8, steps: [
    { at: 1.3, preset: 'violet' }, { at: 1.5, cast: true },
    { at: 3.0, over: 1.4, set: { jag: 0.2, glow: '#2affc8' } }, { at: 4.6, cast: true },
    { at: 6.2, preset: 'crimson' }, { at: 6.4, cast: true },
  ] },
};
let lab = null;
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function runLab(dt) {
  const L = lab, ctrl = (k) => fSpell.controllers.find((c) => c.property === k);
  L.t += dt;
  while (L.i < L.steps.length && L.t >= L.steps[L.i].at) {
    const st = L.steps[L.i++];
    if (st.cast) castCurrent();
    if (st.preset) { presetCtrl.setValue(st.preset); L.lit.push({ c: presetCtrl, until: L.t + 0.9 }); }
    for (const k in st.set ?? {}) {
      L.tweens.push({ c: ctrl(k), from: L.s.params[k], to: st.set[k], step: L.s.ranges?.[k]?.[2] ?? 0.01, t0: L.t, over: st.over });
      L.lit.push({ c: ctrl(k), until: L.t + st.over + 0.5 });
    }
  }
  for (const w of L.tweens) {
    const u = Math.min(1, (L.t - w.t0) / w.over), e = u * u * (3 - 2 * u);
    if (u < 1 || !w.done) w.c.setValue(typeof w.to === 'string' ? `#${_c1.set(w.from).lerp(_c2.set(w.to), e).getHexString()}` : +(Math.round((w.from + (w.to - w.from) * e) / w.step) * w.step).toFixed(4));
    w.done = u >= 1;
  }
  for (const l of L.lit) l.c.domElement.classList.toggle('live', L.t < l.until);
  document.body.classList.toggle('lab', L.t < L.length - 0.6);   // the panel fades out just before the cut
}
function endLab() {
  lab.lit.forEach((l) => l.c.domElement.classList.remove('live'));
  presetCtrl?.setValue('');
  applyParams(lab.s);
  document.body.classList.remove('lab');
  lab = null;
}
function reelShuffle(list, seed, after) {
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out = [], pool = [...list], prev = () => out.at(-1)?.element ?? after;
  while (pool.length) {
    const ok = pool.filter((e) => e.element !== prev()), from = ok.length ? ok : pool;
    out.push(pool.splice(pool.indexOf(from[Math.floor(rnd() * from.length)]), 1)[0]);
  }
  return out;
}
const byName = (n) => ENTRIES.find((e) => e.name === n);
const reelEntries = [...REEL_LEAD.map(byName), ...reelShuffle(ENTRIES.filter((e) => !REEL_LEAD.includes(e.name) && e.name !== REEL_LAST), REEL_SEED, byName(REEL_LEAD.at(-1))?.element), byName(REEL_LAST)].filter(Boolean);
const entryShape = (e) => e.spell.formShapes?.[e.form] ?? e.spell.shape ?? 'projectile';
function reelLength(e) {   // charge, flight, impact and most of the linger
  const T = e.spell.timing ?? {}, shape = entryShape(e);
  const travel = shape === 'beam' ? T.sustain ?? 4 : shape === 'projectile' ? 1 : 0;
  return Math.min(9, Math.max(3.5, (T.charge ?? 0.5) + travel + (T.impact ?? 0.2) + 0.8 * (T.linger ?? 2)));
}
const followTime = (e) => (REEL_FOLLOW[e.name] ?? []).reduce((a, f) => a + f.delay, 0);
const sum = (l, f) => l.reduce((a, e) => a + f(e), 0);
const fullLength = (e) => REEL_LEAD.includes(e.name) || e.name === REEL_LAST || e.name in REEL_LAB;   // the openers, the finale, the lab demos
const slotLength = (e) => REEL_LAB[e.name]?.length ?? reelLength(e);
const reelLeadE = reelEntries.filter(fullLength), reelRestE = reelEntries.filter((e) => !fullLength(e));
const reelPace = (REEL_SECONDS - REEL_INTRO - REEL_TAIL - sum(reelLeadE, slotLength) - sum(reelEntries, followTime)) / sum(reelRestE, reelLength);
let reelIntro = reel;
function reelNext() {
  if (Q.mobile && pendingCasts) return 0.25;   // a phone compiles slowly: wait for the last one to fire
  if (lab) endLab();
  if (reelIntro) {   // a title over the empty arena first
    reelIntro = false;
    setView('Overview');
    caption.style.setProperty('--hue', '#9fd8ff');
    caption.innerHTML = `Real-time WebGL2 spell effects<b>Ultra Elements</b>`;
    caption.classList.add('on');
    return REEL_INTRO;
  }
  if (reel && attractIndex === ENTRIES.length) {
    stopAttract();
    caption.classList.remove('on');
    if (recorder.recording) setTimeout(() => recorder.stop(), REEL_TAIL * 1000);
    return 1e9;
  }
  const e = reelEntries[attractIndex % reelEntries.length], shot = reel && REEL_SHOT[e.name], next = reel && REEL_SHOT[reelEntries[attractIndex + 1]?.name];
  let dummy = shot ? shot[1] : attractIndex % 3;
  if (!shot && next?.[1] === dummy) dummy = (dummy + 1) % 3;   // keep the next fixed shot's dummy clear of this spell's leftovers
  const shape = entryShape(e);
  selectEntry(e.key);
  ui.target = `dummy ${dummy + 1}`;
  if (reel) {
    const el = ELEMENTS.find((x) => x.id === e.element);
    setView(shot ? shot[0] : REEL_VIEWS[shape][attractIndex % 2]);
    caption.style.setProperty('--hue', el.hue);
    caption.innerHTML = `${REEL_LAB[e.name]?.note ?? el.name}<b>${e.name}</b>`;
    caption.classList.add('on');
    if (REEL_LAB[e.name]) lab = { s: e.spell, ...REEL_LAB[e.name], t: 0, i: 0, tweens: [], lit: [] };
  }
  attractIndex++;
  castCurrent();
  let t = 0;
  for (const f of REEL_FOLLOW[e.name] ?? []) {
    const at = elapsed + (t += f.delay), step = { spell: f.spell, form: f.form, target: dummy };
    warmSpell(spellById(f.spell)).then(() => comboQueue.push({ at, step }));
  }
  const len = fullLength(e) ? slotLength(e) : Math.max(3.2, reelLength(e) * reelPace);
  return (reel ? len : 3.2) + followTime(e);
}
let down = null;
function stopAttract() { if (lab) endLab(); if (attract) { attract = false; controls.autoRotate = false; } }
renderer.domElement.addEventListener('pointerdown', (e) => { stopAttract(); down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || !ready) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 5 || dt > 250) return;
  const p = pick(e.clientX, e.clientY);
  if (p) castAt(p.point, p.index);
});
let spaceHeld = false;
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('.lil-gui') || e.target.tagName === 'INPUT') return;
  stopAttract();
  if (!ready) return;
  const el = ELEMENTS.find((x) => x.key === e.key.toLowerCase());
  if (el) selectElement(el.id);
  else if (e.code === 'Space' && !spaceHeld) { spaceHeld = true; castCurrent(true); e.preventDefault(); }
  else if (e.key === 'q' || e.key === 'e') {
    const list = ENTRIES.filter((x) => x.element === ui.element), i = list.findIndex((x) => x.key === ui.entry);
    selectEntry(list[(i + (e.key === 'e' ? 1 : list.length - 1)) % list.length].key);
  } else if (e.key === 'f') { ui.autoCast = !ui.autoCast; gui.controllersRecursive().forEach((c) => c.updateDisplay()); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceHeld = false; casts.releaseHeld(); } });
// phones: the cast button behaves like the space bar (hold to charge), the panel opens on a tap
const castBtn = $('castBtn');
castBtn.addEventListener('pointerdown', () => { stopAttract(); if (ready) { spaceHeld = true; castCurrent(true); } });
for (const ev of ['pointerup', 'pointercancel']) castBtn.addEventListener(ev, () => { spaceHeld = false; casts.releaseHeld(); });
$('perf').addEventListener('click', (e) => { if (Q.mobile && e.target.tagName !== 'BUTTON') $('perf').classList.toggle('open'); });

// --- frame ------------------------------------------------------------------------------------
const gl = renderer.getContext();
const timer = new GpuTimer(gl);
let elapsed = 0, simTime = 0, autoTimer = 0, attractTimer = 0, attractIndex = 0, stepOnce = false, ready = false;

function renderFrame(dt) {
  elapsed += dt;
  if (sunDirty) applySun();
  renderer.info.reset();
  timer.beginFrame();

  const scale = (ui.paused && !stepOnce) ? 0 : ui.timeScale * rig.timeScale;
  const sdt = stepOnce ? 1 / 60 : dt * scale;
  stepOnce = false;
  simTime += sdt;
  U.uTime.value = simTime % 3600;
  U.uDt.value = sdt;
  U.uFrame.value++;

  // CPU: casts emit, lights/forces/impacts pack into the world texture
  runCombos();
  wind.p[0] = env.wind;
  wind.dir.set(Math.cos(THREE.MathUtils.degToRad(env.windAngle)), 0, Math.sin(THREE.MathUtils.degToRad(env.windAngle)));
  casts.update(sdt);
  for (const s of SPELLS) s.inst.tick?.(sdt);
  arena.update(renderer, sdt, camera);
  spikes.update(sdt);   // writes occluder capsules, so before packWorld
  sigils.update();
  packWorld(sdt, { maxLights: Q.maxLights, maxShadowed: Q.shadowLights });

  timer.begin('sim');
  particles.update(sdt, simTime);
  updateProbes(casts);
  ground.update(sdt);
  trails.update(sdt);
  bolts.update();
  volumes.update(camera);
  shocks.update(sdt);
  metaballs.update();
  for (const sys of fx.systems) sys.update(sdt, camera);
  if (warming) forceVisible();

  timer.begin('reflect');
  if (Q.reflections) {
    reflection.render(renderer, scenes.opaque, camera);
    if (Q.reflectFx) renderer.render(scenes.lines, reflection.camera);   // same target, not cleared
    arena.uniforms.uReflection.value = reflection.target.texture;
    arena.uniforms.uReflMatrix.value = reflection.textureMatrix;
  } else arena.uniforms.uReflection.value = emptyReflection;

  timer.begin('opaque');
  renderer.setRenderTarget(hdrRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(scenes.opaque, camera);

  // refraction + lines in one call: every render into the MSAA target pays a ~0.3 ms resolve
  timer.begin('late');
  renderer.render(scenes.refract, camera);

  let frame = fxTarget.render(scenes.fx, camera, hdrRT.texture, timer, U.uDebug.value === 7 ? particles.rt[particles.cur].textures[0] : null);
  if (lens.active) { timer.begin('lens'); frame = lens.render(frame, hdrRT.depthTexture, camera); }

  timer.begin('post');
  post.params.exposure = ui.exposure;
  post.render(frame, dt, hdrRT.texture);
  post.params.flash = Math.max(0, (post.params.flash ?? 0) - dt * 6);
  timer.endFrame();
  if (wantShot) { wantShot = false; screenshot(renderer.domElement, `ultra-elements-${ui.spell}`); }
  recorder.frame();
}

// Chrome/ANGLE's readPixels and finish don't wait for the GPU, so sync on a fence (UW).
async function gpuFence() {
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  while (gl.clientWaitSync(s, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise((r) => setTimeout(r, 1));
  gl.deleteSync(s);
}

// --- warm-up: every program compiled and drawn once into its real targets before the first cast.
// Systems hide idle meshes in their update(), so the warm frame re-forces them after the updates.
let warming = false;
const warmSaved = [];
function forceVisible() {
  for (const sc of Object.values(scenes)) sc.traverse((o) => {
    o.visible = true;
    if (o.geometry?.isInstancedBufferGeometry) o.geometry.instanceCount = Math.max(1, o.geometry.instanceCount);
  });
}
async function warmup() {
  loading.textContent = 'Warming shaders…';
  const parked = [];   // spells warm on their own (warmSpell): out of the scenes while the core does
  for (const s of SPELLS) for (const o of s.roots) { parked.push([o, o.parent]); o.parent.remove(o); }
  for (const sc of Object.values(scenes)) sc.traverse((o) => {
    warmSaved.push([o, o.visible, o.geometry?.isInstancedBufferGeometry ? o.geometry.instanceCount : null]);
  });
  forceVisible();
  particles.warm(true);
  lens.active = lens.warming = true;
  const t0 = performance.now();
  renderer.setRenderTarget(hdrRT);   // compile the linear-output variants we actually draw with
  for (const sc of Object.values(scenes)) await renderer.compileAsync(sc, camera);
  renderer.setRenderTarget(null);
  warming = true;
  renderFrame(1 / 60);
  warming = false;
  await gpuFence();
  for (const [o, v, n] of warmSaved.reverse()) { o.visible = v;   // reverse: lines are traversed twice (nested in refract)
    if (n !== null) o.geometry.instanceCount = n; }
  warmSaved.length = 0;
  particles.warm(false);
  lens.active = lens.warming = false;
  for (const [o, p] of parked) p.add(o);
  await warmSpell(spellById(ui.spell));
  console.log(`warm-up ${(performance.now() - t0).toFixed(0)} ms (core + ${ui.spell}; ${SPELLS.length - 1} spells warm in the background)`);
}

// per-spell warm-up: compile its programs (parallel compile, linear-output variants) and draw
// each pass once into tiny targets with its meshes forced on, since ANGLE builds some variants
// at first draw. Off the visible frame, so it can run in the background between frames.
let warmHdr = null, warmFx = null;
const sceneOf = (o) => { let p = o; while (p && !p.isScene) p = p.parent; return p; };
function warmSpell(s) {
  if (s.warm) return Promise.resolve();
  return (s.warming ??= (async () => {
    renderer.setRenderTarget(hdrRT);
    const jobs = s.roots.map((o) => renderer.compileAsync(o, camera, sceneOf(o)));
    renderer.setRenderTarget(null);
    await Promise.all(jobs);
    if (s.objects.length) {
      if (!warmHdr || warmHdr.samples !== hdrRT.samples) { warmHdr?.dispose(); warmHdr = hdrRT.clone(); warmHdr.setSize(4, 4); }
      if (!warmFx) { warmFx = fxTarget.rt.clone(); warmFx.setSize(4, 4); }
      const saved = s.objects.map((o) => [o, o.visible, o.geometry?.isInstancedBufferGeometry ? o.geometry.instanceCount : null]);
      for (const o of s.objects) { o.visible = true; if (o.geometry?.isInstancedBufferGeometry) o.geometry.instanceCount = Math.max(1, o.geometry.instanceCount); }
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(warmHdr);
      renderer.render(scenes.opaque, camera);
      renderer.render(scenes.refract, camera);
      renderer.setRenderTarget(warmFx);
      renderer.render(scenes.fx, camera);
      renderer.setRenderTarget(prev);
      for (const [o, v, n] of saved) { o.visible = v; if (n !== null) o.geometry.instanceCount = n; }
    }
    s.warm = true;
  })());
}
const warmQueue = [];
function prioritizeWarm(s) {
  const i = warmQueue.indexOf(s);
  if (i > 0) { warmQueue.splice(i, 1); warmQueue.unshift(s); }
}
async function backgroundWarm() {
  const cur = spellById(ui.spell).element;
  warmQueue.push(...SPELLS.filter((s) => !s.warm).sort((a, b) => (b.element === cur) - (a.element === cur)));
  while (warmQueue.length) {
    const s = warmQueue.shift();
    if (!s.warm) await warmSpell(s);
    await new Promise((r) => setTimeout(r, 30));   // let frames through
  }
}

// --- benchmark (PLAN 7): a spell's whole timeline back-to-back, fence-timed, per-pass mean + peak
let benchmarking = false, bench = '';
// a fixed 60 Hz frame for shots and benchmarks: the rig advances too, so hitstop and shake run out
function stepFixed() { rig.apply(camera, 1 / 60); renderFrame(1 / 60); rig.restore(camera); }
async function runBenchmark(id = ui.spell, form) {
  if (benchmarking) return null;
  const list = id === 'storm' ? ELEMENTS.map((el) => SPELLS.find((s) => s.element === el.id)).filter(Boolean) : [spellById(id)];
  await Promise.all(list.map(warmSpell));
  benchmarking = true;
  const savedSeed = seed;
  seed = 7; particles.reseed(7);
  casts.clear(); ground.clear(); impacts.clear();
  for (let i = 0; i < 30; i++) renderFrame(1 / 60);
  await gpuFence();
  timer.drain();
  list.forEach((s, i) => casts.cast(s, targetPoint(`dummy ${(i % 3) + 1}`, _v).point.clone(), { form: form ?? s.forms?.[0], target: i % 3, seed: 100 + i }));
  timer.keep = true;
  const t0 = performance.now();
  let frames = 0, worst = 0, tw = t0;
  // whole-frame cost at the spell's peak, GPU-complete: the slowest quarter second, fence-timed
  while ((casts.count() > 0 || frames < 60) && frames < 600) {
    stepFixed();
    if (++frames % 15 === 0) {
      await gpuFence();
      const now = performance.now();
      worst = Math.max(worst, (now - tw) / 15);
      tw = now;
    }
  }
  await gpuFence();
  const ms = (performance.now() - t0) / frames;
  const passes = timer.drain(), peak = timer.peak ?? {};
  timer.keep = false;
  benchmarking = false;
  seed = savedSeed;
  const gpu = Object.values(passes).reduce((a, b) => a + b, 0);
  renderer.getDrawingBufferSize(size);
  bench = `bench ${id}: ${ms.toFixed(2)} ms/frame mean${timer.available ? `, GPU ${gpu.toFixed(2)} mean / ${peak.total?.toFixed(2)} peak` : ''} (${frames} frames)`
    + Object.entries(passes).map(([k, v]) => `\n  ${k.padEnd(9)} ${v.toFixed(3)} / ${(peak[k] ?? 0).toFixed(3)} ms`).join('');
  console.log(`${size.x}×${size.y} ${bench}`);
  return (window.benchResult = { id, ms, worst, gpu, peak: peak.total, passes, peakPasses: peak, frames, size: [size.x, size.y] });
}
window.runBenchmark = runBenchmark;
// every spell in turn, one table. ?benchall runs it at start-up and shows it in the panel, so a phone
// can run it with no tools attached.
async function benchAll({ runs = 3 } = {}) {
  const rows = [];
  const wake = await navigator.wakeLock?.request('screen').catch(() => null);   // a phone left on ?benchall stays awake
  await new Promise((r) => setTimeout(r, 3000));   // let the idle baseline settle
  casts.clear();
  for (const e of ENTRIES) {
    let best = null;
    for (let i = 0; i < runs; i++) {
      const b = await runBenchmark(e.spell.id, e.form || undefined);
      if (!best || b.worst < best.worst) best = b;
    }
    rows.push({ element: e.element, name: e.name, worst: +best.worst.toFixed(2), mean: +best.ms.toFixed(2), gpuPeak: best.peak ? +best.peak.toFixed(2) : null });
    hud.textContent = rows.slice(-12).map((r) => `${r.name.padEnd(18)} ${r.worst.toFixed(2)} ms`).join('\n');
    await new Promise(requestAnimationFrame);
  }
  wake?.release();
  rows.sort((a, b) => b.worst - a.worst);
  hud.textContent = rows.map((r) => `${r.name.padEnd(18)} ${r.worst.toFixed(2)} peak  ${r.mean.toFixed(2)} mean`).join('\n');
  return (window.benchAllResult = rows);
}
window.app = { fx, casts, SPELLS, ENTRIES, ELEMENTS, selectEntry, warmSpell, castCurrent, renderer, camera, controls, post, timer, Q, U, ui, setView, runBenchmark, benchAll, stepFixed, scenes };

// deterministic frame: ?shot=<spell>&t=<s>&seed=<n>[&cam=..][&campos=x,y,z,tx,ty,tz][&form=..]
async function runShot() {
  const s = spellById(args.get('shot')), t = Number(args.get('t') ?? 1);
  if (args.has('campos')) setView(args.get('campos').split(',').map(Number));
  const form = args.get('form') ?? s.forms?.[0] ?? s.name;   // formless spells' entry is keyed by name
  selectEntry(`${s.id}:${form}`);
  await warmSpell(s);
  particles.reseed(seed);
  const tp = targetPoint(args.get('target') ?? 'dummy 1', _v);
  casts.cast(s, tp.point.clone(), { form: ui.form || s.forms?.[0], target: tp.index, seed });
  for (let f = 0; f < Math.round(t * 60); f++) stepFixed();
  ui.paused = true;
}

// ?clips=<plan.json>: the promo's raw footage, one video file per clip, cut together afterwards. Each clip starts
// in a clean arena: one spell (plus its follow-ups) at one dummy, the camera at cam (easing to cam2 over `move` s),
// the caption up, `record` s filmed from the cast and 0.5 s before it, stepped at a fixed 60 Hz whatever the wall clock
// (one video frame per step: retime the file by frame number). A clip with `lab` plays that demo (REEL_LAB's
// format) instead of one cast. Times are spell seconds: `speed` films in slow motion, the move starts at `in`.
// &only=3,7 films just those clips (1-based) and keeps their numbers; one per page load gives each a fresh arena.
let camMove = null, offline = false;
function moveCam(dt) {
  const m = camMove, u = Math.min(1, Math.max(0, (m.t += dt) / m.over)), e = u * u * (3 - 2 * u);
  setView(m.from.map((v, i) => v + (m.to[i] - v) * e));
  if (u >= 1) camMove = null;
}
async function runClips(src) {
  const { clips } = await (await fetch(src)).json(), only = args.get('only')?.split(',').map(Number);
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const steps = async (s) => {   // what tick() does, at 1/60 s a frame; a rendered frame is presented before the next
    for (let f = Math.round(s * 60); f > 0; f--) {
      if (camMove) moveCam(1 / 60);
      if (lab) runLab(1 / 60);
      stepFixed();
      await new Promise(requestAnimationFrame);
    }
  };
  loading.textContent = 'Warming every spell…';
  for (const s of SPELLS) await warmSpell(s);   // nothing compiles mid-take
  loading.textContent = '';
  for (const [i, c] of clips.entries()) {
    if (only && !only.includes(i + 1)) continue;
    const e = byName(c.spell), el = ELEMENTS.find((x) => x.id === e.element);
    selectEntry(e.key);
    casts.clear(); ground.clear(); impacts.clear(); particles.clearState(); comboQueue.length = 0; camMove = null;
    if ((c.tod ?? 'dusk') !== env.timeOfDay) { env.timeOfDay = c.tod ?? 'dusk'; sky.setPreset(env.timeOfDay); sunDirty = true; }
    post._snap = true;
    const speed = ui.timeScale = c.speed ?? 1;
    setView(c.cam);
    ui.target = `dummy ${(c.dummy ?? 0) + 1}`;
    caption.style.setProperty('--hue', el.hue);
    caption.innerHTML = `${c.lab?.note ?? el.name}<b>${e.name}</b>`;
    caption.classList.add('on');
    await wait(1);   // the clear has landed and the exposure settled
    offline = true;
    const started = recorder.start(`clip-${String(i + 1).padStart(2, '0')}-${e.name.replace(/\W+/g, '-')}`, [caption, gui.domElement], true);
    await steps(1 / 60);   // the encoder starts on its first frame, then needs a moment before it keeps every one
    await started;
    await wait(0.3);
    await steps(0.5 - 1 / 60);
    if (c.cam2) camMove = { from: c.cam, to: c.cam2, t: -(c.in ?? 0) / speed, over: (c.move ?? c.record) / speed };
    if (c.lab) lab = { s: e.spell, ...c.lab, t: 0, i: 0, tweens: [], lit: [] };
    else castCurrent();
    let t = 0;
    for (const f of c.follow ?? []) comboQueue.push({ at: elapsed + (t += f.delay / speed), step: { spell: f.spell, form: f.form, target: c.dummy ?? 0 } });
    await steps(c.record / speed);
    recorder.stop();
    offline = false;
    if (lab) endLab();
  }
  caption.classList.remove('on');
  window.clipsDone = true;
}

// --- HUD + loop -------------------------------------------------------------------------------
const hud = $('hud'), graph = $('pGraph').getContext('2d'), phaseCtx = $('pPhase').getContext('2d'), uncapButton = $('pUncap'), fpsHistory = [];
let frames = 0, lastHud = performance.now(), last = performance.now(), uncapped = false;
$('pGpu').textContent = (() => {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown GPU';
  return raw.split(', ')[1]?.replace(/ \(0x.*$/, '') || raw;
})();
uncapButton.onclick = () => {
  uncapped = !uncapped;
  uncapButton.textContent = uncapped ? 'Cap to display' : 'Uncap FPS';
  uncapButton.classList.toggle('on', uncapped);
  fpsHistory.length = 0;
};
const benchButton = $('pBench');
benchButton.onclick = async () => {
  if (benchButton.disabled || !ready) return;
  benchButton.disabled = true;
  benchButton.textContent = 'Benchmarking…';
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
  await runBenchmark();
  benchButton.disabled = false;
  benchButton.textContent = 'Run benchmark';
};
const fmtK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${n}`);

const PHASE_COLORS = { charge: '#ffd166', travel: '#2cc9ff', impact: '#ff4d6d', linger: '#7a6cff' };
function drawPhase() {
  const { width: w, height: h } = phaseCtx.canvas;
  phaseCtx.clearRect(0, 0, w, h);
  const c = casts.active();
  if (!c) return;
  const d = c.durations, shape = c.shape;
  const travel = shape === 'projectile' ? Math.max(c.phase === 'travel' ? c.t : 0, c.from.distanceTo(c.to) / (c.spell.params.speed ?? c.spell.speed ?? 15)) : shape === 'beam' ? Math.max(c.phase === 'travel' ? c.t : 0, c.spell.timing?.sustain ?? 1) : 0;
  const segs = [['charge', d.charge], ['travel', travel], ['impact', d.impact], ['linger', d.linger]];
  const total = segs.reduce((a, s) => a + s[1], 0) || 1;
  let x = 0, head = 0;
  for (const [name, dur] of segs) {
    const sw = (dur / total) * w;
    phaseCtx.fillStyle = PHASE_COLORS[name];
    phaseCtx.globalAlpha = name === c.phase ? 1 : 0.35;
    phaseCtx.fillRect(x, 0, sw, h);
    if (name === c.phase) head = x + Math.min(1, c.t / Math.max(dur, 1e-3)) * sw;
    x += sw;
  }
  phaseCtx.globalAlpha = 1;
  phaseCtx.fillStyle = '#fff';
  phaseCtx.fillRect(head - 2, 0, 4, h);
}

function updateHud(now) {
  const fps = (frames * 1000) / (now - lastHud);
  renderer.getDrawingBufferSize(size);
  $('pSpec').textContent = `${size.x}×${size.y} · ${Q.msaa}× MSAA · ${Q.tier} tier${Q.mobile ? ' · mobile' : ''}`;
  $('pFps').textContent = fps.toFixed(0);
  $('pMode').textContent = uncapped ? 'UNCAPPED' : 'VSYNC';
  $('pMs').textContent = `${(1000 / fps).toFixed(2)} ms/frame`;
  fpsHistory.push(fps);
  if (fpsHistory.length > 40) fpsHistory.shift();
  const { width: w, height: h } = graph.canvas, lo = Math.min(...fpsHistory) * 0.9, hi = Math.max(...fpsHistory) * 1.05;
  graph.clearRect(0, 0, w, h);
  graph.beginPath();
  fpsHistory.forEach((v, i) => graph.lineTo((w * i) / Math.max(1, fpsHistory.length - 1), h - (h * (v - lo)) / (hi - lo || 1)));
  graph.strokeStyle = '#2cc9ff';
  graph.lineWidth = 3;
  graph.stroke();
  const info = renderer.info.render;
  let text = `particles ≤ ${fmtK(particles.alive)} / ${fmtK(particles.W * particles.H)} · draws ${info.calls} · tris ${fmtK(info.triangles)} · casts ${casts.count()}`;
  if (timer.available && timer.total > 0) {
    text += `\nGPU timers ${timer.total.toFixed(2)} ms${uncapped ? '' : ' (vsync-idle clocks)'}`;
    for (const [k, v] of Object.entries(timer.ms)) text += `\n  ${k.padEnd(9)} ${v.toFixed(3)} ms`;
  }
  if (bench) text += `\n${bench}`;
  hud.textContent = text;
  frames = 0;
  lastHud = now;
}

// auto quality ladder (PLAN 4): judged over 2 s windows of missed vsyncs; uniforms and sizes only
const auto = { n: -240, missed: 0, clean: 0, level: 0, cap30: false, odd: false, fx: 1 };
const LADDER = [
  () => { Q.auto.emission = 0.6; }, () => { Q.auto.steps = 0.6; }, () => { auto.fx = 0.66; makeTargets(); },
];
function autoQuality(ms) {
  if (ms > 250) return;
  if (++auto.n <= 0) return;
  if (ms > (auto.cap30 ? 40 : 20)) auto.missed++;
  if (auto.n < 120 || auto.cap30) return;
  const miss = auto.missed / auto.n;
  auto.n = auto.missed = 0;
  if (miss > 0.04) {
    auto.clean = 0;
    if (auto.level < LADDER.length) LADDER[auto.level++]();
    else if (Q.resolution > 0.5) setResolution(Q.resolution - 0.05);
    else if (miss > 0.25) auto.cap30 = true;
  } else if (miss <= 0.01 && ++auto.clean >= 3) {
    auto.clean = 0;
    if (Q.resolution < TIERS[Q.tier].resolution) setResolution(Q.resolution + 0.05);
  }
}
function setResolution(r) {
  Q.resolution = Math.round(r * 20) / 20;
  resCtrl.updateDisplay();
  resize();
  auto.n = -60;
}

function tick(now) {
  const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));   // a long synchronous ?shot runs past rAF's timestamp
  last = now;
  rig.restore(camera);
  if (camMove && !ui.paused) moveCam(dt);   // before the shake goes on, which restore() takes back off
  controls.update();
  rig.apply(camera, dt);
  if (ready && !ui.paused) {
    if (attract) {
      attractTimer -= dt;
      if (attractTimer <= 0) attractTimer = reelNext();
    } else if (ui.autoCast) {
      autoTimer -= dt;
      if (autoTimer <= 0) { autoTimer = ui.interval; castCurrent(); }
    }
    if (lab) runLab(dt);
  }
  renderFrame(dt);
  frames++;
  if (now - lastHud > 500) updateHud(now);
  drawPhase();
}

function loop(now) {
  if (uncapped) { spin(); return; }
  if (auto.cap30 && (auto.odd = !auto.odd)) { requestAnimationFrame(loop); return; }
  if (benchmarking || offline) last = now;   // a benchmark or a fixed-step take drives the frames itself
  else {
    if (ui.autoLadder) autoQuality(now - last);
    tick(now);
  }
  requestAnimationFrame(loop);
}

// uncapped: frames back-to-back off the display's clock, at most three in flight (UW)
const fences = [], chan = new MessageChannel();
chan.port1.onmessage = spin;
function spin() {
  if (!uncapped || document.hidden) {
    fences.splice(0).forEach((s) => gl.deleteSync(s));
    requestAnimationFrame(loop);
    return;
  }
  while (fences.length && gl.clientWaitSync(fences[0], 0, 0) !== gl.TIMEOUT_EXPIRED) gl.deleteSync(fences.shift());
  if (fences.length < 3 && !benchmarking) {
    tick(performance.now());
    fences.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
    gl.flush();
  }
  chan.port2.postMessage(0);
}

// --- start ---------------------------------------------------------------------------------------
resize();
sky.setPreset(env.timeOfDay);
applySun();
setView(ui.view);
selectEntry(ui.entry);
if (attract) { controls.autoRotate = true; controls.autoRotateSpeed = reel ? 0.2 : 0.35; }
if (reel || args.has('clean')) document.body.classList.add('reel', ...(args.has('clean') ? ['clean'] : []));   // &clean on a ?shot hides the chrome too
await warmup();
if (reel) {   // every spell compiled before the first frame of the take
  loading.textContent = 'Warming every spell…';
  for (const s of SPELLS) await warmSpell(s);
  if (args.has('record')) recorder.start('ultra-elements-reel', [caption, gui.domElement]);   // the captions and lab panel go in the take
}
ready = true;
loading.textContent = '';
if (!Q.mobile) backgroundWarm();
if (args.has('shot')) await runShot();
if (args.has('clips')) { document.body.classList.add('reel', 'clean'); runClips(args.get('clips')); }   // not awaited: the clips play on the frame loop
if (args.has('bench')) { await runBenchmark(args.get('bench')); }
if (args.has('benchall')) { $('perf').classList.add('open'); stopAttract(); benchAll(); }
last = performance.now();
requestAnimationFrame(loop);
