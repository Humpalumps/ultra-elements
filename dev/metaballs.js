// Metaballs / refraction sandbox. Not part of the app build: open /dev/metaballs.html.
//   ?mp=3.3  render at a fixed 16:9 drawing buffer of that many megapixels (timing at the budget size)
// Same pass order as main.js: opaque into a 4x MSAA HalfFloat target with a depth texture, then the
// refract scene into the same target (sampling the opaque resolve), then tone mapping to the canvas.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { GpuTimer } from '../src/engine/gpuTimer.js';
import { PostFX } from '../src/engine/PostFX.js';
import { Q } from '../src/engine/quality.js';
import { SkySystem } from '../src/scene/sky.js';
import { U, lights, packWorld } from '../src/vfx/common.js';
import { bakeNoise } from '../src/vfx/noise.js';
import { Metaballs, METABALL_PRESETS, metaballsSelfCheck } from '../src/vfx/Metaballs.js';

console.info(metaballsSelfCheck());
const args = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.toneMapping = THREE.AgXToneMapping;
const canvas = renderer.domElement;
document.body.appendChild(canvas);
const gl = renderer.getContext();

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(0.4, 2.1, 6.2);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.1, -0.4);
controls.enableDamping = true;
U.uNearFar.value.set(camera.near, camera.far);

// --- sky, noise -------------------------------------------------------------------------------------
const sky = new SkySystem(renderer);
bakeNoise(renderer, Q);
U.uSkyCube.value = sky.cube;

// --- opaque scene: stone floor, striped pillars, coloured props -------------------------------------
const opaque = new THREE.Scene();
opaque.environment = sky.cube;
opaque.add(sky.background);

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}
// 8x8 flagstones with mortar and speckle; 1 m tiles over the 40 m floor
const stone = canvasTexture(1024, 1024, (g) => {
  g.fillStyle = '#1c1a18';
  g.fillRect(0, 0, 1024, 1024);
  let s = 3;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = (x + y) % 2 ? 118 + rnd() * 30 : 70 + rnd() * 24;
    g.fillStyle = `rgb(${v | 0},${(v * 0.95) | 0},${(v * 0.88) | 0})`;
    g.fillRect(x * 128 + 4, y * 128 + 4, 120, 120);
    for (let k = 0; k < 160; k++) {
      const d = (rnd() - 0.5) * 50;
      g.fillStyle = `rgba(${(v + d) | 0},${(v * 0.95 + d) | 0},${(v * 0.88 + d) | 0},0.5)`;
      g.fillRect(x * 128 + 4 + rnd() * 116, y * 128 + 4 + rnd() * 116, 2 + rnd() * 5, 2 + rnd() * 5);
    }
  }
}, [5, 5]);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: stone, roughness: 0.55 }));
floor.rotation.x = -Math.PI / 2;
opaque.add(floor);

const stripes = canvasTexture(16, 256, (g) => {
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#e8e4dc' : '#1a1a1e'; g.fillRect(0, i * 16, 16, 16); }
}, [1, 3]);
for (let i = 0; i < 5; i++) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.2, 32), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.4 }));
  p.position.set(-3.2 + i * 1.6, 1.6, -2.8);
  p.rotation.z = (i - 2) * 0.06;
  opaque.add(p);
}
const props = [
  [new THREE.BoxGeometry(0.8, 0.8, 0.8), 0xc0281c, [1.6, 0.4, -1.3], 0.5],
  [new THREE.SphereGeometry(0.45, 48, 24), 0xe0b020, [-1.0, 0.45, -1.6], 0.3],
  [new THREE.TorusKnotGeometry(0.35, 0.12, 160, 24), 0x2058e0, [0.3, 0.9, -1.9], 0.25],
  [new THREE.BoxGeometry(0.5, 1.6, 0.5), 0x30a050, [-2.6, 0.8, -1.2], 0.6],
];
for (const [geo, color, pos, rough] of props) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  m.position.fromArray(pos);
  opaque.add(m);
}
const sun = new THREE.DirectionalLight();
opaque.add(sun, sun.target);

// spell lights: in the world texture for the metaballs, mirrored as three lights for the props
const spell = [
  { color: new THREE.Color(0.25, 1.0, 0.12), intensity: 4, range: 6 },   // acid orb glow
  { color: new THREE.Color(0.5, 0.85, 1.0), intensity: 3, range: 5 },    // whip head
].map((s) => {
  const l = lights.acquire();
  Object.assign(l, { intensity: s.intensity, range: s.range });
  l.color.copy(s.color);
  const p = new THREE.PointLight(s.color, s.intensity, s.range, 2);
  opaque.add(p);
  return { l, p };
});

function applySky(name) {
  sky.setPreset(name);
  U.uSunDir.value.copy(sky.sunDir);
  U.uSunColor.value.copy(sky.sunColor);
  U.uAmbient.value.copy(sky.ambient);
  sun.color.copy(sky.lightColor);
  sun.intensity = sky.lightIntensity;
  sun.position.copy(sky.lightDir).multiplyScalar(20);
}

// --- refract scene: the metaballs ---------------------------------------------------------------------
const refract = new THREE.Scene();
const metaballs = new Metaballs({ max: 4, spheres: 16 });
refract.add(metaballs.group);
const whip = metaballs.acquire({ preset: 'water' });
const orb = metaballs.acquire({ preset: 'acid' });
whip.count = 16;
orb.count = 6;

// a whip of 16 spheres along a moving Catmull-Rom spline (head = sphere 0), and a wobbling orb
const ctrl = Array.from({ length: 6 }, () => new THREE.Vector3());
const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
const _p = new THREE.Vector3();
const anim = { play: true, speed: 1, whipRadius: 0.26, whipLength: 4.6, bulge: 0.18 };
function animate(t) {
  for (let j = 0; j < ctrl.length; j++) {
    const u = j / (ctrl.length - 1);
    ctrl[j].set(
      1.9 - u * anim.whipLength + 0.25 * Math.sin(t * 1.3 + u * 2.0),
      1.25 + 0.45 * Math.sin(t * 2.2 - u * 4.5) * (0.3 + u) - 0.25 * u,
      0.2 + 0.7 * Math.sin(t * 1.6 - u * 3.8) * u,
    );
  }
  for (let i = 0; i < 16; i++) {
    const u = i / 15;
    curve.getPoint(u, _p);
    const r = anim.whipRadius * (1 - 0.62 * u) * (1 + anim.bulge * Math.sin(u * 14 - t * 9));
    whip.set(i, _p.x, _p.y, _p.z, r);
  }
  const ox = -2.0, oy = 1.45 + 0.12 * Math.sin(t * 1.4), oz = 0.9;
  orb.set(0, ox, oy, oz, 0.42);
  for (let i = 1; i < 6; i++) {
    const a = t * (0.7 + i * 0.13) + i * 2.4, b = t * 0.9 + i * 1.7;
    const d = 0.3 + 0.08 * Math.sin(t * 2.3 + i);
    orb.set(i, ox + d * Math.cos(a) * Math.cos(b), oy + d * Math.sin(b), oz + d * Math.sin(a) * Math.cos(b), 0.18 + 0.05 * Math.sin(t * 1.9 + i * 3.1));
  }
  spell[0].l.pos.set(ox, oy, oz);
  spell[1].l.pos.set(whip.data[0], whip.data[1], whip.data[2]);
  for (const s of spell) s.p.position.copy(s.l.pos);
}

// --- targets, tone mapping: the app's PostFX (auto exposure, bloom, AgX look) or a plain AgX blit --------
const post = new PostFX(renderer);
let hdrRT = null;
const size = new THREE.Vector2();
const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
function resize() {
  const mp = +args.get('mp');
  if (mp > 0) {
    const h = Math.round(Math.sqrt(mp * 1e6 * 9 / 16));
    renderer.setPixelRatio(1);
    renderer.setSize(Math.round(h * 16 / 9), h, false);
  } else {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight, false);
  }
  renderer.getDrawingBufferSize(size);
  camera.aspect = size.x / size.y;
  camera.updateProjectionMatrix();
  hdrRT?.dispose();
  hdrRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType, samples: 4, generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
  });
  U.uSceneColor.value = hdrRT.texture;
  U.uSceneDepth.value = hdrRT.depthTexture;
  U.uResolution.value.copy(size);
  blit.material.map = hdrRT.texture;
  post.setSize(size.x, size.y);
  blit.material.needsUpdate = true;
}
addEventListener('resize', resize);
resize();

// --- GUI --------------------------------------------------------------------------------------------------
const ui = { sky: 'dusk', post: true, exposure: 1, debug: 'off', uncapped: false, coverage: '' };
applySky(ui.sky);
const gui = new GUI({ title: 'metaballs' });
gui.add(ui, 'sky', ['dusk', 'noon', 'night']).onChange(applySky);
gui.add(ui, 'post').name('PostFX (else AgX blit)');
gui.add(ui, 'exposure', 0.1, 6, 0.01);
gui.add(ui, 'debug', { off: 0, steps: 1, proxy: 2, thickness: 4 }).onChange((v) => { metaballs.debug.value = +v; });
gui.add(Q, 'volumeSteps', 8, 32, 1).name('Q.volumeSteps');
gui.add(ui, 'uncapped').onChange((v) => v && spin());
gui.add({ measure }, 'measure').name('measure coverage');
gui.add({ benchmark: () => benchmark().then((r) => { ui.coverage = JSON.stringify(r); }) }, 'benchmark').name('benchmark refract');
gui.add({ view: 'overview' }, 'view', ['overview', 'whip close', 'acid close', 'acid front', 'bench']).onChange((v) => view(v));

function handleFolder(name, h, preset) {
  const f = gui.addFolder(name);
  const s = { preset, clarity: 1, glow: 1 };
  const base = { absorption: new THREE.Color(), emission: new THREE.Color() };
  const apply = () => {
    h.absorption.copy(base.absorption).multiplyScalar(1 / s.clarity);
    h.emission.copy(base.emission).multiplyScalar(s.glow);
  };
  const load = () => {
    const p = METABALL_PRESETS[s.preset];
    Object.assign(h, { k: p.k, wobble: p.wobble, bubbles: p.bubbles, corrosion: p.corrosion, ior: p.ior, roughness: p.roughness, refraction: p.refraction, rim: p.rim, turbidity: p.turbidity });
    h.scatterColor.fromArray(p.scatterColor);
    base.absorption.fromArray(p.absorption);
    base.emission.fromArray(p.emission);
    apply();
    f.controllersRecursive().forEach((c) => c.updateDisplay());
  };
  f.add(s, 'preset', Object.keys(METABALL_PRESETS)).onChange(load);
  f.add(h, 'visible');
  f.add(h, 'k', 0.01, 0.8, 0.005).name('k (blend m)');
  f.add(h, 'wobble', 0, 0.06, 0.001);
  f.add(h, 'bubbles', 0, 1, 0.01);
  f.add(h, 'corrosion', 0, 1, 0.01);
  f.add(h, 'refraction', 0, 4, 0.01);
  f.add(h, 'roughness', 0.005, 0.4, 0.001);
  f.add(h, 'ior', 1, 1.8, 0.01);
  f.add(h, 'rim', 0, 3, 0.01);
  f.add(h, 'turbidity', 0, 10, 0.01);
  f.add(h, 'intensity', 0, 3, 0.01);
  f.add(s, 'clarity', 0.1, 4, 0.01).onChange(apply);
  f.add(s, 'glow', 0, 4, 0.01).name('emission x').onChange(apply);
  load();
  return f;
}
handleFolder('water whip', whip, 'water');
handleFolder('acid orb', orb, 'acid');
const fa = gui.addFolder('animation');
fa.add(anim, 'play');
fa.add(anim, 'speed', 0, 3, 0.01);
fa.add(anim, 'whipRadius', 0.05, 0.6, 0.005);
fa.add(anim, 'whipLength', 1, 8, 0.01);
fa.add(anim, 'bulge', 0, 0.5, 0.01);

// --- coverage: clear + empty render resolves a cleared depth, then the refract scene alone; count
// written pixels (alpha = coverage) in the resolve. Proxy = box fragments that ran the shader.
const empty = new THREE.Scene();
function countPass(debug) {
  metaballs.update();
  renderer.setRenderTarget(hdrRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(empty, camera);
  const prev = metaballs.debug.value;
  metaballs.debug.value = debug;
  renderer.render(refract, camera);
  metaballs.debug.value = prev;
  const buf = new Uint16Array(size.x * size.y * 4);
  renderer.readRenderTargetPixels(hdrRT, 0, 0, size.x, size.y, buf);
  let n = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) n++;
  return n;
}
function measure() {
  const total = size.x * size.y;
  const vis = [whip.visible, orb.visible];
  orb.visible = false;
  const w = countPass(3), wp = countPass(2);
  orb.visible = vis[1]; whip.visible = false;
  const o = countPass(3);
  whip.visible = vis[0];
  const pct = (x) => (100 * x / total).toFixed(1) + '%';
  ui.coverage = `whip ${pct(w)} (proxy ${pct(wp)})  orb ${pct(o)}`;
  console.info('coverage', ui.coverage, `of ${total} px`);
  return { whip: w / total, whipProxy: wp / total, orb: o / total };
}
const VIEWS = {
  overview: [0.4, 2.1, 6.2, 0, 1.1, -0.4],
  'whip close': [1.2, 1.6, 2.6, 0.2, 1.2, 0.2],
  'acid close': [-1.2, 1.7, -1.4, -2.0, 1.45, 0.9],
  'acid front': [-1.4, 1.6, 2.9, -2.0, 1.45, 0.9],
  bench: [0.2, 1.7, 3.3, -0.1, 1.2, 0.0],
};
function view(name) {
  const v = VIEWS[name];
  camera.position.set(v[0], v[1], v[2]);
  controls.target.set(v[3], v[4], v[5]);
  controls.update();
}
const bench = () => view('bench');

// march statistics of one handle: pixels marched, full hits, mean steps and spheres per ray
// (debug view 'stats' writes steps, list length, coverage; read back from the resolve)
const half = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e ? s * 2 ** (e - 15) * (1 + m / 1024) : s * 2 ** -14 * (m / 1024); };
function marchStats(h = whip) {
  const others = metaballs.handles.filter((x) => x !== h).map((x) => [x, x.visible]);
  for (const [x] of others) x.visible = false;
  countPass(5);
  for (const [x, v] of others) x.visible = v;
  const buf = new Uint16Array(size.x * size.y * 4);
  renderer.readRenderTargetPixels(hdrRT, 0, 0, size.x, size.y, buf);
  let n = 0, steps = 0, list = 0, hits = 0;
  for (let i = 0; i < buf.length; i += 4) {
    if (!buf[i + 3]) continue;
    n++; steps += half(buf[i]); list += half(buf[i + 1]);
    if (half(buf[i + 2]) > 0.99) hits++;
  }
  return { marched: +(n / (size.x * size.y)).toFixed(3), hits: +(hits / (size.x * size.y)).toFixed(3), steps: +(steps / n).toFixed(2), spheres: +(list / n).toFixed(2) };
}

// GPU cost of the refract pass: a raw timer query around it for many frames. Other pages on the
// same GPU only ever add time, so the low percentiles are the real cost. 'none' = the pass with
// no metaballs (its MSAA resolve), which the per-handle numbers include.
async function fence() {
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  while (gl.clientWaitSync(s, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise((r) => setTimeout(r, 1));
  gl.deleteSync(s);
}
async function benchmark(frames = 120) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return 'no EXT_disjoint_timer_query_webgl2';
  ui.benching = true;
  const vis = [whip.visible, orb.visible], out = {};
  for (const [name, w, o] of [['none', false, false], ['whip', true, false], ['orb', false, true], ['both', true, true]]) {
    whip.visible = w; orb.visible = o;
    const qs = [];
    for (let i = 0; i < frames; i++) {
      if (anim.play) simT += anim.speed / 60;
      U.uTime.value = simT % 3600;
      U.uFrame.value++;
      animate(simT);
      packWorld(1 / 60);
      metaballs.update();
      renderer.setRenderTarget(hdrRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(opaque, camera);
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      renderer.render(refract, camera);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      qs.push(q);
      if (i % 3 === 2) await fence();   // at most 3 frames in flight
    }
    await fence();
    while (!gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE)) await new Promise((r) => setTimeout(r, 2));
    const ms = qs.map((q) => { const v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q); return v; }).sort((a, b) => a - b);
    const at = (f) => +ms[Math.floor(f * (ms.length - 1))].toFixed(3);
    out[name] = { min: at(0), p10: at(0.1), median: at(0.5) };
  }
  [whip.visible, orb.visible] = vis;
  ui.benching = false;
  out.coverage = measure();
  out.steps = metaballs.steps.value;
  out.size = `${size.x}x${size.y}`;
  console.info('refract benchmark (ms)', JSON.stringify(out));
  return out;
}

// --- frame ------------------------------------------------------------------------------------------------
const timer = new GpuTimer(gl);
const hud = document.getElementById('hud');
let simT = 0, last = performance.now(), frames = 0, lastHud = last;

function renderFrame(dt) {
  controls.update();
  if (anim.play) simT += dt * anim.speed;
  U.uTime.value = simT % 3600;
  U.uDt.value = dt;
  U.uFrame.value++;
  animate(simT);
  packWorld(dt);
  metaballs.update();

  timer.beginFrame();
  timer.begin('opaque');
  renderer.setRenderTarget(hdrRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(opaque, camera);
  timer.begin('refract');
  renderer.render(refract, camera);
  timer.begin('post');
  if (ui.post) {
    post.params.exposure = ui.exposure;
    post.render(hdrRT.texture, dt);
  } else {
    renderer.setRenderTarget(null);
    renderer.toneMappingExposure = ui.exposure;
    renderer.render(blit, blitCam);
  }
  timer.endFrame();
}

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  renderFrame(dt);
  frames++;
  if (now - lastHud > 500) {
    let t = `${size.x}x${size.y} (${(size.x * size.y / 1e6).toFixed(2)} MP)  ${(frames * 1000 / (now - lastHud)).toFixed(0)} fps${ui.uncapped ? ' uncapped' : ''}  steps ${metaballs.steps.value}`;
    if (timer.available) for (const [k, v] of Object.entries(timer.ms)) t += `\n${k.padEnd(8)} ${v.toFixed(3)} ms`;
    else t += '\nno EXT_disjoint_timer_query_webgl2';
    if (ui.coverage) t += `\n${ui.coverage}`;
    hud.textContent = t;
    frames = 0;
    lastHud = now;
  }
}

function loop(now) {
  if (ui.uncapped) return;
  if (!ui.benching) tick(now);
  requestAnimationFrame(loop);
}

// uncapped: frames back-to-back with at most 3 in flight (UW), so GPU clocks and timers read true
const fences = [], chan = new MessageChannel();
chan.port1.onmessage = spin;
function spin() {
  if (!ui.uncapped || document.hidden) {
    fences.splice(0).forEach((f) => gl.deleteSync(f));
    ui.uncapped = false;
    requestAnimationFrame(loop);
    return;
  }
  while (fences.length && gl.clientWaitSync(fences[0], 0, 0) !== gl.TIMEOUT_EXPIRED) gl.deleteSync(fences.shift());
  if (fences.length < 3) {
    tick(performance.now());
    fences.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
    gl.flush();
  }
  chan.port2.postMessage(0);
}

window.app = { setTime: (t) => { simT = t; }, marchStats, renderer, post, camera, controls, metaballs, whip, orb, timer, ui, anim, measure, bench, benchmark, view, Q, U, refract, opaque, hdrRT: () => hdrRT };
requestAnimationFrame(loop);
