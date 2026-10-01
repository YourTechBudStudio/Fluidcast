import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Layer, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { checkTools } from '@yourtechbudstudio/fluidcast-core/generation';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { agentTool } from '@yourtechbudstudio/fluidcast-tool-agent';
import { agentToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import {
  type ConversationConfig,
  referenceTools,
  referenceWorkerTypes,
  sessionLayer,
} from './session.ts';

/** A language model that fails if used. */
const unusedModel = LanguageModel.make({
  generateText: () => Effect.die('unused'),
  streamText: () => Effect.die('unused') as never,
});

describe('referenceTools', () => {
  it('registers Show, Ask and Agent, in that order, as a valid tool set', async () => {
    // Building the pool spawns nothing: workers connect on their first message.
    const tools = await Effect.runPromise(
      Effect.gen(function* () {
        const agents = yield* agentTool({
          types: referenceWorkerTypes({ cwd: process.cwd(), environment: {} }),
        });
        return referenceTools(agents.tool);
      }).pipe(Effect.provideServiceEffect(LanguageModel.LanguageModel, unusedModel), Effect.scoped),
    );
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [showToolName, askToolName, agentToolName],
    );
    assert.doesNotThrow(() => checkTools(tools));
  });
});

describe('sessionLayer', () => {
  const config = (generationLog?: string): ConversationConfig => ({
    llm: { type: 'chatgpt', model: 'm', credentialsPath: '/unused' },
    instructions: '',
    speakers: [{ id: 'host', name: 'Host', personality: 'warm', voice: { name: 'alloy' } }],
    workers: { cwd: process.cwd(), environment: {} },
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
    // Building the Agent tool's pool spawns no worker: workers connect on their first message.
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

  it('uses the one provided model for the Harness and the Agent tool', async () => {
    assert.equal(await builds(config()), 1);
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
