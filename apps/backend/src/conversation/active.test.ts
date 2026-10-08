import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Deferred, Duration, Effect, Fiber, Layer, Option, Stream } from 'effect';
import { LanguageModel } from 'effect/ai';

import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';

import { ActiveSession, activeSessionLayer, makeActiveSession } from './active.ts';
import { conversationConfig, fakeBuild, fakeSources, startNew } from './fixtures.test.ts';

/** Runs `body` with an `ActiveSession` over `build`, discarding it afterwards. */
const withActive = <A, E>(
  build: ReturnType<typeof fakeBuild>['build'],
  body: Effect.Effect<A, E, ActiveSession>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const active = yield* makeActiveSession(build);
      return yield* Effect.provideService(body, ActiveSession, active);
    }).pipe(Effect.scoped),
  );

const currentStatus = Effect.gen(function* () {
  const status = yield* Stream.runHead((yield* ActiveSession).status);
  return Option.getOrThrow(status);
});

/** Waits for a forked stream to end, failing the test if it does not end promptly. */
const ends = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Fiber.join(fiber).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(2),
      orElse: () => Effect.die('the stream did not end'),
    }),
  );

describe('ActiveSession', () => {
  it('starts with no session, and start publishes Active with a new ID', async () => {
    const { build, log } = fakeBuild();
    await withActive(
      build,
      Effect.gen(function* () {
        assert.deepEqual(yield* currentStatus, { _tag: 'NoSession' });
        const id = yield* startNew;
        assert.deepEqual(yield* currentStatus, { _tag: 'Active', id });
        const live = yield* (yield* ActiveSession).current(id);
        assert.equal(live.id, id);
        assert.deepEqual(log.started, ['new']);
      }),
    );
  });

  it('refuses a second start while a session is live, leaving it untouched', async () => {
    const { build, log } = fakeBuild();
    await withActive(
      build,
      Effect.gen(function* () {
        const active = yield* ActiveSession;
        const id = yield* startNew;
        const second = yield* Effect.flip(active.start({ mode: 'new', agent: 'claude' }));
        assert.equal(second._tag, 'SessionActive');
        assert.deepEqual(yield* currentStatus, { _tag: 'Active', id });
        assert.deepEqual(log.started, ['new']);
      }),
    );
  });

  it('reset ends the bound streams, requests the close, publishes NoSession, and allows a new start', async () => {
    const { build, log } = fakeBuild();
    await withActive(
      build,
      Effect.gen(function* () {
        const active = yield* ActiveSession;
        const id = yield* startNew;
        const live = yield* active.current(id);
        const subscription = yield* Effect.forkChild(
          Stream.runDrain(live.bound(live.session.subscribe())),
        );
        const workerStatus = yield* Effect.forkChild(
          Stream.runDrain(live.bound(live.worker.status)),
        );
        // Let both streams start before the reset.
        yield* Effect.sleep(Duration.millis(20));

        yield* active.reset(id);
        // Close was requested before `reset` returned. The process exit is not awaited (D2).
        assert.deepEqual(log.closed, [0]);
        yield* ends(subscription);
        yield* ends(workerStatus);
        assert.deepEqual(yield* currentStatus, { _tag: 'NoSession' });
        assert.equal((yield* Effect.flip(active.current(id)))._tag, 'NoSession');

        const next = yield* startNew;
        assert.notEqual(next, id);
        assert.deepEqual(yield* currentStatus, { _tag: 'Active', id: next });
      }),
    );
  });

  it('answers NoSession for an unknown ID and for an old ID after a restart, leaving the live session untouched', async () => {
    const { build, log } = fakeBuild();
    await withActive(
      build,
      Effect.gen(function* () {
        const active = yield* ActiveSession;
        const old = yield* startNew;
        yield* active.reset(old);
        const id = yield* startNew;

        assert.equal((yield* Effect.flip(active.reset('unknown')))._tag, 'NoSession');
        assert.equal((yield* Effect.flip(active.reset(old)))._tag, 'NoSession');
        assert.equal((yield* Effect.flip(active.current(old)))._tag, 'NoSession');
        assert.equal((yield* active.current(id)).id, id);
        assert.deepEqual(yield* currentStatus, { _tag: 'Active', id });
        assert.deepEqual(log.closed, [0]);
      }),
    );
  });

  it('leaves NoSession after a failing build, and closes its scope', async () => {
    const { build, log } = fakeBuild({ fail: 'NoAnswer' });
    await withActive(
      build,
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          (yield* ActiveSession).start({ mode: 'new', agent: 'claude' }),
        );
        assert.deepEqual(failure._tag === 'StartFailed' && failure.reason, 'NoAnswer');
        assert.deepEqual(log.closed, [0]);
        assert.deepEqual(yield* currentStatus, { _tag: 'NoSession' });
      }),
    );
  });

  it('discards the live session when the service is discarded', async () => {
    const { build, log } = fakeBuild();
    await withActive(build, startNew);
    assert.deepEqual(log.closed, [0]);
  });

  it('completes a start whose caller is interrupted mid-build', async () => {
    const { build } = fakeBuild();
    const building = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const gated = (request: Parameters<typeof build>[0]) =>
      Deferred.succeed(building, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(build(request)),
      );
    await withActive(
      gated,
      Effect.gen(function* () {
        const active = yield* ActiveSession;
        const fiber = yield* Effect.forkChild(active.start({ mode: 'new', agent: 'claude' }));
        yield* Deferred.await(building);
        // The interrupt waits for the uninterruptible start, which finishes once released.
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(fiber));
        // Let the interrupt reach the start fiber before the build is released.
        yield* Effect.sleep(Duration.millis(20));
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(interrupting);
        assert.equal((yield* currentStatus)._tag, 'Active');
      }),
    );
  });
});

describe('activeSessionLayer', () => {
  it("tears down the session's own resources on Reset, before it returns", async () => {
    const generating = Deferred.makeUnsafe<void>();
    let generationStopped = false;
    // A model whose generation starts and never finishes, recording when it is stopped.
    const model = LanguageModel.make({
      generateText: () => Effect.never,
      streamText: () =>
        Stream.fromEffect(Deferred.succeed(generating, undefined)).pipe(
          Stream.flatMap(() => Stream.never),
          Stream.ensuring(Effect.sync(() => (generationStopped = true))),
        ) as never,
    });
    const providers = Layer.mergeAll(
      Layer.effect(LanguageModel.LanguageModel, model),
      Layer.succeed(
        SpeechSynthesizer,
        SpeechSynthesizer.of({ synthesize: () => Effect.die('unused') as never }),
      ),
      NodeServices.layer,
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const active = yield* ActiveSession;
        const id = yield* startNew;
        const live = yield* active.current(id);
        yield* Effect.forkChild(Stream.runDrain(live.bound(live.session.subscribe())));
        yield* live.session.command({ _tag: 'SendMessage', text: 'Hello' });
        yield* Deferred.await(generating);

        yield* active.reset(id);
        assert.equal(generationStopped, true);
      }).pipe(
        Effect.provide(
          activeSessionLayer(conversationConfig(), 'opus', fakeSources({}).sources).pipe(
            Layer.provide(providers),
          ),
        ),
        Effect.scoped,
      ),
    );
  });
});
