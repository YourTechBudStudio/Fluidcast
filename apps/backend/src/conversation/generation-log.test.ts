import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Fiber, Layer, Stream } from 'effect';
import { AiError, LanguageModel, type Response } from 'effect/ai';
import { TestClock } from 'effect/testing';

import { generate } from '@yourtechbudstudio/fluidcast-core/generation';

import { handOffCapacity, withGenerationLog } from './generation-log.ts';

const directory = mkdtempSync(join(tmpdir(), 'fluidcast-generation-log-'));
after(() => rmSync(directory, { recursive: true }));

const text = (delta: string): Response.StreamPartEncoded => ({
  type: 'text-delta',
  id: 't',
  delta,
});
const finish: Response.StreamPartEncoded = {
  type: 'finish',
  reason: 'stop',
  usage: {
    inputTokens: { uncached: 1, total: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
};
const speak = (line: string) => JSON.stringify({ type: 'speak', speaker: 'host', text: line });

/** The record at `path`, waiting for the reader to write it; it may write after Core's stream ends. */
const recorded = (path: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (existsSync(path) && readFileSync(path, 'utf8') !== '') {
        return JSON.parse(readFileSync(path, 'utf8'));
      }
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));
    }
    return yield* Effect.die(new Error('no record was written'));
  });

/** Whether a record is written at `path` within 50 ms. */
const recordWithin50Ms = (path: string) =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50))).pipe(
    Effect.map(() => existsSync(path)),
  );

/** A part produced only when pulled, one per chunk, counting the pulls in `pulls`. */
const pulled = (pulls: { count: number }, part: Response.StreamPartEncoded) =>
  Stream.fromEffect(
    Effect.sync(() => {
      pulls.count++;
      return part;
    }),
  );

/**
 * Runs Core's `generate` over a model that streams `parts`, through the generation log, and returns
 * the record it appended, keeping the layer's scope open until it is written. `interrupt` cancels
 * the run once it hangs. `afterCore` runs as soon as Core's stream has ended. Runs on the test
 * clock, which only `afterCore` advances.
 */
const logged = async (
  parts: Stream.Stream<Response.StreamPartEncoded, AiError.AiError>,
  options: {
    readonly interrupt?: boolean;
    readonly afterCore?: (path: string) => Effect.Effect<void>;
  } = {},
) => {
  const path = join(directory, `${crypto.randomUUID()}.jsonl`);
  const model = Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({ generateText: () => Effect.die('unused'), streamText: () => parts }),
  );
  const layer = withGenerationLog(path, 'm', new Set(['host'])).pipe(
    Layer.provide(model),
    Layer.provide(NodeServices.layer),
  );
  const run = generate({
    instructions: '',
    speakers: [{ id: 'host', name: 'Host', personality: 'Warm.' }],
    history: [],
    tools: [],
  }).pipe(Stream.runDrain, Effect.ignore);
  return Effect.runPromise(
    Effect.gen(function* () {
      if (options.interrupt === true) {
        const fiber = yield* Effect.forkChild(run);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)));
        yield* Fiber.interrupt(fiber);
      } else {
        yield* run;
      }
      if (options.afterCore !== undefined) yield* options.afterCore(path);
      return yield* recorded(path);
    }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
  );
};

/** The record's verdict. */
const record = async (...args: Parameters<typeof logged>) => {
  const { ended, error } = await logged(...args);
  return { ended, error };
};

describe('withGenerationLog', () => {
  it('records a reply Core accepted as completed, with the finish part read after Core stopped', async () => {
    const parts = Stream.make(text(`[${speak('a')}]`), finish);
    const { ended, error, finish: finished } = await logged(parts);
    assert.deepEqual({ ended, error }, { ended: 'completed', error: undefined });
    assert.deepEqual(finished, { reason: 'stop', inputTokens: 1, outputTokens: 1 });
  });

  it('reads on to a finish part that arrives after Core accepted the reply, without holding Core', async () => {
    // The finish part waits on the test clock, which only moves once Core's stream has ended: had
    // the log held Core until the finish part, the run would never end.
    const parts = Stream.make(text(`[${speak('a')}]`)).pipe(
      Stream.concat(
        Stream.fromEffect(
          Effect.sleep('100 millis').pipe(
            Effect.as({
              ...finish,
              usage: {
                ...finish.usage,
                inputTokens: { uncached: 10, total: 4020, cacheRead: 4000, cacheWrite: 10 },
              },
            } satisfies Response.StreamPartEncoded),
          ),
        ),
      ),
    );
    const entry = await logged(parts, { afterCore: () => TestClock.adjust('100 millis') });
    assert.equal(entry.ended, 'completed');
    assert.deepEqual(entry.finish, {
      reason: 'stop',
      inputTokens: 4020,
      outputTokens: 1,
      cacheReadInputTokens: 4000,
      cacheWriteInputTokens: 10,
    });
  });

  it('stops reading at once when Core stops on a reply it rejected, without draining', async () => {
    const pulls = { count: 0 };
    const invalid = JSON.stringify({ type: 'speak', speaker: 'guest', text: 'a' });
    // Core needs the first two parts to reject the reply.
    const needed = 2;
    const trailing = Array.from({ length: 20 }, () => text(`,${speak('b')}`));
    const parts = [text('['), text(invalid), ...trailing, finish]
      .map((part) => pulled(pulls, part))
      .reduce((stream, next) => Stream.concat(stream, next));
    const entry = await logged(parts);
    assert.deepEqual(
      { ended: entry.ended, error: entry.error, finish: entry.finish },
      {
        ended: 'failed',
        error: { tag: 'InvalidAction', index: 0, reason: 'unknown_speaker' },
        finish: undefined,
      },
    );
    // The same chunk-level read-ahead as a plain pass-through: Core's last chunk takes everything
    // buffered (up to the capacity), the queue refills, and the reader holds one more part.
    assert.ok(pulls.count <= needed + 2 * handOffCapacity, `pulled ${pulls.count} parts`);
  });

  it('gives up on a finish part that never arrives after two seconds, recording the reply', async () => {
    const parts = Stream.make(text(`[${speak('a')}]`)).pipe(Stream.concat(Stream.never));
    let writtenEarly: boolean | undefined;
    const entry = await logged(parts, {
      afterCore: (path) =>
        Effect.gen(function* () {
          yield* TestClock.adjust('1999 millis');
          writtenEarly = yield* recordWithin50Ms(path);
          yield* TestClock.adjust('1 millis');
        }),
    });
    assert.equal(writtenEarly, false);
    assert.deepEqual(
      { ended: entry.ended, error: entry.error, finish: entry.finish },
      { ended: 'completed', error: undefined, finish: undefined },
    );
  });

  it('records an invalid element as failed, with its index and reason', async () => {
    const parts = Stream.make(
      text(`[${speak('a')},{"type":"speak","speaker","host":"host","text":"b"}]`),
      finish,
    );
    assert.deepEqual(await record(parts), {
      ended: 'failed',
      error: { tag: 'InvalidAction', index: 1, reason: 'json' },
    });
  });

  it('records an unknown speaker as failed', async () => {
    const parts = Stream.make(
      text(`[${JSON.stringify({ type: 'speak', speaker: 'guest', text: 'a' })}]`),
      finish,
    );
    assert.deepEqual(await record(parts), {
      ended: 'failed',
      error: { tag: 'InvalidAction', index: 0, reason: 'unknown_speaker' },
    });
  });

  it('records a reply the provider finished without closing as failed', async () => {
    const parts = Stream.make(text(`[${speak('a')}`), finish);
    assert.deepEqual(await record(parts), {
      ended: 'failed',
      error: { tag: 'MalformedOutput', reason: 'unterminated' },
    });
  });

  it('records the prompt-cache reads and writes in the finish usage', async () => {
    const parts = Stream.make(text(`[${speak('a')}`), {
      ...finish,
      usage: {
        ...finish.usage,
        inputTokens: { uncached: 10, total: 4020, cacheRead: 4000, cacheWrite: 10 },
      },
    } satisfies Response.StreamPartEncoded);
    assert.deepEqual((await logged(parts)).finish, {
      reason: 'stop',
      inputTokens: 4020,
      outputTokens: 1,
      cacheReadInputTokens: 4000,
      cacheWriteInputTokens: 10,
    });
  });

  it('records no cache fields when the usage has none', async () => {
    const parts = Stream.make(text(`[${speak('a')}`), finish);
    assert.deepEqual((await logged(parts)).finish, {
      reason: 'stop',
      inputTokens: 1,
      outputTokens: 1,
    });
  });

  it('records an interrupt mid-reply as cancelled', async () => {
    const parts = Stream.make(text(`[${speak('a')},`)).pipe(Stream.concat(Stream.never));
    assert.deepEqual(await record(parts, { interrupt: true }), {
      ended: 'cancelled',
      error: undefined,
    });
  });

  it('records a provider failure as failed, with its reason tag', async () => {
    const parts = Stream.fail(
      AiError.make({
        module: 'test',
        method: 'streamText',
        reason: new AiError.RateLimitError({}),
      }),
    );
    assert.deepEqual(await record(parts), {
      ended: 'failed',
      error: { tag: 'RateLimitError' },
    });
  });
});
