import {
  Context,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import {
  NoSession,
  SessionActive,
  type SessionStatus,
  type StartFailed,
  type StartRequest,
} from '@fluidcast/app-contract';
import { uuidv7 } from '@yourtechbudstudio/fluidcast-core/actions';
import { type AudioFormat, SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';

import {
  type BuiltSession,
  buildSession,
  type ConversationConfig,
  referenceSources,
  type SessionSources,
} from './session.ts';

/** The live session, as routes see it. */
export interface LiveSession extends BuiltSession {
  /** The backend's own ID for this session (a UUIDv7 per start), not the agent's. */
  readonly id: string;
  /** Ends `stream` (normally) when this session is discarded. For SSE streams only, not speech. */
  readonly bound: <A, E, R>(stream: Stream.Stream<A, E, R>) => Stream.Stream<A, E, R>;
}

/** Holds at most one live session, started and reset at runtime. */
export class ActiveSession extends Context.Service<
  ActiveSession,
  {
    /** The current status, then each change. */
    readonly status: Stream.Stream<SessionStatus>;
    /** The live session if `id` names it. Any other ID is `NoSession`, never another session. */
    readonly current: (id: string) => Effect.Effect<LiveSession, NoSession>;
    /** Builds and publishes a session. Refuses while one is live. Uninterruptible. */
    readonly start: (request: StartRequest) => Effect.Effect<void, StartFailed | SessionActive>;
    /**
     * Ends its SSE streams, tears it down (the Harness, then the worker's close) and publishes
     * `NoSession`. Uninterruptible. The worker process's exit is not awaited: closing the worker
     * starts its own shutdown.
     */
    readonly reset: (id: string) => Effect.Effect<void, NoSession>;
  }
>()('@fluidcast/backend/ActiveSession') {}

interface Entry {
  readonly live: LiveSession;
  readonly scope: Scope.Closeable;
  readonly ended: Deferred.Deferred<void>;
}

const toStatus = (entry: Option.Option<Entry>): SessionStatus =>
  Option.match(entry, {
    onNone: () => ({ _tag: 'NoSession' }),
    onSome: ({ live }) => ({ _tag: 'Active', id: live.id }),
  });

const sameStatus = (a: SessionStatus, b: SessionStatus) =>
  a._tag === b._tag && (a._tag === 'NoSession' || a.id === (b as typeof a).id);

/**
 * The service over a build function, in the current scope; its finalizer discards the live
 * session. `start` and `reset` hold one lock and run uninterruptibly, so a caller that goes away
 * cannot leave a half-built or half-closed session.
 */
export const makeActiveSession = (
  build: (request: StartRequest) => Effect.Effect<BuiltSession, StartFailed, Scope.Scope>,
): Effect.Effect<ActiveSession['Service'], never, Scope.Scope> =>
  Effect.gen(function* () {
    const entry = yield* SubscriptionRef.make(Option.none<Entry>());
    const lock = yield* Semaphore.make(1);
    const locked = <A, E>(effect: Effect.Effect<A, E>) =>
      lock.withPermits(1)(Effect.uninterruptible(effect));

    /** Ends the bound streams, then closes the session's scope, then publishes `NoSession`. */
    const discard = ({ live, scope, ended }: Entry) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(ended, undefined);
        // The Harness's finalizers, then the Forward Agent tool's, which close the worker.
        yield* Scope.close(scope, Exit.void);
        yield* SubscriptionRef.set(entry, Option.none());
        yield* Effect.logInfo('session: reset').pipe(Effect.annotateLogs({ sessionId: live.id }));
      });

    yield* Effect.addFinalizer(() =>
      lock.withPermits(1)(
        Effect.flatMap(SubscriptionRef.get(entry), (current) =>
          Option.isSome(current) ? discard(current.value) : Effect.void,
        ),
      ),
    );

    const start = (request: StartRequest) =>
      locked(
        Effect.gen(function* () {
          if (Option.isSome(yield* SubscriptionRef.get(entry))) {
            return yield* Effect.fail(new SessionActive());
          }
          const scope = yield* Scope.make();
          const built = yield* build(request).pipe(
            Scope.provide(scope),
            Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
          );
          const ended = yield* Deferred.make<void>();
          const id = uuidv7();
          const live: LiveSession = {
            ...built,
            id,
            bound: (stream) => Stream.interruptWhen(stream, Deferred.await(ended)),
          };
          yield* SubscriptionRef.set(entry, Option.some({ live, scope, ended }));
          yield* Effect.logInfo('session: started').pipe(
            Effect.annotateLogs({ mode: request.mode, agent: request.agent, sessionId: id }),
          );
        }).pipe(
          Effect.tapError((error) =>
            error._tag === 'SessionActive'
              ? Effect.logInfo('session: start refused').pipe(
                  Effect.annotateLogs({ mode: request.mode, agent: request.agent }),
                )
              : Effect.logInfo('session: start failed').pipe(
                  Effect.annotateLogs({
                    mode: request.mode,
                    agent: request.agent,
                    reason: error.reason,
                  }),
                ),
          ),
        ),
      );

    const reset = (id: string) =>
      locked(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(entry);
          if (Option.isNone(current) || current.value.live.id !== id) {
            return yield* Effect.fail(new NoSession());
          }
          yield* discard(current.value);
        }),
      );

    // No lock: at worst this returns a session about to be discarded, whose streams `bound` ends.
    const current = (id: string) =>
      Effect.flatMap(SubscriptionRef.get(entry), (value) =>
        Option.isSome(value) && value.value.live.id === id
          ? Effect.succeed(value.value.live)
          : Effect.fail(new NoSession()),
      );

    const status = SubscriptionRef.changes(entry).pipe(
      Stream.map(toStatus),
      Stream.changesWith(sameStatus),
    );

    return ActiveSession.of({ status, current, start, reset });
  });

/**
 * The reference backend's `ActiveSession`: each start builds a session with `buildSession` over
 * the services captured here, in that session's own scope.
 */
export const activeSessionLayer = (
  config: ConversationConfig,
  speechFormat: AudioFormat,
  sources: SessionSources = referenceSources,
): Layer.Layer<
  ActiveSession,
  never,
  LanguageModel.LanguageModel | SpeechSynthesizer | FileSystem.FileSystem | Path.Path
> =>
  Layer.effect(
    ActiveSession,
    Effect.gen(function* () {
      // Only these four: the full context also holds this layer's own `Scope`, which would replace
      // each session's scope, so Reset would close a scope that owns nothing.
      const services = Context.pick(
        LanguageModel.LanguageModel,
        SpeechSynthesizer,
        FileSystem.FileSystem,
        Path.Path,
      )(
        yield* Effect.context<
          LanguageModel.LanguageModel | SpeechSynthesizer | FileSystem.FileSystem | Path.Path
        >(),
      );
      return yield* makeActiveSession((request) =>
        buildSession(config, speechFormat, request, sources).pipe(Effect.provideContext(services)),
      );
    }),
  );
