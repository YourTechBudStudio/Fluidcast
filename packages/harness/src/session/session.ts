import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  FiberSet,
  Layer,
  Option,
  Queue,
  Ref,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { LanguageModel } from 'effect/ai';

import {
  makeActionId,
  uuidv7,
  type Action,
  type ActionId,
  type ToolCall,
  type ToolFaulted,
  type Speak,
  type ToolProgress,
  type UserMessage,
} from '@yourtechbudstudio/fluidcast-core/actions';
import {
  checkTools,
  decodeToolCall,
  defaultSummaryPrompt,
  generate,
  summarize,
  type GenerateOptions,
  type GenerationError,
  type GenerationUsage,
  type ReplyEnded,
  type ToolCallDraft,
} from '@yourtechbudstudio/fluidcast-core/generation';
import {
  audioMimeType,
  SpeechSynthesizer,
  synthesize,
  type SpeechError,
} from '@yourtechbudstudio/fluidcast-core/speech';

import { SummaryModel } from '../summary-model.ts';
import { ToolError, ToolFault, type Tool } from '../tool.ts';
import { defaultCompactionThreshold, type SessionConfig } from './config.ts';
import { answersProgress, episodeStart, modelView, summarySlice } from './conversation.ts';
import {
  describeFailure,
  describeFault,
  failureAnnotations,
  unexpectedFailure,
} from './failure.ts';
import {
  backTarget,
  blockingExecution,
  canAdvance,
  canSend,
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
  type PendingCall,
  type SessionEvent,
  type SessionState,
  type SubscriptionMessage,
} from './protocol.ts';

/**
 * The single-session conversation authority (ADRs 0001, 0002): the action log, the cursor,
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

/** The live side of an open execution, kept in step with `state.executions`, which holds its handles. */
interface Running {
  readonly tool: Tool;
  /** `tool.command?.(input)`, resolved once when the execution started; absent after a failed setup. */
  readonly accepts: Schema.Codec<unknown, Schema.Json> | undefined;
  readonly commands: Queue.Queue<unknown>;
  /** The execution's fiber, once forked: interrupted when an Interrupt cancels a blocking execution. */
  fiber?: Fiber.Fiber<void, never>;
}

/** How long continuation waits for more outcomes before submitting them together. */
const batchWindow = Duration.millis(200);

/**
 * Whether queued outcomes or kept progress should be submitted now, without user input: someone is
 * there to hear the answer, nothing is paused, playing, generating or holding, and no interrupt left
 * them for the user's next message. Gates automatic continuation only: commands that start an
 * iteration validate on their own. Agrees with `derivePhase`: whenever this holds, the phase is
 * `working`.
 */
const ready = (state: SessionState, subscribed: boolean): boolean =>
  subscribed &&
  !state.paused &&
  !isHalted(state) &&
  state.generation === 'idle' &&
  state.replay === null &&
  state.cursor === state.actions.length &&
  blockingExecution(state) === undefined &&
  (state.pendingResults.length > 0 || state.pendingProgress.length > 0) &&
  state.actions.at(-1)?.type !== 'interrupted';

/**
 * Whether a progress update can be used now: someone is there, nothing is paused, playing, queued,
 * generating or holding, and the user has not interrupted to speak. Unlike `ready`, it needs no
 * pending result.
 */
const progressAllowed = (state: SessionState, subscribed: boolean): boolean =>
  subscribed &&
  !state.paused &&
  !isHalted(state) &&
  state.generation === 'idle' &&
  state.replay === null &&
  state.cursor === state.actions.length &&
  state.pendingResults.length === 0 &&
  blockingExecution(state) === undefined &&
  state.actions.at(-1)?.type !== 'interrupted';

/**
 * Builds a session in the current scope. Also returns `state`, which the Layer does not expose, so
 * tests can observe a session that has no subscriber.
 */
export const make = (config: SessionConfig) =>
  Effect.gen(function* () {
    checkTools(config.tools, config.examples);
    for (const tool of config.tools) {
      // A replayed call would be assigned again under a new execution that no outcome can join.
      if (tool.assign !== undefined && tool.policy.replay) {
        throw new Error(`Tool "${tool.name}" assigns calls, so it must not replay`);
      }
    }
    const preloaded = config.start;
    if (
      preloaded !== undefined &&
      (preloaded.message.trim() === '' ||
        preloaded.context?.label.trim() === '' ||
        preloaded.call?.label.trim() === '')
    ) {
      throw new Error('A preloaded start needs a message, and a label for its context and call');
    }
    const preloadedCall =
      preloaded?.call === undefined ? null : answeredCall(config.tools, preloaded.call);
    const languageModel = yield* LanguageModel.LanguageModel;
    const summaryModel = Option.getOrElse(
      yield* Effect.serviceOption(SummaryModel),
      () => languageModel,
    );
    const synthesizer = yield* SpeechSynthesizer;
    const compactionConfig = config.history?.compaction;
    const compaction =
      compactionConfig?.enabled === true
        ? {
            aboveInputTokens: compactionConfig.aboveInputTokens ?? defaultCompactionThreshold,
            prompt: compactionConfig.prompt ?? defaultSummaryPrompt,
          }
        : undefined;

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
      pendingProgress: [],
      replay: null,
      // Its action IDs are assigned once, so the preloaded message keeps its ID in the log.
      start:
        preloaded === undefined
          ? null
          : {
              message: { type: 'user_message', id: makeActionId(), text: preloaded.message },
              context:
                preloaded.context === undefined
                  ? null
                  : { type: 'context', id: makeActionId(), ...preloaded.context },
              call: preloadedCall,
            },
      started: null,
      paused: false,
      speakers: config.speakers.map(({ id, name }) => ({ id, name })),
      speech: { mimeType: audioMimeType[config.speechFormat] },
    });
    const subscriber = yield* Ref.make<Subscriber | undefined>(undefined);
    const generation = yield* FiberHandle.make<void, never>();
    // Executions end on their own, with the session scope, or (blocking ones) by an Interrupt.
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
    // Generations reading on after their reply for its usage, and the one summary in flight. Both
    // live in the session scope, so closing it interrupts them.
    const drains = yield* FiberSet.make<void, never>();
    const summarizing = yield* FiberHandle.make<void, never>();
    // The summary in flight, by the episode it starts, and the one ready for the next iteration.
    let summaryFrom: ActionId | undefined;
    let summaryReady: { readonly from: ActionId; readonly text: string } | undefined;
    // Monotonic: trimmed handles are never reused. A preloaded call holds `call_1`.
    const nextHandle = yield* Ref.make(preloadedCall === null ? 0 : 1);
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

    /**
     * Requests playback of the presented speak under a fresh playback ID. The one place playback is
     * authorized: never while paused, or with nobody subscribed to play it.
     */
    const requestPlayback = Effect.gen(function* () {
      const latest = yield* Ref.get(state);
      const current = currentAction(latest);
      if (current?.type !== 'speak' || latest.paused || !(yield* subscribed)) return;
      yield* emit({
        _tag: 'PlaybackRequested',
        playbackId: PlaybackId.make(uuidv7()),
        actionId: current.id,
      });
    });

    /** Requests playback of the presented speak if it has none outstanding. */
    const keepPlaying = Effect.gen(function* () {
      const current = yield* Ref.get(state);
      const action = currentAction(current);
      if (action === undefined || current.playback?.actionId === action.id) return;
      yield* requestPlayback;
    });

    /**
     * Brings the presentation up to date on its own, after an append or a new iteration's input.
     * While paused nothing moves: an action appended at the end-of-log cursor rests there, a tool
     * call unreached, until `Play` or `Next`. While replaying, the frontier holds: only the replayed
     * speak's playback is kept requested.
     */
    const settle = Effect.gen(function* () {
      const current = yield* Ref.get(state);
      if (current.paused) return;
      if (current.replay !== null) return yield* keepPlaying;
      yield* settleFrom(current.cursor);
    });

    /**
     * Moves the cursor from `from` past instant actions, reaching each tool call on the way with
     * its own `CursorMoved` before it starts (ADR 0002), then requests playback of the speak it
     * rests on (unless paused). A tool call resting at the cursor has not been reached yet: one
     * appended there during a replay or a pause is reached when `from` is the cursor. A call whose
     * outcome is already in the log (a preloaded start's) is passed without executing.
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
          if (!answered(current.actions, action.handle)) yield* reach(action, 'first');
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
          const { tool, input } = decoded.success;
          const proposed = ExecutionId.make(uuidv7());
          if (pass === 'first' && tool.assign !== undefined) {
            const current = yield* Ref.get(state);
            const assigned = yield* Effect.exit(
              Effect.suspend(() =>
                tool.assign!(input, { handle: call.handle, state: current, executionId: proposed }),
              ),
            );
            const target = Exit.isSuccess(assigned) ? assigned.value : undefined;
            if (target === proposed) {
              return yield* startExecution(tool, input, call.handle, proposed);
            }
            if (
              current.executions.some(
                (execution) => execution.executionId === target && execution.tool === tool.name,
              )
            ) {
              yield* emit({ _tag: 'ToolJoined', executionId: target!, handle: call.handle });
              return yield* Effect.logInfo('tool joined').pipe(
                Effect.annotateLogs({ tool: tool.name, handle: call.handle }),
              );
            }
            // A dead `assign`, or an ID that is not an open execution of this tool: a tool defect.
            return yield* startExecution(tool, input, call.handle, proposed, true);
          }
          return yield* startExecution(tool, input, call.handle, proposed);
        }
        if (pass === 'replay') return;
        yield* emit({
          _tag: 'ResultQueued',
          result: {
            type: 'tool_errored',
            id: makeActionId(),
            handles: [call.handle],
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
     * Opens one execution under `executionId` and forks it. It never fails or throws: any defect,
     * in setup, in `run` or in its result, reaches `finish` in the execution's own fiber, which can
     * halt safely because it is neither the generation fiber nor a command. `broken`: the tool
     * mis-assigned the call, so the body dies.
     */
    const startExecution = (
      tool: Tool,
      input: unknown,
      handle: string,
      executionId: ExecutionId,
      broken = false,
    ) =>
      Effect.gen(function* () {
        const commands = yield* Queue.unbounded<unknown>();
        let accepts: Running['accepts'];
        let body: Effect.Effect<unknown, ToolError | ToolFault>;
        try {
          if (broken) throw new Error('the tool assigned a call to an execution it does not own');
          accepts = tool.command?.(input);
          body = Effect.suspend(() =>
            tool.run(input, {
              handle,
              executionId,
              awaitCommand: Queue.take(commands),
              progress: offerProgress(executionId),
            }),
          );
        } catch (defect) {
          accepts = undefined;
          body = Effect.die(defect);
        }
        const entry: Running = { tool, accepts, commands };
        running.set(executionId, entry);
        yield* emit({
          _tag: 'ToolStarted',
          executionId,
          handles: [handle],
          tool: tool.name,
          blocking: tool.policy.blocking,
          startedAt: yield* Clock.currentTimeMillis,
        });
        yield* Effect.logInfo('tool started').pipe(
          Effect.annotateLogs({ tool: tool.name, handle }),
        );
        entry.fiber = yield* FiberSet.run(
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
        const { tool } = entry;
        const current = yield* Ref.get(state);
        // Read before `ToolCompleted` removes the execution: its handles live only in the state.
        const handles = current.executions.find(
          (execution) => execution.executionId === executionId,
        )!.handles;
        let outcome: string;
        if (isHalted(current)) {
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
                  handles,
                  tool: tool.name,
                  result: read.success,
                },
              });
            } else {
              outcome = 'UnexpectedError';
              yield* halt(tool.name, handles, describeFault(tool.name, undefined));
            }
          }
        } else if (Cause.hasDies(exit.cause) || Cause.hasInterrupts(exit.cause)) {
          // A defect or a self-interruption anywhere in the cause, even beside an expected error.
          outcome = 'UnexpectedError';
          yield* halt(tool.name, handles, describeFault(tool.name, undefined));
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
                  handles,
                  tool: tool.name,
                  message: error.message,
                },
              });
            }
          } else {
            outcome = fault?._tag ?? 'UnexpectedError';
            yield* halt(tool.name, handles, describeFault(tool.name, fault));
          }
        }
        // After any `ResultQueued`, so no event prefix reads as a finished turn.
        yield* emit({ _tag: 'ToolCompleted', executionId });
        yield* Effect.logInfo('tool completed').pipe(
          Effect.annotateLogs({ tool: tool.name, handles: handles.join(' '), outcome }),
        );
      });

    // Stopping

    /**
     * Cancels the open blocking executions for an Interrupt: the user declines to answer. Each
     * leaves the state with no outcome (none is invented) and its fiber is interrupted without
     * waiting, so a late outcome finds no entry in `finish` and changes nothing. An expected end,
     * not a fault. Non-blocking executions, such as a running worker, continue.
     */
    const cancelBlocking = Effect.gen(function* () {
      const current = yield* Ref.get(state);
      for (const execution of current.executions.filter((candidate) => candidate.blocking)) {
        const entry = running.get(execution.executionId);
        running.delete(execution.executionId);
        yield* emit({ _tag: 'ToolCompleted', executionId: execution.executionId });
        // Forked: the fiber may be waiting for the lock this command holds.
        if (entry?.fiber !== undefined)
          yield* FiberSet.run(executions, Fiber.interrupt(entry.fiber));
        yield* Effect.logInfo('tool cancelled').pipe(
          Effect.annotateLogs({ tool: execution.tool, handles: execution.handles.join(' ') }),
        );
      }
    });

    /**
     * Stops presentation and generation, shared by Interrupt and halt so the two cannot drift:
     * ends a replay, trims what never took effect, appends `action` and moves the cursor to the end,
     * which clears playback. Running executions continue (ADR 0002). An unreached tool call at the
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

    /**
     * Halts the conversation for good (until a future Reset): no further generation. `handles` is
     * empty for a fault outside any call.
     */
    const halt = (tool: string, handles: ReadonlyArray<string>, error: ToolFaulted['error']) =>
      Effect.gen(function* () {
        yield* stop({ type: 'tool_faulted', id: makeActionId(), handles, tool, error });
        // Executions may run on, but nothing they kept can be submitted any more.
        if ((yield* Ref.get(state)).pendingProgress.length > 0) {
          yield* emit({ _tag: 'ProgressDiscarded' });
        }
        yield* Effect.logWarning('tool faulted').pipe(
          Effect.annotateLogs({ tool, handles: handles.join(' '), error: error.tag }),
        );
      });

    /** A tool's failure outside any execution: the first halts; later ones and teardown record nothing. */
    const faultOutside = (tool: Tool, fault: ToolFault | undefined) =>
      Effect.gen(function* () {
        if (closing || isHalted(yield* Ref.get(state))) {
          return yield* Effect.logInfo('tool fault dropped').pipe(
            Effect.annotateLogs({ tool: tool.name }),
          );
        }
        yield* halt(tool.name, [], describeFault(tool.name, fault));
      });

    // Progress

    /**
     * Accepts a running execution's progress update into `pendingProgress`, replacing the one it
     * kept before, while paused or when it already keeps one. Otherwise it is used at once when
     * `progressAllowed` holds (an iteration submits it), or dropped. Nothing is accepted once the
     * session is closing or halted. The text is never logged.
     */
    const offerProgress = (executionId: ExecutionId) => (text: string) =>
      transact(
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          const execution = current.executions.find(
            (candidate) => candidate.executionId === executionId,
          );
          const open = !closing && execution !== undefined && !isHalted(current);
          const kept = current.pendingProgress.some(
            (candidate) => candidate.executionId === executionId,
          );
          const outcome = !open
            ? 'dropped'
            : current.paused || kept
              ? 'kept'
              : progressAllowed(current, yield* subscribed)
                ? 'used'
                : 'dropped';
          yield* Effect.logInfo(`tool progress ${outcome}`).pipe(
            Effect.annotateLogs({ tool: execution?.tool ?? 'closed', executionId }),
          );
          if (outcome === 'dropped') return false;
          yield* emit({ _tag: 'ProgressQueued', executionId, text });
          if (outcome === 'used') yield* beginIteration();
          return true;
        }),
      );

    // Generation

    /**
     * One iteration: appends each parsed action as it arrives, or a failure after them. The model
     * reads the history's model view. A reply that answers only progress is throwaway: its speech
     * plays, and its tool calls are ignored, logged by tool name only. With compaction, a reply
     * that called a `startsEpisode` tool may start a summary once its usage is known (`drain`).
     */
    const iterate = (history: ReadonlyArray<Action>): Effect.Effect<void> => {
      const throwaway = answersProgress(history);
      let startedEpisode = false;
      // Inside the stream, so a projection defect ends the iteration as a failure below.
      const options = (): Omit<GenerateOptions, 'usage'> => ({
        instructions: config.instructions,
        ...(config.examples === undefined ? {} : { examples: config.examples }),
        speakers: profiles,
        history: modelView(history),
        tools: config.tools,
        ...(config.reminders === undefined ? {} : { reminders: config.reminders }),
        ...(compaction === undefined ? {} : { summarizedHistory: true }),
      });
      const onElement = (element: Speak | ToolCallDraft) =>
        transact(
          Effect.gen(function* () {
            if (element.type === 'speak') {
              yield* append(element);
            } else if (throwaway) {
              yield* Effect.logInfo('progress reply tool call ignored').pipe(
                Effect.annotateLogs({ tool: element.tool }),
              );
              return;
            } else {
              const number = yield* Ref.updateAndGet(nextHandle, (last) => last + 1);
              const { id, tool, input } = element;
              yield* append({ type: 'tool_call', id, handle: `call_${number}`, tool, input });
              if (toolNamed(tool)?.policy.startsEpisode === true) startedEpisode = true;
            }
            yield* settle;
          }),
        );
      const conclude = (reply: Effect.Effect<void, GenerationError>): Effect.Effect<void> =>
        reply.pipe(
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
        );
      if (compaction === undefined) {
        return Stream.suspend(() => generate(options())).pipe(
          Stream.runForEach(onElement),
          Effect.provideService(LanguageModel.LanguageModel, languageModel),
          conclude,
        );
      }
      return Effect.gen(function* () {
        // The reply reaches this fiber through `reply`, up to `reply_ended`; a drain fiber outside
        // the generation handle reads the provider on for the usage, so the session idles at `]`
        // and a new iteration neither waits for it nor interrupts it.
        const reply = yield* Queue.bounded<
          Speak | ToolCallDraft,
          GenerationError | typeof unexpectedFailure | Cause.Done
        >(1);
        const replied = yield* Deferred.make<void>();
        const reader = yield* FiberSet.run(
          drains,
          drain(
            Stream.suspend(() => generate({ ...options(), usage: true })),
            reply,
            replied,
          ).pipe(
            // A defect before `reply_ended` fails the reply; after it, the reply stands.
            Effect.catchDefect(() =>
              Effect.andThen(Queue.fail(reply, unexpectedFailure), Effect.interrupt),
            ),
            Effect.flatMap((usage) =>
              transact(trigger(history, startedEpisode, usage)).pipe(
                Effect.catchDefect(() =>
                  Effect.logWarning('conversation summary failed').pipe(
                    Effect.annotateLogs(failureAnnotations(unexpectedFailure)),
                  ),
                ),
              ),
            ),
            Effect.provideService(LanguageModel.LanguageModel, languageModel),
          ),
        );
        yield* Stream.fromQueue(reply).pipe(
          Stream.runForEach(onElement),
          Effect.catch((error) =>
            error._tag === 'UnexpectedError' ? Effect.die(error) : Effect.fail(error),
          ),
          Effect.tap(() => Deferred.succeed(replied, undefined)),
          // An interrupt while the boundary generation still streams (`stop`), or a failure, ends
          // the reader too: no summary starts for that boundary. The next boundary's summary covers
          // the same range, so this degrades gracefully.
          Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Fiber.interrupt(reader))),
          conclude,
        );
      });
    };

    /**
     * Reads a generation with usage: hands each action to `reply` and ends it at `reply_ended`, or
     * fails it with the generation's failure. Then reads on to the end of the stream (Core bounds
     * it), waits until the reply's actions are all appended (`replied`), and returns the input-token
     * count, absent when none was reported.
     */
    const drain = (
      stream: Stream.Stream<
        Speak | ToolCallDraft | ReplyEnded | GenerationUsage,
        GenerationError,
        LanguageModel.LanguageModel
      >,
      reply: Queue.Queue<
        Speak | ToolCallDraft,
        GenerationError | typeof unexpectedFailure | Cause.Done
      >,
      replied: Deferred.Deferred<void>,
    ): Effect.Effect<number | undefined, never, LanguageModel.LanguageModel> =>
      Effect.gen(function* () {
        let inputTokens: number | undefined;
        yield* Stream.runForEach(stream, (element) => {
          switch (element.type) {
            case 'reply_ended':
              return Queue.end(reply);
            case 'usage':
              inputTokens = element.inputTokens;
              return Effect.void;
            default:
              return Queue.offer(reply, element);
          }
        }).pipe(
          // The failure is the reply's: the generation fiber records it, and nothing triggers.
          Effect.catch((error) => Effect.andThen(Queue.fail(reply, error), Effect.interrupt)),
        );
        yield* Deferred.await(replied);
        return inputTokens;
      });

    // History compaction

    /**
     * Runs once a generation with usage has ended and its reply is appended. Starts a summary of
     * everything before the episode the reply started, if it called a `startsEpisode` tool, the
     * session is open, the input passed the threshold or no count was reported, and the episode
     * starts after the newest summary's. A boundary call trimmed later by an interrupt does not
     * cancel it: compressing the earlier conversation is still valid.
     */
    const trigger = (
      history: ReadonlyArray<Action>,
      startedEpisode: boolean,
      inputTokens: number | undefined,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (compaction === undefined || !startedEpisode || closing) return;
        if (inputTokens !== undefined && inputTokens <= compaction.aboveInputTokens) return;
        const current = yield* Ref.get(state);
        if (isHalted(current)) return;
        const from = episodeStart(history);
        if (from === undefined) return;
        const log = effectiveActions(current);
        const position = (id: ActionId) => log.findIndex((action) => action.id === id);
        const previous =
          summaryReady ?? log.findLast((action) => action.type === 'history_compaction');
        // Resolved first: an episode start missing from the log is a defect, never skipped.
        const slice = summarySlice(log, previous?.from, from);
        const newest = summaryFrom ?? previous?.from;
        if (newest !== undefined && position(from) <= position(newest)) return;
        if (slice.length === 0) return;
        summaryFrom = from;
        // A newer boundary replaces the summary in flight.
        yield* FiberHandle.run(
          summarizing,
          summarize({
            prompt: compaction.prompt,
            ...(previous === undefined ? {} : { previous: previous.text }),
            history: slice,
            tools: config.tools,
          }).pipe(
            Effect.provideService(LanguageModel.LanguageModel, summaryModel),
            Effect.catchDefect(() => Effect.fail(unexpectedFailure)),
            Effect.matchEffect({
              onSuccess: (text) =>
                transact(
                  Effect.gen(function* () {
                    summaryFrom = undefined;
                    summaryReady = { from, text };
                    yield* Effect.logInfo('conversation summarized').pipe(
                      Effect.annotateLogs({ from, characters: text.length }),
                    );
                  }),
                ),
              onFailure: (error) =>
                transact(
                  Effect.gen(function* () {
                    summaryFrom = undefined;
                    yield* Effect.logWarning('conversation summary failed').pipe(
                      Effect.annotateLogs({ from, ...failureAnnotations(error) }),
                    );
                  }),
                ),
            }),
          ),
        );
      });

    /** Appends the ready summary, if any, so the iteration about to read the history uses it. */
    const appendSummary: Effect.Effect<void> = Effect.gen(function* () {
      if (summaryReady === undefined) return;
      const { from, text } = summaryReady;
      summaryReady = undefined;
      yield* append({ type: 'history_compaction', id: makeActionId(), from, text });
    });

    /**
     * Records each tool's context when it changed, so the latest one closes this iteration's
     * input. A failing `context` is logged by tool name and skipped. Never starts an iteration.
     */
    const recordContext = Effect.gen(function* () {
      for (const tool of config.tools) {
        if (tool.context === undefined) continue;
        const sampled = yield* Effect.exit(Effect.suspend(() => tool.context!));
        if (Exit.isFailure(sampled)) {
          yield* Effect.logWarning('tool context failed').pipe(
            Effect.annotateLogs({ tool: tool.name }),
          );
          continue;
        }
        const text = sampled.value ?? '';
        const latest = (yield* Ref.get(state)).actions.findLast(
          (action) => action.type === 'tool_context' && action.tool === tool.name,
        );
        const recorded = latest?.type === 'tool_context' ? latest.text : '';
        if (text !== recorded) {
          yield* append({ type: 'tool_context', id: makeActionId(), tool: tool.name, text });
        }
      }
    });

    /**
     * Starts another iteration: the only submission path for a message, a preloaded start
     * (`'start'`), progress, a retry and continuation, so queued outcomes and kept progress are
     * submitted exactly once, before any new input. Each caller validates first; this never checks
     * the pause. `running` comes first, so no event prefix reads as a finished turn. Tool context is
     * recorded after the input, so it closes it.
     */
    const beginIteration = (input?: UserMessage | 'start') =>
      Effect.gen(function* () {
        yield* emit({ _tag: 'GenerationChanged', generation: 'running' });
        const queued = yield* Ref.get(state);
        if (queued.pendingResults.length > 0 || queued.pendingProgress.length > 0) {
          // Execution start order; each with the handles its execution holds now, joins included.
          const progress: Array<ToolProgress> = [];
          for (const execution of queued.executions) {
            const kept = queued.pendingProgress.find(
              (candidate) => candidate.executionId === execution.executionId,
            );
            if (kept === undefined) continue;
            progress.push({
              type: 'tool_progress',
              id: makeActionId(),
              handles: execution.handles,
              tool: execution.tool,
              text: kept.text,
            });
          }
          yield* emit({ _tag: 'ResultsSubmitted', progress });
        }
        if (input === 'start') yield* emit({ _tag: 'StartSubmitted' });
        else if (input !== undefined) yield* append(input);
        yield* recordContext;
        yield* appendSummary;
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
          // Handles anything the frontier held, even while paused, and replays the cursor speak
          // from its start.
          yield* settleFrom(current.cursor);
        } else {
          yield* emit({ _tag: 'ReplayMoved', replay: position });
          yield* requestPlayback;
        }
      });

    /**
     * Moves presentation on from the presented action, shared by a finished playback and `Next`:
     * forward replay steps after the replayed speak; at the frontier the cursor steps after its
     * speak, or reaches the unreached action it rests on.
     */
    const advance = (current: SessionState) => {
      if (current.replay !== null) return advanceReplay(current.replay);
      const onSpeak = current.actions[current.cursor]?.type === 'speak';
      return settleFrom(onSpeak ? current.cursor + 1 : current.cursor);
    };

    // Commands

    const reject = (command: CommandRejected['command'], current: SessionState) =>
      Effect.fail(new CommandRejected({ command, phase: derivePhase(current) }));

    const apply = (command: Command): Effect.Effect<void, CommandRejected | ToolCommandRejected> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const phase = derivePhase(current);
        switch (command._tag) {
          case 'SendMessage': {
            if (!canSend(current)) return yield* reject(command._tag, current);
            // A message is the listener's intent to continue: it releases a pause.
            if (current.paused) yield* emit({ _tag: 'PauseChanged', paused: false });
            return yield* beginIteration({
              type: 'user_message',
              id: makeActionId(),
              text: command.text,
            });
          }
          case 'RetryGeneration': {
            if (phase !== 'generationFailed' || current.paused) {
              return yield* reject(command._tag, current);
            }
            return yield* beginIteration();
          }
          case 'PlaybackFinished': {
            // Stale by identity, or nobody is subscribed: the cursor stays frozen (ADR 0001).
            if (current.playback?.playbackId !== command.playbackId) return;
            if (!(yield* subscribed)) return;
            // Paused: the cursor and the request hold; a finish reported after `Play` advances.
            if (current.paused) return;
            return yield* advance(current);
          }
          case 'Interrupt': {
            // The user declines an open blocking tool (a question) to say something else: it is
            // cancelled, and the interruption always stands, whatever else was going on.
            const declined = phase !== 'halted' && blockingExecution(current) !== undefined;
            if (declined) yield* cancelBlocking;
            // Stops listening to an old line first; the frontier's own phase decides the rest.
            const endedReplay = current.replay !== null;
            if (endedReplay) yield* emit({ _tag: 'ReplayMoved', replay: null });
            const frontier = yield* Ref.get(state);
            const frontierPhase = derivePhase(frontier);
            if (!declined && frontierPhase !== 'speaking' && frontierPhase !== 'working') {
              if (endedReplay) return;
              return yield* reject(command._tag, frontier);
            }
            return yield* stop({
              type: 'interrupted',
              id: makeActionId(),
              during: frontierPhase === 'speaking' ? 'speech' : 'wait',
            });
          }
          case 'Back': {
            const target = backTarget(current);
            if (phase === 'halted' || target === undefined) {
              return yield* reject(command._tag, current);
            }
            yield* emit({ _tag: 'ReplayMoved', replay: target });
            return yield* requestPlayback;
          }
          case 'Start': {
            if (phase !== 'ready' || current.paused) return yield* reject(command._tag, current);
            return yield* beginIteration('start');
          }
          case 'Pause': {
            if (phase === 'halted') return yield* reject(command._tag, current);
            if (!current.paused) yield* emit({ _tag: 'PauseChanged', paused: true });
            return;
          }
          case 'Play': {
            if (phase === 'halted') return yield* reject(command._tag, current);
            if (current.paused) yield* emit({ _tag: 'PauseChanged', paused: false });
            if (phase === 'ready') return yield* beginIteration('start');
            if (!current.paused) return;
            // Resumes what is presented: the same request on this connection, else a fresh one.
            // At the frontier, an action the pause held is reached now.
            if (current.replay !== null) return yield* keepPlaying;
            return yield* settleFrom(current.cursor);
          }
          case 'Next': {
            if (!canAdvance(current)) return yield* reject(command._tag, current);
            return yield* advance(current);
          }
          case 'ToolCommand': {
            if (phase === 'halted') return yield* reject(command._tag, current);
            const entry = running.get(command.executionId);
            const execution = current.executions.find(
              (candidate) => candidate.executionId === command.executionId,
            );
            const rejectTool = (reason: ToolCommandRejected['reason']) =>
              Effect.fail(new ToolCommandRejected({ executionId: command.executionId, reason }));
            if (entry === undefined || execution?.handles.includes(command.handle) !== true) {
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
        const current = yield* Ref.get(state);
        yield* Queue.offer(queue, { _tag: 'Snapshot', state: current });
        // A request made to the former connection never carries over. Paused, none replaces it
        // until `Play`; otherwise the presented line replays from its start under a new ID.
        if (current.paused && current.playback !== null) yield* emit({ _tag: 'PlaybackCleared' });
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

    // Registered after the `closing` finalizer, so teardown interrupts these first and records
    // nothing. A defect in a stream halts like one in an execution.
    for (const tool of config.tools) {
      const faults = tool.faults;
      if (faults === undefined) continue;
      yield* Effect.forkScoped(
        Stream.runForEach(faults, (fault) => transact(faultOutside(tool, fault))).pipe(
          Effect.catchDefect(() => transact(faultOutside(tool, undefined))),
        ),
      );
    }

    return { service, state: Ref.get(state) };
  });

/**
 * A preloaded start's call and its result, as the log will hold them, under handle `call_1`. A
 * call or result its tool cannot read is a configuration defect, so this throws.
 */
const answeredCall = (
  tools: SessionConfig['tools'],
  { label, tool: name, input, result }: NonNullable<NonNullable<SessionConfig['start']>['call']>,
): PendingCall => {
  const decoded = decodeToolCall(tools, { tool: name, input });
  if (Result.isFailure(decoded)) {
    throw new Error(`A preloaded start's call is invalid: ${decoded.failure}`);
  }
  const encoded = readResult(decoded.success.tool, result);
  if (Result.isFailure(encoded)) {
    throw new Error(`A preloaded start's \`${name}\` result does not encode`);
  }
  const handle = 'call_1';
  return {
    label,
    call: { type: 'tool_call', id: makeActionId(), handle, tool: name, input },
    result: {
      type: 'tool_result',
      id: makeActionId(),
      handles: [handle],
      tool: name,
      result: encoded.success,
    },
  };
};

/** Whether an outcome for `handle` is already in the log. */
const answered = (actions: ReadonlyArray<Action>, handle: string): boolean =>
  actions.some(
    (action) =>
      (action.type === 'tool_result' || action.type === 'tool_errored') &&
      action.handles.includes(handle),
  );

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
