import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Layer, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { HttpRouter } from 'effect/unstable/http';

import { routes } from '@fluidcast/app-contract';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { layer as harnessLayer } from '@yourtechbudstudio/fluidcast-harness';

import { conversationRoutes } from './routes.ts';
import { ConversationWorker } from './worker.ts';

/**
 * The command routes over a real speech-only session whose providers are never called, with an
 * idle fake worker.
 */
const app = conversationRoutes.pipe(
  Layer.provideMerge(
    harnessLayer({
      instructions: '',
      speakers: [{ id: 'host', name: 'Host', personality: 'Warm.', voice: { name: 'alloy' } }],
      speechFormat: 'opus',
      tools: [],
    }),
  ),
  Layer.provideMerge(
    Layer.succeed(
      ConversationWorker,
      ConversationWorker.of({ sessionId: 's', status: Stream.empty, transcript: Stream.empty }),
    ),
  ),
  Layer.provide(
    Layer.merge(
      Layer.effect(
        LanguageModel.LanguageModel,
        LanguageModel.make({
          generateText: () => Effect.die('unused'),
          streamText: () => Effect.die('unused') as never,
        }),
      ),
      Layer.succeed(
        SpeechSynthesizer,
        SpeechSynthesizer.of({ synthesize: () => Effect.die('unused') as never }),
      ),
    ),
  ),
);

describe('POST /api/commands', () => {
  it('answers a stale ToolCommand with 409 and a ToolCommandRejected body', async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(app, { disableLogger: true });
    try {
      const response = await handler(
        new Request(`http://localhost${routes.commands}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            _tag: 'ToolCommand',
            handle: 'call_1',
            executionId: 'gone',
            payload: { rendered: true },
          }),
        }),
      );
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        _tag: 'ToolCommandRejected',
        executionId: 'gone',
        reason: 'stale',
      });
    } finally {
      await dispose();
    }
  });
});
