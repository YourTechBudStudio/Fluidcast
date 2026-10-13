import { Effect, Exit, Layer, Option, Result, Scope, SubscriptionRef } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  Client,
  type ConversationView,
  type PlaybackInstruction,
  type Playable,
} from '@yourtechbudstudio/fluidcast-client';
import type { ActionId } from '@yourtechbudstudio/fluidcast-core/actions';
import type { PlaybackId } from '@yourtechbudstudio/fluidcast-harness/protocol';

import { fakeMedia } from './fakeMedia';
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
  presented: undefined,
});

const unused = () => Effect.die('unused in these tests');

/** The player over a fake element and a fake Client whose view and instruction the test drives. */
const setup = (options: { readonly audible?: boolean; readonly paused?: boolean } = {}) =>
  Effect.gen(function* () {
    const { media, element, revoked, unlocks, setAudible } = fakeMedia(options);
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
    const player = yield* makePlayer(media).pipe(
      Effect.provide(Layer.succeed(Client, client)),
      Scope.provide(scope),
    );
    const settle = Effect.sleep('5 millis');
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
