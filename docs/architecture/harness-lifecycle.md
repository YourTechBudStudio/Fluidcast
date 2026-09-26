# Harness lifecycle

## Cursor-driven execution

The harness cursor determines when actions take effect. Speech waits for playback completion; a tool starts when reached and then runs in the background while subsequent actions proceed. Tools are never executed early merely because they have been generated.

An **iteration** is one generation call. An **agentic turn** begins with user input (or supplied starting context) and spans iterations until playback and tool work are finished and no eligible tool responses remain to be submitted. There is no explicit conversation-end action: completion is derived from outstanding work, not declared by the model.

## Normal continuation

After generation and playback finish, with the user present and connected:

| Outstanding work                                        | Harness behavior                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A blocking tool is unfinished                           | Wait for its final completion. Hold other results to submit with it, and drop progress updates.                    |
| Eligible results are queued                             | Batch briefly, then submit them with queued context in another iteration. Other nonblocking tools may still run.   |
| Tools are running, but no eligible responses are queued | Wait; an empty playback queue does not mean the turn is complete. A progress update, if one arrives, is submitted. |
| No tools or eligible responses remain                   | Finish the agentic turn and await user input.                                                                      |

Progress updates exist to fill silence. Each stands alone, so one arriving while anything is playing or generating is dropped rather than queued. While a tool call is pending, the user must interrupt before sending a message.

A successful response-free tool can finish the turn without another iteration. The harness assembles input from user messages, tool responses, and queued key-value context. Context alone does not trigger continuation. A session can begin from starting input: an optional message and labeled context supplied by the application.

## Playback and history

Disconnection freezes cursor advancement, not running tools; their results queue. Back moves to the previous speak action without reverse execution or automatic visual restoration. Forward replay executes only replay-enabled tools. Next advances the cursor by one position, with intervening tools handled normally.

Interruption stops current presentation and generation and trims history after the cursor, but running tools continue and their results remain eligible ([ADR 0008](../adrs/0008-presentation-controls-never-cancel-background-work.md)). The current speak action remains in history even if partially heard. Interrupts are ignored while a blocking tool is open.

Rewinding and interrupting may intentionally erase generated actions that never took effect. No rollback or evidence-preservation mechanism is required initially.

## Away

**Away** holds presentation while work continues. The cursor passes instant actions but stops at the next speak without playing it, and progress updates are dropped. Once every outstanding tool has returned, the harness generates the next response so resuming is immediate. The user can step away at any moment, including while a question is open. A session created Away waits for the user to start it by resuming.

## Failures and retry

Generation or parsing failures become harness-generated **error** actions after valid buffered actions. These are runtime events, not model-generated conversation content. The application owns their presentation. Explicit retry continues from retained history and queued inputs rather than replaying executed work; it does not cancel running tools.

Tool errors complete their invocations and follow the declared response policy. Tool faults halt the conversation without further generation until the user acts; no automatic recovery is attempted. TTS or playback failure leaves the cursor in place for application-directed retry, skip, or interruption.
