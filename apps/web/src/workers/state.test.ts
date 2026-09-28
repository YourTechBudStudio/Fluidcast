import { Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { TransportError } from '@yourtechbudstudio/fluidcast-client';
import {
  type TranscriptEntry,
  type TranscriptMessage,
  WorkerNotFound,
  type WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import {
  applyTranscript,
  applyWorkerList,
  connections,
  type FeedEvent,
  type FeedState,
  foldFeed,
  initialFeed,
  selectedWorker,
} from './state';

const entry = (value: string): TranscriptEntry => ({
  _tag: 'text',
  parentToolUseId: null,
  text: value,
});
const snapshot = (...values: string[]): TranscriptMessage => ({
  _tag: 'TranscriptSnapshot',
  agent: 'brainstorm',
  sessionId: 's',
  entries: values.map(entry),
});
const appended = (...values: string[]): TranscriptMessage => ({
  _tag: 'TranscriptAppended',
  entries: values.map(entry),
});
const message = <M>(value: M): FeedEvent<M> => ({ _tag: 'message', message: value });

const foldTranscript = (events: ReadonlyArray<FeedEvent<TranscriptMessage>>) =>
  events.reduce<FeedState<ReadonlyArray<TranscriptEntry>>>(
    (state, event) => foldFeed(state, event, applyTranscript),
    initialFeed,
  );
const texts = (state: FeedState<ReadonlyArray<TranscriptEntry>>) =>
  state.feed.data?.map((e) => (e._tag === 'text' ? e.text : e._tag));

describe('the transcript feed', () => {
  it('connects, then takes the snapshot and appends what follows', () => {
    expect(initialFeed.feed).toEqual({ data: undefined, connection: 'connecting' });
    const state = foldTranscript([message(snapshot('a', 'b')), message(appended('c'))]);
    expect(state.feed.connection).toBe('live');
    expect(texts(state)).toEqual(['a', 'b', 'c']);
  });

  it('keeps what arrived when the connection drops, and replaces it with the next snapshot', () => {
    const dropped = foldTranscript([
      message(snapshot('a')),
      message(appended('b')),
      { _tag: 'dropped' },
    ]);
    expect(dropped.feed.connection).toBe('reconnecting');
    expect(texts(dropped)).toEqual(['a', 'b']);
    const again = foldTranscript([
      message(snapshot('a')),
      message(appended('b')),
      { _tag: 'dropped' },
      // Appended entries before the new connection's snapshot are never merged into the old data.
      message(appended('x')),
      message(snapshot('a', 'b', 'c')),
    ]);
    expect(again.feed.connection).toBe('live');
    expect(texts(again)).toEqual(['a', 'b', 'c']);
  });

  it('stops for good when the worker is not found', () => {
    const state = foldTranscript([message(snapshot('a')), { _tag: 'notFound' }]);
    expect(state.feed.connection).toBe('notFound');
  });
});

describe('the worker list feed', () => {
  const worker = (agent: string): WorkerSummary => ({
    agent,
    agentType: 'claude',
    status: 'working',
    sessionId: `session-${agent}`,
  });

  it('replaces the list on every message, across reconnections', () => {
    const state = [
      message([worker('a')]),
      { _tag: 'dropped' } as const,
      message([worker('a'), worker('b')]),
    ].reduce<FeedState<ReadonlyArray<WorkerSummary>>>(
      (s, event) => foldFeed(s, event, applyWorkerList),
      initialFeed,
    );
    expect(state.feed).toEqual({ data: [worker('a'), worker('b')], connection: 'live' });
  });

  it('resolves no selection to the most recently created worker', () => {
    const workers = [worker('a'), worker('b')];
    expect(selectedWorker(workers, null)?.agent).toBe('b');
    expect(selectedWorker(workers, 'a')?.agent).toBe('a');
    expect(selectedWorker(workers, 'gone')).toBeUndefined();
    expect(selectedWorker([], null)).toBeUndefined();
  });
});

describe('connections', () => {
  it('connects again after a drop or an end, with a fresh stream each time, and stops at WorkerNotFound', async () => {
    let attempts = 0;
    const connect = () => {
      attempts += 1;
      switch (attempts) {
        case 1:
          return Stream.concat(
            Stream.make('a'),
            Stream.fail(new TransportError({ reason: 'Unreachable' })),
          );
        case 2:
          // The backend ended the stream.
          return Stream.make('b');
        default:
          return Stream.fail(new WorkerNotFound({ agent: 'brainstorm' }));
      }
    };
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Stream.runCollect(connections(connect)).pipe(Effect.forkChild);
        yield* TestClock.adjust('2 seconds');
        yield* TestClock.adjust('2 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(events).toEqual([
      { _tag: 'message', message: 'a' },
      { _tag: 'dropped' },
      { _tag: 'message', message: 'b' },
      { _tag: 'dropped' },
      { _tag: 'notFound' },
    ]);
    expect(attempts).toBe(3);
  });
});
