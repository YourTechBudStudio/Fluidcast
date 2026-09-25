# CLI (`@fluidcast/cli`)

`fluidcast serve`: the reference backend and web player in one process, runnable from source or as a standalone `npx`-able bundle. Development does not use it: run `apps/backend`'s `dev` script and the web app's Vite server instead.

## Rules

- Keep this package a thin entry: behaviour belongs in `apps/backend`.
- Import `@effect/platform-node` by subpath (`@effect/platform-node/NodeRuntime`), never the barrel, so the bundle does not pull in optional modules such as its Redis support.
