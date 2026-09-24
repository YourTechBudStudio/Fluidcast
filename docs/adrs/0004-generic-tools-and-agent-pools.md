# ADR 0004: Generic tools and agent pools

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Fluidcast must support questions, presentation, and multiple kinds of backing agents without accumulating tool-specific branches in the Harness. Agent sessions also need state and continuity beyond an individual tool invocation, including sessions created before Fluidcast starts.

## Decision

The Harness consumes generic tool policies for blocking, response visibility, replay, and cancellation rather than recognizing particular tool names.

A single model-facing agent tool routes agent type, session ID, and message to a stateful pool per agent type. The routing tool remains stateless. Pools own session creation and reuse; same-session messages queue while different sessions can run concurrently.

Pool defaults and transformation hooks control the underlying harness, model, reasoning effort, prompt templates, and modifiers. The voice model chooses the target and message, not infrastructure configuration. SDK-specific adapters own translation, progress production, and cancellation behavior.

## Consequences

- New agent types do not require new model-facing tools or agent-specific Harness logic.
- Pools can accept preloaded sessions and be shared across Fluidcast conversations.
- Session lifecycle and prompt adaptation remain outside generic conversation scheduling.
- Adapters must honor the common tool lifecycle while retaining responsibility for SDK-specific cleanup.

See [Tools and agents](../architecture/tools-and-agents.md).
