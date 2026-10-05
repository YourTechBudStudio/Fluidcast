import { Context, Effect, type FileSystem, Layer } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { outputJsonSchema } from '@yourtechbudstudio/fluidcast-core/generation';
import type { AudioFormat, SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { layer as harnessLayer, type Session, type Tool } from '@yourtechbudstudio/fluidcast-harness';
import { guidedWalkthrough, type GuidedWalkthrough } from '@yourtechbudstudio/fluidcast-presets';
import { forwardAgentTool } from '@yourtechbudstudio/fluidcast-tool-agent';
import { claudeWorker } from '@yourtechbudstudio/fluidcast-tool-agent/claude';
import { askTool } from '@yourtechbudstudio/fluidcast-tool-ask';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';

import type { PresetSection } from './config.ts';
import { withGenerationLog } from './generation-log.ts';
import type { LlmConfig } from './language-model.ts';
import { withStructuredOutput } from './structured-output.ts';
import { ConversationWorker } from './worker.ts';

/** The conversation slice's resolved config. */
export interface ConversationConfig {
  readonly llm: LlmConfig;
  /** The `preset` section: the Guided Walkthrough's profile and the speaker's voice. */
  readonly preset: PresetSection;
  /**
   * Where the worker runs (the config file's directory) and its process environment: the real
   * environment minus the provider-key variables, never `.env` values.
   */
  readonly worker: {
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
  };
  /** An absolute path to append each generation to (`debug.generationLog`). Off when absent. */
  readonly generationLog?: string;
}

/** The reference session's worker: Claude Code in the config file's directory. */
export const referenceWorker = (worker: ConversationConfig['worker']) =>
  claudeWorker({ cwd: worker.cwd, permissionMode: 'auto', environment: worker.environment });

/** The tools the reference session registers, in prompt order: Show, Ask and Forward Agent. */
export const referenceTools = (forward: Tool): ReadonlyArray<Tool> => [
  showTool(),
  askTool(),
  forward,
];

/**
 * The voice's model: the session's built `model`, constrained to the output's JSON Schema when the
 * `openai-compatible` provider sets `structuredOutput`, and recording each generation when
 * `debug.generationLog` is set. The schema is built once, from the same speakers and tools as the
 * prompt.
 */
const interfaceModel = (
  config: ConversationConfig,
  preset: GuidedWalkthrough,
  model: Context.Context<LanguageModel.LanguageModel>,
  tools: ReadonlyArray<Tool>,
) => {
  const { speakers } = preset.session;
  const voice =
    config.llm.type === 'openai-compatible' && config.llm.structuredOutput
      ? Context.make(
          LanguageModel.LanguageModel,
          withStructuredOutput(
            Context.get(model, LanguageModel.LanguageModel),
            outputJsonSchema({ speakers, tools }),
          ),
        )
      : model;
  return config.generationLog === undefined
    ? Layer.succeedContext(voice)
    : withGenerationLog(
        config.generationLog,
        config.llm.model,
        new Set(speakers.map((speaker) => speaker.id)),
      ).pipe(Layer.provide(Layer.succeedContext(voice)));
};

/**
 * The single in-memory Harness session, with the Guided Walkthrough preset and the provided
 * language model, and its one worker behind the Forward Agent tool. The worker is acquired before the Harness is built, so the
 * Harness is torn down first.
 */
export const sessionLayer = (
  config: ConversationConfig,
  speechFormat: AudioFormat,
): Layer.Layer<
  Session | ConversationWorker,
  never,
  SpeechSynthesizer | LanguageModel.LanguageModel | FileSystem.FileSystem
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const preset = guidedWalkthrough(config.preset);
      // One model, shared: the Forward Agent tool's progress model uses it directly, without the
      // generation log, whose records assume action output, or structured output.
      const model = yield* Effect.context<LanguageModel.LanguageModel>();
      // The reference setup preloads no session, so setup cannot fail.
      const forward = yield* forwardAgentTool({
        worker: referenceWorker(config.worker),
        progress: { prompt: preset.progressPrompt },
      }).pipe(Effect.provideContext(model), Effect.orDie);
      const tools = referenceTools(forward.tool);
      return Layer.merge(
        harnessLayer({ ...preset.session, speechFormat, tools }).pipe(
          Layer.provide(interfaceModel(config, preset, model, tools)),
        ),
        Layer.succeed(ConversationWorker, forward.worker),
      );
    }),
  );
