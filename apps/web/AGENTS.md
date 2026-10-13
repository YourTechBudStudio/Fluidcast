# Web

The reference browser application: it owns routing, setup, session start and Reset over an HTTP transport to the reference backend, and presents each session through the React player (`@yourtechbudstudio/fluidcast-react`).

## Stack

- Vite and React 19.
- Styling: Tailwind v4 for the app's own screens, tokens in `src/styles.css`. The player brings its own compiled, scoped stylesheet, imported once in `main.tsx`.
- Primitives: Base UI. Animation: `motion`. Icons: `lucide-react`.
- State: Effect Atom only. No zustand or react-query.
- Routing: React Router (`react-router`) in data mode, with `createBrowserRouter` in `app/Root.tsx`. Routes choose screens and hold no state of their own.

## Structure

```text
src/
  main.tsx        # Entry: the app and both stylesheets
  app/            # Root composition, routes, the mode screen, the Reset strip, persisted preferences
  client/         # The HTTP adapter: transport, session lifecycle (status, start, Reset) and the player's connection
```

- The player is used only through its public entries (`FluidcastPlayer` and `./styles.css`). The app keeps its own copies of the small primitives its screens need instead of importing the player's internals.
- Each module publishes through `index.ts`. Allowed dependencies between modules, the player boundary and where the reference contract may be imported are enforced by `tests/architecture.test.mjs`.
- Pure logic is unit-tested with Vitest (`src/**/*.test.ts`).
- The browser is a projection: nothing is shown before it comes back on the subscription.

## Rules

- Player behaviour belongs in `packages/react`, not here. The app supplies the connection, visibility and focus, and owns only its own screens and chrome.
- Motion uses one curve (`--ease-expo`) and the 110, 190, 320 and 600 ms durations. No springs or overshoot. Honour reduced motion.
- Interactive controls have an accessible name, work from the keyboard and keep a hit area of at least 44 px.
- Error lines always say what failed.
