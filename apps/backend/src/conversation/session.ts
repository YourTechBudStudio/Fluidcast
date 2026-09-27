import { type FileSystem, Layer } from 'effect';
import type { HttpClient } from 'effect/unstable/http';

import type { AudioFormat, SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import {
  layer as harnessLayer,
  type Session,
  type SessionSpeakers,
  type Tool,
} from '@yourtechbudstudio/fluidcast-harness';
import { askTool } from '@yourtechbudstudio/fluidcast-tool-ask';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';

import { withGenerationLog } from './generation-log.ts';
import { languageModelLayer, type LlmConfig } from './language-model.ts';

/** The conversation slice's resolved config. */
export interface ConversationConfig {
  readonly llm: LlmConfig;
  readonly instructions: string;
  readonly speakers: SessionSpeakers;
  /** An absolute path to append each generation to (`debug.generationLog`). Off when absent. */
  readonly generationLog?: string;
}

/**
 * The tools the reference session registers, in prompt order. Hard-coded for the reference setup
 * until modes (#5) choose them per session.
 */
export const referenceTools = (): ReadonlyArray<Tool> => [showTool(), askTool()];

/** The single in-memory Harness session, generating with the configured language model. */
export const sessionLayer = (
  config: ConversationConfig,
  speechFormat: AudioFormat,
): Layer.Layer<Session, never, SpeechSynthesizer | HttpClient.HttpClient | FileSystem.FileSystem> =>
  harnessLayer({
    instructions: config.instructions,
    speakers: config.speakers,
    speechFormat,
    tools: referenceTools(),
  }).pipe(
    Layer.provide(
      config.generationLog === undefined
        ? languageModelLayer(config.llm)
        : withGenerationLog(
            config.generationLog,
            config.llm.model,
            new Set(config.speakers.map((speaker) => speaker.id)),
          ).pipe(Layer.provide(languageModelLayer(config.llm))),
    ),
  );
