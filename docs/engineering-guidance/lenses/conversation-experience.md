# Conversation experience

Use this lens when a change affects what listeners hear, see, understand, or can do, or what integrators can observe and present. The SDKs do not own UI or playback, but they determine whether an application can present the experience truthfully.

## Questions

- Can the experience distinguish speaking, waiting on background work, awaiting user input, canceled, failed, and finished where those differences matter? Could a quiet player be mistaken for completed work?
- Do pause, resume, next, back, and interrupt behave as their names promise? Does pause keep background work running, does interrupt redirect without silently continuing canceled work, and does back avoid rerunning agent work?
- When generation, TTS, playback, or connection fails, can the listener continue from where they were rather than restarting the conversation? Does valid buffered presentation still finish before an error is offered?
- Are user answers and redirections preserved and applied as intended, without cutting off narration unexpectedly or being dropped across reconnects and retries?
- Does the change keep speech fluent and bounded, and use ordering and prefetch to hide latency rather than making listeners wait through avoidable silence?
- Do integrators receive enough state, events, and typed outcomes to present status, errors, and recovery choices honestly? Must they infer outcomes from timing or internals instead?
- Can listeners distinguish their own actions from agent-driven progress and changes when that distinction affects trust?
- In the reference web app, can essential controls be perceived and operated with a keyboard and assistive technology? Does it demonstrate honest status and recovery rather than hiding failures?

These questions do not prescribe screens, a built-in player, transport design, or cache policy. Apply them to behavior the change actually introduces or affects.

## Severity calibration

- **Blocker** — materially misleading or unusable behavior threatens the listener's work or control; for example, interrupt appears to redirect while canceled work continues to affect the conversation, a failure is presented as completion, back reruns agent work, or an essential control cannot be operated.
- **Concern** — a concrete interaction, trust, or integration gap; for example, a recoverable failure offers only a restart, an answer is lost across a reconnect, integrators cannot tell cancellation from failure, or avoidable silence replaces available background progress.
- **Nit** — an optional wording, pacing, or presentation improvement where meaning, control, and task completion are already sound. Personal aesthetic preference alone is not a finding.

Use the [review-consumption rules](../how-to-use.md#consuming-severity-findings) for next steps. Report underlying lifecycle or failure-handling defects under [state, runtime, and diagnostics](./state-runtime-and-diagnostics.md) rather than duplicating them here.
