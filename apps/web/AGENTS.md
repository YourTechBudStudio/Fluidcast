# Web

The reference browser player: a voice-and-visual stage on top of the Client SDK, over an HTTP transport to the reference backend, with real audio playback driving the visuals.

## Stack

- Vite and React 19.
- Styling: Tailwind v4, tokens in `src/styles.css` (`ui/tokens.ts` mirrors them for WebGL and SVG only).
- Primitives: Base UI. Animation: `motion`. Icons: `lucide-react`.
- State: Effect Atom only. No zustand or react-query.
- Routing: React Router (`react-router`) in data mode, with `createBrowserRouter` in `app/Root.tsx`. Routes choose screens and hold no state of their own.
- Visuals: raw WebGL. Per-frame audio analysis never goes through atoms or React state.

## Structure

```text
src/
  main.tsx        # Entry
  app/            # Root composition, routes, layout, shortcuts, persisted preferences
  client/         # The page's one Client SDK instance and its transport
  conversation/   # Atoms from the client's view, commands, presentation, composer, transcript
  playback/       # The audio player, its controls and subtitle
  tools/          # Tool rendering (Show, Ask), unaware of the conversation
  visuals/        # WebGL visuals and audio analysis
  ui/             # Shared primitives, tokens and motion
```

- Each module publishes through `index.ts`. Allowed dependencies between modules are enforced by `tests/architecture.test.mjs`.
- Pure logic is unit-tested with Vitest (`src/**/*.test.ts`).
- The browser is a projection: nothing is shown before it comes back on the subscription.
- `client/runtime.ts` stays alive for the page's lifetime; a second Client would supersede the first subscription.
- `conversation/presentation.ts` derives the UI state; components render it and do not re-derive state.

## Rules

- Motion uses one curve (`--ease-expo`) and the 110, 190, 320 and 600 ms durations. No springs or overshoot. Honour reduced motion.
- Interactive controls have an accessible name, work from the keyboard and keep a hit area of at least 44 px.
- Status copy lives in `conversation/copy.ts`. Error lines always say what failed.
