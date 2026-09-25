import { Effect, FiberHandle, Option, Ref, Result, Stream, SubscriptionRef } from 'effect';

import {
  Client,
  type AudioUnavailable,
  type PlaybackInstruction,
  type Playable,
} from '@yourtechbudstudio/fluidcast-client';

import type { MediaError, PlaybackStatus } from './model';

/** The page's audio output, owned by the player for the lifetime of its scope. */
export interface Player {
  readonly status: SubscriptionRef.SubscriptionRef<PlaybackStatus>;
  /** The analyser over what is playing, once audio has been unlocked; visuals read it each frame. */
  readonly analyser: () => AnalyserNode | null;
  /** Fetches a fresh clip for the failed line at the cursor and plays it from the start. */
  readonly retryClip: Effect.Effect<void>;
  /** The gesture that unblocks autoplay: resumes audio and replays the held line from the start. */
  readonly resume: Effect.Effect<void>;
}

const IDLE: PlaybackStatus = { kind: 'idle' };

/** How long to wait for a suspended `AudioContext` to resume before treating playback as held. */
const RESUME_GRACE = '250 millis';

type Outcome = 'finished' | 'held' | MediaError;

/**
 * Plays the Harness's instructions on one reused `<audio>` element routed through an analyser
 * (client-integration.md: applications own playback and autoplay).
 *
 * - Only a `PlaybackRequested`, surfaced as `client.playback`, starts audio. When it becomes `None`
 *   (cursor moved, interrupt, lost connection, supersede) the element stops at once.
 * - One attempt runs at a time, in a `FiberHandle`; each attempt owns the element's source and its
 *   event listeners, so events from an earlier source can never reach a later line.
 * - `ended` reports `finished(playbackId)` for the instruction that attempt played, never another.
 */
export const makePlayer = Effect.gen(function* () {
  const client = yield* Client;
  const status = yield* SubscriptionRef.make<PlaybackStatus>(IDLE);
  const current = yield* Ref.make<Option.Option<PlaybackInstruction>>(Option.none());
  const attempt = yield* FiberHandle.make<void, never>();

  const element = new Audio();
  element.preload = 'auto';

  let graph: { readonly context: AudioContext; readonly analyser: AnalyserNode } | null = null;
  /** Created on first use. The element's output goes through it from then on. */
  const ensureGraph = () => {
    if (graph) return graph;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.5;
    context.createMediaElementSource(element).connect(analyser);
    analyser.connect(context.destination);
    graph = { context, analyser };
    return graph;
  };

  // Any gesture on the page unlocks audio: a tap, a click on Send, or Enter in the composer.
  const unlock = () =>
    void ensureGraph()
      .context.resume()
      .catch(() => {});
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      document.addEventListener('pointerdown', unlock, true);
      document.addEventListener('keydown', unlock, true);
    }),
    () =>
      Effect.sync(() => {
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
      }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      element.pause();
      element.removeAttribute('src');
      void graph?.context.close();
    }),
  );

  /** Points the element at a clip for the attempt's scope; releasing stops it and frees the object URL. */
  const load = (audio: Playable) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const url =
          'url' in audio
            ? audio.url
            : URL.createObjectURL(new Blob([audio.bytes as BlobPart], { type: audio.mimeType }));
        element.src = url;
        return 'url' in audio ? null : url;
      }),
      (objectUrl) =>
        Effect.sync(() => {
          element.pause();
          element.removeAttribute('src');
          element.load();
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        }),
    );

  /** Audio can only be heard once the context runs; a suspended one needs a gesture. */
  const audible = Effect.gen(function* () {
    const { context } = ensureGraph();
    if (context.state === 'running') return true;
    yield* Effect.promise(() => context.resume().catch(() => {})).pipe(
      Effect.timeoutOption(RESUME_GRACE),
    );
    return (context.state as AudioContextState) === 'running';
  });

  /** Waits for the element to end or fail. Listeners live exactly as long as the wait. */
  const settled = (mediaError: MediaError) =>
    Effect.callback<Outcome>((resume) => {
      const onEnded = () => resume(Effect.succeed('finished'));
      const onError = () => resume(Effect.succeed<Outcome>(mediaError));
      element.addEventListener('ended', onEnded);
      element.addEventListener('error', onError);
      return Effect.sync(() => {
        element.removeEventListener('ended', onEnded);
        element.removeEventListener('error', onError);
      });
    });

  /** Plays one instruction from the start with the given audio, then reports how it ended. */
  const play = (instruction: PlaybackInstruction, audio: Playable) =>
    Effect.gen(function* () {
      const actionId = instruction.action.id;
      const mediaError: MediaError = { _tag: 'MediaError', streamed: 'url' in audio };
      yield* load(audio);
      if (!(yield* audible)) return 'held' as const;
      const outcome = yield* Effect.raceFirst(
        settled(mediaError),
        Effect.tryPromise(() => element.play()).pipe(
          Effect.matchEffect({
            onFailure: ({ cause }) =>
              Effect.succeed<Outcome>(
                cause instanceof DOMException && cause.name === 'NotAllowedError'
                  ? 'held'
                  : mediaError,
              ),
            onSuccess: () =>
              Effect.andThen(
                SubscriptionRef.set(status, { kind: 'playing', actionId }),
                settled(mediaError),
              ),
          }),
        ),
      );
      if (outcome === 'finished') {
        yield* client.finished(instruction.playbackId).pipe(
          Effect.catch((error) =>
            // No retry: a lost connection reconnects, and the Harness replays the line under a new id.
            Effect.logWarning('playback: finished not delivered').pipe(
              Effect.annotateLogs({ reason: error._tag }),
            ),
          ),
        );
      }
      return outcome;
    }).pipe(
      Effect.scoped,
      Effect.flatMap((outcome) => {
        const actionId = instruction.action.id;
        if (outcome === 'held') return SubscriptionRef.set(status, { kind: 'held', actionId });
        if (outcome === 'finished') return Effect.void;
        return SubscriptionRef.set(status, { kind: 'failed', actionId, error: outcome });
      }),
    );

  /** Starts an attempt for the current instruction, replacing any running one. */
  const start = (
    instruction: PlaybackInstruction,
    audio: Result.Result<Playable, AudioUnavailable>,
  ) =>
    Effect.gen(function* () {
      yield* FiberHandle.clear(attempt);
      if (Result.isFailure(audio)) {
        yield* SubscriptionRef.set(status, {
          kind: 'failed',
          actionId: instruction.action.id,
          error: audio.failure,
        });
        return;
      }
      yield* SubscriptionRef.set(status, IDLE);
      yield* FiberHandle.run(attempt, play(instruction, audio.success));
    });

  yield* client.playback.changes.pipe(
    Stream.runForEach((next) =>
      Effect.gen(function* () {
        const previous = yield* Ref.get(current);
        if (
          Option.isSome(next) &&
          Option.isSome(previous) &&
          next.value.playbackId === previous.value.playbackId
        ) {
          return;
        }
        yield* Ref.set(current, next);
        if (Option.isNone(next)) {
          yield* FiberHandle.clear(attempt);
          yield* SubscriptionRef.set(status, IDLE);
          return;
        }
        yield* start(next.value, next.value.audio);
      }),
    ),
    Effect.forkScoped,
  );

  /** Runs `f` for the current instruction if the status says it is in the given state. */
  const whenCurrent = (
    kind: PlaybackStatus['kind'],
    f: (instruction: PlaybackInstruction) => Effect.Effect<void>,
  ) =>
    Effect.gen(function* () {
      const instruction = yield* Ref.get(current);
      const now = yield* SubscriptionRef.get(status);
      if (Option.isNone(instruction) || now.kind === 'idle' || now.kind !== kind) return;
      if (now.actionId !== instruction.value.action.id) return;
      yield* f(instruction.value);
    });

  const retryClip = whenCurrent('failed', (instruction) =>
    Effect.gen(function* () {
      yield* SubscriptionRef.set(status, IDLE);
      const audio = yield* Effect.result(client.playable(instruction.action.id));
      // The line may have moved on while the clip was fetched.
      const latest = yield* Ref.get(current);
      if (Option.isNone(latest) || latest.value.playbackId !== instruction.playbackId) return;
      yield* start(instruction, audio);
    }),
  );

  const resume = whenCurrent('held', (instruction) =>
    Effect.suspend(() => {
      // Called from the tap itself, so the context may resume within the gesture.
      unlock();
      return start(instruction, instruction.audio);
    }),
  );

  return { status, analyser: () => graph?.analyser ?? null, retryClip, resume } satisfies Player;
});
