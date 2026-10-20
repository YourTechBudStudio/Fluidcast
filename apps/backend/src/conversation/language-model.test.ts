import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Layer, Redacted, Stream } from 'effect';
import { LanguageModel } from 'effect/ai';
import { HttpClient, HttpClientResponse } from 'effect/http';

import { makeActionId, type Action } from '@yourtechbudstudio/fluidcast-core/actions';
import { generate } from '@yourtechbudstudio/fluidcast-core/generation';

import { type LlmConfig, languageModelLayer } from './language-model.ts';

type AnthropicConfig = Extract<LlmConfig, { readonly type: 'anthropic' }>;

/** A minimal Messages API stream whose reply is an empty action array. */
const events = [
  {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 1,
        cache_creation: null,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 4000,
        service_tier: 'standard',
      },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '[]' } },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: {
      input_tokens: null,
      output_tokens: 2,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  },
  { type: 'message_stop' },
];
const sse = events
  .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('');

interface Sent {
  readonly body: Record<string, unknown>;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Runs `use` over the backend's `anthropic` model, built from `overrides` over a fake HTTP client
 * that answers with `sse`, and returns the one request that reached the network.
 */
const sent = async (
  overrides: Partial<AnthropicConfig>,
  use: Stream.Stream<unknown, unknown, LanguageModel.LanguageModel> = LanguageModel.streamText({
    prompt: 'Hi',
  }),
): Promise<Sent> => {
  const requests: Array<Sent> = [];
  const http = HttpClient.make((request) => {
    if (request.body._tag === 'Uint8Array') {
      requests.push({
        body: JSON.parse(new TextDecoder().decode(request.body.body)),
        headers: request.headers,
      });
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(sse, { headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
  });
  const layer = languageModelLayer({
    type: 'anthropic',
    model: 'claude-sonnet-5-5',
    connection: { apiKey: Redacted.make('k') },
    ...overrides,
  }).pipe(
    Layer.provide(Layer.merge(Layer.succeed(HttpClient.HttpClient, http), NodeServices.layer)),
  );
  await Effect.runPromise(use.pipe(Stream.runDrain, Effect.provide(layer)));
  assert.equal(requests.length, 1);
  return requests[0]!;
};

describe('languageModelLayer anthropic', () => {
  it('sends the model and leaves max_tokens to the library default when not configured', async () => {
    const { body, headers } = await sent({});
    assert.equal(body['model'], 'claude-sonnet-5-5');
    assert.equal(body['stream'], true);
    // The library's default for model IDs it does not recognize.
    assert.equal(body['max_tokens'], 128000);
    assert.equal(body['output_config'], undefined);
    assert.equal(body['speed'], undefined);
    assert.equal(headers['anthropic-beta'], undefined);
  });

  it('sends max_tokens when configured', async () => {
    const { body } = await sent({ maxOutputTokens: 8192 });
    assert.equal(body['max_tokens'], 8192);
  });

  it("sends every effort level as output_config.effort, including the ones the library's type lacks", async () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const { body } = await sent({ reasoningEffort: effort });
      assert.deepEqual(body['output_config'], { effort });
    }
  });

  it('sends speed and the fast-mode beta only in fast mode', async () => {
    const fast = await sent({ speed: 'fast' });
    assert.equal(fast.body['speed'], 'fast');
    assert.equal(fast.headers['anthropic-beta'], 'fast-mode-2026-02-01');

    const standard = await sent({ speed: 'standard' });
    assert.equal(standard.body['speed'], 'standard');
    assert.equal(standard.headers['anthropic-beta'], undefined);
  });

  it('sends no thinking or sampling settings', async () => {
    const { body } = await sent({
      reasoningEffort: 'low',
      speed: 'fast',
      maxOutputTokens: 1000,
    });
    for (const key of ['thinking', 'temperature', 'top_p', 'top_k']) {
      assert.equal(body[key], undefined, key);
    }
  });

  it("reports message_start's cache reads and writes in the finish usage, as the generation log reads them", async () => {
    let usage: unknown;
    await sent(
      {},
      LanguageModel.streamText({ prompt: 'Hi' }).pipe(
        Stream.tap((part) =>
          Effect.sync(() => {
            if (part.type === 'finish') usage = part.usage.inputTokens;
          }),
        ),
      ),
    );
    assert.deepEqual(usage, { uncached: 10, total: 4030, cacheRead: 4000, cacheWrite: 20 });
  });

  it("carries Core's cache breakpoints to the system block and the target user message only", async () => {
    const id = makeActionId;
    const history: ReadonlyArray<Action> = [
      { type: 'user_message', id: id(), text: 'Hi' },
      { type: 'speak', id: id(), speaker: 'host', text: 'Hello.' },
      { type: 'user_message', id: id(), text: 'Tell me more' },
    ];
    const { body } = await sent(
      {},
      generate({
        instructions: 'Be brief.',
        speakers: [{ id: 'host', name: 'Host', personality: 'Warm.' }],
        history,
        tools: [],
        reminders: () => 'Answer briefly.',
      }),
    );
    const ephemeral = { type: 'ephemeral' };
    const system = body['system'] as ReadonlyArray<Record<string, unknown>>;
    assert.deepEqual(
      system.map((block) => block['cache_control']),
      [ephemeral],
    );
    const messages = body['messages'] as ReadonlyArray<{
      readonly role: string;
      readonly content: ReadonlyArray<Record<string, unknown>>;
    }>;
    assert.deepEqual(
      messages.map((message) => message.role),
      ['user', 'assistant', 'user'],
    );
    const marks = messages.map((message) =>
      message.content.map((block) => block['cache_control'] ?? null),
    );
    assert.deepEqual(
      marks.map((blocks) => blocks.at(-1)),
      [ephemeral, null, null],
    );
    assert.deepEqual(
      marks.flat().filter((mark) => mark !== null),
      [ephemeral],
      'no other block is marked',
    );
  });
});
