# Free World

A multiplayer open-world life sim, built on a GTA V-grade foundation: camera, handling, physics and reactions modelled on GTA V's behaviour. All characters, places, brands and art are original. Planning lives in [`docs/GTA_V_REFERENCE_SPEC.md`](docs/GTA_V_REFERENCE_SPEC.md).

**Current phase: 2 (foundation).** `index.html` / `free-world.html` is a proving-ground test map:
- **Physics:** Rapier (WASM), fixed 60 Hz step.
- **Vehicles:** raycast suspension, torque curve, automatic gearbox, speed-sensitive steering, anti-roll, aero drag, handbrake slides, crash deformation, spring-driven body roll and pitch.
- **Characters:** kinematic controller with momentum, turn-rate limits and pivots; walk/run/sprint animation blending with stride matching; lean; stagger, ragdoll and get-up.
- **Camera:** state machine (explore / aim / sprint / vehicle / first person) with critically damped lag, sphere-cast collision, a velocity-following vehicle chase, look-behind, shoulder swap and distance steps.
- **Rendering:** physical sky with image-based lighting, cascaded shadows, GTAO, bloom, ACES tone mapping, SMAA/FXAA. Very Low → High tiers with dynamic resolution.
- **Dev overlay (F3):** FPS, frame/CPU/GPU/physics/AI/animation times, draw calls, triangles, textures and VRAM, heap, entity counts.

The character is a **dev placeholder**, loaded at runtime from three.js's public examples. Characters generated with Tripo (`tripo anim rig --spec mixamo`) go in `public/assets/characters/player.glb` and replace it. Tripo needs `TRIPO_API_KEY` set in the environment.

```
npm install
npm run dev                  # http://localhost:5173
node tools/handling-test.mjs # headless vehicle benchmark (0-60, top speed, braking, grip)
```

The earlier single-player prototype is kept as `legacy-sundown.html` / `sundown-city.html`.
