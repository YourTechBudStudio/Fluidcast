import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Exit, Layer, Ref, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { checkTools, generate } from '@yourtechbudstudio/fluidcast-core/generation';
import { ToolError } from '@yourtechbudstudio/fluidcast-harness';

import { showTool, type ShowCommand } from './index.ts';

const input = { format: 'markdown', content: '# Hi' } as const;

const runWith = (command: ShowCommand) =>
  Effect.runPromiseExit(
    showTool().run(input, { handle: 'call_1', awaitCommand: Effect.succeed(command) }),
  );

/** The system prompt Core builds for these tools, through the public `generate`. */
const systemPrompt = (tools: Parameters<typeof generate>[0]['tools']) =>
  Effect.gen(function* () {
    const captured = yield* Ref.make('');
    const model = yield* LanguageModel.make({
      generateText: () => Effect.die('unused'),
      streamText: (request) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const [system] = request.prompt.content;
            if (system?.role === 'system') yield* Ref.set(captured, system.content);
            return Stream.make({ type: 'text-delta' as const, id: 't', delta: '[]' });
          }),
        ),
    });
    yield* generate({
      instructions: '',
      speakers: [{ id: 'host', name: 'Host', personality: 'Warm.' }],
      history: [],
      tools,
    }).pipe(Stream.runDrain, Effect.provide(Layer.succeed(LanguageModel.LanguageModel, model)));
    return yield* Ref.get(captured);
  });

describe('showTool', () => {
  it('completes with an empty result when rendered', async () => {
    assert.deepEqual(await runWith({ rendered: true }), Exit.succeed({}));
  });

  it('fails with a ToolError carrying a capped reason when rendering failed', async () => {
    assert.deepEqual(
      await runWith({ failed: 'Parse error on line 2' }),
      Exit.fail(
        new ToolError({ message: 'The show could not be rendered: Parse error on line 2' }),
      ),
    );
    const long = await runWith({ failed: 'x'.repeat(500) });
    assert.deepEqual(
      long,
      Exit.fail(new ToolError({ message: `The show could not be rendered: ${'x'.repeat(300)}` })),
    );
  });

  it('never blocks, reports only errors, and replays', () => {
    assert.deepEqual(showTool().policy, { blocking: false, response: 'error', replay: true });
  });

  it('passes checkTools and renders into the prompt as a flat `Show` action', async () => {
    checkTools([showTool()]);
    const prompt = await Effect.runPromise(systemPrompt([showTool()]));
    assert.ok(
      prompt.includes(
        [
          'type Show = {',
          '  type: "show";',
          '  /** Heading above the content and on its transcript card. */',
          '  title?: string;',
          '  /** `markdown` for text and lists, `mermaid` for any diagram, `html` only for layouts Markdown cannot express. */',
          '  format: "markdown" | "mermaid" | "html";',
          '  /** The complete content in that format. It replaces whatever was shown before. */',
          '  content: string;',
          '};',
          '',
          'type Action = Speak | Show;',
        ].join('\n'),
      ),
    );
    assert.match(prompt, /\n- Use `show` to put material on screen: .*\n\n## Output format/);
  });
});
