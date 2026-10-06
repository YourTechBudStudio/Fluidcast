# ADR 0004: Tools as packages, and one worker per session

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Fluidcast needs questions, presentation and a backing agent without accumulating tool-specific branches in the Harness. Some tools need their own client interaction or application surfaces, such as a question form or a view of the worker's transcript. A worker session has state and continuity beyond one tool invocation, may exist before Fluidcast starts, and its turns can run for minutes. A voice model that chose among agents and wrote them tasks reinterpreted the listener on its own; nothing needed several workers.

## Decision

**Each tool is its own package**, with a backend factory and a pure schema export that clients import. The Harness consumes a generic tool contract and never recognizes particular tool names. A tool describes its mechanics: what it does and how its results read. How the voice should use it, including any reminders, belongs to the preset ([ADR 0005](0005-voice-behavior-as-presets.md)).

Tool outcomes distinguish **errors**, expected failures that complete the invocation and follow its response policy, from **faults**, infrastructure failures that halt the conversation for the user to resolve. Tool-specific surfaces, such as client commands to a running invocation or the worker's transcript, belong to the tool package and the application, not the Harness or Client SDK.

**Every session has exactly one worker, and the voice never writes its task.** The worker receives the listener's own words with what the voice said and showed since its last message, built from the session log, and the voice reads the worker's messages as the worker wrote them, never summarised or split by code. A message sent to a busy worker steers its running turn, and one result completes every invocation that turn consumed. The worker's agent harness, model and prompt shaping are configured by the application, never chosen by the voice model.

## Consequences

- New tools and worker types require no Harness changes, and applications include only the tools and agent SDKs they use.
- Clients depend on tool schemas without importing backend code.
- Session lifecycle, progress and prompt adaptation stay inside the worker's tool package, outside generic scheduling.
- The Harness must let one result complete several invocations.
- Supporting several workers needs a new decision.

See [Tools and the worker](../architecture/tools-and-agents.md).
