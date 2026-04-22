# Nonsheet Finance — developer guide

Static **SPA + library** monorepo: no backend in this tree. All state is an in-memory **wealth document** (one JSON shape); the UI offers Import / Export and optional browser cache.

## Layout

| Path | Role |
|------|------|
| **`app/`** | Vite + React + TypeScript SPA. Production build writes to **`static-app/`** at repo root (`base: './'`, hash routing). |
| **`core/`** | npm package **`@nonsheet-finance/core`**: document schema (`schemaVersion: 1`), parse/stringify, FX helpers, net worth history, dashboard aggregation, stale-notification helpers. Consumed by `app` via `file:../core` and a dev alias in Vite. |

`static-app/` is **gitignored**; it is produced only by `npm run build` in `app/` (or the root script below).

## Architecture (short)

- **Router:** `HashRouter` (`#/…`) so any static file server works without SPA rewrite rules.
- **Data:** `app/src/wealthDocStore.ts` holds the live document; `WealthStoreProvider` wires Import/Export, dirty state, optional File System Access handle, and `beforeunload` when dirty.
- **“API”:** `app/src/localApi.ts` adapts UI calls to in-memory document updates (no HTTP).
- **Shared logic:** Import types and functions from `@nonsheet-finance/core` in `app` source; `core` stays framework-free TypeScript.

## Requirements

- **Node.js** 20+ (see **`.nvmrc`** at repo root)
- **npm** 10+

## Install dependencies

From repo root:

```bash
cd core && npm install && npm run build
cd ../app && npm install
```

(`core` must be built at least once so `dist/` exists for consumers; during `app` dev, Vite can resolve `core` from source via `vite.config.ts` alias.)

## Run the app locally

```bash
cd core && npm run build
cd ../app && npm run dev
```

Open the URL Vite prints (default **http://localhost:5174**). Hash routes look like `http://localhost:5174/#/…`.

## Production build (entire stack)

From repo root:

```bash
npm run build
```

This runs **`build:all`**: `npm install` + `tsc` in **`core`**, then `npm install` + `tsc -b` + Vite build in **`app`**, emitting **`static-app/`**.

Preview the same output Vite would serve:

```bash
npm run preview
```

(equivalent to `cd app && npm run preview`.)

To smoke-test only the static files:

```bash
cd static-app && npx --yes serve -s .
```

## Lint

```bash
npm run lint
```

## Why `cd` in root scripts?

Root `package.json` uses `cd core && …` and `cd app && …` instead of `npm --prefix` so npm does not inject the root package as a spurious `file:..` dependency into leaf `package.json` files when the root package name matches certain patterns.

## Agent / task docs

Under **`agent/`**: `TASKS.md`, `IMPLEMENTATION_GUIDE.md`, etc.
