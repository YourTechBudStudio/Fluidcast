# ADR 0006: Conversation as a single action log

## Status

Accepted as architectural direction; implementation is not implied.

## Context

A conversation contains user input, model speech, runtime facts such as interruptions and generation failures, and later tool calls, tool results, and queued context. ADR 0002 orders the model's actions, but not the rest of the conversation. Modeling these as separate record kinds, or as message wrappers that contain actions, creates a two-level hierarchy. Storing a status on each record duplicates what the cursor already expresses and lets the two drift apart.

## Decision

Every conversation fact is an action in one flat, discriminated union: user-authored (user messages), model-authored (speak and tool calls), and runtime-authored (interruptions, generation failures, tool results, errors and faults, and later context). Authorship follows from the action type; there are no wrapper records.

Actions are immutable. The log changes only by appending, or by trimming actions that have not taken effect; history that has taken effect is never rewritten. Whether an action is queued, current, or complete is derived from its position relative to the cursor, never stored. Facts the cursor cannot express, such as an interruption, are appended as runtime actions.

The log records what the model has read. A tool result or error enters it only when the Harness submits it to the model. Until then, running tool executions and their completed outcomes are session state beside the log, published in the snapshot like the log itself.

The cursor walks every action type, and each type declares its execution rule: speech holds the cursor until playback completes, user and runtime actions take effect immediately, and tool calls start background work and release the cursor.

Model input is a derivation of the log: actions up to the cursor are rendered into provider messages, with model-authored actions as assistant output and all others as enveloped user input. Action identifiers never reach the model.

Commands request changes, actions record the conversation, and events describe changes to the log and cursor. Acknowledgements and retries are commands, not actions. Transient presentation failures, such as audio playback errors, are not actions.

## Consequences

- New capabilities such as tools, context, back navigation, and persistence extend the action union and its execution rules rather than introducing parallel records.
- Model input, transcripts, and replay derive from one source, and the model sees only what took effect.
- An outcome that completes mid-response never splits the model's response in the log, and a reconnecting client resumes open tool work from the snapshot rather than from transient events.
- Status cannot drift from progression, but interpreting an action requires the cursor.
- The model-facing output contract is the model-authored subset of the union.
- Trimming intentionally discards generated actions that never took effect, consistent with interruption semantics.

See [Harness lifecycle](../architecture/harness-lifecycle.md) and [ADR 0002](0002-ordered-actions-and-cursor-driven-execution.md).
