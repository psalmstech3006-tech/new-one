# Free World asset register

Every generated asset is recorded here with its source, prompt and processing, so it can be regenerated or audited. All assets are original: no real brands, logos, badges or licence-plate text.

## Pipeline (vehicles)

1. **Reference image:** Higgsfield `z_image`, studio three-quarter view, blank plate, no badges. Reviewed by hand; rejected if it shows any emblem or lettering, or closely copies a real model.
2. **3D generation:** Hyper3D Rodin Gen-2.5 Medium, image-guided, Raw mesh, 40k triangles, PBR, texture de-lighting on.
3. **Optimisation:** `gltf-transform resize 1024` → `webp` → `simplify` (LOD1 ≈ 37.5%, LOD2 ≈ 12.5%) → `tools/strip-textures.mjs` on the LODs (they reuse LOD0's material).
4. **Game-ready processing:** `tools/process-car.mjs`. Faces +Z, is scaled to real metres, has its ground-centre origin, has its wheels cut into pivoted `wheel_lf/rf/lr/rr` nodes, and has badges and plates painted out when needed.
5. **Compression:** `gltf-transform quantize`.
6. **Review:** `viewer.html` renders front, side, rear and ¾ views (with wheels rotated and steered to prove they're separate), then an in-game test drive and crash.

## Vehicles

| Asset | Source | Result |
|---|---|---|
| `fw_veh_sedan_meridian_lod0-2.glb` | Reference: Higgsfield job `f5ad874b-6f8f-46d9-823b-78571013a75d` (generic late-90s four-door sedan, blank plate). Rodin generation `63b8187d-eb02-4a4a-b786-4d4c55fc4c8f`, image-guided. Processed with `--length 4.55 --front +z --badges none` | Body 22k triangles + 4 wheels at ~4.5k (LOD0), body ~8k triangles (LOD1/LOD2), wheel radius 0.377 m, wheelbase 2.56 m. 2.1 MB total |

| `fw_veh_coupe_vento_lod0-2.glb` | Reference: Higgsfield `d858eff7-…`, with the nose badge painted out of the image before use. Rodin `e424c835-385e-456a-b2c9-276ea979ba65`. Processed with `--length 4.4 --front +z --badges rear --plates keep` | Body 29.5k triangles, wheel radius 0.31 m, wheelbase 2.52 m. The rear badge was painted out. 2.0 MB |
| `fw_veh_suv_ridgeback_lod0-2.glb` | Reference: Higgsfield `e318effe-…`. Rodin `95e31977-3951-43cc-a3b3-3342bc28f4ad`. Processed with `--length 4.7 --front +z --badges rear --plates keep` | Body 21k triangles, wheel radius 0.46 m, wheelbase 2.8 m. The tailgate badge was painted out. 2.1 MB |
| Police **Patrol** | No new model. The Meridian gets our own livery in-game (decal stripe with "POLICE" in plain type) and a light bar (`Vehicle.applyPoliceLivery`) | — |

## Props (text-only Rodin, `tools/process-prop.mjs`, 512 px WebP, quantised)

| Asset | Rodin generation | Size | Triangles |
|---|---|---|---|
| `fw_prop_bench_park_a` | `95de03cc-f595-4bc7-a19d-961a8062a169` | 1.8 × 0.82 × 0.65 m | 4,000 |
| `fw_prop_hydrant_a` | `a54473f0-cd43-418e-89ab-b2efa25a6980` | 0.8 m tall | 2,500 |
| `fw_prop_litterbin_a` | `49d9c65a-f2e2-4f47-86b8-5b60f3c5af4a` | 1.0 m tall | 2,500 |
| `fw_prop_dumpster_a` | `7aba2d8f-330f-445c-b5af-29cfab709ca8` (came out as an open construction skip) | 1.9 m long | 3,000 |
| `fw_prop_barrier_jersey_a` | `04eed8a8-f96d-46f0-af65-e506b0dd2d01` (came out as a concrete barrier block) | 3.0 m long | 1,500 |
| `fw_prop_trafficlight_a` | `6734095a-28a9-4ca2-8a05-f98d7d0a92a2` (four-way signal cluster) | 4.0 m tall | 3,000 |

### Rejected
- **Rodin `4deac626-…` (text-only prompt).** It generated two rear ends (no bonnet or headlights), baked-in wheels, a trunk emblem and plate text.
- **Higgsfield reference `e19b1e54-…`.** It had a grille badge and lettering, and the front strongly resembled a current production car.
- **Police references `305fa535-…` and `e60c992f-…`.** Both had grille/nose emblems, and their designs closely followed real patrol cars and a real electric sedan. The police car reuses the Meridian instead.

## Characters
- **Built-in** (`src/fw/humanoid.js`): procedural, original, Mixamo-standard skeleton. It's a stand-in until characters are rigged with Tripo (API credits needed).
