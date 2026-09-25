# Client SDK (`@yourtechbudstudio/fluidcast-client`)

The environment-neutral client (ADRs 0003, 0007): a projection of the Harness session, reconnection, and audio prefetching and caching. Applications supply the transport and the actual playback.

## Structure

- `transport.ts`: the `Transport` service applications implement (`subscribe`, `send`, `speech`, optional `speechUrl`) and `TransportError`.
- `session/`: protocol sync. It folds the subscription with the Harness's `reduce` into `view` (effective actions, derived phase, speakers), tracks `connection`, turns `PlaybackRequested` into `playback` instructions, sends commands, and reconnects with exponential backoff from 250 ms to 5 s, never after `Superseded`.
- `audio/`: prefetching the next three speaks after the cursor as soon as they are appended, cancelling and evicting what is trimmed or played, keeping the current line, and choosing a `Playable` (cached bytes, `{url}`, or a complete download). `AudioStore` is the pluggable storage; `memoryStore` is the default.
- `client.ts`: the `Client` service and its `layer(options)`, which needs a `Transport`.

## Exports

- `.`: the whole SDK. It is a **pure** entry: it may import only `effect` stable modules, `@yourtechbudstudio/fluidcast-core/actions` and `@yourtechbudstudio/fluidcast-harness/protocol`, never either package's root entry. `scripts/check-pure-exports.mjs` at the repo root enforces this in `pnpm check`.

## Rules

- Client state is a projection: user input and commands become visible only when they return through the subscription.
- Only `PlaybackRequested` authorises playback; prefetch only fetches. `playback` becomes `None` when the cursor moves, and on reconnect or supersede. Applications acknowledge with the instruction's `playbackId`.
- Playback failure is local: the app retries with `playable(actionId)`, which involves no backend command.
- No DOM types on the surface. Errors carry identifiers only.

## Stack

Effect v4: `SubscriptionRef` (read-only `Subscribable`s on the surface), `FiberMap` (prefetches keyed by action ID), `FiberHandle`, `Stream.retry` with `Schedule`. Tests use `node:test` with a fake transport and `TestClock`.
