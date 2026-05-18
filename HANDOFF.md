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

## Current status — Step 4.2 complete

Most recent commits:
```
c4160ed fix: stop elapsed timer when workflow reaches terminal status
9eb9f2b feat: add moderate step to caricature workflow (step 4.2)
45e8ece feat: add bare Cloudflare Workflow skeleton (step 4.1)
64086b9 feat: add QR code to postcards + /p/:id digital pickup landing (step 3.3)
f9ec89e feat: postcard format pipeline — 1800x1200 @ 300 DPI with watermark (step 3.2)
8a99995 fix: watermark canvas now auto-sizes to content + uses textbbox for accurate glyph placement
c480a9d feat: watermark overlay via Cloudflare Images binding (step 3.1)
9588d77 feat: add content moderation via Llama 3.2 Vision with license auto-accept (step 2.4)
a734c81 feat: scene-grid prompt spike — generate all 6 scenes in parallel + review page (step 2.3)
f197a48 feat: image-to-image endpoint with selfie + scene picker form (step 2.2)
de7f8fc feat: add Workers AI binding + FLUX.2 klein 4B test-ai endpoint (step 2.1)
```

**Next up:** Step 4.3 — Add generate step with retries to the workflow.

---

## Tech stack

| Layer | Choice | Binding |
|---|---|---|
| Frontend | Hono-rendered HTML + Tailwind v4 (built via standalone CLI) | n/a |
| API | Workers + Hono | n/a |
| Workflow orchestration | Cloudflare Workflows | `env.CARICATURE_WORKFLOW` |
| AI generation | Workers AI — `@cf/black-forest-labs/flux-2-klein-4b` (image-to-image, sub-2s) | `env.AI` |
| Content moderation | Workers AI — `@cf/meta/llama-3.2-11b-vision-instruct` | `env.AI` |
| Image composition | Cloudflare Images binding (watermark, resize, QR draw) | `env.IMAGES` |
| Object storage | R2 (selfies, caricatures, postcards) | `env.BUCKET` |
| Metadata DB | D1 | `env.DB` |
| Config | KV (scene prompts) | `env.CONFIG` |
| Static assets | Workers static assets | `env.ASSETS` |
| Email | Cloudflare Email Workers (not yet wired) | tbd |
| Print | Local Node agent on Mac mini polling a DO over WS | not built yet |

Resource IDs:
- D1: `nyc-booth-db` (`60a8fb4e-c023-4554-af74-4e2e0eb22565`)
- R2: `nyc-booth-images`
- KV: `nyc-booth-config` (`eb40539962954422a9b409c91b1ee2f9`)
- Workflow class: `CaricatureWorkflow`

---

## Repo layout

```
nyc-caricature-booth/
├── src/
│   ├── index.ts              # Hono app, all test endpoints, page templates
│   ├── lib/
│   │   └── moderation.ts     # Llama 3.2 Vision moderation helper (shared)
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
│   └── 0001_initial.sql      # sessions table
├── wrangler.jsonc            # all bindings + workflow config
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
```

---

## Endpoint map

### Public landing
- `GET /` — branded landing page with links to every test page
- `GET /p/:id` — placeholder digital pickup landing (validates ID format)
- `GET /api/health` — returns `{ status, step }`

### AI / Workflow tests
- `GET /api/test-ai?prompt=...` — text-to-image FLUX.2
- `GET /test-i2i` + `POST /api/test-i2i` — single-scene caricature
- `GET /test-scene-grid` + `POST /api/test-scene-grid` — all 6 scenes in parallel
- `GET /test-scene-grid/:runId` — side-by-side review for a run
- `GET /api/scene-grid-img?key=...` — R2 image proxy (constrained to `prompt-spike/` prefix)
- `GET /test-moderate` + `POST /api/test-moderate` — image moderation
- `GET /test-watermark` + `POST /api/test-watermark` — watermark overlay only
- `GET /test-postcard` + `POST /api/test-postcard` — full 1800×1200 postcard + optional QR
- `GET /api/test-workflow` — trigger bare workflow (just `hello` step)
- `GET /api/test-workflow/:id` — workflow instance status
- `GET /test-workflow-moderate` + `POST /api/test-workflow-moderate` — upload selfie → workflow with moderate step
- `GET /test-workflow-moderate/:id` — live-polling status page

### R2 sanity endpoints
- `GET /api/test-upload` — uploads a tiny PNG
- `GET /api/test-list` — lists R2 objects
- `GET /api/test-get?key=...` — fetches an R2 object

### D1 / KV sanity
- `GET /api/test-db` — inserts a session row, returns 5 most recent
- `GET /api/scenes` — returns 6 scenes from KV

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

### Phase 4 — Workflow Pipeline 🚧
- 4.1 ✅ Bare workflow skeleton (`hello` step)
- 4.2 ✅ Add moderate step (selfie via R2 key)
- 4.3 ⏳ **NEXT** — Add generate step with retries
- 4.4 Add composite + store steps (full pipeline)

### Phase 5 — Booth Durable Object
- 5.1 Bare DO with state
- 5.2 State transitions
- 5.3 WebSocket endpoint
- 5.4 Connect Workflow to DO

### Phase 6 — Kiosk App (iPad)
- 6.1 Idle screen
- 6.2 Camera capture screen
- 6.3 Scene picker screen
- 6.4 Submit to backend
- 6.5 Status screen with WebSocket
- 6.6 Done screen

### Phase 7 — Big Screen App
- 7.1 Idle slideshow
- 7.2 Connect to Booth DO via WebSocket
- 7.3 Active mode — generating
- 7.4 Active mode — reveal
- 7.5 Return to idle

### Phase 8 — Print Queue + Agent
- 8.1 Print Queue DO
- 8.2 Workflow enqueues print job
- 8.3 Print agent skeleton (Node script)
- 8.4 Agent downloads + writes PDF
- 8.5 Mock printer driver
- 8.6 Real printer integration (printer model TBD)

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

1. **Printer model** — TBD. `Printer` interface in print agent will be left as a placeholder until decided. Recommendation: DNP DS620 (event-industry standard, ~8-12s/print, CUPS-compatible on macOS).
2. **Designer assets** — DevRel resources will be sourced; build with Cloudflare brand defaults in the meantime.
3. **Scene prompts** — Locked in `seed/scenes.json`. May need refinement after step 2.3 visual review (user has not yet flagged issues).
4. **Big screen reveal animation** — design pass during week 2.
5. **Privacy copy / ToS micro-text** — needs legal review before event.

---

## Step 4.3 plan (next up)

Extend the workflow with a `generate` step:

1. Add `sceneId` to `CaricaturePayload`
2. After `moderate` passes, fetch the selfie bytes from R2 + the scene prompt from KV
3. Call FLUX.2 image-to-image with the selfie as `input_image_0`
4. Save the caricature to R2 at `runs/<sessionId>/caricature.jpg`
5. Step uses 2 retries with exponential backoff
6. Update `/test-workflow-moderate` form to also pick a scene
7. Verify by:
   - Trigger with a clean selfie + scene → workflow output includes `generate.caricatureKey`
   - Force a failure (mock?) → see 2 retries in workflow dashboard

Use the existing `runFlux` helper in `src/index.ts` — likely needs to be moved to `src/lib/flux.ts` so the workflow can import it. Apply the same extraction pattern as `src/lib/moderation.ts`.
