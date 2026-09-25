# Web

## What this is

The reference browser player: a voice-and-visual stage with a subtitle, a switchable transcript, a status line and a composer. It demonstrates the experience on top of the Client SDK. In phase 2 it runs on fixtures and a synthetic voice; the real data source arrives in phase 5.

## Stack

- Vite and React 19.
- Tailwind v4 with CSS-first `@theme` tokens in `src/styles.css`, copied from Isagi. `ui/tokens.ts` mirrors the palette for WebGL and SVG only.
- Base UI for accessible interactive primitives, `motion` for enter and exit animation, `lucide-react` for icons.
- Effect Atom (`@effect/atom-react`) for all state. No zustand, no react-query, no router.
- Raw WebGL for the visuals. Per-frame audio analysis is read inside each visual's animation loop and never goes through atoms or React state.

## Structure

```text
src/
  main.tsx        # Entry: the atom registry and the app, nothing else
  app/            # Root composition: layout, the front/back layer flip, top-right controls, keyboard shortcuts, persisted preferences
  conversation/   # View-model mirror of the protocol, its atoms, the presentation derivation, status line, composer, transcript, copy pools
  playback/       # Client-local playback status and controls, subtitle, "Tap to resume"
  visuals/        # The three WebGL visuals, their shared analysis and engine, the visual catalog
  ui/             # Shared presentation primitives, tokens and motion
  mock/           # Temporary: fixture scenarios, scripted commands, synthetic voice, development state panel
```

- Each module publishes through `index.ts`. Other modules import only that file.
- Allowed dependencies: `app` → everything; `conversation` → `playback`, `visuals`, `ui`; `playback` → `ui`; `visuals` → `ui`; `mock` → `conversation`, `playback`, `visuals`; `ui` → nothing. `tests/architecture.test.mjs` enforces this.
- `conversation/presentation.ts` derives one `Moment` from the conversation, connection and playback, and from it the composer mode, visual state, subtitle and timeline. Components render that; they do not re-derive state.
- Data sources write the atoms in `conversation/state.ts` and `playback/state.ts` and install the command and control implementations there. Nothing outside `mock/` knows fixtures exist.
- `mock/` is the only place for temporary code, and only `app/App.tsx` imports it. Phase 5 replaces it with the Client SDK and a real player.

## Rules

- Visuals: keep the ported GLSL in `*/shaders.ts` verbatim from `scratch/plans/voice-mvp/artifacts/visuals/`. Tune through the state tables in each `renderer.ts`.
- Every `localStorage` access goes through `app/persisted.ts`, which tolerates missing or throwing storage.
- Motion uses one curve (`--ease-expo`) and the 110, 190, 320 and 600 ms durations. No springs or overshoot. Honour reduced motion.
- Interactive controls have an accessible name, work from the keyboard and keep a hit area of at least 44 px.
- Status copy lives in `conversation/copy.ts`. Error lines always say what failed.

## Running

- `pnpm --filter @fluidcast/web dev` runs the player (a human runs it; agents do not start servers). The floating "mock" panel in development jumps between scenarios, and `?scenario=<id>` picks the starting one.
- `pnpm check` in this package runs lint, typecheck, the architecture test and the format check.
