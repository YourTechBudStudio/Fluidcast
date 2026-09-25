# Web

## What this is

The reference browser player: a voice-and-visual stage with a subtitle, a switchable transcript, a status line and a composer. It demonstrates the experience on top of the Client SDK, over an HTTP transport to the reference backend, with real audio playback driving the visuals.

## Stack

- Vite and React 19.
- Tailwind v4 with CSS-first `@theme` tokens in `src/styles.css`. `ui/tokens.ts` mirrors the palette for WebGL and SVG only.
- Base UI for accessible interactive primitives, `motion` for enter and exit animation, `lucide-react` for icons.
- Effect Atom (`@effect/atom-react`) for all state. No zustand, no react-query, no router.
- The Client SDK (`@yourtechbudstudio/fluidcast-client`) over Effect's `HttpClient` and SSE decoder, speaking the routes in `@fluidcast/app-contract`. Protocol types come from `fluidcast-harness/protocol` and `fluidcast-core/actions`.
- Raw WebGL for the visuals. Per-frame audio analysis is read inside each visual's animation loop and never goes through atoms or React state.

## Structure

```text
src/
  main.tsx        # Entry: the atom registry and the app, nothing else
  app/            # Root composition: layout, the front/back layer flip, top-right controls, keyboard shortcuts, persisted preferences
  client/         # The page's one Client SDK instance: the HTTP transport and the keep-alive Atom runtime
  conversation/   # Atoms projected from the client's view and connection, commands, the presentation derivation, status line, composer, transcript, copy pools
  playback/       # The player (audio element, AudioContext, analyser, autoplay handling), its status and controls, subtitle, "Tap to resume"
  visuals/        # The three WebGL visuals, their shared analysis (including the analyser-to-bins mapping) and engine, the visual catalog
  ui/             # Shared presentation primitives, tokens and motion
```

- Each module publishes through `index.ts`. Other modules import only that file.
- Allowed dependencies: `app` → everything; `conversation` → `client`, `playback`, `visuals`, `ui`; `playback` → `client`, `ui`; `visuals` → `ui`; `client` and `ui` → nothing. `tests/architecture.test.mjs` enforces this, and fails on any other top-level directory.
- The browser is a projection (ADR 0007). Conversation and connection atoms read the Client SDK's `view` and `connection` directly; nothing is shown before it comes back on the subscription. Client-local state is limited to playback status, the failed-send flag and the composer draft.
- `client/runtime.ts` is kept alive for the page's lifetime: a second Client instance would open a second subscription and supersede the first.
- `playback/player.ts` plays only what `client.playback` instructs, one attempt at a time. Each attempt owns the element's source, its object URL and its listeners, so stale events cannot reach a later line. Any pointer or key gesture on the page unlocks audio; if the `AudioContext` still is not running, or `play()` is refused, the line is held for "Tap to resume".
- `conversation/presentation.ts` derives one `Moment` from the conversation, connection and playback, and from it the composer mode, visual state, subtitle and timeline. The status line also shows a `sendFailed` moment when a command could not reach the backend. Components render that; they do not re-derive state.

## Rules

- Visuals: keep the ported GLSL in `*/shaders.ts` verbatim from `scratch/plans/voice-mvp/artifacts/visuals/`. Tune through the state tables in each `renderer.ts`.
- Every `localStorage` access goes through `app/persisted.ts`, which tolerates missing or throwing storage.
- Motion uses one curve (`--ease-expo`) and the 110, 190, 320 and 600 ms durations. No springs or overshoot. Honour reduced motion.
- Interactive controls have an accessible name, work from the keyboard and keep a hit area of at least 44 px.
- Status copy lives in `conversation/copy.ts`. Error lines always say what failed.

## Running

- Development (a human runs these; agents do not start servers): `pnpm build:libs` once, then the backend's `dev` script and `pnpm --filter @fluidcast/web dev`. Vite serves on port 5334 and proxies `/api` to the backend on 4700, so audio stays same-origin for the analyser.
- `pnpm check` in this package runs lint, typecheck, the architecture test and the format check.
