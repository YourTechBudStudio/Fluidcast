/**
 * The effectful side of a Claude Code worker, with the SDK's `query` as a parameter so it can be
 * driven by synthetic frames. Internal: the `./claude` entry builds `claudeWorker` from it.
 */
import type {
  EffortLevel,
  Options,
  PermissionMode,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { Effect, FiberHandle, Queue, Stream } from 'effect';

import { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import type { WorkerEvent, WorkerMessage } from '../worker.ts';
import { initialTurnState, step, type TrackerInput, type TurnState } from './turn.ts';

/** What the adapter needs of the SDK's `query`: frames to iterate, and a way to close them. */
export type QueryFunction = (params: {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: Options;
}) => AsyncIterable<SDKMessage> & { readonly close: () => void };

export interface ConnectOptions {
  /**
   * The installed `claude` executable, absolute: the SDK checks that it exists. Required, so the SDK
   * never falls back to its bundled one.
   */
  readonly executable: string;
  readonly model?: string | undefined;
  readonly effort?: EffortLevel | undefined;
  readonly permissionMode?: PermissionMode | undefined;
  /** The whole worker environment: the SDK replaces the process environment, never merges. */
  readonly environment: Readonly<Record<string, string | undefined>>;
}

export interface WorkerConnection {
  readonly cwd: string;
  /** The session to continue; `undefined`: a new session, whose ID Claude Code chooses. */
  readonly resume: string | undefined;
}

/** The query options of one worker. */
export const queryOptions = (options: ConnectOptions, worker: WorkerConnection): Options => ({
  cwd: worker.cwd,
  pathToClaudeCodeExecutable: options.executable,
  ...(worker.resume === undefined ? {} : { resume: worker.resume }),
  ...(options.model === undefined ? {} : { model: options.model }),
  ...(options.effort === undefined ? {} : { effort: options.effort }),
  permissionMode: options.permissionMode ?? 'auto',
  settingSources: ['user', 'project', 'local'],
  disallowedTools: ['AskUserQuestion'],
  forwardSubagentText: true,
  agentProgressSummaries: true,
  env: {
    ...options.environment,
    // Session state events carry the authoritative `idle`; startup failure results name known
    // startup failures instead of ending with stderr alone.
    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
    CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1',
  },
});

/** An ordinary user message with default priority: it folds into a running turn. */
const userMessage = ({ id, text }: WorkerMessage): SDKUserMessage => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
  // The pool's message IDs are UUIDs.
  uuid: id as NonNullable<SDKUserMessage['uuid']>,
});

/**
 * The frames without the iterator's `return`. Effect awaits `return()` when the stream closes, and
 * an async generator's `return()` waits behind a pending `next()`, so an idle worker would hang
 * teardown. `close()` in the query's release is the teardown instead.
 */
const readOnly = <A>(iterable: AsyncIterable<A>): AsyncIterable<A> => ({
  [Symbol.asyncIterator]: () => {
    const iterator = iterable[Symbol.asyncIterator]();
    return { next: () => iterator.next() };
  },
});

const graceDelay = '1 second';

/**
 * Frames through the turn tracker, one input at a time: one processing fiber over one queue of
 * frames and elapsed grace timers, the timer in a `FiberHandle`. A failure of `frames` (the
 * process ended or crashed) fails the stream after every earlier frame is processed; a fault a
 * frame reports fails it at once.
 */
export const runTracker = (
  frames: Stream.Stream<SDKMessage, ToolFault>,
  initial: TurnState,
): Stream.Stream<WorkerEvent, ToolFault> =>
  Stream.callback<WorkerEvent, ToolFault>((events) =>
    Effect.gen(function* () {
      const inputs = yield* Queue.unbounded<
        TrackerInput | { readonly _tag: 'Ended'; readonly fault: ToolFault }
      >();
      const timer = yield* FiberHandle.make<void, never>();
      yield* frames.pipe(
        Stream.runForEach((frame) => Queue.offer(inputs, { _tag: 'Frame', frame })),
        Effect.catch((fault) => Queue.offer(inputs, { _tag: 'Ended', fault })),
        Effect.forkScoped,
      );

      const loop = (state: TurnState): Effect.Effect<void> =>
        Effect.gen(function* () {
          const input = yield* Queue.take(inputs);
          if (input._tag === 'Ended') return yield* Queue.fail(events, input.fault);
          const [next, outputs] = step(state, input);
          for (const output of outputs) {
            switch (output._tag) {
              case 'StartGrace':
                yield* FiberHandle.run(
                  timer,
                  Effect.sleep(graceDelay).pipe(
                    Effect.andThen(
                      Queue.offer(inputs, { _tag: 'GraceElapsed', grace: output.grace }),
                    ),
                    Effect.asVoid,
                  ),
                );
                break;
              case 'CancelGrace':
                yield* FiberHandle.clear(timer);
                break;
              case 'Fault':
                return yield* Queue.fail(events, output.fault);
              default:
                yield* Queue.offer(events, output);
            }
          }
          return yield* loop(next);
        });
      yield* loop(initial);
    }),
  );

/**
 * One worker process for as long as the stream is consumed. Its input is `input` as ordinary user
 * messages; the scope's release closes the query. The end of the frames is a crash
 * (`ClaudeExited`); interruption is teardown and records nothing. `interrupt()` and
 * `backgroundTasks()` are never used.
 */
export const connectWith =
  (query: QueryFunction, options: ConnectOptions) =>
  (
    worker: WorkerConnection,
    input: Stream.Stream<WorkerMessage>,
  ): Stream.Stream<WorkerEvent, ToolFault> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const prompt = Stream.toAsyncIterable(input.pipe(Stream.map(userMessage)));
        const frames = yield* Effect.acquireRelease(
          Effect.try({
            try: () => query({ prompt, options: queryOptions(options, worker) }),
            catch: () => new ToolFault({ reason: 'ClaudeStartup' }),
          }),
          (opened) => Effect.sync(() => opened.close()),
        );
        const exited = () => new ToolFault({ reason: 'ClaudeExited' });
        return runTracker(
          Stream.fromAsyncIterable(readOnly(frames), exited).pipe(
            Stream.concat(Stream.fail(exited())),
          ),
          initialTurnState(worker.resume === undefined),
        );
      }),
    );
