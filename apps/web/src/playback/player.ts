import {
  Deferred,
  Effect,
  FiberHandle,
  Option,
  Ref,
  Result,
  Stream,
  SubscriptionRef,
} from 'effect';

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

/** The parts of an `<audio>` element the player uses. */
export type MediaElement = Pick<
  HTMLMediaElement,
  'src' | 'play' | 'pause' | 'load' | 'removeAttribute' | 'addEventListener' | 'removeEventListener'
>;

/**
 * Where clips are heard: the one reused element and the output behind it. The browser's lives for the player's scope
 * (`browserMedia`); tests supply fakes.
 */
export interface PlayerMedia {
  readonly element: MediaElement;
  /** Whether output can be heard now, giving a suspended output a moment to resume. */
  readonly audible: Effect.Effect<boolean>;
  /** Unlocks output. Effective only within a user gesture. */
  readonly unlock: () => void;
  readonly analyser: () => AnalyserNode | null;
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
}

const IDLE: PlaybackStatus = { kind: 'idle' };

/** How long to wait for a suspended `AudioContext` to resume before treating playback as held. */
const RESUME_GRACE = '250 millis';

/**
 * One `<audio>` element routed through an analyser, and the page-wide unlock: any gesture on the page (a tap, a click
 * on Play or Send, Enter in the composer) resumes the `AudioContext`.
 */
export const browserMedia = Effect.gen(function* () {
  const element = new Audio();
  element.preload = 'auto';

  let graph: { readonly context: AudioContext; readonly analyser: AnalyserNode } | null = null;
  /** Created on first use. The element's output goes through it from then on. */
  const ensureGraph = () => {
    if (graph) return graph;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    // ~43 ms windows at 48 kHz with light smoothing: the visuals' own followers shape the motion, so the analyser stays close to the audio.
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    context.createMediaElementSource(element).connect(analyser);
    analyser.connect(context.destination);
    graph = { context, analyser };
    return graph;
  };

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

  /** Audio can only be heard once the context runs; a suspended one needs a gesture. */
  const audible = Effect.gen(function* () {
    const { context } = ensureGraph();
    if (context.state === 'running') return true;
    yield* Effect.promise(() => context.resume().catch(() => {})).pipe(
      Effect.timeoutOption(RESUME_GRACE),
    );
    return (context.state as AudioContextState) === 'running';
  });

  return {
    element,
    audible,
    unlock,
    analyser: () => graph?.analyser ?? null,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  } satisfies PlayerMedia;
});

/** How a clip ended, once it did. */
type Ending = 'finished' | MediaError;

/** One instruction's hold on the element, from loading its clip until the instruction is no longer current. */
interface Attempt {
  /** Its source was released: a later attempt owns the element now. */
  released: boolean;
  /** The latest pause it observed. */
  paused: boolean;
  /** Its clip could not be obtained or played. */
  failed: boolean;
}

/**
 * Plays the Harness's instructions (client-integration.md: applications own playback and autoplay).
 *
 * - Only a `PlaybackRequested`, surfaced as `client.playback`, starts audio. When it becomes `None` or names another
 *   playback (cursor moved, interrupt, lost connection, supersede) the old clip stops at once and its source is freed.
 * - One attempt runs at a time, in a `FiberHandle`. Each attempt owns the element's source and its listeners for as
 *   long as its instruction is current, so events and late promises from an earlier source never reach a later line.
 * - The session's pause (`view.paused`) is the only authority on pausing. Pause keeps the source, position and
 *   playback ID; releasing it resumes that same clip. Nothing starts the element while the latest view says paused.
 * - `ended` reports `finished(playbackId)` for the attempt's own instruction. The Harness ignores it while paused, so
 *   the attempt keeps that evidence and reports it again when the pause is released, instead of replaying the line.
 */
export const makePlayer = (media: PlayerMedia) =>
  Effect.gen(function* () {
    const client = yield* Client;
    const { element } = media;
    const status = yield* SubscriptionRef.make<PlaybackStatus>(IDLE);
    const current = yield* Ref.make<Option.Option<PlaybackInstruction>>(Option.none());
    const attempt = yield* FiberHandle.make<void, never>();

    const pausedChanges = client.view.changes.pipe(
      Stream.map(Option.exists((view) => view.paused)),
      Stream.changes,
    );

    /** Points the element at the attempt's clip; releasing stops it and frees the object URL. */
    const load = (audio: Playable, owner: Attempt) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const url =
            'url' in audio
              ? audio.url
              : media.createObjectUrl(
                  new Blob([audio.bytes as BlobPart], { type: audio.mimeType }),
                );
          element.src = url;
          return 'url' in audio ? null : url;
        }),
        (objectUrl) =>
          Effect.sync(() => {
            owner.released = true;
            element.pause();
            element.removeAttribute('src');
            element.load();
            if (objectUrl) media.revokeObjectUrl(objectUrl);
          }),
      );

    /** Resolves once the attempt's clip ends or fails. Listeners live as long as the attempt. */
    const endingOf = (mediaError: MediaError) =>
      Effect.gen(function* () {
        const ending = yield* Deferred.make<Ending>();
        const onEnded = () => void Deferred.doneUnsafe(ending, Effect.succeed('finished'));
        const onError = () => void Deferred.doneUnsafe(ending, Effect.succeed<Ending>(mediaError));
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            element.addEventListener('ended', onEnded);
            element.addEventListener('error', onError);
          }),
          () =>
            Effect.sync(() => {
              element.removeEventListener('ended', onEnded);
              element.removeEventListener('error', onError);
            }),
        );
        return ending;
      });

    const report = (instruction: PlaybackInstruction) =>
      client.finished(instruction.playbackId).pipe(
        Effect.catch((error) =>
          // No retry: a lost connection reconnects, and the Harness replays the line under a new id.
          Effect.logWarning('playback: finished not delivered').pipe(
            Effect.annotateLogs({ reason: error._tag }),
          ),
        ),
      );

    /** Plays one instruction's clip for as long as it stays current, following the session's pause. */
    const play = (instruction: PlaybackInstruction, audio: Playable) =>
      Effect.gen(function* () {
        const actionId = instruction.action.id;
        const mediaError: MediaError = { _tag: 'MediaError', streamed: 'url' in audio };
        const owner: Attempt = { released: false, paused: true, failed: false };
        yield* load(audio, owner);
        const ending = yield* endingOf(mediaError);
        const running = yield* FiberHandle.make<void, never>();

        const settle = (outcome: Ending | 'held') => {
          if (outcome === 'finished') return report(instruction);
          if (outcome === 'held') return SubscriptionRef.set(status, { kind: 'held', actionId });
          owner.failed = true;
          return SubscriptionRef.set(status, { kind: 'failed', actionId, error: outcome });
        };

        /** Starts or resumes the element from where it is, then waits for the clip to end. */
        const proceed = Effect.gen(function* () {
          // A failed clip stays failed until Retry clip fetches a fresh one.
          if (owner.failed) return;
          // An ending seen while paused (or just before Pause reached the Harness) is reported now, never replayed.
          if (Deferred.isDoneUnsafe(ending)) return yield* settle(yield* Deferred.await(ending));
          if (!(yield* media.audible)) return yield* settle('held');
          // The latest view, not only the change this attempt last saw, decides whether the element may start.
          if (Option.exists(yield* client.view.get, (view) => view.paused)) return;
          const promise = element.play();
          // Whatever happens to this fiber, a late start must not outlive a pause, and must not touch a later clip.
          promise.then(
            () => {
              if (!owner.released && owner.paused) element.pause();
            },
            () => {},
          );
          const started = yield* Effect.tryPromise(() => promise).pipe(
            Effect.matchEffect({
              onFailure: ({ cause }) =>
                // A pause or a newer instruction explains the rejection; otherwise the clip could not start.
                owner.released || owner.paused
                  ? Effect.never
                  : settle(
                      cause instanceof DOMException && cause.name === 'NotAllowedError'
                        ? 'held'
                        : mediaError,
                    ).pipe(Effect.as(false)),
              onSuccess: () => Effect.succeed(true),
            }),
            Effect.raceFirst(Effect.as(Deferred.await(ending), true)),
          );
          if (!started) return;
          if (!Deferred.isDoneUnsafe(ending))
            yield* SubscriptionRef.set(status, { kind: 'playing', actionId });
          yield* settle(yield* Deferred.await(ending));
        });

        yield* pausedChanges.pipe(
          Stream.runForEach((paused) =>
            Effect.gen(function* () {
              owner.paused = paused;
              if (!paused) return yield* FiberHandle.run(running, proceed);
              yield* FiberHandle.clear(running);
              element.pause();
              const now = yield* SubscriptionRef.get(status);
              if (now.kind !== 'failed' && now.kind !== 'held')
                yield* SubscriptionRef.set(status, { kind: 'paused', actionId });
            }),
          ),
        );
        // The view stream ends only with the Client; hold the clip until the instruction changes.
        return yield* Effect.never;
      }).pipe(Effect.scoped);

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

    // Restarts the held line from the start. It is a local recovery: it never releases the session's pause, which the
    // new attempt obeys like any other.
    const resume = whenCurrent('held', (instruction) =>
      Effect.suspend(() => {
        // Called from the tap itself, so the context may resume within the gesture.
        media.unlock();
        return start(instruction, instruction.audio);
      }),
    );

    return { status, analyser: media.analyser, retryClip, resume } satisfies Player;
  });
