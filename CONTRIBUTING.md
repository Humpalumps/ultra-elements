# Contributing

Thanks for wanting to add to the lab. The most useful contribution is a new spell: `SPELLBOOK.md` lists the planned ones, and anything not on it is welcome too. Performance wins with numbers are just as valuable.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. `?q=low|medium|high|ultra` picks the quality tier. `?mp=3.3` renders 3.3 megapixels whatever the window size, which is the size the budgets below are measured at.

## Adding a spell

1. Copy `src/spells/_template.js` to `src/spells/<element>/<id>.js` (a blend goes in `src/spells/hybrid/` only when it reads as two elements at once, like Fire Tornado; a blend that reads as one element, like Blizzard, goes under that element). Set `element` to the element's id and `order` to its place in that element's row. The registry in `src/spells/index.js` picks the file up by itself, so there's nothing to import. A brand-new element also needs a row in `ELEMENTS` there.
2. Fill in the module:
   - `params` / `ranges` become the GUI folder. Colours are `'#rrggbb'` strings. `presets` are named partial `params`.
   - `kinds` are particle behaviours, registered as `'<id>.<kind>'`. Every field is listed in `DEFAULTS` in `src/vfx/Particles.js`.
   - `shape` (`projectile | beam | strike | area | self`) and `timing` drive the phase clock in `src/spells/cast.js`: charge, release, travel, impact, linger, done.
   - `create(fx)` runs once at load. It allocates everything and returns `{ phase(c, name), update(c, dt) }`, plus an optional `tick(dt)` that runs every frame.
3. Everything a spell can touch is on the `fx` object built in `src/main.js`:
   - particles, trails, bolts, volumes, shocks, spikes, sigils, metaballs
   - the ground field, spell lights, forces, impacts and capsule occluders
   - the dummies, the pool, the camera rig, and the flash
   
   `src/spells/lightning.js` and `src/spells/fire.js` are complete examples.

## Rules that keep it fast

- **No allocation after `create()`.** Hot paths reuse module-level vectors. Pools hand out handles. Release every handle in the `'done'` phase.
- **No recompiles after load.** Never change a material's defines at runtime. Use uniforms. Hide idle meshes with `visible = false`; the warm-up pass forces them on once so every program compiles before the first cast. Check that `app.renderer.info.programs.length` is the same before and after casting each form.
- **Pick the right pass:**
  - `opaque`: lit solid geometry.
  - `refract`: geometry that reads the resolved scene colour and depth.
  - `lines`: full-res additive emission.
  - `fx`: half-res, order-independent translucency (`fxOut`). This is where smoke, flame, glow and distortion go.
- **Determinism:** use `fx.rand()` and the cast's `seed`, never `Math.random()`. `?shot=<id>&t=<s>` must give the same frame every time.
- **Accessibility:** flashes go through `fx.flash()` and shake goes through `fx.rig`. Both respect the "reduce flashes & shake" setting, which follows `prefers-reduced-motion` and keeps to WCAG 2.3.1 (at most 3 flashes per second).

## Budget

The whole frame, at the peak of a single cast, must stay at or under 3 ms on an RTX 3060-class GPU at High and 3.3 MP (`?mp=3.3`). The idle arena takes about 1.4 ms of that, so a spell has roughly 1.6 ms. A spell may go up to 4.5 ms only for a large visual gain, and the PR has to show the gain (before and after shots). Most of a spell's cost lands in the half-res FX pass, so aim for about 0.9 ms there. `PLAN.md` section 4 has the per-pass budget.

To measure, run `await app.runBenchmark('<id>')` in the console on an otherwise idle GPU. It plays a whole cast back-to-back with every frame fenced to GPU completion. `worst` in the result is the slowest quarter second (the number the budget means), and the log lists each pass's mean and peak GPU time. Take the best of three runs, and compare against an existing spell measured the same way. `await app.benchAll()` does every spell in turn.

A phone pays for passes more than pixels. Check a new spell with `?mobile` as well, where it must not add a render pass that runs while the spell is idle.

## Pull requests

- One element or one fix per PR.
- Say what you measured: GPU, resolution, before and after.
- Include a screenshot or a short clip (the `screenshot` and `record video` buttons are in the GUI).
- Code adapted from elsewhere must be MIT-compatible and listed in `THIRD_PARTY_NOTICES.md`.
