import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { U, lights, occluders, packWorld } from '../src/vfx/common.js';
import { bakeNoise } from '../src/vfx/noise.js';
import { FxTarget } from '../src/vfx/FxTarget.js';
import { PostFX } from '../src/engine/PostFX.js';
import { GpuTimer } from '../src/engine/gpuTimer.js';
import { TrailRibbons, AnalyticRibbons } from '../src/vfx/Ribbons.js';
import { Bolts } from '../src/vfx/Bolts.js';
import { Volumes } from '../src/vfx/Volumes.js';
import { Shockwaves } from '../src/vfx/Shockwaves.js';

// Sandbox for the strand and volume renderers: the real pipeline in miniature. Opaque + full-res
// lines into a 4x MSAA HalfFloat target with a DepthTexture, then the half-res FX MRT (FxTarget's
// prepass and composite), then PostFX. Every mesh is drawn on its own so the GPU timer can cost it
// (the lines draws each pay an MSAA resolve; 'resolve' measures one so it can be subtracted).
// ?mp=3.3 renders internally at 3.3 MP whatever the window size (the budget's reference).

const args = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
const gl = renderer.getContext();
const timer = new GpuTimer(gl);
const hud = document.getElementById('hud');

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(1.5, 4.2, 15.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.6, 0);
controls.enableDamping = true;
U.uNearFar.value.set(camera.near, camera.far);

// --- opaque scene: dark floor, pillars and a dummy (also arena occluders, so crawl arcs climb them)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0.01, 0.014, 0.028);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.55 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const stone = new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.8 });
for (const [x, z] of [[-7.5, -5], [6.5, -5.5], [-9, 4], [9, 3]]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 6, 24), stone);
  p.position.set(x, 3, z);
  scene.add(p);
  occluders.add(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 6, z), 0.6);
}
const dummy = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.2, 6, 16), stone);
dummy.position.set(-1.2, 0.95, 2.5);
scene.add(dummy);
occluders.add(new THREE.Vector3(-1.2, 0.35, 2.5), new THREE.Vector3(-1.2, 1.55, 2.5), 0.35);

const sunDir = new THREE.Vector3(0.8, 0.45, 0.35).normalize();
U.uSunDir.value.copy(sunDir);
U.uSunColor.value.set(1.0, 0.68, 0.45);
U.uAmbient.value.set(0.03, 0.04, 0.065);
const sunLight = new THREE.DirectionalLight(0xffc49a, 0.5);
sunLight.position.copy(sunDir).multiplyScalar(30);
scene.add(sunLight, new THREE.HemisphereLight(0x3a4a70, 0x0c0c0c, 0.5));
const flash = new THREE.PointLight(0xa8c0ff, 0, 60, 2);
const fireLamp = new THREE.PointLight(0xff8a3a, 0, 25, 2);
scene.add(flash, fireLamp);
const markers = Array.from({ length: 9 }, () => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  m.visible = false;
  scene.add(m);
  return m;
});

// --- the systems under test
const bolts = new Bolts();
const trails = new TrailRibbons();

// tornado-ish funnel: p0 base xyz + height, p1 base radius, top radius, turns, phase,
// p2 width, spin (rad/s), distortion (m)
const HELIX_PATH = /* glsl */`
vec3 ribbonPath(float t, vec4 p0, vec4 p1, vec4 p2, vec4 p3, out float width) {
  float r = mix(p1.x, p1.y, t * t);
  float a = p1.w + t * p1.z * 2.0 * PI + uTime * p2.y;
  width = p2.x * (0.4 + 0.6 * t);
  return p0.xyz + vec3(cos(a) * r, t * p0.w, sin(a) * r);
}`;
const HELIX_SHADE = /* glsl */`
vec3 ribbonShade(RibbonFrag r, out vec3 media, out float alpha, out float distortion) {
  media = vec3(0.0); alpha = 0.0; distortion = 0.0;
  float v = 1.0 - r.uv.y * r.uv.y;
  float ends = smoothstep(0.0, 0.15, r.uv.x) * smoothstep(1.0, 0.7, r.uv.x);
  float dash = 0.25 + 0.75 * smoothstep(0.4, 1.0, sin(r.uv.x * 30.0 - uTime * 10.0 + r.p1.w * 3.0));
  return r.color * v * v * ends * dash;
}`;
const WIND_SHADE = /* glsl */`
vec3 ribbonShade(RibbonFrag r, out vec3 media, out float alpha, out float distortion) {
  float y = r.uv.y;
  float ends = smoothstep(0.0, 0.2, r.uv.x) * smoothstep(1.0, 0.75, r.uv.x);
  float streak = smoothstep(0.1, 1.0, sin(r.uv.x * 14.0 - uTime * 8.0 + r.p1.w * 5.0));
  media = vec3(0.0); alpha = 0.0;
  distortion = r.p2.z * y * exp(-3.0 * y * y) * 2.33 * ends * (0.3 + 0.7 * streak);
  return r.color * exp(-4.0 * y * y) * ends * streak;
}`;
const helixLines = new AnalyticRibbons({ max: 16, segments: 96, pathGLSL: HELIX_PATH, shadeGLSL: HELIX_SHADE, target: 'lines' });
const helixFx = new AnalyticRibbons({ max: 16, segments: 64, pathGLSL: HELIX_PATH, shadeGLSL: WIND_SHADE, target: 'fx' });

// demo media: blackbody-ramped fbm fireball, and a smoke puff lit by sun, sky and the fire's light
const FIREBALL_GLSL = /* glsl */`
uniform vec4 uFire;   // peak K, intensity, turbulence, -
void volumeSample(vec3 pw, vec3 pl, out float sigma, out vec3 albedo, out vec3 emission) {
  float r = length(pl);
  // flame tongues: noise stretched vertically and scrolled up; the fine layer is domain-warped by
  // the coarse one and runs faster, so detail streams through the big shapes
  float n1 = fbm3(pl * vec3(0.3, 0.2, 0.3) + vec3(0.0, -uTime * 0.25, 0.0));
  float n2 = noise3(pl * vec3(0.8, 0.55, 0.8) + vec3(0.0, -uTime * 0.7, 0.0) + n1 * 0.8);
  // a sphere sitting low in the taller proxy, displaced most on top so flames lick upward; the
  // displacement stays well inside the proxy so its edge never shows
  float rr = length(pl - vec3(0.0, -0.15, 0.0));
  float shape = 0.5 - rr + uFire.z * ((n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.35) * (1.0 + 0.8 * max(pl.y, 0.0));
  float dens = smoothstep(0.0, 0.15, shape) * smoothstep(1.0, 0.6, r);
  float core = smoothstep(0.0, 0.45, shape);         // depth inside the fire
  float K = mix(700.0, uFire.x, core) * (0.85 + 0.3 * n2);
  sigma = dens * 10.0;
  albedo = vec3(0.0);                                 // soot absorbs and never scatters: no lighting cost
  // radiance at saturation = blackbody chromaticity x an artist curve (T / 1800)^4: the cool fringe
  // goes black, the core white-yellow
  emission = blackbody(K) * pow(K / 1800.0, 4.0) * uFire.y * sigma;
}`;
const SMOKE_GLSL = /* glsl */`
uniform vec4 uSmoke;  // density, -, -, -
void volumeSample(vec3 pw, vec3 pl, out float sigma, out vec3 albedo, out vec3 emission) {
  float r = length(pl);
  float base = fbm3(pl * 0.3 + vec3(0.0, -uTime * 0.03, 0.0));   // Perlin-Worley: billowy
  float shape = 0.6 - r + (base - 0.5) * 1.6;
  // erode the thin parts with fine Worley (Schneider 2015): wisps at the edges, solid inside
  float det = noise3v(pl * 0.9 + vec3(0.03 * uTime, -uTime * 0.06, 0.0)).g;
  shape -= (1.0 - det) * 0.3 * (1.0 - smoothstep(0.0, 0.35, shape));
  sigma = smoothstep(0.0, 0.25, shape) * smoothstep(1.0, 0.7, r) * uSmoke.x;
  albedo = vec3(0.85);
  emission = vec3(0.0);
}`;
const volumes = new Volumes();
const fireball = volumes.add({ shape: 'sphere', glsl: FIREBALL_GLSL, uniforms: { uFire: { value: new THREE.Vector4(2700, 0.6, 1, 0) } } });
const smoke = volumes.add({ shape: 'sphere', glsl: SMOKE_GLSL, uniforms: { uSmoke: { value: new THREE.Vector4(4, 0, 0, 0) } } });
fireball.position.set(-4.5, 1.6, 1);
fireball.scale.set(1, 1.3, 1);
smoke.position.set(-4.4, 3.7, 0.6);
smoke.scale.set(1.8, 1.35, 1.8);
fireball.visible = smoke.visible = true;
const shocks = new Shockwaves();

const LINES = [['bolt cores', bolts.cores], ['trail cores', trails.lines], ['helix lines', helixLines.mesh]];
const FX = [['bolt glows', bolts.glows], ['trail glow', trails.fx], ['wind helix', helixFx.mesh],
  ['fireball', fireball.mesh], ['smoke', smoke.mesh], ['shockwaves', shocks.mesh]];

// --- targets
const fxTarget = new FxTarget(renderer);
const post = new PostFX(renderer);
Object.assign(post.params, { autoExposure: false, exposure: 1.0, bloomStrength: 0.08 });
let hdrRT = null;
const nothing = new THREE.Object3D();
function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (args.has('mp')) {
    const mp = parseFloat(args.get('mp')) * 1e6;
    size.set(Math.round(Math.sqrt(mp * camera.aspect)), Math.round(Math.sqrt(mp / camera.aspect)));
  }
  hdrRT?.dispose();
  hdrRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType, samples: 4, generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
  });
  U.uSceneDepth.value = hdrRT.depthTexture;
  U.uSceneColor.value = hdrRT.texture;
  U.uResolution.value.copy(size);
  fxTarget.setSize(size.x, size.y, 0.5);
  post.setSize(size.x, size.y);
}
addEventListener('resize', resize);
resize();

// --- controls
const ui = {
  auto: true, period: 3.2, leader: 0.09, restrikes: 2, crawl: 5,
  jag: 0.11, width: 0.03, branches: 8, subBranches: 12, intensity: 60, glowWidth: 12, glowColor: '#2f4cff', glowGain: 0.16,
  trailWidth: 0.05, trailGlow: 7, trailGlowI: 0.35, trailDistortion: 0.04, fadeTime: 0.45, trailSpeed: 1,
  helix: true, windDistortion: 0.06,
  fireTemp: 2700, fireIntensity: 0.6, turbulence: 1, smokeDensity: 4, fireballOn: true, smokeOn: true,
  shockDistortion: 0.12, shockThickness: 0.8,
  stress: false, markers: false, freeze: false, exposure: 1, bloom: 0.08,
  strike: () => startStrike(), explode: () => explode(),
};
const gui = new GUI({ title: 'strands & volumes' });
const fb = gui.addFolder('lightning');
fb.add(ui, 'strike'); fb.add(ui, 'auto'); fb.add(ui, 'period', 0.5, 8, 0.1); fb.add(ui, 'leader', 0.02, 0.4, 0.01);
fb.add(ui, 'restrikes', 0, 4, 1); fb.add(ui, 'crawl', 0, 8, 1); fb.add(ui, 'jag', 0, 0.3, 0.005); fb.add(ui, 'width', 0.005, 0.1, 0.001);
fb.add(ui, 'branches', 0, 8, 1); fb.add(ui, 'subBranches', 0, 12, 1); fb.add(ui, 'intensity', 5, 120, 1);
fb.add(ui, 'glowWidth', 2, 30, 0.5); fb.addColor(ui, 'glowColor'); fb.add(ui, 'glowGain', 0, 0.5, 0.005); fb.add(ui, 'markers');
const ft = gui.addFolder('trails');
ft.add(ui, 'trailWidth', 0.005, 0.2, 0.001); ft.add(ui, 'trailGlow', 0, 20, 0.1); ft.add(ui, 'trailGlowI', 0, 1, 0.01);
ft.add(ui, 'trailDistortion', 0, 0.2, 0.001); ft.add(ui, 'fadeTime', 0.05, 2, 0.01); ft.add(ui, 'trailSpeed', 0, 3, 0.01);
const fh = gui.addFolder('helix');
fh.add(ui, 'helix'); fh.add(ui, 'windDistortion', 0, 0.3, 0.001);
const fv = gui.addFolder('volumes');
fv.add(ui, 'fireballOn'); fv.add(ui, 'fireTemp', 1000, 6000, 10); fv.add(ui, 'fireIntensity', 0, 4, 0.01); fv.add(ui, 'turbulence', 0, 2, 0.01);
fv.add(ui, 'smokeOn'); fv.add(ui, 'smokeDensity', 0, 10, 0.01); fv.add(ui, 'explode');
const fs = gui.addFolder('shockwaves');
fs.add(ui, 'shockDistortion', 0, 1, 0.005); fs.add(ui, 'shockThickness', 0.1, 3, 0.01);
const fo = gui.addFolder('view');
fo.add(ui, 'stress').name('stress (3 bolts, 16 trails)'); fo.add(ui, 'freeze'); fo.add(ui, 'exposure', 0.1, 4, 0.01); fo.add(ui, 'bloom', 0, 0.3, 0.001);

// --- lightning: stepped leader, return stroke, restrikes (same seed, new branchSeed), crawl arcs
const glowCol = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);
const rseed = () => (Math.random() * 16777216) | 0;
const boltLight = lights.acquire();
const fireLight = lights.acquire();
let strike = null;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function startStrike() {
  if (strike) endStrike();
  const ground = new THREE.Vector3(rnd(0.5, 3), 0, rnd(-3, -0.5));
  const sky = new THREE.Vector3(ground.x + rnd(-3, 3), 16, ground.z + rnd(-4, 0));
  const main = bolts.acquire({ a: sky, b: ground, reveal: 0, intensity: 0 });
  const strokes = [ui.leader];
  for (let i = 0; i < ui.restrikes; i++) strokes.push(strokes[strokes.length - 1] + rnd(0.03, 0.06));
  strike = { t: 0, main, ground, strokes, crawls: [], next: 0 };
}
function endStrike() {
  strike.main?.release();
  for (const c of strike.crawls) c.bolt.release();
  strike = null;
  flash.intensity = 0;
  boltLight.intensity = 0;
}
function stroke(s, k) {
  if (k > 0) s.main.branchSeed = rseed();
  if (k === 0) {
    shocks.spawn({ pos: s.ground, radius0: 0.3, radius1: 7, duration: 0.8, thickness: ui.shockThickness, distortion: ui.shockDistortion, color: new THREE.Color(0.35, 0.5, 1), intensity: 1.5, ground: true });
    shocks.spawn({ pos: _v.copy(s.ground).setY(0.6), radius0: 0.2, radius1: 4.5, duration: 0.5, thickness: ui.shockThickness * 0.8, distortion: ui.shockDistortion * 0.8, color: new THREE.Color(0.5, 0.65, 1), intensity: 0.25 });
    for (let i = 0; i < ui.crawl; i++) {
      const ang = rnd(0, Math.PI * 2), len = rnd(1.8, 4.5);
      const a = _v.copy(s.ground).setY(0.05), b = _w.set(s.ground.x + Math.cos(ang) * len, 0.05, s.ground.z + Math.sin(ang) * len);
      const bolt = bolts.acquire({ a, b, snapToArena: true, branches: 3, subBranches: 3, jag: 0.16, width: 0.014, intensity: 0, glowWidth: 10, reveal: 0 });
      if (bolt) s.crawls.push({ bolt, t0: s.t + rnd(0, 0.06), grow: rnd(0.04, 0.12) });
    }
  }
}
function updateStrike(dt) {
  const s = strike;
  if (!s) return;
  s.t += dt;
  while (s.next < s.strokes.length && s.t >= s.strokes[s.next]) stroke(s, s.next++);
  const m = s.main;
  let I = 0;
  if (s.t < ui.leader) {
    m.reveal = Math.min(1, Math.ceil((s.t / ui.leader) * 7) / 7);   // stepped: ~7 jumps
    I = 4;
  } else {
    m.reveal = 1;
    for (let k = 0; k < s.strokes.length; k++) if (s.t >= s.strokes[k]) I += ui.intensity * Math.pow(0.75, k) * Math.exp(-(s.t - s.strokes[k]) / 0.028);
    I += ui.intensity * 0.1 * Math.exp(-(s.t - ui.leader) / 0.12);  // continuing current
  }
  m.intensity = I;
  for (const c of s.crawls) {
    const a = s.t - c.t0;
    c.bolt.reveal = a > 0 ? Math.min(1, a / c.grow) : 0;
    c.bolt.intensity = a > 0 ? 30 * Math.exp(-a / 0.12) * (0.6 + 0.4 * Math.random()) : 0;
    if (a > 0 && Math.random() < dt / 0.05) c.bolt.seed = rseed();   // micro-arcs reseed ~every 50 ms
  }
  // the floor's flash and the volumes' line light ride the JS mirror of the channel
  m.point(0.92, flash.position);
  flash.intensity = I * 6;
  boltLight.type = 1;
  boltLight.pos.copy(m.a);
  boltLight.end.copy(m.b);
  boltLight.range = 30;
  boltLight.color.setRGB(0.6, 0.7, 1);
  boltLight.intensity = I * 0.5;
  markers.forEach((mk, i) => { mk.visible = ui.markers; if (ui.markers) m.point(i / 8, mk.position); });
  if (s.t > s.strokes[s.strokes.length - 1] + 0.35) endStrike();
}
function applyBoltUI(b) {
  b.jag = b.snapToArena ? b.jag : ui.jag;
  if (!b.snapToArena) { b.width = ui.width; b.branches = ui.branches; b.subBranches = ui.subBranches; b.glowWidth = ui.glowWidth; }
  b.glowColor.copy(glowCol);
}

function explode() {
  shocks.spawn({ pos: fireball.position, radius0: 0.5, radius1: 6, duration: 0.7, thickness: ui.shockThickness * 1.2, distortion: ui.shockDistortion, color: new THREE.Color(1, 0.45, 0.15), intensity: 2.5 });
  shocks.spawn({ pos: _v.copy(fireball.position).setY(0), radius0: 0.5, radius1: 8, duration: 1, thickness: ui.shockThickness, distortion: ui.shockDistortion * 0.8, color: new THREE.Color(1, 0.4, 0.1), intensity: 1.5, ground: true });
}

// --- trails: three heads on Lissajous paths; stress mode adds 13 more
const heads = Array.from({ length: 16 }, (_, i) => ({ trail: null, phase: i * 1.7, col: new THREE.Color().setHSL((0.75 + i * 0.13) % 1, 0.9, 0.55), pos: new THREE.Vector3() }));
heads[0].col.setRGB(0.55, 0.25, 1); heads[1].col.setRGB(0.15, 0.75, 1); heads[2].col.setRGB(1, 0.42, 0.1);
function updateTrails(time) {
  heads.forEach((h, i) => {
    const want = i < 3 || ui.stress;
    if (want && !h.trail) h.trail = trails.acquire();
    if (!want && h.trail) { h.trail.release(); h.trail = null; }
    if (!h.trail) return;
    const t = time * ui.trailSpeed + h.phase, R = 2.2 + (i % 3) * 0.4;
    h.pos.set(4.8 + Math.cos(t * 1.9) * R, 1.9 + Math.sin(t * 2.7) * 0.9 + (i % 4) * 0.2, 1.2 + Math.sin(t * 1.3 + h.phase) * R * 0.7);
    const tr = h.trail;
    tr.push(h.pos);
    tr.color.copy(h.col); tr.intensity = 8; tr.width = ui.trailWidth; tr.glow = ui.trailGlow; tr.glowIntensity = ui.trailGlowI;
    tr.distortion = i === 2 ? ui.trailDistortion : 0; tr.fadeTime = ui.fadeTime; tr.taper = 1;
  });
}

// --- helix funnel at the back
const helixHandles = [];
for (let i = 0; i < 8; i++) {
  const a = helixLines.acquire(), b = helixFx.acquire();
  for (const h of [a, b]) {
    h.p0.set(0.5, 0, -8, 7);
    h.p1.set(0.35, 2.6, 2.2, i * Math.PI / 4);
    h.p2.set(h === a ? 0.025 : 0.35, 2.4, 0, 0);
  }
  a.color.setRGB(0.5, 0.85, 1); a.intensity = 7;
  b.color.setRGB(0.6, 0.75, 0.9); b.intensity = 0.25;
  helixHandles.push(a, b);
}

// --- stress: three permanent full bolts
const stressBolts = [];
function updateStress(time) {
  if (ui.stress && !stressBolts.length) {
    for (let i = 0; i < 3; i++) stressBolts.push(bolts.acquire({ a: new THREE.Vector3(-6 + i * 6, 15, -6), b: new THREE.Vector3(-5 + i * 6, 0, -3), intensity: 50 }));
  } else if (!ui.stress && stressBolts.length) stressBolts.splice(0).forEach((b) => b.release());
  for (const b of stressBolts) if (Math.random() < 0.1) b.branchSeed = rseed();
  if (ui.stress && shocks.slots.filter((s) => s.active).length < 6) {
    shocks.spawn({ pos: _v.set(rnd(-6, 6), 0, rnd(-6, 2)), radius0: 0.3, radius1: 6, duration: 1, thickness: 0.8, distortion: 0.2, color: new THREE.Color(0.4, 0.5, 1), intensity: 2, ground: Math.random() < 0.5 });
  }
}

// --- loop
await new Promise((r) => requestAnimationFrame(r));
bakeNoise(renderer, { noiseSize: 128 });
let last = performance.now(), time = 0, nextStrike = 0.8, hudT = 0, frame = 0, paused = false;

function step(dt) {
  if (!ui.freeze) time += dt;
  const sdt = ui.freeze ? 0 : dt;
  frame++;
  U.uTime.value = time % 3600; U.uDt.value = sdt; U.uFrame.value = frame;
  controls.update();

  glowCol.set(ui.glowColor).multiplyScalar(ui.glowGain);
  if (ui.auto && !ui.freeze && time > nextStrike) { startStrike(); nextStrike = time + ui.period; }
  updateStrike(sdt);
  updateStress(time);
  for (const b of bolts.bolts) if (b.active) applyBoltUI(b);
  updateTrails(time);
  for (const h of helixHandles) { h.intensity = ui.helix ? (h.p2.x > 0.1 ? 0.25 : 7) : 0; h.p2.z = ui.windDistortion; }

  fireball.visible = ui.fireballOn; smoke.visible = ui.smokeOn;
  const flick = 0.85 + 0.15 * Math.sin(time * 23) * Math.sin(time * 7.3);
  fireball.uniforms.uFire.value.set(ui.fireTemp, ui.fireIntensity, ui.turbulence, 0);
  smoke.uniforms.uSmoke.value.x = ui.smokeDensity;
  fireLight.pos.copy(fireball.position); fireLight.range = 10; fireLight.color.setRGB(1, 0.42, 0.12);
  fireLight.intensity = ui.fireballOn ? 9 * ui.fireIntensity * flick : 0;
  fireLamp.position.copy(fireball.position); fireLamp.intensity = ui.fireballOn ? 40 * ui.fireIntensity * flick : 0;

  bolts.update();
  trails.update(sdt);
  helixLines.update();
  helixFx.update();
  shocks.update(sdt);
  volumes.update(camera);
  packWorld(sdt);
  post.params.exposure = ui.exposure;
  post.params.bloomStrength = ui.bloom;

  timer.beginFrame();
  timer.begin('opaque');
  renderer.setRenderTarget(hdrRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  timer.begin('resolve');
  renderer.render(nothing, camera);
  for (const [label, mesh] of LINES) { timer.begin(label); renderer.render(mesh, camera); }

  timer.begin('fx prepass');
  renderer.setRenderTarget(fxTarget.rt);
  renderer.clear(true, true, false);
  fxTarget.prepass.render(renderer, fxTarget.rt);
  for (const [label, mesh] of FX) { timer.begin(label); renderer.render(mesh, camera); }
  timer.begin('fx comp');
  const cu = fxTarget.composite.material.uniforms;
  cu.uScene.value = hdrRT.texture;
  cu.uParams.value.set(fxTarget.params.smokeOccludesGlow, fxTarget.params.distortion, fxTarget.params.ca, 0);
  fxTarget.composite.render(renderer, fxTarget.comp);
  timer.begin('post');
  post.render(fxTarget.comp.texture, dt);
  timer.endFrame();

  hudT += dt;
  if (hudT > 0.5) {
    hudT = 0;
    const ms = timer.ms, rs = ms.resolve ?? 0;
    const lines = [`${U.uResolution.value.x}x${U.uResolution.value.y} (${(U.uResolution.value.x * U.uResolution.value.y / 1e6).toFixed(2)} MP), fx ${U.uFxResolution.value.x}x${U.uFxResolution.value.y}`];
    if (!timer.available) lines.push('no EXT_disjoint_timer_query_webgl2');
    for (const k in ms) {
      const net = LINES.some(([l]) => l === k) ? ms[k] - rs : ms[k];
      lines.push(`${k.padEnd(12)} ${net.toFixed(3)} ms${LINES.some(([l]) => l === k) ? ' (net of resolve)' : ''}`);
    }
    lines.push(`bolts live ${bolts.bolts.filter((b) => b.active).length}, steps ${fireball.uniforms.uVolSteps.value}/${smoke.uniforms.uVolSteps.value}`);
    hud.textContent = lines.join('\n');
  }
}
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!paused) step(dt);
  requestAnimationFrame(loop);
}
// Chrome/ANGLE's readPixels and finish don't wait for the GPU, so sync on a fence (UW main.js)
async function gpuFence() {
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  while (gl.clientWaitSync(s, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise((r) => setTimeout(r, 1));
  gl.deleteSync(s);
}
// n frames back to back (keeps the GPU clocked up, unlike a throttled background tab) -> mean ms per label
async function bench(n = 120, dt = 1 / 60) {
  paused = true;
  await gpuFence();
  timer.drain();
  timer.keep = true;
  for (let i = 0; i < n; i++) step(dt);
  await gpuFence();
  const ms = timer.drain();
  timer.keep = false;
  paused = false;
  const rs = ms.resolve ?? 0;
  for (const [l] of LINES) if (ms[l] !== undefined) ms[l] -= rs;   // net of the MSAA resolve every render() into hdrRT pays
  for (const k in ms) ms[k] = +ms[k].toFixed(4);
  return ms;
}
// manual frames for screenshots while the page is throttled
async function advance(seconds, dt = 1 / 60) {
  paused = true;
  for (let t = 0; t < seconds; t += dt) step(dt);
  await gpuFence();
  paused = false;
}
window.__strands = { FX, LINES, bolts, trails, helixLines, helixFx, volumes, shocks, timer, ui, camera, controls, renderer, step, bench, advance, startStrike, explode, get strike() { return strike; }, get time() { return time; } };
requestAnimationFrame(loop);
