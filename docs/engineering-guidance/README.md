# Engineering guidance

Use this guidance during coding and review to keep changes localized, boundaries clear, and behavior dependable. It is a question set for humans and agents, not a style manual or a prescription for one architecture.

## Reading order

1. [Principles](./principles.md) — durable engineering goals.
2. [How to use](./how-to-use.md) — applying the lenses and consuming review output.
3. The lenses relevant to the change:
   - [Architecture and SDK surfaces](./lenses/architecture-and-sdk-surfaces.md) — package ownership, public surfaces, integration contracts, reuse, trust boundaries, dependencies, and compatibility.
   - [State, runtime, and diagnostics](./lenses/state-runtime-and-diagnostics.md) — ordering, the cursor, cancellation, stale events, Effect primitives, failures, and diagnosability.
   - [Conversation experience](./lenses/conversation-experience.md) — honest outcomes, player controls, recovery, fluency, and what integrators need to present the experience truthfully.

Relevant lenses have equal standing. Each defines its own Blocker, Concern, and Nit calibration; [how-to-use.md](./how-to-use.md) defines what to do with those findings and the separate Architectural Reflection channel.

## Fluidcast context

Fluidcast is a set of SDKs for a voice-and-visual interface to existing agents, with reference backend and web applications that exercise them. Core, Harness, and Browser SDKs have distinct ownership; the [ADR index](../adrs/README.md) records those boundaries and is the source of architectural commitments. Lens questions do not override ADRs.

Fluidcast has two kinds of users: people listening to and steering the conversation, and developers integrating the SDKs into their own server, transport, UI, and audio playback. Both are first-class.

Fluidcast is Effect-native throughout, including application UI state; see [ADR 0005](../adrs/0005-effect-native-execution.md). Review whether appropriate Effect primitives solve the actual problem better than custom machinery; this guidance does not define adoption tiers or a mandatory service hierarchy.

Favor clean internal evolution while the project is unlaunched: the reference applications are callers to migrate, not compatibility obligations. This does not erase obligations at real user, data, integration, or deployment boundaries once they exist.

## Scope limits

This system does not cover verification or reviewability. Repository workflow commands remain in `AGENTS.md`.

Do not expand these docs into API signatures, transport schemas, formatting rules, arbitrary file-size limits, naming preferences, framework tutorials, exhaustive security checklists, packaged-build concerns, or speculative hosted-platform or mobile architecture. Trust and dependency questions belong only where they affect concrete boundaries or runtime behavior. Do not require logging in every function or abstraction for its own sake.

Add guidance when recurring problems expose a missing question, not merely because another topic could have its own document.
