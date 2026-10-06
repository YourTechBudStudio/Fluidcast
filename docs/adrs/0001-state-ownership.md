# ADR 0001: Stateless Core, an authoritative backend Harness, and clients as projections

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Generating voice-oriented actions and managing an ongoing conversation are different responsibilities; combining them would tie model access to one history, playback and scheduling implementation. The browser presents the conversation, but tools and the worker run on the backend, and splitting authority between them would complicate playback coordination and recovery. Clients still hold state to render, prefetch and play; if each interprets updates with its own logic, it drifts from the backend and reconnection becomes timing-dependent. Clients may run in browsers, terminals or host applications.

## Decision

**Core is stateless.** It owns action generation, incremental parsing, action IDs and speech synthesis. Callers supply history and configuration; generating IDs does not make Core responsible for storing them.

**The backend Harness is the conversation authority.** It owns history, action state, the playback cursor, tool execution and iteration scheduling. Provider credentials and provider access stay server-side.

**Applications own integration:** the server, transport wiring, UI and audio playback. Integration is transport-neutral.

**Clients are projections of a shared protocol.** The Harness publishes its session contract (a snapshot, events, commands, and a pure definition of how events change state), and Core publishes its action vocabulary, as pure exports that never import provider, server or runtime code. A client receives a snapshot followed by the events after it, with no gap, and derives conversation state with the Harness's own definition. Conversation state is never client-local; clients keep only communication, caching, playback and purely presentational UI state. Late or stale messages are rejected by identity, not timing.

## Consequences

- Core can be used without the Harness, but its callers must manage state.
- Conversation and recovery policies belong in the Harness, not in provider integration.
- Connection loss stops the cursor while running tools continue; reconnection takes a fresh snapshot.
- Client and Harness cannot diverge through duplicated interpretation, but changing how events change state is a protocol change for both.
- User input becomes visible after a round trip; optimistic updates are not available by default.
- Client code never includes provider or server code.
- These are ownership boundaries, not a requirement for separate services or processes.

See [Core SDK](../architecture/core-sdk.md), [Harness lifecycle](../architecture/harness-lifecycle.md) and [Client integration](../architecture/client-integration.md).
