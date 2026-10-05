import { Effect, FiberHandle, Option, Ref, Result, Schema, Stream, SubscriptionRef } from 'effect';

import type { Speak } from '@yourtechbudstudio/fluidcast-core/actions';
import {
  derivePhase,
  effectiveActions,
  presentedSpeak,
  reduce,
  SpeechNotFound,
  type Command,
  type CommandRejected,
  type ExecutionId,
  type Phase,
  type ToolCommandRejected,
  type PlaybackId,
  type SessionState,
  type SpeakerLabel,
  type SubscriptionMessage,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

import type { AudioUnavailable, makeAudio, Playable } from '../audio/index.ts';
import { TransportError, type Transport } from '../transport.ts';
import { reconnectSchedule } from './reconnect.ts';

/** What a player shows: the actions up to the cursor, the derived phase, and the tool work in flight. */
export interface ConversationView {
  readonly actions: SessionState['actions'];
  readonly phase: Phase;
  readonly speakers: ReadonlyArray<SpeakerLabel>;
  /** Open tool executions, in start order. Each one's call is in `actions`. */
  readonly executions: SessionState['executions'];
  /** Completed tool outcomes the model has not read yet. They join `actions` when submitted. */
  readonly pendingResults: SessionState['pendingResults'];
  /** The speak being presented: at the replay position while replaying, else at the cursor. */
  readonly presented: Speak | undefined;
}

export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'superseded';

/**
 * Play `action` now, then call `finished(playbackId)`. `audio` is a failure when the line's audio
 * could not be fetched; `playable` obtains it again for a retry.
 */
export interface PlaybackInstruction {
  readonly playbackId: PlaybackId;
  readonly action: Speak;
  readonly audio: Result.Result<Playable, AudioUnavailable>;
}

/** A read-only view of changing state: its current value and a stream of it and later values. */
export interface Subscribable<A> {
  readonly get: Effect.Effect<A>;
  readonly changes: Stream.Stream<A>;
}

const readOnly = <A>(ref: SubscriptionRef.SubscriptionRef<A>): Subscribable<A> => ({
  get: SubscriptionRef.get(ref),
  changes: SubscriptionRef.changes(ref),
});

type Audio = Effect.Success<ReturnType<typeof makeAudio>>;

/**
 * Protocol sync (ADR 0001): folds the subscription with the Harness's reducer, reconnects, and turns
 * playback requests into instructions. Runs for the lifetime of the current scope.
 */
export const makeSession = (transport: Transport['Service'], audio: Audio) =>
  Effect.gen(function* () {
    const projection = yield* Ref.make<SessionState | undefined>(undefined);
    const view = yield* SubscriptionRef.make<Option.Option<ConversationView>>(Option.none());
    const connection = yield* SubscriptionRef.make<Connection>('connecting');
    const playback = yield* SubscriptionRef.make<Option.Option<PlaybackInstruction>>(Option.none());
    // At most one playback request is resolved into an instruction at a time.
    const resolving = yield* FiberHandle.make<void, never>();

    const stopPlayback = Effect.andThen(
      FiberHandle.clear(resolving),
      SubscriptionRef.set(playback, Option.none()),
    );

    const project = (state: SessionState) =>
      Effect.gen(function* () {
        yield* Ref.set(projection, state);
        yield* SubscriptionRef.set(
          view,
          Option.some({
            actions: effectiveActions(state),
            phase: derivePhase(state),
            speakers: state.speakers,
            executions: state.executions,
            pendingResults: state.pendingResults,
            presented: presentedSpeak(state),
          }),
        );
        yield* audio.reconcile(state);
      });

    const playableFor = (state: SessionState | undefined, actionId: string) =>
      Effect.gen(function* () {
        const action = state?.actions.find((entry) => entry.id === actionId);
        if (state === undefined || action?.type !== 'speak') {
          return yield* new SpeechNotFound({ actionId });
        }
        return yield* audio.playable(actionId, state.speech.mimeType);
      });

    /** Resolves a request's audio, then publishes it if the request is still the current one. */
    const resolve = (state: SessionState, playbackId: PlaybackId, actionId: string) =>
      Effect.gen(function* () {
        const action = state.actions.find((entry) => entry.id === actionId);
        if (action?.type !== 'speak') return;
        const result = yield* Effect.result(playableFor(state, actionId));
        const latest = yield* Ref.get(projection);
        if (latest?.playback?.playbackId !== playbackId) return;
        yield* SubscriptionRef.set(playback, Option.some({ playbackId, action, audio: result }));
      });

    const handle = (message: SubscriptionMessage) =>
      Effect.gen(function* () {
        switch (message._tag) {
          case 'Snapshot': {
            // Playback starts only from a `PlaybackRequested` received on this connection.
            yield* stopPlayback;
            yield* project(message.state);
            yield* SubscriptionRef.set(connection, 'connected');
            return;
          }
          case 'Superseded': {
            yield* stopPlayback;
            yield* audio.cancelAll;
            yield* SubscriptionRef.set(connection, 'superseded');
            return;
          }
          default: {
            const current = yield* Ref.get(projection);
            if (current === undefined || (yield* SubscriptionRef.get(connection)) !== 'connected') {
              return yield* new TransportError({ reason: 'Malformed' });
            }
            const next = reduce(current, message);
            // The presented line changed: the player stops the old clip at once.
            if (message._tag === 'CursorMoved' || message._tag === 'ReplayMoved') {
              yield* stopPlayback;
            }
            yield* project(next);
            if (message._tag === 'PlaybackRequested') {
              yield* FiberHandle.run(
                resolving,
                resolve(next, message.playbackId, message.actionId),
              );
            }
          }
        }
      });

    const sync = Stream.suspend(() => transport.subscribe()).pipe(
      // A subscription that ends without `Superseded` is a lost connection.
      Stream.concat(Stream.fail(new TransportError({ reason: 'Closed' }))),
      Stream.takeUntil((message) => message._tag === 'Superseded'),
      Stream.mapEffect(handle),
      Stream.tapError(() =>
        Effect.andThen(stopPlayback, SubscriptionRef.set(connection, 'reconnecting')),
      ),
      // The schedule resets once a reconnection delivers its snapshot.
      Stream.retry(reconnectSchedule),
      Stream.runDrain,
    );
    yield* Effect.forkScoped(sync);

    const send = (command: Command) => transport.send(command);

    /** A command other than `ToolCommand`, which is the only one rejected as `ToolCommandRejected`. */
    const sendPlain = (command: Command) =>
      send(command).pipe(
        Effect.catchTag('ToolCommandRejected', (rejected) =>
          Effect.die(new Error(`unexpected ${rejected._tag} for ${command._tag}`)),
        ),
      );

    return {
      view: readOnly(view),
      connection: readOnly(connection),
      playback: readOnly(playback),
      sendMessage: (text: string) => sendPlain({ _tag: 'SendMessage', text }),
      interrupt: () => sendPlain({ _tag: 'Interrupt' }),
      retry: () => sendPlain({ _tag: 'RetryGeneration' }),
      back: () => sendPlain({ _tag: 'Back' }),
      finished: (playbackId: PlaybackId): Effect.Effect<void, CommandRejected | TransportError> =>
        sendPlain({ _tag: 'PlaybackFinished', playbackId }),
      sendToolCommand: <C>(
        schema: Schema.Codec<C, Schema.Json>,
        execution: { readonly handle: string; readonly executionId: ExecutionId },
        payload: C,
      ): Effect.Effect<void, CommandRejected | ToolCommandRejected | TransportError> =>
        Effect.flatMap(
          // A payload its own schema cannot encode is a programming error.
          Effect.orDie(Schema.encodeEffect(schema)(payload)),
          (encoded) =>
            send({
              _tag: 'ToolCommand',
              handle: execution.handle,
              executionId: execution.executionId,
              payload: encoded,
            }),
        ),
      playable: (actionId: string) =>
        Effect.flatMap(Ref.get(projection), (state) => playableFor(state, actionId)),
    };
  });
