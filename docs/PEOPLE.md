# Free World: People (Phase 2)

## Character generation (`src/fw/people/avatar.js`)
A character is **DNA**: a small JSON object that is serialisable, stored per account on the server
and sent to other players. It records:
- frame, age, height, build, muscle;
- skin tone;
- hair style and colour, facial hair;
- top, bottom and shoes, each with a colour;
- accessories.

It covers work uniforms (police, medic, hi-vis). `buildAvatar(dna)` produces one skinned mesh
(one draw call) on the shared Mixamo-named rig, so the animation, ragdoll and gameplay code are
independent of the body. `randomDNA(seed, {role})` drives the population's variety of ages,
body types, skin tones, hairstyles and outfits.

## Player creator (`src/fw/people/creator.js`)
Press **P**, or use the pause menu, to open the creator. It edits every DNA field with a live
preview on the in-world body, plus a Randomise button. Saving stores the DNA on the device and,
when online, on the account (other players see the change immediately).

## Population and schedules (`src/fw/people/population.js`)
- **Residents.** 160 residents (workers, students, retirees, night shift), each with a home, a
  workplace or school, and a daily plan: commute, lunch, shops, leisure, park, home.
- **Clock.** Plans run on the world clock, which the server owns online, so all clients agree on
  where each resident is.
- **Routes.** Residents walk the sidewalk graph using Dijkstra, cross at the crosswalks, and
  leave and enter the buildings' doors.
- **Tiers:**
  - T0: abstract, clock-driven, covers everyone.
  - T1: embodied pooled characters near the player, within the quality tier's budget.
  - T2: awareness — they look at the player, flee from violence and crashes, and step out of
    the way of speeding cars.

## Blocker: realistic human art
The built-in bodies are procedural and stylised. Photoreal, production-quality rigged humans
need a generation pipeline with rigging:
- **Tripo** (`tripo anim rig --spec mixamo`): the account balance is **0 credits**.
- **Higgsfield:** 7.45 credits on the free plan, with no rigging.

The rig and DNA were designed so that generated bodies drop in per DNA archetype, with no code
changes beyond loading. What's needed: Tripo API credits (roughly 20–40 base bodies × rigging),
or permission to use another paid rigging service.
