# Ultra Elements: final plan

A browser lab for elemental spell VFX in three.js, built as the sibling of [Ultra Water](https://github.com/Humpalumps/Ultra-Water) (UW). UW's conventions are the house style throughout.

## How this plan was made

Two plans were written independently from the same brief, after reading UW in full:

- **Plan A**, a short plan from the main session.
- **Plan B**, a detailed plan from a separate Opus 5.5 planner.

This file is B's structure and detail, with A's additions merged in and the disagreements settled as shown below.

### Where both plans agreed (high confidence)

- **Stack.** UW's: WebGL2, raw GLSL ES 3.00, three 0.186, lil-gui, Vite, MIT. No WebGPU in v1.
- **Copied from UW:** `engine/` (PostFX, gpuTimer, fullscreen, PlanarReflection), the top-left perf panel, the fence benchmark, the uncapped loop and auto resolution.
- **One shared GPU particle pool**, simulated as a ping-pong MRT.
- **A floor state field** that spells paint (heat, wet, frost, cracks), so combos emerge instead of being scripted. Both plans arrived at this on their own, which makes it the strongest signal in the comparison.
- **One shared force list** (wind, vortex, attractor) that acts on every spell's particles. A void eats a fireball's embers with no special case.
- **A fixed uniform light pool**, so three's per-light-count recompiles never happen.
- **Translucent FX at half resolution** with depth-aware upsampling. Overdraw is the main cost.
- **Raymarched volumes only for hero shapes.** Blackbody LUT, curl noise, baked 3D noise, and no binary assets at all.
- **Game feel:** trauma shake, hitstop, slow motion and frame stepping.
- **Process:** Lightning and Fire first. Deterministic seeded frames, a per-spell benchmark, and debug views such as overdraw.

### Where they differed, and what the final plan uses

| Topic | Plan A | Plan B | Final |
|---|---|---|---|
| Translucency | One premultiplied draw; additive particles write alpha 0; unsorted | Weighted-blended OIT in a 3-target MRT (media / weight + distortion / emission), one blend state | **B.** Smoke composites in the right order with no sorting. A's alpha-0 trick lives on inside it as the emission output. |
| Particle parameters | Per-spell uniforms | A kind-table texture on the GPU; sliders write texels | **B.** Nothing recompiles, and it works like Niagara parameters. |
| Sub-emitters | Not covered | Kind morphing on collision, plus field emitters driven by the floor field | **B** |
| Shadows from spell lights | None | Analytic capsule shadows against the occluder list (as in UE4) | **B.** Cheap and a big visual win. |
| Lightning and beams | Point-light flash | Line lights (representative point) plus a sky flash | **B** |
| Extra elements | Light, Poison | Light, Acid, Arcane | **B.** Acid covers Poison, and each extra element brings techniques none of the core seven use. |
| Arena | Dark stone floor with planar reflection | The same, plus a reflecting pool and dusk / night / noon | **B.** The pool feeds the water, ice and lightning combos, and noon keeps the effects honest. |
| Spell API | Class-style interface | Plain module objects with one shared phase clock | **B.** Less code. |
| Benchmark | A "storm" with every spell at once | Per-spell mean and peak | **Both.** Per-spell rows plus one storm row for the worst case (§7). |
| Accessibility | Not covered | A reduce-flashes-and-shake mode (WCAG 2.3.1) | **B.** Mandatory, because lightning is a real photosensitivity risk. |
| Auto exposure | Slower adaptation | Meter the HDR before the FX pass | **B** |
| How it gets built | Not covered | Not covered | **New:** serial foundation, then one agent per element in parallel (§7.1) |

### Added during the merge (in neither plan alone)

- The storm benchmark row and the parallel build approach (§7, §7.1).
- A documented WBOIT ordering limit: full-res sparks in front of half-res smoke (§9).
- Procedural WebAudio is the first v1.1 item. Sound is half of what makes a spell feel like Unreal, but v1 is a visual lab.

---

## 0. TL;DR (the decisions that matter)

1. **The stack is UW's: WebGL2, raw GLSL ES 3.00, three ^0.186, lil-gui ^0.21, Vite ^8.** No WebGPU or TSL. `engine/` (PostFX, gpuTimer, fullscreen, PlanarReflection) and UW's sky/atmosphere are copied over almost verbatim. The benchmark, the fence and the uncapped loop are carried over unchanged.
2. **All spells share one GPU particle pool.** It is a fragment-shader ping-pong sim of 3 render targets (MRT). Per-kind behaviour lives in a GPU "kind table" texture, which is Niagara-style parameters rather than code. Sliders edit texels, so **nothing recompiles at runtime**.
3. **All soft translucency goes through one half-res FX pass with one blend state.** The 3-target MRT holds: weighted-blended OIT media, a weight plus screen-space distortion, and additive emission. **Nothing is ever sorted.** The only full-res effects are thin emissive lines and refractive solids.
4. **The arena is a shared world.** It has an analytic occluder list (floor, rim, pillars, dummies, and dynamic spikes, walls and shields as capsules, spheres and boxes) with a JS mirror, the same way UW's `islandHeight.js` mirrors its terrain. Particles collide with it, bolts snap to it, spell lights cast **capsule shadows** from it (as in UE4), and clicks raycast against it.
5. **A "ground field" reaction sim (1024² RGBA16F × 2) makes the elements interact.** It tracks heat, char, wet, frost, crack, acid, corruption and glow. Splats and colliding particles paint into it. It diffuses, decays and converts (frost↔wet↔steam, heat→char, cracks spreading along a vein network), and it emits steam, embers and mist itself. Most combos fall out of it without any rule code.
6. **One shared force field acts on every particle** (wind, vortex, attractor, shockwave). A void sucks in a fireball's embers with no special case.
7. **Spell lights are a custom uniform light list** (point, line and cookie lights, 16 on desktop and 8 on mobile) patched into MeshStandardMaterial. Three's per-light-count recompiles are never triggered. Lightning and beams are **line lights** using the representative-point method, which draws long streaks on the polished floor.
8. **Spells are plain modules** (`params`, `ranges`, `kinds`, `timing`, `create(fx) → { phase, update }`) driven by one shared cast clock: charge → release → travel/sustain → impact → linger → done. There are no classes and no base type.
9. **Ten elements:** the seven required ones plus Light (holy), Acid and Arcane. Each extra was picked because it brings techniques none of the seven use (shadowed light shaft and SDF sigils; dissolve, ground fog and thin-film bubbles; homing ribbons and an intersecting shield).
10. **Everything is deterministic.** `?shot=fire&t=0.8&seed=3` freezes an exact frame, and `?bench=fire` replays a spell back-to-back with fence timing and per-pass GPU ms (mean and peak). Those numbers go into README tables, the same way UW's do.

---

## 1. What carries over from Ultra Water

| UW convention | Ultra Elements |
|---|---|
| `src/engine`, `src/scene`, `src/<domain>` layout | `src/engine`, `src/scene`, `src/vfx` (shared systems), `src/spells` |
| GLSL as `/* glsl */` template strings, shared `*_GLSL` chunks concatenated (e.g. `WATER_GLSL`) | Same: `ARENA_GLSL`, `LIGHTS_GLSL`, `FORCES_GLSL`, `NOISE_GLSL`, `GROUND_GLSL`, `VOLUME_GLSL`. No .glsl files and no Vite plugins. |
| RawShaderMaterial for fullscreen passes, ShaderMaterial (GLSL3) for scene effects, MeshStandardMaterial + `onBeforeCompile` for lit opaque surfaces | Same split |
| Perf panel at top left (GPU name, spec line, big FPS, VSYNC/UNCAPPED, ms, 20 s graph, Uncap, Run benchmark, per-pass HUD) | Identical markup and CSS, plus 2 HUD lines and a phase strip |
| `GpuTimer` labels per pass, fence-based benchmark, MessageChannel uncapped spin with ≤3 frames in flight | Verbatim. `drain()` gains a per-label max for "peak". |
| `?mobile` / `?desktop`, `(pointer: coarse)` profile, auto resolution from the missed-vsync ratio | Same, extended into a longer auto ladder (section 4) |
| Atlas trick: 4 FFT cascades in one atlas, one MRT draw per stage | Reused for the 3D fluid (64³ as a 512² atlas) in phase 5 |
| Stateless, analytic GPU effects (Spray, splash crown), CPU mirror of GPU data (`islandHeight`), async PBO readback (`WaterQuery`) | Bolts, crowns, sigils and rings are analytic. `arena.js` holds the JS SDF mirror. The `?selftest` probe uses async readback. |
| Procedural assets baked at startup (`bakeTextures.js`): **zero binary assets** | Same: 3D noise, curl, blackbody LUT, lens dirt. The repo stays tiny and loads instantly. |
| README style: terse, measured tables, file paths per feature, a "Not in yet" section, THIRD_PARTY_NOTICES for adapted code | Same |

Also noticed: UW's `package.json` name and `<title>`/GUI title still say "Gelatin". Name this repo consistently as `ultra-elements` / "Ultra Elements" from day one.

---

## 2. Architecture

### 2.1 Stack: WebGL2, not WebGPU/TSL

- **Reach.** WebGL2 runs everywhere. WebGPU is in all major browsers, but its coverage on Android, Linux and older Macs is still uneven (web.dev, Nov 2025). Re-check this before v2.
- **Per-pass GPU timing.** It already works through `EXT_disjoint_timer_query_webgl2` (UW's HUD). WebGPU `timestamp-query` is optional and quantized.
- **Nothing here needs compute.** The sim is bandwidth-trivial: 256k particles × 3 RGBA32F read and write is about 25 MB per frame, roughly 0.05 ms on a 3060. Sorting is designed out with WBOIT plus additive blending, and atomics are designed out with ring allocation and CPU live-count estimates.
- **Hitch control.** Raw GLSL with `compileAsync` (KHR_parallel_shader_compile) and warm draws is a known path. The node/TSL pipeline adds compile-time uncertainty at the worst moment: the first cast.
- **Sibling diffability.** `engine/` stays line-for-line comparable with UW, so fixes can be ported both ways.
- **What is given up:** indirect draws of live particles only, GPU sorting and storage buffers. Each has a mitigation below (ring-window draws, WBOIT, kind-table textures).
- **The WebGPU door stays open.** All GLSL sits in chunk strings, so a port would be a separate project later. It is not on the roadmap.

### 2.2 Folder layout

```
ultra-elements/
  index.html                 perf panel (UW markup) + spell bar + loading line
  package.json               "ultra-elements"; three ^0.186, lil-gui ^0.21; vite ^8 (dev)
  vite.config.js             base: './' (GitHub Pages project site)
  README.md  LICENSE (MIT, © 2026 Humpalumps)  THIRD_PARTY_NOTICES.md  CONTRIBUTING.md
  .claude/launch.json        "elements" on port 5200 (UW uses 5199)
  .github/workflows/pages.yml
  src/
    main.js                  renderer, targets, frame pipeline, GUI, HUD, loop (UW shape)
    engine/
      PostFX.js              UW copy + meterSource arg, tonemap option, lateral CA, flash
      gpuTimer.js            verbatim (+ max in drain)
      fullscreen.js          verbatim
      PlanarReflection.js    verbatim
      quality.js             tier table, mobile detect, auto ladder
      urlState.js            hash <-> params (non-defaults only)
      capture.js             screenshot (toBlob) + MediaRecorder WebM
      warmup.js              compileAsync + warm draws + progress
    scene/
      sky.js atmosphere.js   copied from UW (credited); dusk/night/noon
      arena.js               occluder list -> meshes, ARENA_GLSL, arenaSDF()/raycast() JS mirror
      arenaMaterial.js       MeshStandardMaterial patch: tiles, ground field, impacts, spell lights, capsule shadows
      dummies.js             3 targets + status overlays
      pool.js                reflecting pool: 256² ripple sim + surface shader
    vfx/
      Particles.js           pool, emit queue, kind table, sim, 4 render styles
      Ribbons.js             instanced strip renderer; path() supplied per material (history or analytic)
      Bolts.js               analytic fractal bolt path for Ribbons
      Volumes.js             raymarched proxies + VOLUME_GLSL
      FxTarget.js            half-res MRT + depth prepass + FxComposite + LensPass
      GroundField.js         reaction sim + splats + particle paint
      SpellLights.js         light pool + LIGHTS_GLSL (point/line/cookie, capsule shadows)
      Forces.js              force primitives + FORCES_GLSL
      Refraction.js          refractive pass (ice, water/acid metaballs) on the resolved HDR
      noise.js               bake noise3D/curl3D, blackbody LUT (CIE fit), NOISE_GLSL
      camera.js              trauma shake, FOV punch, hitstop
    spells/
      index.js               SPELLS array (static imports)
      cast.js                cast pool, phase clock, projectile flight, impact detection
      combos.js              small rule table for flourishes (most combos are emergent)
      _template.js
      lightning.js fire.js water.js ice.js earth.js wind.js void.js light.js acid.js arcane.js
  scripts/capture.mjs        optional: Playwright (headed, GPU) shot matrix for README/regressions
  docs/                      shots, GIF/MP4
```

### 2.3 Frame pipeline (README "Pipeline" list)

1. **CPU:** advance casts (`cast.js`), fill the emit queue, then pack lights, forces, occluders and impacts into preallocated Float32Arrays. Zero allocations.
2. **Sims:**
   - `sim.particles`: 1 MRT draw.
   - `sim.ground`: 1 MRT draw, plus 1 instanced splat draw, plus 1 point draw for particle paint.
   - `sim.pool`: 1 draw.
   - Ultra tier only: the fluid.
3. `shadow`: debris sun shadow. It is an ortho camera fitted to live debris, using UW's `floaterShadow` pattern, and is skipped when there is no debris. The static sun shadow map re-renders only when the sun moves (UW does the same).
4. `reflect`: half-res planar reflection of the floor and pool (UW `PlanarReflection`). On High and above it includes the emissive spark, bolt and mote layers.
5. `opaque`: into a single 4× MSAA HDR target with a depthTexture (UW). This covers the arena, dummies, debris (instanced from particle state), earth and ice spikes and event horizons. Full-res additive emissive lines go in the same target afterwards (bolt cores, spark streaks, motes, sigils, shield lines; depth test on, no depth write).
6. `refract`: ice shards, ice shells, water and acid metaballs and the pool surface. They sample the resolved colour and depth, depth-tested against the kept MSAA depth. This is UW's water-pass pattern, including the `resolveDepthBuffer` trick.
7. `fx` (half-res MRT):
   - A depth-only prepass writes the farthest depth of each 2×2 block from the full-res depth.
   - Then volumes, soft media, glows and distortion sprites are drawn.
8. `fxComp` (full res): nearest-depth upsample, distortion plus distortion-driven chromatic aberration, WBOIT resolve, emission add, inversion mask.
9. `lens`: full screen, only while a void is alive.
10. `post`: UW PostFX. Auto exposure is metered on the **pre-FX** HDR from step 6, so a spell's own emissive glow doesn't pump it. Then dual-filter bloom with Karis average, AgX (or Neutral), vignette, lens droplets and TPDF dither.

**Draw calls:** about 25 idle and ≤ 70 at peak. Adding spells doesn't add draws, because they share the particle styles, the ribbon draw and the FX pass. **Passes on mobile:** 10–12, which matters given UW's finding that Chrome's GPU-process cost per pass dominates on phones.

### 2.4 Spell interface and lifecycle

```js
// src/spells/fire.js
export default {
  id: 'fire', name: 'Fire', key: '2', hue: '#ff7a1a',
  shape: 'projectile',                       // projectile | strike | area | beam | self
  params: { form: 'Fireball', size: 1, speed: 18, temperature: 1900, embers: 1, smoke: 1, haze: 1, scorch: 1 },
  ranges: { size: [0.3, 3, 0.01], speed: [4, 40, 0.1], temperature: [900, 4000, 10] },
  presets: { 'blue flame': { temperature: 3800 }, soulfire: { tint: '#3cff9a' } },
  kinds: { flame: { style: 'media', drag: 1.2, buoyancy: 3, curl: 1.5, life: [0.35, 0.6], tempRamp: [2200, 900], toSmokeAt: 0.6 },
           ember: { style: 'spark', buoyancy: 0.6, curl: 2, life: [1.5, 3], collide: 0.4, paints: 'heat' } },
  timing: { charge: 0.7, impact: 0.2, linger: 5 },
  create(fx) {                               // once at load: allocate everything here
    const ball = fx.volumes.add(FIREBALL_GLSL);
    return {
      phase(c, name) { /* entry bursts: emit, splat, light flash, shake */ },
      update(c, dt)  { /* sustained emission, uniforms */ },
    };
  },
};
```

- **Cast record.** `cast.js` holds a pool of 16 records: `{ spell, phase, t, from, to, pos, vel, seed, light, alive }`.
- **Phase clock.** `charge` → `release` (instant) → `travel`, which depends on the shape:
  - `projectile`: integrate until `arenaSDF(pos) < r` or the target is reached.
  - `beam`: sustain while the cast key is held.
  - `strike` and `area`: skip travel.
  
  Then `impact` → `linger` → `done`. The user's names map onto these: cast = charge + release, sustain = travel or beam, impact = impact, dissipate = linger.
- **Registration.** `spells/index.js` exports an array. At load, every `create()` runs, kinds are appended to the kind table, and the sim shader is assembled and warmed.
- **Swapping.** Switching the active element only rebuilds the lil-gui folder and highlights the hotbar. Casts that are already live finish, so several elements coexist (which combos need).
- **Determinism.** Each cast takes `seed` from a seeded LCG (as in UW `sampleEmitters`). Fixed `dt` in bench and shot modes makes runs repeatable.

### 2.5 Shared GPU systems

**Particles (`vfx/Particles.js`)**

- **State.** Three RGBA32F textures, ping-ponged and written as one MRT draw:
  - T0 = (pos.xyz, age)
  - T1 = (vel.xyz, lifeMax)
  - T2 = (kind, seed, custom0, custom1)
  
  EXT_color_buffer_float is required; UW's `OceanSim` already requires it. fp16 positions stall at arena scale, because v·dt falls below fp16 precision.
- **Pool sizes:** Low 256×128 (32k), Medium 512×256 (128k), High 512×512 (262k), Ultra 1024² (1M).
- **Sub-pools by render style.** Each style owns a range of rows, so each draw is homogeneous:
  - `spark`: about 37%. Full-res additive, velocity-stretched quads with Humus phone-wire AA (width clamped to ≥1.5 px, alpha scaled by trueWidth/clampedWidth).
  - `mote`: about 25%. Full-res tiny additive quads.
  - `media`: about 25%. Half-res WBOIT spherical billboards.
  - `debris`: 4k on High and 512 on Low. Instanced rock, ice or leaf meshes in the opaque pass that cast shadows.
- **Emission.** Each style's sub-pool is a ring buffer with a CPU cursor. `fx.emit(kind, count, shape, params)` appends a record to a per-frame uniform array, at most 32 records × 4 vec4 = 128 vec4 (well under WebGL2's 224 minimum). Each record is (start, count, kind, shape), (pos, radius), (vel, spread), (axis, speed, seed, inherit). A texel whose index falls in a record's range respawns from it. A cheap first test checks whether the index is in this frame's total range. When the pool is full, the oldest particles die early, which degrades gracefully. Continuous rates go through a CPU fractional accumulator.
- **Kind table.** A 64 × 8 RGBA32F DataTexture holds, per kind:
  - drag, gravity, buoyancy, curl strength and scale
  - force response, restitution, friction
  - life min/max, size start/end, stretch
  - alpha curve (3 keys)
  - colour (4-key gradient) or a blackbody temperature ramp, emissive scale
  - flags: absorbing, paints-channel, morph-to-kind on collide or death
  
  Sliders write texels and upload about 2 KB. **No recompiles.**
- **Integration.** One generic integrator. Optional per-kind GLSL hooks (orbit, homing) are switch cases compiled in at load.
- **Collision.** Against the floor, rim and occluder capsules (`ARENA_GLSL`): reflect, then restitution and friction, then sleep below 0.2 m/s.
- **"Kind morphing" replaces GPU sub-emitters** without any readback: on collision, a droplet turns into a splash and an ember into a smoulder.
- **Field emitters.** Some kinds (steam, ground flame, frost mist, smoulder) respawn dead texels at random floor positions weighted by ground-field values (heat×wet and so on). This is GPU-driven emission with no CPU involvement.
- **Live count in the HUD** is a CPU estimate from an emission log of 256 entries (count, time, maxLife), labelled "≤".

**Ribbons and bolts (`Ribbons.js`, `Bolts.js`)**

- One instanced strip renderer: instances = ribbons, segments up to 64. It expands camera-facing in the VS, with width, colour and UV callbacks.
- The `path(id, t)` function comes from the material:
  - **History ribbons** (projectile, missile and tendril trails) read a 64 × 64 RGBA32F texture of head positions, written with one tiny `texSubImage` per frame.
  - **Analytic ribbons** (bolts, tornado funnel, sigil arcs) evaluate a function. They have no state and no CPU cost.
- **Bolt path.** This is statistically equivalent to midpoint displacement, evaluated per vertex (after Reed & Wyvill 1994): `P(t) = mix(A,B,t) + (U·n1(t) + V·n2(t))·L·Σₖ 0.5ᵏ·noise(t·2ᵏ·f + seedₖ)·√sin(πt)`.
  - A branch starts at `P_parent(t_b)`, deviates from the tangent by 25–50°, and has length 0.15–0.4·L.
  - The leader grows by clipping at `t < reveal(age)`.
  - Restrikes keep the main seed and reseed the branches, which is what real return strokes do.

**FX target (`FxTarget.js`): one blend state for all translucency**

- **Format.** Half-res MRT, 3 × RGBA16F (half-float blending is core in WebGL2 once the target is renderable), plus a DepthTexture.
- **Blend.** `blendFuncSeparate(ONE, ONE, ZERO, ONE_MINUS_SRC_ALPHA)` for all three attachments. Clear colour (0,0,0,1).

  ```glsl
  out0 = vec4(w * c * a, a);      // media: Σwca, alpha -> Π(1-a) revealage   (McGuire & Bavoil 2013)
  out1 = vec4(w * a, dUV, a);     // Σwa, screen-space distortion (signed, additive)
  out2 = vec4(emission, 0.0);     // additive emission, unweighted
  ```

- **Weight.** Tuned to the arena's depth range (1–80 m) and kept within 1e-2..1e2 so fp16 doesn't overflow.
- **Emissive-only shaders** write a = 0 to media. **Fire-to-smoke particles** write both outputs in one draw.
- **Depth prepass.** Fullscreen and depth-only: `gl_FragDepth` = the farthest of the 2×2 full-res depths. FX draws depth-test against it.
- **Soft fade** uses `texelFetch` on full-res depth at 2× coordinates. This is a different texture, so there's no feedback loop.
- **`fxComp` upsample** is nearest-depth upsampling over 4 half-res taps. If the full-res pixel is nearer than all 4 by more than ε, FX is suppressed there (the occlusion-reject case, e.g. a pillar edge).
- **Resolve:** `c = scene(uv+d)·rev + (Σwca/max(Σwa,1e-4))·(1-rev) + emission·mix(1, rev, uSmokeOccludesGlow)`.
- **Distortion-driven chromatic aberration** samples R/G/B at offsets scaled by |d|, and only branches in where |d| > ε.

**Volumes (`Volumes.js`)**

- Back-faced proxy mesh (sphere, capsule or box), so the camera can be inside. The march runs from entry to min(exit, scene depth).
- Integration is energy-conserving per slab (Hillaire 2015): `L += T·E·(1-exp(-σΔ))/σ; T *= exp(-σΔ)`.
- Jitter: interleaved gradient noise (IGN) rotated by the golden ratio each frame (UW's shaft jitter), amplitude 0.5 step.
- Step count is LOD'd by projected radius: `clamp(radiusPx/8, 8, tierMax)`, with tierMax 12/16/24/32. Early out at T < 0.01.
- Each volume material is `VOLUME_GLSL` plus its own `density()` / `emission()` / `albedo()`, concatenated like UW's chunks.
- **Only hero shapes are raymarched.** Everything else soft uses **spherical billboards** (Umenhoffer et al. 2006): sprites treated as spheres, with visible thickness clipped by scene depth and alpha = 1 − exp(−σ·thickness). They are eroded by world-space 3D noise, so they look volumetric at sprite cost.

**Ground field (`GroundField.js`)**

- **Textures.** A floor-aligned 40 m × 40 m ping-pong pair:
  - A = (heat, char, wet, frost)
  - B = (crack, acid, corruption, glow)
  
  1024² RGBA16F on Medium and High (3.9 cm per texel), 512² on Low, 2048² on Ultra.
- **One sim draw per frame (about 0.03 ms):**
  - Heat diffuses (5-tap) with τ = 2.5 s, and adds char.
  - Char decays with τ = 25 s.
  - Heat evaporates wet, and heat × wet drives steam field emitters.
  - Heat melts frost into wet.
  - **Frost, cracks and corruption spread as fronts with "potential" stored above 1.0:** `f' = max(f·melt, maxNeighbour(f) − 0.03)`, gated by `noise(p) > threshold`. Growth stops when the potential runs out, so the initial potential sets the radius. Gating crack and corruption growth by a voronoi-edge mask makes them propagate along a vein network. The result is fractal frost fingers and propagating cracks for one texture pass.
- **Splats.** Up to 16 per frame, as instanced quads in an ortho top-down view: radial falloff × noise, a procedural Lichtenberg pattern (polar ridged, domain-warped) for lightning, and rings for the nova.
- **Particle paint.** Kinds flagged `paints` that collided this frame are drawn as points into the field. Embers char, drips corrode, droplets wet. This is GPU→GPU with no readback.
- **Consumers:** the floor, the pool (frost there turns into an ice sheet), and the field emitters.

**Spell lights and capsule shadows (`SpellLights.js`)**

- **Light list.** `uLights[16]` uses 2 vec4 per light: (pos, radius) and (colour × intensity, type). Types are point, line (segment end in a third vec4) and cookie (caustic or sigil projection). The count is a uniform loop bound with a `break`.
- **Lighting.** Patched into MeshStandardMaterial's `lights_fragment_end`, using three's own `BRDF_GGX` and Karis 2013's windowed inverse-square falloff. Line lights use the representative point: the closest point to the reflection ray for specular and to the shading point for diffuse.
- **Particles** light media in the VS (half-Lambert plus a Henyey-Greenstein phase, which is UW `Spray`'s lighting) from the same list. **Volumes** light their smoke from the same list.
- **Capsule shadows** (UE4's technique). For the K brightest lights (High 4, Medium 1, Low 0), shadowing is analytic: a ray–capsule closest approach against the occluder list (8 pillars, 3 dummies, ≤12 dynamic), with penumbra from distance over distance-to-light. There is no shadow map per light and no SDF march. Budget ≤ 0.3 ms.
- **Sky flash.** Lightning briefly scales `scene.environmentIntensity` and the background.

**Forces (`Forces.js`)**

- `uForces[8]`: wind (directional), Rankine vortex, point attractor or repulsor (softened 1/r²), Kepler orbit, and an expanding shock shell impulse.
- Every particle applies all of them, scaled by its kind's `forceResponse`. Fire volumes read wind and vortex for domain warp.
- The vortex is defined as:
  - `v_θ = Γ/(2π)·r/R²` for r < R, else `Γ/(2πr)`
  - plus ground inflow and an updraft `W·exp(−r²/R²)`

**Impacts list.** `uImpacts[16]` = (pos, radius) and (type, age, amount). These are spherical "volume decals" evaluated by the arena, dummy and debris materials, so pillars scorch, spikes glow with magma, and the rim frosts, with no decal geometry. The ground field adds persistent detail on the floor.

**Noise (`noise.js`)**, all baked at load with no assets:

- `noise3D`: 128³ RGBA8 (Perlin-Worley as in Schneider 2015, plus 3 Worley octaves; tileable). 64³ on Low.
- `curl3D`: 64³ RGBA8, one tap per particle. Curl noise after Bridson et al. 2007.
- Blackbody LUT: 256 × 1 RGBA16F covering 500–20000 K. Planck is integrated against the Wyman–Sloan–Shirley 2013 analytic CIE fit, converted XYZ → linear sRGB, normalised by Y. Intensity is a separate artist curve ∝ (T/T₀)^k. It is used by fire, embers, ground heat, magma, the accretion disk and lightning cores.

---

## 3. Per-element breakdown

Counts are for the High tier. Each "FX" figure is the target added cost of that spell at its peak frame on the reference setup (RTX 3060, 3.3 MP, the same as UW's benchmark).

### Lightning: *Thunderstrike* (sky strike at target). Alt form: *Chain Arc* (channelled beam that chains between dummies)

- **Charge (0.6 s):**
  - 4 micro-arcs over the focus orb, reseeded every 50 ms.
  - 2k ionisation motes falling in on an attractor.
  - The focus light flickers with 1/f noise.
  - A strike ring marks the target.
  - A cloud cap of 300 large media sprites turns overhead, lit from inside by the arcs.
- **Leader (0.1 s):** a stepped leader grows over about 4 frames. The branches reveal with it.
- **Return stroke (impact):**
  - Main bolt of 128 segments, plus 8 branches × 32, plus 12 sub-branches × 12, so about 530 segments.
  - The core is near-white (blackbody 20000 K or more, HDR 40–80) at full res. The glow is a ×12-width Gaussian strip in half-res emission, tinted by the preset (storm blue, crimson, violet).
  - 2–3 restrikes at 30–60 ms intervals.
  - A line light along the main channel draws streaks on the floor. Sky and ambient flash.
  - 3k spark streaks that bounce off the arena (restitution 0.4).
  - The ground gets a Lichtenberg splat of heat and char (r 2.5 m).
  - Distortion shock ring.
  - **The shake is delayed by distance ÷ 343 m/s, so thunder arrives after the flash.**
- **Ground crawl:** 6 short arcs whose path points are snapped to surfaces (`p -= n·sdf(p)`). On wet field texels they spread across the whole wet region (the conduction combo), and a dummy they reach gets the *shock* status.
- **Aftermath (1.5 s):** residual micro-arcs at decaying frequency, ozone motes, 300 smoke wisps, scorch cooling from heat to char.
- **FX budget:** ≈ 0.5 ms for the FX pass and 0.1 ms for the full-res bolts.

### Fire: *Fireball*. Alt form: *Inferno* (ground pillar; a 3D fluid on Ultra in phase 5)

- **Charge (0.7 s):**
  - A raymarched seed grows from 0 to 0.35 m.
  - 1.5k sparks spiral in (vortex plus attractor).
  - Heat-haze distortion sprites.
  - The light ramps up with flicker, coloured by the blackbody of the mean temperature.
- **Release:** a 0.08 s muzzle fan and a small recoil shake.
- **Travel (18 m/s):**
  - The fireball is a raymarched volume. Its density is stretched into a teardrop against velocity (`p += v̂·max(0,−p·v̂)·k`), and the noise is advected backwards in the ball's local space so the flames rush past.
  - **Fire-to-smoke particles:** flame particles at 600/s with life 0.5 s grow 0.2 → 0.7 m and cool 2200 → 900 K. At 60% of their life the emission fades out and absorption fades in (dark smoke). This is the cheap staple behind the fire in Niagara and Diablo IV.
  - Embers at 200/s with life 2.5 s, buoyant, on curl noise.
  - A 16-point core ribbon so the trail doesn't look dotted at speed.
  - A moving flickering light. The flame particles also write heat haze.
- **Impact (0.2 s):**
  - A pyroclastic explosion volume (Ebert-style displaced sphere SDF) grows to r = 3 m in 0.25 s, then rises, rolls (toroidal warp) and cools into smoke over 1.5 s.
  - 2k bouncing sparks, a 400-particle dust ring along the floor, an 800-particle flame burst and 600 large smoke sprites.
  - Light flash of 40, decaying with τ = 0.3 s.
  - Shake trauma 0.5, FOV punch and an optional 50 ms hitstop.
  - Field splat: heat 1.0 and char 0.8 at r 2.5 m.
- **Aftermath (5 s):**
  - Ground-flame field emitters (≤ 1.5k live) appear wherever heat > 0.4.
  - A smoke column that the wind pushes.
  - Ember glow in the floor's grout lines and cracks (blackbody of heat), cooling over 3–5 s, with char remaining.
  - Everything dies out on its own as heat decays.
- **FX budget:** ≈ 1.2 ms (the explosion covers about 15% of the screen).

### Water: *Tidal Lance* (whip stream). Alt form: *Geyser*

Borrowed from UW:
- Optics: Fresnel, refraction of the resolved scene and Beer–Lambert absorption.
- `WATER_PRESETS`: clear, tropical, toxic green (which Acid reuses), purple and the rest.
- The `bakeTextures` foam texture for aeration.
- Cauchy–Poisson impact rings, up to 8, on puddles and the pool.
- `Spray` HG billboard lighting.
- The ballistic idea behind `SPLASH_VERT`.
- PostFX lens droplets, triggered when a splash lands within 3 m of the camera.

The spell itself:
- **Charge:** the orb gathers droplets from the pool and the air, as a spinning SDF blob. A caustic **cookie light** under the orb projects a procedural caustic onto the floor.
- **Travel:** a chain of 16 smooth-unioned spheres along the whip spline, raymarched (32 steps) inside a capsule proxy in the **refraction pass** at full res, so edges stay crisp. Thickness is estimated from the SDF depth. Plus 1.5k shed droplets and 300 mist.
- **Impact:**
  - A splash crown sheet: a 64 × 8 ring mesh whose radius and height follow ballistic curves in the VS, with the rim broken into Rayleigh–Plateau fingers by noise alpha-clip.
  - 800 crown droplets. On collision they morph into splash or ripple kinds and paint wet.
  - A wet splat at r 3 m, and ripple rings in both the pool's 256² wave sim and the floor's wet normal.
- **Aftermath:** the puddle evaporates (faster under heat, producing steam). A wet dummy turns glossy and drips.
- **FX budget:** ≈ 0.9 ms.

### Ice: *Glacial Spike*, which becomes a *Frost Nova* on impact. Alt form: *Ice Wall*

- **Charge:**
  - Sinking cold mist (media) and 1k glinting crystal motes.
  - A faceted crystal grows at the focus, with vertices clipped past a growth front that has an emissive edge.
- **Projectile:** a procedural hexagonal shard of about 200 triangles in the refraction pass:
  - IOR 1.31, analytic convex thickness, Beer–Lambert cyan absorption.
  - Flat facet normals for sharp highlights.
  - A fake interior: 3D noise sampled at 3 depths along the refracted ray, which reads as bubbles and cracks.
  - A frost-coat mask with rough white edges.
  - A mist trail and chips breaking off.
- **Impact:**
  - 48 shard debris particles with a cheap ice shader (Fresnel, environment, rim) that tumble and bounce.
  - 8 ice spikes in a ring, using Earth's spike system with an ice material (refractive on High, cheap on Low).
  - The ground gets a frost splat with **potential 1.8**. The cellular frost front then crawls outward in fern fingers over about 1 s. Wet texels freeze instantly into a glossy ice sheet.
  - Frost on the floor uses UW's **glint** technique (Poisson facets twinkling).
  - A hit dummy gets the *frozen* status: an ice shell (its mesh inflated 8 cm along normals, refractive) grows from the bottom up behind a noisy clip front.
- **Aftermath (6 s):** frost melts into wet, shards shrink and drip, mist lingers.
- **FX budget:** ≈ 0.9 ms.

### Earth: *Upheaval* (a line of spikes). Alt form: *Meteor* (a boulder assembled from debris, then thrown)

- **Charge (0.5 s):**
  - Low-frequency rumble shake (8 Hz).
  - A crack splat whose front propagates along the voronoi-vein mask. The floor renders cracks with an 8-step parallax-occlusion lite, only where the mask is above 0, so it's a dynamic branch.
  - 300 pebbles hop and dust seeps from the cracks.
- **Impact:**
  - 7 procedural spikes (4 variants of about 400 triangles each, generated at load) rise with ease-out-back over 0.15 s, staggered by 30 ms, and register as dynamic capsules.
  - 600 rock debris particles (60–150 triangles each, 4 variants) are thrown from the spike bases. They are GPU physics-lite: SDF bounce with restitution 0.3 and friction 0.6, then sleep. Orientation is `axis(seed)·ω·min(age, tRest)`, with tRest stored in custom0.
  - 1.5k ground-hugging dust particles (high drag, slightly negative buoyancy), lit by the sky.
  - Trauma 0.9 and a floor-level shock ring.
- **Aftermath (4 s):**
  - The spikes crumble into debris and sink.
  - Debris fades with **alpha-to-coverage dithering** in the MSAA opaque pass, which gives a smooth fade without leaving the opaque pass.
  - Cracks persist for about 15 s.
  - If heat touches them, the cracks and debris glow as **magma** (blackbody), via the field and the impacts list.
- **FX budget:** ≈ 0.8 ms, almost all of it dust fill.

### Wind: *Cyclone*. Alt form: *Wind Slash* (a crescent projectile that cuts a scratch line into the field's crack channel)

Air is invisible, so wind is shown by what it carries, plus streaks and refraction.

- **Charge:** streak particles spiral into the focus along curl and vortex flow, 400 dust motes lift around the caster, and a faint distortion swirl forms.
- **Cast:**
  - A Rankine vortex force joins the shared field, so **every particle of every spell gets pulled in**.
  - 10 analytic helix ribbons of 64 points: pale additive plus distortion.
  - 2.5k funnel dust particles (media, orbiting).
  - 200 leaves and pebbles (debris style; leaves are bent double-sided quads).
  - 60 spiralling distortion sprites, which are the strongest single cue.
  - A 600-particle ground dust ring.
  - The pool's ripple sim gets a swirl.
- **Global:** an ambient wind direction and strength slider affects all smoke and embers in the lab.
- **FX budget:** ≈ 0.7 ms.

### Void: *Singularity*. Alt form: *Rift* (tendrils whipping out of a tear in space)

- **Charge:**
  - Light drains: black *absorbing* media is darkness that genuinely eats light, through WBOIT revealage.
  - Motes are sucked into the focus, which dims.
- **Travel (6 m/s, wobbling):**
  - An opaque black event horizon.
  - **Lensing pass (point-mass lens):** `β = θ − θ_E²·θ/|θ|²`. Sample the composited HDR at `c + β` (aspect-corrected), but only for pixels whose depth is behind the void. Inside `r_h` the result is black, and a photon ring brightens at about θ_E. It fades near screen edges. After James et al. 2015 (*Interstellar*).
  - **Accretion disk:** 20k full-res motes on a Kepler orbit kind (v ∝ r^−½, inner cut at 3r_s).
    - Hot inner, cooler outer (or the violet preset).
    - **Doppler beaming:** brightness × (1 + k·v̂·(−view))³.
    - Because lensing runs *after* the FX composite, **the disk itself is lensed**, which produces the halo over the top of the hole.
  - 6 dark ribbon tendrils with violet edges.
  - A corruption field that spreads along veins.
  - Global attractor: particles from any spell spiral in and die at the horizon.
- **Collapse (impact):**
  - Implosion over 0.3 s while the lens strength spikes.
  - A 0.1 s photographic-negative inversion shell in screen space.
  - The attractor flips to a shock-shell impulse, flinging out everything it captured.
  - 3k motes and a dark smoke burst.
  - Heavy distortion ring.
- **FX budget:** ≈ 0.8 ms, plus 0.15 ms for the lens pass.

### Light (holy): *Judgment* (sky pillar plus sigil). Alt form: *Radiant Lance*

- **Sigil:** a 3 m procedural SDF glyph ring (concentric rings, rotating runes from a small glyph SDF set, a hexagram). It draws itself in by an arc-length reveal, full-res additive with `fwidth` anti-aliasing, and also acts as a cookie light.
- **Beam:** a cylinder volume (16 steps) with HG in-scatter, internal god rays from noise, and capsule shadows that slice it where pillars cross it.
  - It slams in from 0.2 to 2 m width.
  - 2k rising motes and 200 feathers (stretched tumbling motes).
  - A golden glow splat and a flash.
- **Ultra tier:** pseudo lens flare (Chapman 2013) and anamorphic streaks.
- **FX budget:** ≈ 0.7 ms.

### Acid: *Toxic Bloom* (lobbed orb). Alt form: *Corrosion Cloud*

- The orb **reuses Water's metaball renderer** with acid shading: emissive green subsurface, bubble-cell displacement and popping.
- 400 drips trail behind it; they fall, paint acid and morph into sizzle on contact.
- **Impact:**
  - An acid pool spreads in the field: darkening, bubbling foam (animated voronoi) and sizzle particles.
  - 2k heavy fog particles hug the floor with negative buoyancy, flow on curl noise and pool around pillars because they collide with occluders.
  - 300 thin-film iridescent bubbles: sphere impostors with a film-thickness colour palette (after Belcour & Barla 2017).
  - Hit dummies **dissolve** behind a noise threshold with an emissive edge.
- **FX budget:** ≈ 0.8 ms.

### Arcane: *Arcane Barrage* (8 homing missiles). Alt form: *Aegis* (shield)

- **Barrage:**
  - Missiles are CPU heads using proportional-navigation steering, launched 60 ms apart with a random initial spread.
  - Each has a bright core sprite, a history ribbon and sparkles.
  - Each impact is a small burst plus a ring splat. The runic circle shares Light's sigil shader.
- **Aegis:**
  - A hex-grid Fresnel sphere, full-res lines plus a half-res distortion layer.
  - A **depth-intersection glow** where it meets the floor.
  - Up to 8 hit ripples travelling across the sphere, lighting hex cells.
  - It registers as a dynamic sphere occluder, so particles and debris bounce off it and bolts end on it.
  - The **"Aegis test" demo fires every element at it.**
- **FX budget:** ≈ 0.5 ms.

**Considered and cut:**
- Blood: tone, and its techniques duplicate water plus acid.
- Nature: growth geometry is its own subsystem. It's the ideal first community element.
- Plasma: covered by a blue-flame preset and a future ball-lightning form.
- Shadow: overlaps Void.
- Sonic: overlaps Wind's distortion.

**Combos.** Mostly emergent from the field, forces and occluders. The rule table in `combos.js` only adds flourishes. Scripted demos:
1. **Steam:** Frost Nova, then Fireball. Frost melts to wet, and heat × wet makes a steam burst.
2. **Conduction:** Tidal Lance soaks the pool, then Thunderstrike. Arcs cover all wet texels and the pool flashes.
3. **Firestorm:** Cyclone, then Fireball. Flames enter the vortex, a rule boosts flame emission, and the light orbits.
4. **Magma:** Upheaval, then Fireball. Heat lands on the spikes and debris through the impacts list.
5. **Flash Freeze:** Lance, then Spike. The puddle turns into an ice sheet and the pool freezes.
6. **Event Horizon:** Singularity in the middle of Cyclone and embers, then collapse.
7. **Aegis Test.**

---

## 4. Efficiency strategy

**Targets**
- **Desktop: 120 fps at 1440p-class on mid GPUs.**
  - Reference RTX 3060 at 3.3 MP: **≤ 3.0 ms at a single spell's peak (≥ 330 fps)** and ≤ 1.3 ms idle. This is the user's target; it can be raised later if a spell genuinely needs more. A GPU about 2.5× slower still holds 120.
  - JS ≤ 1.5 ms per frame, no GC.
- **Mobile: locked 60 fps** on an Adreno 732 (UW's OnePlus Nord 4) at resolution 0.6, ≤ 11 ms GPU at peak, which leaves thermal headroom.

**Per-pass budget (High, 3060, 3.3 MP), sized for the 3 ms target**

| pass | idle ms | peak ms |
|---|---|---|
| sim (particles 262k + ground + pool) | 0.06 | 0.12 |
| reflect (0.35 scale) | 0.15 | 0.25 |
| opaque (4× MSAA) | 0.6 | 0.7 |
| refract | 0 | 0.2 |
| lines (full-res emissive) | 0.02 | 0.2 |
| fx (half-res MRT) | 0.05 | 0.9 |
| fxComp | 0.12 | 0.12 |
| lens | 0 | 0.15 |
| post | 0.3 | 0.3 |
| **total** | **≈1.3** | **≤ 3.0** |

Debris sun shadows were cut to fit the budget. Debris is lit by spell lights and the sky instead.

**Quality tiers (`engine/quality.js`)**

| | Low (mobile default) | Medium | High (desktop default) | Ultra |
|---|---|---|---|---|
| resolution (× DPR, capped at 2) | 0.6 | 0.85 | 1 | 1 |
| MSAA | 2 | 4 | 4 | 4 |
| FX buffer | ½ | ½ | ½ | full |
| particle pool | 32k | 128k | 262k | 1M |
| debris | 512 | 2k | 4k | 8k |
| volume max steps | 12 | 16 | 24 | 32 |
| noise3D | 64³ | 128³ | 128³ | 128³ |
| ground field | 512² | 1024² | 1024² | 2048² |
| planar reflection | off | 0.35 | 0.5 + emissive FX | 0.5 + emissive FX |
| shadowed spell lights | 0 | 1 | 4 | 4 |
| bloom levels | 4, seeded from FX emission | 6 | 6 | 6 + anamorphic |
| 3D fluid inferno | – | – | – | 64³ atlas |

Spells declare counts at High. Emission is multiplied by a tier scale and an auto scale.

**Rules**

1. **Auto never recompiles.** Defines, light counts and MSAA change only when the user explicitly changes the tier (behind a "Recompiling…" overlay). Every auto lever is a uniform or a target size.
2. **Auto ladder.** Extends UW's missed-vsync logic: a 2 s window, step down if more than 4% of frames miss, climb back after 3 clean windows. Order:
   1. emission scale 1 → 0.6
   2. volume steps 1 → 0.6
   3. FX buffer ½ → ⅓
   4. resolution −0.05 per step down to 0.5
   5. lock to 30 fps
   
   On by default on mobile, available as an option on desktop (UW parity).
3. **Overdraw control:**
   - Clamp each style to a maximum screen size (media ≤ 12% of screen height).
   - Fade near the camera (UW Spray's `smoothstep(2.5, 10, viewZ)`).
   - Prefer fewer, larger, noise-eroded sprites to many small ones.
   - Fit volume proxies tightly and LOD steps by pixel radius.
   - An **overdraw debug view** (a uniform, not a define) renders FX as constant additive, like Unreal's quad-overdraw view.
4. **Draw calls are flat across spells:** 4 particle styles, 1 instanced ribbon draw per ribbon material, all bolts in one draw (per-instance seeds), and ≤ 6 live volume draws.
5. **Zero per-frame allocations:**
   - Module-level scratch (UW `floaters.js` `_v` pattern).
   - Uniform arrays backed by preallocated Float32Arrays.
   - Fixed pools for casts (16), lights (16), forces (8), impacts (16), splats (16) and emit records (32).
   - The HUD updates at 2 Hz (UW).
   - Call `renderer.info.reset()` manually at frame start, because PostFX turns `autoReset` off.
6. **Warmup (`engine/warmup.js`):**
   - Every `create()` runs at load. Then `await renderer.compileAsync(...)` for the main, FX and refraction scenes, using KHR_parallel_shader_compile.
   - Then **one warm frame** with every FX object at instanceCount 1 into its *real* targets (HDR MSAA, half-res MRT, reflection), because ANGLE/D3D11 builds input-layout and render-target variants at draw time.
   - About 45 programs. The spec line shows "warming shaders 23/45" and the spell bar is disabled until warmup finishes.
   - Keep loops uniform-bounded, so ANGLE's compiler (fxc) doesn't unroll them; that cuts compile time.
7. **Pooling.** Ring sub-pools for particles, history-ribbon slots, volume slots per spell (≤ 4) and debris instances. Nothing is created after load.

---

## 5. Lab UX

**Scene: "The Proving Ground"**
- A 36 m circular arena with a dark polished basalt tile floor: procedural tiles and grout, per-tile roughness from 0.08 to 0.35, so lights and FX reflect.
- A 1.2 m rim wall and 8 pillars (r 0.6, h 6 m) at radius 14 m.
- A crescent reflecting pool on one side (6 m wide, 15 cm deep, 256² ripple sim after Evan Wallace's MIT WebGL Water).
- The caster's focus orb on a pedestal at one end, and 3 training dummies at 10, 14 and 18 m.
- **Time of day:** Dusk (default), Night (hash stars, near-black ambient) and **Noon**. Noon keeps the effects honest in daylight; most VFX demos only work on black.
- Sky and IBL come from UW's Hillaire atmosphere cube.

**HUD (top left).** UW's panel unchanged, plus:
- `#hud` lines: `particles ≤ 41k / 262k · draws 38 · tris 1.2M · casts 3 · tier High`.
- The per-pass GPU ms list.
- A **phase strip** canvas (456×10): the active cast's charge, travel, impact and linger in colour, with a playhead.

If timer queries are unavailable (Firefox, Safari), the HUD shows CPU ms and the benchmark falls back to fence timing, as in UW.

**Spell bar.** Bottom centre, 10 buttons with key hints 1–0, the active one in its element's hue, styled like the perf panel. On mobile it becomes a scrolling row at the top, the perf panel moves to the bottom (UW's `.mobile` CSS) and lil-gui starts closed.

**lil-gui (right):**
- Top level: `element`, `form`, `cast`, `auto-cast` plus interval, `target` (dummy 1/2/3 or click), `combo demo`, `preset`, `copy link`, `screenshot`, `record`, `camera` presets (Overview, Shoulder, Target close-up, Low hero, Top-down).
- Folders:
  - the active spell (rebuilt on switch from `params`/`ranges`)
  - Arena & sky (time of day, wetness, floor roughness, ambient wind)
  - Camera (shake, hitstop, FOV, cinematic follow)
  - Time (time scale, pause, step frame)
  - Post (exposure comp, auto exposure, bloom strength/threshold, contrast, saturation, tonemapper, distortion, CA, vignette, lens dirt, "smoke occludes glow")
  - Quality (tier, resolution, MSAA, auto, particle budget, FX scale, reflections, **debug view**: none, overdraw, FX emission, media, distortion, ground field A, ground field B, particle state)

**Casting:**
- Click on the floor or a dummy to cast there. A press counts as a click when it moves < 5 px and lasts < 250 ms; drags orbit (OrbitControls, as in UW).
- Space casts at the current target, and holding Space sustains a beam. Keys 1–0 pick the element, Q/E cycle forms, F toggles auto-cast. Tap to cast on mobile.
- **Attract mode** on first load auto-casts the showcase loop with a cinematic camera until the first input. It doubles as the README GIF source.

**Presets.** Per-spell variants, like UW's water colour presets: storm, crimson and violet lightning; hellfire, blue and soulfire flame; void violet or white-hole.

**Shareable state.** `#spell=fire&form=Fireball&fire.size=1.4&q=high&tod=dusk&cam=…`, non-defaults only, written with a debounced `history.replaceState`. Query parameters stay for modes (`?mobile`, `?desktop`, `?bench`, `?shot`, `?showcase`, `?selftest`).

**Capture.**
- Screenshot: `canvas.toBlob` in the same task right after `post.render`, so `preserveDrawingBuffer` isn't needed.
- Record: `canvas.captureStream(60)` + MediaRecorder VP9 WebM.
- Both use native APIs and add no dependencies.

**Accessibility (not optional).**
- A **"Reduce flashes & shake"** toggle, defaulting on when `prefers-reduced-motion` is set. It caps flash intensity, limits restrikes so there are never more than 3 flashes per second (WCAG 2.3.1), disables inversion, scales shake to 0.25× and turns hitstop off.
- Lightning is a real photosensitivity risk.

---

## 6. Post-processing

1. **fxComp** (section 2.5): nearest-depth upsample, distortion, distortion-driven CA, WBOIT resolve, emission, radial "impact punch" UV offset for a few frames, inversion mask.
2. **lens:** only while a void is alive.
3. **PostFX** (the UW file with small changes):
   - **Meter source.** `render(hdr, dt, meterSrc)` meters the pre-FX opaque HDR. Spell lights on the arena still adapt the eye, so after-flash dimming is real, but the emissive FX don't pump exposure.
   - Bloom keeps its dual filter and Karis average. Defaults rise to strength 0.12 and threshold 1.0, because bloom *is* the glow here.
   - **Tonemapper:** AgX (default; its path to white suits fire cores) or **Neutral** (three's Khronos PBR Neutral chunk; keeps stylised hues saturated). Both are credited like AgX.
   - Optional lateral CA (2 extra taps when > 0).
   - A procedural lens-dirt texture, baked the `bakeTextures` way, multiplies bloom.
   - `uFlash` is capped in reduced mode.
   - UW's lens droplets stay and are triggered by water splashes.
   - TPDF dither is unchanged.
4. **Camera, not post:**
   - Trauma shake (Eiserloh, GDC 2016): trauma²·noise, 2° yaw/pitch, 3° roll, 6 cm. Frequency is per source: 8 Hz for earth, 30 Hz for lightning. Decays at 1.5/s.
   - FOV punch of +3° for 80 ms.
   - Hitstop: sim dt × 0.05 for 50–80 ms on heavy hits (Nijman's "Art of Screenshake").
5. **Not done:** TAA and motion blur. MSAA follows UW, and motion is carried by velocity-stretched sparks and ribbons, which is how games blur VFX.

---

## 7. Roadmap and verification

Each phase ships something that stands on its own.

**Phase 0: Sibling skeleton**
- Repo scaffold, `engine/` copied, arena plus dusk sky, perf panel, benchmark and uncapped mode, quality tiers, GUI shell, `cast.js` with click targeting against the JS arena mirror, SpellLights in the arena material, the ground-field sim with a debug view, the Pages deploy, and `?selftest`.
- `?selftest` checks the JS `arenaSDF` against the GPU over 256 probe points via async readback. This is the one runnable check of CPU/GPU agreement.
- **Done when:** the arena renders in ≤ 1.5 ms at 3.3 MP, the HUD per-pass timers work, the live URL is up and the selftest passes.

**Phase 1: First light (v0.1, launchable). Lightning + Fire**
- These two exercise nearly every system: particles and the kind table, ribbons and bolts, the FX MRT and composite, volumes, blackbody, the field (heat and char), distortion, line lights, capsule shadows, shake and warmup.
- **Done when:** both spells run every phase, the per-spell bench is within budget, the first cast shows no hitch, there is no GC, the README has a GIF and perf tables, and the Adreno 732 holds 60 fps.

**Phase 2: Water + Ice**
- The refraction pass, metaballs, the pool sim, wet and frost fronts, dummy statuses, debris, and the Steam, Conduction and Flash Freeze combos.

**Phase 3: Earth + Wind + Void (v0.5, "Seven elements")**
- Debris physics-lite, crack parallax, the vortex and attractor forces, the lens pass, the Firestorm, Magma and Event Horizon combos.

**Phase 4: Light, Acid and Arcane, plus alt forms (v1.0 launch)**
- All 10 alt forms, the combo demos, attract mode, presets, URL sharing, capture and record, reduced-motion support.
- Launch posts to the three.js forum, r/threejs, Hacker News and X.

**Phase 5: Ultra**
- The 3D fluid Inferno: 64³ in a 512² atlas. Advect, buoyancy and vorticity confinement, divergence, 16 Jacobi iterations, project: about 20 draws, ≈ 0.5 ms (GPU Gems 3 ch. 30, Crane et al. 2007), using UW's atlas trick.
- Anamorphic streaks and lens flare, 2048² field, hi-res screenshot, and a tuning pass on a Mali GPU and an iPhone.

**"Done" in every phase also means:**
1. **Per-spell bench (`?bench=<id>`).** Fixed camera, seed and dt (1/120). The spell timeline renders back-to-back with the loop paused, fence-timed (UW `runBenchmark`). Output per pass: mean and **peak** ms, pasted into the README tables. Peak FX must stay ≤ the spell's budget on High.
   - **`?bench=storm`** casts every shipped spell and the combo demos together on one timeline. It is the worst-case row in the README. Target on High: ≤ 7 ms on the 3060 at 3.3 MP, which is still about 140 fps.
2. **Hitch check.** The first cast's frame time is ≤ 2× the median (logged).
3. **GC check.** JS heap growth (`performance.memory`, Chrome) is < 50 KB over a 600-frame auto-cast loop.
4. **Visual matrix.** `?shot=<spell>&t=<s>&seed=<n>` freezes a deterministic frame. `scripts/capture.mjs` (Playwright, headed Chrome with GPU) captures spells × {charge, travel, impact, aftermath} × {dusk, noon} into `docs/shots/`. PRs are reviewed with GitHub's image diff. The matrix must include the edge cases "smoke behind a pillar edge" and "fire in front of the pool".
5. **Mobile.** 60 fps live with < 1% missed frames on the reference phone, measured warm (UW's method).
6. **Reference devices:** RTX 3060 (UW's), an integrated GPU (M1 or Iris Xe), the OnePlus Nord 4 and an iPhone.

### 7.1 Build approach (how we actually make it fast)

- **Phases 0 and 1 are built in one thread.** They define every interface a spell touches: `fx.emit`, kinds, `fx.volumes.add`, ribbons, splats, lights, forces, impacts and the cast clock. Lightning and Fire are built in that same thread, because they are what proves those interfaces.
- **After v0.1 the interfaces freeze.** Each element is one file in `src/spells/` plus its own GLSL chunk, so phases 2–4 can run as **parallel agents, one per element**.
  - Each agent touches only its own spell file and chunk.
  - Each one runs `?bench=<id>` and the shot matrix, and reports its numbers.
  - Any change a spell needs in `vfx/` or `engine/` comes back to the main thread, so no two agents ever edit the same file.
- **Every round of upgrades is argued with a second agent before building,** as UW's was. The README says so.
- **Verification uses the in-app browser.** Each spell is checked against `?shot=` frames and `?bench=` numbers before it counts as done. The Playwright shot matrix (`scripts/capture.mjs`) waits until contributors need it in CI.

---

## 8. Open-source packaging

- **License and notices.** MIT. THIRD_PARTY_NOTICES lists:
  - three.js (AgX and Neutral tonemapping)
  - Dave Hoskins's hash without sine (MIT)
  - Hillaire's UnrealEngineSkyAtmosphere (via UW's `atmosphere.js`)
  - Ultra Water itself (same author, MIT; name the reused files)
  - Evan Wallace's WebGL Water (if the ripple sim is adapted)
  - iquilezles.org SDF snippets (check the stated license when porting)
- **Rule for contributors:** no Shadertoy code without an explicit permissive licence (Shadertoy's default is CC BY-NC-SA). Implementing techniques from papers is fine.
- **README** (UW's structure):
  - one-line title and a live demo link
  - hero GIF
  - `npm install && npm run dev` and usage (controls plus the UW perf-panel paragraph)
  - **Performance**: per-spell desktop and mobile tables with the vsync timer caveat, then **Phones and tablets**
  - **What's in it**: shared systems and each element, with file paths
  - **Pipeline**: the numbered list
  - **Elements interact**: the field and forces
  - **Not in yet**, **Adding an element** (pointing to CONTRIBUTING), **License**
  - the line "The design was argued out with a second agent before building."
- **Hosting.** GitHub Pages via an Actions workflow (`actions/upload-pages-artifact` + `actions/deploy-pages`) with Vite `base: './'`. There are no assets, so the build is small.
- **Media.** Recorded in-app as WebM, converted with ffmpeg to MP4 (GitHub embeds it) and a 6–10 s GIF under 8 MB. Stills come from the shot matrix.
- **CONTRIBUTING.md: adding an element in 5 steps.**
  1. Copy `spells/_template.js`.
  2. Declare `params`, `ranges` and `kinds` (numbers first, GLSL hooks only if needed).
  3. Build its meshes in `create(fx)` from the shared systems.
  4. Register it in `spells/index.js`. Warmup picks it up automatically.
  5. Run `?bench=<id>` and the shot matrix, then paste the numbers.
  
  Hard rules: no per-frame allocations, no new runtime dependencies, no runtime define toggles, peak FX ≤ 1.2 ms on High at the reference setup, must run on Low, reduced-motion respected, licence hygiene.

---

## 9. Risks and hardest problems

| Risk | Mitigation |
|---|---|
| **Shader compile hitches** on ANGLE/D3D11, the #1 thing that makes a web demo feel cheap | Everything is created at load. compileAsync plus warm draws into real targets. Uniform-bounded loops. No runtime defines or light-count changes. Hitch check in every phase. |
| **WBOIT can't occlude emission correctly** (dark smoke in front of a fireball) | Fire-to-smoke particles carry both outputs, so self-consistency holds locally. `emission × mix(1, revealage, k)` with k = 0.5 as a slider. A near/far depth-split second WBOIT layer only if the shot matrix shows it's needed. |
| **Full-res sparks, motes and bolt cores are drawn before the half-res FX composite,** so smoke dims them even when they sit in front of it | Sparks are small and bright, so it rarely reads. If the shot matrix shows it, sparks closer than the media's average depth get a second additive draw after `fxComp`. |
| **Half-res halos at silhouettes** | Farthest-depth prepass, nearest-depth upsample, occlusion reject. Pillar-edge cases in the matrix. |
| **Volume noise without TAA** | Slab integration, 0.5-step IGN jitter, LOD steps, raymarching only small hero shapes. Volume-layer-only temporal reprojection is held back for phase 5 if needed. |
| **"Unreal-tier" is mostly art and timing, not tech** | A timing doctrine per spell: anticipation → release → impact → follow-through. Hot white core → hue → smoke value ramps. Every spell must read as a recognisable silhouette in a 64 px thumbnail. Study the published VFX breakdowns from Riot (VALORANT, readability first), Blizzard (Overwatch shape language), Diablo IV, Unreal's Niagara samples and sakuga effects animation. |
| **Auto exposure pumping on flashes** | Meter pre-FX, keep UW's luminance clamp, an exposure lock toggle. |
| **Mobile pass count and fill** | ≤ 12 passes. Bloom seeded from the half-res emission buffer (4 levels). Low budgets. The auto ladder. |
| **fp16 overflow in WBOIT, negative distortion** | Weights clamped to 1e-2..1e2; signed RGBA16F is fine. |
| **Photosensitivity** | Reduced-motion mode is on by default when the OS asks. At most 3 flashes per second. |
| **CPU/GPU disagreement (targeting vs rendered SDF)** | One occluder list generates both. `?selftest` readback check. |
| **Lensing's screen-space limits** | Fade at screen edges. Documented under "Not in yet". |
| **Scope creep** | Ten elements, each with one signature form, before any alt form. Alt forms all land together in phase 4. |

---

## 10. Non-obvious things that would make it world-class

1. **The ground as a reaction sim, painted by particles.** Elements genuinely interact, and steam, embers and mist come out of the floor itself. This is very rare in web VFX demos.
2. **One shared world for everything:** forces, occluders and impacts. Every spell respects every other spell with no per-pair code.
3. **A Niagara-style kind table on the GPU.** Every particle behaviour is a live slider and nothing recompiles.
4. **Line lights on a polished floor and capsule shadows from spell lights.** These are the two cheap tricks behind Unreal's "expensive" look.
5. **Physically seeded colour.** A blackbody LUT from the CIE analytic fit, fire-to-smoke ramps, Doppler-beamed accretion, and lensing that also bends the FX layer.
6. **Game feel:** thunder delayed by the speed of sound, trauma shake per source frequency, hitstop, FOV punch.
7. **Lab transparency:** overdraw and buffer debug views, a phase strip with slow-motion and frame stepping, deterministic shot and bench URLs, and per-spell peak/mean GPU tables in the README.
8. **Noon mode** proves the effects hold up in daylight.
9. **Zero assets:** the whole lab is procedural and loads in about a second.

**References:**
- McGuire & Bavoil 2013 (WBOIT, JCGT)
- Umenhoffer et al. 2006 (spherical billboards)
- Bridson et al. 2007 (curl noise)
- Hillaire 2015 (Frostbite volumetrics)
- Schneider 2015 (Horizon Zero Dawn clouds)
- Karis 2013 (UE4 shading, representative-point lights, falloff)
- UE4 capsule shadows documentation
- Wyman, Sloan & Shirley 2013 (CIE fit)
- Reed & Wyvill 1994 (lightning)
- Crane, Llamas & Tariq 2007 (GPU Gems 3, ch. 30)
- James et al. 2015 (*Interstellar* lensing)
- Belcour & Barla 2017 (iridescence)
- Ebert et al. (pyroclastic noise)
- Chapman 2013 (pseudo lens flare)
- Persson / Humus (phone-wire AA)
- Eiserloh, GDC 2016; Nijman 2013

---

## 11. Deliberately not building

- No WebGPU port, TAA, deferred renderer or physics engine (debris is GPU physics-lite).
- No ECS, plugin system or node editor. No TypeScript or React.
- No texture or flipbook assets.
- No audio in v1. Procedural WebAudio (thunder delayed by distance, crackle, whoosh, impact thumps) is the first v1.1 item and goes under "Not in yet".
- No debris-debris collision.
- No shared npm engine package with UW: copy the 4 `engine/` files and keep them diffable.

---

### The files that carry the design

- `src/vfx/Particles.js`: the pool, emit ring, kind table, sim and render styles.
- `src/vfx/FxTarget.js`: the half-res MRT with one blend state, the depth prepass, fxComp and the lens pass.
- `src/spells/cast.js`: the cast pool, phase clock, and flight and impact against the arena mirror.
- `src/main.js`: the pipeline, HUD and loop, modelled on UW's `main.js`.
- `src/engine/PostFX.js`: copied from UW, with a meter source, a tonemapper option, CA and a flash added.

Sources:
- [WebGPU is now supported in major browsers (web.dev)](https://web.dev/blog/webgpu-supported-major-browsers)
- [three.js WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html)
- [three.js manual: WebGPURenderer](https://threejs.org/manual/en/webgpurenderer)
