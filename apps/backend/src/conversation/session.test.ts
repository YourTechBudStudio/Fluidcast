import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Layer, Redacted, Stream } from 'effect';
import { LanguageModel } from 'effect/ai';

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
  claudeWorkerOptions,
  codexWorkerOptions,
  type ConversationConfig,
  parseSessionId,
  referenceSessionConfig,
  referenceSources,
  referenceTools,
  type SessionSources,
} from './session.ts';

const worker = conversationConfig().worker;

describe('referenceTools', () => {
  it('registers Show, Ask and Forward Agent, in that order, as a valid tool set', async () => {
    // Building the Forward Agent tool spawns nothing: the worker connects on its first message.
    const tools = await Effect.runPromise(
      Effect.gen(function* () {
        const forward = yield* forwardAgentTool({
          worker: referenceSources.claudeWorker(claudeWorkerOptions(worker)),
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
    request: StartRequest = { mode: 'new', agent: 'claude' },
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
  const snapshot = (
    request: StartRequest,
    sources: SessionSources,
    conversation: ConversationConfig = conversationConfig(),
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const built = yield* buildSession(conversation, 'opus', request, sources);
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
  const continueRequest = {
    mode: 'continue',
    agent: 'claude',
    sessionId: ` ${storedId} `,
  } as const;
  const codexContinue = { ...continueRequest, agent: 'codex' } as const;
  const thread = { model: 'gpt-x', effort: undefined, lastAnswer: 'The Codex answer.' };
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
    await builds(conversation, 1, { mode: 'new', agent: 'claude' }, sources);
    assert.deepEqual(workers, [claudeWorkerOptions(conversation.worker)]);
    assert.equal(workers[0]?.model, 'opus');
  });

  it('gives a new Codex brainstorm a fresh Codex worker with its workers model and effort', async () => {
    const { sources, workers, codexWorkers, threadReads } = fakeSources({});
    const conversation = conversationConfig({
      worker: { ...worker, codex: { model: 'gpt-x', effort: 'ultra' } },
    });
    await builds(conversation, 1, { mode: 'new', agent: 'codex' }, sources);
    assert.deepEqual(workers, []);
    assert.deepEqual(threadReads, []);
    assert.deepEqual(codexWorkers, [
      { cwd: worker.cwd, environment: worker.environment, model: 'gpt-x', effort: 'ultra' },
    ]);
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
    assert.deepEqual(workers, [claudeWorkerOptions(worker, { effort: undefined })]);
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

  it('continues a Codex thread: its last answer preloaded, read with the worker environment', async () => {
    const { sources, workers, codexWorkers, threadReads } = fakeSources({ thread });
    const conversation = conversationConfig({
      worker: { ...worker, environment: { PATH: '/bin' } },
    });
    const state = await snapshot(codexContinue, sources, conversation);
    assert.equal(derivePhase(state), 'ready');
    assert.equal(state.start?.context?.text, 'The Codex answer.');
    assert.deepEqual(threadReads, [{ threadId: storedId, environment: { PATH: '/bin' } }]);
    assert.deepEqual(workers, []);
    // No model, even though the thread reports one: the resumed thread keeps its own.
    assert.deepEqual(codexWorkers, [{ cwd: worker.cwd, environment: { PATH: '/bin' } }]);
  });

  it('resumes a Codex thread with its recorded effort, else the configured one', async () => {
    const conversation = conversationConfig({
      worker: { ...worker, codex: { model: 'gpt-y', effort: 'low' } },
    });
    const recorded = fakeSources({ thread: { ...thread, effort: 'xhigh' } });
    await builds(conversation, 1, codexContinue, recorded.sources);
    assert.deepEqual(
      recorded.codexWorkers.map((options) => [options.model, options.effort]),
      [[undefined, 'xhigh']],
    );
    const fallback = fakeSources({ thread });
    await builds(conversation, 1, codexContinue, fallback.sources);
    assert.deepEqual(
      fallback.codexWorkers.map((options) => [options.model, options.effort]),
      [[undefined, 'low']],
    );
  });

  it('maps each Codex Continue failure to its reason', async () => {
    const cases = [
      [{ ...codexContinue, sessionId: 'nope' }, fakeSources({ thread }), 'InvalidSessionId'],
      [codexContinue, fakeSources({ thread: 'fail' }), 'SessionUnreadable'],
      [codexContinue, fakeSources({ thread: { ...thread, lastAnswer: undefined } }), 'NoAnswer'],
      [
        codexContinue,
        fakeSources({ thread, attachFailure: 'SessionUnreadable' }),
        'SessionUnreadable',
      ],
    ] as const;
    for (const [request, { sources, threadReads }, reason] of cases) {
      assert.equal(await failureOf(request, sources), reason);
      // An invalid ID never reaches the reader.
      if (reason === 'InvalidSessionId') assert.deepEqual(threadReads, []);
    }
  });

  it('maps each Continue failure to its reason', async () => {
    const cases = [
      [
        { mode: 'continue', agent: 'claude', sessionId: 'nope' },
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

describe('parseSessionId', () => {
  const id = '0198f1a2-3b4c-7d5e-8f60-123456789abc';

  it('trims a UUID', () => {
    assert.equal(parseSessionId(`  ${id}\n`), id);
  });

  it('rejects anything else', () => {
    for (const text of ['', 'nope', `${id}x`, '../../etc/passwd', `${id} ${id}`]) {
      assert.equal(parseSessionId(text), undefined);
    }
  });
});

describe('claudeWorkerOptions', () => {
  const configured = { ...worker, claude: { model: 'opus', effort: 'high' as const } };
  const base = {
    cwd: worker.cwd,
    executable: worker.claudeExecutable,
    permissionMode: 'auto',
    environment: worker.environment,
  };

  it('gives a new session the installed claude and the workers model and effort, in auto permission mode', () => {
    assert.deepEqual(claudeWorkerOptions(configured), { ...base, model: 'opus', effort: 'high' });
    assert.deepEqual(claudeWorkerOptions(worker), base);
  });

  it('gives a continued session no model, and its recorded effort, else the configured one', () => {
    assert.deepEqual(claudeWorkerOptions(configured, { effort: 'max' }), {
      ...base,
      effort: 'max',
    });
    assert.deepEqual(claudeWorkerOptions(configured, { effort: undefined }), {
      ...base,
      effort: 'high',
    });
    assert.deepEqual(claudeWorkerOptions(worker, { effort: undefined }), base);
  });
});

describe('codexWorkerOptions', () => {
  const configured = { ...worker, codex: { model: 'gpt-x', effort: 'ultra' } };
  const base = { cwd: worker.cwd, environment: worker.environment };

  it('gives a new session the workers model and effort, which is any string', () => {
    assert.deepEqual(codexWorkerOptions(configured), { ...base, model: 'gpt-x', effort: 'ultra' });
    assert.deepEqual(codexWorkerOptions(worker), base);
  });

  it('gives a continued session no model, and its recorded effort, else the configured one', () => {
    assert.deepEqual(codexWorkerOptions(configured, { effort: 'minimal' }), {
      ...base,
      effort: 'minimal',
    });
    assert.deepEqual(codexWorkerOptions(configured, { effort: undefined }), {
      ...base,
      effort: 'ultra',
    });
    assert.deepEqual(codexWorkerOptions(worker, { effort: undefined }), base);
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
