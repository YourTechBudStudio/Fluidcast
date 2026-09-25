import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Cause, Effect, Exit, Layer, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import type { Speak } from '../actions/index.ts';
import { InvalidAction, MalformedOutput } from './errors.ts';
import { generate } from './generate.ts';
import { parseActions } from './parser.ts';

const speakerIds = new Set(['host', 'guest']);

const line = (speaker: string, text: string) => ({ type: 'speak', speaker, text });

const output = JSON.stringify([
  line('host', 'Short first line.'),
  line('guest', 'She said "hi" \\ then left, with {braces} and [brackets].'),
  line('host', 'Unicode é and a newline\nin between.'),
]);

/** Parses `chunks` and returns the emitted actions (without IDs) and the failure, if any. */
const run = async (chunks: ReadonlyArray<string>) => {
  const emitted: Array<Omit<Speak, 'id'>> = [];
  const exit = await Effect.runPromiseExit(
    parseActions(Stream.fromIterable(chunks), { speakerIds }).pipe(
      Stream.runForEach((action) =>
        Effect.sync(() => {
          const { id, ...content } = action;
          assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          emitted.push(content);
        }),
      ),
    ),
  );
  const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  return { emitted, error };
};

const splitAt = (text: string, cuts: ReadonlyArray<number>) => {
  const sorted = [...new Set(cuts)].sort((a, b) => a - b);
  return [...sorted, text.length].map((end, index) => text.slice(sorted[index - 1] ?? 0, end));
};

describe('parseActions', () => {
  it('emits identical actions however the output is chunked', async () => {
    const expected = JSON.parse(output);
    const whole = await run([output]);
    assert.deepEqual(whole, { emitted: expected, error: undefined });

    // Every single split point, which covers splits inside strings and right after escapes.
    for (let cut = 0; cut <= output.length; cut++) {
      assert.deepEqual(await run(splitAt(output, [cut])), { emitted: expected, error: undefined });
    }
    // One character per chunk.
    assert.deepEqual(await run([...output]), { emitted: expected, error: undefined });
    // Random multi-way splits.
    for (let round = 0; round < 200; round++) {
      const cuts = Array.from({ length: 1 + (round % 12) }, () =>
        Math.floor(Math.random() * output.length),
      );
      assert.deepEqual(await run(splitAt(output, cuts)), { emitted: expected, error: undefined });
    }
  });

  it('skips prose and a code fence before the array and ignores text after it', async () => {
    const fenced = `Sure! Here you go:\n\`\`\`json\n${output}\n\`\`\`\nHope that helps [really].`;
    assert.deepEqual(await run(splitAt(fenced, [5, 30, 60])), {
      emitted: JSON.parse(output),
      error: undefined,
    });
  });

  it('accepts an empty array', async () => {
    assert.deepEqual(await run(['[', ' ', ']']), { emitted: [], error: undefined });
  });

  it('stops reading upstream at the closing bracket and ends successfully', async () => {
    const upstream = Stream.fromIterable([
      output.slice(0, 20),
      `${output.slice(20)} trailing`,
    ]).pipe(Stream.concat(Stream.fail('read past the closing bracket')));
    const actions = await Effect.runPromise(
      parseActions(upstream, { speakerIds }).pipe(Stream.runCollect),
    );
    assert.equal(actions.length, 3);
  });

  it('fails an invalid JSON element with its index after earlier actions were emitted', async () => {
    const { emitted, error } = await run([
      `[${JSON.stringify(line('host', 'First.'))}, {"type": "speak", "speaker": host}]`,
    ]);
    assert.deepEqual(emitted, [line('host', 'First.')]);
    assert.deepEqual(error, new InvalidAction({ index: 1, reason: 'json' }));
  });

  it('fails a schema-mismatched element with its index after earlier actions were emitted', async () => {
    const { emitted, error } = await run([
      JSON.stringify([
        line('host', 'First.'),
        line('host', 'Second.'),
        { type: 'shout', text: 'x' },
      ]),
    ]);
    assert.deepEqual(emitted, [line('host', 'First.'), line('host', 'Second.')]);
    assert.deepEqual(error, new InvalidAction({ index: 2, reason: 'schema' }));
  });

  it('fails a missing or misplaced separator at the index where an element was expected', async () => {
    const first = JSON.stringify(line('host', 'First.'));
    const cases = [
      { text: `[,${first}]`, emitted: 0, index: 0 },
      { text: `[${first},]`, emitted: 1, index: 1 },
      { text: `[${first},,${first}]`, emitted: 1, index: 1 },
      { text: `[${first} ${first}]`, emitted: 1, index: 1 },
    ];
    for (const { text, emitted, index } of cases) {
      assert.deepEqual(await run(splitAt(text, [3, text.length - 3])), {
        emitted: Array.from({ length: emitted }, () => line('host', 'First.')),
        error: new InvalidAction({ index, reason: 'json' }),
      });
    }
  });

  it('fails an unknown speaker ID', async () => {
    const { emitted, error } = await run([JSON.stringify([line('narrator', 'Hello.')])]);
    assert.deepEqual(emitted, []);
    assert.deepEqual(error, new InvalidAction({ index: 0, reason: 'unknown_speaker' }));
  });

  it('fails a truncated stream as malformed after emitting completed elements', async () => {
    const { emitted, error } = await run([output.slice(0, output.lastIndexOf('{') + 10)]);
    assert.deepEqual(emitted, JSON.parse(output).slice(0, 2));
    assert.deepEqual(error, new MalformedOutput({ reason: 'unterminated' }));
  });

  it('fails output with no array as malformed', async () => {
    const { error } = await run(['I would rather not.']);
    assert.deepEqual(error, new MalformedOutput({ reason: 'no_array' }));
  });
});

describe('generate', () => {
  it('ends successfully at the closing bracket without reading the rest of the response', async () => {
    const model = Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () => Effect.die('unused'),
        streamText: () =>
          Stream.fromIterable(
            [output.slice(0, 15), output.slice(15), ' and some trailing prose'].map((delta) => ({
              type: 'text-delta' as const,
              id: 'text',
              delta,
            })),
          ).pipe(Stream.concat(Stream.die('read past the closing bracket'))),
      }),
    );
    const actions = await Effect.runPromise(
      generate({
        instructions: '',
        speakers: [
          { id: 'host', name: 'Host', personality: 'Warm.' },
          { id: 'guest', name: 'Guest', personality: 'Dry.' },
        ],
        history: [],
      }).pipe(Stream.runCollect, Effect.provide(model)),
    );
    assert.deepEqual(
      actions.map(({ id: _id, ...content }) => content),
      JSON.parse(output),
    );
  });
});
