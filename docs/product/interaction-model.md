# Interaction model

A quiet player does not necessarily mean work is complete: the worker may still be working and sending progress. Questions can appear before their spoken explanation finishes; answering does not cut off that narration. Users can explicitly interrupt when they want to redirect immediately.

## Player controls

- **Start:** A session can open with its first message already prepared by the application, such as one that continues an existing worker session. The user starts it with a tap; the first response is generated then.
- **Away/resume:** Step away and come back without abandoning background work. Nothing plays while away, and the next response is prepared once outstanding work returns.
- **Next:** Skip ahead while preserving execution of intervening tools.
- **Back:** Return to the previous speech without executing actions in reverse. Replaying speech does not rerun the worker's work; replayable presentation tools can show content again during forward playback.
- **Interrupt:** Redirect immediately, discarding presentation that has not happened yet. The worker keeps working; corrections reach it as new messages that steer its current work. While a forward is pending, the user interrupts before typing.

## Walkthroughs and questions

The listener drives. Each worker reply is walked through one segment at a time, and the walkthrough moves on only when the listener continues: a Continue, a plain agreement or an answer all mean go on. Interrupt is for breaking the flow to redirect the worker now; it is not needed to agree or to answer.

The voice has no questions of its own: the worker's questions become the voice's, asked in the first person, one at a time through Ask, where they come up in the reply. An Ask question stays visible until answered, with free text available alongside any choices. Between segments the walkthrough pauses on a Continue checkpoint, which offers only Continue and Interrupt. Answers are kept, not judged, and go back to the worker together in one forward when the walkthrough ends. The question's own Interrupt action declines it instead: the question closes unanswered, narration stops, and the user says what they want in its place, which the voice forwards at once. The user can still step away and return to it.

## Attention

The attention signal answers one question for the user: does this need me? It is independent of Away.

- **Working:** Generation or a tool is in progress, or speech is playing while the user is present.
- **Needs you:** Nothing progresses without the user: the turn has finished, a question awaits an answer, or the user is away and a response is ready.
- **Idle:** The session has not started.
- **Error:** Something failed and needs the user's action.

## Recovery

Connection loss holds progression rather than abandoning background work. On reconnect, the player can restart from a selected action. Generation failures let valid buffered presentation finish before offering an explicit continuation retry—not a conversation restart. Infrastructure failures in tools halt the conversation and are shown as errors, without automatic recovery.

See [harness lifecycle](../architecture/harness-lifecycle.md) for the architectural rules behind these experiences.
