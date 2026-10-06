# ADR 0005: Voice behavior as presets on mechanics-only SDKs

## Status

Accepted as architectural direction; implementation is not implied.

## Context

What the voice does is decided by prompt text: its role, its spoken style, how it presents the worker's replies, worked examples, and the reminders after each new input. That text was spread across Core, the tools and application instructions, so it could not be changed or replaced as a whole. Measurement showed it is two things: a protocol that defines an experience, and tuning that helps a particular model follow it, where small wording changes move results in both directions. More capable models may need less tuning, and what works changes as models change.

## Decision

**The SDKs carry mechanics, not behavior.** Core, the Harness and the tools supply the output format, how actions and results read, the tools' mechanics, and a reminder slot after the newest input. None of them contains a voice role, a spoken style, reminder text, or advice on how to present the worker's work.

**Voice behavior is a preset**: configuration made of instructions, worked examples, a speaker profile and a reminders function over the newest input. Applications pass a preset like any other configuration and may override any part of it. A preset may offer profiles for models of different capability, chosen in configuration. A session with neither a preset nor instructions gets the mechanics only.

**Fluidcast's default preset is the Guided Walkthrough**: the worker does the thinking, the voice guides the listener through its work, and the listener drives the pace. Its rules and profiles are described in [Presets and instructions](../product/presets.md).

**Presets are tuned against an evaluation**, and changes to them are re-evaluated.

## Consequences

- Capable models can drop tuning they do not need through configuration, while smaller models get tested behavior.
- A different experience is a different preset, with no SDK change.
- Integrators must choose a preset or write their own instructions.
- A preset's reminders depend on what the Harness reports about the newest input, so that report is part of the preset contract.
- The speaker's personality belongs to the preset because it is part of the evaluated prompt; the synthesized voice stays an application setting.

See [Core SDK](../architecture/core-sdk.md) and [Guided walkthrough prompting](../research/guided-walkthrough-prompting.md).
