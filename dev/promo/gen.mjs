// Builds shotplan.json, checks the owner's ordering rules and prints the timeline.
import fs from 'node:fs';

const EL = {
  'Glacial Spike': 'ice', 'Ice Wall': 'ice', 'Absolute Zero': 'ice', Blizzard: 'ice',
  Aegis: 'arcane', 'Arcane Barrage': 'arcane', Starfall: 'arcane',
  Portal: 'void', Singularity: 'void', Rift: 'void',
  'Toxic Bloom': 'acid', 'Corrosion Cloud': 'acid', 'Plague Swarm': 'acid',
  Tsunami: 'water', Geyser: 'water', 'Tidal Lance': 'water',
  Upheaval: 'earth', Meteor: 'earth', Fissure: 'earth', 'Lava Geyser': 'earth',
  'Wind Slash': 'wind', 'Dust Devils': 'wind', Cyclone: 'wind',
  Fireball: 'fire', Inferno: 'fire', Phoenix: 'fire', 'Ember Swarm': 'fire',
  'Black Flame': 'hybrid', 'Fire Tornado': 'hybrid', 'Frozen Lightning': 'hybrid',
  Judgment: 'light', 'Radiant Lance': 'light', 'Aurora Veil': 'light', 'Solar Flare': 'light', Supernova: 'light',
  Thunderstorm: 'lightning', Thunderstrike: 'lightning', 'Chain Arc': 'lightning', 'Ball Lightning': 'lightning',
};

const c = (spell, o) => ({ spell, dummy: 0, ...o });
const clips = [
  // --- openers (fixed order), dusk ---
  c('Glacial Spike', { cam: [-6.5, 1.2, 5.0, 0, 1.4, 3.6], cam2: [-5.6, 1.15, 4.7, 0, 1.4, 3.6], move: 3.8, record: 4.8, in: 0.6, out: 4.4, transition: 'cut',
    note: 'Tested (shot 50, t1.5). Side-on and front-lit. The spike streaks in from frame right at ~0.95 and the crystal ring erupts at ~1.25. The orb stays off-frame. The title card holds this clip\'s first frame.' }),
  c('Aegis', { cam: [3.0, 1.3, -2.0, -0.2, 1.2, 4.5], cam2: [2.6, 1.25, -1.4, -0.3, 1.2, 4.5], move: 4.1,
    follow: [{ spell: 'arcane', form: 'Arcane Barrage', delay: 1.3 }, { spell: 'arcane', form: 'Arcane Barrage', delay: 1.0 }],
    record: 4.8, in: 0.3, out: 4.4, transition: 'cut',
    note: 'Tested (shot 04, t2.2). Reverse angle: the shield fills the right half and the orb sits small at the left third. The volleys fly at the lens and hit at ~2.3 and ~3.3. Follow delays count from the previous cast, as in REEL_FOLLOW.' }),
  c('Portal', { cam: [1.8, 3.0, 16.5, 0.3, 1.4, 4.5], cam2: [3.6, 2.8, 15.8, 0.5, 1.4, 4.0], move: 4.8, record: 5.6, in: 0.4, out: 5.2, transition: 'cut',
    note: 'Tested start (shot 05, t2.4). Seen from behind the caster: portal A sits in front of the orb and B lies beyond it. B opens on the camera\'s +x side because the camera x is positive at cast time. A slow dolly right separates the two rings. On cam2 the nearest pillar is 46 deg off-axis.' }),
  c('Toxic Bloom', { cam: [-4.4, 1.3, 5.2, 0.3, 0.5, 1.4], cam2: [-3.8, 1.15, 4.7, 0.3, 0.5, 1.4], move: 4.2, record: 5.6, in: 1.0, out: 5.2, transition: 'cut',
    note: 'Shot 06 orbited 9 deg round the dummy at the same 5.4 m, which pushes dummy 1 out of the left edge (44 deg off-axis). The blob lands ~1.6, then the pool, froth and dissolving dummy.' }),
  // --- act 1: golden hour ---
  c('Tsunami', { cam: [4.4, 3.2, 11.9, 2.4, 2.8, 0.4], cam2: [5.0, 2.4, 10.7, 2.0, 2.6, 0.5], move: 2.7, record: 3.9, in: 0.8, out: 3.5, speed: 0.6, transition: 'cut',
    note: 'End pose tested (shot 10, t2.3: the hero barrel). The start pose is inside the pillar ring because shot 11, from outside, was blocked; pillar (5.36,12.93) stays behind the lens. Plays at 0.6x through the swell, the plunge and the crash (~2.6-2.8), so 4.5 s on screen. Cut on the foam bore, before the water reaches the lens.' }),
  c('Upheaval', { cam: [2.2, 0.8, -2.2, 0, 1.2, 6], record: 4.2, in: 0.3, out: 3.8, transition: 'cut',
    note: 'Tested (shot 34, t1.6). Low reverse: spikes erupt toward the lens and debris flies at camera. Static.' }),
  c('Wind Slash', { cam: [-3.0, 0.55, 5.5, 0.6, 0.8, 1.2], record: 3.8, in: 0.15, out: 3.45, transition: 'cut',
    note: 'Shot 41 (t1.45) with the aim swung 5 deg right, which drops dummy 1 off the left edge (44 deg). The blade is invisible by design. It reads as a dust shear line entering frame right at ~0.6, a rooster tail at the dummy ~0.8, a floor cut and refraction fringes. Low and side-backlit so the dust glows.' }),
  c('Black Flame', { cam: [0.0, 0.9, 7.8, 0, 2.2, 2.0], record: 5.6, in: 1.0, out: 5.2, transition: 'cut',
    note: 'Shot 19 (t2.5) moved from x 2.2 to x 0. There a pillar sat directly behind the flame; on the -z axis the far pillars sit at +-14.5 deg, so the black silhouette stands on open sunset sky. The orb is behind the lens.' }),
  c('Fireball', { cam: [-4.5, 1.6, 7.0, 0, 1.4, 2.2], record: 4.8, in: 0.6, out: 4.4, transition: 'cut',
    note: 'Tested (shot 48, t1.45). The ball enters frame right ~1.0 and the blast fills centre frame ~1.25. Cut before the smoke pall builds.' }),
  c('Ice Wall', { cam: [3.5, 3.4, 10.5, -0.3, 1.2, 4.2], record: 4.7, in: 0.5, out: 4.3, transition: 'cut',
    note: 'Tested (shot 42, t2.2). High 3/4 from the caster side with the orb 82 deg off-axis. A frost line races out, then the staggered crystal row erupts at ~1.1, backlit gold through the ice.' }),
  c('Singularity', { cam: [-6.5, 1.5, 9.5, 0, 1.6, 5.5], cam2: [-6.5, 1.5, 9.5, 0, 1.4, 3.5], move: 4.2, record: 5.6, in: 1.1, out: 5.3, transition: 'cut',
    note: 'Tested (shot 31, t2.0: the lensed disk). The hole enters frame right ~1.3, drifting at 6 m/s. A pan follows it to the dummy for the collapse (~2.7-3.2) and the negative shell. The old cut had it for ~1 s at the frame edge.' }),
  c('Geyser', { cam: [3.5, 1.0, -3.5, 0, 2.4, 3.0], record: 4.8, in: 0.6, out: 4.4, transition: 'cut',
    note: 'Tested (shot 38, t2.0). The backlit try (shot 37) read as glass. Front-lit reverse instead: the orb dives in and the column erupts at ~1.05 with the orb small behind.' }),
  c('Judgment', { cam: [-7.5, 1.0, 9.5, 0, 4.0, 1.5], record: 5.4, in: 0.8, out: 5.0, transition: 'cut',
    note: 'Tested (shot 13, t2.4). Low angle up the shaft: cloud deck, sigil, molten floor.' }),
  c('Dust Devils', { dummy: 1, cam: [-6.5, 1.5, -10.5, -3.2, 1.8, -1.5], cam2: [-5.6, 1.4, -8.3, -3.2, 1.8, -1.5], move: 4.2, record: 5.8, in: 1.2, out: 5.4, transition: 'cut',
    note: 'Start tested (shot 21, t3.0, front-lit, a bit far). Pushes in on the same bearing to 72% distance; pillar (-5.36,-12.93) stays behind the lens. Three devils spin up and merge.' }),
  c('Absolute Zero', { cam: [-7.0, 1.3, 7.0, 0, 2.0, 1.0], record: 5.4, in: 1.0, out: 5.0, transition: 'cut',
    note: 'Tested (shot 18, t2.4). The 1.3 s charge is off-frame; the fog bell drops over a frosting dummy.' }),
  c('Fissure', { cam: [5.5, 4.5, 6.5, 0, 0, 1.0], record: 5.0, in: 0.6, out: 4.6, transition: 'cut',
    note: 'Tested (shot 36, t1.8). The high angle reads the crack as a line: the lava seam unzips to the dummy, the lips heave and sparks fly.' }),
  c('Starfall', { cam: [-6, 1.2, 11.5, 0, 4.5, 2], record: 5.4, in: 0.8, out: 5.0, transition: 'cut',
    note: 'Tested (shot 14, t2.4). Stays at dusk because the spell makes its own pocket of night. Wide enough that the vortex is not cropped, as it was in the old cut.' }),
  c('Tidal Lance', { cam: [7.0, 0.9, 5.5, 0, 1.4, 5.0], record: 4.3, in: 0.4, out: 3.9, transition: 'cut',
    note: 'Tested (shot 40, t1.4). Side-on at jet height with the sun raking from frame right: the jet is a bright sheet from frame left into the dummy, with a splash fan. The orb is off-frame left.' }),
  c('Meteor', { cam: [-10, 1.5, 7, 0, 3.0, 6.5], record: 4.9, in: 0.5, out: 4.5, transition: 'cut',
    note: 'Tested (shot 39, t2.6). The profile shows the whole lob. The boulder forms over the orb (frame right), its smoke trail draws the 5.9 m arc, and it lands frame left at ~2.45.' }),
  c('Corrosion Cloud', { cam: [2.5, 1.0, -4.0, -0.2, 0.8, 3.0], cam2: [1.8, 0.9, -2.4, -0.2, 0.8, 3.0], move: 4.2, record: 5.8, in: 1.2, out: 5.4, transition: 'cut',
    note: 'Start tested (shot 49, t3.5, a little small). Pushes to 5.5 m on the same bearing; dummy 1 stays 65 deg off-axis. Front-lit: the blob bursts ~1.6 and the gas slumps into a pale carpet.' }),
  c('Rift', { cam: [1.6, 1.7, 9.0, 0, 1.8, 3.0], record: 4.9, in: 0.5, out: 4.5, transition: 'cut',
    note: 'Tested (shot 43, t2.0). 15 deg off the tear\'s normal, so the jagged edge, the starry throat and the sheared sunset all read. It snaps shut with a shock before the out.' }),
  c('Blizzard', { cam: [6.5, 2.0, 9.5, 0, 1.5, 2], record: 5.6, in: 1.2, out: 5.2, transition: 'cut',
    note: 'Tested (shot 22, t3.0).' }),
  c('Inferno', { dummy: 1, cam: [-2.0, 1.0, -8.5, -3.5, 2.2, -1.0], cam2: [-2.3, 1.1, -6.6, -3.5, 2.2, -1.0], move: 4.0, record: 5.0, in: 0.6, out: 4.6, transition: 'cut',
    note: 'Start tested (shot 33, t1.8, dusk). Pushes to 75% distance on the same bearing: a fire column on glowing ground against blue sky.' }),
  c('Aurora Veil', { cam: [-11, 1.2, 9, 0, 5.5, -1], record: 6.2, in: 1.4, out: 5.8, transition: 'cut',
    note: 'Tested (shot 17, t3.2, dusk). The night version (shot 16) was a flat green wall. The camera sits in the pillar gap on the 135 deg diagonal.' }),
  c('Cyclone', { cam: [-6.5, 1.4, -2.5, 0, 3.4, 5.5], record: 5.4, in: 1.0, out: 5.0, transition: 'cut',
    note: 'Tested (shot 20, t2.8). A front-lit funnel touches down at (0,0,10) and walks toward the lens to its target, dummy 0, in the foreground. Cut by 5.0, while it is still ~7 m away; the old cut let it clip the camera.' }),
  c('Thunderstorm', { cam: [8.5, 1.6, 12.5, -1, 4.0, -1], record: 6.0, in: 1.0, out: 5.6, transition: 'dissolve 0.4',
    note: 'Tested (shot 12, t3.0). The hinge: the cloud deck darkens the sky and rain sheets fall, then dissolve to night.' }),
  // --- the lab: open source, tuned live (in/out/record in lab time; the lab starts recording 0.5 s early like a cast) ---
  c('Lava Geyser', { tod: 'night', cam: [11.5, 1.2, 11.5, 2.5, 5.6, -1.2], cam2: [10.3, 1.3, 10.3, 2.3, 5.4, -1.0], move: 8.8,
    lab: { note: 'Open-source lab · tune any spell live', length: 9.6, steps: [
      { at: 0.3, preset: 'hawaiian fountain' },
      { at: 0.7, over: 0.4, set: { duration: 9 } },
      { at: 1.2, cast: true },
      { at: 3.4, over: 1.2, set: { width: 0.65 } },
      { at: 5.0, over: 1.0, set: { temperature: 2300 } },
      { at: 6.4, over: 1.2, set: { tint: '#7fa6ff', temperature: 1750 } },
    ] },
    record: 9.6, in: 0.2, out: 9.0, transition: 'cut',
    note: 'Framed from shot 32 (night): 1.4 m further back on the same diagonal and aimed 4.6 deg right. The column sits at ~34% width, clear of the panel (right 77-98%, top 4-60%), and the 9.5 m fountain plus surge stays in frame. Pillars are 48 and 68 deg off-axis. The preset must come before the cast because it resets unlisted params, and duration is read once at the cast. The eruption starts ~2.6 and the panel leaves at 9.0, the out.' }),
  c('Thunderstrike', { tod: 'night', cam: [5.0, 1.0, 10.0, 2.1, 4.05, 1.06],
    lab: { note: 'Open-source lab · presets, colour, shape', length: 8.2, steps: [
      { at: 0.2, preset: 'violet' }, { at: 0.4, cast: true },
      { at: 1.9, over: 0.9, set: { jag: 0.2, glow: '#2affc8' } }, { at: 3.0, cast: true },
      { at: 5.3, preset: 'crimson' }, { at: 5.6, cast: true },
    ] },
    record: 8.2, in: 0.2, out: 7.6, transition: 'cut',
    note: 'Tested (shot 47: violet, 0.6 s after the cast). The bolt lands at 30-37% width and the panel area is empty sky. Casts are 2.6 s apart so each channel has cooled before the next strike: one bolt on screen at a time.' }),
  // --- act 2: night ---
  c('Phoenix', { tod: 'night', cam: [-3.5, 1.3, 8.5, 1.0, 2.6, 2.0], record: 5.6, in: 1.0, out: 5.2, transition: 'cut',
    note: 'Tested (shot 28, t2.9). The bird crosses high in frame, then stoops at the dummy with wings spread.' }),
  c('Plague Swarm', { tod: 'night', cam: [-6, 1.8, 9, 0, 2.5, 4], record: 6.2, in: 1.9, out: 5.9, transition: 'cut',
    note: 'Tested (shot 23, t3.6). The 2.0 s gather is off-frame; start as the swarm river pours in.' }),
  c('Chain Arc', { tod: 'night', cam: [7.5, 2.6, 8.5, 0.3, 1.2, -2.0], record: 4.0, in: 0.3, out: 3.6, transition: 'cut',
    note: 'Tested (shot 29, t1.3). A high 3/4 shows all three dummies so each jump reads. The return stroke blooms the frame white for a few frames: that is the flash, so keep it.' }),
  c('Solar Flare', { tod: 'night', cam: [-3.6, 1.2, 7.5, 0, 1.5, 5.0], cam2: [-3.6, 1.2, 7.5, 0, 1.8, 3.0], move: 4.1, record: 5.4, in: 0.9, out: 5.0, transition: 'cut',
    note: 'Tested (shot 44, t1.7). The sun fills centre frame in flight. The pan follows it left to the dummy for the burst, the loop arcade and the ribbons (~2.15 on).' }),
  c('Arcane Barrage', { tod: 'night', cam: [9.0, 2.0, 6.5, 0, 1.6, 6.5], record: 3.6, in: 0.0, out: 3.2, transition: 'cut',
    note: 'Tested (shot 45, t0.85). Side-on: eight weaving trails cross the frame from the sigil (left third, 10 m away, not dominant) to the dummy (right third).' }),
  c('Fire Tornado', { tod: 'night', dummy: 2, cam: [12, 1.0, 3.5, 3.5, 3.2, -6], record: 5.6, in: 1.0, out: 5.2, transition: 'cut',
    note: 'Tested (shot 25, t2.4). Targeting dummy 2 puts the helix on the far side of the arena; the camera stands on the pool rim.' }),
  c('Ball Lightning', { tod: 'night', cam: [2.8, 1.0, -1.8, -0.2, 1.4, 5.0], record: 6.2, in: 1.8, out: 5.8, transition: 'cut',
    note: 'Tested (shot 30, t3.95). The ball crawls straight at the lens at 3.6 m/s and detonates on the dummy at ~3.7.' }),
  c('Ember Swarm', { tod: 'night', cam: [6.5, 2.6, 10.5, 0, 2.4, 3], record: 6.8, in: 2.4, out: 6.6, transition: 'cut',
    note: 'Tested (shot 24, t4.2). The 2.6 s gather is off-frame; start as the ribbon enters.' }),
  c('Radiant Lance', { tod: 'night', cam: [-7.5, 1.4, 7.5, 0, 1.4, 6.8], record: 5.2, in: 1.0, out: 4.8, transition: 'cut',
    note: 'Tested (shot 27, t2.2). The beam spans the frame side-on; the old shoulder angle looked down it end-on, so it vanished.' }),
  c('Frozen Lightning', { tod: 'night', cam: [-8.5, 2.8, 8.5, 0, 1.8, 7.0], record: 4.7, in: 0.5, out: 4.3, transition: 'dip 0.4',
    note: 'Tested (shot 46, t2.3). The whole orb-to-dummy lattice is in frame: strike 0.8, freeze ~1.0-1.7, hold, shatter from ~2.7. Dip to black after the shatter as a breath before the finale.' }),
  c('Supernova', { tod: 'night', cam: [4.6, 1.6, 6.6, 0, 2.9, 2], cam2: [8.0, 1.1, 11.0, 0, 3.4, 2], move: 7.5, record: 8.0, in: 0.0, out: 7.5, transition: 'dip 0.8',
    note: 'Tested at the mid pose (6.5,1.2,9.0): shot 08 at t2.55 (dome, ring, white-hot core) and shot 09 at t3.9 (fireball and pulsar beam). Start and end lie on the same bearing from the star at ~0.7x and ~1.25x, so the pull-back crosses the tested frame at the bang (~2.35-2.6). Night only: at dusk it was tan soot on a tan sky (shot 07). Dip to black into the end card.' }),
];

// --- director's review of the first cut (clip numbers 1-based). Each fix overrides the clip above and says why. ---
// Note: setView goes through OrbitControls (maxPolarAngle 0.495 pi), so a camera below its target is lifted to
// ~target height. Every tested frame already includes that, so the poses below were judged by test shot, not by maths.
const review = {
  1: { out: 3.8, why: 'Static from ~2.5: frozen dummy in a finished ring.' },
  3: { cam2: [2.9, 2.9, 16.1, 0.4, 1.4, 4.3], move: 4.0, out: 4.4, why: 'cam2 dollied pillar (5.36,12.93) in from the right edge at ~3.8 (its 10 deg width was missed) and the tail idled. Shorter dolly; the pillar edge stays at 41 deg.' },
  5: { out: 3.0, move: 2.2, why: 'After the crash (~2.9) it is a beige mist wash. Cut on the foam.' },
  7: { cam: [-6.0, 0.45, 6.5, 0, 0.9, 4.5], speed: 0.4, in: 0.3, out: 1.7, record: 2.1, why: 'The blade never read: only a dust puff at 0.8. Profile at 0.4x (shot 51): the refraction arc crosses right to left into the dummy.' },
  9: { in: 0.9, out: 2.4, speed: 0.5, record: 2.8, why: 'The ball was on screen ~0.3 s, then 2 s of smoke column. 0.5x on flight and blast.' },
  10: { in: 0.9, speed: 0.7, out: 3.4, record: 3.8, why: 'Empty frame to ~0.9, static row from ~2.5. 0.7x on the eruption.' },
  11: { out: 4.0, speed: 0.75, move: 2.9, record: 4.4, why: 'Empty arena by ~4.0. 0.75x on the lensed disk and the collapse.' },
  12: { speed: 0.7, out: 3.3, record: 3.7, why: 'The column was down by 3.3, then a puddle. 0.7x on the eruption.' },
  13: { out: 4.4, why: 'Static scorch circle after ~3.5.' },
  14: { cam2: [-5.2, 1.3, -7.0, -3.2, 2.1, -1.5], why: 'The devils stayed small mid-frame. Push to ~55% distance on the same bearing.' },
  16: { out: 4.2, why: 'Static seam after ~3.5.' },
  17: { dummy: 2, cam: [-9.0, 1.2, 9.0, 3.5, 6.8, -6.0], why: 'The 6.4 m canopy was cropped by the top edge throughout. Aimed at dummy 2 from ~20 m, the vortex, the rain and the sigil all fit (shot 52).' },
  18: { cam: [7.0, 0.5, 5.5, 0, 1.3, 3.8], why: 'The jet was a thin flat sheet. Lower, it is a crest against the sky with the splash on the dummy (shot 53).' },
  20: { cam2: undefined, move: undefined, out: 4.4, why: 'The push carried the lens into the gas: by 4.8 a soft green wall. Static, out before it spreads to the lens.' },
  22: { cam: [4.5, 1.2, 7.0, 0, 1.6, 2.0], in: 0.6, out: 4.6, record: 5.0, why: 'From 8 m it was a grey wash. At 5 m the dummy silhouette and the streaks give it scale, and it opens clear so the storm rolls in (shot 54).' },
  25: { out: 4.2, why: 'From ~3.5 the funnel top crops and it closes on the lens.' },
  27: { cam: [1.0, 6.2, -16.0, -4.2, 5.9, 2.0], cam2: [0.7, 6.2, -14.9, -4.2, 5.9, 2.0],
    lab: { note: 'Open-source lab · tune live', length: 9.6, steps: [
      { at: 0.3, preset: 'hawaiian fountain' },
      { at: 0.7, over: 0.4, set: { duration: 9 } },
      { at: 1.2, cast: true },
      { at: 3.4, over: 1.2, set: { width: 0.65 } },
      { at: 5.0, over: 1.0, set: { temperature: 2300 } },
      { at: 6.4, over: 1.2, set: { tint: '#2a6bff', temperature: 2600 } },
    ] },
    why: 'The vent was cut by the bottom edge and #7fa6ff at 1750 K stayed orange. From the south pillar gap the vent and the ~13 m top both fit, the column at 36% width (shot 56); #2a6bff at 2600 K reads ice-blue. Sign-off: caption shortened, the column glow swallowed "LIVE".' },
  28: { lab: { note: 'Open-source lab · presets, colour, shape', length: 7.6, steps: [
      { at: 0.2, preset: 'violet' }, { at: 0.4, cast: true },
      { at: 1.9, over: 0.6, set: { jag: 0.2, glow: '#2affc8' } }, { at: 2.6, cast: true },
      { at: 4.5, preset: 'crimson' }, { at: 4.8, cast: true },
    ] }, record: 7.6, in: 0.4, out: 7.0, why: '1.1-1.3 s of dark sky between strikes. Casts 2.2 s apart: each bolt lands ~1.1 s after its cast and has gone ~1.4 s later, so still one at a time.' },
  29: { in: 1.5, out: 4.6, speed: 0.7, record: 5.0, why: 'Dark empty frame until the wing enters at ~1.6. 0.7x on the stoop.' },
  31: { in: 0.45, out: 1.9, speed: 0.4, record: 2.3, why: 'The jumps last ~1 s, then 1.7 s of dark. 0.4x on the three jumps.' },
  33: { in: 0.4, out: 2.0, speed: 0.5, record: 2.4, why: 'The trails cross in ~1 s, then 1.2 s of idle sigil. 0.5x.' },
  37: { in: 0.3, out: 3.0, why: 'The beam runs ~0.4-2.7: the old in missed its start and the last 2 s were idle.' },
};
for (const [n, { why, ...fix }] of Object.entries(review)) {
  const x = clips[n - 1];
  Object.assign(x, fix);
  x.note = `REVIEW: ${why} | ${x.note}`;
}

// --- owner: "a bit too zoomed in". Dolly back along each shot's own line: cam (and cam2) go k times further from
// their target, keeping bearing and character; dy raises target and camera together to fit tall spells.
const wide = {
  2: { k: 1.15 }, 4: { k: 1.15 }, 6: { k: 1.25 }, 8: { k: 1.3, dy: 0.4 }, 9: { k: 1.25, dy: 0.3 },
  10: { k: 1.2 }, 11: { k: 1.15 }, 12: { k: 1.25, dy: 0.6 }, 14: { k: 1.15 }, 15: { k: 1.25 }, 16: { k: 1.45 },
  19: { k: 1.15 }, 20: { k: 1.15 }, 23: { k: 1.4, dy: 0.3 }, 24: { k: 1.1, dy: 0.8 }, 25: { k: 1.45, dy: 0.3 }, 27: { k: 1.08 },
  29: { k: 1.3 }, 30: { k: 1.25 }, 31: { k: 1.15 }, 32: { k: 1.4 }, 34: { k: 1, dy: 1.0 },
  35: { k: 1.4 }, 36: { k: 1.25 }, 37: { k: 1.15 }, 38: { k: 1.15 }, 39: { k: 1.1 },
};
const r2 = (v) => Math.round(v * 100) / 100;
const pullBack = (p, k, dy) => {
  const t = p.slice(3), up = [0, dy, 0];
  return [...[0, 1, 2].map((i) => r2(t[i] + (p[i] - t[i]) * k + up[i])), ...t.map((v, i) => r2(v + up[i]))];
};
for (const [n, { k, dy = 0 }] of Object.entries(wide)) {
  const x = clips[n - 1];
  x.cam = pullBack(x.cam, k, dy);
  if (x.cam2) x.cam2 = pullBack(x.cam2, k, dy);
  x.note = `WIDER: x${k} from target${dy ? `, both up ${dy} m` : ''} (owner: too zoomed in) | ${x.note}`;
}

// --- geometry warnings for every pose as rendered (OrbitControls lifts a camera below its target to ~its height) ---
const PILLARS = Array.from({ length: 8 }, (_, i) => [14 * Math.cos((i + 0.5) * Math.PI / 4), 14 * Math.sin((i + 0.5) * Math.PI / 4)]);
const warn = [];
clips.forEach((x, i) => {
  for (const [tag, p] of [['cam', x.cam], ['cam2', x.cam2]]) {
    if (!p) continue;
    const d = [p[0] - p[3], p[1] - p[4], p[2] - p[5]], r = Math.hypot(...d), maxPhi = Math.PI * 0.495;
    let phi = Math.acos(d[1] / r); const h = Math.hypot(d[0], d[2]);
    phi = Math.min(phi, maxPhi);
    const c = [p[3] + d[0] / h * r * Math.sin(phi), p[4] + r * Math.cos(phi), p[5] + d[2] / h * r * Math.sin(phi)];
    if (Math.hypot(c[0], c[2]) > 17.3) warn.push(`${i + 1} ${tag} at rim (r ${Math.hypot(c[0], c[2]).toFixed(1)})`);
    const fx = -d[0] / h, fz = -d[2] / h;
    for (const [px, pz] of PILLARS) {
      const rx = px - c[0], rz = pz - c[2], fwd = rx * fx + rz * fz, lat = rx * -fz + rz * fx, dist = Math.hypot(rx, rz);
      const off = Math.atan2(Math.abs(lat), fwd) * 180 / Math.PI - Math.atan2(0.82, dist) * 180 / Math.PI;
      if (dist < 1.2) warn.push(`${i + 1} ${tag} inside pillar`);
      else if (off < 39.6 && dist < 7) warn.push(`${i + 1} ${tag} pillar ${dist.toFixed(1)} m in frame (${off.toFixed(0)} deg)`);
    }
  }
});
console.log(warn.length ? `GEOMETRY: ${warn.join('; ')}` : 'geometry ok');


const plan = {
  titleCard: { text: 'ULTRA ELEMENTS\n39 real-time spells · three.js + WebGL2', seconds: 2.0 },
  endCard: { text: 'ULTRA ELEMENTS\n39 real-time spells · runs in your browser\nOpen source · every spell tunable', seconds: 5.0 },
  clips,
};

// --- checks ---
const names = clips.map((x) => x.spell);
const err = [];
if (names.length !== 39 || new Set(names).size !== 39) err.push(`clips ${names.length}, unique ${new Set(names).size}`);
for (const n of Object.keys(EL)) if (!names.includes(n)) err.push(`missing ${n}`);
if (names.slice(0, 4).join() !== 'Glacial Spike,Aegis,Portal,Toxic Bloom') err.push('openers');
if (names.at(-1) !== 'Supernova') err.push('finale');
for (let i = 1; i < names.length; i++) if (EL[names[i]] === EL[names[i - 1]]) err.push(`repeat ${names[i - 1]} -> ${names[i]}`);
for (const x of clips) {
  if (!(x.out > x.in)) err.push(`in/out ${x.spell}`);
  if (x.record < x.out) err.push(`record < out ${x.spell}`);
  for (const s of x.lab?.steps ?? []) if ('over' in s && !(s.over > 0)) err.push(`over ${x.spell}`);
}

// --- timeline (transition = how this clip leaves; a dissolve overlaps, a dip does not) ---
let t = plan.titleCard.seconds, sum = 0, overlap = 0;
const tc = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const rows = [];
clips.forEach((x, i) => {
  const d = +((x.out - x.in) / (x.speed ?? 1)).toFixed(2);
  rows.push(`${String(i + 1).padStart(2)} ${tc(t).padStart(6)} ${d.toFixed(1).padStart(4)}s  ${(x.tod ?? 'dusk').padEnd(5)} ${EL[x.spell].padEnd(9)} ${x.spell}${x.lab ? ' [LAB]' : ''}${x.speed ? ` @${x.speed}x` : ''}  -> ${x.transition}`);
  sum += d;
  const ov = /^dissolve ([\d.]+)/.exec(x.transition);
  if (ov) overlap += +ov[1];
  t += d - (ov ? +ov[1] : 0);
});
const total = plan.titleCard.seconds + sum + plan.endCard.seconds - overlap;
console.log(rows.join('\n'));
console.log(`end card at ${tc(t)}; clips ${sum.toFixed(1)} s + cards ${plan.titleCard.seconds + plan.endCard.seconds} s - dissolve overlap ${overlap} s = ${total.toFixed(1)} s (${tc(total)})`);
console.log(err.length ? `ERRORS: ${err.join('; ')}` : 'checks ok');
fs.writeFileSync(new URL('./shotplan.json', import.meta.url), JSON.stringify(plan, null, 2) + '\n');
