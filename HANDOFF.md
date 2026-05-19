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

## Current status — Phase 10 complete ✅

Most recent commits:
```
a165a5b  feat(admin): force-reprint endpoint that bypasses idempotency
20ec773  feat(admin): always show Retry print on completed rows
38d4583  feat(admin): real toast notifications via Notyf CDN
3b0a5b2  fix: unify admin timestamp formatting via client-side <time data-ts>
bdda212  feat: admin manual controls — retry print, resend email, re-seed (step 10.4)
9036f13  feat: admin stats panel + /api/admin/stats (step 10.3)
62951d9  feat: admin dashboard live sessions table + JSON feed (step 10.2)
171b100  feat: admin auth gate with signed cookie middleware (step 10.1)
```

**Next up:** Phase 11 — Hardening & Polish.

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
see gotcha #22). **Printing is opt-in:** the workflow's `store` step writes
only the session upsert; print jobs are enqueued by `POST /api/kiosk/print`
when the attendee taps "Print my postcard" on `/kiosk/done` (see gotcha #25).

- **Worker endpoints:** `GET /api/print-agent/jobs` (pending jobs) +
  `POST /api/print-agent/jobs/:id/ack` (mark printed/failed)
- **User-initiated enqueue:** `POST /api/kiosk/print` validates the session
  is completed + has a postcard and inserts a `print_jobs` row. Idempotent:
  existing pending/printing/printed jobs return `alreadyQueued` without
  re-inserting; only `failed` jobs are considered re-queuable.
- **Print agent:** standalone Node/tsx script in `print-agent/`. Polls the
  Worker, downloads the postcard JPEG via `/api/run-img`, wraps it in a
  4×6" PDF (pdf-lib), sends to the `Printer` driver, acks the job.
- **Printer drivers:** `Printer` interface with `print(pdfBytes, jobId)`.
  Two implementations:
  - `MockPrinter` — simulated delay + writes to `spool/` dir (default)
  - `DnpDs620Printer` — sends PDF to DNP DS620A via CUPS `lp` command
  Select via env: `PRINTER_DRIVER=mock|dnp`, `PRINTER_NAME=<CUPS name>`
- **No auth on agent endpoints** — `/api/print-agent/jobs` and
  `/api/print-agent/jobs/:id/ack` remain unauthenticated even after Phase 10.
  The admin middleware only gates `/admin/*` and `/api/admin/*`. Acceptable
  for an event on a private network; if the booth ever runs over the open
  internet, add a shared-secret header check on the agent endpoints.
- **Test endpoint:** `GET /api/test-print-job?session=<id>` seeds a print
  job for any existing completed session (useful for dev/testing).

### Phase 9 — digital copy ✅

The `/p/:id` route is the attendee-facing digital pickup landing. Scanned via
the QR on `/kiosk/done` or accessed from a shared link.

- Queries D1 for session metadata (scene_name, postcard_key, completed_at, email)
- Three states: **completed** (full landing with postcard, Download, Share, email
  opt-in), **in-progress** (spinner + auto-refresh), **not found** (branded 404)
- `POST /api/p/:id/email` captures email opt-in → stored in D1 → fires
  `sendPostcardEmail()` via `waitUntil` (currently stubbed — see gotcha #26)
- Download button uses `?download=1` on `/api/run-img` which sets
  `content-disposition: attachment` with a friendly filename
- Share button uses `navigator.share` on mobile, clipboard copy on desktop
- Branded 404 covers all `/p/*` paths — truncated UUIDs, typos, bare `/p`,
  nested `/p/foo/bar`
- Print button on `/kiosk/done` is opt-in: `POST /api/kiosk/print` with
  idempotency + 2s status polling via `GET /api/kiosk/print/:jobId/status`

### Phase 10 — admin dashboard ✅

The `/admin` route is a staff-only dashboard for the event. Cookie-gated; the
only secret it relies on is the `ADMIN_PASSWORD` Worker secret.

- **Auth gate** — `src/lib/admin-auth.ts` mints `<timestampMs>.<hmac-sha256>`
  tokens signed with the admin password. Cookie is `HttpOnly`, `Secure`,
  `SameSite=Strict`, 24h `Max-Age`. Middleware on `/admin/*` (browser redirect
  to `/admin/login`) and `/api/admin/*` (401 JSON). Rotating the secret
  instantly invalidates every existing cookie.
- **Live sessions table** — server-renders the last 30 sessions from D1
  joined to their most recent `print_jobs` row via correlated subqueries.
  Columns: short session id, status pill, scene, created, pipeline duration,
  masked email (`jam***@example.com`), print pill, per-row actions.
- **Stats panel** — six cards above the table (total, completed, errored,
  avg pipeline, emails collected, postcards printed) plus a "Sessions by
  scene" pill row. Three D1 statements run via `db.batch()`: aggregate
  counts over `sessions` (`COUNT(CASE WHEN …)` + `AVG`), a single count
  over `print_jobs`, and a `GROUP BY scene_id` breakdown.
- **Manual controls** —
  - `POST /api/admin/reprint/:id` — force a new print job (bypasses the
    kiosk endpoint's idempotency check; see gotcha #27).
  - `POST /api/admin/resend-email/:id` — re-fires `sendPostcardEmail()`
    via `waitUntil` (stubbed body — see gotcha #26).
  - `POST /api/admin/reseed-scenes` — writes the bundled `seed/scenes.json`
    into KV. Bundle is captured at deploy time (see gotcha #29).
  - Top-level "Seed test print job" link to existing `GET /api/test-print-job`.
- **Auto-refresh** — both `/api/admin/sessions` and `/api/admin/stats`
  polled every 10s and rendered into the same DOM as the initial paint.
- **Toasts** — Notyf via CDN (see gotcha #28).
- **Time formatting** — server emits `<time data-ts="<unix-secs>">`
  placeholders; one client-side `fmtTs()` formats them in the viewer's
  locale on load + after every poll, so there's never a format flip.

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
| Email | Cloudflare Email Service (`send_email` binding, currently stubbed — see gotcha #26) | `env.EMAIL` |
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
│   ├── env.d.ts              # Ambient Env augmentation for secrets (ADMIN_PASSWORD)
│   ├── lib/
│   │   ├── moderation.ts     # Llama 3.2 Vision moderation helper (shared)
│   │   ├── flux.ts           # FLUX.2 klein 4B image-gen helper (shared)
│   │   ├── scenes.ts         # Scene type + loadScenes / loadSceneById (KV)
│   │   ├── postcard.ts       # 1800×1200 postcard composer + QR PNG encoder
│   │   ├── email.ts          # Postcard email helper (stubbed — see gotcha #26)
│   │   ├── admin-auth.ts     # HMAC cookie signing + Hono auth middleware (10.1)
│   │   └── admin-data.ts     # loadAdminSessions + loadAdminStats (10.2/10.3)
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

# Set or rotate the admin dashboard password
npx wrangler secret put ADMIN_PASSWORD
# (current value: see 1Password or local notes — not committed)

# Verify the secret is set
npx wrangler secret list
```

---

## Admin dashboard (Phase 10)

Lives at **`/admin`**, password-gated. The cookie lasts 24h.

- **Sign in:** `/admin/login` (password is the `ADMIN_PASSWORD` Worker secret).
- **Sign out:** `/admin/logout` (top-right link clears the cookie).
- **Auto-refresh:** the table + stats poll every 10s. The footer shows the
  last refresh time in the viewer's locale.
- **Per-row actions** (visible on completed sessions):
  - 🖨️ **Retry print** — always queues a new physical print, even on already-printed
    rows. Use this when a postcard jams, prints badly, or the attendee asks
    for a second copy. Calls `POST /api/admin/reprint/:id` (unconditional —
    NOT the idempotent kiosk endpoint, see gotcha #27).
  - 📧 **Resend email** — re-fires the digital-copy email for sessions that
    opted in. Currently a no-op in terms of actual send (email is stubbed —
    see gotcha #26) but the wiring is complete.
- **Top-level controls:**
  - 🧪 **Seed test print job** — opens `/api/test-print-job` in a new tab.
    Inserts a `pending` row against the most recent completed session;
    the print agent picks it up on its next poll.
  - ♻️ **Re-seed scenes** — pushes the bundled `seed/scenes.json` into KV.
    Requires a `wrangler deploy` first if you've edited the JSON (see gotcha #29).
- **Toasts:** Notyf via CDN. Slide-in from the bottom-right, click to dismiss.

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
- `GET /kiosk/done?session=<sid>` — done screen: postcard, QR, opt-in Print button (polls for completion), countdown
- `POST /api/kiosk/print` — body `{ sessionId }`, enqueues a `print_jobs` row (idempotent)
- `GET /api/kiosk/print/:jobId/status` — returns `{ status, printedAt?, errorMsg? }` — polled by /kiosk/done every 2s
- `GET /api/kiosk/qr?url=<encoded>` — returns `qrPng(url, 400)` as `image/png` (origin-locked)

### Big screen display (Phase 7 — live)
- `GET /display` — gallery of last 8 completed postcards (30s polling, shimmer, QR)
- `GET /api/display/feed` — JSON feed of last 8 completed sessions for client polling

### Admin dashboard (Phase 10 — live)
- `GET /admin/login` — password form (uses `page()` shell)
- `POST /admin/login` — verify password, set signed cookie, redirect to `next`
- `GET /admin/logout` — clear cookie, redirect to `/admin/login`
- `GET /admin` — dashboard: stat cards, sessions-by-scene pills, last 30
  sessions table with per-row actions
- `GET /api/admin/sessions` — last 30 sessions joined to most-recent print
  job; polled every 10s from `/admin`
- `GET /api/admin/stats` — aggregate counts + AVG pipeline + scene breakdown
- `POST /api/admin/reprint/:id` — force a fresh print job (no idempotency,
  use this from staff tools, NOT `/api/kiosk/print`)
- `POST /api/admin/resend-email/:id` — re-fire `sendPostcardEmail()` via
  `waitUntil` for a session with an email on file
- `POST /api/admin/reseed-scenes` — push bundled `seed/scenes.json` into KV

### Public landing
- `GET /` — branded landing page with links to every test page
- `GET /p/:id` — digital pickup landing (shows postcard for UUID sessions, email opt-in form, download, share)
- `POST /api/p/:id/email` — body `{ email }`, stores email opt-in in D1 + triggers postcard email (stubbed)
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
23. **The workflow's `store` step writes ONLY the session upsert** — no print_jobs INSERT anymore (changed during Phase 9.1 review). Originally batched both in a single `DB.batch()` call; now printing is user-initiated so the workflow only persists the session row. Idempotent via `ON CONFLICT` on retries.
24. **Print agent endpoints stay unauthenticated.** `/api/print-agent/jobs` and `/api/print-agent/jobs/:id/ack` have no auth gate, and Phase 10's auth middleware does NOT cover them (only `/admin/*` and `/api/admin/*` are gated). Acceptable for an event activation on a private network. Before any public deployment add a shared-secret header check on the agent endpoints — the Mac mini agent can carry it in `.env`.
25. **Printing is opt-in (`POST /api/kiosk/print`).** Attendees tap "Print my postcard" on `/kiosk/done`; only then does a `print_jobs` row get inserted. The endpoint is idempotent — existing pending/printing/printed jobs for the same session_id return `alreadyQueued: true` without re-inserting. Only `failed` jobs can be re-queued. Anyone who only wants the digital copy (QR + `/p/:id`) never produces a print_jobs row at all, which keeps the audit log honest about what was actually printed.
26. **Email sending is stubbed.** The `send_email` binding (`env.EMAIL`) is wired and the `sendPostcardEmail` helper in `src/lib/email.ts` composes a full HTML + text email, but it currently logs to console instead of calling `env.EMAIL.send()`. To enable real sending: (a) onboard a domain to Cloudflare Email Service + add SPF/DKIM DNS records, (b) update `FROM_ADDRESS` in `src/lib/email.ts`, (c) uncomment the real send block and remove the stub. The email is fired via `waitUntil` on opt-in — failures don't block the API response.
27. **Two print endpoints exist on purpose.** `POST /api/kiosk/print` is **idempotent** — only inserts a `print_jobs` row if no `pending`/`printing`/`printed` job exists for that session (only `failed` is re-queuable). That protects the public kiosk button from spam-tap duplicates. `POST /api/admin/reprint/:id` (Phase 10.4) is **unconditional** — always inserts a new row regardless of what's already there. Staff need this for physical jams, blurry copies, second postcards, or recovering when D1 says `printed` but the agent crashed mid-print. The admin "Retry print" button calls the admin endpoint, NOT the kiosk endpoint. Never wire admin UIs to `/api/kiosk/print`.
28. **Admin cookie is `Secure`, so it won't be set on plain HTTP.** Local `wrangler dev` runs on `http://localhost:8787` by default; logging in there will appear to "work" (303 response) but the browser silently drops the `Secure` cookie and you'll be bounced back to `/admin/login`. Two workarounds: (a) run wrangler with HTTPS, or (b) temporarily flip the `Secure` flag in `src/lib/admin-auth.ts` for local dev. Production is fine — Workers always serves over HTTPS.
29. **`seed/scenes.json` is imported into the Worker bundle**, not read at runtime. `src/index.ts` does `import scenesSeed from "../seed/scenes.json"` so the JSON is captured at build time and shipped inside the Worker. `POST /api/admin/reseed-scenes` writes that bundled copy into KV. Editing `seed/scenes.json` requires a `wrangler deploy` to take effect; running the admin "Re-seed scenes" button against an old deploy will write the old scenes. `tsconfig.json` has `resolveJsonModule: true` for the import to type-check.
30. **Worker secrets aren't picked up by `wrangler types`.** `npx wrangler types` only generates bindings declared in `wrangler.jsonc`. Secrets set via `wrangler secret put` (like `ADMIN_PASSWORD`) need a manual TypeScript augmentation. `src/env.d.ts` declares `interface Env { ADMIN_PASSWORD: string }` and `tsconfig.json`'s `include` lists `src/**/*.d.ts` so it's picked up alongside the generated `worker-configuration.d.ts`. Re-running `wrangler types` won't wipe it because it lives in a separate file. Add future secrets the same way.

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

### Phase 9 — Digital Copy ✅
- 9.1 ✅ Landing page route (`/p/:id` — D1 lookup, postcard, download, share, branded 404 states)
- 9.2 ✅ Email opt-in form (POST /api/p/:id/email, stores in D1, server-rendered states)
- 9.3 ✅ Cloudflare Email integration (send_email binding + stubbed sender — see gotcha #26)
- 9.4 ✅ QR verification (QR removed from printed postcard in 6.6; digital QR on /kiosk/done works end-to-end)

### Phase 10 — Admin Dashboard ✅
- 10.1 ✅ Auth gate (signed cookie + Hono middleware)
- 10.2 ✅ Live booth state (last 30 sessions table + `/api/admin/sessions`)
- 10.3 ✅ Stats panel (six stat cards + scene breakdown + `/api/admin/stats`)
- 10.4 ✅ Manual controls (force reprint, resend email, re-seed scenes, seed test print job)

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
