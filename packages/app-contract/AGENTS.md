# App contract (`@fluidcast/app-contract`)

The reference apps' HTTP contract between `apps/backend` and the web app's transport. It is not an SDK surface: the SDKs stay transport-neutral (ADRs 0003, 0007), and their contracts live in the SDK that owns them (`core/actions`, `harness/protocol`).

## Structure

One file, `src/index.ts`:

- `routes` and `speechPath(actionId)`: the route paths.
- Commands: `CommandBody` (the Harness `Command`), `commandStatus`, `InvalidRequest` and `CommandFailure`.
- Speech: `speechStatus`, `SpeechError` and `SpeechFailure`.
- Events: `SubscriptionMessageJson` (the JSON codec of each SSE `data:` line) and `heartbeatIntervalMillis`. The framing rules are in the doc comments.

## Rules

- **Pure export.** It may import only `effect` stable modules and `@yourtechbudstudio/fluidcast-harness/protocol`. `scripts/check-pure-exports.mjs` enforces this in `pnpm check`. That is why the routes are plain constants and Schemas rather than an `effect/unstable/httpapi` definition.
- Errors carry identifiers only, never conversation text or provider messages.

## Stack

`effect/Schema` only. No tests: it holds no behaviour; the backend probe exercises it end to end.
