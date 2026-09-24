# Tools and agents

## Generic tool policies

The harness remains tool-agnostic. Registration declares whether a tool blocks continuation, which outcomes become model input (`all`, `error`, or `none`), and whether it can execute again during replay. All tools support cancellation.

Tool completion is tracked independently of response policy. Successful response-free tools need no further model iteration. Progress-driven continuation is configurable, and tool descriptions tell the model when success can be assumed without an acknowledgment.

Initial tools:

- **Ask:** Blocks continuation until final completion, not merely a partial update. An answer received during narration waits for playback to finish rather than interrupting it.
- **Show:** Presents Mermaid, Markdown, or HTML; reports errors rather than successful acknowledgments and supports replay.
- **Agent:** Routes messages to agent sessions through a single exposed tool.

## Agent pools

One stateless agent tool routes `type`, `agentId`, and `message` to a stateful pool per agent type. Existing IDs address existing sessions; unknown IDs create sessions. Pools can be shared across Fluidcast sessions and accept preloaded agents. Calls to the same agent session queue, while different sessions can run concurrently.

Pool defaults and transformation hooks—not the voice model—select the underlying harness, model, reasoning effort, and SDK-specific skills or commands. Hooks can replace or template prompts and distinguish first from subsequent agent-session turns. Type descriptions and existing agent IDs/statuses are contributed as context so the model can select the appropriate agent.
