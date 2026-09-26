# ADR 0008: Presentation controls never cancel background work

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Agent turns can take minutes. Users frequently cut in to clarify or correct something, and they may step away while work continues. Canceling unfinished tools on interruption would discard that work for what is usually a small correction. Separate pause and start controls would each need their own rules for what happens to work that finishes while nobody is listening.

## Decision

User controls govern presentation, not background work. Interrupt redirects the conversation by discarding presentation that has not taken effect, but it never cancels running tools; their results remain eligible. Corrections reach agents as steering messages instead.

A single **Away** state replaces pause and gates a session's start. While Away, tools keep running, nothing plays, and progress updates are dropped. Once every outstanding tool has returned, the harness generates the next response ahead of time so resuming is immediate. A session can be created Away, and starting it is resuming it.

Only faults halt a conversation.

## Consequences

- Interrupting never loses agent work, but a truly unwanted agent turn runs to completion unless the agent is steered away from it.
- Pause, stepping away, and start share one state and one set of rules.
- Results that arrive after an interruption still reach the model, so the model must be told when the user cut in.
- Cancellation remains for teardown, such as ending or resetting a session, rather than for conversational control.

See [Harness lifecycle](../architecture/harness-lifecycle.md) and the [interaction model](../product/interaction-model.md).
