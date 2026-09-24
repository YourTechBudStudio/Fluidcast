# Architecture overview

## Components and ownership

| Component | Responsibility |
| --- | --- |
| **Core SDK** | Stateless action generation and text-to-speech. Parses model output into an asynchronous action stream and generates action IDs without storing them. |
| **Harness SDK** | Owns conversation history, action state, the playback cursor, tool execution, and iteration scheduling. Resolves action IDs to content for audio requests. |
| **Browser SDK** | Communicates with the application backend, coordinates playback with the harness, and prefetches/caches audio. Applications supply actual playback. |
| **Application integration** | Owns the server, transport, UI, and connections between these components. No separate backend integration SDK initially. |

The browser talks only to the application backend, never directly to Core or model providers. Integration is transport-neutral; neither a server framework nor HTTP/SSE versus WebSockets is prescribed.

Core accepts caller-owned history, instructions, tool definitions, and speaker profiles. The harness assembles conversation input from user messages, tool responses, and queued key-value context; context injection does not itself trigger an iteration.

Core targets OpenAI-compatible chat completions and TTS. The existing Fluidcast is a behavioral reference, not an architectural dependency.

## Generation and execution

The model produces a JSON array of **speak** and **tool-call** actions rather than native LLM tool calls. Core exposes parsed actions incrementally. One speak action belongs to one speaker; speaker profiles describe identity and personality, with explicit voice configuration and no tone field initially.

The harness cursor determines when actions take effect. Speech waits for playback completion; a tool starts when reached and then runs in the background while subsequent actions proceed. Tools are never executed early merely because they have been generated.

An **iteration** is one generation call. An **agentic turn** spans iterations until playback and tool work are finished and no eligible tool responses remain to be submitted. There is no explicit conversation-end action.

During normal continuation, eligible tool results or progress updates trigger another iteration only after the current stream and playback finish, subject to a short batching debounce and blocking-tool rules. Queued context accompanies the next iteration.

## Generic tools, specialized adapters

The harness remains tool-agnostic. Registration declares whether a tool blocks continuation, which outcomes become model input (`all`, `error`, or `none`), and whether it can execute again during replay. All tools support cancellation.

Initial tools ask the user a question, show content, or message an agent. Asking blocks continuation until final completion, not merely a partial update. An answer received during narration waits for playback to finish rather than interrupting it. Showing content reports errors rather than successful acknowledgments and supports replay.

Tool completion is tracked independently of response policy. Successful response-free tools need no further model iteration. Progress-driven continuation is configurable, and tool descriptions tell the model when success can be assumed without an acknowledgment.

One stateless agent tool routes `type`, `agentId`, and `message` to a stateful pool per agent type. Existing IDs address existing sessions; unknown IDs create sessions. Pools can be shared across Fluidcast sessions and accept preloaded agents. Calls to the same agent session queue, while different sessions can run concurrently.

Pool defaults and transformation hooks—not the voice model—select the underlying harness, model, reasoning effort, and SDK-specific skills or commands. Hooks can replace or template prompts and distinguish first from subsequent agent-session turns. Type descriptions and existing agent IDs/statuses are contributed as context so the model can select the appropriate agent.

## Playback and recovery boundaries

The backend is authoritative. Delivery acknowledgment is distinct from playback completion, and completion is distinct from the user's Next control. Playback instructions have their own identity so stale acknowledgments cannot advance a later playback.

Pause or disconnection freezes cursor advancement, not running tools; their results queue. Back moves to the previous speak action without reverse execution or automatic visual restoration. Forward replay executes only replay-enabled tools. Next advances the cursor by one position, with intervening tools handled normally. On reconnection, the browser can request a cursor reset and resume playback rather than reconstructing the exact amount of audio heard.

Interruption stops current presentation and generation, trims history after the cursor, and requests cancellation of unfinished tools without waiting for cleanup. The current speak action remains in history even if partially heard. Already-received eligible results are retained; late results from canceled calls are ignored. Rewinding and interrupting may intentionally erase evidence of earlier tool execution; no rollback or evidence-preservation mechanism is required initially.

Generation or parsing failures become harness-generated **error** actions after valid buffered actions. These are runtime events, not model-generated conversation content. The application owns their presentation. Explicit retry continues from retained history and queued inputs rather than replaying executed work; it does not cancel running tools.

Tool failures complete their invocations and follow the declared response policy. TTS or playback failure leaves the cursor in place for application-directed retry, skip, or interruption.

## Audio boundary

The harness requests speech but does not manage lookahead. The browser SDK prefetches the next three speak actions through the backend, using pluggable storage with in-memory and IndexedDB options.

If requested audio is not fully cached, only that action's in-flight prefetch is canceled and a fresh live-streaming request is used. Partial-download reuse and built-in playback are out of scope initially.

## Documentation boundary

These are architectural commitments, not final APIs. Exact schemas, parser mechanics, transport protocols, cache policies, and provider-specific adapters remain implementation design work. Expand documentation only when a decision changes scope, ownership, or externally meaningful behavior.
