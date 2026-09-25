import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Ref,
  Result,
  Stream,
  type Scope,
} from 'effect';
import { TestClock } from 'effect/testing';

import { ActionId, type Action } from '@yourtechbudstudio/fluidcast-core/actions';
import {
  PlaybackId,
  type Command,
  type SessionEvent,
  type SessionState,
  type SubscriptionMessage,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

import { memoryStore, type AudioStore } from './audio/index.ts';
import { Client, layer } from './client.ts';
import { Transport, TransportError } from './transport.ts';

const user: Action = { type: 'user_message', id: ActionId.make('user'), text: 'Hi' };
const speak = (id: string): Action => ({
  type: 'speak',
  id: ActionId.make(id),
  speaker: 'host',
  text: `Line ${id}.`,
});

const state = (actions: ReadonlyArray<Action>, cursor: number): SessionState => ({
  actions,
  cursor,
  generation: 'running',
  playback: null,
  speakers: [{ id: 'host', name: 'Host' }],
  speech: { mimeType: 'audio/ogg' },
});

const appended = (id: string): SessionEvent => ({ _tag: 'ActionAppended', action: speak(id) });
const requested = (playbackId: string, actionId: string): SessionEvent => ({
  _tag: 'PlaybackRequested',
  playbackId: PlaybackId.make(playbackId),
  actionId: ActionId.make(actionId),
});

const bytesOf = (actionId: string) => new TextEncoder().encode(`audio:${actionId}`);

type Connection = Queue.Queue<SubscriptionMessage, TransportError | Cause.Done>;

/**
 * A transport the test drives: each `subscribe` takes the next connection the test opened, and each
 * `speech` download completes when the test releases it.
 */
const fakeTransport = (options: { readonly url: boolean }) =>
  Effect.gen(function* () {
    const connections = yield* Queue.unbounded<Connection>();
    const subscribeCalls = yield* Ref.make(0);
    const sent = yield* Ref.make<ReadonlyArray<Command>>([]);
    const downloads = new Map<
      string,
      { gate: Deferred.Deferred<void>; exit: Exit.Exit<unknown, unknown> | undefined }
    >();
    const download = (actionId: string) => {
      let entry = downloads.get(actionId);
      if (entry === undefined) {
        entry = { gate: Deferred.makeUnsafe<void>(), exit: undefined };
        downloads.set(actionId, entry);
      }
      return entry;
    };

    const transport = Transport.of({
      subscribe: () =>
        Stream.unwrap(
          Ref.update(subscribeCalls, (count) => count + 1).pipe(
            Effect.andThen(Queue.take(connections)),
            Effect.map(Stream.fromQueue),
          ),
        ),
      send: (command) => Ref.update(sent, (all) => [...all, command]),
      speech: (actionId) => {
        const entry = download(actionId);
        entry.exit = undefined;
        return Stream.fromEffect(Deferred.await(entry.gate)).pipe(
          Stream.map(() => bytesOf(actionId)),
          Stream.onExit((exit) =>
            Effect.sync(() => {
              entry.exit = exit;
            }),
          ),
        );
      },
      ...(options.url ? { speechUrl: (actionId: string) => `/speech/${actionId}` } : {}),
    });

    /** Opens the next connection and returns a way to push messages into it. */
    const connect = Effect.gen(function* () {
      const connection: Connection = yield* Queue.unbounded<
        SubscriptionMessage,
        TransportError | Cause.Done
      >();
      yield* Queue.offer(connections, connection);
      return {
        send: (...messages: ReadonlyArray<SubscriptionMessage>) =>
          Effect.forEach(messages, (message) => Queue.offer(connection, message), {
            discard: true,
          }),
        fail: Queue.fail(connection, new TransportError({ reason: 'Unreachable' })),
        end: Queue.end(connection),
      };
    });

    return {
      transport,
      connect,
      subscribeCalls: Ref.get(subscribeCalls),
      sent: Ref.get(sent),
      /** Action IDs whose audio was requested, in order. */
      fetched: () => [...downloads.keys()],
      release: (actionId: string) => Deferred.succeed(download(actionId).gate, undefined),
      exitOf: (actionId: string) => downloads.get(actionId)?.exit,
    };
  });

/** Yields to other fibers until `done` holds. Uses no clock, so it works under `TestClock`. */
const eventually = <A>(effect: Effect.Effect<A>, done: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const value = yield* effect;
      if (done(value)) return value;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die('condition not reached');
  });

/** Lets other fibers run for a while. */
const settle = Effect.gen(function* () {
  for (let step = 0; step < 200; step++) yield* Effect.yieldNow;
});

const setup = (options: { readonly url: boolean }) =>
  Effect.gen(function* () {
    const fake = yield* fakeTransport(options);
    const store: AudioStore = memoryStore();
    const context = yield* Layer.build(
      layer({ store }).pipe(Layer.provide(Layer.succeed(Transport, fake.transport))),
    );
    return { ...fake, client: Context.get(context, Client), store };
  });

const run = <A>(effect: Effect.Effect<A, unknown, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

describe('Client', () => {
  it('prefetches the next three speaks as they are appended, keeping the current and evicting played audio', () =>
    run(
      Effect.gen(function* () {
        const { client, connect, fetched, release, store } = yield* setup({ url: true });
        const connection = yield* connect;
        yield* connection.send({ _tag: 'Snapshot', state: state([user], 1) });
        yield* eventually(client.connection.get, (value) => value === 'connected');

        // The speak at the cursor is left to the playback path.
        yield* connection.send(appended('a'));
        yield* settle;
        assert.deepEqual(fetched(), []);

        // Each speak ahead of the cursor is fetched as soon as it is appended, up to three.
        yield* connection.send(appended('b'));
        yield* eventually(Effect.sync(fetched), (ids) => ids.includes('b'));
        yield* connection.send(appended('c'), appended('d'), appended('e'));
        yield* eventually(Effect.sync(fetched), (ids) => ids.length === 3);
        yield* settle;
        assert.deepEqual(fetched(), ['b', 'c', 'd']);

        const view = Option.getOrThrow(yield* client.view.get);
        assert.deepEqual(
          view.actions.map((action) => action.id),
          ['user', 'a'],
        );
        assert.equal(view.phase, 'speaking');

        // Moving on starts the next line and keeps the new current line's audio.
        yield* release('b');
        yield* eventually(store.keys, (keys) => keys.includes('b'));
        yield* connection.send({ _tag: 'CursorMoved', cursor: 2 });
        yield* eventually(Effect.sync(fetched), (ids) => ids.includes('e'));
        assert.deepEqual(yield* store.keys, ['b']);

        yield* connection.send(requested('p-b', 'b'));
        const instruction = yield* eventually(client.playback.get, Option.isSome);
        assert.equal(instruction.value.playbackId, 'p-b');
        assert.deepEqual(
          instruction.value.audio,
          Result.succeed({ bytes: bytesOf('b'), mimeType: 'audio/ogg' }),
        );

        // Once the cursor passes it, the line stops playing and its audio is evicted.
        yield* connection.send({ _tag: 'CursorMoved', cursor: 3 });
        yield* eventually(client.playback.get, Option.isNone);
        yield* eventually(store.keys, (keys) => !keys.includes('b'));
      }),
    ));

  it('cancels prefetches for trimmed actions only', () =>
    run(
      Effect.gen(function* () {
        const { client, connect, fetched, release, exitOf, store } = yield* setup({ url: true });
        const connection = yield* connect;
        yield* connection.send(
          { _tag: 'Snapshot', state: state([user, speak('a')], 1) },
          appended('b'),
          appended('c'),
          appended('d'),
        );
        yield* eventually(Effect.sync(fetched), (ids) => ids.length === 3);

        yield* connection.send({ _tag: 'ActionsTrimmed', from: 3 });
        yield* eventually(
          Effect.sync(() => exitOf('d')),
          (exit) => exit !== undefined,
        );
        const cancelled = [exitOf('c'), exitOf('d')];
        assert.ok(cancelled.every((exit) => exit !== undefined && Exit.hasInterrupts(exit)));
        assert.equal(exitOf('b'), undefined);

        yield* release('b');
        yield* eventually(store.keys, (keys) => keys.includes('b'));
        assert.equal(Option.getOrThrow(yield* client.view.get).actions.length, 2);
      }),
    ));

  it('plays a line that is not fully cached from its URL, cancelling only its prefetch', () =>
    run(
      Effect.gen(function* () {
        const { client, connect, fetched, exitOf } = yield* setup({ url: true });
        const connection = yield* connect;
        yield* connection.send(
          { _tag: 'Snapshot', state: state([user, speak('a'), speak('b'), speak('c')], 1) },
          requested('p-a', 'a'),
        );
        const first = yield* eventually(client.playback.get, Option.isSome);
        assert.deepEqual(first.value.audio, Result.succeed({ url: '/speech/a' }));
        assert.ok(!fetched().includes('a'));

        // `b` is still downloading when it becomes current: only its prefetch is cancelled.
        yield* connection.send({ _tag: 'CursorMoved', cursor: 2 }, requested('p-b', 'b'));
        const second = yield* eventually(
          client.playback.get,
          (value) => Option.isSome(value) && value.value.playbackId === 'p-b',
        );
        assert.deepEqual(Option.getOrThrow(second).audio, Result.succeed({ url: '/speech/b' }));
        const exit = exitOf('b');
        assert.ok(exit !== undefined && Exit.hasInterrupts(exit));
        assert.equal(exitOf('c'), undefined);
      }),
    ));

  it('downloads a line completely when the transport has no URL, and reuses it for a retry', () =>
    run(
      Effect.gen(function* () {
        const { client, connect, fetched, release, sent } = yield* setup({ url: false });
        const connection = yield* connect;
        yield* connection.send(
          { _tag: 'Snapshot', state: state([user, speak('a')], 1) },
          requested('p-a', 'a'),
        );
        yield* eventually(Effect.sync(fetched), (ids) => ids.includes('a'));
        yield* settle;
        assert.ok(Option.isNone(yield* client.playback.get));
        yield* release('a');
        const instruction = yield* eventually(client.playback.get, Option.isSome);
        const expected = { bytes: bytesOf('a'), mimeType: 'audio/ogg' };
        assert.deepEqual(instruction.value.audio, Result.succeed(expected));

        // Retrying the clip needs no backend command and no new download.
        assert.deepEqual(yield* client.playable('a'), expected);
        yield* client.finished(instruction.value.playbackId);
        assert.deepEqual(yield* sent, [{ _tag: 'PlaybackFinished', playbackId: 'p-a' }]);
      }),
    ));

  it('reconnects with exponential backoff, resets after a snapshot, and stops when superseded', () =>
    run(
      Effect.gen(function* () {
        const { client, connect, subscribeCalls } = yield* setup({ url: true });
        const calls = (count: number) => eventually(subscribeCalls, (value) => value === count);

        yield* calls(1);
        let expected = 1;
        for (const delay of [250, 500, 1000, 2000, 4000, 5000, 5000]) {
          const connection = yield* connect;
          yield* connection.fail;
          yield* eventually(client.connection.get, (value) => value === 'reconnecting');
          yield* TestClock.adjust(delay - 1);
          yield* settle;
          assert.equal(yield* subscribeCalls, expected, `no reconnect before ${delay} ms`);
          yield* TestClock.adjust(1);
          yield* calls(++expected);
        }

        // A snapshot resets the backoff; a subscription that just ends is a lost connection.
        const recovered = yield* connect;
        yield* recovered.send({ _tag: 'Snapshot', state: state([], 0) });
        yield* eventually(client.connection.get, (value) => value === 'connected');
        yield* recovered.end;
        yield* eventually(client.connection.get, (value) => value === 'reconnecting');
        yield* TestClock.adjust(250);
        yield* calls(++expected);

        const last = yield* connect;
        yield* last.send({ _tag: 'Snapshot', state: state([], 0) }, { _tag: 'Superseded' });
        yield* eventually(client.connection.get, (value) => value === 'superseded');
        yield* TestClock.adjust('1 minute');
        yield* settle;
        assert.equal(yield* subscribeCalls, expected);
      }).pipe(Effect.provide(TestClock.layer())),
    ));
});
