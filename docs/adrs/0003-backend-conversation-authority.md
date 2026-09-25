# ADR 0003: Backend conversation authority

## Status

Accepted as architectural direction; implementation is not implied.

## Context

The browser presents the conversation, but tools and backing agents run on the backend. Splitting authoritative conversation state between them would complicate playback coordination and recovery. Binding execution to a particular browser player or server framework would also constrain SDK reuse.

## Decision

The backend Harness is authoritative for conversation state and the playback cursor. The Client SDK communicates only with the application backend and owns communication coordination and audio caching, not an independent conversation state machine. Provider credentials and provider access stay server-side.

Applications own the server, transport wiring, UI, and actual audio playback. SDK integration remains transport-neutral. Browser controls and playback acknowledgments request changes to backend-owned state.

## Consequences

- Connection loss prevents cursor advancement while already-running tools can continue and queue results.
- Reconnection uses backend state and explicit controls rather than assuming the browser's playback state is authoritative.
- Browser caches and playback buffers are local conveniences, not the source of conversation truth.
- Applications must supply integration and playback; the SDKs do not promise a hosted backend or built-in player.

See [Client integration](../architecture/client-integration.md).
