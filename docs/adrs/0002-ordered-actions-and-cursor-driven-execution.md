# ADR 0002: Ordered actions and cursor-driven execution

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Fluidcast must keep speaking while tools perform background work, without losing the relationship between what the user hears and when work starts. Native tool-call cycles do not directly express the desired interleaving of speech and tool requests. Starting every tool as soon as it is generated would bypass presentation ordering and undermine interruption semantics.

## Decision

The model emits an ordered JSON array of speak and tool-call actions, exposed incrementally by Core. The Harness executes actions only when its playback cursor reaches them. Speech holds the cursor until completion or user navigation; tool calls start background work and allow subsequent actions to proceed.

Prompt guidance encourages early placement of useful background work; the runtime does not reorder actions. Tool responses become input to later iterations rather than suspending the current generation at each tool call.

## Consequences

- Generation order and execution progress are distinct; parsing an action does not authorize its execution.
- Latency hiding depends on useful action ordering, not speculative tool execution.
- Interruption can discard future actions without having already executed their tools.
- Replay requires explicit tool eligibility so revisiting speech does not repeat agent work.
- Core must parse structured output incrementally rather than relying on native tool-call dispatch.

See [Harness lifecycle](../architecture/harness-lifecycle.md) for continuation, interruption, and replay rules.
