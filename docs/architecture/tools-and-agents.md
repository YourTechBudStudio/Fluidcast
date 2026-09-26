# Tools and agents

## Generic tool contract

The harness remains tool-agnostic. Each tool is a separate package whose factory supplies the model-facing input schema, prompt guidelines, optional per-iteration context, and policies: whether it blocks continuation, which outcomes become model input (`all`, `error`, or `none`), and whether it can execute again during replay. Clients import the tool's pure schema export to present it and to send typed commands to a running invocation.

Response policy controls model input, not whether the harness tracks completion; every tool reports completion. **Errors** complete the invocation and follow the response policy. **Faults** halt the conversation until the user acts.

The model writes each tool call as its own flat action type alongside speech. Tool instructions can encourage early placement or placement around speech; the model chooses the sequence, and the harness never reorders it to start work early. Tool calls carry harness-assigned handles so later results can refer to them.

## Initial tools

- **Show:** Presents Markdown, Mermaid, or HTML with an optional title. Each show is independent and complete. The client reports rendering, so render failures reach the model as errors. Supports replay.
- **Ask:** Asks exactly one question: free text, single choice, or multiple choice, with free text always available. It blocks: while it is open, other results are held and submitted with the answer. It is the way to ask the user anything.
- **Agent:** Sends a message to an agent by type and ID.

## Agent pools

One agent tool routes `type`, `agent`, and `message` to a stateful pool per agent type, owned by a single Fluidcast session. Agent IDs are unique across types; unknown IDs create agents, and pools accept preloaded sessions by session ID. Live agents and their status are contributed as per-iteration context.

A message to a busy agent steers its running turn. One agent result completes every invocation that turn consumed, and results superseded by later messages are never submitted. A turn counts as finished only once the agent has no background work left. The agent tool produces short, standalone progress snapshots from recent agent activity on a schedule that starts frequent and backs off.

The agent receives the voice model's message as an instruction together with a Markdown rendering of the conversation since that agent's last message, in which the user's own words take precedence. A factory hook can reshape each message, for example to add a skill to the first one. Factory options, not the voice model, select the underlying agent SDK, model, reasoning effort, and working directory. Isagi's workflow prompt object is a reference for prompt text and skill or command modifiers, not a dependency.
