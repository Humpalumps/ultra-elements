# Ultra Elements

Real-time spell effects for three.js (WebGL2): 39 spells across ten elements and three hybrids, cast in a small arena with training dummies. Every spell is a lab: its settings sit in their own panel of sliders, colours and presets, and they change the spell live.

```bash
npm install
npm run dev
```

Open the printed localhost URL. The landing page casts every spell in turn until you touch something. Pick an element with `1`–`0` (`H` for hybrids) or the bar at the bottom, step through its spells with `Q` / `E`, and cast with `Space` (hold it for channelled spells) or by clicking a dummy or the floor. `F` toggles auto-cast. Every spell has its own folder of settings on the right, with presets and a reset. `copy link` puts the whole state in the URL hash. Camera shots (`Overview`, `Shoulder`, `Target close-up`, `Low hero`, `Top-down`, `Phone`) are in the `camera` dropdown, and `combo demo` plays scripted chains such as frost then fire (steam) or soaking the pool then lightning.

The performance panel (top left) shows the GPU, render size, fps, ms per frame, draw calls and per-pass GPU timers. `Uncap FPS` renders frames back-to-back, so the counter shows what the machine can do. `Run benchmark` casts the selected spell and times every frame to GPU completion with a fence.

URL modes: `?reel` plays the showreel (one pass of every spell in about three minutes, a camera cut per spell, captions, and two lab demos where the settings panel moves sliders and presets live; `&clean` also hides the perf panel, `&record` saves an MP4 with the captions and lab panel in it, or a WebM where the browser can't record H.264). `?q=low|medium|high|ultra` picks a tier, `?mobile` / `?desktop` force the device profile, `?mp=3.3` renders at a fixed 3.3 MP, `?benchall` benchmarks every spell at start-up, and `?shot=<spell>&t=<s>` renders one deterministic frame. `?clips=<plan.json>` films the promo's raw footage, one clip per spell at a fixed 60 Hz step; `dev/promo/` has the shot plan and the scripts that film and cut it (ffmpeg needed).

## Performance

Measured with `app.benchAll()` on an RTX 3060 (Chrome, ANGLE/D3D11), High tier, 4× MSAA, at 3.3 MP (`?mp=3.3`, the pixel count of 1440p). Each spell is cast at the middle dummy and every frame is timed to GPU completion with a fence. `worst` is the slowest quarter-second of the cast, `mean` the average over the cast. Best of three runs, in milliseconds. The Nord 4 columns are the same benchmark on a phone (see below).

| Spell | Element | RTX 3060 worst | RTX 3060 mean | Nord 4 worst | Nord 4 mean |
|---|---|--:|--:|--:|--:|
| Thunderstorm | Lightning | 3.34 | 2.91 | 8.53 | 6.51 |
| Meteor | Earth | 3.32 | 2.77 | 7.98 | 6.92 |
| Geyser | Water | 3.18 | 2.71 | 7.65 | 5.98 |
| Fireball | Fire | 3.07 | 2.76 | 7.93 | 6.57 |
| Dust Devils | Wind | 3.07 | 2.50 | 7.79 | 6.75 |
| Fissure | Earth | 2.99 | 2.48 | 7.62 | 6.45 |
| Corrosion Cloud | Acid | 2.98 | 2.53 | 7.13 | 5.95 |
| Judgment | Light | 2.95 | 2.49 | 6.95 | 6.16 |
| Inferno | Fire | 2.91 | 2.61 | 6.56 | 5.77 |
| Upheaval | Earth | 2.91 | 2.47 | 7.05 | 6.35 |
| Tsunami | Water | 2.83 | 2.49 | 8.29 | 6.40 |
| Starfall | Arcane | 2.83 | 2.44 | 7.63 | 6.47 |
| Tidal Lance | Water | 2.74 | 2.60 | 6.67 | 6.00 |
| Absolute Zero | Ice | 2.71 | 2.32 | 7.53 | 6.35 |
| Ember Swarm | Fire | 2.70 | 2.37 | 7.27 | 6.22 |
| Lava Geyser | Earth | 2.65 | 2.38 | 7.96 | 6.50 |
| Cyclone | Wind | 2.57 | 2.40 | 6.83 | 6.13 |
| Singularity | Void | 2.57 | 2.24 | 7.43 | 6.26 |
| Aurora Veil | Light | 2.57 | 2.35 | 7.19 | 6.22 |
| Ball Lightning | Lightning | 2.55 | 2.18 | 8.12 | 6.15 |
| Ice Wall | Ice | 2.55 | 2.21 | 7.23 | 6.27 |
| Supernova | Light | 2.52 | 2.23 | 6.57 | 6.19 |
| Plague Swarm | Acid | 2.51 | 2.29 | 7.19 | 6.33 |
| Fire Tornado | Hybrid | 2.51 | 2.31 | 7.29 | 6.40 |
| Thunderstrike | Lightning | 2.50 | 2.35 | 7.77 | 6.41 |
| Glacial Spike | Ice | 2.47 | 2.13 | 7.11 | 6.00 |
| Blizzard | Ice | 2.47 | 2.20 | 7.47 | 6.34 |
| Portal | Void | 2.45 | 2.27 | 8.31 | 7.10 |
| Frozen Lightning | Hybrid | 2.44 | 2.23 | 8.65 | 6.55 |
| Chain Arc | Lightning | 2.43 | 2.25 | 6.14 | 5.32 |
| Phoenix | Fire | 2.34 | 2.15 | 7.97 | 6.82 |
| Black Flame | Hybrid | 2.33 | 2.12 | 7.63 | 6.29 |
| Toxic Bloom | Acid | 2.31 | 2.12 | 7.59 | 6.22 |
| Radiant Lance | Light | 2.29 | 2.10 | 7.10 | 5.69 |
| Wind Slash | Wind | 2.27 | 2.18 | 5.60 | 5.19 |
| Arcane Barrage | Arcane | 2.25 | 2.10 | 6.53 | 5.97 |
| Rift | Void | 2.23 | 2.00 | 6.95 | 6.03 |
| Solar Flare | Light | 2.23 | 2.11 | 6.64 | 6.10 |
| Aegis | Arcane | 2.21 | 2.06 | 7.22 | 6.10 |

The budget is 3 ms for the whole frame at the slowest moment of a cast, and up to 4.5 ms where the extra buys a big visual gain. 34 of the 39 spells stay under 3 ms. Thunderstorm, Meteor, Geyser, Fireball and Dust Devils peak between 3.07 and 3.34 ms.

Idle arena (nothing cast): 1.37 ms mean, 34 draw calls. Opaque is 0.21 ms of that, post 0.11 ms, refract 0.09 ms.

The HUD's GPU timers read high while vsync-capped, because the GPU downclocks between frames. The fence benchmark is the one to trust.

### Phones and tablets

The same build spots phones and tablets (`matchMedia('(pointer: coarse)')`) and starts them on the Low tier. Desktop is unchanged. Add `?mobile` or `?desktop` to force either. A phone pays for render passes more than pixels, so the profile cuts passes first: three bloom levels, exposure metered at 20 Hz, a pool sim that sleeps when calm, and fewer fluid iterations. Auto quality lowers emission, volume steps and the FX buffer, then resolution by 0.05 to a floor of 0.5 when more than 4% of frames miss vsync over 2 s, and locks to 30 fps if the floor still misses more than a quarter.

The Nord 4 columns above are a OnePlus Nord 4 (Adreno 732, Chrome 156) on the Low tier: portrait 424 × 782 CSS px at resolution 0.6, 2× MSAA, the same fence benchmark, best of three. The phone stayed at thermal status 0 (no throttling) for the whole run. Every spell's worst quarter-second is between 5.6 and 8.7 ms, inside a 60 Hz frame (16.7 ms).

Live on the same phone, the landing page's spell loop runs at 57.2 fps with 5% of frames missing vsync and a worst frame of 50 ms once every spell has been cast once. The very first pass, where each spell compiles its shaders on its first cast, runs at 55.8 fps with a worst frame of 216 ms. Auto quality settled at resolution 0.55.

### Loading

`npm run build` makes one 1.8 MB JS file (567 kB gzipped). On the RTX 3060 PC a first visit takes about 24 s to the first cast, nearly all of it the browser compiling every spell's shaders one after another at start-up (ANGLE on D3D11). A repeat visit takes about 9 s, because Chrome keeps compiled shaders in its cache.

## What's in it

**Spells** (see [SPELLBOOK.md](SPELLBOOK.md)). `src/spells/<element>.js` holds each element's two founding forms, and every other spell is its own module in `src/spells/<element>/`. `import.meta.glob` finds them all.
- Lightning: Thunderstrike, Chain Arc, Ball Lightning, Thunderstorm
- Fire: Fireball, Inferno, Phoenix, Ember Swarm
- Water: Tidal Lance, Geyser, Tsunami
- Ice: Glacial Spike, Ice Wall, Absolute Zero, Blizzard
- Earth: Upheaval, Meteor, Fissure, Lava Geyser
- Wind: Cyclone, Wind Slash, Dust Devils
- Void: Singularity, Rift, Portal
- Light: Judgment, Radiant Lance, Solar Flare, Aurora Veil, Supernova
- Acid: Toxic Bloom, Corrosion Cloud, Plague Swarm
- Arcane: Arcane Barrage, Aegis, Starfall
- Hybrid (two elements at once): Frozen Lightning (ice and lightning), Fire Tornado (fire and wind), Black Flame (void and fire)

Every spell is deterministic for a seed, allocates nothing after `create()`, and adds no shader programs when cast. Each one writes counts at High and scales with the tier's emission.

**Frame** (`src/main.js`)
- sim → planar reflection → opaque (4× MSAA HDR) → refract → half-res FX → lens → post.
- Refract pass: the pool, ice, raymarched liquids and spikes sample the resolved opaque frame with depth validation (Ultra Water's water pass).
- FX pass (`FxTarget.js`): one half-res MRT for every soft translucent thing (media, volumes, glows, distortion), weighted-blended OIT, never sorted. A depth prepass keeps the farthest full-res depth of each footprint, so silhouettes don't reject the background.
- Post (`PostFX.js`): 13-tap dual-filter bloom (CoD AW) with Karis-weighted prefilter, anamorphic streaks at Ultra, camera-style auto exposure metered on the frame with the FX composited in, AgX tone mapping.

**Effect systems** (`src/vfx`)
- `Particles.js`: one GPU pool for every spell. Three RGBA32F state textures written by one MRT draw. Behaviour lives in a kind table texture (Niagara-style parameters, not code), so sliders write texels and nothing recompiles. Three render styles (full-res additive sparks, half-res OIT media billboards, instanced lit debris). Kind morphing on collision stands in for sub-emitters (droplet to splash, ember to smoulder).
- `ParticleFluid.js`: FLIP fluid in local box domains, entirely on the GPU (P2G, Jacobi pressure, G2P), drawn as a screen-space fluid surface with Ultra Water's shading and Ihmsen-style whitewater. Water spells and acid run on it.
- `FluidVolume.js`: a shared combustion and gas solver on a 3D grid in a 2D atlas. Kirchhoff emission: hot soot emits what it absorbs at its Planck temperature, so cooled soot is black smoke and a thin flame sheet is a faint glow.
- `Volumes.js`: raymarched hero volumes on back-face proxies, so the camera can sit inside.
- `Metaballs.js`: raymarched liquid blobs (smooth-unioned sphere chains) with refraction, Beer-Lambert tint and alpha-to-coverage silhouettes.
- `Bolts.js`: lightning evaluated per vertex from a handful of per-instance numbers, after Reed & Wyvill 1994.
- `GroundField.js`: a 40 × 40 m reaction field on the floor (heat, char, wet, frost; crack, acid, corruption, glow) that steps every reaction, takes splats and particle paint, and feeds every arena surface. It only re-simulates the region that changed.
- `Lens.js`: gravitational lensing for the void, a weak-field point-mass thin lens after James, von Tunzelmann, Franklin & Thorne 2015.
- `Spikes.js`, `Sigils.js`, `Ribbons.js`, `Shockwaves.js`: erupting rock and ice, SDF sigil circles, trail and analytic ribbons, expanding shock shells.
- `noise.js`: Perlin-Worley and curl noise baked on the GPU at load. No texture assets.

**Arena** (`src/scene`)
- Polished basalt floor with a recessed reflecting pool, rim wall, eight columns with rune bands, a focus pedestal and three training dummies.
- One shader pipeline for every lit arena surface (`arenaMaterial.js`), so they all react to spells the same way: scorch, char, wet sheen, frost, cracks, acid, corruption.
- Dummies take statuses that spells set (burn, freeze, dissolve) and ease towards them. A frozen dummy gets a refractive ice shell.
- The pool is a GPU ripple height field after Evan Wallace's WebGL Water.
- Sky after Hillaire 2020, with clouds baked into an HDR cube only when the sun moves (from Ultra Water).
- Camera feel on the camera, not in post: trauma shake (Eiserloh, GDC 2016), FOV punch and hitstop.

**Quality tiers** (`src/engine/quality.js`): Low, Medium, High (desktop default) and Ultra. Tier switches recompile; the auto ladder only touches uniforms and sizes.

## Not in yet

- Five spells peak a little over the 3 ms budget on the RTX 3060 (see the table): Thunderstorm, Meteor, Geyser, Fireball and Dust Devils.
- A cold start is slow (about 24 s on the RTX 3060). Shaders compile one after another at start-up. The worst offenders are the swarm constructor shared by Plague Swarm and Ember Swarm, and the fluid's foam warm-up.
- Tidal Lance: seen side-on, the beam reads as a flat band, and its single heaviest frame (5.7 ms) is the highest of any spell.
- Geyser: the water column reads a little glassy.
- Tsunami: up close, the wave's surface turns to soup.
- Solar Flare: seen side-on, the flare looks more like a fountain than a jet.
- Rift: the veins are slightly neon.
- Fissure: the trench shows a visible band along its length.
- Corrosion Cloud: the impact puff is weak.
- Glacial Spike erupts straight through Aegis instead of stopping at the shield.
- Sandstorm was built but shelved because it didn't reach the bar. It is in `dev/shelved/`, with notes on how to restore it.

## License

MIT, see [LICENSE](LICENSE). Code adapted from other projects is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
