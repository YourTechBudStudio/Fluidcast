# React player (`@yourtechbudstudio/fluidcast-react`)

One complete, embeddable browser player on top of the Client SDK: the voice-and-visual stage, subtitles, transport controls, browser audio, the composer, questions, Shows, the transcript and the worker view. Hosts supply a connection, visibility and focus; routing, setup and the backend session lifecycle stay with the host. See `docs/architecture/react-player.md`.

## Stack

- React 19. Primitives: Base UI. Animation: `motion`. Icons: `lucide-react`.
- State: Effect Atom only, in a private registry per mounted player. No zustand or react-query.
- Styling: Tailwind v4, compiled by `scripts/build-css.mjs` into `dist/styles.css` and scoped to `.fluidcast-player` with `@scope`. Tokens live in `src/styles/player.css` (`ui/tokens.ts` mirrors them for WebGL and SVG only).
- Visuals: raw WebGL. Per-frame audio analysis never goes through atoms or React state.

## Structure

```text
src/
  index.ts        # Public entry: FluidcastPlayer, FluidcastPlayerProps, WorkerFeed
  player/         # The instance: root, registry, layout, shortcuts, top bar, persisted preferences
  connection/     # The host's connection Layer, WorkerFeed and the instance's Client runtime
  conversation/   # Atoms from the client's view, commands, presentation, composer, transcript
  playback/       # The audio player, its presentation gate, controls and subtitle
  tools/          # Tool rendering (Show, Ask), unaware of the conversation
  workers/        # The Forward tool's worker view
  visuals/        # WebGL visuals and audio analysis
  ui/             # Shared primitives, tokens, motion and instance hooks
  styles/         # The stylesheet entry (player.css)
scripts/          # The CSS build and the scoping PostCSS plugin
tests/            # Architecture, built-stylesheet, integration and DOM (happy-dom) tests
```

- The public surface is exactly `FluidcastPlayer`, `FluidcastPlayerProps`, `WorkerFeed` and `./styles.css`. Nothing else is exported: no controls, atoms, theme, layout or slot props.
- Each module publishes through `index.ts`. Allowed dependencies between modules, the public surface and the allowed Fluidcast imports (pure entries and tool `./schema` only) are enforced by `tests/architecture.test.mjs`.
- Pure logic is unit-tested with Vitest (`src/**/*.test.ts`); DOM behaviour is tested in `tests/*.test.tsx` with the fixtures in `tests/support/`.
- The player is a projection: nothing is shown before it comes back on the subscription.

## Rules

- Instances are isolated: per-instance state lives in the instance's registry, never in module scope, and nothing listens on `window` or `document`. Shortcuts and audio unlock listen on the player root.
- Layout follows the root's own width: use the `compact:`/`narrow:` variants and `cqw`/`cqh` units, never viewport breakpoints or `vh`/`vw` (enforced by `tests/styles.test.mjs`).
- Every style rule stays inside `@scope (.fluidcast-player)`, and keyframes carry the `fc-` prefix. TypeScript imports no CSS.
- Audio starts only through the presentation gate: playback starts only from an explicit intent written through the hooks, and only while the player is visible and mounted. Hiding pauses; showing resumes nothing.
- The player never destroys the backend session. The host decides when the player receives keys by focusing its root; the player only moves focus within itself.
- Motion uses one curve (`--ease-expo`) and the 110, 190, 320 and 600 ms durations. No springs or overshoot. Honour reduced motion.
- Interactive controls have an accessible name, work from the keyboard and keep a hit area of at least 44 px.
- Status copy lives in `conversation/copy.ts`. Error lines always say what failed.
