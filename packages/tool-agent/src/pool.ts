/**
 * The worker pool: one registry per session keyed by agent ID, busy periods (one Harness execution
 * each), one reader fiber per connected worker, faults, and the Workers streams.
 *
 * All pool state, including every worker's transcript, is one `SubscriptionRef`. Every decision
 * is one atomic `modify` that records its transcript entries and returns the effects it implies
 * (offer to an inbox, complete a `Deferred`), which run right after it. That linearises `assign`
 * (under the Harness lock), reader events, context sampling, progress snapshots and the Workers
 * streams without a second lock, and a transcript's order is the order of the decisions.
 */
import {
  Deferred,
  Effect,
  FiberMap,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
  type Schedule,
} from 'effect';
import type { LanguageModel } from 'effect/unstable/ai';

import { uuidv7 } from '@yourtechbudstudio/fluidcast-core/actions';
import {
  ToolError,
  ToolFault,
  type CallAssignment,
  type InvocationContext,
} from '@yourtechbudstudio/fluidcast-harness';
import type { ExecutionId } from '@yourtechbudstudio/fluidcast-harness/protocol';

import { conversationSince, renderHandoff, type Handoff, type HandoffPrompt } from './handoff.ts';
import { progressLoop } from './progress.ts';
import {
  agentErrorMessage,
  AgentId,
  WorkerNotFound,
  type AgentInput,
  type AgentResult,
  type TranscriptEntry,
  type TranscriptMessage,
  type WorkerStatus,
  type WorkerSummary,
} from './schema.ts';
import {
  AgentSetupError,
  type WorkerEvent,
  type WorkerMessage,
  type WorkerType,
} from './worker.ts';

type Outcome = Deferred.Deferred<AgentResult, ToolError | ToolFault>;
type TurnEndEntry = Extract<TranscriptEntry, { readonly _tag: 'turnEnd' }>;

/** One busy period: the life of one Agent execution. */
interface Period {
  readonly executionId: ExecutionId;
  /** Message IDs sent in this period, and those a turn has taken in. */
  readonly sent: ReadonlySet<string>;
  readonly consumed: ReadonlySet<string>;
  /** Top-level text entries, in order. */
  readonly texts: ReadonlyArray<string>;
  /** The latest top-level `turnEnd` entry. */
  readonly lastTurnEnd: TurnEndEntry | undefined;
  readonly outcome: Outcome;
}

interface Worker {
  readonly agent: string;
  readonly agentType: string;
  readonly sessionId: string;
  readonly cwd: string;
  /** Preloaded: the first connection resumes. */
  readonly resume: boolean;
  /** A reader has been forked. */
  readonly connected: boolean;
  /** The last call whose message was sent to it. */
  readonly lastHandle: string | undefined;
  /** From events: any entry makes it `running`; `Settled` makes it `settled`. */
  readonly activity: 'running' | 'settled';
  /** The last busy period ended in an error, or it faulted. */
  readonly failed: boolean;
  readonly fault: ToolFault | undefined;
  readonly period: Period | undefined;
  readonly inbox: Queue.Queue<WorkerMessage>;
  /** Append-only: each change replaces the array. */
  readonly transcript: ReadonlyArray<TranscriptEntry>;
}

/** What `run` finds for a new execution: a period to await, or a refusal decided in `assign`. */
type Opening =
  | {
      readonly _tag: 'Period';
      readonly agent: string;
      readonly outcome: Outcome;
      /** The period's first transcript index: its hand-off prompt. */
      readonly transcriptStart: number;
    }
  | { readonly _tag: 'Refused'; readonly failure: ToolError | ToolFault };

interface PoolState {
  /** Insertion order is creation order. */
  readonly workers: ReadonlyMap<string, Worker>;
  /** New executions waiting for `run`. */
  readonly openings: ReadonlyMap<ExecutionId, Opening>;
}

export interface PoolOptions {
  readonly types: Readonly<Record<string, WorkerType>>;
  readonly preload: ReadonlyArray<{
    readonly type: string;
    readonly agent: string;
    readonly sessionId: string;
  }>;
  readonly hook: (handoff: Handoff) => HandoffPrompt;
  readonly schedule: Schedule.Schedule<unknown>;
  readonly model: LanguageModel.LanguageModel;
  /** The Agent tool's input schema, so hand-offs can tell invalid agent calls apart. */
  readonly input: Schema.Decoder<unknown>;
}

export const statusOf = (worker: Worker): WorkerStatus =>
  worker.period !== undefined || worker.activity === 'running'
    ? 'working'
    : worker.failed
      ? 'failed'
      : 'done';

const summaries = (state: PoolState): ReadonlyArray<WorkerSummary> =>
  [...state.workers.values()].map((worker) => ({
    agent: worker.agent,
    agentType: worker.agentType,
    status: statusOf(worker),
    sessionId: worker.sessionId,
  }));

const sameSummaries = (a: ReadonlyArray<WorkerSummary>, b: ReadonlyArray<WorkerSummary>) =>
  a.length === b.length &&
  a.every(
    (summary, index) =>
      summary.agent === b[index]!.agent &&
      summary.agentType === b[index]!.agentType &&
      summary.status === b[index]!.status &&
      summary.sessionId === b[index]!.sessionId,
  );

/** The per-iteration context: every worker with its type and status, or nothing without workers. */
const renderContext = (state: PoolState): string | undefined =>
  state.workers.size === 0
    ? undefined
    : [
        'Workers:',
        ...[...state.workers.values()].map(
          (worker) => `- ${worker.agent} (${worker.agentType}): ${statusOf(worker)}`,
        ),
      ].join('\n');

const withWorker = (state: PoolState, worker: Worker): PoolState => ({
  ...state,
  workers: new Map(state.workers).set(worker.agent, worker),
});

const withOpening = (state: PoolState, executionId: ExecutionId, opening: Opening): PoolState => ({
  ...state,
  openings: new Map(state.openings).set(executionId, opening),
});

const isValidAgentId = Schema.is(AgentId);

/** Builds the pool in the current scope, preloading workers. Nothing is spawned. */
export const makePool = (options: PoolOptions) =>
  Effect.gen(function* () {
    const readers = yield* FiberMap.make<string>();
    const faultQueue = yield* Queue.unbounded<ToolFault>();

    const workers = new Map<string, Worker>();
    for (const entry of options.preload) {
      if (!isValidAgentId(entry.agent)) {
        return yield* new AgentSetupError({ agent: entry.agent, reason: 'InvalidAgentId' });
      }
      if (workers.has(entry.agent)) {
        return yield* new AgentSetupError({ agent: entry.agent, reason: 'DuplicateAgent' });
      }
      const type = options.types[entry.type];
      if (type === undefined) return yield* Effect.die(`Unknown agent type "${entry.type}"`);
      // The adapter knows only the session; the error names the worker.
      const attached = yield* type
        .attach(entry.sessionId)
        .pipe(
          Effect.mapError(
            (error) => new AgentSetupError({ agent: entry.agent, reason: error.reason }),
          ),
        );
      workers.set(entry.agent, {
        agent: entry.agent,
        agentType: entry.type,
        sessionId: entry.sessionId,
        cwd: attached.cwd,
        resume: true,
        connected: false,
        lastHandle: undefined,
        activity: 'settled',
        failed: false,
        fault: undefined,
        period: undefined,
        inbox: yield* Queue.unbounded<WorkerMessage>(),
        transcript: attached.history,
      });
    }
    const state = yield* SubscriptionRef.make<PoolState>({ workers, openings: new Map() });

    /** Applies one decision atomically, then runs the effects it planned. */
    const decide = <A>(decision: (current: PoolState) => readonly [A, PoolState]) =>
      SubscriptionRef.modify(state, decision);

    // Reader: one fiber per connected worker, in the pool's scope.

    const onEvent = (agent: string, event: WorkerEvent) =>
      Effect.flatten(
        decide((current): readonly [Effect.Effect<void>, PoolState] => {
          const worker = current.workers.get(agent)!;
          const period = worker.period;
          switch (event._tag) {
            case 'Entry': {
              const { entry } = event;
              const topLevel = entry.parentToolUseId === null;
              const next =
                period === undefined || !topLevel
                  ? period
                  : entry._tag === 'text'
                    ? { ...period, texts: [...period.texts, entry.text] }
                    : entry._tag === 'turnEnd'
                      ? { ...period, lastTurnEnd: entry }
                      : period;
              return [
                Effect.void,
                withWorker(current, {
                  ...worker,
                  activity: 'running',
                  period: next,
                  transcript: [...worker.transcript, entry],
                }),
              ];
            }
            case 'Consumed': {
              if (period === undefined) return [Effect.void, current];
              const consumed = new Set(period.consumed);
              for (const id of event.ids) if (period.sent.has(id)) consumed.add(id);
              return [
                Effect.void,
                withWorker(current, { ...worker, period: { ...period, consumed } }),
              ];
            }
            case 'Settled': {
              const settled: Worker = { ...worker, activity: 'settled' };
              if (period === undefined) return [Effect.void, withWorker(current, settled)];
              const unconsumed = [...period.sent].filter((id) => !period.consumed.has(id)).length;
              if (unconsumed > 0) {
                // Superseded: a later message is still to be taken in, so the period continues.
                return [
                  Effect.logInfo('agent result superseded').pipe(
                    Effect.annotateLogs({ agent, unconsumed }),
                  ),
                  withWorker(current, settled),
                ];
              }
              const turnEnd = period.lastTurnEnd;
              const failed = turnEnd !== undefined && turnEnd.outcome !== 'success';
              const complete = failed
                ? Deferred.fail(
                    period.outcome,
                    new ToolError({
                      message: agentErrorMessage({
                        agent,
                        outcome: turnEnd.outcome,
                        resetsAt: turnEnd.resetsAt,
                        messages: period.texts,
                      }),
                    }),
                  )
                : Deferred.succeed(period.outcome, { agent, messages: period.texts });
              // The period leaves the pool before its outcome completes (see `assign`).
              return [
                Effect.asVoid(complete),
                withWorker(current, { ...settled, failed, period: undefined }),
              ];
            }
          }
        }),
      );

    /** A connection failure: fails the open period's `run`, else goes to `faults`. Exactly once. */
    const onFault = (agent: string, fault: ToolFault) =>
      Effect.flatten(
        decide((current): readonly [Effect.Effect<void>, PoolState] => {
          const worker = current.workers.get(agent)!;
          const report =
            worker.period === undefined
              ? Queue.offer(faultQueue, fault)
              : Deferred.fail(worker.period.outcome, fault);
          return [
            Effect.asVoid(report).pipe(
              Effect.andThen(
                Effect.logWarning('agent worker faulted').pipe(
                  Effect.annotateLogs({ agent, reason: fault.reason }),
                ),
              ),
            ),
            withWorker(current, {
              ...worker,
              activity: 'settled',
              failed: true,
              fault,
              period: undefined,
            }),
          ];
        }),
      );

    // Interruption (the pool's scope closing) runs no handler: `catch` and `catchDefect` do not
    // catch it.
    const reader = (worker: Worker) =>
      options.types[worker.agentType]!.connect(
        { sessionId: worker.sessionId, resume: worker.resume, cwd: worker.cwd },
        Stream.fromQueue(worker.inbox),
      ).pipe(
        Stream.runForEach((event) => onEvent(worker.agent, event)),
        // An adapter must not end on its own.
        Effect.andThen(Effect.fail(new ToolFault({ reason: 'WorkerEnded' }))),
        Effect.catch((fault) => onFault(worker.agent, fault)),
        Effect.catchDefect(() => onFault(worker.agent, new ToolFault({ reason: 'WorkerDefect' }))),
      );

    /**
     * Places a reached call: a new busy period (`call.executionId`) or the worker's open one.
     * Runs under the Harness lock and never waits. Throws from the hook or `composeMessage` escape
     * as defects, which the Harness turns into a halt.
     *
     * Joining is safe: the Harness reads its state and calls `assign` in one locked step, and an
     * execution only finishes under that lock. The pool removes a period in its `modify` before it
     * completes the period's outcome. So a period the pool still sees as open is an open Harness
     * execution of this tool.
     */
    const assign = (input: AgentInput, call: CallAssignment) =>
      Effect.gen(function* () {
        const refuse = (failure: ToolError | ToolFault) =>
          SubscriptionRef.update(state, (current) =>
            withOpening(current, call.executionId, { _tag: 'Refused', failure }),
          ).pipe(Effect.as(call.executionId));

        // A worker's type and `lastHandle` change only here, which the Harness lock serialises,
        // so the hand-off built from this read stays valid.
        const known = (yield* SubscriptionRef.get(state)).workers.get(input.agent);
        if (known !== undefined && known.agentType !== input.agentType) {
          return yield* refuse(
            new ToolError({
              message: `The agent "${input.agent}" is a ${known.agentType} agent, not a ${input.agentType} agent. Use another id for a new ${input.agentType} agent.`,
            }),
          );
        }
        if (known?.fault !== undefined) return yield* refuse(known.fault);

        const outcome = yield* Deferred.make<AgentResult, ToolError | ToolFault>();
        const inbox = known?.inbox ?? (yield* Queue.unbounded<WorkerMessage>());
        const type = options.types[input.agentType]!;

        const pieces = {
          agentType: input.agentType,
          agent: input.agent,
          instruction: input.message,
          conversation: conversationSince(
            call.state,
            known?.lastHandle,
            call.handle,
            input.agent,
            options.input,
          ),
          isFirstMessage: known?.lastHandle === undefined,
        };
        const prompt = options.hook({ ...pieces, rendered: renderHandoff(pieces) });
        const text = type.composeMessage(prompt.prompt, prompt.modifiers ?? []);
        const id = uuidv7();
        // Recorded in the same decision that sends it, so it always precedes the reply.
        const sentEntry: TranscriptEntry = {
          _tag: 'prompt',
          parentToolUseId: null,
          source: 'fluidcast',
          text,
        };

        const decision = yield* decide(
          (
            current,
          ): readonly [
            (
              | { readonly _tag: 'Refused'; readonly fault: ToolFault }
              | {
                  readonly _tag: 'Sent';
                  readonly executionId: ExecutionId;
                  readonly worker: Worker;
                  readonly joined: boolean;
                  readonly connect: boolean;
                }
            ),
            PoolState,
          ] => {
            const worker = current.workers.get(input.agent);
            // The worker faulted since the first read.
            if (worker?.fault !== undefined) {
              return [
                { _tag: 'Refused', fault: worker.fault },
                withOpening(current, call.executionId, {
                  _tag: 'Refused',
                  failure: worker.fault,
                }),
              ];
            }
            if (worker?.period !== undefined) {
              const period = { ...worker.period, sent: new Set(worker.period.sent).add(id) };
              const joined = {
                ...worker,
                lastHandle: call.handle,
                period,
                transcript: [...worker.transcript, sentEntry],
              };
              return [
                {
                  _tag: 'Sent',
                  executionId: period.executionId,
                  worker: joined,
                  joined: true,
                  connect: false,
                },
                withWorker(current, joined),
              ];
            }
            const base: Worker = worker ?? {
              agent: input.agent,
              agentType: input.agentType,
              sessionId: uuidv7(),
              cwd: type.cwd,
              resume: false,
              connected: false,
              lastHandle: undefined,
              activity: 'settled',
              failed: false,
              fault: undefined,
              period: undefined,
              inbox,
              transcript: [],
            };
            const opened: Worker = {
              ...base,
              connected: true,
              lastHandle: call.handle,
              transcript: [...base.transcript, sentEntry],
              period: {
                executionId: call.executionId,
                sent: new Set([id]),
                consumed: new Set(),
                texts: [],
                lastTurnEnd: undefined,
                outcome,
              },
            };
            return [
              {
                _tag: 'Sent',
                executionId: call.executionId,
                worker: opened,
                joined: false,
                connect: !base.connected,
              },
              withOpening(withWorker(current, opened), call.executionId, {
                _tag: 'Period',
                agent: input.agent,
                outcome,
                transcriptStart: base.transcript.length,
              }),
            ];
          },
        );
        if (decision._tag === 'Refused') return call.executionId;

        const { worker } = decision;
        yield* Queue.offer(worker.inbox, { id, text });
        // Only the decision that set `connected` forks, so each worker has exactly one reader.
        if (decision.connect) yield* FiberMap.run(readers, worker.agent, reader(worker));
        yield* Effect.logInfo('agent message sent').pipe(
          Effect.annotateLogs({
            agent: worker.agent,
            handle: call.handle,
            joined: decision.joined,
          }),
        );
        return decision.executionId;
      });

    /** Awaits the period `assign` opened for this execution, with progress while it runs. */
    const run = (_input: AgentInput, context: InvocationContext<unknown>) =>
      Effect.gen(function* () {
        const opening = yield* decide((current): readonly [Opening | undefined, PoolState] => {
          const openings = new Map(current.openings);
          const found = openings.get(context.executionId);
          openings.delete(context.executionId);
          return [found, { ...current, openings }];
        });
        if (opening === undefined) {
          return yield* Effect.die(new Error('the agent execution has no opening from assign'));
        }
        if (opening._tag === 'Refused') return yield* Effect.fail(opening.failure);
        return yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.forkScoped(
              progressLoop({
                agent: opening.agent,
                schedule: options.schedule,
                model: options.model,
                transcript: transcriptOf(opening.agent),
                start: opening.transcriptStart,
                offer: context.progress,
              }),
            );
            return yield* Deferred.await(opening.outcome);
          }),
        );
      });

    const context = SubscriptionRef.get(state).pipe(Effect.map(renderContext));

    const transcriptOf = (agent: string) =>
      SubscriptionRef.get(state).pipe(
        Effect.map((current) => current.workers.get(agent)!.transcript),
      );

    const list: Stream.Stream<ReadonlyArray<WorkerSummary>> = SubscriptionRef.changes(state).pipe(
      Stream.map(summaries),
      Stream.changesWith(sameSummaries),
    );

    const transcript = (
      agent: string,
    ): Effect.Effect<Stream.Stream<TranscriptMessage>, WorkerNotFound> =>
      Effect.gen(function* () {
        const worker = (yield* SubscriptionRef.get(state)).workers.get(agent);
        if (worker === undefined) return yield* new WorkerNotFound({ agent });
        // Every emission is the whole append-only array, so a skipped value loses no entries.
        return SubscriptionRef.changes(state).pipe(
          Stream.map((current) => current.workers.get(agent)!.transcript),
          Stream.mapAccum(
            (): number | undefined => undefined,
            (seen, entries): readonly [number, ReadonlyArray<TranscriptMessage>] => {
              if (seen === undefined) {
                return [
                  entries.length,
                  [
                    {
                      _tag: 'TranscriptSnapshot',
                      agent,
                      sessionId: worker.sessionId,
                      entries,
                    },
                  ],
                ];
              }
              const added = entries.slice(seen);
              return [
                entries.length,
                added.length === 0 ? [] : [{ _tag: 'TranscriptAppended', entries: added }],
              ];
            },
          ),
        );
      });

    return {
      assign,
      run,
      context,
      faults: Stream.fromQueue(faultQueue),
      workers: { list, transcript },
    };
  });

export type Pool = Effect.Success<ReturnType<typeof makePool>>;
