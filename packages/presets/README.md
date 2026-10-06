# @yourtechbudstudio/fluidcast-presets

Voice behavior for Fluidcast sessions. The SDKs carry only mechanics; a preset supplies the instructions, worked examples, speaker profile and reminders that make the voice behave a certain way.

## The Guided Walkthrough

The agent behind the `forward_agent` tool does the thinking, and the voice walks the listener through its work one segment at a time. It has two profiles:

- `detailed` (default): the protocol, a fuller speaking style and worked examples. Tuned and checked on held-out cases with Qwen3.8-27B (medium reasoning, temperature 0.3, server-enforced JSON). Its walk-through speech, which gives each screen's highlights, was added later and checked only in a 7-case mini eval.
- `compact`: the protocol alone, for more capable models. Untested; the next thing to try is GPT-6.1 Sol.

## Usage

```ts
const program = Effect.gen(function* () {
  const forward = yield* forwardAgentTool({
    worker,
    progress: { prompt: guidedWalkthroughProgressPrompt },
  });
  const preset = guidedWalkthrough({ profile: 'detailed', voice: { name: 'alloy' } });
  return harnessLayer({
    ...preset,
    speechFormat: 'opus',
    tools: [showTool(), askTool(), forward.tool],
  });
});
```

To customize, override one field, such as the speaker's display name, rather than rewording the tuned text: small wording changes move results in both directions.

See [Presets and instructions](../../docs/product/presets.md), [Guided walkthrough prompting](../../docs/research/guided-walkthrough-prompting.md) and [the evaluation](../../docs/evals/README.md).
