# Interaction model

A quiet player does not necessarily mean work is complete: agents may still be working and sending progress. Questions can appear before their spoken explanation finishes; answering does not cut off that narration. Users can explicitly interrupt when they want to redirect immediately.

## Player controls

- **Pause/resume:** Hold or continue presentation without abandoning background work.
- **Next:** Skip ahead while preserving execution of intervening tools.
- **Back:** Return to the previous speech without executing actions in reverse. Replaying speech does not rerun agent work; replayable presentation tools can show content again during forward playback.
- **Interrupt:** Redirect immediately, discarding future presentation and canceling unfinished tool calls. Already-received results remain available, but late results are ignored.

## Recovery

Connection loss pauses progression rather than abandoning background work. On reconnect, the player can restart from a selected action. Generation failures let valid buffered presentation finish before offering an explicit continuation retry—not a conversation restart.

See [harness lifecycle](../architecture/harness-lifecycle.md) for the architectural rules behind these experiences.
