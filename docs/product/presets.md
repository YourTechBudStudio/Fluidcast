# Presets and instructions

The voice's behavior comes from configuration, not from the SDKs. Fluidcast supplies the mechanics (the output format, the tools, and how results and reminders read); a **preset** supplies the behavior: instructions, worked examples, a speaker profile, and reminders for each new input ([ADR 0005](../adrs/0005-voice-behavior-as-presets.md)).

## The Guided Walkthrough preset

The default preset. The worker does the thinking, the voice is its guide, and the listener drives the pace:

- The voice speaks the worker's work in the first person and decides or answers nothing itself.
- Each worker reply is walked through one segment at a time: a short spoken line to orient, compact screens to carry the material, then a pause.
- The worker's questions are asked one at a time, where they come up. Answers are kept, never judged, and go back to the worker together in one forward at the end of the walkthrough.
- A Continue, a plain agreement or an answer means go on. An interrupt means redirect the worker now: the voice forwards at once with one neutral line.

It comes in two profiles of the same protocol:

| Profile    | Contents                                               | Use with                     |
| ---------- | ------------------------------------------------------ | ---------------------------- |
| `compact`  | The protocol alone                                     | Capable models               |
| `detailed` | The protocol, worked examples, and fuller spoken style | Smaller models, such as Qwen |

Choose the profile in configuration. The instructions name no product or particular worker: they say that an agent behind the `forward_agent` tool does the real thinking and work, and that the voice speaks its replies as its own. The synthesized voice stays an application setting.

## Overriding and writing your own

Any field of a preset can be overridden. Prefer overriding one field, such as a speaker's display name, to rewriting the preset: preset text is tuned and measured, and small wording changes move results in both directions. See [Guided walkthrough prompting](../research/guided-walkthrough-prompting.md) for what was learned. A different experience, such as delivering prepared material, is a different preset or a set of `instructions` and examples of your own, passed through the same configuration.
