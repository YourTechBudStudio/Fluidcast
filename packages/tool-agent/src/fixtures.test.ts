/** Test-only builders and fakes (named `.test.ts` so builds leave it out; it has no tests). */
import { Cause, Effect, Queue, Ref, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { makeActionId, type Action } from '@yourtechbudstudio/fluidcast-core/actions';
import type { ToolFault } from '@yourtechbudstudio/fluidcast-harness';
import {
  ExecutionId,
  type Execution,
  type PendingResult,
  type SessionState,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

import type { Modifier } from './handoff.ts';
import { forwardToolName, type TranscriptEntry } from './schema.ts';
import {
  WorkerSetupError,
  type WorkerEvent,
  type WorkerMessage,
  type WorkerType,
} from './worker.ts';

type Draft<A> = A extends Action ? Omit<A, 'id'> : never;

/** Actions with fresh IDs. */
export const actions = (...drafts: ReadonlyArray<Draft<Action>>): ReadonlyArray<Action> =>
  drafts.map((draft) => ({ ...draft, id: makeActionId() }) as Action);

/** A session whose cursor rests on the last action (the new call). */
export const stateOf = (
  log: ReadonlyArray<Action>,
  extra: {
    readonly pendingResults?: ReadonlyArray<Draft<PendingResult>>;
    readonly executions?: ReadonlyArray<Pick<Execution, 'handles' | 'tool'>>;
    readonly speakers?: SessionState['speakers'];
    readonly cursor?: number;
  } = {},
): SessionState => ({
  actions: log,
  cursor: extra.cursor ?? log.length - 1,
  generation: 'idle',
  playback: null,
  executions: (extra.executions ?? []).map((execution, index) => ({
    executionId: ExecutionId.make(`exec_${index}`),
    handles: execution.handles,
    tool: execution.tool,
    blocking: false,
    startedAt: 0,
  })),
  pendingResults: (extra.pendingResults ?? []).map(
    (draft) => ({ ...draft, id: makeActionId() }) as PendingResult,
  ),
  replay: null,
  start: null,
  speakers: extra.speakers ?? [{ id: 'host', name: 'Host' }],
  speech: { mimeType: 'audio/ogg' },
});

export const speak = (text: string, speaker = 'host') =>
  ({ type: 'speak', speaker, text }) as const;
export const user = (text: string) => ({ type: 'user_message', text }) as const;
export const context = (label: string, text: string) => ({ type: 'context', label, text }) as const;
export const interrupted = (during: 'speech' | 'wait') =>
  ({ type: 'interrupted', during }) as const;
export const toolCall = (handle: string, tool: string, input: Record<string, unknown>) =>
  ({ type: 'tool_call', handle, tool, input }) as Draft<Action>;
export const forwardCall = (handle: string) => toolCall(handle, forwardToolName, {});
export const result = (handles: ReadonlyArray<string>, tool: string, value: unknown) =>
  ({ type: 'tool_result', handles, tool, result: value }) as Draft<Action>;
export const errored = (handles: ReadonlyArray<string>, tool: string, message: string) =>
  ({ type: 'tool_errored', handles, tool, message }) as Draft<Action>;

// A fake worker type: each connection records the messages it reads and emits the events the test
// pushes. Nothing is spawned.

export interface FakeConnection {
  readonly worker: { readonly sessionId: string; readonly resume: boolean; readonly cwd: string };
  /** Messages the worker has read, in order. */
  readonly received: Effect.Effect<ReadonlyArray<WorkerMessage>>;
  readonly emit: (...events: ReadonlyArray<WorkerEvent>) => Effect.Effect<void>;
  readonly fail: (fault: ToolFault) => Effect.Effect<void>;
  readonly end: Effect.Effect<void>;
  /** Whether the connection's finalizer ran (the process was closed). */
  readonly closed: Effect.Effect<boolean>;
}

export const fakeWorkerType = (
  options: {
    readonly cwd?: string;
    readonly composeMessage?: (prompt: string, modifiers: ReadonlyArray<Modifier>) => string;
    readonly sessions?: Readonly<
      Record<string, { readonly cwd: string; readonly history: ReadonlyArray<TranscriptEntry> }>
    >;
  } = {},
) =>
  Effect.gen(function* () {
    const connections = yield* Ref.make<ReadonlyArray<FakeConnection>>([]);
    const type: WorkerType = {
      cwd: options.cwd ?? '/work',
      composeMessage: options.composeMessage ?? ((prompt) => prompt),
      attach: (sessionId) => {
        const session = options.sessions?.[sessionId];
        return session === undefined
          ? Effect.fail(new WorkerSetupError({ sessionId, reason: 'SessionNotFound' }))
          : Effect.succeed(session);
      },
      connect: (worker, input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const events = yield* Queue.unbounded<WorkerEvent, ToolFault | Cause.Done>();
            const received = yield* Ref.make<ReadonlyArray<WorkerMessage>>([]);
            const closed = yield* Ref.make(false);
            yield* Effect.addFinalizer(() => Ref.set(closed, true));
            yield* Effect.forkScoped(
              Stream.runForEach(input, (message) =>
                Ref.update(received, (all) => [...all, message]),
              ),
            );
            yield* Ref.update(connections, (all) => [
              ...all,
              {
                worker,
                received: Ref.get(received),
                emit: (...next) => Effect.asVoid(Queue.offerAll(events, next)),
                fail: (fault) => Effect.asVoid(Queue.fail(events, fault)),
                end: Effect.asVoid(Queue.end(events)),
                closed: Ref.get(closed),
              },
            ]);
            return Stream.fromQueue(events);
          }),
        ),
    };
    return { type, connections: Ref.get(connections) };
  });

/** A progress model that always describes the same activity. */
export const fakeModel = LanguageModel.make({
  generateText: () => Effect.die('progress streams'),
  streamText: () =>
    Stream.make({ type: 'text-delta' as const, id: 't', delta: 'Working through the plan.' }),
});

/** Polls `effect` until `done` holds, dying after a second. */
export const eventually = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  done: (value: A) => boolean,
) => {
  const origin = new Error('condition not reached within a second');
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const value = yield* effect;
      if (done(value)) return value;
      yield* Effect.sleep('1 millis');
    }
    return yield* Effect.die(origin);
  });
};
