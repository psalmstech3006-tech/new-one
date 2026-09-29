# Free World: hosting and deployment

Free World is a **website**. There are four separate pieces, and the game never depends on the
backend:

| Piece | What it is | Where it runs |
|---|---|---|
| Offline build | `free-world.html`, a single file with everything embedded, opened from disk | the player's computer (single-player) |
| Hosted web client | `dist/`: static HTML, JS and GLB files from `node tools/build-web.mjs` | any static host (InfinityFree works) |
| Multiplayer backend | `server/index.mjs` (Node + WebSocket): accounts, validation, world clock, chat, **WebRTC signalling** | a Node host with WebSockets (not InfinityFree) |
| Voice | WebRTC audio **peer-to-peer between browsers**; the backend only relays offers, answers and ICE | the players' browsers (+ optional TURN relay) |

Server discovery is handled in `src/fw/net/client.js` (`resolveServer`). It takes the first match:
1. `?server=off`, `?server=host:port`, or `?server=wss://…`.
2. `fw-config.json` next to `index.html`, e.g. `{ "server": "wss://…/ws", "iceServers": [...] }`.
3. Same-origin `/health` answering `fw:true` (the backend serving the client itself).

If none of these match, the game runs single-player. A configured backend that is unreachable
also leaves a playable single-player game, with a "connecting / offline" status shown.

## InfinityFree: what it can and cannot host

**Sources:** InfinityFree documentation and staff answers:
[Browser security system](https://forum.infinityfree.com/t/browser-security-system-features-and-limitations/49353),
[Node.js / socket.io](https://forum.infinityfree.com/t/does-node-js-support-socket-io/106975),
[file size limit](https://forum.infinityfree.com/t/what-is-the-file-upload-size-limit/49308).

| Question | Answer | Consequence |
|---|---|---|
| 1. Static client? | **Yes**, with limits: 10 MB per file and 1 MB per HTML/PHP file. | `dist/` fits: 12.1 MB total, largest file 5.5 MB, index.html is tiny. `tools/build-web.mjs` checks the limits. The 14.6 MB single-file build does **not** fit; it's for offline/local use. |
| 2. Node.js server? | **No.** InfinityFree is PHP/MySQL only; no long-running processes. | The backend is hosted elsewhere. |
| 3. WebSocket server? | **No**, in any language. | Browsers on the InfinityFree site connect *out* to a WebSocket backend elsewhere, which works. |
| 4. WebRTC signalling there? | Not practically. It would need PHP long-polling, which is limited by execution-time, process and daily-hit limits, and blocked for cross-origin use. | Signalling runs on the Node backend (it's just small messages). Voice audio stays peer-to-peer. |
| 5. PHP API layer? | Same-origin only. The mandatory browser security system blocks REST clients, CORS requests, apps and webhooks. | Not used. Nothing in the game needs PHP. |
| 6. Talking to a hosted backend? | **Yes.** The page's own requests (`fw-config.json`, assets) are same-origin; the WebSocket goes from the browser to the backend's domain, which the security system doesn't intercept. | Use `wss://` (InfinityFree provides free SSL, and HTTPS pages must use `wss`). |
| 7. Restrictions that break multiplayer? | Only if you tried to run the backend there. | None for the split set-up. |
| 8. Anti-bot effects? | First visit gets a JavaScript/cookie challenge, which browsers pass automatically. Non-browser clients, cross-origin API calls and PWAs are blocked. | The game only makes same-origin requests to InfinityFree. **Don't** point other sites or apps at files hosted there. |
| 9. What to host there? | The static web client. | Backend on a free Node host (below). |

**Tested here:**
- limits enforced by the build script;
- the static client working from a plain static server;
- a cross-origin backend connection;
- single-player fallback;
- all in `tests/e2e/hosting.mjs`.

**Not tested live:** this development environment's network policy denies connections to
InfinityFree's servers (`*.infinityfreeapp.com`, the panel, and `ftpupload.net`), so I could not
upload to or load your account from here.
`freeworld.infinityfreeapp.com` is currently unclaimed: the server reports "Domain not added to
hosting account".

## Backend host: Render (free web service)
It runs the existing `server/index.mjs` unchanged, supports WebSockets, and doesn't need a card.
`render.yaml` is a ready Blueprint.

Free-plan caveats:
- The service sleeps after about 15 minutes with no traffic. The first visitor then waits about a
  minute, and the client shows "connecting" and retries automatically.
- The disk is wiped on restart. To keep accounts and characters, add a free Upstash Redis database
  (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`); the server switches to it automatically.

Alternatives with WebSockets:
- **Koyeb free:** runs the same Node server.
- **Cloudflare Workers + Durable Objects:** free, and the best long-term fit for many rooms, but
  it needs a server port to the Workers runtime.

Fly.io and Railway no longer have a usable free tier.

## Steps (about 10 minutes, all free)
1. **Backend.**
   1. Sign in at render.com with GitHub.
   2. Go to New → Blueprint and choose this repository and branch; Render reads `render.yaml`.
   3. Set `ALLOWED_ORIGINS=https://<your-site>.infinityfreeapp.com`.
   4. Optionally create an Upstash Redis database and paste its REST URL and token as the two env vars.
   5. Note the service URL, e.g. `https://free-world-server.onrender.com`.
2. **Client build.** Run `node tools/build-web.mjs --server wss://free-world-server.onrender.com/ws`.
   This produces `deploy/free-world-web.zip`.
3. **InfinityFree.**
   1. Create a site, e.g. `freeworld.infinityfreeapp.com`, and enable its free SSL certificate.
   2. Open the File Manager and go to `htdocs/`.
   3. Upload `free-world-web.zip` and extract it there.
4. **Check.**
   1. Open `https://<your-site>/`.
   2. Open the dev overlay (F3 or `?dev=1`); it shows "network online as Guest…".
   3. Open the site in a second browser to meet yourself.
   4. Press M in both to talk.

**Voice across strict NATs** (some mobile and corporate networks) needs a TURN relay. Add one with
`--ice '[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:<host>:3478","username":"…","credential":"…"}]'`
when building. Metered's free Open Relay tier works.

I can do the Render part myself if you add a `RENDER_API_KEY` secret to this environment. Don't
paste it into chat. I can do the InfinityFree upload only if this environment's network access is
widened to allow InfinityFree's FTP/hosting hosts. Otherwise, uploading the zip through the File
Manager is the whole step.
