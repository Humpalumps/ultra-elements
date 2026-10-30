import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { U, packWorld, lights, forces, occluders, ARENA } from '../src/vfx/common.js';
import { Particles } from '../src/vfx/Particles.js';
import { FxTarget } from '../src/vfx/FxTarget.js';
import { PostFX } from '../src/engine/PostFX.js';
import { GpuTimer } from '../src/engine/gpuTimer.js';
import { Q } from '../src/engine/quality.js';

// Sandbox for the shared particle pool + FX composite (main thread's modules).
const renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false });
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
try { const { bakeNoise } = await import('../src/vfx/noise.js'); bakeNoise(renderer, Q); } catch (e) { console.warn('noise bake unavailable', e); }

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(6, 4, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
const scenes = { opaque: new THREE.Scene(), lines: new THREE.Scene(), fx: new THREE.Scene() };
scenes.opaque.background = new THREE.Color(0x0a0d12);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.4 }));
floor.rotation.x = -Math.PI / 2;
const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 6), new THREE.MeshStandardMaterial({ color: 0x555a60 }));
pillar.position.set(-2, 3, -1);
occluders.add(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(-2, 6, -1), 0.6);
scenes.opaque.add(floor, pillar, new THREE.HemisphereLight(0x8899aa, 0x202020, 0.6));
const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
sun.position.set(5, 8, 3);
scenes.opaque.add(sun);
U.uSunDir.value.copy(sun.position).normalize();
U.uSunColor.value.set(0.4, 0.38, 0.35);
U.uAmbient.value.set(0.05, 0.06, 0.08);

const P = new Particles(renderer);
P.addKind('spark', { style: 'glow', drag: 0.6, gravity: 9, restitution: 0.45, friction: 0.25, life: [0.5, 1.4], size: [0.04, 0.012], stretch: 0.025, emissive: 40, temp: [3200, 1300], alpha: [1, 0] });
P.addKind('flame', { style: 'media', drag: 2.2, buoyancy: 3.2, curl: 2, curlScale: 0.35, life: [0.4, 0.75], size: [0.35, 1.0], emissive: 6, temp: [2300, 1100], toSmokeAt: 0.55, smokeAlbedo: 0.08, alpha: [0.9, 0], density: 4, distortion: 1, erosion: 0.6 });
P.addKind('smoke', { style: 'media', drag: 1.5, buoyancy: 0.9, curl: 0.8, life: [2, 3.5], size: [0.6, 2.2], emissive: 0, color: ['#3a3d42', '#202226'], alpha: [0.6, 0], density: 2.5, erosion: 0.5, forceResponse: 1 });
P.addKind('rock', { style: 'debris', mesh: 'rock', drag: 0.1, gravity: 9.8, restitution: 0.3, friction: 0.6, life: [3, 4], size: [0.25, 0.25], color: ['#5a5550', '#5a5550'], alpha: [1, 1], spin: 6, fadeOut: 0.2 });
P.build();
scenes.lines.add(P.glow);
scenes.fx.add(P.media);
scenes.opaque.add(...P.debris);

const spark = P.emitter('spark', { shape: 'sphere', radius: 0.1, spread: 7 });
const flame = P.emitter('flame', { shape: 'sphere', radius: 0.25, spread: 0.6 });
const smoke = P.emitter('smoke', { shape: 'sphere', radius: 0.4, spread: 0.5 });
const rock = P.emitter('rock', { shape: 'sphere', radius: 0.3, spread: 4 });
const L = lights.acquire();
Object.assign(L, { range: 10, intensity: 30 });
L.color.setRGB(1, 0.45, 0.15);
const wind = forces.acquire();
Object.assign(wind, { type: 0, p: [3, 0.3, 0.4, 0] });
wind.dir.set(1, 0, 0);

const fxT = new FxTarget(renderer);
const post = new PostFX(renderer);
const timer = new GpuTimer(renderer.getContext());
let hdr;
function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  hdr?.dispose();
  hdr = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(s.x, s.y, THREE.FloatType) });
  U.uSceneDepth.value = hdr.depthTexture;
  U.uSceneColor.value = hdr.texture;
  U.uResolution.value.copy(s);
  U.uNearFar.value.set(camera.near, camera.far);
  fxT.setSize(s.x, s.y, 0.5);
  post.setSize(s.x, s.y);
}
addEventListener('resize', resize);
resize();

let t = 0, last = performance.now(), burst = 0;
const info = document.getElementById('info');
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  t += dt;
  U.uTime.value = t; U.uDt.value = dt; U.uFrame.value++;
  controls.update();
  flame.pos.set(Math.sin(t * 0.7) * 2, 0.4, 0); flame.rate(500, dt);
  smoke.pos.set(Math.sin(t * 0.7) * 2, 1.6, 0); smoke.rate(25, dt);
  L.pos.set(Math.sin(t * 0.7) * 2, 0.8, 0);
  L.intensity = 25 + 8 * Math.sin(t * 23) * Math.sin(t * 7);
  if ((burst -= dt) <= 0) {
    burst = 2;
    spark.pos.set(1, 1.5, 1.5); spark.burst(1500);
    rock.pos.set(1, 1.5, 1.5); rock.vel.set(0, 4, 0); rock.burst(60);
  }
  packWorld(dt);
  timer.beginFrame();
  timer.begin('sim');
  P.update(dt, t);
  timer.begin('opaque');
  renderer.setRenderTarget(hdr);
  renderer.setClearColor(0, 1);
  renderer.clear();
  renderer.render(scenes.opaque, camera);
  timer.begin('lines');
  renderer.render(scenes.lines, camera);
  const tex = fxT.render(scenes.fx, camera, hdr.texture, timer);
  timer.begin('post');
  post.render(tex, dt);
  timer.endFrame();
  info.textContent = `alive ≤ ${P.alive}\n` + Object.entries(timer.ms).map(([k, v]) => `${k.padEnd(7)} ${v.toFixed(3)} ms`).join('\n');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.P = P;
