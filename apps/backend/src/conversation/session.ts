import { getSessionMessages, type SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { Context, Effect, type FileSystem, Layer, type Path, type Scope } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { StartFailed, type StartRequest } from '@fluidcast/app-contract';
import { outputJsonSchema } from '@yourtechbudstudio/fluidcast-core/generation';
import type { AudioFormat, SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import {
  layer as harnessLayer,
  Session,
  type SessionConfig,
  type Tool,
} from '@yourtechbudstudio/fluidcast-harness';
import {
  guidedWalkthrough,
  guidedWalkthroughProgressPrompt,
} from '@yourtechbudstudio/fluidcast-presets';
import {
  forwardAgentTool,
  type WorkerHandle,
  type WorkerType,
} from '@yourtechbudstudio/fluidcast-tool-agent';
import {
  claudeWorker,
  type ClaudeWorkerOptions,
} from '@yourtechbudstudio/fluidcast-tool-agent/claude';
import { askTool } from '@yourtechbudstudio/fluidcast-tool-ask';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';

import { lastAnswer, parseSessionId, recordedEffort } from './claude-session.ts';
import type { ClaudeEffort, PresetSection } from './config.ts';
import { withGenerationLog } from './generation-log.ts';
import type { LlmConfig } from './language-model.ts';
import {
  brainstormHook,
  continueContextLabel,
  continueMessage,
  continueReminders,
} from './modes.ts';
import { withStructuredOutput } from './structured-output.ts';

/** The conversation slice's resolved config. */
export interface ConversationConfig {
  readonly llm: LlmConfig;
  /** The `preset` section: the Guided Walkthrough's profile and the speaker's voice. */
  readonly preset: PresetSection;
  /** The worker behind the Forward Agent tool, from the `workers` section. */
  readonly worker: {
    /** Where a new worker runs: `workers.cwd`, resolved, else the config file's directory. */
    readonly cwd: string;
    /** The worker process environment: the real one minus the provider-key variables, never `.env` values. */
    readonly environment: Readonly<Record<string, string | undefined>>;
    /** `workers.claude`: for new sessions; `effort` is also a continued session's fallback. */
    readonly claude: { readonly model?: string; readonly effort?: ClaudeEffort };
    /** Where Claude Code keeps sessions: `CLAUDE_CONFIG_DIR`, else `<home>/.claude`. */
    readonly claudeConfigDir: string;
    /** The installed `claude`, found on the real environment's `PATH`, else the bare name. */
    readonly claudeExecutable: string;
  };
  /** An absolute path to append each generation to (`debug.generationLog`). Off when absent. */
  readonly generationLog?: string;
}

/** Where `buildSession` gets the worker and stored sessions; tests pass fakes. */
export interface SessionSources {
  readonly claudeWorker: (options: ClaudeWorkerOptions) => WorkerType;
  readonly sessionMessages: (sessionId: string) => Promise<ReadonlyArray<SessionMessage>>;
}

/** The real sources: Claude Code, and its stored sessions. */
export const claudeSources: SessionSources = {
  claudeWorker,
  sessionMessages: (sessionId) => getSessionMessages(sessionId),
};

/**
 * The worker's options. A new session gets the `workers` model and effort. A continued session
 * passes no model (the SDK restores the session's own) and its recorded effort, else the
 * configured one. `cwd` is always passed, but a resumed worker runs in its recorded directory.
 */
export const workerOptions = (
  worker: ConversationConfig['worker'],
  continued?: { readonly effort: ClaudeEffort | undefined },
): ClaudeWorkerOptions => {
  const base = {
    cwd: worker.cwd,
    executable: worker.claudeExecutable,
    permissionMode: 'auto',
    environment: worker.environment,
  } as const;
  if (continued !== undefined) {
    const effort = continued.effort ?? worker.claude.effort;
    return { ...base, ...(effort === undefined ? {} : { effort }) };
  }
  return {
    ...base,
    ...(worker.claude.model === undefined ? {} : { model: worker.claude.model }),
    ...(worker.claude.effort === undefined ? {} : { effort: worker.claude.effort }),
  };
};

/** The tools the reference session registers, in prompt order: Show, Ask and Forward Agent. */
export const referenceTools = (forward: Tool): ReadonlyArray<Tool> => [
  showTool(),
  askTool(),
  forward,
];

/**
 * The Harness session config: the Guided Walkthrough preset in the configured profile and voice,
 * plus the speech format and tools. The preset is the only source of instructions, examples and
 * speakers. A continued session adds Continue's reminders over the preset's, and the preloaded
 * start with its stored last `answer` as context.
 */
export const referenceSessionConfig = (
  preset: PresetSection,
  speechFormat: AudioFormat,
  tools: ReadonlyArray<Tool>,
  continued?: { readonly answer: string },
): SessionConfig => {
  const walkthrough = guidedWalkthrough(preset);
  return {
    ...walkthrough,
    speechFormat,
    tools,
    ...(continued && {
      reminders: continueReminders(walkthrough.reminders),
      start: {
        message: continueMessage,
        context: { label: continueContextLabel, text: continued.answer },
      },
    }),
  };
};

/**
 * The voice's model: the session's built `model`, constrained to the output's JSON Schema when the
 * `openai-compatible` provider sets `structuredOutput`, and recording each generation when
 * `debug.generationLog` is set. The schema is built once, from the same speakers and tools as the
 * prompt.
 */
const interfaceModel = (
  config: ConversationConfig,
  { speakers, tools }: SessionConfig,
  model: Context.Context<LanguageModel.LanguageModel>,
) => {
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

/** One built session: the Harness session and its worker, for the routes. */
export interface BuiltSession {
  readonly session: Session['Service'];
  readonly worker: WorkerHandle;
}

/**
 * Builds one session in the current scope: the worker first, so the Harness is torn down first.
 * A new brainstorm gets a fresh worker with the brainstorming hook; a continued one resumes the
 * stored Claude session, with its last answer as the preloaded start's context.
 */
export const buildSession = (
  config: ConversationConfig,
  speechFormat: AudioFormat,
  request: StartRequest,
  sources: SessionSources,
): Effect.Effect<
  BuiltSession,
  StartFailed,
  Scope.Scope | LanguageModel.LanguageModel | SpeechSynthesizer | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    // One model, shared: the Forward Agent tool's progress model uses it directly, without the
    // generation log, whose records assume action output, or structured output.
    const model = yield* Effect.context<LanguageModel.LanguageModel>();
    const progress = { prompt: guidedWalkthroughProgressPrompt };
    const continued =
      request.mode === 'continue'
        ? yield* openStoredSession(config.worker, request.sessionId, sources)
        : undefined;
    const forward = yield* (
      continued === undefined
        ? forwardAgentTool({
            worker: sources.claudeWorker(workerOptions(config.worker)),
            hook: brainstormHook,
            progress,
          })
        : // Continue resumes the original Claude session, not a fork. Forking (`forkSession`) would
          // be this backend's choice: the Agent tool always continues the session it is given.
          forwardAgentTool({
            worker: sources.claudeWorker(workerOptions(config.worker, continued)),
            session: { sessionId: continued.sessionId },
            progress,
          })
    ).pipe(
      Effect.provideContext(model),
      Effect.mapError((error) => new StartFailed({ reason: error.reason })),
    );
    const sessionConfig = referenceSessionConfig(
      config.preset,
      speechFormat,
      referenceTools(forward.tool),
      continued && { answer: continued.answer },
    );
    // These layers must be built fresh for each start: layers are memoized by identity, so hoisting
    // them to module constants would share one Harness session and generation log between starts.
    const context = yield* Layer.build(
      harnessLayer(sessionConfig).pipe(Layer.provide(interfaceModel(config, sessionConfig, model))),
    );
    return { session: Context.get(context, Session), worker: forward.worker };
  });

/**
 * The stored Claude session to continue: its validated ID, last answer and recorded effort. Logs
 * identifiers and reason tags only, never message content.
 */
const openStoredSession = (
  worker: ConversationConfig['worker'],
  rawId: string,
  sources: SessionSources,
) =>
  Effect.gen(function* () {
    const sessionId = parseSessionId(rawId);
    if (sessionId === undefined) {
      return yield* Effect.fail(new StartFailed({ reason: 'InvalidSessionId' }));
    }
    const messages = yield* Effect.tryPromise(() => sources.sessionMessages(sessionId)).pipe(
      Effect.mapError(() => new StartFailed({ reason: 'SessionUnreadable' })),
    );
    if (messages.length === 0) {
      return yield* Effect.fail(new StartFailed({ reason: 'SessionNotFound' }));
    }
    const answer = lastAnswer(messages);
    if (answer === undefined) return yield* Effect.fail(new StartFailed({ reason: 'NoAnswer' }));
    const effort = yield* recordedEffort(worker.claudeConfigDir, sessionId);
    if (effort._tag === 'Failure') {
      yield* Effect.logInfo('continue: no recorded effort').pipe(
        Effect.annotateLogs({ sessionId, reason: effort.failure }),
      );
    }
    return {
      sessionId,
      answer,
      effort: effort._tag === 'Success' ? effort.success : undefined,
    };
  });
