import * as THREE from 'three';
import GUI from 'lil-gui';
import { FullscreenQuad, rawPass } from '../src/engine/fullscreen.js';
import { GpuTimer } from '../src/engine/gpuTimer.js';
import { ARENA, U, NOISE_GLSL, GROUND_GLSL } from '../src/vfx/common.js';
import { bakeNoise, blackbodySelfCheck, NOISE_TUNING } from '../src/vfx/noise.js';
import { GroundField, PAINT_BLENDING, PAINT_FRAG_HEAD } from '../src/vfx/GroundField.js';

// Standalone sandbox for noise.js + GroundField.js: field top-down (false-colour "floor" or raw
// channels), click / drag to splat, presets and scripted combos, noise / curl slices tiled 2x2
// (seams would show), the blackbody ramp, bake time, self-check and the GPU cost of update().

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const gl = renderer.getContext();
const hud = document.getElementById('hud');
const log = [];
const say = (s) => { log.push(s); console.info(s); };

let bb = 'blackbody: not run';
try { bb = blackbodySelfCheck(); say(bb); } catch (e) { bb = String(e.message); console.error(e); }
const noise = bakeNoise(renderer, { noiseSize: 128 });
say(`noise bake ${noise.ms.toFixed(1)} ms`);
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
say(`gpu: ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown'}`);

const t0 = performance.now();
let field = new GroundField(renderer, 1024);
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
say(`GroundField 1024^2 constructed in ${(performance.now() - t0).toFixed(1)} ms (mask bake + compiles); fp16 writes ${field.fp16Truncates ? 'truncate' : 'round'}`);
const timer = new GpuTimer(gl);

// --- display -----------------------------------------------------------------------------
const VIEW_FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;
${NOISE_GLSL}
${GROUND_GLSL}
in vec2 vUv;
out vec4 outColor;
uniform int uPanel;     // 0 field, 1 noise slice, 2 curl slice, 3 curl |v|, 4 blackbody ramp
uniform int uMode;      // field view mode / noise channel
uniform float uZ;
uniform int uAxis;
uniform float uExposure;
uniform float uTime2;
uniform vec3 uViewRect;   // centre x, centre z, span (m)
uniform sampler2D uFieldMask;
uniform vec4 uFast[4];   // field's fast boxes, texels (outlined when uShowFast)
uniform int uShowFast;
uniform float uFieldN;
vec3 inferno(float t) {   // polynomial fit (Matt Zucker, CC0)
  t = clamp(t, 0.0, 1.0);
  const vec3 c0 = vec3(0.0002, 0.0016, -0.0194), c1 = vec3(0.1065, 0.5639, 3.9327), c2 = vec3(11.6025, -3.9729, -15.9424);
  const vec3 c3 = vec3(-41.7040, 17.4364, 44.3541), c4 = vec3(77.1629, -33.4023, -81.8073), c5 = vec3(-71.3194, 32.6261, 73.2095), c6 = vec3(25.1311, -12.2426, -23.0703);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
vec3 srgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 tonemap(vec3 c) { c *= uExposure; return c / (1.0 + c * 0.6); }
float grout(vec2 xz) { vec2 g = abs(fract(xz + 0.5) - 0.5); return smoothstep(0.012, 0.03, min(g.x, g.y)); }

// a reference "floor" read of the field: what the arena material should roughly do with it
vec3 floorView(vec2 xz) {
  vec4 A = groundA(xz), B = groundB(xz);
  float heat = A.x, chr = A.y, wet = A.z, frost = min(A.w, 1.0);
  float crack = min(B.x, 1.0), acid = B.y, corr = min(B.z, 1.0), glow = B.w;
  vec2 pq = abs(xz - vec2(${ARENA.pool.center.x.toFixed(3)}, ${ARENA.pool.center.y.toFixed(3)}));
  bool pool = pq.x < ${ARENA.pool.half.x.toFixed(3)} && pq.y < ${ARENA.pool.half.y.toFixed(3)};
  float tile = noise3(vec3(floor(xz) * 0.173, 0.3));
  vec3 col = vec3(0.30, 0.29, 0.27) * (0.75 + 0.5 * tile) * (0.8 + 0.4 * noise3(vec3(xz * 0.21, 0.6)));
  col *= mix(0.45, 1.0, grout(xz));
  if (pool) col = vec3(0.02, 0.06, 0.08);
  col = mix(col, vec3(0.025, 0.02, 0.018), chr * 0.92);
  col *= 1.0 - 0.5 * min(wet, 1.0) * (pool ? 0.0 : 1.0);
  col = mix(col, col * vec3(0.75, 0.9, 1.2), min(wet, 1.0) * 0.6);
  col = mix(col, vec3(0.16, 0.30, 0.04) * (0.6 + 0.6 * worley3(vec3(xz * 0.9, uTime2 * 0.05))), smoothstep(0.05, 0.6, acid));
  col *= 1.0 - 0.85 * smoothstep(0.2, 0.7, crack);
  col = mix(col, vec3(0.05, 0.01, 0.07), smoothstep(0.1, 0.8, corr) * 0.9);
  // frost: rime on dry stone, glossy blue ice where it froze water
  vec3 rime = vec3(0.78, 0.86, 0.95) * (0.8 + 0.3 * worley3(vec3(xz * 3.0, 0.1)));
  vec3 ice = vec3(0.35, 0.6, 0.8);
  col = mix(col, mix(rime, ice, smoothstep(0.3, 0.9, wet)), smoothstep(0.08, 0.5, frost));
  vec3 e = vec3(0.0);
  float hot = smoothstep(0.05, 1.0, heat);
  e += blackbody(700.0 + 1900.0 * heat) * hot * hot * 6.0 * (0.55 + 0.45 * smoothstep(0.2, 0.8, crack) + 0.3 * (1.0 - grout(xz)));
  e += vec3(0.5, 0.15, 1.0) * smoothstep(0.6, 0.0, abs(corr - 0.45)) * corr * 0.8;
  e += vec3(1.0, 0.8, 0.45) * glow * 0.6;
  e += vec3(0.3, 1.0, 0.2) * smoothstep(0.4, 1.0, acid) * 0.08;
  vec3 c = col * 0.9 + e;
  c = mix(c, vec3(0.8), clamp(heat * min(wet, 1.0) * 2.5, 0.0, 0.7));   // steam where heat meets water
  return c;
}
vec3 channel(float v) { return v > 1.0 ? mix(inferno(1.0), vec3(0.3, 0.9, 1.0), clamp((v - 1.0) / 3.0, 0.0, 1.0)) : inferno(v); }

void main() {
  vec3 c = vec3(0.0);
  if (uPanel == 0) {
    vec2 xz = uViewRect.xy + (vUv - 0.5) * uViewRect.z;
    vec4 A = groundA(xz), B = groundB(xz);
    if (uMode == 0) c = floorView(xz);
    else if (uMode == 1) c = vec3(A.x, A.z * 0.6, A.z) + vec3(0.9, 0.95, 1.0) * min(A.w, 1.0) * 0.6 - A.y * 0.3;
    else if (uMode == 2) c = vec3(min(B.x, 1.0)) * 0.8 + vec3(0.2, 1.0, 0.1) * B.y + vec3(0.7, 0.1, 1.0) * min(B.z, 1.0) + vec3(1.0, 0.8, 0.3) * B.w * 0.5;
    else if (uMode < 11) { int k = uMode - 3; c = channel(k < 4 ? A[k] : B[k - 4]); }
    else if (uMode == 11) c = channel(A.x * min(A.z, 1.0) * 4.0);   // steam source
    else c = vec3(texture(uFieldMask, groundUV(xz))[uMode - 12]);
    if (uMode != 0) c = c * c;   // views are authored in display space; undo the srgb below
    vec2 t = groundUV(xz) * uFieldN, px = fwidth(t);
    for (int i = 0; i < 4; i++) {
      vec2 dl = t - uFast[i].xy, dh = uFast[i].zw - t;
      bool inR = all(greaterThan(dl, vec2(0.0))) && all(greaterThan(dh, vec2(0.0)));
      if (uShowFast == 1 && inR && min(min(dl.x, dl.y), min(dh.x, dh.y)) < px.x * 1.5) c = vec3(0.0, 1.5, 0.4);
    }
  } else if (uPanel == 1 || uPanel == 2 || uPanel == 3) {
    vec2 uv = vUv * 2.0;   // 2x2 tiles: a seam would show as a cross
    vec3 p = uAxis == 0 ? vec3(uv, uZ) : vec3(uv.x, uZ, uv.y);
    if (uPanel == 1) c = vec3(noise3v(p)[uMode]);
    else if (uPanel == 2) c = texture(uCurl3D, p).rgb;
    else c = inferno(length(curl3(p)));
    c = c * c;
  } else {
    float k = 500.0 * pow(40.0, vUv.x);
    c = blackbody(k);
    float tick = step(0.85, vUv.y) * step(fract(k / 1000.0 + 0.002), 0.004 * k / 1000.0 + 0.01) * step(k, 10500.0);
    c = vUv.y > 0.5 ? c / max(max(c.r, c.g), c.b) : tonemap(c);
    c = mix(c, vec3(1.0), tick);
  }
  outColor = vec4(srgb(uPanel == 0 && uMode == 0 ? tonemap(c) : c), 1.0);
}`;
const view = rawPass(VIEW_FRAG, {
  ...U, uPanel: { value: 0 }, uMode: { value: 0 }, uZ: { value: 0.5 }, uAxis: { value: 0 }, uExposure: { value: 1.2 }, uTime2: { value: 0 }, uViewRect: { value: new THREE.Vector3(0, 0, 40) }, uFieldMask: { value: null }, uFast: { value: null }, uShowFast: { value: 0 }, uFieldN: { value: 1024 },
});
const viewQuad = new FullscreenQuad(view);

// --- GUI + interaction ---------------------------------------------------------------------
const MODES = { floor: 0, 'A (heat r, wet b, frost w)': 1, 'B (crack, acid, corr, glow)': 2, heat: 3, char: 4, wet: 5, frost: 6, crack: 7, acid: 8, corruption: 9, glow: 10, 'steam (heat x wet)': 11, 'mask r frost': 12, 'mask g crack': 13, 'mask b corruption': 14, 'mask a fbm': 15 };
const PRESETS = {
  'fireball impact': { pattern: 'radial', radius: 2.5, heat: 1, char: 0.8 },
  'thunderstrike': { pattern: 'lichtenberg', radius: 2.5, heat: 0.9, char: 1, glow: 1.5 },
  'frost nova (potential 1.8)': { pattern: 'radial', radius: 1.2, frost: 1.8 },
  'nova ring': { pattern: 'ring', radius: 3, frost: 1.4, glow: 0.5, width: 0.4 },
  'water splash': { pattern: 'radial', radius: 3, wet: 1 },
  'earth fissure (drag)': { pattern: 'line', crack: 2.4, heat: 0, width: 0.18 },
  'wind slash (drag)': { pattern: 'line', crack: 0.9, width: 0.05 },
  'acid pool': { pattern: 'noise', radius: 2.5, acid: 1 },
  'void corruption': { pattern: 'radial', radius: 0.8, corruption: 2.6 },
  'holy judgment': { pattern: 'ring', radius: 2.2, glow: 3, width: 0.5 },
  'magma (heat into cracks)': { pattern: 'radial', radius: 2, heat: 1.2 },
};
const CH = ['heat', 'char', 'wet', 'frost', 'crack', 'acid', 'corruption', 'glow'];
const S = {
  preset: 'fireball impact', pattern: 'radial', radius: 2.5, width: 0, angle: 0,
  heat: 1, char: 0.8, wet: 0, frost: 0, crack: 0, acid: 0, corruption: 0, glow: 0,
  zoom: 1, cx: 0, cz: 0, mode: 0, timeScale: 1, paused: false, partial: true, showFast: false, paintDemo: false, size: 1024, z: 0.5, axis: 0, noiseChannel: 0, exposure: 1.2,
};
const applyPreset = () => { const p = PRESETS[S.preset]; for (const k of CH) S[k] = 0; S.width = 0; Object.assign(S, p); gui.controllersRecursive().forEach((c) => c.updateDisplay()); };
const gui = new GUI({ title: 'fields' });
gui.add(S, 'preset', Object.keys(PRESETS)).onChange(applyPreset);
gui.add(S, 'mode', MODES).name('view');
gui.add(S, 'timeScale', 0, 3, 0.05).name('time scale');
gui.add(S, 'paused');
gui.add(S, 'partial').name('partial update').onChange((v) => { field.partial = v; });
gui.add(S, 'showFast').name('show fast boxes');
gui.add(S, 'paintDemo').name('paint demo (particles)').onChange(() => syncPaint());
gui.add({ clear: () => field.clear() }, 'clear');
const fs = gui.addFolder('splat').close();
fs.add(S, 'pattern', ['radial', 'lichtenberg', 'ring', 'noise', 'line']);
fs.add(S, 'radius', 0.2, 6, 0.05); fs.add(S, 'width', 0, 1.5, 0.01); fs.add(S, 'angle', 0, 6.28, 0.01);
for (const k of CH) fs.add(S, k, -1, 4, 0.05);
const combos = gui.addFolder('combos');
const at = (t, fn) => setTimeout(fn, t * 1000 / Math.max(S.timeScale, 0.05));
combos.add({ steam: () => { field.splat({ x: -6, z: 4, radius: 1.2, frost: 1.8 }); at(2.2, () => field.splat({ x: -5.5, z: 4.3, radius: 2.5, heat: 1, char: 0.8 })); } }, 'steam').name('steam: nova, then fireball');
combos.add({ f: () => { field.splat({ x: 5, z: -6, radius: 3, wet: 1 }); at(1, () => field.splat({ x: 7.5, z: -3.5, radius: 1, frost: 1.8 })); } }, 'f').name('flash freeze: lance, spike by pool');
combos.add({ m: () => { field.splat({ pattern: 'line', x: -10, z: -8, x2: -4, z2: -11, width: 0.2, crack: 2.4 }); at(1.5, () => field.splat({ x: -7, z: -9.5, radius: 2.2, heat: 1.3, char: 0.6 })); } }, 'm').name('magma: fissure, then fireball');
combos.add({ c: () => { field.splat({ x: 0, z: 9, radius: 3, wet: 1, pattern: 'noise' }); at(1, () => field.splat({ x: 0.5, z: 9, radius: 2.5, heat: 0.9, char: 1, glow: 1.5, pattern: 'lichtenberg' })); } }, 'c').name('conduction: water, then strike');
combos.add({ p: () => { field.splat({ x: 6, z: 10, radius: 0.8, corruption: 2.6 }); at(2.5, () => field.splat({ x: 6, z: 10, radius: 2.4, glow: 3, pattern: 'ring', width: 0.6 })); } }, 'p').name('purge: corruption, then judgment');
const fp = gui.addFolder('sim params').close();
const addParams = () => { fp.controllers.slice().forEach((c) => c.destroy()); for (const k in field.params) fp.add(field.params, k); };
addParams();
const fn = gui.addFolder('noise').close();
fn.add(S, 'z', 0, 1, 0.001).name('slice'); fn.add(S, 'axis', { xy: 0, xz: 1 }); fn.add(S, 'noiseChannel', { r: 0, g: 1, b: 2, a: 3 });
fn.add({ stats: () => noiseStats() }, 'stats').name('noise stats (log)');
gui.add(S, 'size', [512, 1024, 2048]).name('field size').onChange((n) => { field.dispose(); field = new GroundField(renderer, n, { partial: S.partial }); addParams(); syncPaint(); });
gui.add(S, 'exposure', 0.2, 4, 0.05);
gui.add(S, 'zoom', 1, 10, 0.5).name('zoom (right-click: centre)');
gui.add({ bench: () => bench() }, 'bench').name('bench: fill whole field');
gui.add({ check: () => checkPartial() }, 'check').name('check partial update (log)');

let fieldRect = { x: 0, y: 0, s: 1 };
const span = () => ARENA.ground.size / S.zoom;
const toWorld = (e) => {
  const u = (e.clientX - fieldRect.x) / fieldRect.s, v = 1 - (e.clientY - fieldRect.y) / fieldRect.s;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [S.cx + (u - 0.5) * span(), S.cz + (v - 0.5) * span()] : null;
};
renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); const w = toWorld(e); if (w) [S.cx, S.cz] = w; });
let drag = null, mouse = null, lastPaint = 0;
const splatAt = (w, w2) => field.splat({ ...Object.fromEntries(CH.map((k) => [k, S[k]])), pattern: S.pattern, radius: S.radius, width: S.width, angle: S.angle, x: w[0], z: w[1], x2: w2?.[0], z2: w2?.[1] });
renderer.domElement.addEventListener('pointerdown', (e) => {
  const w = toWorld(e);
  if (!w || e.button !== 0) return;
  drag = w;
  if (S.pattern !== 'line') splatAt(w);
});
addEventListener('pointermove', (e) => {
  mouse = toWorld(e);
  if (drag && mouse && S.pattern !== 'line' && e.shiftKey && performance.now() - lastPaint > 60) { splatAt(mouse); lastPaint = performance.now(); }
});
addEventListener('pointerup', (e) => {
  const w = toWorld(e);
  if (drag && w && S.pattern === 'line') splatAt(drag, w);
  drag = null;
});

// --- noise calibration: bake raw sums (identity stretch), read every slice, log percentiles --
function noiseStats() {
  const saved = { ...NOISE_TUNING };
  Object.assign(NOISE_TUNING, { PW_LO: 0, PW_HI: 1, W_LO: 0, W_HI: 1 });   // curl keeps the live scale
  const b = bakeNoise(renderer, { noiseSize: 64 });
  Object.assign(NOISE_TUNING, saved);
  const read = (rt, n) => {
    const out = new Uint8Array(n * n * n * 4), slice = new Uint8Array(n * n * 4);
    for (let z = 0; z < n; z++) { renderer.setRenderTarget(rt, z); gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, slice); out.set(slice, z * n * n * 4); }
    renderer.setRenderTarget(null);
    return out;
  };
  const nd = read(b.targets[0], 64), cd = read(b.targets[1], 64);
  const pct = (c) => { const v = []; for (let i = c; i < nd.length; i += 4) v.push(nd[i]); v.sort((x, y) => x - y); return [v[v.length * 0.01 | 0] / 255, v[v.length * 0.99 | 0] / 255]; };
  let sum = 0, clip = 0;
  for (let i = 0; i < cd.length; i += 4) {
    const x = cd[i] / 127.5 - 1, y = cd[i + 1] / 127.5 - 1, z = cd[i + 2] / 127.5 - 1;
    sum += Math.hypot(x, y, z); if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 0.99) clip++;
  }
  const mean = sum / (cd.length / 4);
  say(`noise raw p1/p99: r ${pct(0).map((x) => x.toFixed(3))} g ${pct(1).map((x) => x.toFixed(3))} b ${pct(2).map((x) => x.toFixed(3))} a ${pct(3).map((x) => x.toFixed(3))}`);
  say(`curl @${saved.CURL_SCALE}: mean |curl| ${mean.toFixed(3)} (clipped ${(clip / (cd.length / 4) * 100).toFixed(2)}%) -> CURL_SCALE ${(saved.CURL_SCALE * 0.5 / mean).toFixed(4)} for 0.5`);
  b.targets.forEach((t) => t.dispose());
  // the stats bake replaced the live textures; rebake with the real tuning
  const nb = bakeNoise(renderer, { noiseSize: 128 });
  const st = { r: pct(0), g: pct(1), b: pct(2), a: pct(3), curlMean: mean, live: nb.ms };
  window.noiseStatsResult = st;
  return st;
}

// --- partial-update check: spells scattered over the arena, then (1) every live region lies
// inside a fast box and (2) the two ping-pong targets agree everywhere outside what the last
// update stepped (else the field would flicker / lose state). Logs and returns the result.
// Embers paint meanwhile, so overlapping boxes and paint are exercised too.
function checkPartial() {
  const f = field, n = f.size, saved = [S.paused, S.paintDemo];
  S.paused = true; S.paintDemo = true; syncPaint();   // embers paint (and touch) over the spells too
  f.clear(); step(1);
  const shots = [[-6, 4, { frost: 1.8 }], [5, -6, { wet: 1, radius: 3 }], [-14, 12, { corruption: 2.6 }], [14, -14, { acid: 1, pattern: 'noise' }], [0, 9, { heat: 0.9, char: 1, glow: 1.5, pattern: 'lichtenberg' }], [7.5, -3.5, { frost: 1.8 }]];
  const rd = (t, i) => { const b = new Uint16Array(n * n * 4); renderer.readRenderTargetPixels(t, 0, 0, n, n, b, undefined, i); return b; };
  const inBox = (x, y, b) => x >= b.x && x < b.z && y >= b.y && y < b.w;
  let bad = 0, lost = 0;
  for (const [k, [x, z, o]] of shots.entries()) {
    f.splat({ x, z, radius: 1.2, ...o });
    step(25 + k * 20);
    const t = n / ARENA.ground.size;
    for (const r of f.regions) if (r.until >= f.time) {
      const c = [(r.x0 + r.x1) / 2 - ARENA.ground.min.x, (r.z0 + r.z1) / 2 - ARENA.ground.min.y].map((v) => Math.min(Math.max(Math.round(v * t), 0), n - 1));
      if (!f.boxes.slice(0, f.boxCount).some((b) => inBox(c[0], c[1], b))) lost++;
    }
    for (let i = 0; i < 2; i++) {
      const a = rd(f.targets[0], i), b = rd(f.targets[1], i);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const p = (y * n + x) * 4;
        let same = true;
        for (let c = 0; c < 4; c++) same &&= (a[p + c] & 0x7fff ? a[p + c] : 0) === (b[p + c] & 0x7fff ? b[p + c] : 0);   // -0 == 0
        if (same || inBox(x, y, f._lastBand) || f._lastBoxes.slice(0, f._lastBoxCount).some((q) => inBox(x, y, q))) continue;
        bad++;
      }
    }
  }
  S.paintDemo = false; syncPaint();
  step(1200);   // everything expires; bands carry on
  const ok = bad === 0 && lost === 0 && f.boxCount === 0;
  say(`partial check ${ok ? 'ok' : 'FAILED'}: ${bad} texels differ outside stepped rects, ${lost} regions outside boxes, ${f.boxCount} boxes after expiry`);
  [S.paused, S.paintDemo] = saved; syncPaint();
  return ok;
}
window.checkPartial = checkPartial;

// --- bench: fill the whole field (worst case), let the timer settle --------------------------
function bench() {
  for (let i = 0; i < 16; i++) field.splat({ x: -15 + (i % 4) * 10, z: -15 + (i >> 2) * 10, radius: 6, heat: 0.6, char: 0.5, wet: 0.5, frost: 1.5, crack: 2, acid: 0.5, corruption: 2, glow: 1, pattern: 'radial' });
}

// --- paint demo: how a spell paints with particles. Points drawn into field.paintScene with
// PAINT_BLENDING + PAINT_FRAG_HEAD write per-frame increments (scale by dt); the area must be
// touch()ed or the paint is scissored away. Here: 24 embers orbiting, leaving heat + glow.
const paintMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3, ...PAINT_BLENDING,
  uniforms: { uT: { value: 0 }, uDt: { value: 0 } },
  vertexShader: /* glsl */`
precision highp float;
uniform mat4 projectionMatrix, modelViewMatrix;
uniform float uT;
in vec3 position;
void main() {
  float a = position.x + uT * 0.9;
  vec3 p = vec3(cos(a) * 6.0, 0.0, sin(a * 1.0) * 6.0) * (0.8 + 0.2 * sin(a * 3.0 + uT));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 9.0;   // field texels (~0.35 m at 1024^2)
}`,
  fragmentShader: /* glsl */`
precision highp float;
uniform float uDt;
${PAINT_FRAG_HEAD}
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0, m = max(1.0 - r * r, 0.0) * uDt;
  gA = vec4(4.0 * m, 0.0, 0.0, 0.0);
  gB = vec4(0.0, 0.0, 0.0, 3.0 * m);
}`,
});
const paintGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 24 * 3 }, (_, i) => (i % 3 ? 0 : (i / 3) * 6.2832 / 24)), 3));
const embers = new THREE.Points(paintGeo, paintMat);
embers.frustumCulled = false;
function syncPaint() { embers.removeFromParent(); if (S.paintDemo) field.paintScene.add(embers); }
function beforeUpdate(dt) {
  paintMat.uniforms.uT.value += dt;
  paintMat.uniforms.uDt.value = dt;
  if (S.paintDemo) field.touch(0, 0, 7.5, 0.25);
}

// --- loop -------------------------------------------------------------------------------------
const clock = new THREE.Timer();
let frames = 0, fpsT = 0, fps = 0;
function frame() {
  requestAnimationFrame(frame);
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.1);
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  const sdt = S.paused ? 0 : dt * S.timeScale;
  view.uniforms.uTime2.value += sdt;
  if (mouse) field.setProbes([mouse, [ARENA.pool.center.x, ARENA.pool.center.y]]);
  timer.beginFrame();
  beforeUpdate(sdt);
  timer.begin('field');
  field.update(sdt);
  timer.end();
  timer.endFrame();
  draw();
}
// console hooks (a background tab gets few rAF ticks): step(n, dt) runs n sim steps, then draws
window.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { view.uniforms.uTime2.value += dt; beforeUpdate(dt); field.update(dt); } draw(); };
function draw() {
  const W = innerWidth, H = innerHeight;
  const s = Math.floor(Math.min(H - 20, W - 400)), cx = s + 20, cw = Math.min(360, W - s - 30), q = Math.floor((cw - 10) / 2);
  fieldRect = { x: 10, y: 10, s };
  const v = view.uniforms;
  if (S.zoom === 1) S.cx = S.cz = 0;
  v.uViewRect.value.set(S.cx, S.cz, span());
  v.uFieldMask.value = field.mask.texture;
  v.uFast.value = field.boxes; v.uShowFast.value = S.showFast ? 1 : 0; v.uFieldN.value = field.size;
  v.uMode.value = S.mode; v.uZ.value = S.z; v.uAxis.value = S.axis; v.uExposure.value = S.exposure;
  renderer.setScissorTest(true);
  const panel = (id, mode, x, y, w, h) => {
    renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
    v.uPanel.value = id; v.uMode.value = mode;
    viewQuad.render(renderer, null);
  };
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H);
  renderer.setClearColor(0x0b0c0e); renderer.clear();
  panel(0, S.mode, 10, 10, s, s);
  const y0 = 260;
  for (let c = 0; c < 4; c++) panel(1, c, cx + (c % 2) * (q + 10), y0 + (c >> 1) * (q + 10), q, q);
  panel(2, 0, cx, y0 + 2 * (q + 10), q, q);
  panel(3, 0, cx + q + 10, y0 + 2 * (q + 10), q, q);
  panel(4, 0, cx, y0 + 3 * (q + 10), cw, 40);
  renderer.setScissorTest(false);

  const P = field.probes, pr = (o) => CH.map((k, i) => `${k} ${P[o + i].toFixed(2)}`).join('  ');
  hud.style.left = `${cx}px`;
  hud.textContent = [
    `${fps.toFixed(0)} fps   field ${field.size}^2   update() GPU ${timer.available ? (timer.ms.field ?? 0).toFixed(4) + ' ms' : 'n/a (no timer ext)'}`,
    `fast boxes ${field.boxCount}: ${(field.boxes.reduce((s, b) => s + (b.z - b.x) * (b.w - b.y), 0) / field.size ** 2 * 100).toFixed(1)}% of field stepped every frame, band ${field.band}`,
    ...log.slice(-8),
    '',
    'click: splat  (shift-drag: paint, line: drag)',
    mouse ? `@ ${mouse[0].toFixed(1)}, ${mouse[1].toFixed(1)}` : '',
    field.probeCount ? pr(0).slice(0, 70) : '', field.probeCount ? pr(0).slice(70) : '',
    field.probeCount > 1 ? `pool: wet ${P[10].toFixed(2)} frost ${P[11].toFixed(2)}` : '',
    '',
    `noise3D slices (r g / b a), 2x2 tiles; curl rgb, |curl|; blackbody 500..20000 K`,
  ].join('\n');
}
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
window.field = () => field;
window.S = S;
window.timer = timer;
window.noiseStats = noiseStats;
frame();
