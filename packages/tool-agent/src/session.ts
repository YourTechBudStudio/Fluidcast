/**
 * The worker session: the one worker's state, busy periods (one Harness execution each), its reader
 * fiber, faults, and the Worker streams.
 *
 * All state, including the worker's transcript, is one `SubscriptionRef`. Every decision is one
 * atomic `modify` that records its transcript entries and returns the effects it implies (complete
 * a `Deferred`, report a fault), which run right after it. That linearises `assign` (under the
 * Harness lock), reader events, context sampling, progress snapshots and the Worker streams without
 * a second lock, and the transcript's order is the order of the decisions.
 */
import {
  Deferred,
  Effect,
  FiberHandle,
  Queue,
  Stream,
  SubscriptionRef,
  type Schedule,
  type Scope,
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
  forwardErrorMessage,
  type ForwardInput,
  type ForwardResult,
  type TranscriptEntry,
  type TranscriptMessage,
  type WorkerStatus,
  type WorkerSummary,
} from './schema.ts';
import type { WorkerEvent, WorkerMessage, WorkerSetupError, WorkerType } from './worker.ts';

type Outcome = Deferred.Deferred<ForwardResult, ToolError | ToolFault>;
type TurnEndEntry = Extract<TranscriptEntry, { readonly _tag: 'turnEnd' }>;

/** One busy period: the life of one Forward execution. */
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

/** What `run` finds for a new execution: a period to await, or a refusal decided in `assign`. */
type Opening =
  | {
      readonly _tag: 'Period';
      readonly outcome: Outcome;
      /** The period's first transcript index: its hand-off prompt. */
      readonly transcriptStart: number;
    }
  | { readonly _tag: 'Refused'; readonly failure: ToolFault };

interface WorkerState {
  /**
   * The agent's session ID: the preloaded one from the start, else `undefined` until the connection
   * reports it (`SessionStarted`).
   */
  readonly sessionId: string | undefined;
  readonly cwd: string;
  /** A reader has been forked: once in the worker's life. */
  readonly connected: boolean;
  /** The last forward call whose message was sent. */
  readonly lastHandle: string | undefined;
  /** From events: any entry makes it `running`; `Settled` makes it `settled`. */
  readonly activity: 'running' | 'settled';
  /** The last busy period ended in an error, or it faulted. */
  readonly failed: boolean;
  readonly fault: ToolFault | undefined;
  readonly period: Period | undefined;
  /**
   * Top-level text written with no period open (an automatic turn between forwards), in order. The
   * next period's result starts with it, so the voice reads it exactly once.
   */
  readonly undelivered: ReadonlyArray<string>;
  /** Append-only: each change replaces the array. */
  readonly transcript: ReadonlyArray<TranscriptEntry>;
  /** New executions waiting for `run`. */
  readonly openings: ReadonlyMap<ExecutionId, Opening>;
}

export interface WorkerSessionOptions {
  readonly type: WorkerType;
  /** An existing session to resume as the worker. */
  readonly sessionId: string | undefined;
  readonly hook: (handoff: Handoff) => HandoffPrompt;
  readonly schedule: Schedule.Schedule<unknown>;
  /** The progress writer's system prompt. */
  readonly progressPrompt: string;
  readonly model: LanguageModel.LanguageModel;
}

export const statusOf = (worker: WorkerState): WorkerStatus =>
  worker.period !== undefined || worker.activity === 'running'
    ? 'working'
    : worker.failed
      ? 'failed'
      : 'idle';

const summaryOf = (worker: WorkerState): WorkerSummary => ({
  _tag: 'WorkerSummary',
  status: statusOf(worker),
  sessionId: worker.sessionId ?? null,
});

/** The per-iteration context: the worker's state, or nothing while it is idle. */
export const renderContext = (status: WorkerStatus): string | undefined => {
  switch (status) {
    case 'idle':
      return undefined;
    case 'working':
      return 'The agent is working.';
    case 'failed':
      return "The agent's last turn stopped with an error.";
  }
};

const withOpening = (
  state: WorkerState,
  executionId: ExecutionId,
  opening: Opening,
): WorkerState => ({
  ...state,
  openings: new Map(state.openings).set(executionId, opening),
});

/** The worker session's parts: the Forward tool's execution half, and the Worker view. */
export interface WorkerSession {
  readonly assign: (input: ForwardInput, call: CallAssignment) => Effect.Effect<ExecutionId>;
  readonly run: (
    input: ForwardInput,
    context: InvocationContext<unknown>,
  ) => Effect.Effect<ForwardResult, ToolError | ToolFault>;
  readonly context: Effect.Effect<string | undefined>;
  readonly faults: Stream.Stream<ToolFault>;
  readonly status: Stream.Stream<WorkerSummary>;
  readonly transcript: Stream.Stream<TranscriptMessage>;
}

/** Builds the worker session in the current scope, attaching a preloaded session. Nothing is spawned. */
export const makeWorkerSession = (
  options: WorkerSessionOptions,
): Effect.Effect<WorkerSession, WorkerSetupError, Scope.Scope> =>
  Effect.gen(function* () {
    const { type } = options;
    const reader = yield* FiberHandle.make();
    const faultQueue = yield* Queue.unbounded<ToolFault>();
    const inbox = yield* Queue.unbounded<WorkerMessage>();

    const attached =
      options.sessionId === undefined ? undefined : yield* type.attach(options.sessionId);
    const state = yield* SubscriptionRef.make<WorkerState>({
      sessionId: options.sessionId,
      cwd: attached?.cwd ?? type.cwd,
      connected: false,
      lastHandle: undefined,
      activity: 'settled',
      failed: false,
      fault: undefined,
      period: undefined,
      undelivered: [],
      transcript: attached?.history ?? [],
      openings: new Map(),
    });

    /** Applies one decision atomically; the caller runs the effects it planned. */
    const decide = <A>(decision: (current: WorkerState) => readonly [A, WorkerState]) =>
      SubscriptionRef.modify(state, decision);

    // The reader: one fiber for the worker's connection, in the session's scope.

    const onEvent = (event: WorkerEvent) =>
      Effect.flatten(decide((current) => applyEvent(current, event)));

    /** A connection failure: fails the open period's `run`, else goes to `faults`. Exactly once. */
    const onFault = (fault: ToolFault) =>
      Effect.flatten(
        decide((current): readonly [Effect.Effect<void>, WorkerState] => {
          const report =
            current.period === undefined
              ? Queue.offer(faultQueue, fault)
              : Deferred.fail(current.period.outcome, fault);
          return [
            Effect.asVoid(report).pipe(
              Effect.andThen(
                Effect.logWarning('worker faulted').pipe(
                  Effect.annotateLogs({ reason: fault.reason }),
                ),
              ),
            ),
            {
              ...current,
              activity: 'settled',
              failed: true,
              fault,
              period: undefined,
            },
          ];
        }),
      );

    // Interruption (the session's scope closing) runs no handler: `catch` and `catchDefect` do not
    // catch it. A worker connects exactly once (`connected`), so an ID known at connect time is a
    // preloaded session to resume, and an unknown one is a new session: its `SessionStarted` can
    // only arrive after this.
    const connect = (worker: WorkerState) =>
      type.connect({ cwd: worker.cwd, resume: worker.sessionId }, Stream.fromQueue(inbox)).pipe(
        Stream.runForEach(onEvent),
        // An adapter must not end on its own.
        Effect.andThen(Effect.fail(new ToolFault({ reason: 'WorkerEnded' }))),
        Effect.catch(onFault),
        Effect.catchDefect(() => onFault(new ToolFault({ reason: 'WorkerDefect' }))),
      );

    /**
     * Places a reached forward call: a new busy period (`call.executionId`) or the open one. Runs
     * under the Harness lock and never waits. Throws from the hook or `composeMessage` escape as
     * defects, which the Harness turns into a halt.
     *
     * Joining is safe: the Harness reads its state and calls `assign` in one locked step, and an
     * execution only finishes under that lock. The session removes a period in its `modify` before
     * it completes the period's outcome. So a period it still sees as open is an open Harness
     * execution of this tool.
     */
    const assign = (_input: ForwardInput, call: CallAssignment) =>
      Effect.gen(function* () {
        // `lastHandle` changes only here, which the Harness lock serialises, so the hand-off built
        // from this read stays valid.
        const known = yield* SubscriptionRef.get(state);
        if (known.fault !== undefined) {
          const failure = known.fault;
          yield* SubscriptionRef.update(state, (current) =>
            withOpening(current, call.executionId, { _tag: 'Refused', failure }),
          );
          return call.executionId;
        }

        const conversation = conversationSince(call.state, known.lastHandle, call.handle);
        const isFirstMessage = known.lastHandle === undefined;
        const prompt = options.hook({
          conversation,
          isFirstMessage,
          rendered: renderHandoff({ conversation, isFirstMessage }),
        });
        const text = type.composeMessage(prompt.prompt, prompt.modifiers ?? []);
        const outcome = yield* Deferred.make<ForwardResult, ToolError | ToolFault>();
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
              | { readonly _tag: 'Refused' }
              | {
                  readonly _tag: 'Sent';
                  readonly executionId: ExecutionId;
                  readonly joined: boolean;
                  readonly connect: WorkerState | undefined;
                }
            ),
            WorkerState,
          ] => {
            // The worker faulted since the first read.
            if (current.fault !== undefined) {
              return [
                { _tag: 'Refused' },
                withOpening(current, call.executionId, {
                  _tag: 'Refused',
                  failure: current.fault,
                }),
              ];
            }
            if (current.period !== undefined) {
              const period = { ...current.period, sent: new Set(current.period.sent).add(id) };
              return [
                {
                  _tag: 'Sent',
                  executionId: period.executionId,
                  joined: true,
                  connect: undefined,
                },
                {
                  ...current,
                  lastHandle: call.handle,
                  period,
                  transcript: [...current.transcript, sentEntry],
                },
              ];
            }
            const opened: WorkerState = {
              ...current,
              connected: true,
              lastHandle: call.handle,
              transcript: [...current.transcript, sentEntry],
              undelivered: [],
              period: {
                executionId: call.executionId,
                sent: new Set([id]),
                consumed: new Set(),
                texts: current.undelivered,
                lastTurnEnd: undefined,
                outcome,
              },
            };
            return [
              {
                _tag: 'Sent',
                executionId: call.executionId,
                joined: false,
                connect: current.connected ? undefined : opened,
              },
              withOpening(opened, call.executionId, {
                _tag: 'Period',
                outcome,
                transcriptStart: current.transcript.length,
              }),
            ];
          },
        );
        if (decision._tag === 'Refused') return call.executionId;

        yield* Queue.offer(inbox, { id, text });
        // Only the decision that set `connected` forks, so the worker has exactly one reader.
        if (decision.connect !== undefined) {
          yield* FiberHandle.run(reader, connect(decision.connect));
        }
        yield* Effect.logInfo('forward sent').pipe(
          Effect.annotateLogs({ handle: call.handle, joined: decision.joined }),
        );
        return decision.executionId;
      });

    /** Awaits the period `assign` opened for this execution, with progress while it runs. */
    const run = (_input: ForwardInput, context: InvocationContext<unknown>) =>
      Effect.gen(function* () {
        const opening = yield* decide((current): readonly [Opening | undefined, WorkerState] => {
          const openings = new Map(current.openings);
          const found = openings.get(context.executionId);
          openings.delete(context.executionId);
          return [found, { ...current, openings }];
        });
        if (opening === undefined) {
          return yield* Effect.die(new Error('the forward execution has no opening from assign'));
        }
        if (opening._tag === 'Refused') return yield* Effect.fail(opening.failure);
        return yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.forkScoped(
              progressLoop({
                schedule: options.schedule,
                prompt: options.progressPrompt,
                model: options.model,
                transcript: transcriptNow,
                start: opening.transcriptStart,
                offer: context.progress,
              }),
            );
            return yield* Deferred.await(opening.outcome);
          }),
        );
      });

    const transcriptNow = SubscriptionRef.get(state).pipe(
      Effect.map((current) => current.transcript),
    );

    const status: Stream.Stream<WorkerSummary> = SubscriptionRef.changes(state).pipe(
      Stream.map(summaryOf),
      Stream.changesWith((a, b) => a.status === b.status && a.sessionId === b.sessionId),
    );

    // Every emission is the whole append-only array, so a skipped value loses no entries.
    const transcript: Stream.Stream<TranscriptMessage> = SubscriptionRef.changes(state).pipe(
      Stream.map((current) => current.transcript),
      Stream.mapAccum(
        (): number | undefined => undefined,
        (seen, entries): readonly [number, ReadonlyArray<TranscriptMessage>] => {
          if (seen === undefined) {
            return [entries.length, [{ _tag: 'TranscriptSnapshot', entries }]];
          }
          const added = entries.slice(seen);
          return [
            entries.length,
            added.length === 0 ? [] : [{ _tag: 'TranscriptAppended', entries: added }],
          ];
        },
      ),
    );

    return {
      assign,
      run,
      context: SubscriptionRef.get(state).pipe(
        Effect.map((current) => renderContext(statusOf(current))),
      ),
      faults: Stream.fromQueue(faultQueue),
      status,
      transcript,
    };
  });

/** One reader event as a decision: the next state, and the effect that completes a period. */
const applyEvent = (
  current: WorkerState,
  event: WorkerEvent,
): readonly [Effect.Effect<void>, WorkerState] => {
  const period = current.period;
  switch (event._tag) {
    // Identity only: neither activity nor the transcript.
    case 'SessionStarted':
      return [Effect.void, { ...current, sessionId: event.sessionId }];
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
      // Text with no period to join waits for the next one.
      const undelivered =
        period === undefined && topLevel && entry._tag === 'text'
          ? [...current.undelivered, entry.text]
          : current.undelivered;
      return [
        Effect.void,
        {
          ...current,
          activity: 'running',
          period: next,
          undelivered,
          transcript: [...current.transcript, entry],
        },
      ];
    }
    case 'Consumed': {
      if (period === undefined) return [Effect.void, current];
      const consumed = new Set(period.consumed);
      for (const id of event.ids) if (period.sent.has(id)) consumed.add(id);
      return [Effect.void, { ...current, period: { ...period, consumed } }];
    }
    case 'Settled': {
      const settled: WorkerState = { ...current, activity: 'settled' };
      if (period === undefined) return [Effect.void, settled];
      const unconsumed = [...period.sent].filter((id) => !period.consumed.has(id)).length;
      if (unconsumed > 0) {
        // Superseded: a later message is still to be taken in, so the period continues.
        return [
          Effect.logInfo('worker result superseded').pipe(Effect.annotateLogs({ unconsumed })),
          settled,
        ];
      }
      const turnEnd = period.lastTurnEnd;
      const failed = turnEnd !== undefined && turnEnd.outcome !== 'success';
      const complete = failed
        ? Deferred.fail(
            period.outcome,
            new ToolError({
              message: forwardErrorMessage({
                outcome: turnEnd.outcome,
                resetsAt: turnEnd.resetsAt,
                messages: period.texts,
              }),
            }),
          )
        : Deferred.succeed(period.outcome, { messages: period.texts });
      // The period leaves the state before its outcome completes (see `assign`).
      return [Effect.asVoid(complete), { ...settled, failed, period: undefined }];
    }
  }
};
