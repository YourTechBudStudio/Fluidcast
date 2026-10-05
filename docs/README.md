# Fluidcast V3 documentation

These documents capture product intent, architectural scope, and consequential decisions—not implementation specifications or a description of shipped behavior.

## Product: purpose and experience

- [Overview](product/overview.md): Use cases, goals, and scope.
- [Interaction model](product/interaction-model.md): Player controls, questions, attention, and recovery expectations.
- [Presets and instructions](product/presets.md): Where the voice's behavior comes from, and the Guided Walkthrough preset.

## Architecture: ownership and decisions

- [Overview](architecture/overview.md): SDK responsibilities and integration boundaries.
- [Core SDK](architecture/core-sdk.md): Stateless action generation and speech synthesis.
- [Harness lifecycle](architecture/harness-lifecycle.md): Execution, continuation, interruption, and recovery.
- [Tools and the worker](architecture/tools-and-agents.md): The tool contract, initial tools, and the session's one worker.
- [Client integration](architecture/client-integration.md): Connection, playback, and audio boundaries.

## Research: what has been measured

- [Guided walkthrough prompting](research/guided-walkthrough-prompting.md): What worked and what didn't when tuning a small voice model for the Guided Walkthrough, with compressed results.
- [Evaluating voice behavior](evals/README.md): How presets are measured and improved: the runner, judges, scoring, and the unattended tuning loop.

## ADRs: durable rationale

[Architecture decision records](adrs/README.md) explain why the long-term boundaries were chosen and what tradeoffs they introduce. Topic documents describe the connected design; ADRs preserve its rationale.

Start with the product overview, then read the architecture. Keep these documents small: add detail only when it preserves a consequential decision or clarifies ownership. API signatures, transport schemas, and implementation mechanics belong in later design work, if needed.
