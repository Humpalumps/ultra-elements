// Spikes + sigils sandbox. Not part of the app build: open /dev/spikes.html.
//   ?mp=3.3  render at a fixed 16:9 drawing buffer of that many megapixels (timing at the budget size)
// Pipeline as main.js: opaque (floor, pillars, rock spikes) into a 4x MSAA HalfFloat target with a
// DepthTexture -> refract (ice; samples the resolved colour/depth while drawing into the MSAA
// renderbuffer) -> lines (sigils, additive) -> PostFX.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { PostFX } from '../src/engine/PostFX.js';
import { GpuTimer } from '../src/engine/gpuTimer.js';
import { SkySystem } from '../src/scene/sky.js';
import { bakeNoise } from '../src/vfx/noise.js';
import { U, COMMON_GLSL, WORLD_GLSL, LIGHTS_GLSL, IMPACTS_GLSL, lights, impacts, occluders, packWorld } from '../src/vfx/common.js';
import { Spikes } from '../src/vfx/Spikes.js';
import { Sigils } from '../src/vfx/Sigils.js';

const args = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
const canvas = renderer.domElement;
document.body.appendChild(canvas);
const gl = renderer.getContext();

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(1.5, 4.2, 11.5);
U.uNearFar.value.set(camera.near, camera.far);

// --- world ----------------------------------------------------------------------------------
const opaque = new THREE.Scene(), refract = new THREE.Scene(), linesScene = new THREE.Scene();
const sky = new SkySystem(renderer);
sky.setPreset(args.get('tod') || 'dusk');
bakeNoise(renderer);
opaque.environment = refract.environment = sky.cube;
U.uSkyCube.value = sky.cube;
opaque.add(sky.background);
const sun = new THREE.DirectionalLight(0xffffff, 1);
opaque.add(sun, sun.target);
function applySun() {
  sky.update();
  sun.position.copy(sky.lightDir).multiplyScalar(50);
  sun.color.copy(sky.lightColor);
  sun.intensity = sky.lightIntensity;
  U.uSunDir.value.copy(sky.sunDir);
  U.uSunColor.value.copy(sky.sunColor);
  U.uAmbient.value.copy(sky.ambient);
}
applySun();

// polished basalt tiles + spell lights + capsule shadows + impacts (stand-in for the arena floor)
const LIT = /* glsl */`
{
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 wP = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
  vec3 sd, ss;
  spellLightPBR(wP, wN, normalize(cameraPosition - wP), material.roughness, material.specularColor, material.diffuseColor, sd, ss);
  reflectedLight.directDiffuse += sd;
  reflectedLight.directSpecular += ss;
}`;
function litMaterial(tiles) {
  const m = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: tiles ? 0.3 : 0.8, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + WORLD_GLSL + LIGHTS_GLSL + IMPACTS_GLSL + 'float gGrout; float gTileR;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wP = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
  ${tiles ? `
  vec2 t = wP.xz / 1.2, f = abs(fract(t) - 0.5);
  float fw = fwidth(t.x) + fwidth(t.y);
  gGrout = smoothstep(0.485 - fw, 0.485 + fw, max(f.x, f.y));
  float h = hash12(floor(t));
  gTileR = mix(0.12, 0.4, h);
  diffuseColor.rgb = mix(vec3(0.035, 0.034, 0.036) * (0.75 + 0.5 * h), vec3(0.012), gGrout);` : 'gGrout = 0.0; gTileR = 0.8; diffuseColor.rgb = vec3(0.05, 0.048, 0.046);'}
  vec4 wa, wb; vec3 gc;
  impactWeights(wP, wa, wb, gc);
  diffuseColor.rgb *= 1.0 - 0.6 * clamp(wa.x, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.7, 0.8), clamp(wa.y, 0.0, 1.0) * 0.7);
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(gTileR, 0.85, gGrout);')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + LIT);
  };
  m.customProgramCacheKey = () => 'spikes-sandbox-' + tiles;
  return m;
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), litMaterial(true));
floor.rotation.x = -Math.PI / 2;
opaque.add(floor);
const pillarMat = litMaterial(false);
for (const [x, z] of [[-9, -8], [0, -10], [9, -8]]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 6, 24), pillarMat);
  p.position.set(x, 3, z);
  opaque.add(p);
  occluders.add(new THREE.Vector3(x, 0.6, z), new THREE.Vector3(x, 5.4, z), 0.6, 0);
}

const spikes = new Spikes({ max: 48 });
opaque.add(spikes.opaque);
refract.add(spikes.refract);
const sigils = new Sigils({ max: 8 });
const sigilGroup = new THREE.Group();
sigilGroup.add(sigils.mesh);
linesScene.add(sigilGroup);

// spell lights (common.js pool, packed into the world texture every frame)
const L = {
  key: lights.acquire(), magma: lights.acquire(), frost: lights.acquire(), holy: lights.acquire(),
};
Object.assign(L.key, { range: 16, intensity: 30, shadow: true });
L.key.color.setRGB(1, 0.85, 0.7);
Object.assign(L.magma, { range: 7, intensity: 0, shadow: true });
L.magma.color.setRGB(1, 0.35, 0.08);
L.magma.pos.set(-0.8, 0.9, -0.5);
Object.assign(L.frost, { range: 8, intensity: 10, shadow: true });
L.frost.color.setRGB(0.35, 0.75, 1);
L.frost.pos.set(5.5, 3.2, -1);
Object.assign(L.holy, { range: 7, intensity: 0, shadow: false });
L.holy.pos.set(-5.5, 1.8, 0);

// --- pipeline -------------------------------------------------------------------------------
const post = new PostFX(renderer);
let hdrRT = null;
const size = new THREE.Vector2();
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
  post.setSize(size.x, size.y);
}
addEventListener('resize', resize);
resize();

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, -1);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();

// --- spells (what Earth / Ice / Light / Arcane will do) ----------------------------------------
const ui = {
  heat: +(args.get('heat') || 0), hold: args.has('hold'), life: 4, crumble: 0.6, rise: 0.15,
  autoReveal: true, reveal: 1, revealTime: 1.4, sigilIntensity: 4, sigilRadius: 1.5, spin: 0.25,
  holy: '#ffb84d', arcane: '#8c52ff', void: '#9e1fff',
  ior: 1.31, frost: 1, interior: 1, glints: 1, absorb: '#4db8e0', absorbScale: 1,
  strata: 1, veinWidth: 0.022, heatGlow: 1, bump: 1,
  tod: args.get('tod') || 'dusk', keyLight: true, uncapped: false,
};
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
let rng = 7;
const rand = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296);
const life = () => (ui.hold ? 1e9 : ui.life);

function eruptLine(from = new THREE.Vector3(-0.5, 0, 3.2), to = new THREE.Vector3(-0.5, 0, -4), n = 8) {
  const fwd = _d.subVectors(to, from).normalize().clone();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const pos = new THREE.Vector3().lerpVectors(from, to, t).add(_v.set((rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.3));
    const dir = new THREE.Vector3((rand() - 0.5) * 0.35, 1, 0).addScaledVector(fwd, 0.25 + rand() * 0.15).normalize();
    spikes.spawn({
      pos, dir, material: 'rock', height: 1.3 + Math.sin(t * Math.PI) * 1.3 + rand() * 0.4, radius: 0.36 + rand() * 0.18,
      delay: i * 0.03, rise: ui.rise, life: life(), crumble: ui.crumble, heat: ui.heat,
    });
  }
}
function iceRing(center = new THREE.Vector3(5.5, 0, -1), n = 8, R = 1.9) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.3;
    const out = _v.set(Math.cos(a), 0, Math.sin(a));
    const pos = center.clone().addScaledVector(out, R * (0.85 + rand() * 0.3));
    const dir = new THREE.Vector3(0, 1, 0).addScaledVector(out, 0.45 + rand() * 0.3).normalize();
    spikes.spawn({ pos, dir, material: 'ice', height: 1.5 + rand() * 0.9, radius: 0.42 + rand() * 0.12, delay: rand() * 0.06, rise: ui.rise * 1.2, life: life(), crumble: ui.crumble });
  }
}
const sigilAnim = [];   // { h, t }
function castSigil(style, pos = new THREE.Vector3(-5.5, 0, 0)) {
  for (const s of sigilAnim) { s.h.release(); s.dead = true; }
  sigilAnim.length = 0;
  const h = sigils.acquire({ style, pos, radius: ui.sigilRadius, intensity: ui.sigilIntensity, color: new THREE.Color(ui[style]), reveal: 0 });
  if (h) sigilAnim.push({ h, t: 0, dead: false });
}
function clearAll() {
  for (const h of spikes.spikes) if (h.active) h.release();
  for (const s of sigilAnim) s.h.release();
  sigilAnim.length = 0;
  impacts.clear();
}

// --- GUI --------------------------------------------------------------------------------------
const gui = new GUI({ title: 'Spikes & sigils' });
const act = {
  'erupt rock line': () => eruptLine(),
  'ice ring': () => iceRing(),
  'holy sigil': () => castSigil('holy'),
  'arcane sigil': () => castSigil('arcane'),
  'void sigil': () => castSigil('void'),
  'magma impact (rock)': () => impacts.add('magma', new THREE.Vector3(-0.5, 1, -0.5), 3, 1.2, 8, new THREE.Color(1, 0.4, 0.1)),
  'crumble now': () => { for (const h of spikes.spikes) if (h.active && h.state !== 'crumbling') h.life = Math.max(h.age - h.delay, h.rise); },
  clear: clearAll,
  'bench (A/B GPU ms)': () => bench(),
};
for (const k in act) gui.add(act, k);
const fs = gui.addFolder('Spikes');
fs.add(ui, 'heat', 0, 1, 0.01);
fs.add(ui, 'hold').name('hold (no crumble)');
fs.add(ui, 'life', 0.5, 10, 0.1);
fs.add(ui, 'crumble', 0.1, 3, 0.05);
fs.add(ui, 'rise', 0.05, 1, 0.01);
const su = spikes.uniforms;
fs.add(ui, 'strata', 0, 2, 0.01).onChange((v) => { su.uRockLook.value.x = v; });
fs.add(ui, 'veinWidth', 0.002, 0.08, 0.001).onChange((v) => { su.uRockLook.value.y = v; });
fs.add(ui, 'heatGlow', 0, 4, 0.01).onChange((v) => { su.uRockLook.value.z = v; });
fs.add(ui, 'bump', 0, 3, 0.01).onChange((v) => { su.uRockLook.value.w = v; });
fs.add(ui, 'ior', 1, 1.8, 0.001).onChange((v) => { su.uIceLook.value.x = v; });
fs.add(ui, 'frost', 0, 2, 0.01).onChange((v) => { su.uIceLook.value.y = v; });
fs.add(ui, 'interior', 0, 3, 0.01).onChange((v) => { su.uIceLook.value.z = v; });
fs.add(ui, 'glints', 0, 4, 0.01).onChange((v) => { su.uIceLook.value.w = v; });
const setAbsorb = () => {   // colour = what survives 1 m; sigma = -ln(c)
  const c = new THREE.Color(ui.absorb);
  su.uIceAbsorb.value.set(-Math.log(Math.max(c.r, 1e-3)), -Math.log(Math.max(c.g, 1e-3)), -Math.log(Math.max(c.b, 1e-3))).multiplyScalar(ui.absorbScale);
};
fs.addColor(ui, 'absorb').name('ice colour at 1 m').onChange(setAbsorb);
fs.add(ui, 'absorbScale', 0, 4, 0.01).name('absorption').onChange(setAbsorb);
setAbsorb();
const fg = gui.addFolder('Sigils');
fg.add(ui, 'autoReveal').name('auto reveal');
fg.add(ui, 'reveal', 0, 1, 0.001).listen();
fg.add(ui, 'revealTime', 0.2, 5, 0.05);
fg.add(ui, 'sigilIntensity', 0, 30, 0.1).name('intensity');
fg.add(ui, 'sigilRadius', 0.3, 5, 0.01).name('radius (m)');
fg.add(ui, 'spin', -2, 2, 0.01).name('spin (rad/s)');
for (const s of ['holy', 'arcane', 'void']) fg.addColor(ui, s);
const fe = gui.addFolder('Scene');
fe.add(ui, 'tod', ['dusk', 'night', 'noon']).name('time of day').onChange((v) => { sky.setPreset(v); applySun(); });
fe.add(ui, 'keyLight').name('orbiting key light');
fe.add(post.params, 'exposure', 0.1, 4, 0.01);
fe.add(post.params, 'bloomStrength', 0, 0.5, 0.001);
gui.add(ui, 'uncapped').name('uncap (for timing)').onChange(() => { if (ui.uncapped) spin(); });

// --- frame ------------------------------------------------------------------------------------
const timer = new GpuTimer(gl);
const hud = document.getElementById('hud');
let simT = 0, last = performance.now(), frames = 0, lastHud = last;

function simulate(dt) {
  simT += dt;
  U.uTime.value = simT % 3600;
  U.uDt.value = dt;
  U.uFrame.value++;
  for (const h of spikes.spikes) if (h.active && h.material === 'rock') h.heat = ui.heat;
  L.key.intensity = ui.keyLight ? 30 : 0;
  L.key.pos.set(Math.cos(simT * 0.35) * 7, 3.2, Math.sin(simT * 0.35) * 5 - 1);
  L.magma.intensity = 14 * ui.heat * ui.heat;
  let holy = 0;
  for (const s of sigilAnim) {
    if (s.dead) continue;
    s.t += dt;
    const h = s.h;
    h.reveal = ui.autoReveal ? Math.min(1, s.t / ui.revealTime) : ui.reveal;
    if (ui.autoReveal) ui.reveal = h.reveal;
    h.rotation += dt * ui.spin;
    h.intensity = ui.sigilIntensity;
    h.radius = ui.sigilRadius;
    h.color.set(ui[h.style]);
    holy = Math.max(holy, h.reveal);
    L.holy.color.copy(h.color);
  }
  L.holy.intensity = holy * ui.sigilIntensity * 1.5;
  spikes.update(dt);
  sigils.update();
  packWorld(dt);
}

function renderFrame() {
  timer.beginFrame();
  timer.begin('opaque');
  renderer.setRenderTarget(hdrRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(opaque, camera);
  timer.begin('refract');
  renderer.render(refract, camera);
  timer.begin('lines');
  hdrRT.resolveDepthBuffer = false;
  renderer.render(linesScene, camera);
  hdrRT.resolveDepthBuffer = true;
  timer.begin('post');
  post.render(hdrRT.texture, 1 / 60);
  timer.endFrame();
}

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  controls.update();
  simulate(dt);
  renderFrame();
  frames++;
  if (now - lastHud > 500) {
    let t = `${size.x}x${size.y} (${(size.x * size.y / 1e6).toFixed(2)} MP)  ${(frames * 1000 / (now - lastHud)).toFixed(0)} fps${ui.uncapped ? ' uncapped' : ''}`;
    t += `\nspikes ${spikes.live} (rock ${spikes.kinds.rock.count}, ice ${spikes.kinds.ice.count})  occluders ${occluders.list.length}  sigils ${sigils.geometry.instanceCount}`;
    t += `\ntris/variant rock ${spikes.triangles.rock.toFixed(0)} ice ${spikes.triangles.ice.toFixed(0)}`;
    if (timer.available) for (const [k, v] of Object.entries(timer.ms)) t += `\n${k.padEnd(8)} ${v.toFixed(3)} ms`;
    else t += '\nno EXT_disjoint_timer_query_webgl2';
    if (benchText) t += '\n' + benchText;
    hud.textContent = t;
    frames = 0;
    lastHud = now;
  }
}

function loop(now) {
  if (ui.uncapped || benching) return;
  tick(now);
  requestAnimationFrame(loop);
}

const fences = [], chan = new MessageChannel();
chan.port1.onmessage = spin;
function spin() {
  if (!ui.uncapped || document.hidden || benching) {
    fences.splice(0).forEach((f) => gl.deleteSync(f));
    if (!benching) { ui.uncapped = false; requestAnimationFrame(loop); }
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

// --- A/B GPU bench -----------------------------------------------------------------------------
// Each config toggles one system on over the same scene and camera; its cost is the delta of
// its pass against the all-off baseline (every pass keeps its MSAA resolve, so that cancels).
let benching = false, benchText = '';
async function gpuFence() {
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  while (gl.clientWaitSync(s, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise((r) => setTimeout(r, 1));
  gl.deleteSync(s);
}
function sigilCoverage(h) {
  const n = 64, pts = [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    _v.set(h.pos.x + Math.cos(a) * h.radius, h.pos.y, h.pos.z + Math.sin(a) * h.radius).project(camera);
    pts.push([_v.x * size.x / 2, _v.y * size.y / 2]);
  }
  for (let i = 0; i < n; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n]; area += x0 * y1 - x1 * y0; }
  return Math.abs(area / 2) / (size.x * size.y);
}
// One config = a visibility / option setup. Configs are interleaved in short chunks and each keeps
// its fastest chunk per pass: other GPU work (other tabs) only ever adds time, so the minimum is
// the honest number when the GPU is shared.
async function measure(configs, reps = 8, frames = 36) {
  const best = configs.map(() => ({}));
  const step = () => { U.uFrame.value++; U.uTime.value += 1 / 120; packWorld(1 / 120); renderFrame(); };
  for (let rep = 0; rep < reps; rep++) {
    for (let c = 0; c < configs.length; c++) {
      configs[c]();
      for (let i = 0; i < 6; i++) step();
      await gpuFence();
      timer.drain();
      for (let i = 0; i < frames; i++) { step(); if (i % 3 === 2) await gpuFence(); }
      await gpuFence();
      const m = timer.drain();
      for (const k in m) best[c][k] = Math.min(best[c][k] ?? 1e9, m[k]);
    }
  }
  return best;
}
let allCaps = null;   // the full occluder list while benching (configs may cut it to the pillars)
const show = (rock, ice, sigil) => () => {
  spikes.opaque.visible = rock; spikes.refract.visible = ice; sigilGroup.visible = sigil; su.uSpikeOpts.value.x = 0;
  if (allCaps) { occluders.list.length = 0; occluders.list.push(...allCaps); }
};
const ms = (x) => x.toFixed(3);
async function bench() {
  if (benching || !timer.available) { benchText = timer.available ? benchText : 'bench needs EXT_disjoint_timer_query_webgl2'; return; }
  benching = true;
  const saved = { pos: camera.position.clone(), tgt: controls.target.clone(), hold: ui.hold, auto: ui.autoReveal };
  clearAll();
  ui.hold = true;
  // 8 rock spikes in a line, 8 ice in a ring, a 3 m sigil; let them finish rising
  eruptLine(new THREE.Vector3(-3.5, 0, 0), new THREE.Vector3(3.5, 0, 0), 8);
  iceRing(new THREE.Vector3(0, 0, -4.5), 8, 1.9);
  castSigil('holy', new THREE.Vector3(0, 0, 3.2));
  ui.autoReveal = false;
  ui.reveal = 1;
  for (let i = 0; i < 120; i++) simulate(1 / 60);
  timer.keep = true;
  const out = [];
  allCaps = occluders.list.slice();
  const caps = (on) => { occluders.list.length = 0; occluders.list.push(...(on ? allCaps : allCaps.slice(0, 3))); };

  // view 1: gameplay framing of everything
  camera.position.set(0, 6, 12); controls.target.set(0, 0.8, -1); controls.update();
  let [b, r, rNs, ic, noCaps] = await measure([
    show(false, false, false), show(true, false, false),
    () => { show(true, false, false)(); su.uSpikeOpts.value.x = 1; },
    show(false, true, false),
    () => { show(false, false, false)(); caps(false); },
  ]);
  caps(true);
  out.push(`overview: rock +${ms(r.opaque - b.opaque)} (receiving capsule shadows +${ms(rNs.opaque - b.opaque)}), ice +${ms(ic.refract - b.refract)}`);
  out.push(`  16 spike capsules shadowing the floor: +${ms(b.opaque - noCaps.opaque)} ms opaque`);
  out.push(`  baseline opaque ${ms(b.opaque)} refract ${ms(b.refract)} lines ${ms(b.lines)} post ${ms(b.post)}`);

  // view 2: the sigil alone at 15% of the screen (camera 35 degrees down)
  const sg = sigilAnim[sigilAnim.length - 1].h;
  controls.target.copy(sg.pos);
  let lo = 2, hi = 40;
  for (let i = 0; i < 30; i++) {
    const d = (lo + hi) / 2;
    camera.position.set(sg.pos.x, sg.pos.y + d * Math.sin(0.61), sg.pos.z + d * Math.cos(0.61));
    camera.lookAt(sg.pos); camera.updateMatrixWorld();
    if (sigilCoverage(sg) > 0.15) lo = d; else hi = d;
  }
  controls.update();
  const cov = sigilCoverage(sg);
  const styles = ['holy', 'arcane', 'void'];
  const sres = await measure([show(false, false, false), ...styles.map((st) => () => { show(false, false, true)(); sg.style = st; sigils.update(); })]);
  sg.style = 'holy'; sigils.update();
  out.push(`sigil ${(sg.radius * 2).toFixed(1)} m at ${(cov * 100).toFixed(1)}% screen: ` + styles.map((st, i) => `${st} +${ms(sres[i + 1].lines - sres[0].lines)}`).join(', '));

  // view 3: close-ups (camera ~4 m from the ice ring / rock line)
  camera.position.set(0, 2.2, -0.5); controls.target.set(0, 1, -4.5); controls.update();
  const [b3, ic3] = await measure([show(false, false, false), show(false, true, false)], 6);
  camera.position.set(0, 2, 5); controls.target.set(0, 1, 0); controls.update();
  const [b4, r4] = await measure([show(false, false, false), show(true, false, false)], 6);
  out.push(`close-up: ice +${ms(ic3.refract - b3.refract)}, rock +${ms(r4.opaque - b4.opaque)}`);

  timer.keep = false;
  show(true, true, true)();
  allCaps = null;
  camera.position.copy(saved.pos); controls.target.copy(saved.tgt); controls.update();
  ui.hold = saved.hold; ui.autoReveal = saved.auto;
  benchText = out.join('\n');
  console.info('[bench]\n' + benchText);
  benching = false;
  window.app.benchResult = benchText;
  requestAnimationFrame(loop);
}

window.app = { renderer, camera, controls, spikes, sigils, ui, act, timer, bench, U, occluders, lights, impacts };
eruptLine();
iceRing();
castSigil('holy');
requestAnimationFrame(loop);
