# Harness SDK (`@yourtechbudstudio/fluidcast-harness`)

The single-session conversation authority: the action log, the cursor, playback identity, generation and the subscription. Builds on Core, which stays stateless. Built on Effect v4.

## Structure

- `src/session/` is one deep module; do not split it into slices that share its state.
- `protocol.ts` is the session contract and the pure fold (`reduce`) every client uses. Exported alone as `./protocol`, a pure entry: only `effect` stable modules and `fluidcast-core/actions` (enforced by `scripts/check-pure-exports.mjs`).

## Rules

- Action status and phase are derived from the log, the cursor and generation state, never stored on actions.
- One lock serialises commands, generation appends and subscription changes. Every event is applied with `reduce` and delivered inside that lock, so the session and every client fold agree by construction.
- The log changes only by append, or by trimming actions that have not taken effect (on interrupt or halt). Tool outcomes enter it only when submitted to the model; until then they are session state (`executions`, `pendingResults`).
- Stale acknowledgements are rejected by `playbackId`, and `PlaybackFinished` is ignored while nobody is subscribed.
- Errors carry identifiers only, never conversation content.
