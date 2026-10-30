import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { ARENA, U, lights, impacts, packWorld } from '../src/vfx/common.js';
import { Q } from '../src/engine/quality.js';
import { bakeNoise } from '../src/vfx/noise.js';
import { SkySystem, SKY_PRESETS } from '../src/scene/sky.js';
import { createArena } from '../src/scene/arena.js';
import { PostFX } from '../src/engine/PostFX.js';
import { GpuTimer } from '../src/engine/gpuTimer.js';

// Scene sandbox: the arena alone, in main.js's pipeline (opaque MSAA HDR -> refract -> PostFX;
// no planar reflection, the arena reflects the sky cube), with fake spell lights, impacts, a
// painted ground field and dummy statuses so every material response can be looked at.
// ?mp=3.3 renders 3.3 MP whatever the window.
const args = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.info.autoReset = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

bakeNoise(renderer, Q);
const sky = new SkySystem(renderer);
sky.setPreset(args.get('tod') ?? 'dusk');
const scene = new THREE.Scene();
scene.environment = sky.cube;
scene.add(sky.background);
const arena = createArena({ renderer, sky });
scene.add(arena.group);
const refractScene = new THREE.Scene();
refractScene.add(arena.refractGroup);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(3.2, 3.0, 18.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
U.uNearFar.value.set(camera.near, camera.far);

const post = new PostFX(renderer);
let hdrRT = null;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const mp = parseFloat(args.get('mp'));
  renderer.setPixelRatio(mp ? Math.sqrt((mp * 1e6) / (w * h)) : Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  hdrRT?.dispose();
  hdrRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType, samples: Q.msaa, generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
  });
  U.uSceneColor.value = hdrRT.texture;
  U.uSceneDepth.value = hdrRT.depthTexture;
  U.uResolution.value.copy(size);
  post.setSize(size.x, size.y);
}
window.addEventListener('resize', resize);
resize();

// --- fake ground field: blobs of every channel, ragged by noise ------------------------------
const GN = 160;
const gA = new Float32Array(GN * GN * 4), gB = new Float32Array(GN * GN * 4);
const texA = new THREE.DataTexture(gA, GN, GN, THREE.RGBAFormat, THREE.FloatType);
const texB = new THREE.DataTexture(gB, GN, GN, THREE.RGBAFormat, THREE.FloatType);
for (const t of [texA, texB]) { t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; }
U.uGroundA.value = texA;
U.uGroundB.value = texB;
const field = { heat: 1, char: 1, wet: 1, frost: 1, crack: 1, acid: 1, corruption: 1, glow: 1 };
// [buffer, channel, x, z, radius, amount, key]
const BLOBS = [
  [gA, 0, -7, 5, 2.0, 1.0, 'heat'], [gA, 1, -7, 5, 2.8, 0.9, 'char'],
  [gA, 2, -2.5, 7, 2.2, 1.0, 'wet'], [gA, 2, 2.2, 7, 1.6, 0.9, 'wet'], [gA, 3, 2.2, 7, 2.6, 1.4, 'frost'],
  [gB, 0, 6.5, 5, 2.6, 1.0, 'crack'], [gA, 0, 6.5, 5, 1.6, 0.75, 'heat'],
  [gB, 1, -5.5, -1, 2.0, 1.0, 'acid'], [gB, 2, 5, -1.5, 2.6, 1.2, 'corruption'], [gB, 3, -7.5, -6, 2.0, 1.0, 'glow'],
  [gA, 3, 9.75, 2.6, 2.6, 1.3, 'frost'], [gB, 1, 9.75, -3, 2.0, 1.0, 'acid'],
];
const hn = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
const vn = (x, z) => {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hn(xi, zi), b = hn(xi + 1, zi), c = hn(xi, zi + 1), d = hn(xi + 1, zi + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
};
function paintField() {
  gA.fill(0); gB.fill(0);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const x = ARENA.ground.min.x + ((i + 0.5) / GN) * ARENA.ground.size, z = ARENA.ground.min.y + ((j + 0.5) / GN) * ARENA.ground.size;
    const n = vn(x * 1.3, z * 1.3) * 0.6 + vn(x * 3.1, z * 3.1) * 0.4;
    for (const [buf, ch, bx, bz, r, amt, key] of BLOBS) {
      const d = Math.hypot(x - bx, z - bz) / r + (n - 0.5) * 0.5;
      const v = amt * field[key] * THREE.MathUtils.smoothstep(1 - d, 0, 0.45);
      const o = (j * GN + i) * 4 + ch;
      buf[o] = Math.max(buf[o], v);
    }
  }
  texA.needsUpdate = texB.needsUpdate = true;
}
paintField();

// --- fake spell lights and impacts -----------------------------------------------------------
const hold = [];   // [dummy, status, value] re-applied every frame (console: app.hold.push([0, 'burn', 1]))
const fake = { lights: 5, shadowed: 2, intensity: 6, move: true, impacts: true, rain: false, swirl: false };
const fakeLights = [];
const LIGHT_KINDS = [
  { color: new THREE.Color(1.0, 0.45, 0.12), type: 0 },          // fire
  { color: new THREE.Color(0.45, 0.6, 1.0), type: 1 },           // lightning line
  { color: new THREE.Color(0.3, 0.75, 1.0), type: 2, cookie: [1, 0.8, 0, 0] },   // caustic cookie
  { color: new THREE.Color(0.7, 0.25, 1.0), type: 0 },           // arcane
  { color: new THREE.Color(1.0, 0.85, 0.5), type: 2, cookie: [2, 0.5, 0, 0] },   // rune ring
  { color: new THREE.Color(0.3, 1.0, 0.25), type: 0 },           // acid
];
function syncLights() {
  while (fakeLights.length > fake.lights) fakeLights.pop().release();
  while (fakeLights.length < fake.lights) {
    const l = lights.acquire();
    if (!l) break;
    l.k = LIGHT_KINDS[fakeLights.length % LIGHT_KINDS.length];
    fakeLights.push(l);
  }
  fakeLights.forEach((l, i) => Object.assign(l, { type: l.k.type, range: 9, shadow: i < fake.shadowed, cookie: l.k.cookie ?? [0, 1, 0, 0] }));
}
syncLights();
function moveLights(t) {
  fakeLights.forEach((l, i) => {
    const a = t * (fake.move ? 0.25 + i * 0.03 : 0) + i * 2.4, r = 4 + (i % 4) * 2.2;
    l.pos.set(Math.cos(a) * r, 1.2 + (i % 3) * 0.6, Math.sin(a) * r - 1);
    l.color.copy(l.k.color);
    l.intensity = fake.intensity * (l.type === 1 ? 2 : 1);
    if (l.type === 1) { l.end.copy(l.pos); l.pos.y = 9; l.end.y = 0.05; }
    if (l.type === 2) { l.pos.y = 3; l.cookie[2] = t * 0.3; }
  });
}
function addImpacts() {
  impacts.clear();
  if (!fake.impacts) return;
  const P = ARENA.pillars, life = 1e7;
  impacts.add('scorch', P[2].clone().setY(1.2), 1.6, 1, life);
  impacts.add('magma', P[2].clone().setY(0.3), 1.0, 1, life);
  impacts.add('frost', P[1].clone().setY(1.5), 1.8, 1, life);
  impacts.add('acid', P[3].clone().setY(1.0), 1.5, 1, life);
  impacts.add('holy', P[0].clone().setY(2.5), 1.6, 1, life, new THREE.Color(1, 0.8, 0.45));
  impacts.add('corruption', P[4].clone().setY(1.5), 1.8, 1, life);
  impacts.add('electric', P[7].clone().setY(1.5), 1.8, 1, life, new THREE.Color(0.5, 0.7, 1));
  impacts.add('wet', P[6].clone().setY(1.0), 1.8, 1, life);
  impacts.add('scorch', new THREE.Vector3(-17.5, 0.8, -6), 2.2, 1, life);   // the rim
  impacts.add('frost', new THREE.Vector3(0, 1.0, 12), 0.9, 0.7, life);     // the pedestal
}
addImpacts();

// --- GUI -------------------------------------------------------------------------------------
const gui = new GUI({ title: 'Scene sandbox' });
const ui = { tod: sky.preset, exposure: 1, focus: '#ffb86b', focusI: 1 };
gui.add(ui, 'tod', Object.keys(SKY_PRESETS)).name('time of day').onChange((v) => { sky.setPreset(v); arena.updateSun(); gui.controllersRecursive().forEach((c) => c.updateDisplay()); });
gui.add(sky.params, 'elevation', -20, 80, 0.1).onFinishChange(() => { sky.update(); arena.updateSun(); });
gui.add(sky.params, 'azimuth', 0, 360, 0.5).onFinishChange(() => { sky.update(); arena.updateSun(); });
gui.addColor(ui, 'focus').onChange(() => arena.setFocus(new THREE.Color(ui.focus), ui.focusI));
gui.add(ui, 'focusI', 0, 5, 0.01).name('focus intensity').onChange(() => arena.setFocus(new THREE.Color(ui.focus), ui.focusI));
gui.add(ui, 'exposure', 0.2, 4, 0.01).onChange((v) => (post.params.exposure = v));
const fL = gui.addFolder('Spell lights & impacts');
fL.add(fake, 'lights', 0, 15, 1).onChange(syncLights);
fL.add(fake, 'shadowed', 0, 4, 1).onChange(syncLights);
fL.add(fake, 'intensity', 0, 40, 0.1);
fL.add(fake, 'move');
fL.add(fake, 'impacts').onChange(addImpacts);
const fF = gui.addFolder('Ground field');
for (const k of Object.keys(field)) fF.add(field, k, 0, 1.5, 0.01).onFinishChange(paintField);
const fD = gui.addFolder('Dummies');
arena.dummies.forEach((d, i) => {
  const f = fD.addFolder(`dummy ${i + 1}`);
  for (const k of Object.keys(d.status)) f.add(d.status, k, 0, 1, 0.01).listen();
  f.add({ hit: () => d.hit(new THREE.Vector3(0, 0, -1), 1) }, 'hit');
  f.close();
});
const fP = gui.addFolder('Pool');
fP.add(fake, 'rain');
fP.add(fake, 'swirl');
fP.add({ flash: () => arena.pool.flash(new THREE.Color(0.5, 0.7, 1), 6) }, 'flash');
fP.add({ drop: () => arena.pool.ripple(ARENA.pool.center.x, ARENA.pool.center.y, 0.04, 0.5) }, 'drop');
gui.add({ bench: () => bench() }, 'bench').name('benchmark (200 frames)');

// click: ripple the pool, or hit a dummy
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY, performance.now()]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || performance.now() - down[2] > 250) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(arena.dummies.map((d) => d.mesh))[0];
  if (hit) { arena.dummies.find((d) => d.mesh === hit.object).hit(ray.ray.direction, 1); return; }
  const t = (ARENA.pool.water - ray.ray.origin.y) / ray.ray.direction.y;
  if (t > 0) { const p = ray.ray.at(t, new THREE.Vector3()); arena.pool.ripple(p.x, p.z, 0.03, 0.35); }
});

// --- frame -----------------------------------------------------------------------------------
const gl = renderer.getContext();
const timer = new GpuTimer(gl);
const hud = document.getElementById('hud');
let last = performance.now(), frames = 0, lastHud = last, benchText = '';
function renderFrame(dt) {
  renderer.info.reset();
  U.uTime.value = (U.uTime.value + dt) % 3600;
  U.uDt.value = dt;
  U.uFrame.value++;
  moveLights(U.uTime.value);
  if (fake.rain && Math.random() < 0.5) {
    const P = ARENA.pool;
    arena.pool.ripple(P.center.x + (Math.random() - 0.5) * P.half.x * 2, P.center.y + (Math.random() - 0.5) * P.half.y * 2, 0.006, 0.08);
  }
  if (fake.swirl) arena.pool.swirl(ARENA.pool.center.x, ARENA.pool.center.y, 1);
  for (const [i, k, v] of hold) arena.dummies[i].status[k] = v;   // keep statuses up while looking
  packWorld(dt, { maxLights: Q.maxLights, maxShadowed: Q.shadowLights });

  timer.beginFrame();
  timer.begin('pool');
  arena.update(renderer, dt, camera);
  timer.begin('opaque');
  renderer.setRenderTarget(hdrRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  timer.begin('refract');
  renderer.render(refractScene, camera);
  timer.begin('post');
  post.render(hdrRT.texture, dt);
  timer.endFrame();
}

async function gpuFence() {
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  while (gl.clientWaitSync(s, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise((r) => setTimeout(r, 1));
  gl.deleteSync(s);
}
let benchmarking = false;
async function bench(n = 200) {
  benchmarking = true;
  timer.drain();
  for (let i = 0; i < 10; i++) renderFrame(1 / 120);
  await gpuFence();
  timer.drain();
  timer.keep = true;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) renderFrame(1 / 120);
  await gpuFence();
  const ms = (performance.now() - t0) / n;
  const passes = timer.drain();
  timer.keep = false;
  benchmarking = false;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  benchText = `bench ${size.x}x${size.y} (${(size.x * size.y / 1e6).toFixed(2)} MP): ${ms.toFixed(2)} ms/frame\n`
    + Object.entries(passes).map(([k, v]) => `  ${k.padEnd(8)} ${v.toFixed(3)} ms`).join('\n');
  console.log(benchText);
  return { ms, passes, mp: size.x * size.y / 1e6 };
}

function tick(now) {
  requestAnimationFrame(tick);
  if (benchmarking) { last = now; return; }
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  controls.update();
  renderFrame(dt);
  frames++;
  if (now - lastHud > 500) {
    const fps = frames * 1000 / (now - lastHud);
    let t = `${fps.toFixed(0)} fps  ${renderer.info.render.calls} draws  ${(renderer.info.render.triangles / 1e3).toFixed(0)}k tris\n`;
    if (timer.available) for (const [k, v] of Object.entries(timer.ms)) t += `  ${k.padEnd(8)} ${v.toFixed(3)} ms\n`;
    hud.textContent = t + benchText;
    frames = 0; lastHud = now;
  }
}
requestAnimationFrame(tick);
// console: app.view([x, y, z], [tx, ty, tz])
function view(p, t) { camera.position.set(...p); controls.target.set(...t); controls.update(); }
window.app = { view, hold, renderer, scene, camera, controls, sky, arena, post, timer, fake, field, bench, U, lights, impacts, paintField, syncLights, addImpacts, renderFrame };
