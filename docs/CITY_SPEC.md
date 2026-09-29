# Free World: City & Building Specification (Phase 1)

## 1. Research summary

- **Zoning.** GTA V's city is a set of distinct zones rather than uniform sprawl. The high-rise financial core has smaller businesses and housing at its edge. There's an affluent shopping and residential district, mixed industrial/residential districts, and dense low-rise southern neighbourhoods. The designers keep the most recognisable building types and drop monotonous sprawl ([ArchUp](https://archup.net/comparing-los-santos-map-los-angeles/), [GTA Wiki: Downtown](https://gta.fandom.com/wiki/Downtown_Los_Santos_(HD_Universe)), [GTA Wiki: Los Santos](https://gta.fandom.com/wiki/Los_Santos_(HD_Universe))).
- **Real city structure.** Typical North American blocks are about 100 × 200 m. Mixed-use main streets move from ground-floor retail to residential. Pedestrian districts need ground-floor retail, services and proper sidewalks ([City block](https://en.wikipedia.org/wiki/City_block), [Mixed-use](https://archive.strongtowns.org/journal/2022/12/2/recovering-the-lost-art-of-mixed-use-development), [LA Planning: urban form](https://planning.lacity.gov/blog/framework-urban-form-and-neighborhood-design-part-one)).
- **Production method.** Open-world cities are built from **modular kits**: walls, windows, doors, trims and dressing that share components and swap into the same slots to create variation without new assets ([Level Design Book](https://book.leveldesignbook.com/process/env-art), [80.lv: open-world modularity](https://80.lv/articles/building-huge-open-worlds-modularity-kits-art-fatigue), [Polycount](http://wiki.polycount.com/wiki/Modular_environments)).
- **Interiors in GTA V.** They're concentrated in interactive businesses (convenience stores, clothing, barbers, gas stations), with most other buildings exterior-only. That's the hierarchy below ([GTAForums interior list](https://gtaforums.com/topic/836929-list-of-enterable-interiors/)).

## 2. Production decision

Building geometry comes from a **procedural modular architecture kit** (`src/fw/city/`), not one AI model per building.
- Every building is assembled from real 3D modules: wall panels with true openings, recessed glazing, frames, sills, lintels, belt courses, cornices, parapets, balconies, fire escapes, awnings, storefront systems, porches, pitched roofs with eaves, rooftop plant and signage.
- Families take parameters (width, depth, floors, materials, window rhythm, ground-floor type, roof type) and seeded variation, so no two buildings in a street are identical.
- Rationale:
  1. It's how open-world cities are produced at scale.
  2. Collision, doors and interiors can be generated exactly aligned to the exterior.
  3. It isn't limited by generation credits (the Hyper3D connector is currently disconnected and Tripo has 0 credits).
- AI-generated models remain for hero props and vehicles. Landmark buildings can be swapped for generated models later.

## 3. Building taxonomy (families implemented)

| Group | Families |
|---|---|
| Residential | suburban house (1–2 floors, gable/hip roof, porch, garage), large house, duplex, townhouse row, low-rise apartment block with balconies, mid-rise apartment tower, low-income walk-up with fire escape |
| Commercial | mixed-use main-street block (storefront + apartments), convenience store, café, restaurant, clothing store, pharmacy, electronics, furniture store, bank (stone, columns), hotel, supermarket, shopping mall + parking, car dealership, gas station |
| Public | school (+ gym, sports field), police station, clinic/hospital, fire station, city hall/government office, library, community centre, train station + platform, bus station |
| Business / industrial | office low-rise, office tower (curtain wall), warehouse, factory, workshop/garage, logistics depot, construction site |
| Entertainment / social | park with football pitch & basketball court, gym, cinema |

## 4. District plan: "Harbor Heights" (District 1)

A planned 3 × 3 block grid, each block about 110 × 80 m, streets 12 m wide with 4 m sidewalks, plus an industrial and rail fringe to the east. Street names are original.

| | West (Elm Ave → Oak St) | Centre (Oak St → Market St) | East (Market St → Harbor Blvd) |
|---|---|---|---|
| **North** (1st St → 2nd St) | Suburban houses, duplexes, large house | Townhouse rows, apartment block, corner shop | School campus (school, gym, football field, court) |
| **Middle** (2nd St → 3rd St) | Harbor Park (football pitch, basketball court, paths, trees, benches) | **Main Street** commercial: mixed-use storefronts, café, restaurant, clothing, pharmacy, bank, hotel | Civic: police station, clinic, fire station, city hall |
| **South** (3rd St → 4th St) | Mall + surface parking + gas station on the corner | Offices: office tower, office low-rise, parking structure | Transit: train station + bus station |
| **East fringe** (beyond Harbor Blvd) | — | — | Industrial: warehouses, factory, workshop/garage, construction site, rail line |

Logic: homes sit next to the school and park; retail faces the main street, with parking behind; offices sit by transit; heavy industry is at the edge by the rail line; civic services are central.

## 5. Interior hierarchy

1. **Hero interiors** (fully furnished, multiple rooms): houses (living, kitchen, bedroom, bathroom, hallway), apartment (lobby + stair + unit), convenience store, café, clothing store, pharmacy, bank, police station (reception, offices, interview room, holding cells), clinic (reception, waiting, treatment rooms), school (corridor, classrooms, staff room), office (lobby + elevator + office floor), train station hall (ticketing, waiting, platform), mall (atrium, shop units, food court), gym, workshop.
2. **Functional interiors:** smaller shops and back rooms with a counter and shelves.
3. **Exterior only:** background buildings. Doors on these are not interactive and not presented as entrances.
4. **Distant:** a simplified LOD box with baked facade colour.

Interiors are built lazily when the player comes within 45 m and freed beyond 90 m (streaming).

## 6. Doors & interaction

- A door is a hinged leaf with a kinematic collider that follows the leaf, so it collides correctly while opening.
- It can be open, closed or locked. Press **E** to open, close, or try the handle.
- Locked doors need a key: the player's key ring (keys will be granted by property ownership in Phase 8).
- Entering a building's interior volume switches the camera to interior mode and turns on the interior lights.
- Multi-floor access: stairs (walkable ramps) in the apartment block and an elevator panel in the office tower.

## 7. Standards

- **Scale:** 1 unit = 1 m. Floor-to-floor heights: residential 3.1 m, commercial ground floor 4.2 m, office 3.6 m. Doors 1.0 × 2.2 m (residential), 1.8 × 2.6 m (commercial double). Kerb 0.15 m.
- **Materials:** a shared set of PBR materials (brick, stucco, siding, concrete, stone, corrugated metal, glass, frames, shingles, interior floors), tinted per building through vertex colours. This keeps draw calls low while every building looks different.
- **Draw calls:** each building is merged per material (about 6–10 calls). Towers use a curtain-wall grid rather than per-window geometry.
- **Triangle budgets:** low-rise about 5–20k, tower about 10–25k. Interiors are only present when streamed in.
- **LOD:** full detail within 170 m; simplified massing beyond.
- **Collision:** wall segments around door openings; floors; stairs as ramps; large furniture only.

## 8. Implementation (src/fw/city/)

| Module | Role |
|---|---|
| `materials.js` | shared vertex-tinted PBR materials (+ night-lit window glass, clear shop glass) and the `SignAtlas` |
| `geom.js` | `GeoBuilder` (per-material merge, collider list), deterministic `rng` |
| `archkit.js` | facade engine (per-floor bands with real openings), window/storefront/door/roller inserts, cornices, parapets, balconies, fire escapes, awnings, signs, stairwell cut-outs |
| `families.js` | 30+ building families (see §3) returning geometry, colliders, door records and metadata |
| `interiors.js` | furniture kit + 14 hero layouts: house (2 floors, stairs), apartment lobby + stair + Apt 201, convenience/gas, shop units (cafe, clothing, pharmacy, electronics, general), bank (tellers, ATMs, vault), police (reception, offices, interview, 4 cells), clinic (reception, 5 treatment rooms), school (corridor, 5 classrooms, staff room), office low-rise (lobby + elevator + open-plan floor 2), office tower (lobby, security gates, elevator to floor 4), train station hall, mall (concourse, 8 shop units, food court, fountain), gym, workshop |
| `district.js` | Harbor Heights layout: road grid + markings + crossings, raised blocks, 48 buildings, park, school field, parking lots, rail corridor + parked train, instanced trees and breakable lamps, street name blades, traffic lights and generated props; merges exteriors into chunk meshes |
| `doors.js` | hinged leaves (single/double; wood, glass, bars) with kinematic colliders, lock/unlock via key ring, auto-close, instanced rendering |
| `runtime.js` | interior streaming (45 m build / 90 m free, 1 per frame), inside-volume detection (camera `interior` state), pooled interior point lights (1–4 by tier), elevator rides, interaction prompts |

`?map=test` still opens the old proving ground.

### Measured (headless, software GPU — counts are what matter)
- District build ≈ 1 s. 48 buildings, 27 enterable, 95 exterior doors, 134 trees, 99 lamps.
- Very Low: ~90–230 draw calls, ~0.3–0.4 M triangles. Low: ~200–560 calls, ~0.5–1.3 M. Medium: ~360–600 calls, ~1.0–1.3 M (3 shadow cascades).
- Interior build 5–80 ms each (streamed one per frame).

## 9. Phase 1 completion checklist

- [x] District layout with streets, sidewalks, crossings, lights, signals and street signs
- [x] At least 40 buildings across all five groups, visibly varied (48)
- [x] Parking lots/structure, gas station, park with pitches, school grounds, rail + bus infrastructure
- [x] At least 12 enterable buildings with real interiors and working doors (27 streamed interiors, 14 layout types)
- [x] Interior streaming + LOD + perf overlay checks
- [x] Existing cars parked and drivable in the district; existing props used for street dressing
- [x] Documented, tested, committed

### Known gaps (tracked)
- Generated props are individual meshes (~70 draw calls); instancing them is the next perf step.
- Upper floors are enterable only where there is a stair/elevator (house, apartment, offices).
- Shops/ATMs/tellers show prompts; buying and banking arrive with the economy phase.
