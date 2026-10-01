import { type Context, Effect, type FileSystem, Layer } from 'effect';
import type { LanguageModel } from 'effect/unstable/ai';
import type { HttpClient } from 'effect/unstable/http';

import type { AudioFormat, SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import {
  layer as harnessLayer,
  type Session,
  type SessionSpeakers,
  type Tool,
} from '@yourtechbudstudio/fluidcast-harness';
import { agentTool } from '@yourtechbudstudio/fluidcast-tool-agent';
import { claudeWorker } from '@yourtechbudstudio/fluidcast-tool-agent/claude';
import { askTool } from '@yourtechbudstudio/fluidcast-tool-ask';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';

import { withGenerationLog } from './generation-log.ts';
import { languageModelLayer, type LlmConfig } from './language-model.ts';
import { AgentWorkers } from './workers.ts';

/** The conversation slice's resolved config. */
export interface ConversationConfig {
  readonly llm: LlmConfig;
  readonly instructions: string;
  readonly speakers: SessionSpeakers;
  /**
   * Where workers run (the config file's directory) and their process environment: the real
   * environment minus the provider-key variables, never `.env` values.
   */
  readonly workers: {
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
  };
  /** An absolute path to append each generation to (`debug.generationLog`). Off when absent. */
  readonly generationLog?: string;
}

/** Reference configuration until modes (#5) choose worker types per session. */
export const referenceWorkerTypes = (workers: ConversationConfig['workers']) => ({
  claude: claudeWorker({
    description:
      'Claude Code, a capable coding agent working in this repository: it reads and changes code, runs commands, and thinks designs through.',
    cwd: workers.cwd,
    permissionMode: 'auto',
    environment: workers.environment,
  }),
});

/**
 * The tools the reference session registers, in prompt order. Hard-coded for the reference setup
 * until modes (#5) choose them per session.
 */
export const referenceTools = (agents: Tool): ReadonlyArray<Tool> => [
  showTool(),
  askTool(),
  agents,
];

/**
 * The interface agent's model: the session's built `model`, recording each generation when
 * `debug.generationLog` is set.
 */
const interfaceModel = (
  config: ConversationConfig,
  model: Context.Context<LanguageModel.LanguageModel>,
) =>
  config.generationLog === undefined
    ? Layer.succeedContext(model)
    : withGenerationLog(
        config.generationLog,
        config.llm.model,
        new Set(config.speakers.map((speaker) => speaker.id)),
      ).pipe(Layer.provide(Layer.succeedContext(model)));

/**
 * The single in-memory Harness session, generating with the configured language model, and its
 * Agent tool pool. The pool is acquired before the Harness is built, so the Harness is torn down
 * first.
 */
export const sessionLayer = (
  config: ConversationConfig,
  speechFormat: AudioFormat,
): Layer.Layer<
  Session | AgentWorkers,
  never,
  SpeechSynthesizer | HttpClient.HttpClient | FileSystem.FileSystem
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      // Built once and shared: the Agent tool's progress model uses it directly, without the
      // generation log, whose records assume action output.
      const model = yield* Layer.build(languageModelLayer(config.llm));
      // The reference setup preloads nothing, so setup cannot fail.
      const agents = yield* agentTool({ types: referenceWorkerTypes(config.workers) }).pipe(
        Effect.provideContext(model),
        Effect.orDie,
      );
      return Layer.merge(
        harnessLayer({
          instructions: config.instructions,
          speakers: config.speakers,
          speechFormat,
          tools: referenceTools(agents.tool),
        }).pipe(Layer.provide(interfaceModel(config, model))),
        Layer.succeed(AgentWorkers, agents.workers),
      );
    }),
  );
