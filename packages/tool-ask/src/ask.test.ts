import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Exit, Layer, Ref, Schema, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { checkTools, generate } from '@yourtechbudstudio/fluidcast-core/generation';

import { askAnswerSchema, askTool, type AskCommand, type AskInput } from './index.ts';

const options = [{ label: 'Client' }, { label: 'Server' }];
const text: AskInput = { kind: 'text', question: 'Which client do you use?' };
const choice: AskInput = { kind: 'choice', question: 'Who sends the request?', options };
const multi: AskInput = { kind: 'multi', question: 'Which hold state?', options };
const checkpoint: AskInput = { kind: 'continue', question: 'Ready for the next part?' };

const accepts = (input: AskInput, answer: unknown) =>
  Exit.isSuccess(Schema.decodeUnknownExit(askAnswerSchema(input))(answer));

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

describe('askAnswerSchema', () => {
  it('accepts free text for every kind of question except continue', () => {
    for (const input of [text, choice, multi]) {
      assert.ok(accepts(input, { kind: 'text', text: 'My own words' }));
      assert.ok(!accepts(input, { kind: 'text', text: '' }));
    }
  });

  it('accepts one offered label for a choice question, with optional text', () => {
    assert.ok(accepts(choice, { kind: 'choice', choice: 'Client' }));
    assert.ok(accepts(choice, { kind: 'choice', choice: 'Server', text: 'I think' }));
    assert.ok(!accepts(choice, { kind: 'choice', choice: 'Browser' }));
    assert.ok(!accepts(choice, { kind: 'multi', choices: ['Client'] }));
    assert.ok(!accepts(text, { kind: 'choice', choice: 'Client' }));
  });

  it('accepts distinct offered labels for a multi question', () => {
    assert.ok(accepts(multi, { kind: 'multi', choices: ['Client', 'Server'], text: '' }));
    assert.ok(!accepts(multi, { kind: 'multi', choices: [] }));
    assert.ok(!accepts(multi, { kind: 'multi', choices: ['Client', 'Client'] }));
    assert.ok(!accepts(multi, { kind: 'multi', choices: ['Client', 'Proxy'] }));
    assert.ok(!accepts(multi, { kind: 'choice', choice: 'Client' }));
    assert.ok(!accepts(text, { kind: 'multi', choices: ['Client'] }));
  });

  it('accepts only a continue answer for a continue question, and it for no other kind', () => {
    assert.ok(accepts(checkpoint, { kind: 'continue' }));
    assert.ok(!accepts(checkpoint, { kind: 'text', text: 'next' }));
    assert.ok(!accepts(checkpoint, { kind: 'choice', choice: 'Continue' }));
    assert.ok(!accepts(checkpoint, { kind: 'multi', choices: ['Continue'] }));
    for (const input of [text, choice, multi]) {
      assert.ok(!accepts(input, { kind: 'continue' }));
    }
  });
});

describe('askTool', () => {
  const answer = (input: AskInput, command: AskCommand) =>
    Effect.runPromise(
      askTool().run(input, { handle: 'call_1', awaitCommand: Effect.succeed(command) }),
    );
  const render = async (input: AskInput, command: AskCommand) =>
    askTool().renderResult(await answer(input, command));

  it('returns the question with the answer', async () => {
    assert.deepEqual(await answer(choice, { kind: 'choice', choice: 'Client' }), {
      question: 'Who sends the request?',
      answer: { kind: 'choice', choice: 'Client' },
    });
  });

  it('renders each kind, including free text given alongside options', async () => {
    assert.equal(
      await render(text, { kind: 'text', text: 'Firefox' }),
      'Question: Which client do you use?\nAnswer, in their own words: Firefox',
    );
    assert.equal(
      await render(choice, { kind: 'choice', choice: 'Client', text: '  not sure  ' }),
      'Question: Who sends the request?\nAnswer: Client\nThey added: not sure',
    );
    assert.equal(
      await render(choice, { kind: 'choice', choice: 'Client', text: '   ' }),
      'Question: Who sends the request?\nAnswer: Client',
    );
    assert.equal(
      await render(multi, { kind: 'multi', choices: ['Client', 'Server'], text: 'both?' }),
      'Question: Which hold state?\nAnswer: Client; Server\nThey added: both?',
    );
    assert.equal(
      await render(choice, { kind: 'text', text: 'Neither' }),
      'Question: Who sends the request?\nAnswer, in their own words: Neither',
    );
    assert.equal(
      await render(checkpoint, { kind: 'continue' }),
      'Question: Ready for the next part?\nAnswer: Continue',
    );
  });

  it("supplies no reminder: reminders are the configuration's", () => {
    assert.ok(!('reminder' in askTool()));
  });

  it('blocks, reports every outcome, and does not replay', () => {
    assert.deepEqual(askTool().policy, { blocking: true, response: 'all', replay: false });
  });

  it('passes checkTools and renders into the prompt as a flat `Ask` union', async () => {
    checkTools([askTool()]);
    const prompt = await Effect.runPromise(systemPrompt([askTool()]));
    const start = prompt.indexOf('type Ask = ');
    const declaration = prompt.slice(start, prompt.indexOf('\n\ntype Action', start));
    assert.equal(
      declaration,
      [
        'type Ask = {',
        '  type: "ask";',
        '  kind: "text";',
        '  /** Exactly one question. */',
        '  question: string;',
        '} | {',
        '  type: "ask";',
        '  kind: "choice";',
        '  /** Exactly one question. */',
        '  question: string;',
        '  options: {',
        '    /** A short answer the listener can pick. */',
        '    label: string;',
        '  }[];',
        '} | {',
        '  type: "ask";',
        '  kind: "multi";',
        '  /** Exactly one question. */',
        '  question: string;',
        '  options: {',
        '    /** A short answer the listener can pick. */',
        '    label: string;',
        '  }[];',
        '} | {',
        '  type: "ask";',
        '  kind: "continue";',
        '  /** Exactly one question. */',
        '  question: string;',
        '};',
      ].join('\n'),
    );
    assert.match(prompt, /type Action = Speak \| Ask;/);
    assert.match(
      prompt,
      /\n- Use `ask` for one question that needs the listener's answer\. .*\n\n## Output format/,
    );
  });
});
