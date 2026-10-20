import { Deferred, Effect, Exit, Layer, Option, Result, Scope, SubscriptionRef } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  Client,
  type ConversationView,
  type PlaybackInstruction,
  type Playable,
} from '@yourtechbudstudio/fluidcast-client';
import type { ActionId } from '@yourtechbudstudio/fluidcast-core/actions';
import type { PlaybackId } from '@yourtechbudstudio/fluidcast-harness/protocol';

import { fakeGate, fakeMedia } from './fakeMedia';
import type { PlaybackStatus } from './model';
import { makePlayer } from './player';

const pid = (id: string) => id as PlaybackId;

const speakOf = (id: string) => ({
  type: 'speak' as const,
  id: id as ActionId,
  speaker: 'host',
  text: `Line ${id}.`,
});

const bytes: Playable = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg' };

const instruction = (
  id: string,
  playbackId = `p-${id}`,
  audio: PlaybackInstruction['audio'] = Result.succeed(bytes),
): PlaybackInstruction => ({ playbackId: pid(playbackId), action: speakOf(id), audio });

const viewOf = (paused: boolean): ConversationView => ({
  actions: [],
  phase: 'speaking',
  frontierPhase: 'speaking',
  paused,
  controls: { back: false, next: false, play: paused, pause: !paused, send: false },
  speakers: [],
  executions: [],
  pendingResults: [],
  start: null,
  started: null,
  presented: undefined,
});

const unused = () => Effect.die('unused in these tests');

/**
 * The player over a fake element, a fake Client whose view and instruction the test drives, and a fake gate (open
 * unless the options say otherwise). `audibility` replaces the media's answer, for a test to hold it.
 */
const setup = (
  options: {
    readonly audible?: boolean;
    readonly paused?: boolean;
    readonly authorized?: boolean;
    readonly audibility?: Effect.Effect<boolean>;
  } = {},
) =>
  Effect.gen(function* () {
    const fake = fakeMedia(options);
    const { element, revoked, unlocks, setAudible } = fake;
    const media = options.audibility ? { ...fake.media, audible: options.audibility } : fake.media;
    const { gate, flags, deliver } = yield* fakeGate({ authorized: options.authorized ?? true });
    const view = yield* SubscriptionRef.make(Option.some(viewOf(options.paused ?? false)));
    const playback = yield* SubscriptionRef.make<Option.Option<PlaybackInstruction>>(Option.none());
    const finished: PlaybackId[] = [];
    const fresh: string[] = [];
    const client = Client.of({
      view: { get: SubscriptionRef.get(view), changes: SubscriptionRef.changes(view) },
      connection: { get: Effect.succeed('connected'), changes: unused() as never },
      playback: { get: SubscriptionRef.get(playback), changes: SubscriptionRef.changes(playback) },
      sendMessage: unused,
      interrupt: unused,
      retry: unused,
      back: unused,
      start: unused,
      pause: unused,
      play: unused,
      next: unused,
      sendToolCommand: unused,
      finished: (playbackId) => Effect.sync(() => void finished.push(playbackId)),
      playable: (actionId) => Effect.sync(() => (fresh.push(actionId), bytes)),
    });
    const scope = yield* Scope.make();
    const player = yield* makePlayer(media, gate).pipe(
      Effect.provide(Layer.succeed(Client, client)),
      Scope.provide(scope),
    );
    // A moment, then enough scheduler turns for every queued fiber step: a busy machine can delay the timer past the
    // work it waits for, but not reorder the turns.
    const settle = Effect.andThen(
      Effect.sleep('5 millis'),
      Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true }),
    );
    return {
      element,
      player,
      revoked,
      finished,
      fresh,
      unlocks,
      setAudible,
      scope,
      settle,
      status: SubscriptionRef.get(player.status),
      play: (next: PlaybackInstruction) =>
        Effect.andThen(SubscriptionRef.set(playback, Option.some(next)), settle),
      clear: Effect.andThen(SubscriptionRef.set(playback, Option.none()), settle),
      pause: (paused: boolean) =>
        Effect.andThen(SubscriptionRef.set(view, Option.some(viewOf(paused))), settle),
      /** The listener's intent, written as the command hooks do. */
      authorize: () => void (flags.authorized = true),
      /** Closes the gate the way a hide (`revoke`) or an unmount does, before the stream delivers it. */
      close: (revoke: boolean) => {
        flags.present = false;
        if (revoke) flags.authorized = false;
      },
      /** The presence stream reaches the player. */
      deliver: Effect.andThen(deliver, settle),
      /** Hidden, delivered: the synchronous write and the stream together. */
      hide: Effect.suspend(() => {
        flags.present = false;
        flags.authorized = false;
        return Effect.andThen(deliver, settle);
      }),
      show: Effect.suspend(() => {
        flags.present = true;
        return Effect.andThen(deliver, settle);
      }),
    };
  });

const run = <A>(effect: Effect.Effect<A, never, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

const kindOf = (status: PlaybackStatus) => status.kind;

describe('player', () => {
  it('keeps the source, position and playback across Pause and Play, resuming the same clip', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        expect(t.element.plays).toBe(1);
        expect(kindOf(yield* t.status)).toBe('playing');
        t.element.currentTime = 3.2;

        yield* t.pause(true);
        expect(t.element.pauses).toBe(1);
        expect(t.element.src).toBe('blob:1');
        expect(t.revoked).toEqual([]);
        expect(yield* t.status).toEqual({ kind: 'paused', actionId: 'a' });

        yield* t.pause(false);
        expect(t.element.plays).toBe(2);
        expect(t.element.sources).toEqual(['blob:1']);
        expect(t.element.currentTime).toBe(3.2);
        expect(kindOf(yield* t.status)).toBe('playing');
      }),
    ));

  it('never restarts on a repeated Play', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        yield* t.pause(false);
        yield* t.pause(false);
        expect(t.element.plays).toBe(1);
        expect(t.element.sources).toEqual(['blob:1']);
      }),
    ));

  it('loads a clip that resolves while paused, but starts it only on Play', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup({ paused: true });
        yield* t.play(instruction('a'));
        expect(t.element.sources).toEqual(['blob:1']);
        expect(t.element.plays).toBe(0);
        expect(kindOf(yield* t.status)).toBe('paused');
        yield* t.pause(false);
        expect(t.element.plays).toBe(1);
      }),
    ));

  it('holds a start that resolves after Pause, and reads its rejection as the pause', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        t.element.mode = 'manual';
        yield* t.play(instruction('a'));
        expect(t.element.plays).toBe(1);
        yield* t.pause(true);
        const pauses = t.element.pauses;
        // The browser may still start it: the player pauses it again, and never reports it playing.
        t.element.settlePlay('resolve');
        yield* t.settle;
        expect(t.element.pauses).toBe(pauses + 1);
        expect(kindOf(yield* t.status)).toBe('paused');

        yield* t.pause(false);
        yield* t.pause(true);
        t.element.settlePlay(new DOMException('interrupted', 'AbortError'));
        yield* t.settle;
        expect(kindOf(yield* t.status)).toBe('paused');
      }),
    ));

  it('still reports a genuine failure to start', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        t.element.mode = 'manual';
        yield* t.play(instruction('a'));
        t.element.settlePlay(new DOMException('bad', 'NotSupportedError'));
        yield* t.settle;
        expect(yield* t.status).toEqual({
          kind: 'failed',
          actionId: 'a',
          error: { _tag: 'MediaError', streamed: false },
        });
        // Play does not hide or retry a failed clip.
        yield* t.pause(true);
        yield* t.pause(false);
        expect(t.element.plays).toBe(1);
        expect(kindOf(yield* t.status)).toBe('failed');
      }),
    ));

  it('frees the old source when paused navigation selects another line, which waits for Play', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        yield* t.pause(true);
        yield* t.clear;
        expect(t.revoked).toEqual(['blob:1']);
        expect(t.element.src).toBe('');
        expect(kindOf(yield* t.status)).toBe('idle');

        // After a reconnect, Play authorizes the line again under a fresh ID.
        yield* t.play(instruction('b'));
        expect(t.element.sources).toEqual(['blob:1', 'blob:2']);
        expect(t.element.plays).toBe(1);
        yield* t.pause(false);
        expect(t.element.plays).toBe(2);
      }),
    ));

  it('never lets an earlier clip’s late start or failure touch its replacement', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        t.element.mode = 'manual';
        yield* t.play(instruction('a'));
        yield* t.play(instruction('b'));
        // b's start succeeds; then a's settles late, both ways.
        t.element.settlePlay('resolve'); // a's
        t.element.settlePlay('resolve'); // b's
        yield* t.settle;
        const pauses = t.element.pauses;
        expect(yield* t.status).toEqual({ kind: 'playing', actionId: 'b' });

        yield* t.play(instruction('c'));
        yield* t.play(instruction('d'));
        t.element.settlePlay(new DOMException('gone', 'NotSupportedError')); // c's
        yield* t.settle;
        expect(kindOf(yield* t.status)).not.toBe('failed');
        expect(t.element.pauses).toBeGreaterThan(pauses); // only the releases of b and c
        t.element.settlePlay('resolve'); // d's
        yield* t.settle;
        expect(yield* t.status).toEqual({ kind: 'playing', actionId: 'd' });
      }),
    ));

  it('reports a clip that ended as Pause landed again on Play, without replaying it', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        // The clip ends; its finished races the Pause and the Harness ignores it.
        t.element.end();
        yield* t.pause(true);
        expect(t.finished).toEqual([pid('p-a')]);
        yield* t.pause(false);
        expect(t.finished).toEqual([pid('p-a'), pid('p-a')]);
        expect(t.element.plays).toBe(1);
        expect(t.revoked).toEqual([]);
      }),
    ));

  it('keeps an ending that fires after the pause took hold', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        yield* t.pause(true);
        t.element.end();
        yield* t.settle;
        expect(t.finished).toEqual([]);
        yield* t.pause(false);
        expect(t.finished).toEqual([pid('p-a')]);
        expect(t.element.plays).toBe(1);
      }),
    ));

  it('fetches a fresh clip on Retry clip, and obeys the pause when it arrives', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        const missing = Result.fail({ _tag: 'TransportError', reason: 'Unreachable' } as never);
        yield* t.play(instruction('a', 'p-a', missing));
        expect(kindOf(yield* t.status)).toBe('failed');
        yield* t.pause(true);
        yield* t.player.retryClip;
        yield* t.settle;
        expect(t.fresh).toEqual(['a']);
        expect(t.element.sources).toEqual(['blob:1']);
        expect(t.element.plays).toBe(0);
        yield* t.pause(false);
        expect(t.element.plays).toBe(1);
      }),
    ));

  it('restarts a held line on the gesture without releasing the session’s pause', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup({ audible: false });
        yield* t.play(instruction('a'));
        expect(kindOf(yield* t.status)).toBe('held');
        yield* t.pause(true);
        expect(kindOf(yield* t.status)).toBe('held');
        t.setAudible(true);
        yield* t.player.resume;
        yield* t.settle;
        expect(t.unlocks()).toBe(1);
        expect(t.element.plays).toBe(0);
        expect(kindOf(yield* t.status)).toBe('paused');
        yield* t.pause(false);
        expect(t.element.plays).toBe(1);
      }),
    ));

  it('frees the source when the player is disposed', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        yield* t.pause(true);
        yield* Scope.close(t.scope, Exit.void);
        expect(t.revoked).toEqual(['blob:1']);
        expect(t.element.src).toBe('');
      }),
    ));
});

describe('player gate', () => {
  it('holds a line the listener has not asked for, without starting or unlocking it', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup({ authorized: false });
        yield* t.play(instruction('a'));
        expect(kindOf(yield* t.status)).toBe('held');
        expect(t.element.plays).toBe(0);
        expect(t.unlocks()).toBe(0);
      }),
    ));

  it('plays once authorized, holds back while hidden, and holds again on show without new intent', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        expect(kindOf(yield* t.status)).toBe('playing');
        const pauses = t.element.pauses;
        yield* t.hide;
        expect(t.element.pauses).toBeGreaterThan(pauses);
        expect(kindOf(yield* t.status)).toBe('paused');
        yield* t.show;
        expect(kindOf(yield* t.status)).toBe('held');
        expect(t.element.plays).toBe(1);
        expect(t.finished).toEqual([]);
      }),
    ));

  it('stays paused on show while the session is paused', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        yield* t.pause(true);
        yield* t.hide;
        yield* t.show;
        expect(kindOf(yield* t.status)).toBe('paused');
        expect(t.element.plays).toBe(1);
      }),
    ));

  for (const revoke of [true, false])
    it(`starts nothing once the gate closed while audibility was awaited (${revoke ? 'hide' : 'unmount'})`, () =>
      run(
        Effect.gen(function* () {
          const audibility = yield* Deferred.make<boolean>();
          const t = yield* setup({ audibility: Deferred.await(audibility) });
          yield* t.play(instruction('a'));
          expect(t.element.plays).toBe(0);
          t.close(revoke);
          yield* Deferred.succeed(audibility, true);
          yield* t.settle;
          expect(t.element.plays).toBe(0);
          yield* t.deliver;
          expect(kindOf(yield* t.status)).toBe('paused');
          expect(t.element.plays).toBe(0);
        }),
      ));

  it('reports no completion that lands after the gate closed, and replays the line on Tap to resume', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        expect(kindOf(yield* t.status)).toBe('playing');
        // Hidden: the gate is closed, but the stream has not reached the player yet when the clip ends.
        t.close(true);
        t.element.end();
        yield* t.settle;
        expect(t.finished).toEqual([]);
        yield* t.deliver;
        expect(kindOf(yield* t.status)).toBe('paused');
        // Shown again without new intent (the hide's Pause failed, so the session is unpaused).
        yield* t.show;
        expect(t.finished).toEqual([]);
        expect(kindOf(yield* t.status)).toBe('held');
        t.authorize();
        yield* t.player.resume;
        yield* t.settle;
        expect(t.element.plays).toBe(2);
        expect(t.element.sources).toEqual(['blob:1', 'blob:2']);
        expect(kindOf(yield* t.status)).toBe('playing');
        expect(t.finished).toEqual([]);
      }),
    ));

  it('reports an ending retained while hidden once released with the gate open, without replaying it', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        // Not present (as while unmounting), but still authorized.
        t.close(false);
        yield* t.deliver;
        t.element.end();
        yield* t.settle;
        expect(t.finished).toEqual([]);
        yield* t.show;
        expect(t.finished).toEqual([pid('p-a')]);
        expect(t.element.plays).toBe(1);
      }),
    ));

  it('keeps an ending retained while hidden when released with the gate closed', () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.play(instruction('a'));
        yield* t.hide;
        t.element.end();
        yield* t.settle;
        yield* t.show;
        expect(kindOf(yield* t.status)).toBe('held');
        expect(t.finished).toEqual([]);
        expect(t.element.plays).toBe(1);
      }),
    ));
});
