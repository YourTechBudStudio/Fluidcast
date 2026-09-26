# Interaction model

A quiet player does not necessarily mean work is complete: agents may still be working and sending progress. Questions can appear before their spoken explanation finishes; answering does not cut off that narration. Users can explicitly interrupt when they want to redirect immediately.

## Player controls

- **Away/resume:** Step away and come back without abandoning background work. Nothing plays while away, and the next response is prepared once outstanding work returns. A session can start away, so starting it is resuming it.
- **Next:** Skip ahead while preserving execution of intervening tools.
- **Back:** Return to the previous speech without executing actions in reverse. Replaying speech does not rerun agent work; replayable presentation tools can show content again during forward playback.
- **Interrupt:** Redirect immediately, discarding presentation that has not happened yet. Agents keep working; corrections reach them as new messages. While an agent call is pending, the user interrupts before typing.

## Questions

Every question to the user goes through Ask, one question at a time. The question stays visible until answered, with free text always available alongside any choices. While a question is open, interrupting is unavailable, but the user can still step away and return to it.

## Attention

The attention signal answers one question for the user: does this need me? It is independent of Away.

- **Working:** Generation or a tool is in progress, or speech is playing while the user is present.
- **Needs you:** Nothing progresses without the user: the turn has finished, a question awaits an answer, or the user is away and a response is ready.
- **Idle:** The session has not started.
- **Error:** Something failed and needs the user's action.

## Recovery

Connection loss holds progression rather than abandoning background work. On reconnect, the player can restart from a selected action. Generation failures let valid buffered presentation finish before offering an explicit continuation retry—not a conversation restart. Infrastructure failures in tools halt the conversation and are shown as errors, without automatic recovery.

See [harness lifecycle](../architecture/harness-lifecycle.md) for the architectural rules behind these experiences.
