# Reference backend (`@fluidcast/backend`)

Wires Core and the Harness to HTTP for the reference apps: one in-memory session, served over the routes in `@fluidcast/app-contract`. The application owns the server and transport (ADR 0003); nothing here belongs in an SDK.

## Structure

Vertical slices, each with an `index.ts` barrel, plus thin wiring at the root:

- `conversation/`: the `llm`, `instructions` and `speakers` config sections; the `LanguageModel` Layer (`chat-completions` through `@effect/ai-openai-compat`, `responses` through `@effect/ai-openai`); the Harness `Session` Layer; `GET /api/events` (SSE, one `data:` line per `SubscriptionMessage`, a `: heartbeat` comment every 15 s, ends after `Superseded`) and `POST /api/commands` (`204`, `409` `CommandRejected`, `400` `InvalidRequest`).
- `speech/`: the `tts` config section; Core's OpenAI-compatible `SpeechSynthesizer` Layer; `GET /api/speech/:actionId`, which pulls the first chunk before sending headers (`404` `SpeechNotFound`, `502` `SpeechError`) and aborts the connection if synthesis fails after audio started.
- `config.ts`: `loadConfig(path)` parses YAML with Effect's `Yaml`, validates the composed Schema, reads a `.env` next to the config into an immutable snapshot (the real environment wins; `process.env` is never modified), applies defaults and resolves keys. `ConfigError.message` is readable and never contains a secret.
- `server.ts`: `serverLayer(config, { webRoot? })` and `serve`, on `@effect/platform-node`'s HTTP server. With `webRoot`, static files are served with an `index.html` fallback; unknown `/api/*` paths stay `404`.
- `dev.ts`: the development entry (`pnpm dev`), API only, because Vite serves the web app and proxies `/api`.

## Rules

- Provider Layers take resolved values only; only `config.ts` reads the environment.
- Logs carry operation names, action and playback IDs and error tags, never conversation text, prompts, audio or keys.
- Keep audio streaming end to end; never buffer whole clips.
- Import `@effect/platform-node` by subpath, so the CLI bundle stays free of optional modules.

## Stack

Effect v4 `HttpRouter` and `HttpServerResponse` on `@effect/platform-node`, `FetchHttpClient` for providers. Tests use `node:test` and cover config loading only; the end-to-end behaviour is verified by a fake-provider probe outside the repo.
