import { Effect, type Schedule, type Scope, type Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import type { ToolDefinition } from '@yourtechbudstudio/fluidcast-core/generation';
import type { Tool } from '@yourtechbudstudio/fluidcast-harness';

import type { Handoff, HandoffPrompt } from './handoff.ts';
import { defaultProgressPrompt, defaultProgressSchedule } from './progress.ts';
import {
  ForwardInput,
  ForwardResult,
  forwardToolName,
  type TranscriptMessage,
  type WorkerSummary,
} from './schema.ts';
import { makeWorkerSession } from './session.ts';
import type { WorkerSetupError, WorkerType } from './worker.ts';

export interface ForwardAgentToolOptions {
  /** The worker that does the thinking and the work, such as `claudeWorker(…)`. */
  readonly worker: WorkerType;
  /**
   * An existing session to resume as the worker, such as a fork of a recorded Claude Code session:
   * its history opens the transcript, and its first forward resumes it in its recorded directory.
   * No worker connects until then. Absent: a new session.
   */
  readonly session?: { readonly sessionId: string };
  /**
   * Progress snapshots while the worker is busy: when to write one (default
   * `defaultProgressSchedule`) and the writer's system prompt (default `defaultProgressPrompt`; a
   * preset may supply its own).
   */
  readonly progress?: {
    readonly schedule?: Schedule.Schedule<unknown>;
    readonly prompt?: string;
  };
  /** Reshapes each hand-off. Synchronous and pure; a throw halts the conversation. Default: `{ prompt: handoff.rendered }`. */
  readonly hook?: (handoff: Handoff) => HandoffPrompt;
}

/** A read-only view of the worker for applications (the reference apps' Worker view). */
export interface WorkerHandle {
  /** The worker's summary now, then again whenever its status or session ID changes. */
  readonly status: Stream.Stream<WorkerSummary>;
  /** The worker's transcript: a snapshot, then appended entries. */
  readonly transcript: Stream.Stream<TranscriptMessage>;
}

export interface ForwardAgentTool {
  /** Accepts no client commands (it has no `command`), so the Harness rejects every one. */
  readonly tool: Tool<ForwardInput, ForwardResult>;
  readonly worker: WorkerHandle;
}

/** What the model reads for a result: the agent's messages as it wrote them, never split or summarised. */
const renderForwardResult = ({ messages }: ForwardResult): string =>
  messages.length === 0 ? '(No reply was written.)' : messages.join('\n\n');

/**
 * The half of the Forward Agent tool the model sees, without a worker: its mechanics only. When to
 * forward, what to say while waiting and how to present the agent's replies are the
 * configuration's (a preset's). For rendering prompts without starting a worker.
 */
export const forwardAgentDefinition: ToolDefinition<ForwardInput, ForwardResult> = {
  name: forwardToolName,
  input: ForwardInput,
  guidelines: [
    `\`${forwardToolName}\` (just \`{"type":"${forwardToolName}"}\`, no fields) hands the agent your conversation since the last \`${forwardToolName}\`, including the listener's answers.`,
  ],
  result: ForwardResult,
  renderResult: renderForwardResult,
  // Every earlier call reads back with no fields, so a field the model added once never
  // becomes the precedent for the next.
  renderCall: () => ({}),
};

/**
 * The Forward Agent tool: one worker (the agent) behind one model-facing `forward_agent` action
 * with no fields. Its resources live in the current scope, which must outlive the Harness session
 * (acquire it first). The `LanguageModel` writes progress snapshots.
 */
export const forwardAgentTool = (
  options: ForwardAgentToolOptions,
): Effect.Effect<ForwardAgentTool, WorkerSetupError, LanguageModel.LanguageModel | Scope.Scope> =>
  Effect.gen(function* () {
    const session = yield* makeWorkerSession({
      type: options.worker,
      sessionId: options.session?.sessionId,
      hook: options.hook ?? ((handoff) => ({ prompt: handoff.rendered })),
      schedule: options.progress?.schedule ?? defaultProgressSchedule,
      progressPrompt: options.progress?.prompt ?? defaultProgressPrompt,
      model: yield* LanguageModel.LanguageModel,
    });
    const tool: Tool<ForwardInput, ForwardResult> = {
      ...forwardAgentDefinition,
      policy: { blocking: false, response: 'all', replay: false },
      assign: session.assign,
      context: session.context,
      faults: session.faults,
      run: session.run,
    };
    return {
      tool,
      worker: {
        status: session.status,
        transcript: session.transcript,
      },
    };
  });
