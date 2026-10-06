/**
 * The effectful side of a Codex worker, with the app-server transport as a parameter so it can be
 * driven by synthetic frames. Internal: the `./codex` entry builds `codexWorker` from it.
 */
import { Effect, PubSub, Schema, Stream } from 'effect';

import { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import type { WorkerEvent, WorkerMessage } from '../worker.ts';
import type { OpenTransport } from './process.ts';
import { ThreadResponse, type Notification } from './protocol.ts';
import { initialize, isNotSteerable, makeRpc, type Rpc, type RpcFailure } from './rpc.ts';
import { initialTurnState, step, type TrackerOutput, type TurnState } from './turn.ts';

export interface ConnectOptions {
  /** A new thread's model; a resumed thread keeps its recorded one. */
  readonly model?: string | undefined;
  /** Sent with every message (Codex keeps it for later turns); levels vary by model. */
  readonly effort?: string | undefined;
}

export interface WorkerConnection {
  readonly cwd: string;
  /** The thread to continue; `undefined`: a new thread, whose ID Codex chooses. */
  readonly resume: string | undefined;
}

/** Auto permission mode, forced: Codex's reviewer answers approvals instead of a human. */
const approvals = { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' } as const;

/** The request that opens the worker's thread: a new one, or the stored one without a model. */
export const threadRequest = (
  options: ConnectOptions,
  worker: WorkerConnection,
): readonly [method: string, params: Readonly<Record<string, unknown>>] =>
  worker.resume === undefined
    ? [
        'thread/start',
        {
          cwd: worker.cwd,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...approvals,
        },
      ]
    : ['thread/resume', { threadId: worker.resume, cwd: worker.cwd, ...approvals }];

/**
 * One message as `turn/start`: it starts a turn when the thread is idle and joins the running one
 * otherwise. Codex echoes `clientUserMessageId` when the turn takes the message in.
 */
export const turnStartParams = (
  threadId: string,
  message: WorkerMessage,
  effort: string | undefined,
) => ({
  threadId,
  input: [{ type: 'text', text: message.text, text_elements: [] }],
  clientUserMessageId: message.id,
  ...(effort === undefined ? {} : { effort }),
});

/**
 * Sends one message. A running turn that cannot be steered (a review or compaction) holds it until
 * the next main-thread turn completes, then it is sent once more. Any other refusal, or a second
 * one, is a fault: a dropped message would leave the session waiting for its `Consumed`.
 *
 * A process that ends before replying is not this side's to report: sending stops for good, and
 * the notifications report `CodexExited` once every frame received before the end is processed.
 * Failing here would interrupt them and lose those frames.
 */
const sendMessage = (
  rpc: Rpc,
  completions: PubSub.PubSub<void>,
  params: ReturnType<typeof turnStartParams>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      // Subscribed before sending, so the completion that ends the refusing turn is not missed.
      const completed = yield* PubSub.subscribe(completions);
      const start = rpc.request('turn/start', params);
      yield* start.pipe(
        Effect.catchIf(isNotSteerable, () => PubSub.take(completed).pipe(Effect.andThen(start))),
      );
    }),
  ).pipe(
    Effect.catchTag('RpcClosed', () => Effect.never),
    Effect.mapError((_: RpcFailure) => new ToolFault({ reason: 'CodexMessageRejected' })),
  );

const isWorkerEvent = (output: TrackerOutput): output is WorkerEvent =>
  output._tag !== 'MainTurnCompleted';

/**
 * Notifications through the turn tracker, in order. A failure of `notifications` fails the stream
 * after every earlier notification is processed. Each main-thread turn completion is published to
 * `completions`, where a held message waits.
 */
export const runTracker = (
  notifications: Stream.Stream<Notification, ToolFault>,
  initial: TurnState,
  completions: PubSub.PubSub<void>,
): Stream.Stream<WorkerEvent, ToolFault> =>
  Stream.suspend(() => {
    let state = initial;
    return notifications.pipe(
      Stream.mapEffect((notification) => {
        const [next, outputs] = step(state, notification);
        state = next;
        const completed = outputs.some((output) => output._tag === 'MainTurnCompleted');
        return (completed ? PubSub.publish(completions, undefined) : Effect.void).pipe(
          Effect.as(outputs.filter(isWorkerEvent)),
        );
      }),
      Stream.flattenIterable,
    );
  });

/**
 * One worker process for as long as the stream is consumed: `initialize`, then `thread/start` (a
 * new thread, reported with `SessionStarted`) or `thread/resume`, then `input` as `turn/start`s, one
 * at a time and in order. Failing to start is `CodexStartup`; the end of the process is
 * `CodexExited`; a refused message is `CodexMessageRejected`. Interruption is teardown and records
 * nothing; the scope's release closes the process's stdin.
 */
export const connectWith =
  (open: OpenTransport, options: ConnectOptions) =>
  (
    worker: WorkerConnection,
    input: Stream.Stream<WorkerMessage>,
  ): Stream.Stream<WorkerEvent, ToolFault> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const startup = () => new ToolFault({ reason: 'CodexStartup' });
        const transport = yield* open.pipe(Effect.mapError(startup));
        const rpc = yield* makeRpc(transport);
        const [method, params] = threadRequest(options, worker);
        const { thread } = yield* initialize(rpc).pipe(
          Effect.andThen(rpc.request(method, params)),
          Effect.flatMap(Schema.decodeUnknownEffect(ThreadResponse)),
          Effect.mapError(startup),
        );
        const completions = yield* PubSub.unbounded<void>();
        // Starts only now: nothing is sent before the thread ID is known.
        const sending = Stream.fromEffect(
          Stream.runForEach(input, (message) =>
            sendMessage(rpc, completions, turnStartParams(thread.id, message, options.effort)),
          ),
        ).pipe(Stream.drain);
        const exited = new ToolFault({ reason: 'CodexExited' });
        const frames = Stream.merge(
          rpc.notifications.pipe(Stream.concat(Stream.fail(exited))),
          sending,
        );
        const started: Stream.Stream<WorkerEvent> =
          worker.resume === undefined
            ? Stream.make({ _tag: 'SessionStarted', sessionId: thread.id })
            : Stream.empty;
        return Stream.concat(started, runTracker(frames, initialTurnState(thread.id), completions));
      }),
    );
