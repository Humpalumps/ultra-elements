import * as THREE from 'three';
import { COMMON_GLSL, NOISE_GLSL, WORLD_GLSL, LIGHTS_GLSL, FX_VERT_HEAD, FX_FRAG_HEAD, FX_OUT_GLSL, FX_BLENDING } from '../../vfx/common.js';
import { createStreakField } from '../ice/blizzard.js';

// Sandstorm (wind + earth): a haboob. Reference: the Phoenix haboob of 5 July 2011 and the Khartoum
// haboobs: a towering rolling front, dark and dense at the base, its upper billows lit by the low sun
// (here mostly from behind: glowing rims over a dark face), sand and debris racing low along the
// floor ahead of it. Inside, visibility collapses with depth but keeps structure: gust bands, low
// sand streams snaking over the floor, grains streaking past, a dim sun disc, pillars fading out,
// the air darkening and reddening with depth.
// The caster's gathering gust raises the wall beyond the far rim; it rolls across the arena and
// stops past the target, then thins and clears.
//   storm  ONE fx-pass draw per cast (a back-faced cylinder over the whole storm), our own march:
//          - the wall: a signed field (head profile, plan lobes, towers, billows riding round a rotor
//            behind the face so they climb it and roll back over the top) marched by sphere tracing
//            towards it and fine steps through its dense skin, so billow edges stay crisp; lit by two
//            sun taps through the billows plus the storm's bulk, two HG lobes and a tinted
//            multiple-scattering term, the sky dimmed by the column above
//          - the body: exponential height dust behind the front, banded by gusts advected with the
//            wind, low sand streams on the floor; 6 taps per segment, denser near the camera
//          - the shadow: sun-lit geometry ahead of the wall that the head hides from the low sun,
//            and everything inside the storm, loses its direct light
//   grains createStreakField (blizzard.js): motion-blurred sand grains in a box that follows the
//          camera, present only inside the storm
//   world  a push force carries every loose particle with the front, debris tumbles out ahead of
//          it, the floor is scoured in streaks along the travel direction, dummies are shoved as the
//          front hits and buffeted inside it, the pool ripples under it.

const NV = 3, STATES = 16, RIM = 17.5, FADE = 3.4, RD = 36, YB = -4, YT = 20;

const STORM_U = /* glsl */`
uniform vec4 uSt0;   // front x, z, height m, clock s
uniform vec4 uSt1;   // travel dir x, z, wall density 1/m, body dust density at the floor 1/m
uniform vec4 uSt2;   // seed 0..1, fade 0..1, rise 0..1, billow
uniform vec4 uSt3;   // roll (noise turns), advection m, shadow 0..1, march iterations
uniform vec4 uSt4;   // settle 0..1 (aftermath), streamers 0..1, body taps, -
uniform vec3 uStSand;
float gH = 1.0;      // the live wall height (height x rise)
// the front's frame: x ahead of the front (m), y across it
vec2 stFrame(vec3 p) { vec2 q = p.xz - uSt0.xy; return vec2(dot(q, uSt1.xy), q.x * uSt1.y - q.y * uSt1.x); }
float stLobe(float x) { float k = uSt2.x * 6.2832; return 0.55 * sin(x * 0.19 + k) + 0.3 * sin(x * 0.43 - 1.7 * k + 0.07 * uSt0.w) + 0.15 * sin(x * 1.05 + 3.1 * k); }
// towers along the top
float stTop(float x) { float k = uSt2.x * 6.2832; return gH * (0.8 + 0.15 * sin(x * 0.13 + 2.0 * k) + 0.1 * sin(x * 0.31 - 4.1 * k) + 0.05 * sin(x * 0.77 + k)); }
// the leading face at height y: a gravity-current head. The foot is dragged out ahead along the
// floor (the outflow hugs the ground, so the base is attached and densest), the face above stands
// near-vertical with a slight bulge, the top curls back; lobed in plan all the way down
float stFace(float x, float y) {
  float h = clamp(y / gH, 0.0, 1.2), u = 1.0 - min(h, 1.0);
  return gH * (0.13 * u * u * u + 0.05 * sin(PI * min(h, 1.0)) - 0.05 + 0.14 * stLobe(x) * mix(0.55, 1.0, smoothstep(0.0, 0.5, h)));
}
// the dust's scale height; in the aftermath it settles towards the floor
float stScaleH() { return 0.42 * uSt0.z * (1.0 - 0.72 * uSt4.x); }
// noise coordinates riding round a rotor behind the face (two tiles per turn, so it tiles)
vec3 stRotor(vec2 f, float y) {
  vec2 rp = vec2(f.x + 0.25 * gH, y - 0.5 * gH);
  return vec3(f.y * 0.05 + uSt2.x * 7.0, length(rp) * 0.065, atan(rp.y, rp.x) * (1.0 / PI) - uSt3.x);
}
// the wall's signed field (m, + inside); it shrinks a little as it fades
// (fc, tp: the face and the tops at this sample, so the march evaluates them once per step)
float stWallFT(float fc, float tp, float x, float y, float n1, float n2) {
  float amp = 0.2 * gH * uSt2.w * mix(0.45, 1.0, smoothstep(0.0, 0.3 * gH, y));
  float b = (n1 - 0.5) * 2.0 * amp + (n2 - 0.5) * 0.9 * amp;
  return min(fc - x + b, tp - y + 0.8 * b) - (1.0 - uSt2.y) * 0.15 * gH;
}
float stWall(vec2 f, float y, float n1, float n2) { return stWallFT(stFace(f.y, y), stTop(f.y), f.x, y, n1, n2); }
// a dense skin following the billows, thinning into the body behind; densest and darkest low down
float stWallSigma(float D, float e, float y) {
  // (low down the skin runs further back: the foot is a deep, dense mass on the floor)
  float back = 0.25 * gH * (1.0 - smoothstep(0.06 * gH, 0.3 * gH, y));
  return uSt1.z * uSt2.y * smoothstep(0.0, e, D) * (1.0 - 0.65 * smoothstep(0.12 * gH, 0.35 * gH, D - back)) * (1.8 - 1.1 * clamp(y / gH, 0.0, 1.0));
}
// the sun's optical depth to (y, f) through the storm's bulk (the wall's own billows are tapped
// separately); top = stTop(f.y)
float stSunOD(float y, vec2 f, float top) {
  float sT = dot(uSunDir.xz, uSt1.xy);
  float Ls = sT < -0.02 ? 45.0 : clamp((0.1 * gH - f.x) / max(sT, 0.02), 0.0, 45.0);
  Ls = min(Ls, max(1.15 * gH - y, 0.0) / max(uSunDir.y, 0.02));
  // the wall's own mass: everything under the head, and, with the sun behind the storm, anything
  // ahead of the face whose sun ray still crosses the face below the tops (lobes thrown forward of
  // the face sit in its shadow; only the upper billows catch the low sun)
  float inWall = f.x < 0.3 * gH ? step(y, top) : 0.0;
  if (sT < -0.02 && f.x > 0.0) inWall = max(inWall, 1.0 - smoothstep(0.7, 1.05, (y + uSunDir.y * (f.x + 0.05 * gH) / -sT) / max(top, 0.1)));
  float body = 0.2 * uSt1.z * uSt2.y * min(Ls, 0.8 * gH) * inWall;
  return uSt1.w * exp(-max(y, 0.0) / stScaleH()) * 0.8 * Ls + body;
}
float stSunBulk(float y, vec2 f) { return exp(-stSunOD(y, f, stTop(f.y))); }
`;

const STORM_VERT = FX_VERT_HEAD + /* glsl */`
out vec3 vW;
flat out vec4 vCyl;   // centre x, z, radius, -
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vCyl = vec4(modelMatrix[3].x, modelMatrix[3].z, length(modelMatrix[0].xyz), 0.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// every lookup at LOD 0: implicit gradients inside a data-dependent loop make FXC unroll it
const STORM_FRAG = FX_FRAG_HEAD + '#define texture(s, p) textureLod(s, p, 0.0)\n' + COMMON_GLSL + NOISE_GLSL + WORLD_GLSL + LIGHTS_GLSL + FX_OUT_GLSL + /* glsl */`
uniform mat4 projectionMatrix;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
` + STORM_U + /* glsl */`
in vec3 vW;
flat in vec4 vCyl;
vec3 gSunS, gSunM, gSky, gTint, gLogTint;
// dust in the storm's body behind the front (1/m): exponential with height, gust bands riding the wind
float stBody(vec3 p, vec2 f) {
  float y = max(p.y, 0.0);
  float a = dot(p.xz, uSt1.xy) - uSt3.y;
  float n = noise3(vec3(f.y * 0.13, y * 0.2, a * 0.045) + uSt2.x * 3.0);
  float g = 0.1 + 2.4 * n * n;
  if (uSt4.x > 0.0) {   // settling: the haze stratifies into thin sheets and drifting wisps
    float n2 = noise3(vec3(f.y * 0.34 + 0.4 * sin(a * 0.21), y * 1.1, a * 0.12) + uSt2.x * 7.0 + 0.37);
    g *= mix(1.0, 0.15 + 2.6 * n2 * n2, uSt4.x);
  }
  return uSt1.w * smoothstep(0.1 * gH, -0.45 * gH, f.x) * exp(-y / stScaleH()) * g
       * (1.0 - smoothstep(0.85 * uSt0.z, 1.3 * uSt0.z, y));
}
// low sand streams snaking over the floor, inside the storm and racing ahead of its foot
float stStreams(vec3 p, vec2 f) {
  float y = max(p.y, 0.0);
  if (y > 2.2) return 0.0;
  float ahead = f.x - stFace(f.y, 0.0);
  float a = dot(p.xz, uSt1.xy) - 1.5 * uSt3.y;
  float n = noise3(vec3((f.y + 0.6 * sin(a * 0.4)) * 0.2, y * 0.3, a * 0.04) + uSt2.x * 5.0);
  float amt = max(uSt2.y, uSt4.y), sh = mix(0.04 * gH + 0.2, 0.35, uSt4.x);   // the aftermath's sand snakes hug the floor
  return uSt1.z * 0.4 * amt * (1.0 - smoothstep(0.0, 0.5 * gH, ahead)) * exp(-y / sh) * smoothstep(0.42, 0.8, n);
}
// light scattered towards the eye from dust at p, given the sun's optical depth to it
vec3 stLight(float odSun, float y, float occ) {
  float sky = exp(-uSt1.w * stScaleH() * exp(-max(y, 0.0) / stScaleH()) * 0.6);
  return gSunS * exp(-odSun) + gSunM * exp(-0.35 * odSun) + gSky * occ * (0.3 + 0.7 * sky) * mix(0.15, 1.0, smoothstep(0.0, 0.85 * gH, y));
}
void addSlab(float sg, float dt, float t, vec3 L, inout vec3 col, inout float T, inout float zs, inout float ws, inout float odv) {
  float a = T * (1.0 - exp(-sg * dt));
  // deep in the dust the light that reaches the eye has been scattered over and over: darker, redder
  col += a * L * exp2(gLogTint * (1.0 + min(odv * 0.15, 1.4)));
  zs += a * t; ws += a; odv += sg * dt;
  T *= exp(-sg * dt);
}
// the body (and the streams) over [ta, tb]: uSt4.z taps (4, up to 10 once the wall is gone), denser near the start
// tE: where the segment would end without the scene, so the taps don't move when geometry cuts the
// ray short (a pillar or a dummy inside the storm must not be sampled differently from its neighbours)
void stBodySeg(vec3 o, vec3 rd, float ta, float tb, float tE, inout vec3 col, inout float T, inout float zs, inout float ws, inout float odv) {
  if (tb <= ta || T < 0.01) return;
  float L = tE - ta, prev = 0.0, nb = uSt4.z;
  for (int i = 1; i <= 12; i++) {
    if (float(i) > nb) break;
    float x = float(i) / nb;
    x *= x;
    float a0 = ta + L * prev;
    if (a0 >= tb) break;
    float dt = min(L * (x - prev), tb - a0), t = a0 + 0.5 * dt;
    prev = x;
    vec3 p = o + rd * t;
    vec2 f = stFrame(p);
    float sg = stBody(p, f) + stStreams(p, f);
    if (sg > 1e-5) addSlab(sg, dt, t, stLight(stSunOD(max(p.y, 0.0), f, stTop(f.y)), p.y, 1.0), col, T, zs, ws, odv);
  }
}
// the wall band over [ta, tb]: sphere-trace towards the billows, fine steps through the skin
// (tE as for the body: the step sizes follow the unclipped band, so the march takes the same path
// up to wherever the scene stops it)
void stWallSeg(vec3 o, vec3 rd, float ta, float tb, float tE, float pxK, inout vec3 col, inout float T, inout float zs, inout float ws, inout float odv) {
  if (tb <= ta || T < 0.01) return;
  float t = ta, stepMax = max((tE - ta) / 8.0, 0.4), odHold = 0.0;
  int N = int(uSt3.w), lit = 0;
  float amp = 0.2 * gH * uSt2.w;
  for (int i = 0; i < 64; i++) {
    if (i >= N || t >= tb || T < 0.015) break;
    vec3 p = o + rd * t;
    float y = max(p.y, 0.0);
    vec2 f = stFrame(p);
    // edges: crisp up the face, soft and dusty at the base, never finer than a few FX pixels
    float e = max(0.3, 1.5 * pxK * t) + 0.9 * (1.0 - smoothstep(0.0, 0.35 * gH, y)) + 3.0 * (1.0 - uSt2.y);   // dissipating: billows go soft, not into blobs
    // the noise-free field bounds the billows (|displacement| <= 1.45 amp): far outside them, step
    // on without a lookup (the sky over the wall, the approach to it)
    float fc = stFace(f.y, y), tp = stTop(f.y);
    float D0 = min(fc - f.x, tp - y) - (1.0 - uSt2.y) * 0.15 * gH;
    float sw = 0.0, dt, occ = 1.0, n1 = 0.42, Dc = D0 + 1.45 * amp;
    vec4 nn = vec4(0.42);
    if (Dc > -(0.45 * amp + e + 0.3)) {
      nn = noise3v(stRotor(f, y));   // one fetch: r = the billows, a = 8-cell Worley for the small ones
      n1 = nn.r;
      Dc = stWallFT(fc, tp, f.x, y, n1, 0.5);
    }
    if (Dc > -(0.45 * amp + e)) {
      float n2 = nn.a;
      float D = stWallFT(fc, tp, f.x, y, n1, n2);
      // near the lens the skin thins (inside the storm you see into it), deep inside it is gusty
      sw = stWallSigma(D, e, y) * (0.08 + 0.92 * smoothstep(0.5, 10.0, t)) * mix(1.0, 0.25 + 1.8 * n2 * n2, smoothstep(0.0, 0.2 * gH, D));
      // the sky reaches the billows' surface, not their hearts
      // (the face sees half the sky, the tops all of it)
      occ = max(exp(-0.6 * uSt1.z * max(D - 0.5 * e, 0.0)), 0.08) * mix(0.5, 1.0, smoothstep(0.55 * gH, 0.95 * gH, y));
      dt = clamp(1.1 * e + 0.3 * max(D, 0.0), 0.12, stepMax);
      if (sw > 1e-3 && lit % 3 == 0) {   // every third lit sample (the skin is ~3 steps deep per optical depth)
        // the sun through the wall's own billows (one tap), then through the storm's bulk
        vec3 p1 = p + uSunDir * 1.8;
        vec2 f1 = stFrame(p1);
        float y1 = max(p1.y, 0.0);
        odHold = 3.2 * stWallSigma(stWall(f1, y1, noise3(stRotor(f1, y1)), 0.5), e, y1) + stSunOD(y, f, tp);
      }
      if (sw > 1e-3) lit++;
    } else dt = clamp(-0.85 * Dc, 0.35, stepMax);   // outside: step towards the wall (overshooting a thin wisp is fine)
    dt = min(dt, tb - t);
    // the body's dust in the band reuses the billow noise for its gusts (no extra lookup)
    float sg = sw + (sw < 0.3 ? stStreams(p, f) : 0.0) + uSt1.w * smoothstep(0.1 * gH, -0.45 * gH, f.x) * exp(-y / stScaleH()) * (0.25 + 1.7 * n1 * n1);
    if (sg > 1e-5) {
      float od = sw > 1e-3 ? odHold : stSunOD(y, f, tp);
      addSlab(sg, dt, t + 0.5 * dt, stLight(od, y, occ), col, T, zs, ws, odv);
    }
    t += dt;
  }
}
void main() {
  vec3 o = cameraPosition, rd = normalize(vW - o);
  float cosV = dot(rd, -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
  float tS = sceneViewZ() / cosV;
  gH = uSt0.z * uSt2.z;
  // the domain: the proxy cylinder, between YB and the ceiling, up to the scene
  float t0 = 0.0, tD = 1e4;   // tD: the domain's far end, ignoring the scene
  vec2 oc = o.xz - vCyl.xy;
  float A = dot(rd.xz, rd.xz), B = dot(oc, rd.xz), C = dot(oc, oc) - vCyl.z * vCyl.z;
  if (A > 1e-6) {
    float disc = B * B - A * C;
    if (disc <= 0.0) discard;
    float sq = sqrt(disc);
    t0 = max((-B - sq) / A, 0.0); tD = (-B + sq) / A;
  } else if (C > 0.0) discard;
  float top = min(1.35 * uSt0.z, 1.25 * gH + 1.5);   // just over the live tops (billows reach ~1.2 gH)
  if (rd.y > 1e-4) { tD = min(tD, (top - o.y) / rd.y); t0 = max(t0, (${YB.toFixed(1)} - o.y) / rd.y); }
  else if (rd.y < -1e-4) { t0 = max(t0, (top - o.y) / rd.y); tD = min(tD, (${YB.toFixed(1)} - o.y) / rd.y); }
  float t1 = min(tD, tS);
  vec3 col = vec3(0.0);
  float T = 1.0, zs = 0.0, ws = 0.0, odv = 0.0;
  if (t1 > t0) {
    float mu = dot(uSunDir, rd);
    gSunS = uSunColor * (0.7 * hgPhase(mu, 0.62) + 0.3 * hgPhase(mu, -0.2)) * 4.0 * PI * 0.5;
    gSunM = uSunColor * 0.3;
    gSky = uAmbient * 1.4;
    // the dust's albedo hue, softened (the linear sand colour is far too saturated as a per-bounce tint)
    gTint = sqrt(max(uStSand / max(max(uStSand.r, uStSand.g), max(uStSand.b, 1e-4)), vec3(0.02)));
    gLogTint = log2(gTint);
    float pxK = 6.0 / (projectionMatrix[1][1] * uFxResolution.y);   // ~3 FX pixels per metre of distance
    // the band round the front; behind it, the body
    float s0 = dot(o.xz - uSt0.xy, uSt1.xy), ds = dot(rd.xz, uSt1.xy);
    float sLo = -0.75 * gH - 2.0, sHi = 0.85 * gH + 2.0;
    if (uSt2.y < 0.004) stBodySeg(o, rd, t0, t1, tD, col, T, zs, ws, odv);   // the wall is gone: all body
    else if (abs(ds) < 1e-5) {
      if (s0 < sLo) stBodySeg(o, rd, t0, t1, tD, col, T, zs, ws, odv);
      else if (s0 < sHi) stWallSeg(o, rd, t0, t1, tD, pxK, col, T, zs, ws, odv);
    } else {
      float tLo = (sLo - s0) / ds, tHi = (sHi - s0) / ds;
      if (ds > 0.0) {   // from the body towards the face
        stBodySeg(o, rd, t0, min(t1, tLo), min(tD, tLo), col, T, zs, ws, odv);
        stWallSeg(o, rd, max(t0, tLo), min(t1, tHi), min(tD, tHi), pxK, col, T, zs, ws, odv);
      } else {          // from ahead of the face into it, then the body behind
        stWallSeg(o, rd, max(t0, tHi), min(t1, tLo), min(tD, tLo), pxK, col, T, zs, ws, odv);
        stBodySeg(o, rd, max(t0, tLo), t1, tD, col, T, zs, ws, odv);
      }
    }
    // other spells' lights on the dust, once per pixel
    if (ws > 0.0 && uWorldCounts.x > 0.5) {
      gLightNoShadow = true;
      vec3 pm = o + rd * (zs / ws);
      col += (1.0 - T) * uStSand * spellLightScatter(pm, -rd, 0.4) * 0.6;
    }
  }
  // the shadow: geometry the head hides from the low sun, and everything inside the storm, loses
  // its direct light (a dark layer under the dust; the sky is left alone)
  vec3 ps = o + rd * tS;
  float sh = 0.0;
  if (tS < 250.0 && length(ps.xz - vCyl.xy) < vCyl.z && uSt3.z > 0.0) {
    vec2 f = stFrame(ps);
    float inside = 1.0 - stSunBulk(max(ps.y, 0.0), f);
    float sT = dot(uSunDir.xz, uSt1.xy), wall = 0.0;
    if (sT < -0.02 && f.x > 0.0) {
      float yAt = ps.y + uSunDir.y * (f.x + 0.05 * gH) / -sT;
      wall = 1.0 - smoothstep(0.7, 1.05, yAt / max(stTop(f.y), 0.1));
    }
    sh = uSt3.z * max(inside * smoothstep(0.2 * gH, -0.2 * gH, f.x), wall * uSt2.y);
  }
  float aS = 0.62 * sh;
  T *= 1.0 - aS;
  float alpha = 1.0 - T;
  if (alpha < 0.003) discard;
  float z = ws > 0.0 ? zs / ws : min(tS, 60.0);
  fxOut(col / max(alpha, 1e-4), alpha, vec3(0.0), vec2(0.0), z * cosV);
}`;

// grains: only inside the storm (and in the streams racing ahead of its foot), thickest low down
const GRAIN_GATE = STORM_U + /* glsl */`
float streakGate(vec3 p) {
  gH = uSt0.z * uSt2.z;
  vec2 f = stFrame(p);
  return uSt2.y * smoothstep(0.3 * gH, -0.15 * gH, f.x - stFace(f.y, p.y)) * (0.2 + 0.8 * exp(-max(p.y, 0.0) / 1.4));
}
float streakSun(vec3 p) { gH = uSt0.z * uSt2.z; return stSunBulk(max(p.y, 0.0), stFrame(p)); }
`;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const SCOUR = { x: 0, z: 0, x2: 0, z2: 0, radius: 0.3, width: 0.08, char: 0.15, pattern: 'line', seed: 0 };

export default {
  id: 'sandstorm', name: 'Sandstorm', element: 'wind', order: 20, hue: '#c8a070', shape: 'area', radius: 0.3,
  params: {
    speed: 7, height: 11, density: 1, haze: 1, roll: 1, billow: 1, angle: 0,
    dust: 1, debris: 1, grit: 1, scour: 1, strength: 1, shadow: 1, sand: '#a77a4c',
  },
  ranges: {
    speed: [3, 14, 0.1], height: [3, 14, 0.1], density: [0.2, 3, 0.01], haze: [0, 3, 0.01], roll: [0, 3, 0.01], billow: [0, 2, 0.01],
    angle: [-60, 60, 1], dust: [0, 3, 0.01], debris: [0, 3, 0.01], grit: [0, 3, 0.01], scour: [0, 2, 0.01], strength: [0, 3, 0.01], shadow: [0, 1, 0.01],
  },
  presets: {
    haboob: { sand: '#8f5a32', height: 13, haze: 1.4, speed: 6, billow: 1.3 },
    'ash storm': { sand: '#55514d', haze: 1.6, debris: 0.5, grit: 0.4, roll: 0.7 },
    'white sands': { sand: '#ddd2bf', density: 0.8, haze: 0.7, grit: 1.8, height: 7 },
  },
  timing: { charge: 1.3, impact: 0.3, linger: 5.5 },
  kinds: {
    // the rolling foot of the front: big soft billows thrown forward
    veil: { style: 'media', drag: 1.1, buoyancy: 0.25, curl: 0.8, curlScale: 0.18, forceResponse: 0.7, life: [1.3, 2.3], size: [1.0, 2.6], sizePow: 0.55, color: ['#a77a4c', '#bb9064'], alpha: [0.13, 0], density: 1.5, erosion: 0.6, fadeIn: 0.2, fadeOut: 0.5 },
    // low sand sheets racing ahead of the front
    drift: { style: 'media', drag: 0.5, buoyancy: -0.05, curl: 0.7, curlScale: 0.3, forceResponse: 2.2, life: [0.7, 1.3], size: [0.25, 0.8], sizePow: 0.6, color: ['#a77a4c', '#bb9064'], alpha: [0.14, 0], density: 2.2, erosion: 0.55, fadeIn: 0.15, fadeOut: 0.4 },
  },

  create(fx) {
    const S = this, P = fx.particles;
    const E = {
      gather: P.emitter('wind.streak', { shape: 'shell', radius: 1.6, spread: 0.4, radial: -3.5 }),
      gust: P.emitter('wind.streak', { shape: 'sphere', radius: 0.3, spread: 1.5, radial: 3 }),
      veil: P.emitter('sandstorm.veil', { shape: 'line', radius: 0.8, spread: 0.8 }),
      rise: P.emitter('sandstorm.veil', { shape: 'line', radius: 1.4, spread: 0.6 }),
      drift: P.emitter('sandstorm.drift', { shape: 'line', radius: 0.5, spread: 0.6 }),
      leaf: P.emitter('wind.leaf', { shape: 'line', radius: 1.0, spread: 2.0 }),
      pebble: P.emitter('wind.pebble', { shape: 'line', radius: 0.6, spread: 2.0 }),
      rock: P.emitter('earth.rock', { shape: 'line', radius: 0.4, spread: 1.6 }),
    };

    const sand = new THREE.Color(), sandLin = new THREE.Color(), grain = new THREE.Color();
    const col = { sand: '' };
    function applyColors(p) {
      sandLin.set(p.sand);
      grain.copy(sandLin).multiplyScalar(0.6);   // near grains read as dark streaks against the lit dust
      if (col.sand !== p.sand) {
        col.sand = p.sand;
        // the foot's veils sit in the wall's shadow: darker than the sand
        const lo = `#${sand.set(p.sand).multiplyScalar(0.5).getHexString()}`, hi = `#${sand.set(p.sand).multiplyScalar(0.62).getHexString()}`;
        for (const k of ['sandstorm.veil', 'sandstorm.drift']) P.setKind(k, { color: [lo, hi] });
      }
    }

    // a storm (the march) and a grain field per live cast; the field shares the storm's uniforms
    const storms = [];
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 48, 1, false).translate(0, 0.5, 0);
    for (let i = 0; i < NV; i++) {
      const su = {
        uSt0: { value: new THREE.Vector4() }, uSt1: { value: new THREE.Vector4() }, uSt2: { value: new THREE.Vector4() },
        uSt3: { value: new THREE.Vector4() }, uSt4: { value: new THREE.Vector4(0, 0, 4, 0) }, uStSand: { value: sandLin },
      };
      const m = new THREE.Mesh(cyl, new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: STORM_VERT, fragmentShader: STORM_FRAG, ...FX_BLENDING,
        side: THREE.BackSide, depthTest: false, depthWrite: false, uniforms: { ...fx.U, ...su },
      }));
      m.frustumCulled = false; m.visible = false;
      m.position.set(0, YB, 0); m.scale.set(RD, YT - YB, RD);
      fx.scenes.fx.add(m);
      const grains = createStreakField(fx, { max: 9000, gateGLSL: GRAIN_GATE, uniforms: su });
      storms.push({ busy: false, mesh: m, su, grains });
    }

    const states = Array.from({ length: STATES }, () => ({
      storm: null, light: null, push: null,
      tx: 0, tz: 1, ox: 0, oz: 0, fx: 0, fz: 0, dist: 1, ttr: 1, L: 0, s: 0, v: 0, seedF: 0,
      time: 0, roll: 0, adv: 0, scourAcc: 0, buffetT: 0, hit: new Uint8Array(8),
    }));

    function releaseAll(st) {
      if (st.storm) { st.storm.busy = false; st.storm.mesh.visible = false; st.storm.grains.set(0); st.storm = null; }
      st.light?.release(); st.light = null;
      st.push?.release(); st.push = null;
    }

    // the front's chord across a circle of radius R (from the arena centre): endpoints into a / b
    function chord(st, R, y, ahead, a, b) {
      const fx0 = st.fx + st.tx * ahead, fz0 = st.fz + st.tz * ahead;
      const along = fx0 * st.tx + fz0 * st.tz, lx = st.tz, lz = -st.tx;
      const hw2 = R * R - along * along;
      if (hw2 <= 1) return false;
      const hw = Math.sqrt(hw2), xc = -(fx0 * lx + fz0 * lz);
      a.set(fx0 + lx * (xc - hw), y, fz0 + lz * (xc - hw));
      b.set(fx0 + lx * (xc + hw), y, fz0 + lz * (xc + hw));
      return true;
    }
    const line = (e, st, R, y, ahead) => chord(st, R, y, ahead, e.pos, e.p);

    // per-frame storm uniforms. rise: wall height 0..1, fade: wall presence, hz: body dust, wind m/s
    // settle: the aftermath's dust sinking to the floor 0..1, snakes: its ground streamers
    function frame(st, p, dt, rise, fade, hz, wind, settle = 0, snakes = 0) {
      const sm = st.storm;
      st.time += dt;
      st.roll += dt * 0.06 * p.roll;
      st.adv += dt * wind;
      if (!sm) return;
      const u = sm.su;
      u.uSt0.value.set(st.fx, st.fz, p.height, st.time);
      u.uSt1.value.set(st.tx, st.tz, 1.6 * p.density, 0.085 * p.haze * hz);
      u.uSt2.value.set(st.seedF, fade, rise, p.billow);
      u.uSt3.value.set(st.roll, st.adv, p.shadow, Math.round(Math.min(64, Math.max(10, 0.42 * fx.Q.volumeSteps * fx.Q.auto.steps))));
      // once the wall has gone its march budget goes to the body: more taps, so the settling haze keeps depth
      u.uSt4.value.set(settle, snakes, fade < 0.004 ? Math.round(Math.min(10, Math.max(5, 0.4 * fx.Q.volumeSteps * fx.Q.auto.steps))) : 4, 0);
      sm.mesh.visible = fade > 0.003 || hz > 0.003;
      // grains streak past the camera wherever it is inside the storm
      const g = sm.grains, cam = fx.camera.position, gu = g.u;
      gu.uSF0.value.set(cam.x, 3, cam.z, st.time);
      gu.uSF1.value.set(14, 6, 14, st.adv * 1.2);
      gu.uSF2.value.set(st.tx, 0.04, st.tz, wind * 1.2 / 40 + 0.02);
      gu.uSF3.value.set(0.012, 1, 0.08, 0.35);
      gu.uSF4.value.set(0.55, 1.6, 0.03, 0.3);
      gu.uSFColor.value.copy(grain);
      g.set(sm.mesh.visible ? 2500 * p.grit : 0);
    }

    return {
      onParam(k) { if (k === 'sand') applyColors(S.params); },

      phase(c, name) {
        const p = S.params, st = states[c.index];
        applyColors(p);
        if (name === 'charge') {
          releaseAll(st);
          // travel from beyond the far rim, through the target, towards the caster
          let tx = c.from.x - c.to.x, tz = c.from.z - c.to.z;
          const l = Math.hypot(tx, tz) || 1, an = p.angle * Math.PI / 180;
          tx /= l; tz /= l;
          st.tx = tx * Math.cos(an) - tz * Math.sin(an); st.tz = tx * Math.sin(an) + tz * Math.cos(an);
          let gx = c.to.x, gz = c.to.z;
          const r = Math.hypot(gx, gz);
          if (r > 10) { gx *= 10 / r; gz *= 10 / r; }
          const R = RIM + 2, gt = gx * st.tx + gz * st.tz;
          const D = gt + Math.sqrt(Math.max(gt * gt - gx * gx - gz * gz + R * R, 0));
          st.ox = gx - st.tx * D; st.oz = gz - st.tz * D;
          // it stops well past the target (so a camera there ends up inside), short of the caster
          const E2 = Math.min(8.5, Math.max(1.5, (c.from.x - gx) * st.tx + (c.from.z - gz) * st.tz - 1.5));
          st.dist = D + E2;
          st.ttr = 1.4 * st.dist / p.speed;
          c.durations.linger = st.ttr + FADE - c.durations.impact;
          st.fx = st.ox; st.fz = st.oz; st.L = 0; st.s = 0; st.v = 0; st.time = 0; st.roll = 0; st.adv = 0;
          st.seedF = (c.seed % 997) / 997; st.scourAcc = 0; st.buffetT = 0; st.hit.fill(0);
          st.storm = null;
          for (const sm of storms) if (!sm.busy) { st.storm = sm; sm.busy = true; break; }
          st.push = fx.forces.acquire();
          if (st.push) { st.push.type = 5; st.push.p[0] = 0; st.push.p[1] = 26; st.push.p[2] = 14; st.push.p[3] = 0; }
          fx.rig.shake(0.08, 5);
          frame(st, p, 0, 0.25, 0, 0, 0);
        } else if (name === 'release') {
          fx.rig.shake(0.22, 6);
          E.gust.pos.copy(c.from); E.gust.vel.set(-st.tx, 0.1, -st.tz).multiplyScalar(9); E.gust.burst(120 * p.grit);
        } else if (name === 'done') releaseAll(st);
      },

      update(c, dt) {
        const p = S.params, st = states[c.index];
        let rise, fade, hz, v, wind, settle = 0, snakes = 0;
        if (c.phase === 'charge') {
          // the caster's gust gathers; beyond the far rim the wall lifts off the desert
          const k = Math.min(1, c.t / c.durations.charge);
          E.gather.pos.copy(c.from); E.gather.rate(300 * p.grit * (0.3 + 0.7 * k), dt);
          rise = 0.3 + 0.55 * smooth(0, 1, k); fade = smooth(0, 0.8, k); hz = 0.6 * k; v = 0; wind = 4 * k;
          if (line(E.rise, st, 23, 1.2 + 2 * k, 1.0)) { E.rise.vel.set(st.tx * 2, 2.5, st.tz * 2); E.rise.size = 1.4; E.rise.rate(50 * p.dust * k, dt); }
        } else {
          st.L += dt;
          const L = st.L, u = Math.min(1, L / st.ttr), lag = 1 - u;
          // surges on release and slows to a stop, then thins and clears
          st.s = st.dist * (1 - Math.pow(lag, 1.8));
          v = 1.8 * st.dist / st.ttr * Math.pow(lag, 0.8);
          st.fx = st.ox + st.tx * st.s; st.fz = st.oz + st.tz * st.s;
          const out = L - st.ttr;
          rise = 0.85 + 0.15 * smooth(0, 1, L) + 0.1 * smooth(0, FADE, out);
          fade = 1 - smooth(0, 0.7 * FADE, out);
          hz = (0.6 + 0.4 * smooth(0, 1.2, L)) * (1 - 0.85 * smooth(0, FADE, out));
          settle = smooth(-0.3, 0.85 * FADE, out);
          snakes = 0.8 * smooth(0, 0.6, out) * (1 - smooth(0.55 * FADE, FADE, out));
          wind = Math.max(v * 1.1, (1.6 * p.speed * p.strength) * (1 - smooth(0, FADE, out)) * (0.75 + 0.25 * Math.sin(L * 1.7) * Math.sin(L * 0.63 + 1)));
          const em = fade * fade;
          if (em > 0.01) {
            if (line(E.veil, st, RIM, 0.5, 0.6)) { E.veil.vel.set(st.tx * v * 1.1, 0.7, st.tz * v * 1.1); E.veil.size = 1.1; E.veil.rate(45 * p.dust * em, dt); }
            if (line(E.drift, st, RIM, 0.15, 2.5)) { E.drift.vel.set(st.tx * (v * 1.5 + 2), 0.2, st.tz * (v * 1.5 + 2)); E.drift.rate(110 * p.dust * em, dt); }
            if (line(E.leaf, st, RIM, 1.5, -0.5)) { E.leaf.vel.set(st.tx * wind * 1.1, 2, st.tz * wind * 1.1); E.leaf.rate(22 * p.debris * em, dt); }
            if (line(E.pebble, st, RIM, 0.8, 0)) { E.pebble.vel.set(st.tx * v * 1.5, 3, st.tz * v * 1.5); E.pebble.rate(20 * p.debris * em, dt); }
            if (v > 1 && line(E.rock, st, RIM, 0.6, 0.3)) { E.rock.vel.set(st.tx * v * 1.3, 4, st.tz * v * 1.3); E.rock.rate(6 * p.debris, dt); }
          }
          // scoured floor: streaks along the travel direction at the foot
          if (p.scour > 0 && v > 0.8) {
            st.scourAcc += 40 * dt;
            for (let n = 0; st.scourAcc >= 1 && n < 3; n++) {
              st.scourAcc -= 1;
              if (!chord(st, RIM - 0.5, 0, -0.3, _a, _b)) break;
              const f = fx.rand(), len = 1.2 + 2.2 * fx.rand();
              SCOUR.x = _a.x + (_b.x - _a.x) * f; SCOUR.z = _a.z + (_b.z - _a.z) * f;
              SCOUR.x2 = SCOUR.x - st.tx * len; SCOUR.z2 = SCOUR.z - st.tz * len;
              SCOUR.width = 0.1 + 0.18 * fx.rand(); SCOUR.char = (0.4 + 0.4 * fx.rand()) * p.scour; SCOUR.seed = (c.seed + n * 13 + (st.L * 60 | 0)) % 97;
              fx.ground.splat(SCOUR);
            }
          }
          // dummies: shoved as the front hits, buffeted inside it
          st.buffetT -= dt;
          const buffet = st.buffetT <= 0;
          if (buffet) st.buffetT = 0.3;
          for (let i = 0; i < fx.dummies.length && i < 8; i++) {
            const dm = fx.dummies[i], z = (dm.pos.x - st.fx) * st.tx + (dm.pos.z - st.fz) * st.tz;
            if (!st.hit[i] && z < 0.8 && fade > 0.5) {
              st.hit[i] = 1;
              dm.hit(_d.set(st.tx, 0.15, st.tz), (0.5 + 0.08 * v) * p.strength);
              fx.rig.shake(0.06, 9);
            } else if (st.hit[i] && buffet && z < 0 && fade > 0.2) dm.hit(_d.set(st.tx + 0.6 * (fx.rand() - 0.5), 0, st.tz + 0.6 * (fx.rand() - 0.5)), 0.15 * p.strength * fade);
          }
          // the pool ripples under the front
          const pool = fx.ARENA.pool;
          if (fx.pool && fade > 0.2 && chord(st, RIM, 0, 0, _a, _b)) {
            for (let n = 0; n < 4; n++) {
              const f = fx.rand(), x = _a.x + (_b.x - _a.x) * f, z = _a.z + (_b.z - _a.z) * f;
              if (Math.abs(x - pool.center.x) < pool.half.x && Math.abs(z - pool.center.y) < pool.half.y) fx.pool.ripple(x, z, 0.025 * fade, 0.6);
            }
          }
        }
        // the push carries every loose particle with the front
        if (st.push) {
          st.push.pos.set(st.fx - st.tx * 12.5, 1, st.fz - st.tz * 12.5);
          st.push.dir.set(st.tx, 0, st.tz);
          st.push.p[0] = v * 1.3 + 3; st.push.p[3] = 1.4 * p.strength * fade;
        }
        frame(st, p, dt, rise, fade, hz, wind, settle, snakes);
      },
    };
  },
};
