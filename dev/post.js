// Post / camera / capture / lens sandbox. Not part of the app build: open /dev/post.html.
//   ?mp=3.3  render at a fixed 16:9 drawing buffer of that many megapixels (timing at the budget size)
//   ?load=N  a dummy GPU pass first (N loop iterations) so the GPU, not the CPU, is the bottleneck and
//            per-pass timers stop counting submission gaps; read them with "uncap" on
// Drag a lens with the mouse; drag anywhere else to orbit.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { PostFX } from '../src/engine/PostFX.js';
import { GpuTimer } from '../src/engine/gpuTimer.js';
import { CameraRig } from '../src/engine/camera.js';
import { screenshot, createRecorder } from '../src/engine/capture.js';
import { createUrlState } from '../src/engine/urlState.js';
import { Lens } from '../src/vfx/Lens.js';
import { FullscreenQuad, rawPass } from '../src/engine/fullscreen.js';

const args = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
const canvas = renderer.domElement;
document.body.appendChild(canvas);
const gl = renderer.getContext();

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(0, 3.2, 13);

// --- scene: an HDR test card ---------------------------------------------------------------------
const scene = new THREE.Scene();

// backdrop: dusk gradient, hashed stars, faint 10-degree lat/long grid (bending is easy to read on it).
// No depth write, so it sits at the far plane = "infinity" for the lens.
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 64, 32), new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3, side: THREE.BackSide, depthWrite: false,
  vertexShader: /* glsl */`out vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    in vec3 vDir; out vec4 outColor;
    float h(vec3 p) { p = fract(p * 0.3183 + 0.1) * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float grid(float x) { float w = fwidth(x); return 1.0 - smoothstep(0.0, 1.5 * w, abs(fract(x + 0.5) - 0.5)); }
    void main() {
      vec3 d = normalize(vDir);
      vec3 c = mix(vec3(0.16, 0.08, 0.06), vec3(0.012, 0.025, 0.08), smoothstep(-0.05, 0.45, d.y));
      c += vec3(1.0, 0.42, 0.14) * 0.6 * exp(-abs(d.y) * 10.0);
      vec3 g = d * 220.0, f = fract(g) - 0.5;
      float s = h(floor(g));
      if (s > 0.97) c += mix(vec3(1.0, 0.8, 0.6), vec3(0.7, 0.85, 1.0), h(floor(g) + 3.1)) * smoothstep(0.3, 0.0, length(f)) * (s - 0.97) * 200.0;
      float lat = asin(clamp(d.y, -1.0, 1.0)) * 18.0 / 3.14159265, lon = atan(d.z, d.x) * 18.0 / 3.14159265;
      c += vec3(0.25, 0.45, 1.0) * 0.06 * max(grid(lat), grid(lon)) * step(0.0, d.y);
      outColor = vec4(c, 1.0);
    }`,
}));
sky.renderOrder = -1;
scene.add(sky);

// polished tile floor (procedural canvas texture: zero binary assets here too)
function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#4a4a4e';
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 22 + ((x * 7 + y * 13) % 5) * 4;
    g.fillStyle = `rgb(${v},${v},${v + 3})`;
    g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  t.anisotropy = 8;
  return t;
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.18, metalness: 0 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// pillars behind everything, alternating light/dark: straight edges show the bending
for (let i = 0; i < 11; i++) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x8a8a90 : 0x303034, roughness: 0.6 }));
  p.position.set((i - 5) * 2.4, 3.5, -14);
  scene.add(p);
}

scene.add(new THREE.HemisphereLight(0x334466, 0x120a06, 0.6));
const moon = new THREE.DirectionalLight(0xaabbff, 0.6);
moon.position.set(-3, 6, 4);
scene.add(moon);
for (const [color, x, z] of [[0xff3010, -6, 0], [0x2050ff, 6, 0], [0x30ff60, 0, -7], [0xff40c0, 0, 6]]) {
  const l = new THREE.PointLight(color, 15, 0, 2);
  l.position.set(x, 1.2, z);
  scene.add(l);
}

// emissive spheres, radiance 0.5 .. 200
const INTENSITY = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
const HUES = [0xffd6a0, 0xff6a20, 0x40c8ff, 0xa060ff, 0x60ff90];
const spheres = INTENSITY.map((I, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(HUES[i % HUES.length]).multiplyScalar(I) }));
  m.position.set((i - 4) * 1.1, 0.6, 4);
  scene.add(m);
  return m;
});
// a thin hot line, like a bolt core: bloom must not flicker on it, streaks should catch it
const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 4.5, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.8, 1).multiplyScalar(80) }));
bolt.position.set(-7.5, 2.25, 1);
bolt.rotation.z = 0.12;
scene.add(bolt);

// the void: optional black horizon sphere and a thin accretion disk (writes depth, so its far half is
// lensed into the halo over the top while the near half stays in front)
const voids = [new THREE.Vector3(0, 2.4, -3), new THREE.Vector3(4.5, 3.4, -7)];
const horizon = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0 }));
const disk = new THREE.Mesh(new THREE.RingGeometry(1, 2.6, 160, 1), new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */`out vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    in vec2 vP; out vec4 outColor; uniform float uTime;
    void main() {
      float r = length(vP), a = atan(vP.y, vP.x);
      float t = clamp((r - 1.0) / 1.6, 0.0, 1.0);
      vec3 hot = vec3(1.0, 0.8, 0.55) * 6.0, cool = vec3(1.0, 0.22, 0.05) * 0.8;
      vec3 c = mix(hot, cool, pow(t, 0.5)) * (1.0 - t) * (1.0 - t);
      c *= 0.75 + 0.25 * sin(a * 3.0 + r * 9.0 - uTime * 2.0 / r);   // spiral streaks
      c *= smoothstep(0.0, 0.05, t);
      outColor = vec4(c, 1.0);
    }`,
}));
scene.add(horizon, disk);

// --- pipeline ---------------------------------------------------------------------------------------
const post = new PostFX(renderer);
const lens = new Lens(renderer);
const rig = new CameraRig();
const recorder = createRecorder(canvas, 60);
let hdrRT = null;

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
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  rig.restore(camera);
  camera.aspect = s.x / s.y;
  camera.updateProjectionMatrix();
  hdrRT?.dispose();
  hdrRT = new THREE.WebGLRenderTarget(s.x, s.y, {
    type: THREE.HalfFloatType, samples: 4, generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(s.x, s.y, THREE.FloatType),
  });
  post.setSize(s.x, s.y);
  lens.setSize(s.x, s.y);
}
addEventListener('resize', resize);
resize();

// --- lens dragging (registered before OrbitControls so a lens grab never starts an orbit) ----------
const ui = {
  lens: true, einstein: 1.2, horizon: 0.45, strength: 1, second: false, horizonSphere: true, disk: true, diskTilt: 78,
  uncapped: false, flashDecay: 10,
};
const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), _n = new THREE.Vector2(), _p = new THREE.Vector3();
let drag = -1;
function ndc(e) {
  const r = canvas.getBoundingClientRect();
  return _n.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
}
canvas.addEventListener('pointerdown', (e) => {
  if (!ui.lens) return;
  const n = ndc(e), r = canvas.getBoundingClientRect();
  for (let i = 0; i < (ui.second ? 2 : 1); i++) {
    _p.copy(voids[i]).project(camera);
    const z = voids[i].clone().applyMatrix4(camera.matrixWorldInverse).z * -1;
    const pick = Math.max(24, ui.einstein * camera.projectionMatrix.elements[5] * 0.5 / z * r.height);
    if (Math.hypot((_p.x - n.x) * r.width / 2, (_p.y - n.y) * r.height / 2) < pick) {
      drag = i;
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (drag < 0) return;
  ray.setFromCamera(ndc(e), camera);
  plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(_p), voids[drag]);
  if (ray.ray.intersectPlane(plane, hit)) voids[drag].copy(hit);
});
canvas.addEventListener('pointerup', () => { drag = -1; controls.enabled = true; });

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.8, -2);
controls.enableDamping = true;
controls.update();

// --- GUI, with its state mirrored into the hash (dogfoods urlState) ---------------------------------
const P = post.params;
const defaults = {};
for (const k in P) defaults[`post.${k}`] = P[k];
for (const k in ui) defaults[`ui.${k}`] = ui[k];
const url = createUrlState(defaults);
const start = url.read();
for (const k in P) P[k] = start[`post.${k}`];
for (const k in ui) ui[k] = start[`ui.${k}`];
const flat = {};
const saveUrl = () => {
  for (const k in P) if (k !== 'flash' && k !== 'droplets') flat[`post.${k}`] = P[k]; // transient, the loop decays them
  for (const k in ui) flat[`ui.${k}`] = ui[k];
  url.write(flat);
};

const gui = new GUI({ title: 'Post sandbox' });
gui.onChange(saveUrl);
const fe = gui.addFolder('Exposure');
fe.add(P, 'exposure', 0.1, 4, 0.01);
fe.add(P, 'autoExposure');
fe.add(P, 'keyValue', 0.05, 0.6, 0.01);
fe.add(P, 'adaptUp', 0.1, 10, 0.1);
fe.add(P, 'adaptDown', 0.1, 10, 0.1);
fe.add(P, 'adaptMaxEv', 0, 20, 0.1).name('adaptMaxEv (EV/s)');
fe.add(P, 'minExposure', 0.01, 1, 0.01);
fe.add(P, 'maxExposure', 1, 50, 0.1);
fe.add(P, 'flash', 0, 8, 0.01).listen();
fe.add(ui, 'flashDecay', 1, 30, 0.5).name('flash decay (1/s)');
const fb = gui.addFolder('Bloom & lens');
fb.add(P, 'bloomStrength', 0, 0.5, 0.001);
fb.add(P, 'bloomThreshold', 0, 10, 0.01);
fb.add(P, 'bloomClamp', 1, 256, 1);
fb.add(P, 'bloomLevels', 1, 6, 1);
fb.add(P, 'lensDirt', 0, 4, 0.01);
fb.add(P, 'anamorphic', 0, 4, 0.01);
fb.add(P, 'ca', 0, 0.02, 0.0001);
fb.add(P, 'vignette', 0, 1, 0.01);
fb.add(P, 'droplets', 0, 1, 0.01).listen();
const ft = gui.addFolder('Tonemap');
ft.add(P, 'tonemap', ['agx', 'neutral']);
ft.add(P, 'contrast', 0.7, 1.6, 0.01);
ft.add(P, 'saturation', 0, 2, 0.01);
const fl = gui.addFolder('Void lens');
fl.add(ui, 'lens');
fl.add(ui, 'einstein', 0.1, 4, 0.01).name('einstein radius (m)');
fl.add(ui, 'horizon', 0.05, 2, 0.01).name('horizon radius (m)');
fl.add(ui, 'strength', 0, 3, 0.01);
fl.add(ui, 'second').name('second lens');
fl.add(ui, 'horizonSphere').name('opaque horizon sphere');
fl.add(ui, 'disk').name('accretion disk');
fl.add(ui, 'diskTilt', 0, 90, 1).name('disk tilt (deg)');
const actions = {
  'shake light (lightning 30 Hz)': () => rig.shake(0.35, 30),
  'shake heavy (earth 8 Hz)': () => rig.shake(0.9, 8),
  'thunder (flash, shake 600 m later)': () => { P.flash = 2.5; rig.shake(0.6, 30, 600 / 343); },
  'punch +3 deg': () => rig.punch(3, 0.08),
  'hitstop 80 ms': () => rig.hitstop(0.08),
  'hit combo': () => { rig.hitstop(0.07); rig.punch(3); rig.shake(0.7, 15); P.flash = 1; },
  'droplets': () => { P.droplets = 1; },
  screenshot: () => { shotPending = true; },
  record: () => { if (recorder.recording) recorder.stop(); else recorder.start('post-sandbox'); recCtl.name(recorder.recording ? 'stop recording' : 'record'); },
};
const fc = gui.addFolder('Camera & capture');
for (const k of Object.keys(actions).slice(0, 7)) fc.add(actions, k);
fc.add(rig, 'reduced').name('reduce flashes & shake');
fc.add(rig, 'amount', 0, 3, 0.01).name('shake amount');
fc.add(actions, 'screenshot');
const recCtl = fc.add(actions, 'record');
gui.add(ui, 'uncapped').name('uncap (for timing)').onChange(() => { if (ui.uncapped) spin(); });

// --- urlState self-check (the parser takes user input) ---------------------------------------------
{
  const saved = location.hash;
  const s = createUrlState({ spell: 'fire', 'fire.size': 1, q: 'high', on: false, n: 3 }, 0);
  history.replaceState(null, '', '#spell=void&fire.size=1.4&on=true&x=2&q=1e3&n=oops&y=false&z=a%20b');
  const r = s.read();
  console.assert(r.spell === 'void' && r['fire.size'] === 1.4 && r.on === true && r.x === 2 && r.q === '1e3' && r.n === 3 && r.y === false && r.z === 'a b', 'urlState.read', r);
  history.replaceState(null, '', location.pathname + location.search + saved);
}

// --- frame ------------------------------------------------------------------------------------------
const timer = new GpuTimer(gl);
const loadRT = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false });
const gpuLoad = args.has('load') ? new FullscreenQuad(rawPass(/* glsl */`
precision highp float;
in vec2 vUv; out vec4 o;
void main() { float s = vUv.x; for (int i = 0; i < ${+args.get('load') || 20000}; i++) s = fract(s * 1.618 + 0.31); o = vec4(s); }`)) : null;
const hud = document.getElementById('hud');
let simT = 0, last = performance.now(), frames = 0, lastHud = last, shotPending = false;

function renderFrame(dt) {
  rig.restore(camera);
  controls.update();
  rig.apply(camera, dt);
  const sdt = dt * rig.timeScale;   // hitstop freezes the "sim", not the camera
  simT += sdt;

  spheres.forEach((m, i) => { m.position.y = 0.6 + 0.18 * Math.sin(simT * 2 + i * 0.7); });
  P.flash = Math.min(P.flash, rig.reduced ? 0.5 : 8) * Math.exp(-dt * ui.flashDecay);
  if (P.flash < 1e-3) P.flash = 0;
  P.droplets = Math.max(0, P.droplets - dt / 6);

  horizon.visible = ui.lens && ui.horizonSphere;
  horizon.position.copy(voids[0]);
  horizon.scale.setScalar(ui.horizon);
  disk.visible = ui.disk;
  disk.position.copy(voids[0]);
  disk.rotation.set(-ui.diskTilt * Math.PI / 180, 0, 0);
  disk.scale.setScalar(ui.horizon * 1.6);
  disk.material.uniforms.uTime.value = simT;

  timer.beginFrame();
  if (gpuLoad) {   // ?load: keep the GPU the bottleneck so later timers measure work, not CPU submission gaps
    timer.begin('load');
    gpuLoad.render(renderer, loadRT);
  }
  timer.begin('scene');
  renderer.setRenderTarget(hdrRT);
  renderer.clear();
  renderer.render(scene, camera);

  lens.active = ui.lens;
  lens.set(0, voids[0], ui.einstein, ui.horizon, ui.strength);
  lens.set(1, voids[1], ui.einstein * 0.7, ui.horizon * 0.7, ui.second ? ui.strength : 0);
  timer.begin('lens');
  const src = lens.render(hdrRT.texture, hdrRT.depthTexture, camera);
  timer.begin('post');
  post.render(src, dt, hdrRT.texture);
  timer.endFrame();
  if (shotPending) { shotPending = false; screenshot(canvas, 'post-sandbox'); }
}

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  renderFrame(dt);
  frames++;
  if (now - lastHud > 500) {
    const s = renderer.getDrawingBufferSize(_n);
    let t = `${s.x}x${s.y} (${(s.x * s.y / 1e6).toFixed(2)} MP)  ${(frames * 1000 / (now - lastHud)).toFixed(0)} fps${ui.uncapped ? ' uncapped' : ''}`;
    if (timer.available) for (const [k, v] of Object.entries(timer.ms)) t += `\n${k.padEnd(6)} ${v.toFixed(3)} ms`;
    else t += '\nno EXT_disjoint_timer_query_webgl2';
    t += `\ntrauma ${rig._src.reduce((a, x) => a + x.trauma, 0).toFixed(2)}  timeScale ${rig.timeScale}`;
    hud.textContent = t;
    frames = 0;
    lastHud = now;
  }
}

function loop(now) {
  if (ui.uncapped) return;
  tick(now);
  requestAnimationFrame(loop);
}

// uncapped: frames back-to-back with at most 3 in flight (UW), so GPU clocks and timers read true
const fences = [], chan = new MessageChannel();
chan.port1.onmessage = spin;
function spin() {
  if (!ui.uncapped) {   // (unlike UW, keeps spinning while hidden: timings from a background tab)
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

window.app = { THREE, renderer, camera, controls, post, lens, rig, timer, ui, voids, recorder, gui, spheres, hdr: () => hdrRT };
if (ui.uncapped) spin(); else requestAnimationFrame(loop);
