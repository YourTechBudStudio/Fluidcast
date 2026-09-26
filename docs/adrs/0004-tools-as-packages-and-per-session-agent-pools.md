# ADR 0004: Tools as packages and per-session agent pools

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Fluidcast must support questions, presentation, and multiple kinds of backing agents without accumulating tool-specific branches in the Harness. Some tools need their own client interaction or application surfaces, such as a question form or a view of an agent's transcript. Agent sessions need state and continuity beyond an individual tool invocation, including sessions created before Fluidcast starts, and agent turns can run for minutes.

## Decision

Each tool is its own package. It exports a factory that builds the tool for the backend and a pure schema export that clients can import. The Harness consumes only a generic tool contract: the model-facing input schema, prompt guidelines, per-iteration context, and policies for blocking, response visibility, and replay. It never recognizes particular tool names.

Tool outcomes distinguish **errors** from **faults**. Errors are expected failures within the tool's domain; they complete the invocation and follow its response policy. Faults are infrastructure failures; they halt the conversation for the user to resolve.

Tool-specific surfaces belong to the tool package and the application, not the Harness or Client SDK: typed client commands to a running invocation, agent transcripts, and agent session identities.

A single model-facing agent tool routes agent type, agent ID, and message to one stateful pool per agent type, owned by a single Fluidcast session. Unknown IDs create agents; pools also accept preloaded sessions. A message to a busy agent steers its running turn rather than queuing behind it, and one agent result completes every invocation that turn consumed. Factory options and hooks, not the voice model, control the underlying harness, model, reasoning effort, and prompt shaping.

## Consequences

- New tools and agent types require no Harness changes, and applications include only the tools and agent SDKs they use.
- Clients depend on tool schemas without importing backend code, so each tool package keeps a pure export.
- Session lifecycle, progress production, and prompt adaptation stay inside the agent tool package, outside generic scheduling.
- Pools are not shared across Fluidcast sessions; sharing can be revisited when a real need appears.
- A single agent result may answer several invocations, so the harness must support one result completing more than one call.

See [Tools and agents](../architecture/tools-and-agents.md).
