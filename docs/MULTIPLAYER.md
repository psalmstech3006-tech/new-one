# Free World: Multiplayer (Phase 2 foundation)

## Running a session
```
npm install
npm run play-online          # builds the client and starts the server on http://localhost:8787
```
Players open `http://<host>:8787/`. A client served elsewhere (Vite dev, or the single-file
`free-world.html`) joins a server with `?server=<host>:8787`. Without a server the game runs
single-player. Server settings are environment variables: `PORT`, `DATA_DIR`.

## Model
- **Account, character and life are separate.** The client keeps an opaque account token
  (`localStorage fw-token`); the server stores the account's name and character DNA
  (`server/data/accounts.json`). In-world life state (money, jobs, records) attaches to the
  character in the economy phase.
- **Server authority.** Clients send state at 15 Hz. The server:
  - validates every move against the speed limits (on foot 9.5 m/s, vehicle 75 m/s) and snaps
    violators back (`correct`);
  - only allows teleports it approved (elevators, respawn);
  - rate-limits messages (40/s, 16 KB max);
  - sanitises all text and DNA;
  - owns the world clock.
- **Interest management.** Each client receives only players within 260 m, in 15 Hz snapshots.
  Remote players render 120 ms in the past with interpolation.
- **Interactions.**
  - Proximity chat reaches 40 m, or 90 m when shouting.
  - Emotes are broadcast in view range.
  - Player shoves are range-checked on the server (2.4 m) before the target is knocked
    (target ragdolls).
  - Remote drivers appear as kinematic vehicles of the same model and colour, and collide with
    local cars.

## Not yet (tracked)
- Proximity voice (WebRTC with a server-side signalling relay using the same interest radius).
- Server-side vehicle physics validation beyond speed.
- Server-simulated shared NPCs: NPCs are currently simulated per client from the same seeds
  and schedule, so they are consistent in look and routine but not in exact position.
- Hosting: the server is a plain Node process; deploy it to any VM or container. There is no
  managed hosting in this repo.
