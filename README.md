# Questionnaire → Analysis Plan Converter

Converts market-research questionnaires in Word (`.docx`) into a formatted
Analysis Plan workbook (`.xlsx`), with a browser UI for reviewing and editing
the extracted questions before export.

The parser is notation-agnostic: it recovers question IDs, wording, routing
("base filters"), coding type, and answer options from the loose conventions
real questionnaires use, rather than from a fixed template.

## What it produces

The exported workbook has two sheets:

| Sheet | Contents |
| --- | --- |
| **TabSpec** | One row per question — sequence, ID, table title, base title, base filter, header title, metric, remark. Section headings become merged banner rows. |
| **Header** | Cross-tabulation columns. Six fixed rows (column no., header, description, question no., code, sig letter), one column per option of each question ticked as a *banner*. |

## Requirements

- Node.js 18+
- npm 8+ (the repo is an npm workspace)

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts the API and the client together and prints both URLs.
Open the client at **http://localhost:5173**.

Drop a `.docx` questionnaire on the upload panel, review the parsed grid, tick
which questions belong in the AP and which should act as banners, then
**Export to AP Excel**.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev mode. API on `:3000` (nodemon) + Vite client on `:5173` with hot reload. |
| `npm run build` | Type-check and build both workspaces. |
| `npm start` | Production mode. Serves the built client *and* the API from a single port (`:3000`). Run `npm run build` first. |
| `npm run dev:server` / `dev:client` | Either half on its own. |

### Why dev is two processes but `start` is one

Vite needs to own its own port to provide hot module reload, so in dev the
client runs separately and proxies `/api` to the API server
(see `client/vite.config.ts`). `npm start` has no such constraint: `server.ts`
serves the built static client and the API together on one port.

Neither of these is what runs in production — see below.

## Deployment (Vercel)

Vercel does **not** use `server.ts`. Per `vercel.json`:

- `npm run build:client` produces `client/dist`, served as static assets.
- `api/index.ts` is deployed as a serverless function; it re-exports the same
  Express app, so routes are shared with local development.
- A rewrite sends `/api/(.*)` to that function.

Because only the client is built there, a server-side type error will not fail
a Vercel deploy. Run `npm run build` locally before pushing.

## Architecture

```
client/src/App.tsx        Upload, editable question grid, banner selection, export
      │  POST /api/parse, /api/generate
server/src/app.ts         Express routes (shared by local server and Vercel function)
      ├── engine/         ← the live parsing pipeline
      │   ├── segment.ts      .docx → blocks {id, text, heading, routing, options}
      │   ├── titleEngine.ts  block → short table title
      │   ├── filterEngine.ts routing prose → validated base filter
      │   └── apEngine.ts     composes the three into AP rows
      └── excelGen.ts     AP rows → styled .xlsx (exceljs)
```

Entrypoints: `api/index.ts` (Vercel) and `server/src/server.ts` (local `npm start`).

### Title generation

`engine/titleEngine.ts` derives a title in priority order: universal
screener/demographic aliases → brand-funnel frames → generic question frames
(importance, satisfaction, frequency, reasons, …) → a noun-phrase fallback.
Titles are capped at six words.

### Base filters

`engine/filterEngine.ts` is deliberately precision-biased. A conditional filter
is emitted only when the routing parses cleanly *and* the referenced codes are
validated against the target question's actual options. Anything else is kept
as the original prose or falls back to "Ask all" — it never emits a confident
but unverified filter.

Each result carries a `status`: `all`, `assumed` (no routing found),
`conditional` (parsed and validated), or `review` (kept as prose, or validated
against codes the target question does not actually have — `note` says which).

## Repository layout

```
api/index.ts             Vercel serverless entrypoint
client/                  React + Vite frontend
server/src/app.ts        Express routes
server/src/engine/       Parsing pipeline (segment → title → filter → apEngine)
server/src/excelGen.ts   Workbook generation
server/src/server.ts     Local single-port entrypoint
```

Every tracked file is reachable from one of the two entrypoints. Local analysis
scratch output (`server/src/*.json`, `server/src/*.html`, `server/src/data/`) is
ignored, not committed.
