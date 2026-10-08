# App contract (`@fluidcast/app-contract`)

The reference apps' HTTP contract (routes, Schemas, SSE framing) between `apps/backend` and the web app's transport, all in `src/index.ts`. It is not an SDK surface: SDK contracts live in the SDK that owns them (`core/actions`, `harness/protocol`).

## Rules

- Pure export: only `effect` (not `effect/testing`) and `fluidcast-harness/protocol` (enforced by `scripts/check-pure-exports.mjs`).
- Errors carry identifiers only, never conversation text or provider messages.
