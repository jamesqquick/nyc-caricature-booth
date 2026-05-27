# Caricature Booth

An AI-powered photo booth built entirely on Cloudflare. Attendees take a selfie, pick a scene, and get a hand-drawn ink caricature printed on a physical 4×6 postcard — in about 30–90 seconds.

## What it does

1. An iPad kiosk opens the camera — the attendee takes a selfie
2. They pick from a set of configurable scenes
3. A durable AI pipeline runs on Cloudflare: moderates the photo, generates a caricature via Replicate, and composites a final postcard
4. A physical DNP dye-sub printer at the booth prints the postcard
5. The attendee also gets a digital pickup link (QR code) to keep their postcard

## Tech stack

### Worker (the main application)

| Technology | Role |
|---|---|
| **Cloudflare Workers** | Runtime — the entire app runs as a single Worker |
| **Hono** | HTTP routing framework |
| **TypeScript** | Language throughout |
| **TailwindCSS v4** | Styling, compiled to `public/app.css` |

### Cloudflare services

| Service | Binding | Purpose |
|---|---|---|
| **D1** | `DB` | SQLite — sessions, print jobs, events, scenes |
| **R2** | `BUCKET` | Object storage for selfies, caricatures, and postcards |
| **KV** (`nyc-booth-config`) | `CONFIG` | Scene definitions cache (60s TTL) |
| **Workers AI** | `AI` | Llama 3.2 11B Vision for content moderation |
| **Workflows** | `CARICATURE_WORKFLOW` | Durable 4-step AI pipeline per session |
| **Durable Objects** | `SESSION` | Per-session WebSocket fan-out and state machine |
| **Cloudflare Images** | `IMAGES` | Postcard crop, resize, and watermark compositing |
| **Analytics Engine** | `ANALYTICS` | Event telemetry, viewable at `/admin/metrics` |
| **Email Sending** | `EMAIL` | Digital postcard delivery (stubbed) |

### External services

| Service | Purpose |
|---|---|
| **Replicate** (`google/nano-banana` / Gemini 2.5 Flash Image) | Caricature generation model |

### Print agent (Node.js, runs locally at the booth)

| Technology | Role |
|---|---|
| **tsx** | TypeScript execution |
| **pdf-lib** | Wraps the JPEG postcard in a print-ready 4×6" PDF |
| **CUPS (`lp`)** | Sends PDFs to the physical DNP DS620A printer |

## How it works

### Architecture overview

```
iPad browser
  → POST /api/kiosk/selfie     → R2 (stores selfie)
  → POST /api/kiosk/start      → triggers CaricatureWorkflow
  → WebSocket /api/session/:id → SessionDO (live status updates)

CaricatureWorkflow (Cloudflare Workflows)
  step 1: moderate   → Workers AI (Llama 3.2 Vision)
  step 2: generate   → Replicate API (caricature model)
  step 3: composite  → Cloudflare Images (crop + overlay)
  step 4: store      → D1 (upserts completed session)

  after each step → SessionDO.markStep() → broadcast to WebSocket clients

Laptop (print-agent)
  → polls /api/print-agent/jobs every 5s
  → downloads postcard from /api/run-img
  → builds PDF, sends to CUPS
  → POST /api/print-agent/ack/:id
```

### Session state machine

The `SessionDO` Durable Object tracks each session through a state machine and pushes updates to any connected WebSocket clients (the kiosk status screen):

```
queued → moderating → generating → compositing → done
  └─────────────────────────────────────────────→ errored
```

The DO self-deletes 5 minutes after reaching a terminal state.

### Key source files

```
src/
  index.ts                    — root Hono app, mounts all routes
  workflows/caricature.ts     — 4-step durable AI pipeline
  session/session.ts          — SessionDO: WebSocket fan-out, state machine
  lib/
    replicate.ts              — polls Replicate API for caricature generation
    moderation.ts             — content moderation via Workers AI
    postcard.ts               — Cloudflare Images compositing + QR encoding
    event-ctx.ts              — loads event + scenes from KV/D1
    analytics.ts              — Analytics Engine writes and queries
  routes/
    event/
      kiosk-*.ts              — kiosk page handlers (idle, capture, scene, review, status, done)
      kiosk-api.ts            — POST endpoints for selfie upload, session start, print request
      session-ws.ts           — WebSocket upgrade proxy → SessionDO
      gallery.ts              — public event gallery
      pickup.ts               — digital postcard pickup page (/p/:id)
    admin-dashboard.ts        — live session table + admin actions
    print-agent.ts            — print job queue endpoints
print-agent/
  src/index.ts                — poll loop, job handler
  src/pdf.ts                  — builds print-ready PDF via pdf-lib
  src/printer.ts              — printer abstraction (mock | dnp)
migrations/                   — D1 schema migrations
```

## Local development

### Prerequisites

- Node.js 18+
- A Cloudflare account with the services listed above provisioned
- A Replicate API token

### Setup

```bash
npm install
```

Create a `.dev.vars` file in the project root with your secrets:

```
REPLICATE_API_TOKEN=your_token_here
ADMIN_PASSWORD=your_admin_password
```

### Run locally

```bash
npm run dev
```

This runs TailwindCSS in watch mode and `wrangler dev` concurrently.

### Deploy

```bash
npm run deploy
```

Builds CSS and deploys to Cloudflare Workers.

### Generate types

```bash
npm run cf-typegen
```

Regenerates `worker-configuration.d.ts` from your `wrangler.jsonc` bindings.

## Print agent setup

The print agent is a separate Node.js process that runs on a laptop at the booth.

```bash
cd print-agent
```

Create `print-agent/.env`:

```
WORKER_URL=https://your-worker.workers.dev
PRINTER_DRIVER=dnp
PRINTER_NAME=DNP_DS620
```

Start the agent:

```bash
npm start
```

Run `lpstat -p -d` to find the correct CUPS printer name if `DNP_DS620` doesn't match.

## Admin dashboard

Available at `/admin` (password-protected). Shows:

- Stat cards: total sessions, completed, errored, avg pipeline time, prints
- Live session table with per-row actions (retry print, resend email, delete)
- Analytics at `/admin/metrics`
- "Seed test print job" link to verify the end-to-end print path before an event

## Database

D1 migrations live in `migrations/`. Apply them with:

```bash
wrangler d1 migrations apply <your-database-name>
```

## Scenes configuration

Scenes are loaded from KV. If the scene picker is blank, use the **Re-seed scenes** button in the admin dashboard to restore the KV entries.

## Docs

- [Booth Operations Guide](docs/booth-ops.md) — event day runbook: startup checklist, troubleshooting, admin dashboard reference
