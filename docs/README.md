# Fluidcast V3 documentation

These documents capture product intent, architectural scope, and consequential decisions—not implementation specifications or a description of shipped behavior.

## Product: purpose and experience

- [Overview](product/overview.md): Use cases, goals, and scope.
- [Interaction model](product/interaction-model.md): Player controls and recovery expectations.

## Architecture: ownership and decisions

- [Overview](architecture/overview.md): SDK responsibilities and integration boundaries.
- [Core SDK](architecture/core-sdk.md): Stateless action generation and speech synthesis.
- [Harness lifecycle](architecture/harness-lifecycle.md): Execution, continuation, interruption, and recovery.
- [Tools and agents](architecture/tools-and-agents.md): Tool policies and agent pools.
- [Client integration](architecture/client-integration.md): Connection, playback, and audio boundaries.

## ADRs: durable rationale

[Architecture decision records](adrs/README.md) explain why the long-term boundaries were chosen and what tradeoffs they introduce. Topic documents describe the connected design; ADRs preserve its rationale.

Start with the product overview, then read the architecture. Keep these documents small: add detail only when it preserves a consequential decision or clarifies ownership. API signatures, transport schemas, and implementation mechanics belong in later design work, if needed.
