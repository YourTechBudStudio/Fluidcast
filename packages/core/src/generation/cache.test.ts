import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Layer, Stream } from 'effect';
import { LanguageModel, type Prompt } from 'effect/ai';

import { makeActionId, type Action } from '../actions/index.ts';
import { withCacheBreakpoints } from './cache.ts';
import { generate } from './generate.ts';

const marked = { anthropic: { cacheControl: { type: 'ephemeral' } } };

const system = { role: 'system', content: 'S' } as const;
const user = (content: string) => ({ role: 'user', content }) as const;
const assistant = (content: string) => ({ role: 'assistant', content }) as const;

/** The indexes of the marked messages. */
const marks = (messages: ReadonlyArray<Prompt.MessageEncoded>) =>
  messages.flatMap((message, index) => (message.options === undefined ? [] : [index]));

describe('withCacheBreakpoints', () => {
  it('marks only the system message on a first turn', () => {
    const result = withCacheBreakpoints([system, user('U1')]);
    assert.deepEqual(marks(result), [0]);
    assert.deepEqual(result[0], { ...system, options: marked });
  });

  it('marks the user message before the assistant reply, not the final user message', () => {
    const result = withCacheBreakpoints([system, user('U1'), assistant('A1'), user('U2')]);
    assert.deepEqual(marks(result), [0, 1]);
    assert.deepEqual(result[1], { ...user('U1'), options: marked });
  });

  it('marks only the user message just before the newest assistant reply', () => {
    const result = withCacheBreakpoints([
      system,
      user('U1'),
      assistant('A1'),
      user('U2'),
      assistant('A2'),
      user('U3'),
    ]);
    assert.deepEqual(marks(result), [0, 3]);
  });

  it('leaves its input unchanged', () => {
    const input = [system, user('U1'), assistant('A1'), user('U2')];
    withCacheBreakpoints(input);
    assert.deepEqual(marks(input), []);
  });
});

describe('generate cache breakpoints', () => {
  const speakers = [{ id: 'host', name: 'Host', personality: 'Warm.' }];
  const id = makeActionId;

  /** Runs `generate` over a fake model and returns the prompt it was sent. */
  const promptFor = (history: ReadonlyArray<Action>) =>
    Effect.gen(function* () {
      let sent: Prompt.Prompt | undefined;
      const model = Layer.effect(
        LanguageModel.LanguageModel,
        LanguageModel.make({
          generateText: () => Effect.die('unused'),
          streamText: (options) => {
            sent = options.prompt;
            return Stream.make({ type: 'text-delta' as const, id: 'text', delta: '[]' });
          },
        }),
      );
      yield* generate({
        instructions: 'Be brief.',
        speakers,
        history,
        tools: [],
        reminders: (event) => (event._tag === 'UserMessage' ? 'Answer briefly.' : undefined),
      }).pipe(Stream.runDrain, Effect.provide(model));
      assert.ok(sent !== undefined);
      return sent.content.map((message) => ({
        role: message.role,
        content: message.content,
        options: message.options,
      }));
    }).pipe(Effect.runPromise);

  const isMarked = (message: { readonly options: Prompt.ProviderOptions }) =>
    message.options['anthropic'] !== undefined;

  it('keeps the earlier prefix stable while the mark moves to the next user message', async () => {
    const first: ReadonlyArray<Action> = [
      { type: 'user_message', id: id(), text: 'Hi' },
      { type: 'speak', id: id(), speaker: 'host', text: 'Hello.' },
      { type: 'user_message', id: id(), text: 'Tell me more' },
    ];
    const second: ReadonlyArray<Action> = [
      ...first,
      { type: 'speak', id: id(), speaker: 'host', text: 'Sure.' },
      { type: 'user_message', id: id(), text: 'And then?' },
    ];
    const earlier = await promptFor(first);
    const later = await promptFor(second);

    assert.deepEqual(
      earlier.map((message) => message.role),
      ['system', 'user', 'assistant', 'user'],
    );
    assert.deepEqual(
      earlier.map(isMarked),
      [true, true, false, false],
      'the system message and the first user message are marked',
    );
    assert.match(JSON.stringify(earlier[3]?.content), /<reminder>/);
    const earlierMark = earlier.findLastIndex(isMarked);
    assert.deepEqual(
      later.slice(0, earlierMark + 1).map((message) => message.content),
      earlier.slice(0, earlierMark + 1).map((message) => message.content),
      'contents up to the earlier mark are identical',
    );
    assert.deepEqual(later[0]?.options, earlier[0]?.options);
    assert.deepEqual(
      later.map(isMarked),
      [true, false, false, true, false, false],
      'the mark moved to the user message before the newest assistant reply',
    );
  });
});
