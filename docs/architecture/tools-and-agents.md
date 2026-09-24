# Tools and agents

## Generic tool policies

The harness remains tool-agnostic. Registration declares whether a tool blocks continuation, which outcomes become model input (`all`, `error`, or `none`), and whether it can execute again during replay. All tools support cancellation.

Response policy controls model input, not whether the harness tracks completion:

- **`all`:** Final results/errors and enabled progress updates are eligible for submission.
- **`error`:** Only failures are submitted; successful completion stays internal.
- **`none`:** No outcomes are submitted, including errors.

Successful response-free tools need no further model iteration. Progress-driven continuation is configurable, and tool descriptions tell the model when success can be assumed without an acknowledgment.

Tool instructions can encourage early placement or placement around speech. The model chooses the sequence; the harness never reorders it to start work early. Cancellation is per invocation and fire-and-forget; adapters own cleanup, while the harness ignores late events from canceled calls.

Initial tools:

- **Ask:** Supports user questions such as free text or choice inputs. Blocks continuation until final completion, not merely a partial update. The model is instructed to finish its iteration after asking, with accompanying narration allowed. An answer received during narration waits for playback to finish rather than interrupting it.
- **Show:** Presents Mermaid, Markdown, or HTML; reports errors rather than successful acknowledgments and supports replay.
- **Agent:** Routes messages to agent sessions through a single exposed tool.

## Agent pools

One stateless agent tool routes `type`, `agentId`, and `message` to a stateful pool per agent type. Existing IDs address existing sessions; unknown IDs create sessions. Pools can be shared across Fluidcast sessions and accept preloaded agents. Calls to the same agent session queue, while different sessions can run concurrently.

Pool defaults and transformation hooks—not the voice model—select the underlying harness, model, reasoning effort, and SDK-specific skills or commands. Hooks can replace or template prompts and distinguish first from subsequent agent-session turns. Type descriptions and existing agent IDs/statuses are contributed as context so the model can select the appropriate agent.

Isagi's workflow prompt object is a reference for prompt text, harness/model/effort settings, and structured skill or command modifiers—not a dependency. SDK-specific adapters translate those settings and provide progress and cancellation behavior.
