import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Clock, Effect, Fiber, Ref, type Schedule, Stream, SubscriptionRef } from 'effect';
import { TestClock } from 'effect/testing';
import { AiError, LanguageModel } from 'effect/unstable/ai';

import {
  defaultProgressPrompt,
  defaultProgressSchedule,
  oneSentence,
  progressLoop,
} from './progress.ts';
import type { TranscriptEntry } from './schema.ts';

const text = (value: string): TranscriptEntry => ({
  _tag: 'text',
  parentToolUseId: null,
  text: value,
});

interface Call {
  readonly at: number;
  readonly lines: string;
}

/**
 * A progress loop over a transcript, with a model that answers from `replies` (a string, or
 * `undefined` to fail) and an `offer` that answers from `accepts`. Returns what it saw.
 */
const setup = (options: {
  readonly entries: ReadonlyArray<TranscriptEntry>;
  readonly start?: number;
  readonly replies?: (call: number) => string | undefined;
  readonly accepts?: (offer: number) => boolean;
  readonly schedule?: Schedule.Schedule<unknown>;
}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<Call>>([]);
    const offers = yield* Ref.make<ReadonlyArray<string>>([]);
    const model = yield* LanguageModel.make({
      // Like the vLLM server's non-streaming replies, which the compatible client rejects.
      generateText: () =>
        AiError.make({
          module: 'Test',
          method: 'generateText',
          reason: new AiError.InvalidOutputError({
            description: 'Expected string at ["service_tier"]',
          }),
        }),
      streamText: (request) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const at = yield* Clock.currentTimeMillis;
            const user = request.prompt.content.find((message) => message.role === 'user');
            const lines =
              user === undefined || typeof user.content === 'string'
                ? String(user?.content)
                : user.content.map((part) => ('text' in part ? part.text : '')).join('');
            const all = yield* Ref.updateAndGet(calls, (previous) => [...previous, { at, lines }]);
            const reply = (options.replies ?? (() => 'Comparing the retry designs.'))(all.length);
            if (reply === undefined) {
              return Stream.fail(
                AiError.make({
                  module: 'Test',
                  method: 'streamText',
                  reason: new AiError.RateLimitError({}),
                }),
              );
            }
            // Split in two deltas: the snapshot is their concatenation.
            const middle = Math.floor(reply.length / 2);
            return Stream.make(
              { type: 'text-delta' as const, id: 't', delta: reply.slice(0, middle) },
              { type: 'text-delta' as const, id: 't', delta: reply.slice(middle) },
            );
          }),
        ),
    });
    const transcript = yield* SubscriptionRef.make(options.entries);
    const fiber = yield* Effect.forkChild(
      progressLoop({
        schedule: options.schedule ?? defaultProgressSchedule,
        prompt: defaultProgressPrompt,
        model,
        transcript: SubscriptionRef.get(transcript),
        start: options.start ?? 0,
        offer: (value) =>
          Ref.updateAndGet(offers, (previous) => [...previous, value]).pipe(
            Effect.map((all) => (options.accepts ?? (() => true))(all.length)),
          ),
      }),
    );
    /** Moves the test clock to `seconds` after start, one second at a time. */
    const advanceTo = (seconds: number) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        for (let at = now + 1000; at <= seconds * 1000; at += 1000) {
          yield* TestClock.setTime(at);
        }
      });
    return {
      calls: Ref.get(calls),
      offers: Ref.get(offers),
      transcript,
      advanceTo,
      stop: Fiber.interrupt(fiber),
    };
  });

const run = <A>(effect: Effect.Effect<A, never, never>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())) as Effect.Effect<A>);

describe('progressLoop', () => {
  it('streams its snapshot, so a server whose non-streaming replies fail still gets progress', () =>
    run(
      Effect.gen(function* () {
        const loop = yield* setup({ entries: [text('Reading.')] });
        yield* loop.advanceTo(10);
        assert.deepEqual(yield* loop.offers, ['Comparing the retry designs.']);
        yield* loop.stop;
      }),
    ));

  it('ticks at 10, 20, 30, 45, 60 and 90 seconds by default', () =>
    run(
      Effect.gen(function* () {
        // Every offer is dropped, so every tick has something new to describe.
        const loop = yield* setup({ entries: [text('Reading.')], accepts: () => false });
        yield* loop.advanceTo(100);
        assert.deepEqual(
          (yield* loop.calls).map((call) => call.at / 1000),
          [10, 20, 30, 45, 60, 90],
        );
        yield* loop.advanceTo(151);
        assert.equal((yield* loop.calls).at(-1)?.at, 150_000);
        yield* loop.stop;
      }),
    ));

  it('skips a tick with nothing new since the last used snapshot', () =>
    run(
      Effect.gen(function* () {
        const loop = yield* setup({ entries: [text('Reading.')] });
        yield* loop.advanceTo(25);
        assert.equal((yield* loop.calls).length, 1);
        assert.deepEqual(yield* loop.offers, ['Comparing the retry designs.']);
        yield* SubscriptionRef.update(loop.transcript, (entries) => [
          ...entries,
          {
            _tag: 'toolResult',
            parentToolUseId: null,
            toolUseId: 't',
            content: 'x',
            truncated: false,
            isError: false,
          },
        ]);
        yield* loop.advanceTo(35);
        assert.equal((yield* loop.calls).length, 1, 'a result alone is not activity');
        yield* SubscriptionRef.update(loop.transcript, (entries) => [...entries, text('Writing.')]);
        yield* loop.advanceTo(45);
        assert.deepEqual(
          (yield* loop.calls).map((call) => call.at / 1000),
          [10, 45],
        );
        yield* loop.stop;
      }),
    ));

  it('retries on the next tick after a dropped offer', () =>
    run(
      Effect.gen(function* () {
        const loop = yield* setup({ entries: [text('Reading.')], accepts: (offer) => offer > 1 });
        yield* loop.advanceTo(35);
        assert.deepEqual(
          (yield* loop.calls).map((call) => call.at / 1000),
          [10, 20],
        );
        yield* loop.stop;
      }),
    ));

  it('skips a failed model call and a rejected reply, and tries again next tick', () =>
    run(
      Effect.gen(function* () {
        const loop = yield* setup({
          entries: [text('Reading.')],
          replies: (call) =>
            call === 1
              ? undefined
              : call === 2
                ? 'Two sentences. Not one.'
                : 'Reading the code now',
        });
        yield* loop.advanceTo(35);
        assert.equal((yield* loop.calls).length, 3);
        assert.deepEqual(yield* loop.offers, ['Reading the code now.']);
        yield* loop.stop;
      }),
    ));

  it("describes the last 20 activity entries of the period, not prompts, results or earlier periods' entries", () =>
    run(
      Effect.gen(function* () {
        const entries: Array<TranscriptEntry> = [text('Before the period.')];
        entries.push({
          _tag: 'prompt',
          parentToolUseId: null,
          source: 'fluidcast',
          text: 'Hand-off',
        });
        for (let index = 0; index < 22; index++) entries.push(text(`Step ${index}.`));
        entries.push({
          _tag: 'toolCall',
          parentToolUseId: null,
          toolUseId: 't',
          name: 'Bash',
          input: `{"command":"${'x'.repeat(200)}"}`,
          truncated: false,
        });
        entries.push({ _tag: 'status', parentToolUseId: 't', text: 'Subagent is searching.' });
        entries.push({ _tag: 'turnEnd', parentToolUseId: null, outcome: 'success' });
        const loop = yield* setup({ entries, start: 1 });
        yield* loop.advanceTo(10);
        const [call] = yield* loop.calls;
        const lines = call!.lines.split('\n');
        assert.equal(lines.length, 20);
        assert.equal(lines[0], 'Step 4.');
        assert.equal(lines.at(-2), `Bash({"command":"${'x'.repeat(120 - 12)})`);
        assert.equal(lines.at(-1), 'Subagent is searching.');
        yield* loop.stop;
      }),
    ));
});

describe('oneSentence', () => {
  it('accepts one sentence, strips quotes and adds a final full stop', () => {
    assert.equal(
      oneSentence('  "Comparing the two retry designs"  '),
      'Comparing the two retry designs.',
    );
    assert.equal(oneSentence('Is the backend ready?'), 'Is the backend ready?');
    assert.equal(oneSentence('Editing session.ts right now.'), 'Editing session.ts right now.');
  });

  it('rejects two sentences, fragments, line breaks, empty and over-long replies', () => {
    assert.equal(oneSentence('Reading files. Then writing tests.'), undefined);
    assert.equal(oneSentence('Reading files.'), undefined);
    assert.equal(oneSentence('Reading files\nand tests'), undefined);
    assert.equal(oneSentence('  '), undefined);
    assert.equal(oneSentence(`Reading ${'files '.repeat(40)}`), undefined);
  });
});
