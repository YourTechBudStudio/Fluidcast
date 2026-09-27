import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Fiber, Layer, Stream } from 'effect';
import { AiError, LanguageModel, type Response } from 'effect/unstable/ai';

import { generate } from '@yourtechbudstudio/fluidcast-core/generation';

import { withGenerationLog } from './generation-log.ts';

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

/**
 * Runs Core's `generate` over a model that streams `parts` (then hangs, when `hang`), through the
 * generation log, and returns the record it appended. `interrupt` cancels the run once it hangs.
 */
const record = async (
  parts: Stream.Stream<Response.StreamPartEncoded, AiError.AiError>,
  options: { readonly interrupt?: boolean } = {},
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
  }).pipe(Stream.runDrain, Effect.provide(layer), Effect.ignore);
  await Effect.runPromise(
    options.interrupt === true
      ? Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(run);
          yield* Effect.sleep('20 millis');
          yield* Fiber.interrupt(fiber);
        })
      : run,
  );
  const { ended, error } = JSON.parse(readFileSync(path, 'utf8'));
  return { ended, error };
};

describe('withGenerationLog', () => {
  it('records a reply Core accepted as completed, though Core stopped before the finish part', async () => {
    const parts = Stream.make(text(`[${speak('a')}]`), finish);
    assert.deepEqual(await record(parts), { ended: 'completed', error: undefined });
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
