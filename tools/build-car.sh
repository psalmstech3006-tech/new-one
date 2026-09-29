#!/usr/bin/env bash
# Full vehicle pipeline: raw Rodin GLB -> game-ready LOD0-2 in public/assets/vehicles/
# Usage: tools/build-car.sh <raw.glb> <asset_name> <length_m> <front:+z|-z> [process-car flags...]
set -euo pipefail
RAW=$1; NAME=$2; LEN=$3; FRONT=$4; shift 4
V=public/assets/vehicles; T=$(mktemp -d)
npx gltf-transform resize "$RAW" $T/a.glb --width 1024 --height 1024 >/dev/null
npx gltf-transform webp $T/a.glb $T/lod0.glb --quality 85 >/dev/null
npx gltf-transform simplify $T/lod0.glb $V/${NAME}_lod1.glb --ratio 0.375 --error 0.01 >/dev/null
npx gltf-transform simplify $T/lod0.glb $V/${NAME}_lod2.glb --ratio 0.125 --error 0.05 >/dev/null
node tools/strip-textures.mjs $V/${NAME}_lod1.glb $V/${NAME}_lod2.glb >/dev/null
node tools/process-car.mjs $T/lod0.glb $V/${NAME}_lod0.glb --length "$LEN" --front "$FRONT" --lods $V/${NAME}_lod1.glb,$V/${NAME}_lod2.glb "$@" | grep -E "painted|wrote|lod "
for f in lod0 lod1 lod2; do npx gltf-transform quantize $V/${NAME}_$f.glb $V/${NAME}_$f.glb >/dev/null; done
ls -la $V/${NAME}_lod*.glb | awk '{print $5, $9}'
rm -rf $T
