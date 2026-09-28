# Sundown City

An original open-world crime sandbox for the browser, built with three.js. It's inspired by the genre, but every character, place, and brand is fictional.

- Procedural 9×9-block city: downtown glass towers, brick low-rises, parks, a coastline, streetlights, and a day/night cycle with lit windows
- Third- and first-person play (V): walk, sprint, jump, punch; pistol, SMG, and shotgun
- Eight drivable vehicles, including a muscle car, sports car, police interceptor, and fuel tanker, with arcade drift physics, damage, fire, and explosions
- Traffic AI on lanes, pedestrians who walk, cross streets, and flee
- A five-star heat system: police chase you, bail out of their cars, shoot, and arrest; break line of sight to lose them
- HUD with a rotating minimap and GPS, health/armor, stars, weapon/ammo, cash, and speedometer; the pause menu has a full map and stats
- Four story jobs from Rusty, the garage owner; progress is saved to localStorage
- Touch controls on mobile

Key art, loading screens, and surface textures were generated with Higgsfield. `src/assets.js` tries local copies in `public/assets/` first, then the Higgsfield CDN, then procedural textures.

```
npm install
npm run dev      # http://localhost:5173
npm run build
```
