import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  FiberSet,
  Layer,
  Queue,
  Ref,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import {
  makeActionId,
  uuidv7,
  type Action,
  type ToolCall,
  type ToolFaulted,
} from '@yourtechbudstudio/fluidcast-core/actions';
import { checkTools, decodeToolCall, generate } from '@yourtechbudstudio/fluidcast-core/generation';
import {
  audioMimeType,
  SpeechSynthesizer,
  synthesize,
  type SpeechError,
} from '@yourtechbudstudio/fluidcast-core/speech';

import { ToolError, ToolFault, type Tool } from '../tool.ts';
import type { SessionConfig } from './config.ts';
import {
  describeFailure,
  describeFault,
  failureAnnotations,
  unexpectedFailure,
} from './failure.ts';
import {
  backTarget,
  blockingExecution,
  CommandRejected,
  currentAction,
  derivePhase,
  effectiveActions,
  ExecutionId,
  isHalted,
  PlaybackId,
  reduce,
  SpeechNotFound,
  ToolCommandRejected,
  type Command,
  type SessionEvent,
  type SessionState,
  type SubscriptionMessage,
} from './protocol.ts';

/**
 * The single-session conversation authority (ADRs 0003, 0006): the action log, the cursor,
 * playback identity, generation, tool execution, and the one subscription.
 */
export class Session extends Context.Service<
  Session,
  {
    /**
     * A snapshot followed by every later event, with no gap. There is one subscriber: subscribing
     * again sends `Superseded` to the previous subscription and ends it. While nobody is subscribed
     * no playback is requested or acknowledged, so the cursor stays on its speak, and completed tool
     * outcomes wait to be submitted.
     */
    readonly subscribe: () => Stream.Stream<SubscriptionMessage>;
    /** Applies one command. Commands are applied one at a time. */
    readonly command: (
      command: Command,
    ) => Effect.Effect<void, CommandRejected | ToolCommandRejected>;
    /** Streams the audio for any speak currently in the log, queued or played. */
    readonly speech: (actionId: string) => Stream.Stream<Uint8Array, SpeechNotFound | SpeechError>;
  }
>()('@yourtechbudstudio/fluidcast-harness/Session') {}

type Subscriber = Queue.Queue<SubscriptionMessage, Cause.Done>;

/** The live side of an open execution, kept in step with `state.executions`. */
interface Running {
  readonly tool: Tool;
  readonly handle: string;
  /** `tool.command?.(input)`, resolved once when the execution started; absent after a failed setup. */
  readonly accepts: Schema.Codec<unknown, Schema.Json> | undefined;
  readonly commands: Queue.Queue<unknown>;
}

/** How long continuation waits for more outcomes before submitting them together. */
const batchWindow = Duration.millis(200);

/**
 * Whether queued outcomes should be submitted now, without user input: someone is there to hear
 * the answer, nothing is playing, generating or holding, and no interrupt left them for the user's
 * next message. Agrees with `derivePhase`: whenever this holds, the phase is `waiting`.
 */
const ready = (state: SessionState, subscribed: boolean): boolean =>
  subscribed &&
  !isHalted(state) &&
  state.generation === 'idle' &&
  state.replay === null &&
  state.cursor === state.actions.length &&
  blockingExecution(state) === undefined &&
  state.pendingResults.length > 0 &&
  state.actions.at(-1)?.type !== 'interrupted';

/**
 * Builds a session in the current scope. Also returns `state`, which the Layer does not expose, so
 * tests can observe a session that has no subscriber.
 */
export const make = (config: SessionConfig) =>
  Effect.gen(function* () {
    checkTools(config.tools);
    const languageModel = yield* LanguageModel.LanguageModel;
    const synthesizer = yield* SpeechSynthesizer;

    // One lock serialises commands, generation appends, execution outcomes and subscription
    // changes. Every event is applied to `state` and offered to the subscriber inside it, so both
    // see the same order.
    const lock = yield* Semaphore.make(1);
    const state = yield* Ref.make<SessionState>({
      actions: [],
      cursor: 0,
      generation: 'idle',
      playback: null,
      executions: [],
      pendingResults: [],
      replay: null,
      speakers: config.speakers.map(({ id, name }) => ({ id, name })),
      speech: { mimeType: audioMimeType[config.speechFormat] },
    });
    const subscriber = yield* Ref.make<Subscriber | undefined>(undefined);
    const generation = yield* FiberHandle.make<void, never>();
    // Executions end on their own or with the session scope; nothing cancels one by key.
    const executions = yield* FiberSet.make<void, never>();
    // Set when the session scope starts closing. Finalizers run in reverse order, so this is set
    // before the execution set interrupts its fibers: only then is an interrupted execution teardown.
    let closing = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closing = true;
      }),
    );
    const continuation = yield* FiberHandle.make<void, never>();
    // Monotonic: trimmed handles are never reused.
    const nextHandle = yield* Ref.make(0);
    const running = new Map<ExecutionId, Running>();
    const profiles = config.speakers.map(({ id, name, personality }) => ({
      id,
      name,
      personality,
    }));
    const speakers = new Map(config.speakers.map((speaker) => [speaker.id, speaker]));
    const toolNamed = (name: string) => config.tools.find((tool) => tool.name === name);

    /**
     * Runs `effect` under the lock and re-evaluates continuation before releasing it, so no
     * locked change can leave queued outcomes without a pending submission.
     */
    const transact = <A, E>(effect: Effect.Effect<A, E>) =>
      lock.withPermits(1)(Effect.tap(effect, () => scheduleContinuation));

    // The helpers below run only while holding the lock.

    /** Applies the event with the shared reducer and delivers it to the subscriber, if any. */
    const emit = (event: SessionEvent) =>
      Effect.gen(function* () {
        yield* Ref.update(state, (current) => reduce(current, event));
        const queue = yield* Ref.get(subscriber);
        if (queue !== undefined) yield* Queue.offer(queue, event);
      });

    const append = (action: Action) => emit({ _tag: 'ActionAppended', action });

    const subscribed = Effect.map(Ref.get(subscriber), (queue) => queue !== undefined);

    /** Requests playback of the presented speak under a fresh playback ID. */
    const requestPlayback = Effect.gen(function* () {
      const current = currentAction(yield* Ref.get(state));
      if (current?.type !== 'speak') return;
      yield* emit({
        _tag: 'PlaybackRequested',
        playbackId: PlaybackId.make(uuidv7()),
        actionId: current.id,
      });
    });

    /** Requests playback of the presented speak if it has none outstanding and someone can play it. */
    const keepPlaying = Effect.gen(function* () {
      const current = yield* Ref.get(state);
      const action = currentAction(current);
      if (action === undefined || current.playback?.actionId === action.id) return;
      if (yield* subscribed) yield* requestPlayback;
    });

    /**
     * Brings the presentation up to date after an append, a cursor move or the end of a replay.
     * While replaying, the frontier holds: only the replayed speak's playback is kept requested.
     */
    const settle = Effect.gen(function* () {
      const current = yield* Ref.get(state);
      if (current.replay !== null) return yield* keepPlaying;
      yield* settleFrom(current.cursor);
    });

    /**
     * Moves the cursor from `from` past instant actions, reaching each tool call on the way with
     * its own `CursorMoved` before it starts (ADR 0002), then requests playback of the speak it
     * rests on. A call just appended at the cursor is already reached by its append.
     */
    const settleFrom = (from: number) =>
      Effect.gen(function* () {
        let position = from;
        for (;;) {
          const current = yield* Ref.get(state);
          while (
            position < current.actions.length &&
            current.actions[position]?.type !== 'speak' &&
            current.actions[position]?.type !== 'tool_call'
          ) {
            position++;
          }
          if (position !== current.cursor) yield* emit({ _tag: 'CursorMoved', cursor: position });
          const action = current.actions[position];
          if (action?.type !== 'tool_call') break;
          yield* reach(action, 'first');
          position++;
        }
        yield* keepPlaying;
      });

    // Tool execution

    /**
     * Starts the call the cursor (`first`) or forward replay (`replay`) has just reached. On the
     * first pass an invalid call queues an error for the model to fix, whatever the policy. On
     * replay only replay-enabled tools execute again.
     */
    const reach = (call: ToolCall, pass: 'first' | 'replay') =>
      Effect.gen(function* () {
        if (pass === 'replay' && toolNamed(call.tool)?.policy.replay !== true) return;
        const decoded = decodeToolCall(config.tools, call);
        if (Result.isSuccess(decoded)) {
          return yield* startExecution(decoded.success.tool, decoded.success.input, call.handle);
        }
        if (pass === 'replay') return;
        yield* emit({
          _tag: 'ResultQueued',
          result: {
            type: 'tool_errored',
            id: makeActionId(),
            handle: call.handle,
            tool: call.tool,
            message: decoded.failure,
          },
        });
        // The tool name the model wrote is not logged: it is model output, not an identifier.
        yield* Effect.logInfo('tool call invalid').pipe(
          Effect.annotateLogs({ handle: call.handle }),
        );
      });

    /**
     * Opens one execution and forks it. It never fails or throws: any defect, in setup, in `run` or
     * in its result, reaches `finish` in the execution's own fiber, which can halt safely because it
     * is neither the generation fiber nor a command.
     */
    const startExecution = (tool: Tool, input: unknown, handle: string) =>
      Effect.gen(function* () {
        const executionId = ExecutionId.make(uuidv7());
        const commands = yield* Queue.unbounded<unknown>();
        let accepts: Running['accepts'];
        let body: Effect.Effect<unknown, ToolError | ToolFault>;
        try {
          accepts = tool.command?.(input);
          body = Effect.suspend(() =>
            tool.run(input, { handle, awaitCommand: Queue.take(commands) }),
          );
        } catch (defect) {
          accepts = undefined;
          body = Effect.die(defect);
        }
        running.set(executionId, { tool, handle, accepts, commands });
        yield* emit({
          _tag: 'ToolStarted',
          executionId,
          handle,
          tool: tool.name,
          blocking: tool.policy.blocking,
        });
        yield* Effect.logInfo('tool started').pipe(
          Effect.annotateLogs({ tool: tool.name, handle }),
        );
        yield* FiberSet.run(
          executions,
          body.pipe(
            Effect.exit,
            Effect.flatMap((exit) =>
              // Teardown: the session scope is closing and nothing is left to record. A tool that
              // interrupts itself while the session is open is a defect, recorded by `finish`.
              Exit.hasInterrupts(exit) && closing
                ? Effect.void
                : transact(finish(executionId, exit)),
            ),
          ),
        );
      });

    /**
     * Records an execution's outcome by its tool's policy. A model-visible result is read exactly
     * as history will read it before it is queued, so a broken result halts now rather than failing
     * a later generation. Outcomes after a halt are dropped.
     */
    const finish = (executionId: ExecutionId, exit: Exit.Exit<unknown, ToolError | ToolFault>) =>
      Effect.gen(function* () {
        const entry = running.get(executionId);
        if (entry === undefined) return;
        running.delete(executionId);
        const { tool, handle } = entry;
        let outcome: string;
        if (isHalted(yield* Ref.get(state))) {
          outcome = 'dropped';
        } else if (Exit.isSuccess(exit)) {
          outcome = 'result';
          if (tool.policy.response === 'all') {
            const read = readResult(tool, exit.value);
            if (Result.isSuccess(read)) {
              yield* emit({
                _tag: 'ResultQueued',
                result: {
                  type: 'tool_result',
                  id: makeActionId(),
                  handle,
                  tool: tool.name,
                  result: read.success,
                },
              });
            } else {
              outcome = 'UnexpectedError';
              yield* halt(tool, handle, describeFault(tool.name, undefined));
            }
          }
        } else if (Cause.hasDies(exit.cause) || Cause.hasInterrupts(exit.cause)) {
          // A defect or a self-interruption anywhere in the cause, even beside an expected error.
          outcome = 'UnexpectedError';
          yield* halt(tool, handle, describeFault(tool.name, undefined));
        } else {
          // Every expected failure in the cause: a fault anywhere halts, even beside a `ToolError`.
          const errors = exit.cause.reasons
            .filter(Cause.isFailReason)
            .map((reason) => reason.error);
          const fault = errors.find((error) => error instanceof ToolFault);
          const error = errors.find((candidate) => candidate instanceof ToolError);
          if (fault === undefined && error !== undefined) {
            outcome = error._tag;
            if (tool.policy.response !== 'none') {
              yield* emit({
                _tag: 'ResultQueued',
                result: {
                  type: 'tool_errored',
                  id: makeActionId(),
                  handle,
                  tool: tool.name,
                  message: error.message,
                },
              });
            }
          } else {
            outcome = fault?._tag ?? 'UnexpectedError';
            yield* halt(tool, handle, describeFault(tool.name, fault));
          }
        }
        // After any `ResultQueued`, so no event prefix reads as a finished turn.
        yield* emit({ _tag: 'ToolCompleted', executionId });
        yield* Effect.logInfo('tool completed').pipe(
          Effect.annotateLogs({ tool: tool.name, handle, outcome }),
        );
      });

    // Stopping

    /**
     * Stops presentation and generation, shared by Interrupt and halt so the two cannot drift:
     * ends a replay, trims what never took effect, appends `action` and moves the cursor to the end,
     * which clears playback. Running executions continue (ADR 0008). An unreached tool call at the
     * cursor (appended there during a replay) never took effect, so it is trimmed too.
     */
    const stop = (action: Action) =>
      Effect.gen(function* () {
        // Waits for the iteration to end. Its appends wait on the lock interruptibly, so an
        // interrupted iteration can never append.
        yield* FiberHandle.clear(generation);
        const current = yield* Ref.get(state);
        if (current.replay !== null) yield* emit({ _tag: 'ReplayMoved', replay: null });
        // Also clears a failure whose buffered lines were still playing.
        if (current.generation !== 'idle') {
          yield* emit({ _tag: 'GenerationChanged', generation: 'idle' });
        }
        const keep =
          current.actions[current.cursor]?.type === 'tool_call'
            ? current.cursor
            : current.cursor + 1;
        if (keep < current.actions.length) yield* emit({ _tag: 'ActionsTrimmed', from: keep });
        yield* append(action);
        const end = (yield* Ref.get(state)).actions.length;
        yield* emit({ _tag: 'CursorMoved', cursor: end });
      });

    /** Halts the conversation for good (until a future Reset): no further generation. */
    const halt = (tool: Tool, handle: string, error: ToolFaulted['error']) =>
      Effect.gen(function* () {
        yield* stop({ type: 'tool_faulted', id: makeActionId(), handle, error });
        yield* Effect.logWarning('tool faulted').pipe(
          Effect.annotateLogs({ tool: tool.name, handle, error: error.tag }),
        );
      });

    // Generation

    /** One iteration: appends each parsed action as it arrives, or a failure after them. */
    const iterate = (history: ReadonlyArray<Action>) =>
      generate({
        instructions: config.instructions,
        speakers: profiles,
        history,
        tools: config.tools,
      }).pipe(
        Stream.runForEach((element) =>
          transact(
            Effect.gen(function* () {
              if (element.type === 'speak') {
                yield* append(element);
              } else {
                const number = yield* Ref.updateAndGet(nextHandle, (last) => last + 1);
                const { id, tool, input } = element;
                yield* append({ type: 'tool_call', id, handle: `call_${number}`, tool, input });
              }
              yield* settle;
            }),
          ),
        ),
        // A defect must still end the iteration truthfully rather than leave it running forever.
        Effect.catchDefect(() => Effect.fail(unexpectedFailure)),
        Effect.matchEffect({
          onSuccess: () => transact(emit({ _tag: 'GenerationChanged', generation: 'idle' })),
          onFailure: (error) =>
            transact(
              Effect.gen(function* () {
                yield* Effect.logWarning('generation failed').pipe(
                  Effect.annotateLogs(failureAnnotations(error)),
                );
                yield* append({
                  type: 'generation_failed',
                  id: makeActionId(),
                  error: describeFailure(error),
                });
                yield* settle;
                yield* emit({ _tag: 'GenerationChanged', generation: 'failed' });
              }),
            ),
        }),
        Effect.provideService(LanguageModel.LanguageModel, languageModel),
      );

    /**
     * Starts another iteration: the only submission path for a message, a retry and continuation,
     * so a queued outcome is submitted exactly once, before any new input. `running` comes first,
     * so no event prefix reads as a finished turn.
     */
    const beginIteration = (text?: string) =>
      Effect.gen(function* () {
        yield* emit({ _tag: 'GenerationChanged', generation: 'running' });
        if ((yield* Ref.get(state)).pendingResults.length > 0) {
          yield* emit({ _tag: 'ResultsSubmitted' });
        }
        if (text !== undefined) {
          yield* append({ type: 'user_message', id: makeActionId(), text });
        }
        yield* settle;
        const history = effectiveActions(yield* Ref.get(state));
        yield* FiberHandle.run(generation, iterate(history));
      });

    // Continuation

    /** Submits queued outcomes if the session is still ready once the batch window has passed. */
    const submitIfReady = Effect.gen(function* () {
      if (ready(yield* Ref.get(state), yield* subscribed)) yield* beginIteration();
    });

    /**
     * Runs at the end of every locked operation. Each time the session is ready, the timer
     * restarts: a timer started only when missing could be skipped by one that has already
     * released the lock but not yet exited. The timer never replaces itself, because its own
     * submission leaves the session not ready.
     */
    const scheduleContinuation: Effect.Effect<void> = Effect.suspend(() =>
      Effect.gen(function* () {
        if (!ready(yield* Ref.get(state), yield* subscribed)) return;
        yield* FiberHandle.run(
          continuation,
          Effect.sleep(batchWindow).pipe(Effect.andThen(transact(submitIfReady))),
        );
      }),
    );

    // Back and forward replay

    /**
     * Steps forward replay after its speak finished: re-executes each replay-enabled call up to the
     * next speak, reaching each first, then plays that speak, or ends the replay at the frontier.
     */
    const advanceReplay = (from: number) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        let position = from + 1;
        while (position < current.cursor && current.actions[position]?.type !== 'speak') {
          const action = current.actions[position];
          if (action?.type === 'tool_call' && toolNamed(action.tool)?.policy.replay === true) {
            yield* emit({ _tag: 'ReplayMoved', replay: position });
            yield* reach(action, 'replay');
          }
          position++;
        }
        if (position >= current.cursor) {
          yield* emit({ _tag: 'ReplayMoved', replay: null });
          // Handles anything the frontier held, and replays the cursor speak from its start.
          yield* settle;
        } else {
          yield* emit({ _tag: 'ReplayMoved', replay: position });
          if (yield* subscribed) yield* requestPlayback;
        }
      });

    // Commands

    const reject = (command: CommandRejected['command'], current: SessionState) =>
      Effect.fail(new CommandRejected({ command, phase: derivePhase(current) }));

    const apply = (command: Command): Effect.Effect<void, CommandRejected | ToolCommandRejected> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const phase = derivePhase(current);
        switch (command._tag) {
          case 'SendMessage': {
            if (phase !== 'idle' && phase !== 'generationFailed') {
              return yield* reject(command._tag, current);
            }
            return yield* beginIteration(command.text);
          }
          case 'RetryGeneration': {
            if (phase !== 'generationFailed') return yield* reject(command._tag, current);
            return yield* beginIteration();
          }
          case 'PlaybackFinished': {
            // Stale by identity, or nobody is subscribed: the cursor stays frozen (ADR 0003).
            if (current.playback?.playbackId !== command.playbackId) return;
            if (!(yield* subscribed)) return;
            if (current.replay !== null) return yield* advanceReplay(current.replay);
            return yield* settleFrom(current.cursor + 1);
          }
          case 'Interrupt': {
            // Ignored, not rejected: the listener must answer a blocking tool.
            if (blockingExecution(current) !== undefined) return;
            // Stops listening to an old line first; the frontier's own phase decides the rest.
            const endedReplay = current.replay !== null;
            if (endedReplay) yield* emit({ _tag: 'ReplayMoved', replay: null });
            const frontier = yield* Ref.get(state);
            const frontierPhase = derivePhase(frontier);
            if (frontierPhase !== 'speaking' && frontierPhase !== 'waiting') {
              if (endedReplay) return;
              return yield* reject(command._tag, frontier);
            }
            return yield* stop({ type: 'interrupted', id: makeActionId() });
          }
          case 'Back': {
            const target = backTarget(current);
            if (phase === 'halted' || target === undefined) {
              return yield* reject(command._tag, current);
            }
            yield* emit({ _tag: 'ReplayMoved', replay: target });
            if (yield* subscribed) yield* requestPlayback;
            return;
          }
          case 'ToolCommand': {
            if (phase === 'halted') return yield* reject(command._tag, current);
            const entry = running.get(command.executionId);
            const rejectTool = (reason: ToolCommandRejected['reason']) =>
              Effect.fail(new ToolCommandRejected({ executionId: command.executionId, reason }));
            if (entry === undefined || entry.handle !== command.handle) {
              return yield* rejectTool('stale');
            }
            if (entry.accepts === undefined) return yield* rejectTool('invalid');
            const decoded = Schema.decodeUnknownExit(entry.accepts)(command.payload);
            if (Exit.isFailure(decoded)) return yield* rejectTool('invalid');
            yield* Queue.offer(entry.commands, decoded.value);
            return;
          }
        }
      });

    // Subscription

    const register = transact(
      Effect.gen(function* () {
        const queue: Subscriber = yield* Queue.unbounded<SubscriptionMessage, Cause.Done>();
        const previous = yield* Ref.getAndSet(subscriber, queue);
        if (previous !== undefined) {
          yield* Queue.offer(previous, { _tag: 'Superseded' });
          yield* Queue.end(previous);
        }
        yield* Queue.offer(queue, { _tag: 'Snapshot', state: yield* Ref.get(state) });
        // Replays the presented line from its start under a new playback ID.
        yield* requestPlayback;
        return queue;
      }),
    );

    const unregister = (queue: Subscriber) =>
      transact(Ref.update(subscriber, (current) => (current === queue ? undefined : current)));

    const service: Session['Service'] = {
      subscribe: () =>
        Stream.unwrap(Effect.map(Effect.acquireRelease(register, unregister), Stream.fromQueue)),
      command: (command) => transact(apply(command)),
      speech: (actionId) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const action = (yield* Ref.get(state)).actions.find((entry) => entry.id === actionId);
            if (action?.type !== 'speak') return yield* new SpeechNotFound({ actionId });
            const speaker = speakers.get(action.speaker);
            // Core rejects speakers that are not configured, so this cannot happen.
            if (speaker === undefined)
              return yield* Effect.die('speak action has an unknown speaker');
            return synthesize({
              text: action.text,
              voice: speaker.voice,
              format: config.speechFormat,
            }).pipe(Stream.provideService(SpeechSynthesizer, synthesizer));
          }),
        ),
    };

    return { service, state: Ref.get(state) };
  });

/**
 * Encodes a result with its tool's schema, then reads it back exactly as history will (decode,
 * then `renderResult`). A failure or throw anywhere is the tool's defect.
 */
const readResult = (tool: Tool, result: unknown): Result.Result<Schema.Json, unknown> => {
  try {
    const encoded = Schema.encodeUnknownSync(tool.result)(result);
    tool.renderResult(Schema.decodeUnknownSync(tool.result)(encoded));
    return Result.succeed(encoded);
  } catch (defect) {
    return Result.fail(defect);
  }
};

/** The session as a Layer. It needs a `LanguageModel` and a `SpeechSynthesizer`. */
export const layer = (
  config: SessionConfig,
): Layer.Layer<Session, never, LanguageModel.LanguageModel | SpeechSynthesizer> =>
  Layer.effect(
    Session,
    Effect.map(make(config), ({ service }) => service),
  );
