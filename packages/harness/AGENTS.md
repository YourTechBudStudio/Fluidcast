# Harness SDK (`@yourtechbudstudio/fluidcast-harness`)

The single-session conversation authority (ADRs 0002, 0003, 0006): the action log, the cursor, playback identity, generation and the subscription. It builds on Core, which stays stateless.

## Structure

One deep module, `src/session/`, exposed through its `index.ts`. Do not split it into slices that share its state.

- `protocol.ts`: the session contract (ADR 0007). Schemas for the `SessionState` snapshot, the events (`ActionAppended`, `ActionsTrimmed`, `CursorMoved`, `PlaybackRequested`, `GenerationChanged`), the `SubscriptionMessage` union (`Snapshot | event | Superseded`), the commands (`SendMessage`, `PlaybackFinished`, `Interrupt`, `RetryGeneration`), and the errors `CommandRejected` and `SpeechNotFound`. Also the pure functions every client folds with: `reduce`, `derivePhase`, `effectiveActions` and `currentAction`.
- `session.ts`: the `Session` service and its `layer(config)`, which needs `LanguageModel` and `SpeechSynthesizer`. It exposes `subscribe`, `command` and `speech`.
- `failure.ts`: turns Core's `GenerationError`, or a defect (`UnexpectedError`), into the identifier-only `{tag, message}` of a `generation_failed` action.

## Exports

- `.`: everything in `session/`.
- `./protocol`: `protocol.ts` alone. It is a **pure** export: it may import only `effect` stable modules and `@yourtechbudstudio/fluidcast-core/actions`. `scripts/check-pure-exports.mjs` at the repo root enforces this in `pnpm check`.

## Rules

- The cursor is an index; `actions.length` means "at the end". Action status and phase are derived from the log, the cursor and the latest iteration's `generation: idle | running | failed`, never stored on actions.
- One lock serialises commands, generation appends and subscription changes. Every event is applied to state with the protocol's `reduce` and delivered to the subscriber inside that lock, so the session and every client fold agree by construction.
- The log changes only by append, or by trimming after the cursor on interrupt.
- Stale acknowledgements are rejected by `playbackId`, and `PlaybackFinished` is ignored while nobody is subscribed, so a disconnect freezes the cursor.
- Errors and `generation_failed` messages carry identifiers only (tags, reasons, indexes, HTTP status, action IDs), never conversation content.

## Stack

Effect v4: `Semaphore`, `Ref`, `Queue` (the single subscriber), `FiberHandle` (the generation fiber) and `effect/Schema`. Tests use `node:test` with a scripted `LanguageModel` and a fake `SpeechSynthesizer`, never real providers.
