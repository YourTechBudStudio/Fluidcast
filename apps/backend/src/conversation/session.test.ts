import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Layer, Redacted, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { checkTools, outputJsonSchema } from '@yourtechbudstudio/fluidcast-core/generation';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { guidedWalkthrough } from '@yourtechbudstudio/fluidcast-presets';
import { forwardAgentTool } from '@yourtechbudstudio/fluidcast-tool-agent';
import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import {
  type ConversationConfig,
  referenceSessionConfig,
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
  it('registers Show, Ask and Forward Agent, in that order, as a valid tool set', async () => {
    // Building the Forward Agent tool spawns nothing: the worker connects on its first message.
    const tools = await Effect.runPromise(
      Effect.gen(function* () {
        const forward = yield* forwardAgentTool({
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
    // The structured-output schema of the same tools: each action by name, `forward_agent` with no fields.
    const schema = outputJsonSchema({ speakers: [{ id: 'host' }], tools });
    const defs = schema['$defs'] as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(defs).sort(), ['Ask', 'ForwardAgent', 'Show']);
    assert.deepEqual(defs['ForwardAgent']?.['properties'], {
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
    preset: { voice: { name: 'alloy' } },
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
    // Building the Forward Agent tool spawns no worker: it connects on its first message.
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

  it('uses the one provided model for the Harness and the Forward Agent tool', async () => {
    assert.equal(await builds(config()), 1);
  });

  it("builds with each profile: the preset's examples fit the reference tools", async () => {
    for (const profile of ['compact', 'detailed'] as const) {
      assert.equal(await builds({ ...config(), preset: { profile, voice: { name: 'alloy' } } }), 1);
    }
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

describe('referenceSessionConfig', () => {
  // Passed through untouched, so any tools will do.
  const tools = [showTool()];
  const voice = { name: 'alloy', instructions: 'calm' };

  it('takes the instructions, examples, speakers and reminders from the configured profile', () => {
    for (const profile of ['compact', 'detailed'] as const) {
      const session = referenceSessionConfig({ profile, voice }, 'opus', tools);
      const preset = guidedWalkthrough({ profile, voice });
      assert.deepEqual(session, { ...preset, speechFormat: 'opus', tools });
    }
  });

  it('carries worked examples with the detailed profile (the default) and none with compact', () => {
    assert.ok((referenceSessionConfig({ voice }, 'opus', tools).examples ?? []).length > 0);
    assert.deepEqual(
      referenceSessionConfig({ profile: 'compact', voice }, 'opus', tools).examples,
      [],
    );
  });

  it("gives the preset's speaker the configured voice", () => {
    const { speakers } = referenceSessionConfig({ voice }, 'opus', tools);
    assert.deepEqual(
      speakers.map((speaker) => speaker.voice),
      [voice],
    );
  });
});
