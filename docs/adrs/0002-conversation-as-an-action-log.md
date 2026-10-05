# ADR 0002: The conversation is one action log, run by a cursor

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Fluidcast must keep speaking while tools and the worker work in the background, without losing the relationship between what the user hears and when work starts. Native tool-call cycles do not express that interleaving, and starting every tool as soon as it is generated would bypass presentation order and undermine interruption. A conversation also holds user input, runtime facts such as interruptions and failures, and tool results; separate record kinds or wrapper messages would create a two-level hierarchy, and stored statuses would duplicate what the cursor expresses. Worker turns can take minutes, and users cut in or step away while work continues.

## Decision

**The model writes ordered actions.** Each response is an ordered sequence of speak and tool-call actions, exposed incrementally; how it is encoded is Core's concern. The runtime never reorders actions. Tool responses become input to later iterations rather than suspending the current generation.

**Every conversation fact is an action in one flat union**: user-authored, model-authored and runtime-authored, with authorship following from the action type. Actions are immutable: the log only grows, or is trimmed of actions that have not taken effect. Whether an action is queued, current or complete is derived from the cursor, never stored.

**The log records what the model has read.** A tool outcome enters it when the Harness submits it to the model; until then it is session state beside the log. Model input is derived from the log up to the cursor, and action identifiers never reach the model.

**The cursor decides when actions take effect.** Each action type declares its execution rule: speech holds the cursor until playback completes, and tool calls start background work and release it. Commands request changes, actions record the conversation, and events describe changes to the log and cursor.

**Presentation controls never cancel background work.** Interrupt discards presentation that has not taken effect, including a blocking tool still waiting on the listener, such as an open question, which closes unanswered; every other running tool continues with its result still eligible. Away holds presentation while work continues. Only faults halt a conversation.

## Consequences

- Parsing an action does not authorize it, so interruption can discard future actions before their tools run, and latency hiding depends on useful action order rather than speculative execution.
- Model input, transcripts and replay derive from one source; replay needs explicit tool eligibility so revisiting speech does not repeat work.
- New capabilities extend the action union and its execution rules rather than adding parallel records.
- Interrupting never loses worker effort, but an unwanted worker turn runs on unless steered away, and results arriving after an interruption still reach the model.
- Cancellation is for teardown, such as ending a session, not conversational control.

See [Harness lifecycle](../architecture/harness-lifecycle.md) and the [interaction model](../product/interaction-model.md).
