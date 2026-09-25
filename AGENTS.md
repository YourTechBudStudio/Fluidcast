# Fluidcast

## What this is

Fluidcast is a set of SDKs that provide a voice-and-visual interface for working with existing agents. The experience resembles an interactive podcast player: users listen, see explanations, answer questions, and redirect the conversation while agents work in the background.

## Structure

- `packages/core` is the Core SDK: stateless action generation through provider-neutral language models, and text-to-speech. It stores neither action IDs nor conversation history.
- `packages/harness` is the Harness SDK: conversation history, action state, the playback cursor, tool execution, and iteration scheduling. It builds on Core.
- `packages/browser` is the Client SDK: communication with the application backend, playback coordination with the harness, and audio prefetching and caching. Applications supply actual playback.
- `packages/typescript-config` contains the shared TypeScript configuration.
- `apps/backend` is the reference application backend that wires Core and the harness to a transport.
- `apps/web` is the reference browser application that exercises the experience through the Client SDK.

## Rules

- Always start by reading:
  - `docs/README.md`, then the product and architecture docs relevant to the task.
  - `docs/engineering-guidance/README.md`
  - `docs/engineering-guidance/principles.md`
  - `docs/engineering-guidance/how-to-use.md`
  - `docs/adrs/README.md` (use it as an index; read only ADRs relevant to the task)
  - Additionally, make sure to read any relevant engineering guidance lenses before starting to code.
- Never hard-wrap prose in Markdown files. Keep each paragraph and list item on one source line.
- After code changes, run `pnpm check`. Each package has its own `check` command. Use `pnpm fix` to fix formatting issues.
- Shared dependency versions live in the `pnpm-workspace.yaml` catalog and are referenced with `catalog:`. Package-specific dependencies stay local.
- Never start persistent processes such as servers, `pnpm run dev`, or `pnpm run start`. Instead, suggest that the user run those commands. Finite automated tests and probes may start temporary listeners they own, and must tear them down before finishing.
- Do not run state-changing Git commands unless the user explicitly asks. Read-only Git commands such as diffs, status, and commit history are allowed.
- We have not launched yet, so prefer bold refactors for better maintainability and correctness over backwards compatibility.
- Never modify docs or AGENTS.md files unless explicitly instructed to by a human.
- Implementation plan must never worry about production packaged builds unless the human explicitly asks for it.
