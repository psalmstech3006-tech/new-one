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

### Rejected
- **Rodin `4deac626-…` (text-only prompt).** It generated two rear ends (no bonnet or headlights), baked-in wheels, a trunk emblem and plate text.
- **Higgsfield reference `e19b1e54-…`.** It had a grille badge and lettering, and the front strongly resembled a current production car.

## Characters
- **Built-in** (`src/fw/humanoid.js`): procedural, original, Mixamo-standard skeleton. It's a stand-in until characters are rigged with Tripo (API credits needed).
