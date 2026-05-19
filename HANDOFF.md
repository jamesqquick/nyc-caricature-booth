# NYC Caricature Booth — Handoff

A staff-assisted kiosk activation for **Cloudflare NY Tech Week (early June 2026)** that turns selfies into AI-generated caricatures set in iconic NYC scenes, printed as postcards on the spot. Everything runs on Cloudflare.

- **Production URL:** https://nyc-caricature-booth.examples.workers.dev
- **GitHub:** https://github.com/jamesqquick/nyc-caricature-booth
- **Local path:** `~/code/demos/nyc-caricature-booth`
- **Cloudflare account:** Cloudflare Developer Relations (`e9bc21da719562a3e45d77de7dd042de`)

---

## How to work on this project

1. The user is in **build mode by default** — execute steps, don't ask for confirmation before running tools.
2. **Stop after every step** with a "STOPPING FOR YOUR MANUAL VERIFICATION" section listing exactly what to check. The user will respond with "continue" / "commit and continue" / specific feedback.
3. After every step: commit + push to GitHub. Use conventional commits.
4. Each step is small enough to verify in a few minutes.
5. The full incremental plan is below. Don't deviate without asking.
6. The `~/.npmrc` redirects `@cloudflare/*` packages through an internal gateway that returns HTML errors. The project has a local `.npmrc` that overrides it back to npmjs.org — don't remove it.

---

## Current status — Phase 8 complete ✅

Most recent commits:
```
<TBD>    feat: DNP DS620A printer driver via CUPS/lp (step 8.6)
9b5790f  feat: mock printer driver with Printer interface (step 8.5)
82f19f7  feat: agent downloads postcard + writes print-ready PDF (step 8.4)
0005ebe  refactor: pivot print system from CF Queue to D1 + Worker endpoints (step 8.3 revised)
d39a580  feat: workflow enqueues print job after store step (step 8.2)
e28943e  feat: add PRINT_QUEUE binding + HTTP pull consumer (step 8.1)
```

**Next up:** Phase 9 — Digital Copy.

### Phase 6 — complete kiosk flow

The full iPad flow is live end-to-end:

```
/kiosk (idle)
  → /kiosk/capture   getUserMedia, shutter, uploads to R2 at kiosk/<sid>/selfie.jpg
  → /kiosk/scene     2×3 scene grid rendered server-side from KV, tap stashes to sessionStorage
  → /kiosk/review    Selfie + chosen scene card, "Make my postcard" fires POST /api/kiosk/start
  → /kiosk/status/:instanceId?session=<sid>
                     4-step stepper driven by SessionDO WebSocket
                     (queued/moderating → generating → compositing → done)
                     auto-redirects to /kiosk/done after done frame
  → /kiosk/done?session=<sid>
                     Postcard preview, QR (top-right header → /p/:sid),
                     "Pick up at counter" banner, 60s countdown with
                     tap-to-reset, Start over → /kiosk
```

sessionStorage keys used across the flow:
- `kiosk:selfie` — `{ sessionId, selfieKey, size, capturedAt, sceneId, sceneName, sceneEmoji, sceneChosenAt }` — cleared on workflow submit
- `kiosk:done` — `{ sessionId, sceneId, sceneName, selfieKey, caricatureKey, postcardKey, postcardUrl, finishedAt }` — set by status screen on `done` WS frame, cleared by done screen on auto-return

### Phase 7 — big screen display

The `/display` route is a passive gallery for a TV/monitor next to the booth.
Uses the standard `page()` shell (not `kioskPage`). No touch-lock, no session
state — just a slow-refresh view of recent postcards.

- Server-renders last 8 completed postcards from D1 as a 4-column grid
- Client JS polls `GET /api/display/feed` every 30s, diffs by sessionId,
  only patches the DOM when the list changes
- Header: "NY Tech Week 2026" text (left), QR to production URL (center),
  "I 🧡 NY" wordmark with animated glow pulse (right)
- Footer: "Built end-to-end on Cloudflare" pill badge
- Idle shimmer: CSS gradient sweep (10s cycle, subtle orange tint)
- Empty state: "No postcards yet — be the first!" when D1 has no completed rows

### Phase 8 — print queue + agent ✅

The print system uses D1 as the job queue (pivoted from Cloudflare Queues —
see gotcha #22). The workflow's `store` step batches both the session upsert
and a `print_jobs` INSERT in a single `DB.batch()` call.

- **Worker endpoints:** `GET /api/print-agent/jobs` (pending jobs) +
  `POST /api/print-agent/jobs/:id/ack` (mark printed/failed)
- **Print agent:** standalone Node/tsx script in `print-agent/`. Polls the
  Worker, downloads the postcard JPEG via `/api/run-img`, wraps it in a
  4×6" PDF (pdf-lib), sends to the `Printer` driver, acks the job.
- **Printer drivers:** `Printer` interface with `print(pdfBytes, jobId)`.
  Two implementations:
  - `MockPrinter` — simulated delay + writes to `spool/` dir (default)
  - `DnpDs620Printer` — sends PDF to DNP DS620A via CUPS `lp` command
  Select via env: `PRINTER_DRIVER=mock|dnp`, `PRINTER_NAME=<CUPS name>`
- **No auth on agent endpoints** — acceptable for event activation on a
  private network. Phase 10 auth gate will cover this.
- **Test endpoint:** `GET /api/test-print-job?session=<id>` seeds a print
  job for any existing completed session (useful for dev/testing).

### Architectural pivot during Phase 5

The original plan called for one "Booth DO" per physical kiosk to coordinate
state between iPad and big screen. After discussion we **dropped that idea**:

- **iPad (and any user phone)** = the personal session view — connects to a
  per-session DO for live updates while the workflow runs.
- **Big screen** = a separate, static-ish gallery page (recent caricatures,
  QR code, project info). **No real-time per-session feed.** It just refreshes
  on a slow interval. This will be built later in (a slimmed-down) Phase 7.
- **Print queue** = uses D1 `print_jobs` table + a local Node agent that
  polls Worker endpoints. Originally planned as a Cloudflare Queue but
  pivoted to D1 (simpler, no API token, built-in audit log).

**Result:** `SessionDO` is one DO per session, addressed by
`idFromName(sessionId)`. Self-deletes 5 minutes after reaching `done` or
`errored` via the alarm API. Stores the live status (queued → moderating →
generating → compositing → done; any non-terminal → errored), per-step
payloads, and accumulated timings. Holds WebSocket connections via the
Hibernation API so it can be evicted between events while sockets stay open.

---

## Tech stack

| Layer | Choice | Binding |
|---|---|---|
| Frontend | Hono-rendered HTML + Tailwind v4 (built via standalone CLI) | n/a |
| API | Workers + Hono | n/a |
| Workflow orchestration | Cloudflare Workflows | `env.CARICATURE_WORKFLOW` |
| Live session state | Durable Object — `SessionDO` (one per session, hibernating WS) | `env.SESSION` |
| AI generation | Workers AI — `@cf/black-forest-labs/flux-2-klein-4b` (image-to-image, sub-2s) | `env.AI` |
| Content moderation | Workers AI — `@cf/meta/llama-3.2-11b-vision-instruct` | `env.AI` |
| Image composition | Cloudflare Images binding (watermark, resize, QR draw) | `env.IMAGES` |
| Object storage | R2 (selfies, caricatures, postcards) | `env.BUCKET` |
| Metadata DB | D1 | `env.DB` |
| Config | KV (scene prompts) | `env.CONFIG` |
| Static assets | Workers static assets | `env.ASSETS` |
| Email | Cloudflare Email Workers (not yet wired) | tbd |
| Print | D1 `print_jobs` table + local Node agent on Mac mini (polls Worker endpoints) | `env.DB` (shared) |

Resource IDs:
- D1: `nyc-booth-db` (`60a8fb4e-c023-4554-af74-4e2e0eb22565`)
- R2: `nyc-booth-images`
- KV: `nyc-booth-config` (`eb40539962954422a9b409c91b1ee2f9`)
- Workflow class: `CaricatureWorkflow`
- Queue: `nyc-booth-print-queue` (`f1be5951c31248e29770dc4d5498cdbc`) — created but dormant; pivoted to D1-based print jobs

---

## Repo layout

```
nyc-caricature-booth/
├── src/
│   ├── index.ts              # Hono app, all test endpoints, page templates
│   ├── lib/
│   │   ├── moderation.ts     # Llama 3.2 Vision moderation helper (shared)
│   │   ├── flux.ts           # FLUX.2 klein 4B image-gen helper (shared)
│   │   ├── scenes.ts         # Scene type + loadScenes / loadSceneById (KV)
│   │   └── postcard.ts       # 1800×1200 postcard composer + QR PNG encoder
│   ├── session/
│   │   └── session.ts        # SessionDO (one DO per session, hibernating WS)
│   ├── workflows/
│   │   └── caricature.ts     # CaricatureWorkflow (WorkflowEntrypoint)
│   └── styles/
│       └── app.css           # Tailwind input (compiled to public/app.css)
├── public/
│   ├── cloudflare-logo.png   # source logo (used as asset + in watermark)
│   ├── watermark.png         # "I [logo] NY" watermark (built by Python script)
│   └── app.css               # generated Tailwind (gitignored)
├── scripts/
│   └── build-watermark.py    # rebuilds public/watermark.png
├── seed/
│   └── scenes.json           # 6 NYC scene definitions (seeded into KV)
├── migrations/
│   ├── 0001_initial.sql      # sessions table
│   └── 0002_workflow_columns.sql  # adds scene_id, caricature_key, postcard_key, …
├── print-agent/              # standalone Node agent (runs on Mac mini at booth)
│   ├── src/
│   │   ├── index.ts          # poll loop + job handler entry point
│   │   ├── queue.ts          # HTTP pull/ack against Cloudflare Queue API
│   │   └── types.ts          # PrintJobMessage, QueueMessage, AgentConfig
│   ├── .env.example          # credentials template
│   ├── package.json          # tsx runner, separate from root
│   └── tsconfig.json         # Node-oriented TS config
├── wrangler.jsonc            # all bindings + workflow + DO config
├── package.json              # scripts: dev / build:css / deploy
├── .npmrc                    # overrides @cloudflare scope back to npmjs.org
└── HANDOFF.md                # this file
```

---

## Commands cheat sheet

```bash
# Local dev (Tailwind watcher + wrangler in parallel)
npm run dev

# Build CSS once
npm run build:css

# Deploy to production (always builds CSS first)
npm run deploy

# Regenerate Env types after binding changes
npx wrangler types

# Rebuild watermark PNG
python3 scripts/build-watermark.py

# Type check
npx tsc --noEmit

# Trigger a workflow from CLI
curl https://nyc-caricature-booth.examples.workers.dev/api/test-workflow

# Apply D1 migrations
npx wrangler d1 migrations apply nyc-booth-db --remote

# Seed scenes into KV
npx wrangler kv key put --binding=CONFIG --remote scenes --path=seed/scenes.json

# Print agent (run from print-agent/ directory)
cd print-agent && cp .env.example .env  # defaults work out of the box
npm install && npm start
```

---

## Endpoint map

### Kiosk app (Phase 6 — live)
- `GET /kiosk` — idle screen
- `GET /kiosk/capture` — selfie capture (getUserMedia)
- `POST /api/kiosk/selfie` — uploads selfie to R2, returns `{ sessionId, selfieKey }`
- `GET /kiosk/scene` — 2×3 scene picker (server-rendered from KV)
- `GET /kiosk/review` — review screen with "Make my postcard" CTA
- `POST /api/kiosk/start` — validates `{ sessionId, selfieKey, sceneId }`, mints workflow, returns `{ instanceId, statusUrl }`
- `GET /kiosk/status/:instanceId?session=<sid>` — live stepper (SessionDO WebSocket)
- `GET /kiosk/done?session=<sid>` — done screen: postcard, QR, countdown
- `GET /api/kiosk/qr?url=<encoded>` — returns `qrPng(url, 400)` as `image/png` (origin-locked)

### Big screen display (Phase 7 — live)
- `GET /display` — gallery of last 8 completed postcards (30s polling, shimmer, QR)
- `GET /api/display/feed` — JSON feed of last 8 completed sessions for client polling

### Public landing
- `GET /` — branded landing page with links to every test page
- `GET /p/:id` — digital pickup landing (shows postcard for UUID sessions)
- `GET /api/health` — returns `{ status, step }`

### AI / Workflow tests
- `GET /api/test-ai?prompt=...` — text-to-image FLUX.2
- `GET /test-i2i` + `POST /api/test-i2i` — single-scene caricature
- `GET /test-scene-grid` + `POST /api/test-scene-grid` — all 6 scenes in parallel
- `GET /test-scene-grid/:runId` — side-by-side review for a run
- `GET /api/scene-grid-img?key=...` — R2 image proxy (constrained to `prompt-spike/` prefix)
- `GET /api/run-img?key=...` — R2 image proxy (constrained to `runs/` prefix)
- `GET /test-moderate` + `POST /api/test-moderate` — image moderation
- `GET /test-watermark` + `POST /api/test-watermark` — watermark overlay only
- `GET /test-postcard` + `POST /api/test-postcard` — full 1800×1200 postcard + optional QR
- `GET /api/test-workflow` — trigger bare workflow (just `hello` step)
- `GET /api/test-workflow/:id` — workflow instance status
- `GET /test-workflow-moderate` + `POST /api/test-workflow-moderate` — upload selfie + scene → full pipeline (redirects with `?session=<id>`)
- `GET /test-workflow-moderate/:id?session=<sid>` — workflow status page; if `session` is present also subscribes to the SessionDO over WS

### Session DO (per-session live state)
- `POST /api/test-session` — create a new session DO with a random UUID, seed to `queued`
- `GET /api/test-session/:id` — fetch current state
- `POST /api/test-session/:id/status` — mark step (validated state machine). Body: JSON, form-urlencoded, multipart, or `?status=` query
- `DELETE /api/test-session/:id` — force-delete DO storage
- `GET /api/session/:id/ws` — WebSocket upgrade → proxied to the DO's hibernating socket
- `GET /test-session` — landing/create page
- `GET /test-session/:id` — manual driver page with live WebSocket panel

### R2 sanity endpoints
- `GET /api/test-upload` — uploads a tiny PNG
- `GET /api/test-list` — lists R2 objects
- `GET /api/test-get?key=...` — fetches an R2 object

### D1 / KV sanity
- `GET /api/test-db` — inserts a session row, returns 5 most recent
- `GET /api/scenes` — returns 6 scenes from KV

### Print agent (polled by Mac mini)
- `GET /api/print-agent/jobs?limit=5` — returns pending print jobs from D1
- `POST /api/print-agent/jobs/:id/ack` — mark a job `printed` or `failed`
- `GET /api/test-print-job?session=<id>` — seed a print job for an existing completed session (omit `session` for most recent)

All test endpoints stay in place during development — they'll be cleaned up before launch.

---

## Key engineering notes / gotchas

1. **Binding naming:** `env.IMAGES` is **Cloudflare Images** (compositing). R2 bucket is `env.BUCKET`. This used to collide — fixed in step 3.1.
2. **FLUX.2 returns JPEG**, not PNG, despite docs saying "base64 string". The runner sniffs magic bytes and sets the right `content-type`.
3. **Llama 3.2 Vision license:** First call to the model errors with code `5016` asking for "agree". Handler auto-sends `prompt: "agree"`, then retries — see `acceptLlamaVisionLicense` in `src/lib/moderation.ts`. The agree call itself returns the success message as an error; we swallow it.
4. **Llama Vision response shape varies:** Sometimes `{ response: { safe: true } }`, sometimes `{ response: "...string with JSON..." }`. Parser handles both. Fails closed.
5. **Cloudflare Images cannot resize SVG.** QR codes are rasterized via a custom pure-JS PNG encoder (`encodePng`) — `qrcode.toBuffer` uses Node Buffer, which doesn't work in Workers. See `qrPng` in `src/index.ts`.
6. **Workflow payloads must be JSON-serializable and small.** Selfies are uploaded to R2 first; the workflow gets the R2 key (`selfieKey`) only.
7. **File input + loading state pitfall:** Setting `<input type="file">.disabled = true` excludes it from form submission — server sees no file. Use `pointer-events: none` on the form instead. Lesson learned the hard way in step 2.2.
8. **Watermark canvas auto-sizes to content.** Don't hardcode dimensions — the Cloudflare logo PNG is 2.2:1 aspect, so the watermark ended up wider than expected. `scripts/build-watermark.py` measures glyph + logo widths and pads.
9. **`/api/test-workflow` returns different output shape now** after step 4.2 — it's `{ hello: { ... } }` (wrapped) instead of the bare `{ greeting, sessionId, at }`. That's because the new workflow always wraps the hello result in an object so additional steps can be added.
10. **Two UUIDs per run** — the workflow's `instanceId` and the `sessionId` (used as both R2 prefix and SessionDO id) are different UUIDs. The status page URL uses `instanceId` as the path param and `sessionId` as a query param (`?session=`) so it can subscribe to the right SessionDO.
11. **`markSession` in the workflow is best-effort** — failures inside `markSession`/`deleteSession` are caught and logged. The workflow is the source of truth; the SessionDO is just a live UX mirror. Never wrap markSession in a `step.do` (that would replay state transitions on retry).
12. **SessionDO is SQLite-backed but uses KV-style storage today** — `new_sqlite_classes: ["SessionDO"]` in `wrangler.jsonc`. The whole `SessionState` blob lives under one key (`state`) so reads/writes are atomic. SQLite mode preserves the option to add SQL tables later without a class-replacement migration.
13. **SessionDO self-deletes via alarm** — `markStep('done')` and `markStep('errored')` schedule a 5-minute alarm that calls `deleteAll()`. The workflow does NOT call `delete()` explicitly so late-connecting clients still see the final state.
14. **`kioskPage` shell uses `min-h-[100dvh] overscroll-none`** (not `h-full overflow-hidden`) so short desktop viewports don't clip content. iPad-locked feel comes from `overscroll-none` + `user-scalable=no` + `select-none touch-manipulation`, not from blocking overflow.
15. **Capture screen mirrors the preview UI but NOT the canvas frame.** The `<video>` and frozen `<img>` previews use `-scale-x-100` so the user sees themselves naturally; the canvas-to-blob capture path draws the un-mirrored frame so text on shirts stays readable for FLUX/moderation.
16. **Two storage prefixes for R2 selfies now:** legacy `workflow-test/<sessionId>/selfie.<ext>` (used by `/test-workflow-moderate` POST) and `kiosk/<sessionId>/selfie.jpg` (used by the new kiosk capture screen). `/api/run-img` accepts both `runs/` and `kiosk/` prefixes; the `workflow-test/` prefix is intentionally NOT readable through that proxy (test endpoints don't render uploaded selfies).
17. **Kiosk session id is minted by the upload endpoint, not the client.** `POST /api/kiosk/selfie` generates `crypto.randomUUID()`, returns it, and the client stashes it. `POST /api/kiosk/start` passes that same sessionId so the SessionDO ID matches the R2 prefix matches the digital-pickup URL.
18. **`/api/scenes` returns `{ count, scenes: [...] }`, not a bare array.** Don't accidentally iterate the wrapper object on the client — always read `.scenes`. The scene picker renders server-side to avoid this entirely; only the QR/done flow references it.
19. **`state.sessionId` from the SessionDO can be `"(unset)"`** if the DO seeds itself via `ensureState` before the workflow's first `markStep` call. Always prefer the server-injected `sessionId` from the `?session=` query param (confirmed UUID) over `state.sessionId` from the WS frame when building redirect URLs or stashing to sessionStorage. This was the root cause of the QR-unavailable bug on `/kiosk/done`.
20. **Printed postcard has no QR baked in** (removed in step 6.6). The QR for digital pickup lives only on the `/kiosk/done` screen (header, top-right, points to `/p/:sessionId`). The `/test-postcard` dev endpoint still passes `qrUrl` to `buildPostcard` so the QR feature is still testable.
21. **`/api/kiosk/qr` is origin-locked.** The `url` param must start with the Worker's own origin or the endpoint returns 403. This prevents it being used as an open QR-code proxy.
22. **Print jobs use D1, not Cloudflare Queues.** A Queue was created in step 8.1 but we pivoted to D1-based `print_jobs` because: (a) the Mac mini agent is external and would need an API token to use the Queue HTTP pull API, (b) for a single-booth activation the Queue adds complexity without benefit, (c) D1 gives a persistent audit log for the admin dashboard. The Queue (`nyc-booth-print-queue`) still exists but is dormant — no producer binding, nothing writes to it.
23. **The workflow's `store` step batches two D1 writes** — the session upsert and the print_jobs insert run in a single `DB.batch()` call. If either fails, the step retries both (idempotent via `ON CONFLICT` on sessions; print_jobs gets a new row on retry, but the agent handles duplicates by session_id).
24. **Print agent endpoints are unauthenticated.** `/api/print-agent/jobs` and `/api/print-agent/jobs/:id/ack` have no auth gate. This is acceptable for an event activation on a private network, but should be locked down before any public deployment (Phase 10 auth gate will cover this).

---

## Full incremental plan (status)

### Phase 0 — Project Setup ✅
- 0.1 Initialize Worker + Hono
- 0.2 Tailwind + base layout
- 0.3 Deploy to `examples.workers.dev`

### Phase 1 — Storage Foundation ✅
- 1.1 R2 bucket
- 1.2 D1 database
- 1.3 KV namespace + seed scenes

### Phase 2 — AI Generation Spike ✅
- 2.1 Workers AI hello world (FLUX.2 klein 4B)
- 2.2 Image-to-image with selfie
- 2.3 Lock scene prompts (parallel scene grid review)
- 2.4 Content moderation check (Llama 3.2 Vision)

### Phase 3 — Watermark Composition ✅
- 3.1 Watermark overlay endpoint
- 3.2 Postcard format (1800×1200 @ 300 DPI)
- 3.3 QR code on postcards + `/p/:id` placeholder

### Phase 4 — Workflow Pipeline ✅
- 4.1 ✅ Bare workflow skeleton (`hello` step)
- 4.2 ✅ Add moderate step (selfie via R2 key)
- 4.3 ✅ Add generate step with retries
- 4.4 ✅ Add composite + store steps (full pipeline)

### Phase 5 — Session Durable Object ✅
- 5.1 ✅ Bare SessionDO with getState + setStatus
- 5.2 ✅ Validated state machine + self-delete alarm
- 5.3 ✅ WebSocket endpoint (hibernation API)
- 5.4 ✅ Workflow pushes live state to SessionDO end-to-end

### Phase 6 — Kiosk App (iPad) ✅
- 6.1 ✅ Idle screen
- 6.2 ✅ Camera capture screen (getUserMedia + R2 upload)
- 6.3 ✅ Scene picker (2×3 grid, server-rendered from KV)
- 6.4 ✅ Review screen + POST /api/kiosk/start workflow trigger
- 6.5 ✅ Live status screen (4-step stepper, SessionDO WebSocket)
- 6.6 ✅ Done screen (postcard, QR, 60s countdown, auto-return to idle)

### Phase 7 — Big Screen App ✅
- 7.1 ✅ Static gallery layout (recent caricatures + QR + project info)
- 7.2 ✅ Periodic refresh from D1 for new finished postcards
- 7.3 ✅ Idle animation / branding pass

### Phase 8 — Print Queue + Agent ✅
- 8.1 ✅ ~~Cloudflare Queue binding~~ (created but pivoted to D1)
- 8.2 ✅ Workflow writes `print_jobs` row in D1 (batched with session insert)
- 8.3 ✅ Print agent skeleton (Node script polling Worker endpoints, no API token needed)
- 8.4 ✅ Agent downloads postcard via `/api/run-img` + writes 4×6" print-ready PDF (pdf-lib)
- 8.5 ✅ Mock printer driver (`Printer` interface + `MockPrinter` with spool dir)
- 8.6 ✅ DNP DS620A driver (`DnpDs620Printer` via CUPS/lp, env-selectable)

### Phase 9 — Digital Copy
- 9.1 Landing page route
- 9.2 Email opt-in form
- 9.3 Cloudflare Email integration
- 9.4 QR verification on actual postcard

### Phase 10 — Admin Dashboard
- 10.1 Auth gate
- 10.2 Live booth state
- 10.3 Stats panel
- 10.4 Manual controls

### Phase 11 — Hardening & Polish
- 11.1 Error states
- 11.2 Privacy notice on kiosk
- 11.3 R2 lifecycle rule for 30-day retention
- 11.4 Analytics Engine for metrics

### Phase 12 — Load Test + Dry Run
- 12.1 Synthetic load test
- 12.2 Full hardware dry run
- 12.3 Staff walkthrough

---

## Pending product decisions

1. **Printer model** — ✅ Decided: **DNP DS620A**. Driver implemented (`DnpDs620Printer`). Set `PRINTER_DRIVER=dnp` and `PRINTER_NAME=<CUPS name>` in `print-agent/.env`. Find the CUPS name with `lpstat -p -d` after installing the DNP macOS driver.
2. **Designer assets** — DevRel resources will be sourced; build with Cloudflare brand defaults in the meantime.
3. **Scene prompts** — Locked in `seed/scenes.json`. May need refinement after step 2.3 visual review (user has not yet flagged issues).
4. **Big screen reveal animation** — design pass during week 2.
5. **Privacy copy / ToS micro-text** — needs legal review before event.

---

## Phase 7 plan (complete ✅)

Big Screen App — a separate display (TV/monitor) that shows a gallery of
recently completed caricatures + project info + QR to start a session.
No real-time per-session feed (that's the iPad's job). Refreshes on a slow
interval from D1.

Agreed scope (slimmed down from original plan — see architectural pivot):

### 7.1 — Static gallery layout
- New route `GET /display` using the standard `page()` shell (not `kioskPage`)
- Shows the last 6–8 completed postcards from D1 (`SELECT * FROM sessions WHERE status='completed' ORDER BY completed_at DESC LIMIT 8`)
- Each card: postcard image from R2 via `/api/run-img`, scene name, timestamp
- Cloudflare brand header + "I 🧡 NY" wordmark + "Tap below to get yours" CTA
- No interactivity — this is a passive display

### 7.2 — Periodic refresh
- Client-side `setInterval` every 30s that re-fetches a new `/api/display/feed`
  endpoint returning `{ sessions: [...] }` from D1
- Only re-renders cards that changed (diff by sessionId) to avoid flash
- Add `GET /api/display/feed` that returns the last 8 completed sessions
  (sessionId, sceneId, sceneName, postcardKey, completedAt)

### 7.3 — Branding pass
- Idle animation (subtle shimmer / floating particles in brand colours)
- "Built end-to-end on Cloudflare" tech badge
- QR pointing to the production URL for people who want to learn more
