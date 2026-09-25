import { Cause, Context, Effect, FiberHandle, Layer, Queue, Ref, Semaphore, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import {
  audioMimeType,
  generate,
  SpeechSynthesizer,
  synthesize,
  type AudioFormat,
  type SpeechError,
} from '@yourtechbudstudio/fluidcast-core';
import {
  makeActionId,
  uuidv7,
  type Action,
  type SpeakerProfile,
} from '@yourtechbudstudio/fluidcast-core/actions';

import { describeFailure, unexpectedFailure } from './failure.ts';
import {
  CommandRejected,
  currentAction,
  derivePhase,
  effectiveActions,
  PlaybackId,
  reduce,
  SpeechNotFound,
  type Command,
  type SessionEvent,
  type SessionState,
  type SubscriptionMessage,
} from './protocol.ts';

/** A configured speaker: its prompt profile plus how its lines are voiced. */
export interface SessionSpeaker extends SpeakerProfile {
  /** The TTS provider's voice. */
  readonly voice: string;
  /** Optional delivery guidance for providers that support it. */
  readonly voiceInstructions?: string;
}

export interface SessionConfig {
  /** Integrator instructions placed in the system prompt. */
  readonly instructions: string;
  /** The configured speakers. The first is the lead speaker. At least one is required. */
  readonly speakers: ReadonlyArray<SessionSpeaker>;
  /** The audio format `speech` produces. */
  readonly speechFormat: AudioFormat;
}

/**
 * The single-session conversation authority (ADRs 0003, 0006): the action log, the cursor,
 * playback identity, generation, and the one subscription.
 */
export class Session extends Context.Service<
  Session,
  {
    /**
     * A snapshot followed by every later event, with no gap. There is one subscriber: subscribing
     * again sends `Superseded` to the previous subscription and ends it. While nobody is subscribed
     * no playback is requested or acknowledged, so the cursor stays on its speak.
     */
    readonly subscribe: () => Stream.Stream<SubscriptionMessage>;
    /** Applies one command. Commands are applied one at a time. */
    readonly command: (command: Command) => Effect.Effect<void, CommandRejected>;
    /** Streams the audio for any speak currently in the log, queued or played. */
    readonly speech: (actionId: string) => Stream.Stream<Uint8Array, SpeechNotFound | SpeechError>;
  }
>()('@yourtechbudstudio/fluidcast-harness/Session') {}

type Subscriber = Queue.Queue<SubscriptionMessage, Cause.Done>;

/**
 * Builds a session in the current scope. Also returns `state`, which the Layer does not expose, so
 * tests can observe a session that has no subscriber.
 */
export const make = (config: SessionConfig) =>
  Effect.gen(function* () {
    const languageModel = yield* LanguageModel.LanguageModel;
    const synthesizer = yield* SpeechSynthesizer;

    // One lock serialises commands, generation appends and subscription changes. Every event is
    // applied to `state` and offered to the subscriber inside it, so both see the same order.
    const lock = yield* Semaphore.make(1);
    const locked = lock.withPermits(1);
    const state = yield* Ref.make<SessionState>({
      actions: [],
      cursor: 0,
      generation: 'idle',
      playback: null,
      speakers: config.speakers.map(({ id, name }) => ({ id, name })),
      speech: { mimeType: audioMimeType[config.speechFormat] },
    });
    const subscriber = yield* Ref.make<Subscriber | undefined>(undefined);
    const generation = yield* FiberHandle.make<void, never>();
    const profiles = config.speakers.map(({ id, name, personality }) => ({
      id,
      name,
      personality,
    }));
    const speakers = new Map(config.speakers.map((speaker) => [speaker.id, speaker]));

    // The helpers below run only while holding the lock.

    /** Applies the event with the shared reducer and delivers it to the subscriber, if any. */
    const emit = (event: SessionEvent) =>
      Effect.gen(function* () {
        yield* Ref.update(state, (current) => reduce(current, event));
        const queue = yield* Ref.get(subscriber);
        if (queue !== undefined) yield* Queue.offer(queue, event);
      });

    const append = (action: Action) => emit({ _tag: 'ActionAppended', action });

    /** Requests playback of the speak at the cursor under a fresh playback ID. */
    const requestPlayback = Effect.gen(function* () {
      const current = currentAction(yield* Ref.get(state));
      if (current?.type !== 'speak') return;
      yield* emit({
        _tag: 'PlaybackRequested',
        playbackId: PlaybackId.make(uuidv7()),
        actionId: current.id,
      });
    });

    /**
     * Moves the cursor past instant actions, then requests playback when it rests on a speak that
     * has none outstanding and someone is subscribed to play it.
     */
    const settle = Effect.gen(function* () {
      const before = yield* Ref.get(state);
      let target = before.cursor;
      while (target < before.actions.length && before.actions[target]?.type !== 'speak') target++;
      if (target !== before.cursor) yield* emit({ _tag: 'CursorMoved', cursor: target });

      const after = yield* Ref.get(state);
      const current = currentAction(after);
      if (current === undefined || after.playback?.actionId === current.id) return;
      if ((yield* Ref.get(subscriber)) !== undefined) yield* requestPlayback;
    });

    // Generation

    /** One iteration: appends each parsed speak as it arrives, or a failure after them. */
    const iterate = (history: ReadonlyArray<Action>) =>
      generate({ instructions: config.instructions, speakers: profiles, history }).pipe(
        Stream.runForEach((speak) => locked(Effect.andThen(append(speak), settle))),
        // A defect must still end the iteration truthfully rather than leave it running forever.
        Effect.catchDefect(() => Effect.fail(unexpectedFailure)),
        Effect.matchEffect({
          onSuccess: () => locked(emit({ _tag: 'GenerationChanged', generation: 'idle' })),
          onFailure: (error) =>
            locked(
              Effect.gen(function* () {
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

    /** Starts an iteration from the effective actions. Generation must already be `running`. */
    const startIteration = Effect.gen(function* () {
      const history = effectiveActions(yield* Ref.get(state));
      yield* FiberHandle.run(generation, iterate(history));
    });

    // Commands

    const reject = (command: CommandRejected['command'], current: SessionState) =>
      Effect.fail(new CommandRejected({ command, phase: derivePhase(current) }));

    const apply = (command: Command): Effect.Effect<void, CommandRejected> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const phase = derivePhase(current);
        switch (command._tag) {
          case 'SendMessage': {
            if (phase !== 'idle' && phase !== 'generationFailed') {
              return yield* reject(command._tag, current);
            }
            yield* emit({ _tag: 'GenerationChanged', generation: 'running' });
            yield* append({ type: 'user_message', id: makeActionId(), text: command.text });
            yield* settle;
            yield* startIteration;
            return;
          }
          case 'RetryGeneration': {
            if (phase !== 'generationFailed') return yield* reject(command._tag, current);
            yield* emit({ _tag: 'GenerationChanged', generation: 'running' });
            yield* startIteration;
            return;
          }
          case 'PlaybackFinished': {
            // Stale by identity, or nobody is subscribed: the cursor stays frozen (ADR 0003).
            if (current.playback?.playbackId !== command.playbackId) return;
            if ((yield* Ref.get(subscriber)) === undefined) return;
            yield* emit({ _tag: 'CursorMoved', cursor: current.cursor + 1 });
            yield* settle;
            return;
          }
          case 'Interrupt': {
            if (phase !== 'speaking' && phase !== 'waiting') {
              return yield* reject(command._tag, current);
            }
            // Waits for the iteration to end. Its appends wait on this lock interruptibly, so an
            // interrupted iteration can never append.
            yield* FiberHandle.clear(generation);
            // Also clears a failure whose buffered lines were still playing.
            if (current.generation !== 'idle') {
              yield* emit({ _tag: 'GenerationChanged', generation: 'idle' });
            }
            if (current.cursor + 1 < current.actions.length) {
              yield* emit({ _tag: 'ActionsTrimmed', from: current.cursor + 1 });
            }
            yield* append({ type: 'interrupted', id: makeActionId() });
            const end = (yield* Ref.get(state)).actions.length;
            yield* emit({ _tag: 'CursorMoved', cursor: end });
            return;
          }
        }
      });

    // Subscription

    const register = locked(
      Effect.gen(function* () {
        const queue: Subscriber = yield* Queue.unbounded<SubscriptionMessage, Cause.Done>();
        const previous = yield* Ref.getAndSet(subscriber, queue);
        if (previous !== undefined) {
          yield* Queue.offer(previous, { _tag: 'Superseded' });
          yield* Queue.end(previous);
        }
        yield* Queue.offer(queue, { _tag: 'Snapshot', state: yield* Ref.get(state) });
        // Replays the current line from its start under a new playback ID.
        yield* requestPlayback;
        return queue;
      }),
    );

    const unregister = (queue: Subscriber) =>
      locked(Ref.update(subscriber, (current) => (current === queue ? undefined : current)));

    const service: Session['Service'] = {
      subscribe: () =>
        Stream.unwrap(Effect.map(Effect.acquireRelease(register, unregister), Stream.fromQueue)),
      command: (command) => locked(apply(command)),
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
              ...(speaker.voiceInstructions === undefined
                ? {}
                : { voiceInstructions: speaker.voiceInstructions }),
            }).pipe(Stream.provideService(SpeechSynthesizer, synthesizer));
          }),
        ),
    };

    return { service, state: Ref.get(state) };
  });

/** The session as a Layer. It needs a `LanguageModel` and a `SpeechSynthesizer`. */
export const layer = (
  config: SessionConfig,
): Layer.Layer<Session, never, LanguageModel.LanguageModel | SpeechSynthesizer> =>
  Layer.effect(
    Session,
    Effect.map(make(config), ({ service }) => service),
  );
