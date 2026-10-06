import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Context, Effect, Layer, Redacted, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { HttpClient, HttpClientResponse } from 'effect/unstable/http';

import { languageModelLayer } from './language-model.ts';
import { withStructuredOutput } from './structured-output.ts';

const schema = { type: 'array', items: { type: 'object' } };

const chunk = {
  id: 'c',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'm',
  choices: [{ index: 0, delta: { content: '[]' }, finish_reason: 'stop' }],
};

/**
 * Streams one generation through the backend's `openai-compatible` model, wrapped by `wrap`, and
 * returns the request body that reached the network.
 */
const requestBody = async (
  wrap: (model: LanguageModel.LanguageModel) => LanguageModel.LanguageModel,
): Promise<Record<string, unknown>> => {
  const bodies: Array<Record<string, unknown>> = [];
  const http = HttpClient.make((request) => {
    if (request.body._tag === 'Uint8Array') {
      bodies.push(JSON.parse(new TextDecoder().decode(request.body.body)));
    }
    const sse = `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(sse, { headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
  });
  const layer = languageModelLayer({
    type: 'openai-compatible',
    model: 'm',
    temperature: 0.3,
    reasoningEffort: 'medium',
    connection: { apiKey: Redacted.make('k'), baseUrl: 'http://127.0.0.1:9/v1' },
    structuredOutput: true,
  }).pipe(
    Layer.provide(Layer.merge(Layer.succeed(HttpClient.HttpClient, http), NodeServices.layer)),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(layer);
      const model = wrap(Context.get(context, LanguageModel.LanguageModel));
      yield* model.streamText({ prompt: 'Hi' }).pipe(Stream.runDrain, Effect.ignore);
    }).pipe(Effect.scoped),
  );
  assert.equal(bodies.length, 1);
  return bodies[0]!;
};

describe('withStructuredOutput', () => {
  it("sends the schema as a strict json_schema response_format, keeping the layer's settings", async () => {
    const body = await requestBody((model) => withStructuredOutput(model, schema));
    assert.deepEqual(body['response_format'], {
      type: 'json_schema',
      json_schema: { name: 'actions', schema, strict: true },
    });
    assert.equal(body['temperature'], 0.3);
    assert.equal(body['reasoning_effort'], 'medium');
  });

  it('leaves the unwrapped model, which other users share, without a response_format', async () => {
    const body = await requestBody((model) => model);
    assert.equal(body['response_format'], undefined);
    assert.equal(body['temperature'], 0.3);
  });
});
