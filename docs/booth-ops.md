# Booth Operations Guide

Event-day runbook for the **print agent** — the piece that turns a finished
caricature into a physical 4×6" print at the booth. This guide covers setup,
startup, health checks, and troubleshooting for the print service specifically.

> The Worker, kiosk, admin dashboard, and database are deployed and managed
> separately. This guide assumes those are already up and focuses only on the
> print agent.

## What the print agent is

The print agent is a small standalone Node.js process that runs on a **macOS
laptop at the booth**. It is a polling client: on a fixed interval it asks the
Worker for pending print jobs for one event, renders each finished postcard to a
landscape 4×6" PDF, and sends it to the printer through CUPS.

It does **not** receive pushed jobs, and it does **not** talk to any database or
storage directly. Everything goes through the Worker over plain HTTP.

### How it connects

The agent only needs to reach the Worker. `WORKER_URL` is the base URL for all
three things it does:

1. **Fetch jobs** — `GET {WORKER_URL}/api/print-agent/jobs?eventId=<slug>&limit=N`
2. **Download the postcard image** — `GET {WORKER_URL}/e/{eventId}/api/run-img?key=<postcard_key>`
3. **Acknowledge results** — `POST {WORKER_URL}/api/print-agent/jobs/{id}/ack`

No database credentials are required — only `WORKER_URL` and `EVENT_ID`.

## Prerequisites

Before an event, the booth laptop needs:

- **macOS** with **CUPS** and the `lp` command available (default on macOS).
- The **DNP DS620A** dye-sublimation driver installed, and the printer added in
  **System Settings → Printers & Scanners**.
- **4×6" media** loaded in the printer.
- **Node.js 18+** (the agent relies on the built-in `fetch`).
- The repo cloned locally with dependencies installed (`npm install` inside
  `print-agent/`).

Find the printer's CUPS queue name — you'll need it for `PRINTER_NAME`:

```bash
lpstat -p -d
```

## Configure `print-agent/.env`

Copy the template and fill in the values:

```bash
cd print-agent
cp .env.example .env
```

| Variable           | Required | Default       | Notes                                                                                 |
| ------------------ | -------- | ------------- | ------------------------------------------------------------------------------------- |
| `WORKER_URL`       | **Yes**  | —             | Base URL of the deployed Worker. Agent exits on startup if missing.                   |
| `EVENT_ID`         | **Yes**  | —             | Event slug this agent prints for. Agent exits if missing. Can be passed as a CLI flag. |
| `PRINTER_DRIVER`   | No       | `mock`        | Set to `dnp` to actually print on the DS620A. `mock` does **not** print.              |
| `PRINTER_NAME`     | No       | `DNP_DS620`   | CUPS queue name (from `lpstat -p -d`). Only used when `PRINTER_DRIVER=dnp`.            |
| `POLL_INTERVAL_MS` | No       | `5000`        | How often (ms) the agent polls for jobs.                                              |
| `BATCH_SIZE`       | No       | `5`           | Jobs fetched per poll (the Worker caps this at 20).                                   |

A working booth `.env` looks like:

```
WORKER_URL=https://caricature-booth.examples.workers.dev
EVENT_ID=nyc-2025
PRINTER_DRIVER=dnp
PRINTER_NAME=DNP_DS620
```

> **Two things that will bite you:**
>
> - **`EVENT_ID` is required.** Without it (or the `--event-id` flag) the agent
>   exits immediately with "Missing required --event-id flag or EVENT_ID env var."
> - **`PRINTER_DRIVER=mock` does not print.** In mock mode the agent writes the
>   PDF to a spool directory instead of sending it to the printer. Use `dnp` for
>   real prints.

## Running the agent

From the `print-agent/` directory:

```bash
npm start
```

Or override the event without editing `.env`:

```bash
npm start -- --event-id nyc-2025
```

The `--event-id` flag takes precedence over the `EVENT_ID` env var. There is no
build step — the agent runs the TypeScript directly. It runs in the foreground;
press **Ctrl+C** to stop.

> The agent has no process manager (no launchd/pm2). It only runs while the
> terminal and process are alive. **If the laptop sleeps or the terminal closes,
> printing stops** and jobs quietly pile up until it's running again. Disable
> sleep on the booth laptop and leave the terminal open.

## Verifying it's healthy

On startup the agent prints a banner showing the worker URL, event, printer,
poll interval, and batch size. Confirm these match the event you're running.

During operation, a healthy agent:

- Polls every `POLL_INTERVAL_MS` and logs how many jobs it picked up.
- Archives every rendered print to `print-agent/output/<session_id>.pdf`.
- Acks each job back to the Worker as `printed` (or `failed` with a reason).

There is **no built-in test-print feature**. To verify the end-to-end print path
before doors open, run one real session on the kiosk all the way through and tap
**Print** on the done screen, then confirm a physical print comes out.

## Troubleshooting

**Agent logs "OFFLINE" warnings**
After 3 consecutive failed polls the agent warns it can't reach the Worker.
Check the laptop's network, that `WORKER_URL` is correct, and that the Worker is
live.

**Jobs aren't printing (no errors)**

- `PRINTER_DRIVER` is still `mock` — switch to `dnp`.
- `EVENT_ID` doesn't match the event the attendees are using. The agent only
  pulls jobs for its configured event and rejects mismatched ones.

**Jobs fail at the print step**

- Printer is offline, out of media, or the queue name is wrong. Verify with
  `lpstat -p -d` and confirm `PRINTER_NAME` matches.
- The print command has a 30-second timeout; a hung or offline printer will
  surface as a failed job.

**Agent won't start**

- "Missing required env var: WORKER_URL" — set `WORKER_URL` in `.env`.
- "Missing required --event-id flag or EVENT_ID env var" — set `EVENT_ID` in
  `.env` or pass `--event-id <slug>`.

**Reprinting a job**
Use the **Retry print** action on the session row in the admin dashboard. It
queues a fresh print job the agent will pick up on its next poll.

## Reference

**Endpoints the agent uses**

- `GET /api/print-agent/jobs?eventId=<slug>&limit=N` — fetch pending jobs.
- `POST /api/print-agent/jobs/:id/ack` — body `{ "status": "printed" }` or
  `{ "status": "failed", "error": "reason" }`.

**Job lifecycle**

```
pending  ->  printed
         ->  failed
```

**Output format**
Each job renders to a single-page landscape **4×6"** PDF (432×288 pt), with the
postcard image filling the page edge to edge.
