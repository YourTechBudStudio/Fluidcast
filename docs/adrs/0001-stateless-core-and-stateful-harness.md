# ADR 0001: Stateless Core and stateful Harness

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Generating voice-oriented actions and managing an ongoing conversation are different responsibilities. Combining them would tie model access to one history, playback, and scheduling implementation, making Core harder to reuse independently.

## Decision

Core owns stateless action generation, incremental parsing, action ID generation, and TTS. Callers supply conversation history and configuration. Generating IDs does not make Core responsible for storing or resolving them.

The Harness owns history, action state, the playback cursor, tool execution, and iteration scheduling. It resolves action IDs to content when the application requests audio through Core.

## Consequences

- Core can be used independently of the Harness, but its callers must supply state management.
- Conversation and recovery policies belong in the Harness rather than provider integration.
- Stateless Core cannot serve audio by action ID alone; a stateful caller must resolve the content.
- This separation is an ownership boundary, not a requirement for separate services or processes.

See [Core SDK](../architecture/core-sdk.md) and [Harness lifecycle](../architecture/harness-lifecycle.md).
