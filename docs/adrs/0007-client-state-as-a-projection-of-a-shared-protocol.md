# ADR 0007: Client state as a projection of a shared protocol

## Status

Accepted as architectural direction; implementation is not implied.

## Context

ADR 0003 makes the backend Harness authoritative, but clients still hold state to render the conversation, prefetch audio, and play it. If each client interprets updates with its own logic, client state drifts from the Harness, reconnection and late messages become timing-dependent, and client packages risk importing backend code to share types. Clients may run in browsers, terminals, or host applications such as Isagi.

## Decision

The Harness publishes its session contract, including the snapshot, events, commands, and a pure reducer that folds events into state, as a pure schema export. Core publishes its action vocabulary the same way. Each contract is owned by the SDK that produces it rather than by a separate protocol package, and these exports never import provider, server, or runtime modules; an automated check enforces this.

On subscription, a client receives a snapshot followed by the events emitted after it, with no gap between them. Client state is the fold of these events using the same reducer the Harness applies. Client state is fully derived: user input and control requests become visible only when they return through the subscription. Client-local state is limited to communication, caching, and playback.

Late or stale messages are rejected by identity, such as playback and action identifiers, not by timing.

## Consequences

- Any transport that carries the snapshot, events, and commands works; the protocol does not depend on HTTP, SSE, or WebSockets.
- Client and Harness state cannot diverge through duplicated interpretation logic, but reducer changes are protocol changes that affect both.
- Optimistic updates are not available by default, so a round trip precedes visible user input.
- Clients see queued actions for prefetching, but visibility never authorizes execution or playback (ADR 0002).
- Client bundles include only schema contracts and Effect Schema, not provider or server code.
- Reconnection takes a fresh snapshot instead of replaying an event history.

See [Client integration](../architecture/client-integration.md) and [ADR 0003](0003-backend-conversation-authority.md).
