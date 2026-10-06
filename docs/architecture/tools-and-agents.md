# Tools and the worker

## Generic tool contract

The harness is tool-agnostic. Each tool is a separate package whose factory supplies everything the model sees of it (input schema, short guidelines that state its mechanics, and how its results and the model's own earlier calls read back), optional per-iteration context, and policies: whether it blocks continuation, which outcomes the model reads (`all`, `error`, or `none`), and whether it executes again during replay. Tools supply no reminders. Clients import the tool's pure schema export to present it and send typed commands to a running invocation. Guidelines say what a tool does, not how the voice should use it in a particular experience: that, and every reminder, belongs to the preset ([ADR 0005](../adrs/0005-voice-behavior-as-presets.md)).

**Errors** complete the invocation and follow the response policy. **Faults** halt the conversation until the user acts. The model writes each tool call as its own action alongside speech; the harness never reorders them, and harness-assigned handles let later results refer to calls.

The contract itself is `ToolDefinition` (`packages/core/src/generation/tools.ts`) and `Tool` (`packages/harness/src/tool.ts`).

## Initial tools

- **Show:** Presents Markdown, Mermaid, or HTML with an optional title. Each show is complete and replaces the last. The client reports rendering, so render failures reach the model as errors.
- **Ask:** Asks the listener exactly one question: free text, single choice, or multiple choice. Options are short labels only, with free text always available. It blocks until answered, or until an interrupt cancels it unanswered.
- **Forward Agent:** Hands the conversation to the session's one worker, the agent that does the thinking. It has no fields: the model writes `{"type":"forward_agent"}`.

## The worker

Fluidcast is worker-first: every session has exactly one worker, such as a Claude Code session, behind the Forward Agent tool ([ADR 0004](../adrs/0004-tools-and-the-worker.md)). The voice model is not an agent: the worker does all of the thinking and work, and the voice never writes its task. How the voice presents the worker's replies (in the Guided Walkthrough, in the first person, as the assistant), when it forwards, and what it says while waiting are the preset's, not the tool's.

The worker receives the listener's exact words with what the voice said and showed since its last message, built from the session log; the listener's own words take precedence. A forward sent while the worker is busy steers its running turn, and one result answers every call that turn consumed. The voice reads the result as the worker wrote it: every top-level message since the last forward, in order, never summarised or split by code. The worker's state is per-iteration context, and first-person progress snapshots arrive on a schedule that backs off.

Factory options, not the voice model, select the worker (its agent SDK, model, reasoning effort and working directory), and an optional preloaded session to resume, such as a fork of a recorded Claude Code session. A factory hook can reshape each message, for example to add a skill. The factory and hand-off live in `packages/tool-agent/src/forward-tool.ts` and `handoff.ts`.
