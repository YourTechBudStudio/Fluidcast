import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Layer, Redacted, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import type { StartRequest } from '@fluidcast/app-contract';
import { checkTools, outputJsonSchema } from '@yourtechbudstudio/fluidcast-core/generation';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { derivePhase } from '@yourtechbudstudio/fluidcast-harness/protocol';
import { guidedWalkthrough } from '@yourtechbudstudio/fluidcast-presets';
import { forwardAgentTool } from '@yourtechbudstudio/fluidcast-tool-agent';
import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { conversationConfig, fakeSources, storedMessage, unusedModel } from './fixtures.test.ts';
import { continueContextLabel, continueMessage, continueReminders } from './modes.ts';
import {
  buildSession,
  claudeSources,
  type ConversationConfig,
  type SessionSources,
  referenceSessionConfig,
  referenceTools,
  workerOptions,
} from './session.ts';

const worker = conversationConfig().worker;

describe('referenceTools', () => {
  it('registers Show, Ask and Forward Agent, in that order, as a valid tool set', async () => {
    // Building the Forward Agent tool spawns nothing: the worker connects on its first message.
    const tools = await Effect.runPromise(
      Effect.gen(function* () {
        const forward = yield* forwardAgentTool({
          worker: claudeSources.claudeWorker(workerOptions(worker)),
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

describe('buildSession', () => {
  const config = (
    generationLog?: string,
    llm: ConversationConfig['llm'] = { type: 'chatgpt', model: 'm', credentialsPath: '/unused' },
  ): ConversationConfig =>
    conversationConfig({ llm, ...(generationLog === undefined ? {} : { generationLog }) });

  const speech = Layer.succeed(
    SpeechSynthesizer,
    SpeechSynthesizer.of({ synthesize: () => Stream.die('unused') }),
  );

  /**
   * Builds `starts` sessions in one scope over a provided model that counts its builds, and returns
   * the count and the sessions. The fake worker type spawns nothing.
   */
  const builds = (
    conversation: ConversationConfig,
    starts = 1,
    request: StartRequest = { mode: 'new' },
    sources: SessionSources = fakeSources({}).sources,
  ) => {
    let count = 0;
    const model = Layer.effect(
      LanguageModel.LanguageModel,
      Effect.andThen(
        Effect.sync(() => count++),
        unusedModel,
      ),
    );
    return Effect.runPromise(
      Effect.gen(function* () {
        const sessions = [];
        for (let index = 0; index < starts; index++) {
          sessions.push(yield* buildSession(conversation, 'opus', request, sources));
        }
        return { count, sessions };
      }).pipe(Effect.provide(Layer.mergeAll(model, speech, NodeServices.layer)), Effect.scoped),
    );
  };

  /** The first snapshot's state of a built session. */
  const snapshot = (request: StartRequest, sources: SessionSources) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const built = yield* buildSession(conversationConfig(), 'opus', request, sources);
        const first = yield* Stream.runHead(built.session.subscribe());
        if (first._tag === 'None' || first.value._tag !== 'Snapshot') {
          return assert.fail('expected a snapshot');
        }
        return first.value.state;
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.effect(LanguageModel.LanguageModel, unusedModel),
            speech,
            NodeServices.layer,
          ),
        ),
        Effect.scoped,
      ),
    );

  /** The failure of a build, or `undefined` when it succeeds. */
  const failureOf = (request: StartRequest, sources: SessionSources) =>
    Effect.runPromise(
      buildSession(conversationConfig(), 'opus', request, sources).pipe(
        Effect.flip,
        Effect.map((error) => error.reason),
        Effect.provide(
          Layer.mergeAll(
            Layer.effect(LanguageModel.LanguageModel, unusedModel),
            speech,
            NodeServices.layer,
          ),
        ),
        Effect.scoped,
      ),
    );

  const storedId = '0198f1a2-3b4c-7d5e-8f60-123456789abc';
  const continueRequest = { mode: 'continue', sessionId: ` ${storedId} ` } as const;
  const stored = [
    storedMessage('user', 'Question'),
    storedMessage('assistant', [{ type: 'text', text: 'The answer.' }]),
  ];

  it('uses the one provided model for the Harness and the Forward Agent tool', async () => {
    assert.equal((await builds(config())).count, 1);
  });

  it("builds with each profile: the preset's examples fit the reference tools", async () => {
    for (const profile of ['compact', 'detailed'] as const) {
      const conversation = { ...config(), preset: { profile, voice: { name: 'alloy' } } };
      assert.equal((await builds(conversation)).count, 1);
    }
  });

  it('uses the one provided model with structured output on', async () => {
    const llm = {
      type: 'openai-compatible',
      model: 'm',
      connection: { apiKey: Redacted.make('unused') },
      structuredOutput: true,
    } as const;
    assert.equal((await builds(config(undefined, llm))).count, 1);
  });

  it('uses the one provided model with the generation log on', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fluidcast-session-'));
    try {
      assert.equal((await builds(config(join(directory, 'generations.jsonl')))).count, 1);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it('builds a separate Harness session for each start, over the one provided model', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fluidcast-session-'));
    try {
      const { count, sessions } = await builds(config(join(directory, 'generations.jsonl')), 2);
      assert.equal(count, 1);
      assert.notEqual(sessions[0]?.session, sessions[1]?.session);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it('gives a new brainstorm a fresh worker with the workers model and effort', async () => {
    const { sources, workers } = fakeSources({});
    const conversation = conversationConfig({
      worker: { ...worker, claude: { model: 'opus', effort: 'high' } },
    });
    await builds(conversation, 1, { mode: 'new' }, sources);
    assert.deepEqual(workers, [workerOptions(conversation.worker)]);
    assert.equal(workers[0]?.model, 'opus');
  });

  it('snapshots a continued session ready, with the last answer as the preloaded context', async () => {
    const { sources, workers } = fakeSources({ messages: stored });
    const state = await snapshot(continueRequest, sources);
    assert.equal(derivePhase(state), 'ready');
    assert.deepEqual(state.actions, []);
    assert.equal(state.start?.message.text, continueMessage);
    assert.deepEqual(
      state.start?.context && { label: state.start.context.label, text: state.start.context.text },
      { label: continueContextLabel, text: 'The answer.' },
    );
    // No effort is recorded under the fake config directory, and none is configured.
    assert.deepEqual(workers, [workerOptions(worker, { effort: undefined })]);
    assert.equal('model' in workers[0]!, false);
  });

  it("resumes with the session's recorded effort", async () => {
    const claudeConfigDir = mkdtempSync(join(tmpdir(), 'fluidcast-claude-'));
    try {
      mkdirSync(join(claudeConfigDir, 'projects', 'p'), { recursive: true });
      writeFileSync(
        join(claudeConfigDir, 'projects', 'p', `${storedId}.jsonl`),
        JSON.stringify({ type: 'assistant', effort: 'max' }),
      );
      const { sources, workers } = fakeSources({ messages: stored });
      const conversation = conversationConfig({
        worker: { ...worker, claude: { model: 'opus', effort: 'low' }, claudeConfigDir },
      });
      await builds(conversation, 1, continueRequest, sources);
      assert.equal(workers[0]?.effort, 'max');
      assert.equal('model' in workers[0]!, false);
    } finally {
      rmSync(claudeConfigDir, { recursive: true });
    }
  });

  it('maps each Continue failure to its reason', async () => {
    const cases = [
      [
        { mode: 'continue', sessionId: 'nope' },
        fakeSources({ messages: stored }),
        'InvalidSessionId',
      ],
      [continueRequest, fakeSources({ messages: [] }), 'SessionNotFound'],
      [continueRequest, fakeSources({ messages: 'throw' }), 'SessionUnreadable'],
      [continueRequest, fakeSources({ messages: [storedMessage('user', 'Question')] }), 'NoAnswer'],
      [
        continueRequest,
        fakeSources({ messages: stored, attachFailure: 'SessionNotFound' }),
        'SessionNotFound',
      ],
      [
        continueRequest,
        fakeSources({ messages: stored, attachFailure: 'SessionUnreadable' }),
        'SessionUnreadable',
      ],
    ] as const;
    for (const [request, { sources }, reason] of cases) {
      assert.equal(await failureOf(request, sources), reason);
    }
  });
});

describe('workerOptions', () => {
  const configured = { ...worker, claude: { model: 'opus', effort: 'high' as const } };

  it('gives a new session the installed claude and the workers model and effort, in auto permission mode', () => {
    assert.deepEqual(workerOptions(configured), {
      cwd: worker.cwd,
      executable: worker.claudeExecutable,
      permissionMode: 'auto',
      environment: worker.environment,
      model: 'opus',
      effort: 'high',
    });
    assert.deepEqual(workerOptions(worker), {
      cwd: worker.cwd,
      executable: worker.claudeExecutable,
      permissionMode: 'auto',
      environment: worker.environment,
    });
  });

  it('gives a continued session no model, and its recorded effort, else the configured one', () => {
    const base = {
      cwd: worker.cwd,
      executable: worker.claudeExecutable,
      permissionMode: 'auto',
      environment: worker.environment,
    };
    assert.deepEqual(workerOptions(configured, { effort: 'max' }), { ...base, effort: 'max' });
    assert.deepEqual(workerOptions(configured, { effort: undefined }), { ...base, effort: 'high' });
    assert.deepEqual(workerOptions(worker, { effort: undefined }), base);
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
      assert.equal(session.reminders, preset.reminders);
      assert.equal(session.start, undefined);
    }
  });

  it("adds Continue's reminders and the preloaded start for a continued session", () => {
    const session = referenceSessionConfig({ voice }, 'opus', tools, { answer: 'The answer.' });
    const preset = guidedWalkthrough({ voice });
    assert.deepEqual(session.start, {
      message: continueMessage,
      context: { label: continueContextLabel, text: 'The answer.' },
    });
    assert.notEqual(session.reminders, preset.reminders);
    const withContext = {
      _tag: 'UserMessage',
      text: continueMessage,
      interrupted: false,
      context: [continueContextLabel],
    } as const;
    assert.equal(
      session.reminders?.(withContext),
      continueReminders(preset.reminders)(withContext),
    );
    // Everything else is the preset's.
    assert.deepEqual(
      { ...session, reminders: preset.reminders, start: undefined },
      { ...preset, speechFormat: 'opus', tools, start: undefined },
    );
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
