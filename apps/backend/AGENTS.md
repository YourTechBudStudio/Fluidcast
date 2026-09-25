# Reference backend (`@fluidcast/backend`)

Wires Core and the Harness to HTTP for the reference apps: one in-memory session, served over the routes in `@fluidcast/app-contract`. The application owns the server and transport; nothing here belongs in an SDK. Built on Effect v4.

## Structure

- `conversation/`: language model and session layers, and the events and commands routes.
- `speech/`: the speech layer and the speech route.
- `config.ts`: YAML config loading, `.env` and key resolution.
- `server.ts`: the HTTP server and optional static web root.
- `dev.ts`: the development entry (API only; Vite serves the web app).

## Rules

- Only `config.ts` reads the environment, and it never modifies `process.env`. Provider layers take resolved values only.
- Logs carry operation names, IDs and error tags, never conversation text, prompts, audio or keys.
- Keep audio streaming end to end; never buffer whole clips.
- Import `@effect/platform-node` by subpath, so the CLI bundle stays free of optional modules.
