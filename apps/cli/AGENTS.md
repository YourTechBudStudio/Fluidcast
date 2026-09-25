# CLI (`@fluidcast/cli`)

`fluidcast serve`: the reference backend and web player in one process, runnable from source or as a standalone `npx`-able bundle. Development does not use it: run `apps/backend`'s `dev` script and the web app's Vite server instead.

## Structure

- `src/main.ts`: the command, built on `effect/unstable/cli`. `serve --config <path>` (default `./fluidcast.yaml`), `--port` (overrides `server.port`) and `--web-root` (defaults to `web/` next to the running file, which exists only in the bundle). It loads config through the backend's `loadConfig` and calls its `serve`. Config errors print their message and exit with code 1.
- `scripts/bundle.ts`: Rolldown bundles `src/main.ts` and every dependency (platform node, ESM, Node 26 target, shebang) into `dist/fluidcast.mjs`, then copies `apps/web/dist` to `dist/web/`.

## Commands

- `pnpm bundle`: builds the workspace dependencies and the web app, then runs `scripts/bundle.ts`. It is deliberately not `build`, so the root `build:libs` and `pnpm check` never run it.
- From source: `node src/main.ts serve --config ../../fluidcast.yaml --web-root ../web/dist` (after `pnpm build:libs` and the web build).
- Standalone: `node dist/fluidcast.mjs serve --config <path>`, or `npm pack` and run the tarball with `npx`. Only Node 26 is needed.

## Rules

- Keep this package a thin entry: behaviour belongs in `apps/backend`.
- Import `@effect/platform-node` by subpath (`@effect/platform-node/NodeRuntime`), never the barrel, so the bundle does not pull in optional modules such as its Redis support.
