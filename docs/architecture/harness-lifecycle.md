# Harness lifecycle

## Cursor-driven execution

The harness cursor determines when actions take effect. Speech waits for playback completion; a tool starts when reached and then runs in the background while subsequent actions proceed. Tools are never executed early merely because they have been generated.

An **iteration** is one generation call. An **agentic turn** begins with user input (or supplied starting context) and spans iterations until playback and tool work are finished and no eligible tool responses remain to be submitted. There is no explicit conversation-end action: completion is derived from outstanding work, not declared by the model.

## Normal continuation

After generation and playback finish, with the player neither paused nor disconnected:

| Outstanding work                                        | Harness behavior                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A blocking tool is unfinished                           | Wait for its final completion, even if other results are ready.                                                         |
| Eligible results or enabled progress updates are queued | Batch briefly, then submit them with queued context in another iteration. Other nonblocking tools may still be running. |
| Tools are running, but no eligible responses are queued | Wait; an empty playback queue does not mean the turn is complete.                                                       |
| No tools or eligible responses remain                   | Finish the agentic turn and await user input.                                                                           |

A successful response-free tool can finish the turn without another iteration. The harness assembles input from user messages, tool responses, and queued key-value context. Context alone does not trigger continuation.

## Playback and history

Pause or disconnection freezes cursor advancement, not running tools; their results queue. Back moves to the previous speak action without reverse execution or automatic visual restoration. Forward replay executes only replay-enabled tools. Next advances the cursor by one position, with intervening tools handled normally.

Interruption stops current presentation and generation, trims history after the cursor, and requests cancellation of unfinished tools without waiting for cleanup. The current speak action remains in history even if partially heard. Already-received eligible results are retained; unfinished calls are reported as canceled, and their late results are ignored.

Rewinding and interrupting may intentionally erase evidence of earlier tool execution, including its cancellation notice. No rollback or evidence-preservation mechanism is required initially.

## Failures and retry

Generation or parsing failures become harness-generated **error** actions after valid buffered actions. These are runtime events, not model-generated conversation content. The application owns their presentation. Explicit retry continues from retained history and queued inputs rather than replaying executed work; it does not cancel running tools.

Tool failures complete their invocations and follow the declared response policy. TTS or playback failure leaves the cursor in place for application-directed retry, skip, or interruption.
