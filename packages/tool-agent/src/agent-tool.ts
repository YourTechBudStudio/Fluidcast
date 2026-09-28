import { Effect, type Schedule, type Scope, type Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import type { Tool } from '@yourtechbudstudio/fluidcast-harness';

import { renderAgentResult, type Handoff, type HandoffPrompt } from './handoff.ts';
import { makePool } from './pool.ts';
import { defaultProgressSchedule } from './progress.ts';
import {
  agentInput,
  AgentResult,
  agentToolName,
  type AgentInput,
  type TranscriptMessage,
  type WorkerNotFound,
  type WorkerSummary,
} from './schema.ts';
import type { AgentSetupError, WorkerType } from './worker.ts';

export interface AgentToolOptions<Types extends Readonly<Record<string, WorkerType>>> {
  /** The worker types the model may pick, by the name it writes as `agentType`. */
  readonly types: Types;
  /** Existing sessions to attach as workers at start. Nothing is spawned until their first message. */
  readonly preload?: ReadonlyArray<{
    readonly type: keyof Types & string;
    readonly agent: string;
    readonly sessionId: string;
  }>;
  readonly progress?: { readonly schedule?: Schedule.Schedule<unknown> };
  /** Reshapes each hand-off. Synchronous and pure; a throw halts the conversation. Default: `{ prompt: handoff.rendered }`. */
  readonly hook?: (handoff: Handoff) => HandoffPrompt;
}

/** A read-only view of the pool for applications (the reference apps' Workers view). */
export interface Workers {
  /** The workers in creation order, whenever a worker or its status changes. */
  readonly list: Stream.Stream<ReadonlyArray<WorkerSummary>>;
  /** A worker's transcript: a snapshot, then appended entries. */
  readonly transcript: (
    agent: string,
  ) => Effect.Effect<Stream.Stream<TranscriptMessage>, WorkerNotFound>;
}

export interface AgentTool {
  readonly tool: Tool<AgentInput, AgentResult, never>;
  readonly workers: Workers;
}

const guidelines = (types: Readonly<Record<string, WorkerType>>): ReadonlyArray<string> => [
  `Use \`agent\` to hand work to a worker agent that does the real thinking and returns a detailed response. Worker types: ${Object.entries(
    types,
  )
    .map(([name, type]) => `\`${name}\`: ${type.description.replace(/\.$/, '')}`)
    .join('; ')}.`,
  "The worker sees the whole conversation since its last message: what you said, showed and asked, and the listener's own words. So an `agent` `message` holds only your instruction, never a retelling.",
  'Reuse an `agent` id to continue with the same worker. Sending to a worker that is still working steers its current work; one result then answers every call it took in (`calls="…"`).',
  'After an `agent` call, say one short line, then stop and wait. While it works, the listener hears nothing from it; progress may arrive as `<tool_progress>`. Present each `agent` result faithfully and in order, in pieces, with a `show` for anything structured; never invent what the worker did not say.',
];

/**
 * The Agent tool: a per-session pool of workers behind one model-facing `agent` action. Its
 * resources live in the current scope, which must outlive the Harness session (acquire it first).
 * The `LanguageModel` writes progress snapshots.
 */
export const agentTool = <Types extends Readonly<Record<string, WorkerType>>>(
  options: AgentToolOptions<Types>,
): Effect.Effect<AgentTool, AgentSetupError, LanguageModel.LanguageModel | Scope.Scope> =>
  Effect.gen(function* () {
    const [first, ...rest] = Object.keys(options.types);
    if (first === undefined)
      return yield* Effect.die(new Error('agentTool needs at least one worker type'));
    const input = agentInput([first, ...rest]);
    const pool = yield* makePool({
      types: options.types,
      preload: options.preload ?? [],
      hook: options.hook ?? ((handoff) => ({ prompt: handoff.rendered })),
      schedule: options.progress?.schedule ?? defaultProgressSchedule,
      model: yield* LanguageModel.LanguageModel,
      input,
    });
    const tool: Tool<AgentInput, AgentResult, never> = {
      name: agentToolName,
      input,
      guidelines: guidelines(options.types),
      result: AgentResult,
      renderResult: renderAgentResult,
      policy: { blocking: false, response: 'all', replay: false },
      assign: pool.assign,
      context: pool.context,
      faults: pool.faults,
      run: pool.run,
    };
    return { tool, workers: pool.workers };
  });
