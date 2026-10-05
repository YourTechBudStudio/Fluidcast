import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Layer, Redacted, Schema, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { Yaml } from 'effect/unstable/encoding';

import {
  checkTools,
  Example,
  outputJsonSchema,
} from '@yourtechbudstudio/fluidcast-core/generation';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { forwardTool } from '@yourtechbudstudio/fluidcast-tool-agent';
import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { RemindersSection } from './config.ts';
import {
  type ConversationConfig,
  referenceTools,
  referenceWorker,
  sessionLayer,
} from './session.ts';

/** A language model that fails if used. */
const unusedModel = LanguageModel.make({
  generateText: () => Effect.die('unused'),
  streamText: () => Effect.die('unused') as never,
});

describe('referenceTools', () => {
  it('registers Show, Ask and Forward, in that order, as a valid tool set', async () => {
    // Building the Forward tool spawns nothing: the worker connects on its first message.
    const tools = await Effect.runPromise(
      Effect.gen(function* () {
        const forward = yield* forwardTool({
          worker: referenceWorker({ cwd: process.cwd(), environment: {} }),
        });
        return referenceTools(forward.tool);
      }).pipe(Effect.provideServiceEffect(LanguageModel.LanguageModel, unusedModel), Effect.scoped),
    );
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [showToolName, askToolName, forwardToolName],
    );
    assert.doesNotThrow(() => checkTools(tools));
    // The structured-output schema of the same tools: each action by name, `forward` with no fields.
    const schema = outputJsonSchema({ speakers: [{ id: 'host' }], tools });
    const defs = schema['$defs'] as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(defs).sort(), ['Ask', 'Forward', 'Show']);
    assert.deepEqual(defs['Forward']?.['properties'], {
      type: { type: 'string', enum: [forwardToolName] },
    });
  });
});

describe('sessionLayer', () => {
  const config = (
    generationLog?: string,
    llm: ConversationConfig['llm'] = { type: 'chatgpt', model: 'm', credentialsPath: '/unused' },
  ): ConversationConfig => ({
    llm,
    instructions: '',
    examples: [],
    speakers: [{ id: 'host', name: 'Host', personality: 'warm', voice: { name: 'alloy' } }],
    worker: { cwd: process.cwd(), environment: {} },
    ...(generationLog === undefined ? {} : { generationLog }),
  });

  /** Builds the session over a provided model that counts its builds, and returns the count. */
  const builds = (conversation: ConversationConfig) => {
    let count = 0;
    const model = Layer.effect(
      LanguageModel.LanguageModel,
      Effect.andThen(
        Effect.sync(() => count++),
        unusedModel,
      ),
    );
    const speech = Layer.succeed(
      SpeechSynthesizer,
      SpeechSynthesizer.of({ synthesize: () => Stream.die('unused') }),
    );
    // Building the Forward tool spawns no worker: it connects on its first message.
    return Effect.runPromise(
      Layer.build(
        sessionLayer(conversation, 'opus').pipe(
          Layer.provide(Layer.mergeAll(model, speech, NodeServices.layer)),
        ),
      ).pipe(
        Effect.scoped,
        Effect.map(() => count),
      ),
    );
  };

  it('uses the one provided model for the Harness and the Forward tool', async () => {
    assert.equal(await builds(config()), 1);
  });

  it('passes the examples to the Harness, which refuses one that uses a tool it lacks', async () => {
    const example = (tool: string) => [
      { type: 'user_message' as const, text: 'Show me.' },
      {
        type: 'tool_call' as const,
        tool,
        handle: 'call_1',
        input: { format: 'markdown', content: '- One' },
      },
    ];
    assert.equal(await builds({ ...config(), examples: [example(showToolName)] }), 1);
    await assert.rejects(
      builds({ ...config(), examples: [example('draw')] }),
      /Example 1 uses the tool "draw", which is not configured/,
    );
  });

  it("accepts the example config's examples and reminders with the reference tools", async () => {
    const file = readFileSync(
      new URL('../../../../fluidcast.example.yaml', import.meta.url),
      'utf8',
    );
    const { examples, reminders } = Schema.decodeUnknownSync(
      Schema.Struct({ examples: Schema.Array(Example), reminders: RemindersSection }),
    )(Yaml.parse(file));
    assert.ok(examples.length > 0);
    assert.equal(await builds({ ...config(), examples, reminders }), 1);
  });

  it('uses the one provided model with structured output on', async () => {
    const llm = {
      type: 'openai-compatible',
      model: 'm',
      connection: { apiKey: Redacted.make('unused') },
      structuredOutput: true,
    } as const;
    assert.equal(await builds(config(undefined, llm)), 1);
  });

  it('uses the one provided model with the generation log on', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fluidcast-session-'));
    try {
      assert.equal(await builds(config(join(directory, 'generations.jsonl'))), 1);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
