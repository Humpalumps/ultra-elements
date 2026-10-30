# Spellbook

The catalogue of spell ideas. Each element has its two founding forms (in `src/spells/<element>.js`) and eight more ideas, and twenty hybrids blend elements. Thirty-nine of them ship (the launch set below); the rest is the backlog.

New spells live in `src/spells/<element>/<id>.js` (hybrids in `src/spells/hybrid/`). Every spell is judged on three things:

1. **Silhouette:** recognisable in one frame, in a thumbnail.
2. **Timeline:** anticipation, release, impact, aftermath. Never just "appear, fade".
3. **World response:** ground field, lights, forces, dummies and pool, so it lands *in* the arena.

The systems column names the shared systems each spell is expected to lean on.

## The 39 (launch set)

The first release ships 39 spells: the 20 founding forms plus 19 of the 20 below. Sandstorm was built but shelved (`dev/shelved/`) because it wasn't at the bar. One hero spell joins each element, which makes three per element, and the ten most cinematic hybrids join them. Everything else in this book is the backlog for later waves.

| Element | Hero spell | Hybrids |
|---|---|---|
| Lightning | `ball-lightning` | `frozen-lightning` |
| Fire | `phoenix` | `fire-tornado` |
| Water | `tsunami` | `thunderstorm` |
| Ice | `absolute-zero` | `blizzard` |
| Earth | `fissure` | `lava-geyser` |
| Wind | `dust-devils` | `sandstorm` (shelved) |
| Void | `portal` | `black-flame` |
| Light | `solar-flare` | `supernova` |
| Acid | `plague-swarm` | `ember-swarm` |
| Arcane | `starfall` | `aurora-veil` |

Each row was built as one unit: the hero spell first, then its paired hybrid.

In the app a spell is filed under Hybrid only when it reads as two elements at once: Fire Tornado, Frozen Lightning and Black Flame. The other six blends sit under the element they read as, in `src/spells/<element>/`: Thunderstorm under Lightning, Ember Swarm under Fire, Blizzard under Ice, Lava Geyser under Earth, and Aurora Veil and Supernova under Light.

## Lightning (founding: Thunderstrike, Chain Arc)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `ball-lightning` | Ball Lightning | projectile (slow, wandering) | A crackling plasma sphere drifts and wobbles. It throws short arcs to nearby surfaces and dummies, then destabilises and detonates in a branching flash. | bolts (snap arcs), volume or glow core, lights, sparks, Lichtenberg splat |
| `lightning-storm` | Lightning Storm | area | A dark cloud cap boils over the target. Over 4 s, 8–12 strikes land at random points in a radius, each with thunder delay, scorch and sparks. | media cloud, bolts, line lights, ground glow and char, shake |
| `static-field` | Static Field | area | A disc of floor arcs crawls and pops for 5 s. Arcs jump to anything inside, and dummies jitter with shock. Wet ground spreads it further. | snapped bolts, ground glow, dummies.shock, groundAt wet |
| `railgun` | Railgun | strike (instant line) | A brief charge whine of converging motes, then a perfectly straight ionised channel. Shock rings bead along its length and it leaves an afterimage glow. | bolts (jag 0), shocks along the line, line light, trail afterglow |
| `tesla-coil` | Tesla Coil | area (summon) | A coil pylon rises from the floor (a rock spike with copper rings) and arcs to the nearest dummy every 0.4 s for 5 s. | spikes, bolts, lights, sparks |
| `storm-spear` | Storm Spear | projectile | A thrown javelin of compressed lightning with a crackling trail. It pins into the ground, hums, then erupts in a radial Lichtenberg burst. | trails, bolts, ground Lichtenberg, shocks |
| `overload` | Overload | self | The caster's orb overcharges, with arcs crawling up the pedestal, then releases a nova of 16 radial bolts across the floor. | bolts radial, ground glow ring, flash, shake |
| `plasma-whip` | Plasma Whip | beam (held) | A lashing whip of white-violet plasma that cracks and snaps between the focus and the target. It sheds sparks at each crack. | bolts (animated path), trails, sparks, line light |

## Fire (founding: Fireball, Inferno)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `meteor-swarm` | Meteor Swarm | area | Six flaming meteors streak in from the sky at an angle. Each leaves a smoke trail and blasts a crater with debris and fire. | volumes (small), trails, debris, explosion bursts, scorch |
| `flamethrower` | Flamethrower | beam (held) | A roaring cone of licking flame with heat haze, embers bouncing off the floor, and a scorched, burning path. | media flame stream, distortion haze, ember paint, field flames |
| `phoenix` | Phoenix | projectile (arcing) | A firebird of flame ribbons and feathers sweeps in, wings beating, and dives into the target in a feather-burst explosion. | analytic ribbons (wings), media flames, glow feathers, explosion |
| `fire-wall` | Fire Wall | area (line) | A line of fire erupts across the floor between the caster and the target, a curtain of roaring flame with smoke rising. | ground heat line, field emitters, media, light line |
| `napalm` | Napalm | projectile (lobbed) | A sticky burning blob splashes on impact into clinging fire puddles that burn for 8 s. | metaball (tinted) or volume, splash droplets painting heat, field flames |
| `pyroclasm` | Pyroclasm | self | The caster erupts: an expanding ring of fire rolls outward across the floor, with a pressure wave and a smoke torus. | shocks ground ring, media ring, heat ring splat |
| `dragons-breath` | Dragon's Breath | beam | A huge, wide, billowing fire blast with turbulent pyroclastic flame and thick black smoke rolling up and away. | volumes and media, distortion, huge light |
| `hellfire-rain` | Hellfire Rain | area | Burning droplets fall from a red-lit sky in streaks for 3 s, spattering fire on impact. | glow streak rain, morph to splash, heat paint, field flames |

## Water (founding: Tidal Lance, Geyser)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `tsunami` | Tsunami | area (wave) | A curling wall of water rises behind the target and sweeps across, foam cresting, and drenches everything in its path. | own wave mesh (refract), spray, mist, wet splats |
| `water-prison` | Water Prison | area | A sphere of churning water forms around a dummy, with bubbles inside, then bursts in a splash. | metaballs, bubbles, splash crown |
| `rain-storm` | Rain Storm | area | Rain streaks from a cloud. Puddles form and ripple, and mist hangs low. | glow streaks, ripple rings, wet splats, cloud media |
| `whirlpool` | Whirlpool | area | A spinning vortex in the pool, or a summoned disc of water on the floor, spiralling with foam. It pulls particles in. | vortex force, pool swirl, foam particles |
| `water-blades` | Water Blades | projectile (volley) | Three spinning crescents of water slice forward and shatter into spray. | small metaball arcs or own mesh, spray, wet |
| `bubble-barrage` | Bubble Barrage | projectile (volley) | Dozens of iridescent bubbles drift, wobble and pop in tiny splashes. | thin-film impostors, splash |
| `hydro-cannon` | Hydro Cannon | beam (held) | A pressurised jet with a dense core, a spray sheath and a mist plume, which knocks dummies back. | metaballs chain, spray, push force |
| `mist-veil` | Mist Veil | area | A low rolling fog bank, softly lit and drifting, that soaks the floor. | heavy media, wet splat |

## Ice (founding: Glacial Spike, Ice Wall)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `frost-breath` | Frost Breath | beam (held) | A cone of freezing mist and ice crystals that frosts the floor in a fan and freezes dummies. | media cold mist, glints, frost splats |
| `ice-lances` | Ice Lances | projectile (volley) | Five refractive shards fire in a fan, each shattering into chips and frost. | ice shard mesh (refract), debris shards |
| `absolute-zero` | Absolute Zero | area | A dome of frozen air descends. The world inside desaturates, frost crawls everywhere, and it shatters. | volume dome, frost potential, inversion-like tint, shard burst |
| `hailstorm` | Hailstorm | area | Hailstones pelt the area, bouncing and stacking, with a cold mist. | debris shards, mist, frost |
| `crystal-prison` | Crystal Prison | area | Ice crystals grow around a dummy into a jagged cocoon, then shatter. | spikes ice (radial, short), frozen status |
| `frozen-orb` | Frozen Orb | projectile (slow) | A rotating orb that sprays shards in a spiral as it travels, then bursts in a nova. | refract orb, glow shards, frost |
| `ice-comet` | Ice Comet | projectile (from the sky) | A huge ice comet with a vapour tail crashes in an icy explosion with frost shockwaves. | refract mesh, trails, shocks, frost |
| `shatter` | Shatter | area | A ring of ice spikes erupts and immediately explodes into thousands of shards. | spikes ice, debris shards burst |

## Earth (founding: Upheaval, Meteor)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `fissure` | Fissure | area (line) | The ground splits along a line, magma glowing in the crack, with steam and debris spitting. | crack line, magma heat, debris, smoke |
| `stone-fist` | Stone Fist | area | A giant rock fist bursts up from the floor under the target in an uppercut, then crumbles. | own rock mesh (opaque), debris, dust |
| `boulder-roll` | Boulder Roll | projectile (rolling) | A massive boulder rolls along the ground, crushing, with a dust trail and cracks behind it. | rock mesh, dust, crack trail |
| `earthquake` | Earthquake | area | Violent shaking, cracks racing out, debris jumping, pillars shedding dust. | shake, crack potential, debris, dust |
| `rock-barrage` | Rock Barrage | projectile (volley) | Stones tear out of the floor around the caster, hover, and fire one by one. | debris, dust, small impacts |
| `stone-wall` | Stone Wall | area | A wall of rock slabs grinds up, blocking particles, then collapses later. | spikes (slab-like), occluders, dust |
| `quicksand` | Quicksand | area | A swirling sand vortex on the floor that sucks debris and particles down. | vortex force (downward), dust, crack |
| `crystal-spires` | Crystal Spires | area | Glowing amethyst geode crystals erupt in a cluster, refractive and lit from within. | spikes (ice material, tinted), lights |

## Wind (founding: Cyclone, Wind Slash)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `gust-wall` | Gust Wall | area | A sweeping wall of wind with visible streaks and dust that pushes everything away. | push force, streaks, dust |
| `air-blast` | Air Blast | projectile | A cannon shot of compressed air, a visible distortion sphere, with a shockwave burst. | distortion sprites, shocks, push |
| `vacuum-sphere` | Vacuum Sphere | area | An implosion: everything rushes in, then a pop. | attractor force, then shock |
| `wind-blades` | Wind Blades | projectile (volley) | A barrage of thin crescent blades with distortion trails that leave scratch marks. | ribbons, distortion, crack lines |
| `updraft` | Updraft | area | A rising column that lifts dust, leaves and particles high. | vortex with strong updraft, debris leaves |
| `downburst` | Downburst | area | A slam of air from above flattens everything, with a radial dust ring. | push down, dust ring, shake |
| `dust-devils` | Dust Devils | area | Three small twisters wander about, kicking up dust. | 3 small vortex forces, dust, helix ribbons |
| `feather-storm` | Feather Storm | area | A swirl of glowing feathers spirals around the target. | debris leaves (feather tint), vortex |

## Void (founding: Singularity, Rift)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `void-beam` | Void Beam | beam (held) | A beam of anti-light that darkens what it passes, with a violet rim and motes sucked into it. | absorbing media, ribbons, attractor |
| `gravity-well` | Gravity Well | area | A visible distortion well on the floor that pulls in every particle and spirals it down. | attractor and orbit forces, lens (small), distortion |
| `dark-orbs` | Dark Orbs | projectile (orbiting) | Three black orbs orbit the target, then converge and detonate. | lens (small) or black spheres, trails, implosion |
| `shadow-tendrils` | Shadow Tendrils | area | Black tendrils whip up out of the floor and grab at the dummies. | trails or ribbons (dark), corruption |
| `null-field` | Null Field | area | A dome that drains colour and light from the world inside it. | own dome (fx), absorbing media |
| `portal` | Portal | area | Two linked portals open, and particles that enter one leave the other. | sigils void, distortion |
| `antimatter-bolt` | Antimatter Bolt | projectile | A white-cored bolt with a black halo that annihilates on impact in an inverted flash. | trails, invert shell, shocks |
| `void-eruption` | Void Eruption | area | Purple-black energy geysers out of the floor in columns. | media absorbing, glow motes, corruption |

## Light (founding: Judgment, Radiant Lance)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `halo-nova` | Halo Nova | self | A ring of golden light expands from the caster, with motes and a holy sigil. | sigils, ring splat, shocks emissive |
| `prism-burst` | Prism Burst | area | A crystal prism splits a beam into rainbow rays that sweep the arena. | own prism (refract), line ribbons coloured |
| `sunbeam` | Sunbeam | area | The clouds part and a focused shaft of sunlight burns down, with god rays and heat. | volume cylinder, heat splat |
| `spears-of-light` | Spears of Light | area | Spears of light rain down and pin into the floor around the target. | glow streaks, small sigils, glow splats |
| `angel-wings` | Angel Wings | self | Luminous wings unfold from the caster, shedding feathers. | analytic ribbons, glow feathers |
| `sanctuary` | Sanctuary | area | A dome of soft holy light with drifting motes that heals (glow) the floor. | dome (fx), sigil, motes |
| `lightbringer` | Lightbringer | projectile (volley) | Golden blades of light spin out and slice. | ribbons, glow, holy impacts |
| `solar-flare` | Solar Flare | projectile | A miniature sun that pulses and erupts in a flare loop. | volume (emissive), ribbons loop, flash |

## Acid (founding: Toxic Bloom, Corrosion Cloud)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `acid-spit` | Acid Spit | projectile (volley) | Rapid gobs of glowing acid that splash and sizzle. | metaballs small, drips, acid splats |
| `plague-swarm` | Plague Swarm | area | A swarm of glowing insects (boids-like motes) buzzes around and envelops the target. | glow motes with orbit and curl, small sizzle |
| `sludge-wave` | Sludge Wave | area | A thick wave of green sludge rolls across the floor. | metaball or own mesh, acid splats |
| `venom-spines` | Venom Spines | area | Toxic spines erupt from the floor, dripping venom. | spikes (tinted), drips |
| `caustic-geyser` | Caustic Geyser | area | A geyser of acid bursts upward and rains back down. | metaballs column, drips, fog |
| `bile-bomb` | Bile Bomb | projectile (lobbed) | A bloated sac that bursts into a toxic explosion. | metaballs, fog burst, splats |
| `melt-beam` | Melt Beam | beam (held) | A green beam that melts the floor, with bubbling, smoking slag. | ribbons or line, acid and heat paint, fog |
| `toxic-mire` | Toxic Mire | area | A bubbling swamp patch that slows and dissolves. | acid field, bubbles, fog |

## Arcane (founding: Arcane Barrage, Aegis)

| id | Spell | Shape | Concept | Systems |
|---|---|---|---|---|
| `arcane-orb` | Arcane Orb | projectile (slow) | A slow pulsing orb ringed with runes that fires sparks at nearby targets. | glow core, sigils small, trails |
| `rune-prison` | Rune Prison | area | Rotating rune rings lock around a dummy, constrict, and flash. | sigils (vertical rings), glow |
| `mana-storm` | Mana Storm | area | A vortex of magenta energy streams and motes, with lightning-like arcs. | vortex, ribbons, bolts tinted |
| `arcane-explosion` | Arcane Explosion | self | A crisp geometric nova of hex shards and rings. | shocks, glow shards, sigils |
| `blink` | Blink | self or target | A teleport, with an implode-flash at the start and an explode-flash at the end. | inversion shell, motes, distortion |
| `spellblades` | Spellblades | projectile (volley) | Glowing glyph swords materialise in a fan and stab down. | own blade sprites, trails, sigils |
| `starfall` | Starfall | area | Stars streak down from a night-like sky into sparkle impacts. | glow streaks, sparkle bursts |
| `time-warp` | Time Warp | area | A bubble in which particles slow down, with a clock-face sigil and a chromatic shimmer. | drag force, sigils, distortion |

## Hybrids

| id | Spell | Elements | Concept |
|---|---|---|---|
| `fire-tornado` | Fire Tornado | fire + wind | A roaring vortex of flame, embers spiralling up, a scorched spiral on the floor. |
| `thunderstorm` | Thunderstorm | wind + lightning + water | A rotating storm cell with rain, wind and repeated strikes. |
| `blizzard` | Blizzard | wind + ice | A swirling snowstorm that freezes the area and dummies over time. |
| `sandstorm` | Sandstorm | wind + earth | A wall of rolling sand and debris that darkens the arena. |
| `steam-eruption` | Steam Eruption | fire + water | Superheated steam blasts from cracks in a scalding cloud. |
| `acid-rain` | Acid Rain | water + acid | Glowing green rain that pits and corrodes the floor. |
| `holy-fire` | Holy Fire | light + fire | White-gold flames with a sigil and rising feathers. |
| `void-lightning` | Void Lightning | void + lightning | Black lightning with violet edges that drains light where it strikes. |
| `black-flame` | Black Flame | void + fire | Absorbing black fire with violet embers. |
| `frozen-lightning` | Frozen Lightning | ice + lightning | A bolt that freezes into a crystal lattice, then shatters. |
| `prismatic-beam` | Prismatic Beam | light + arcane | A beam split into rainbow bands. |
| `mud-tsunami` | Mud Tsunami | earth + water | A heavy brown wave with debris. |
| `lava-geyser` | Lava Geyser | earth + fire | Erupting magma, with glowing blobs arcing out and cooling to black rock. |
| `crystal-storm` | Crystal Storm | ice + earth + wind | A whirlwind of sharp glinting crystals. |
| `aurora-veil` | Aurora Veil | light + arcane | Curtains of aurora rippling over the arena. |
| `ember-swarm` | Ember Swarm | fire + arcane | Thousands of homing embers swarm the target. |
| `plasma-lance` | Plasma Lance | fire + lightning | A blinding white-violet plasma beam with heat haze. |
| `magma-rain` | Magma Rain | fire + earth | Molten rocks fall and cool. |
| `storm-eye` | Storm Eye | wind + lightning + water | A calm eye surrounded by a wall of storm. |
| `supernova` | Supernova | light + fire + void | A star implodes and then explodes, with lensing and a shock ring. |
