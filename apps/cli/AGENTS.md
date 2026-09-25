# CLI (`@fluidcast/cli`)

`fluidcast serve`: the reference backend and web player in one process. Not used in development.

## Rules

- Keep this package a thin entry: behaviour belongs in `apps/backend`.
- Import `@effect/platform-node` by subpath, never the barrel, so the bundle does not pull in optional modules.
