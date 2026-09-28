# GTA V Reference Specification → Free World

Phase 1 deliverable. Written before the major implementation phase, as the project brief requires.

**Purpose.** GTA V is the quality and behaviour target. This document records how its systems behave and feel, then defines what Free World needs, how we reproduce it, and what we reuse, rebuild, source, generate with Tripo, or engineer.

**Scope boundary (applies to every section).** We reproduce *behaviour, feel, technique and quality bar*: handling, physics response, camera dynamics, AI reactions, rendering techniques, streaming strategy. All *content* is original to Free World: characters, the city, street names, brands, logos, vehicle designs, UI artwork, dialogue, music and sound effects. We never extract, trace or ship Rockstar assets or data files, and Free World is not a map-for-map copy of Los Santos. Beyond the legal reason, this is what lets Free World ship.

**How to read each system section.** Each system uses the same eight headings requested in the brief:
1. What GTA V does
2. What Free World needs
3. How we reproduce it
4. Reuse from the current codebase
5. Rebuild
6. External assets
7. Tripo-generated assets
8. Custom engineering

**Current codebase (Sundown City prototype).** three.js, a procedural grid city, box-primitive characters, a kinematic arcade car model, single-player only. The prototype is a useful test bed for systems logic: traffic lane graph, heat thresholds, HUD layout, mission state machine, spawn/despawn manager. Its **rendering, characters, physics, camera and vehicles do not meet this spec** and are marked *Rebuild* throughout.

---

## 0. Engine decision (blocks Phase 2)

GTA V's presentation depends on a native AAA engine: deferred HDR rendering, about 4,000 draw calls per frame, streaming from disk, and a licensed biomechanical animation middleware. The brief asks for that presentation, lower-end laptop support, and server-authoritative multiplayer with voice for real players. Those constraints pull in different directions, so the engine choice has to be made first.

| Option | Visual ceiling | Low-end laptops | Multiplayer / voice | Distribution | Verdict |
|---|---|---|---|---|---|
| **A. Browser: three.js (WebGL2 → WebGPU) + Rapier (WASM) + Node authoritative server** | Mid. Good PBR, CSM shadows, post-FX; far below GTA V density | Good with aggressive LOD | WebRTC/LiveKit native, easy | A link, instant | Keeps the current stack; hits the "feel" targets, not GTA V pixel density |
| **B. Unreal Engine 5 + dedicated server** | Highest (Nanite, Lumen, World Partition streaming, Chaos vehicles and physics) | Weak: Lumen/Nanite need scalability presets disabled on iGPUs | Built-in replication, dedicated servers; voice via EOS/Vivox | Installer (tens of GB) | Closest to the brief's visual target; separate toolchain, not runnable here |
| **C. Unity 6 (URP/HDRP) + Netcode for GameObjects/Fish-Net** | High | Good (URP) | Mature | Installer | Middle ground |
| **D. Godot 4 + Jolt** | Mid-high | Good | Built-in high-level MP | Small installer | Open source; less vehicle tooling |

**Recommendation.** If "GTA V graphical presentation" is non-negotiable, choose **B (Unreal 5)**. Its streaming, vehicle physics, animation (Motion Matching, Control Rig, Physical Animation) and replication cover most of Parts 2–9 out of the box. If instant browser play matters more, choose **A**: it will feel like GTA V (camera, handling, reactions) but will not match its density or lighting. This spec is written engine-neutral; §17 gives concrete mappings for both A and B. **The project owner needs to make this choice.**

---

## 1. Graphics & rendering

**1. What GTA V does.**
- Deferred HDR pipeline. Opaque geometry writes a multi-target G-buffer (albedo, normals, specular/gloss, emissive/misc, depth), then lighting is accumulated per light volume, so hundreds of small lights (street lamps, headlights, signs) are cheap.
- Cascaded shadow maps for the sun, with soft filtering; SSAO; screen-space and cubemap reflections (a low-res dynamic cubemap for car paint and water).
- Eye adaptation (auto-exposure), filmic tone mapping, bloom, depth of field in cutscenes and aiming, motion blur, FXAA/MSAA.
- Volumetric-looking sky and clouds, height fog and distance haze that sells scale.
- **LOD cross-fades with dithered transitions**, so objects never visibly pop. Very distant city blocks are pre-baked "super-LOD" meshes.
- A typical frame issues about 4k draw calls. Grass and small props have a hard cull distance.
- Materials read as *real*: worn asphalt with puddle masks, dirt and decal layers on buildings, car paint with clear-coat and flakes, and wet-surface shading in rain.

**2. What Free World needs.** A physically based, well-lit, hazy, dense-looking city. Golden-hour and night must look strong, because those are the reference moments. No flat-shaded or blocky look at any quality tier.

**3. How we reproduce it.**
- PBR metal/rough materials throughout.
- Clustered or deferred lighting (UE5: built-in; three.js: clustered forward via WebGPU compute or light-count budgets per tile).
- CSM (3–4 cascades).
- Post stack: SSAO/GTAO → bloom → auto-exposure → ACES/AgX tone map → colour grade LUT → TAA/FXAA.
- Physically based sky (Hillaire/Preetham) with a time-of-day driver.
- Height fog.
- Reflection probes per district, plus SSR on High.
- Decal system for grime, cracks and road markings.
- Dithered LOD transitions.

**4. Reuse.** Time-of-day driver concept; window emissive-at-night idea.

**5. Rebuild.** The entire renderer setup: the current single directional light with fog is insufficient. Materials. Sky.

**6. External assets.**
- CC0 HDRIs and PBR material libraries (ambientCG, Poly Haven) for tiling surfaces: asphalt, concrete, brick, plaster, glass.
- A colour-grade LUT (authored in-house).

**7. Tripo.** Not for surfaces (Tripo generates meshes, and tiling PBR is better from material libraries). Use Tripo for hero props and building modules (§8).

**8. Custom engineering.** Quality-tier scaler (§15), dynamic resolution controller, LOD dither shader, road puddle/wetness mask.

---

## 2. Characters

**1. What GTA V does.**
- Realistic proportions, about 60–80k triangles for hero characters and fewer for peds.
- Skinned with a full facial rig; clothing is separate mesh components (head, hair, torso, legs, feet, accessories) swapped per variation.
- Peds come from a component-variation system, so a few base bodies create huge crowd variety.
- Skin uses subsurface-style shading; hair uses alpha-cards with anisotropic highlights.

**2. What Free World needs.**
- Player avatars fully customisable: skin tone, face shape, hair, clothing and body.
- NPC crowds with high variety at low cost.
- **No** primitives, mannequins, cube heads or blocky hands.

**3. How we reproduce it.**
- One shared **humanoid skeleton standard** (§16) for players and NPCs, with modular components and morph targets for face/body sliders.
- Clothing layers are separate skinned meshes on the same skeleton.
- Crowd variety comes from component and colour-palette randomisation.
- Skin shader with wrap/pre-integrated SSS on Medium and above.

**4. Reuse.** Colour-palette randomisation logic from `characters.js` (the idea, not the meshes).

**5. Rebuild.** All character meshes and the rig.

**6. External assets.**
- A base human with a facial rig (e.g. a MakeHuman/MPFB CC0 base, or UE5 MetaHuman if Option B).
- Hair cards.

**7. Tripo.**
- Clothing items, accessories, and specific NPC archetypes (police, workers, inmates, guards, athletes, zombies) generated to the character standard, then rigged with `tripo anim rig --rig-type biped` and re-targeted.
- Base bodies and faces should come from a parametric base (item 6). Tripo single-mesh characters cannot support face/body sliders.

**8. Custom engineering.**
- Character creator UI.
- Component assembly and skinned-mesh merging, so each character is one draw call per material.
- Server-side appearance schema.

---

## 3. Animation & physical reactions (the "Euphoria" feel)

**1. What GTA V does.**
- Locomotion is heavily blended: idle ↔ walk ↔ jog ↔ sprint by speed, dedicated start/stop/pivot animations, lean into turns, foot IK on slopes and stairs.
- Upper body is layered: aiming, phone, and carrying run over locomotion.
- GTA V embeds NaturalMotion **Euphoria**, which is *not* an on/off ragdoll. It is a set of physically simulated, motor-driven behaviours: characters try to keep their balance when bumped, stagger, windmill, grab nearby objects or people, brace with their hands when falling, protect their head, clutch wounds, roll and then get back up.
- GTA V tones this down compared with GTA IV for performance.

**2. What Free World needs.** Weighty, responsive movement with visible anticipation, momentum and recovery. Being hit by a car, shot or shoved must produce varied, physical reactions.

**3. How we reproduce it.**
- **Locomotion:** Motion Matching (UE5 5.4+) or a 2D blend space (speed × turn rate) plus start/stop/pivot clips and distance-matching to kill foot sliding. Two-bone foot IK with a pelvis offset. Procedural lean from angular velocity.
- **Physical reactions (Euphoria-style),** built as a *powered ragdoll* in four parts:
  1. Every character has a physics ragdoll (capsule/box bodies, ~15 bodies, cone-twist/hinge joints) that normally follows the animation.
  2. Each joint has a PD motor driving it toward the animated pose (UE5: Physical Animation Component; Rapier: joint motors).
  3. On impact, lower the motor strength (stiffness) for affected limbs, apply the impulse, and run a **balance controller**: if the centre of mass leaves the support polygon, take corrective stagger steps (procedural step targets). Past a threshold, go to full "protective fall": arms reach toward the predicted ground contact, head tucks.
  4. Once velocity settles, blend back to animation with a get-up clip chosen by facing (back or front).
- **Behaviour set to implement:** stagger, shove-reaction, shot-reaction per body region, car-hit (roll over bonnet vs. fly), fall-from-height, protective fall, writhe/injured, get-up.

**4. Reuse.** None. The current sine-wave limb swing is replaced.

**5. Rebuild.** All of it.

**6. External assets.** Mocap locomotion and reaction sets (e.g. licensed libraries, or free CC0 sets retargeted to our skeleton).

**7. Tripo.** `tripo anim retarget` presets (idle/walk/run/jump/hurt/fall/turn and v1 biped emotes such as wave, greet and frightened) for NPC ambient behaviour and prototyping. Hero locomotion needs richer data than presets provide.

**8. Custom engineering.** Powered-ragdoll controller, balance/stagger solver, get-up selection, network replication of ragdoll (authoritative on the server for players, cosmetic for distant NPCs).

---

## 4. Camera

**1. What GTA V does.**
- **On foot:** an over-the-shoulder orbit camera the player rotates freely (yaw 360°, pitch clamped). It follows with positional lag, and gently auto-recentres behind the character only while moving and after a period without input.
- **Aiming:** zooms in and shifts to a tighter shoulder offset; you can swap shoulders. The character turns to face the aim direction and the reticle changes.
- **Collision:** a sphere-cast from pivot to desired position pulls the camera in when obstructed, with fast pull-in and slow ease-out, and fades the character when too close.
- **Vehicle:**
  - Several distance presets.
  - At low speed the camera is free with no auto-centering; as speed rises it increasingly chases the direction of *travel* (velocity), not the car's nose, so drifts look right.
  - Pitch follows terrain slope with damping, and slight shake scales with speed and surface.
  - A look-behind button.
- **First-person** mode for on foot and vehicles, plus a cinematic cam.
- **Interiors:** tighter max distance and lower FOV.
- **Transitions:** blended (interpolated pivot/offset/FOV) rather than cuts.

**2. What Free World needs.** All states listed in the brief: free orbit, look in every direction, adjustable distance, independent movement vs. facing, aim, combat, vehicle, interior, first person, and smooth transitions.

**3. How we reproduce it.**
- A camera **state machine**: `OnFootExplore`, `OnFootCombat`, `Aim`, `Vehicle(type)`, `Interior`, `FirstPerson`, `Cinematic`. Each state defines pivot bone, shoulder offset, distance range, FOV, lag and auto-centre rules.
- Transitions blend all parameters over 0.2–0.4 s with ease curves.
- Critically damped springs for position and rotation lag (Unreal's SpringArm lag, or a custom spring in three.js).
- Sphere-cast collision with asymmetric smoothing.
- Vehicle chase direction is a blend of vehicle forward and velocity, weighted by speed.
- Mouse-wheel distance steps; shoulder swap on a key.

**4. Reuse.** Wall-clip avoidance idea and the in-vehicle auto-recentre timer.

**5. Rebuild.** The whole camera (the current version is a single hard-coded rig).

**6. External assets.** None.

**7. Tripo.** None.

**8. Custom engineering.** Camera state machine, spring solvers, sphere-cast collision, look-behind, vehicle velocity-chase, first-person body awareness (render the body and hands, not a floating gun).

---

## 5. Vehicles

**1. What GTA V does.** Every vehicle is a rigid body with raycast wheels. A per-vehicle data table defines:
- mass, centre-of-mass offset, drag, drive bias (F/R/AWD), gear count, power and top speed;
- brake force and front/rear bias, handbrake force, steering lock;
- **traction curve**: max grip, min (sliding) grip, lateral slip angle at the peak, loss on low-grip surfaces;
- **suspension**: spring force, compression and rebound damping, travel limits, raise, front/rear bias;
- anti-roll bar force; collision/deformation damage multipliers.

The *gap* between peak and sliding grip is what makes muscle cars progressively oversteer while sports cars snap. Cars pitch under braking, squat under throttle, roll in corners and can flip. Vehicle types include cars, motorcycles (lean model, rider can fall off), bicycles (pedal stamina), boats (buoyancy), helicopters/planes (with speed caps because streaming can't keep up with real flight speeds), trains on fixed tracks, buses and emergency vehicles with sirens.

**Entering and exiting** are animated: walk to the nearest door, open it, and possibly jack the driver.

**2. What Free World needs.** Cars, motorcycles, bicycles, horses, trains/public transport, plus ownership, purchase, sale, maintenance, parking and damage. They must feel like physical objects, not "press W to translate".

**3. How we reproduce it.**
- A **raycast-vehicle** rigid-body model:
  - Per wheel: a suspension ray gives the spring-damper force at the contact point.
  - Tyre forces from a **Pacejka-lite / brush model**, with longitudinal and lateral slip combined by a friction ellipse, driven by a data table mirroring the concepts above (our own values and names).
  - Engine torque curve → gearbox → differential.
  - Anti-roll force between axle wheels; aero drag; ABS toggle.
- Motorcycles: rider lean plus counter-steer approximation; the rider ejects (ragdoll) above an impact threshold.
- Bicycles: stamina-limited torque.
- Horses: character locomotion plus mount state (a quadruped rig).
- Trains and buses: spline-followers with physical collision.
- **Handling data table**, one row per model, hot-reloadable for tuning.
- Enter/exit uses door seats, IK hand on handle and a jack sequence.

**4. Reuse.** Vehicle type catalogue concept; traffic lane graph and pursuit steering (adapted to issue physical inputs).

**5. Rebuild.** Physics model (the current one is kinematic), meshes, enter/exit, damage.

**6. External assets.** Tyre/engine audio samples (CC0 or recorded); reference handling values are our own.

**7. Tripo.** All vehicle bodies (sedan, coupe, muscle, sports, SUV, van, pickup, bus, police cruiser, ambulance, fire truck, motorcycle, bicycle, tram/train car), generated to the vehicle standard (§16), then **segmented** (`tripo mesh smartsegment`) so wheels, doors, bonnet, boot and bumpers become separate parts.

**8. Custom engineering.** Tyre model, drivetrain, suspension, handling editor overlay, deformation (§6), enter/exit IK, ownership/garage persistence, server-side vehicle simulation for owned or near-player vehicles.

---

## 6. Physics & destruction

**1. What GTA V does.**
- Rigid-body world with consistent gravity, friction and restitution; props are dynamic (bins, benches, poles snap, fences break).
- Collisions transfer momentum believably (mass matters).
- Vehicle damage has three layers:
  - **mesh deformation** driven by a per-vertex "deformability" weight, so the cabin stays intact while crumple zones cave;
  - **detachable parts**: bumpers hang, scrape, spark, then fall off; opened doors can be ripped off;
  - **functional damage**: burst tyres deflate and eventually leave rims with low grip, smashed windows, engine smoke → fire → explosion.
- Explosions apply radial impulses, ragdoll characters and ignite fuel.
- Physics is prioritised near the player; distant objects sleep.

**2. What Free World needs.** The same believable, consistent physical world, server-authoritative where it affects gameplay.

**3. How we reproduce it.**
- Physics engine: Rapier (A) or Chaos (B). Fixed 60 Hz timestep with interpolation.
- Prop library with mass, break force and fracture data.
- Vehicle deformation: store a per-vertex deform weight in a vertex attribute; on impact, displace vertices inside a radius along the impact normal, scaled by the weight, in a GPU-side morph texture or on the CPU for the player's car.
- Parts use hinge joints with break thresholds.
- Explosions use an overlap query to apply impulse, damage and ragdoll trigger.
- Sleep and deactivate distant bodies; limit simulated props to a radius per player.

**4. Reuse.** Explosion chain logic and damage thresholds.

**5. Rebuild.** Physics engine integration.

**6. External assets.** None required.

**7. Tripo.** Breakable props and debris pieces (`mesh segment` for pre-fractured pieces).

**8. Custom engineering.** Deformation shader, part detachment, fracture swap, physics LOD/sleep manager, server reconciliation of important bodies.

---

## 7. NPCs

**1. What GTA V does.**
- Ambient peds run **scenario** behaviours at points in the world: smoking, phoning, jogging, sitting on benches, leaning on walls, working (sweeping, gardening), filming with phones.
- They navigate pavements and cross at junctions.
- They react through perception → state change: bumped → complain; witness a serious crime → flee, scream, drop held items, or phone the police; some fight back or film. Gang members become hostile.
- Drivers follow lanes and traffic lights, honk, get road rage, flee or ram.
- Emergency services respond to events (ambulance to injured, fire truck to fires).
- Animals exist in rural areas. Contextual dialogue lines give personality.

**2. What Free World needs.** A population that reads as inhabitants; NPCs that witness and report crime (feeding §9); workers who share space with players doing the same jobs.

**3. How we reproduce it.**
- **Scenario points** authored per district (bench, bus stop, shop counter, construction site).
- A **utility/behaviour-tree AI** with perception (vision cone plus hearing radius for gunshots, crashes and explosions) and memory ("I saw player X at T, location L").
- States: `Wander`, `Scenario`, `Commute`, `Flee`, `Cower`, `Fight`, `Investigate`, `ReportCrime` (walk away, phone animation → creates a police report with a delay), `Film`.
- Navmesh plus crowd avoidance (RVO/ORCA).
- Traffic: lane graph with signals, gap acceptance, give-way, and honk/rage parameters per driver.
- AI LOD: full AI near players; reduced tick rate at mid distance; statistical "virtual" population far away.

**4. Reuse.** Lane graph, block-perimeter walking and flee logic as prototypes.

**5. Rebuild.** Perception, memory, scenarios, navmesh.

**6. External assets.** Voice lines are recorded or TTS-generated in-house, all original.

**7. Tripo.** NPC archetype meshes; props for scenarios (brooms, phones, coffee cups, shopping bags).

**8. Custom engineering.** Perception system, crime-witness pipeline, scenario authoring tool, AI LOD scheduler, server-side AI.

---

## 8. World, interiors & density

**1. What GTA V does.**
- A curated, compressed caricature of a real metro area. It keeps iconic typologies (downtown towers, beach front, hills with mansions, industrial port, desert towns) and drops monotonous sprawl.
- Density comes from **layering**: kerbs, drains, lamp posts, hydrants, bins, benches, signage, bus shelters, parked cars, graffiti, litter, awnings, AC units, roof clutter, wires and decals, all placed by hand.
- Relatively few interiors in V (a common criticism); enterable ones load as separate interior spaces (portals/rooms) when you walk through the door.

**2. What Free World needs.** Per the brief: start with **one** dense district, not a giant empty map. **Every house presented as enterable is enterable**, with doors that open, close, lock and collide.

**3. How we reproduce it.**
- **District 1 spec:** about 600 m × 600 m.
  - Downtown commercial strip: 8–12 enterable businesses (shop, diner, bank, office, garage).
  - A residential street: 10–15 houses and one apartment block with enterable units.
  - A small industrial yard, one park with sports courts, a police station, a hospital, and a bus/train stop.
- **Modular kit approach:**
  - Building shells built from facade modules on a 1 m or 0.5 m grid.
  - Interiors assembled from room modules plus furniture sets.
  - Doors are physics-hinged, lockable entities with an owner ACL.
- **Interior streaming:** portal cells. An interior's contents load when the player is within ~30 m of its door and unload after leaving. Exterior windows use parallax-interior shaders (fake rooms) for non-enterable upper floors, which must be visually distinct from enterable doors.
- **Prop-dressing rules:** density targets per 10 m of street (e.g. ≥1 lamp, ≥2 small props, decals every 3–5 m).

**4. Reuse.** The procedural grid only as a whitebox/blockout for later districts.

**5. Rebuild.** District layout, which is hand-authored.

**6. External assets.** CC0 PBR materials, decals and signage fonts.

**7. Tripo.** Building modules, storefront pieces, all furniture and interior props, street furniture, vegetation hero pieces (§16 standards).

**8. Custom engineering.** Level-authoring pipeline (glTF scene files + JSON placement), door/lock system, interior cell streaming, parallax-interior shader, property ownership binding.

---

## 9. Police & crime (GTA V model → Free World redesign)

**1. What GTA V does.**
- A 0–5 star wanted level.
- While police have eyes on you, the stars are solid and the radar flashes. When they lose line of sight, the stars flash and officers show **vision cones** on the radar: narrow for foot officers, moderate for cars, wide for helicopters. Entering any cone re-engages the chase.
- At about 3★: armoured officers, roadblocks with spike strips, a helicopter (spotlight at night). Higher levels bring tactical units and military.
- Police spawn close to the player: fast and cinematic, but "teleporty".

**2. What Free World needs.** The brief is explicit: no instant spawns. A chain of crime → witnesses/evidence → report → identification → investigation → search → pursuit → arrest, with a **separate player-kill investigation** that never auto-arrests.

**3. How we reproduce it.**

Two layers:
- **(a) Hot pursuit:** GTA V-style stars/vision-cone search, but only once police *know* about a crime and have a description. Units are dispatched from real stations/patrols and drive there; no pop-in.
- **(b) Investigation:** a server-side **case file** per incident.

Crime lifecycle (all server-side):
1. **Incident created** with type, location, time, victim and suspect ID.
2. **Evidence generated:**
   - witness NPCs (and players) who perceived it, each with a confidence score based on distance, lighting and time of day;
   - CCTV cameras in whose frustum the event happened;
   - weapon and ballistics records (weapon serial ↔ owner);
   - vehicle plate if seen;
   - player statements (a UI for players to report).
3. **Report:** a witness phones it in after 10–60 s (it can be prevented by leaving or by intimidation), or a camera flags it.
4. **Identification:** combined evidence confidence ≥ threshold → suspect identified (name known) or described (clothes and vehicle known). Changing clothes or vehicle reduces description matches.
5. **Investigation:** NPC detectives (or player police, if that job is enabled) visit the scene, canvass witnesses and pull CCTV, which raises confidence over in-game time.
6. **Search/pursuit:** once identified, a warrant flag is set; patrols that recognise the suspect engage (layer a).
7. **Arrest:** a surrender prompt or subdue; transport → booking → sentence from a configurable table → prison (§13).

For **player-kills**, the same pipeline runs with higher evidence requirements and circumstance modifiers: self-defence (victim fired first), consensual combat zone (sports/Warzone), and so on. It is never an automatic arrest.

**4. Reuse.** Star HUD, vision/sight check, pursuit steering, arrest proximity check.

**5. Rebuild.** Spawn model (dispatch from stations), all investigation logic (new).

**6. External assets.** Radio chatter voice lines (original).

**7. Tripo.** Police vehicles, officers, station interior, CCTV cameras, helicopter.

**8. Custom engineering.** Case-file service, evidence model, dispatcher, suspect recognition, sentencing config.

---

## 10. Lighting, time of day & weather

**1. What GTA V does.**
- A 24-hour cycle (1 in-game minute ≈ 2 real seconds), driving sun and moon position, sky colour, fog density and artificial lights (street lamps, windows, neon, headlights with projected light at night).
- Weather states (clear, clouds, overcast, rain, thunder, fog, smog) blend over minutes.
- Rain wets surfaces (darker albedo, higher specular, puddle reflections) and changes vehicle grip.

**2. What Free World needs.** The same, synchronised across all players by the server.

**3. How we reproduce it.**
- The server broadcasts world time and weather state; clients interpolate.
- Weather presets are parameter bundles: sky, fog, cloud cover, wetness, wind, grip multiplier, particle rate.
- Wetness uses a global shader uniform plus per-surface puddle masks.
- Artificial light budget: nearest N real lights (shadowless) plus emissive/bloom for the rest.

**4. Reuse.** `World.setTime` curve logic.

**5. Rebuild.** Sky and weather.

**6. External assets.** HDRI references; rain/ambient audio (CC0).

**7. Tripo.** None.

**8. Custom engineering.** Weather state machine, wetness shading, server clock.

---

## 11. Audio

**1. What GTA V does.**
- Layered, positional audio: engine sound by RPM/load (granular), tyre skid by slip, wind by speed, surface-dependent footsteps, reverb zones (tunnels, interiors), a distant city bed, police scanner, and pedestrian speech.
- In-car radio stations.

**2. What Free World needs.** Equivalent layering, plus **proximity voice** (§12) mixed into the same 3D audio graph.

**3. How we reproduce it.**
- Web Audio (A) or MetaSounds (B).
- Engine: granular or loop crossfade by RPM.
- Occlusion by raycast lowpass.
- Reverb zones per interior.
- Original music only (no licensed tracks).

**4. Reuse.** Synth SFX as placeholders.

**5. Rebuild.** Sample-based audio.

**6. External assets.** CC0/recorded SFX packs.

**7. Tripo.** None.

**8. Custom engineering.** Audio LOD and voice ducking.

---

## 12. Multiplayer, voice, phone (Free World-specific; GTA Online as a counter-example)

**1. What GTA Online does.**
- Peer-to-peer sessions of up to 30 players with a session host, about 30 Hz sync.
- Every client is largely trusted. This is why cheaters can spawn money and manipulate other players' property.
- Host migration causes hitches.
- In-game phone with calls/texts to NPCs and players; proximity voice (optional).

**2. What Free World needs.** The opposite architecture: **server authority** over money, inventory, property, vehicles, damage, kills, jobs, salary, betting and prison (Part 26). Proximity voice with spatial falloff, mute, block and report; a phone with calls, texts and group chats.

**3. How we reproduce it.**
- **Topology:** authoritative dedicated server per shard, with PostgreSQL persistence for accounts, lives, inventory, property, ledgers and case files. Redis for presence and pub/sub (phone messages across shards).
- **Simulation:** server ticks 30 Hz. Clients send inputs; the server simulates. Clients predict their own avatar/vehicle and reconcile. Remote entities are interpolated (100 ms buffer).
- **Interest management:** spatial grid; entities replicated at rates by distance and relevance (e.g. 30 Hz under 50 m, 10 Hz under 150 m, 2 Hz under 400 m, none beyond). Delta compression, quantised transforms.
- **Economy integrity:** double-entry ledger, idempotency keys on every transaction, server-side escrow for bets (§14).
- **Voice:** WebRTC through an SFU (LiveKit, self-hosted).
  - The server publishes "who can hear whom" from positions; the client subscribes only to nearby tracks.
  - A `PannerNode` (HRTF, inverse distance model, `refDistance` ~2 m, `maxDistance` ~40 m) per speaker, occlusion lowpass through walls.
  - VAD plus push-to-talk; per-player mute/block (server-enforced unsubscribe); report captures metadata.
  - Device pickers for mic and output.
- **Phone:**
  - Server-routed calls (a LiveKit room per call, independent of proximity) and texts (persisted threads).
  - Group chats (room + message history), contacts, ringtone plus HUD notification; answer/reject/hang-up states.

**4. Reuse.** None. The prototype is single-player.

**5. Rebuild.** New server.

**6. External assets.** LiveKit (open source).

**7. Tripo.** Phone prop.

**8. Custom engineering.** All of the above; anti-cheat validation (speed/teleport checks, rate limits).

---

## 13. Economy, jobs, prison, death/new life, sports, betting, Warzone (Free World-specific)

GTA V reference points: an Online economy of cash, bank, property and businesses; heists and jobs as instanced activities. Free World generalises these into persistent systems:

- **Economy.**
  - `STARTING_MONEY` lives in server config.
  - Every item and property has a catalogue entry (price, category, resale %).
  - All transfers go through a ledger service.
- **Legal side income (15).** Sweeping, window cleaning, parcel delivery, recycling, gardening, car wash, package sorting, helping NPCs (directions/carry), construction assist, food delivery, pothole/street maintenance, moving furniture, small repairs, errands, and a street-performance minigame. Each is an interactable task with server-verified completion (position, time and action checks), paying modestly.
- **Formal jobs.**
  - The shift loop is: commute → clock-in terminal → task queue → perform → clock-out.
  - Salary is paid at the end of the in-game workday from `jobs.json` (rate, hours, performance modifiers).
  - Server-verified; idle detection.
- **Prison.**
  - A dedicated instanced district with cells, yard, canteen, workshop and a guarded perimeter.
  - A schedule runs on the game clock: lockdown, meals, yard, work.
  - NPC guards and inmates share it with player inmates.
  - The sentence counts down in configurable game time. Jobs inside reduce the sentence.
- **Death / new life.**
  - `Account` and `Life` are separate tables; death closes the Life.
  - An estate screen assigns assets to charity, schools, government, another player, an NPC, or split percentages.
  - The transfer is executed by the server in one transaction.
  - The new Life starts from config (money, location, starter items) plus any inheritance.
- **Sports.**
  - Football and basketball courts in the park.
  - Match lobbies (1v1, 2v2, 5v5, custom) with bot fill.
  - Server-simulated ball physics; score and result are authoritative.
- **Betting.**
  - Both parties sign a wager contract (stake, match ID, conditions).
  - Funds move to escrow.
  - The server settles only from its own match result.
  - Disconnect rules are defined up front (forfeit after a grace period).
  - Idempotent settlement with a row lock prevents double-payout.
- **Warzone.**
  - A separate instance built from the District 1 kit with ruined variants (§16 "damaged" LOD set).
  - Zombie AI (horde navmesh, cheap animation), objectives, PvPvE rewards through the ledger.

---

## 14. UI / HUD

**1. What GTA V does.**
- Minimalist HUD: a radar minimap bottom-left (rotating, with health and armour arcs/bars), weapon wheel on hold, and a phone that slides up bottom-right.
- Pause map with legend and waypoints; stars top-right; contextual help top-left; clear typography with little clutter.

**2. What Free World needs.** The same information density and clarity, in an original visual design, plus a phone button, voice indicators and job/shift UI.

**3. How we reproduce it.**
- HTML/CSS overlay (A) or UMG (B).
- Radar and big map from the district's authored road data.
- Weapon wheel.
- Phone as a full app shell (Contacts, Messages, Calls, Jobs, Bank, Property, Settings).
- Speaking indicator over heads.

**4. Reuse.** Minimap renderer, stars, notifications, pause menu structure.

**5. Rebuild.** Visual design polish and the phone.

**6. External assets.** Original icon set.

**7. Tripo.** None.

**8. Custom engineering.** Phone app framework, notification bus.

---

## 15. Performance, LOD & streaming

**1. What GTA V does.**
- Per-object visibility and LOD selection each frame; dithered cross-fades; super-LOD proxies for distant blocks.
- Hard cull distances for grass and small props.
- Asynchronous streaming prioritised by distance and heading.
- Lower LOD when moving fast (flying), with vehicle speed caps.
- Ped and traffic population budgets that scale with performance.

**2. What Free World needs.** Playable on low-end laptops at Very Low, without turning geometry into cubes, and a dev overlay with real measurements (Part 27).

**3. How we reproduce it.**
- **LOD chain per asset:** LOD0 → LOD1 (50%) → LOD2 (20%) → impostor/billboard for trees and distant buildings. Generated with `tripo mesh decimate --face-limit N` (texture baking on).
- **Culling:** frustum, cell-based occlusion (district split into cells with precomputed visibility), distance culls by object class.
- **Rendering:** GPU instancing for repeated props; material atlases to batch; KTX2/Basis texture compression; mip streaming.
- **Frame-time control:** dynamic resolution targets frame time.
- **Simulation throttling:** AI tick-rate LOD; physics sleep radius; object pools for peds, vehicles, particles and projectiles.
- **Quality tiers:**

| Setting | Very Low | Low | Medium | High |
|---|---|---|---|---|
| Render scale | 0.6 dyn | 0.75 dyn | 1.0 dyn | 1.0 (TAA) |
| Shadows | 1 cascade, 1024 | 2 casc, 1024 | 3 casc, 2048 | 4 casc, 2048 soft |
| Textures | 512 max | 1024 | 2048 | 2048–4096 |
| View distance | 250 m | 400 m | 700 m | 1200 m |
| Peds / traffic | 15 / 10 | 25 / 18 | 40 / 28 | 60 / 40 |
| Vegetation | impostors only | near 3D | full | full + grass |
| Reflections | probe only | probe | probe + SSR half | SSR full |
| Post | tone map only | + bloom | + SSAO, FXAA | + GTAO, TAA, DOF |
| Particles | 25% | 50% | 100% | 100% + soft |

- **Dev overlay:** FPS, frame-time graph, CPU (main-thread ms), GPU ms (`EXT_disjoint_timer_query` / `stat gpu`), JS heap / RAM, estimated VRAM (sum of texture and buffer sizes), draw calls, triangles, texture memory, entity/NPC/vehicle counts, physics step ms, AI ms, network in/out kbps.

**4. Reuse.** Spawn/despawn manager concept.

**5. Rebuild.** Everything else.

**6. External assets.** Basis/KTX2 tooling.

**7. Tripo.** LOD generation via decimate.

**8. Custom engineering.** Streaming manager, cell occlusion, overlay, quality tier system.

---

## 16. Asset standards (Part 22: set before any bulk generation)

**Units and axes.**
- 1 unit = 1 m; Y-up; forward = +Z in engine.
- For Tripo, leave `export_orientation` unset during processing and set it only on the final `convert` step.

**Formats and textures.**
- Formats: GLB (runtime, A) or FBX (UE5 import, B). Source files kept as Tripo `task.json` plus the original GLB.
- Materials: PBR metal/rough. Channels: baseColor (sRGB), normal (tangent-space), ORM packed.
- Texture sizes (LOD0): characters 2048; vehicles 2048; building modules 1024–2048 (tiling trims); props 512–1024; small clutter 256–512.
- Texel density target: 512 px/m for props near the player; 256 px/m for building shells (trims and tiling materials).

**Triangle budgets (LOD0 / LOD1 / LOD2).**

| Class | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| Player/NPC body + clothes | 30k | 12k | 4k |
| Car | 40k | 15k | 5k |
| Motorcycle/bicycle | 20k | 8k | 2k |
| Furniture | 2–6k | 1.5k | 300 |
| Street prop | 0.5–3k | 800 | 150 |
| Building module | 2–5k | 1k | proxy |

**Skeleton and animation.**
- One humanoid skeleton for all bipeds (Mixamo-compatible naming via `tripo anim rig --spec mixamo`) so every retargeted animation works on every character.
- Quadrupeds (horses, animals) use `--rig-type quadruped`.
- Animation: 30 fps authoring, root motion extracted for locomotion, in-place for ambient loops (`--animate-in-place`).

**Scale and proportion.**
- Average adult 1.75 m (range 1.55–1.95).
- Doors 1.0 × 2.1 m; ceilings 2.7 m (residential), 3.5 m (commercial).
- Kerb 0.15 m; lane 3.5 m.
- Cars scaled to real dimensions (`auto_size=true`).

**Collision.** Simplified convex hulls or boxes authored per asset (`UCX_` prefix for B, `_col` node for A). Never use the render mesh for collision.

**Naming.** `fw_<category>_<name>_<variant>_<lod>` (e.g. `fw_veh_sedan_meridian_red_lod0.glb`, `fw_prop_bench_park_a_lod1.glb`).

**Visual consistency.**
- Every Tripo text prompt uses a shared **style preamble**: "realistic contemporary American city, PBR, grounded materials, subtle wear, neutral lighting, no text/logos".
- Every asset also gets a fixed-palette review against a reference board (original concept images produced with Higgsfield from our own prompts).
- `model_seed` and `texture_seed` are recorded per asset for reproducibility.

**Generation recipe (Tripo).**
- Hero assets: `tripo make "<preamble>, <asset>" --for game-pc --then texture,convert:format=GLTF,texture_size=2048`.
- LODs: `tripo mesh decimate @asset --face-limit <LOD1>` (bake on), then again for LOD2.
- Characters: generate → `anim check` → `anim rig --spec mixamo` → `anim retarget --animation preset:idle preset:walk preset:run ...`.
- Vehicles: generate → `mesh smartsegment` → export parts.
- Batch manifests (`tripo batch`, YAML) checked into `assets/manifests/`.

---

## 17. Engine mapping

| System | Option A (browser) | Option B (UE5) |
|---|---|---|
| Rendering | three.js WebGPURenderer, custom post chain, CSM addon | Built-in; Lumen off on Low |
| Physics | Rapier3D (WASM), raycast vehicle | Chaos Physics + Chaos Vehicles |
| Animation | three AnimationMixer + custom powered ragdoll on Rapier joints | Motion Matching, Control Rig, Physical Animation component |
| Streaming | Custom cell streamer + KTX2 | World Partition + HLOD |
| Network | Node/Colyseus or custom uWebSockets server, same Rapier sim server-side | Dedicated server, replication graph |
| Voice | LiveKit + Web Audio PannerNode | LiveKit or Vivox/EOS voice |
| Persistence | PostgreSQL + Redis | Same |

---

## 18. Quality gates (Part 29)

At each milestone, capture a side-by-side of a Free World clip and a matching GTA V reference moment (same activity, similar time of day), and score 1–5 on the following. Any score below 4 on items 1–4 blocks new features until fixed.

1. Character movement: starts, stops, turns, foot planting, weight.
2. Camera: lag, collision, aim transition, vehicle chase.
3. Vehicle handling: weight transfer, grip-to-slide progression, braking.
4. Physical reactions: shove, car hit, shot, fall and get-up.
5. World density per street segment.
6. NPC liveliness: scenarios, reactions, reporting.
7. Lighting and materials at golden hour and night.
8. Performance: FPS on the Very Low tier on the target low-end laptop.

---

## 19. Phase plan (from the brief), with exit criteria

| Phase | Deliverable | Exit criterion |
|---|---|---|
| 1 | This spec; Tripo configured | Spec approved; `tripo doctor` passes |
| 2 | Renderer, character, camera, physics, animation, vehicle foundation in a test map | Gates 1–4 ≥ 4 |
| 3 | Asset standards applied; first Tripo batch (1 car, 3 NPC archetypes, 30 props, 1 building kit) | Assets pass standards review |
| 4 | District 1 | Gates 5–8 ≥ 4 |
| 5–7 | Server authority, voice, phone | 8 players stable, <150 kbps each |
| 8–12 | Economy, jobs, crime/police, prison, death/new life | Ledger audit passes; no client-trusted state |
| 13–15 | Sports + betting, Warzone, expansion | — |

---

## 20. Honest constraints

- GTA V was built by a very large team over about five years, on a proprietary engine and licensed animation middleware. This project can reach its **behaviour and feel** in the foundation systems. Matching its **content volume and visual density** is limited by asset production, which is where Tripo and modular kits help most.
- A browser build (Option A) will not match GTA V's lighting and density on low-end laptops. Unreal (Option B) can come close on mid-range hardware, but needs a separate toolchain and a desktop install.
- Voice, calls and a persistent economy need hosted infrastructure: game server, database, LiveKit. That has running costs and needs moderation tooling (reporting, blocking, logs).

---

## Sources consulted

- GTA V graphics study (deferred pipeline, G-buffer, draw-call counts, LOD and streaming behaviour): [Adrian Courrèges, parts 1–3](https://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study/)
- Handling data concepts (traction curve, suspension, brake bias, anti-roll): [GTAMods Wiki: handling.meta](https://gtamods.com/wiki/Handling.meta), [GTA Wiki: handling.meta](https://gta.fandom.com/wiki/Handling.meta_in_GTA_V), [Handling-Tools guide](https://eddlm.github.io/Handling-Tools/guide)
- Euphoria behaviour: [GTA Wiki: Euphoria](https://gta.fandom.com/wiki/Euphoria), [Grand Theft Wiki: Euphoria](https://www.grandtheftwiki.com/Euphoria)
- Wanted level and vision cones: [GTA Wiki: Wanted Level in GTA V](https://gta.fandom.com/wiki/Wanted_Level_in_GTA_V)
- Camera behaviour: [GTA Wiki: Cinematic Camera](https://gta.fandom.com/wiki/Cinematic_Camera), [Steam discussion on vehicle camera](https://steamcommunity.com/app/271590/discussions/0/611703898451837726/), [arXiv: camera placement in games](https://arxiv.org/pdf/2109.03750)
- Pedestrians and reactions: [GTA Wiki: Pedestrians](https://gta.fandom.com/wiki/Pedestrians), [Game Developer: GTA V pedestrian dialogue system](https://www.gamedeveloper.com/design/breaking-down-gta-v-s-pedestrian-dialogue-system-an-analysis-with-speculative-examples)
- Vehicle damage: [GTA Wiki: Vehicle Damage](https://gta.fandom.com/wiki/Vehicle_Damage), [ZModeler forum on deformation](https://forum.zmodeler3.com/viewtopic.php?t=14683)
- Map design: [ArchUp: Los Santos vs. Los Angeles](https://archup.net/comparing-los-santos-map-los-angeles/)
- GTA Online netcode: [GamerHorizon: P2P architecture](https://www.gamerhorizon.blog/is-gta-online-really-online-p2p), [Heroic Labs: multiplayer architectures](https://heroiclabs.com/blog/which-multiplayer-architecture-live-game/index.html)
- Locomotion techniques: [MoCap Online: locomotion system design](https://mocaponline.com/blogs/mocap-news/locomotion-system-design-guide)
- Proximity voice: [DZone: spatial audio with Web Audio](https://dzone.com/articles/implementing-spatial-audio-with-web-audio-api), [GetStream: proximity voice chat](https://getstream.io/glossary/proximity-voice-chat/)
- Tripo CLI: bundled docs (`tripo docs`, `tripo docs --topic commands/generate|process`), CLI v0.5.1
