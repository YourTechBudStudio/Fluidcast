# Client SDK (`@yourtechbudstudio/fluidcast-client`)

The environment-neutral client: a projection of the Harness session, reconnection, and audio prefetching and caching. Applications supply the transport and the actual playback. Built on Effect v4.

## Structure

- `transport.ts`: the `Transport` service applications implement.
- `session/`: protocol sync, connection state, playback instructions and reconnection.
- `audio/`: prefetching, caching and the pluggable `AudioStore`.
- `client.ts`: the `Client` service.
- The root entry is pure: only `effect` (not `effect/testing`), `fluidcast-core/actions` and `fluidcast-harness/protocol`, never either package's root (enforced by `scripts/check-pure-exports.mjs`).

## Rules

- Client state is a projection: user input and commands become visible only when they return through the subscription.
- Only `PlaybackRequested` authorises playback; prefetch only fetches.
- Playback failure is local: the app retries through the client, with no backend command.
- No DOM types on the surface. Errors carry identifiers only.
