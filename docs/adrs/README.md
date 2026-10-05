# Architecture decision records

ADRs preserve durable architectural decisions, their context, and their consequences. Accepted records describe agreed direction, not implementation status. Short-term defaults and operational details belong in the architecture topic documents rather than separate ADRs. When a decision changes, its ADR is rewritten to state the current decision rather than amended.

| ADR                                           | Decision                                                                     | Status   |
| --------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| [0001](0001-state-ownership.md)               | Stateless Core, an authoritative backend Harness, and clients as projections | Accepted |
| [0002](0002-conversation-as-an-action-log.md) | The conversation is one action log, run by a cursor                          | Accepted |
| [0003](0003-effect-native-execution.md)       | Effect-native execution and state with Effect v4                             | Accepted |
| [0004](0004-tools-and-the-worker.md)          | Tools as packages, and one worker per session                                | Accepted |
| [0005](0005-voice-behavior-as-presets.md)     | Voice behavior as presets on mechanics-only SDKs                             | Accepted |

Read the [architecture overview](../architecture/overview.md) for the connected model, or return to the [documentation guide](../README.md).
