import { Duration, Effect, Option, Stream } from 'effect';
import { AsyncResult, Atom } from 'effect/unstable/reactivity';

import type { TransportError } from '@yourtechbudstudio/fluidcast-client';
import type {
  TranscriptEntry,
  TranscriptMessage,
  WorkerNotFound,
  WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { watchTranscript, watchWorkers } from '../client';

/**
 * - `connecting`: nothing has arrived yet;
 * - `live`: connected, `data` is current;
 * - `reconnecting`: the connection dropped; `data` is what arrived before, and a retry is on its way;
 * - `notFound`: the backend has no such worker (permanent; no retry).
 */
export type WorkersConnection = 'connecting' | 'live' | 'reconnecting' | 'notFound';

/** A Workers stream as the page shows it. Page-local: it lives while the Workers layer is showing. */
export interface WorkersFeed<A> {
  readonly data: A | undefined;
  readonly connection: WorkersConnection;
}

export interface FeedState<A> {
  readonly feed: WorkersFeed<A>;
  /** This connection has delivered its full value, so its later messages build on `data`. */
  readonly synced: boolean;
}

export type FeedEvent<M> =
  | { readonly _tag: 'message'; readonly message: M }
  | { readonly _tag: 'dropped' }
  | { readonly _tag: 'notFound' };

export const initialFeed: FeedState<never> = {
  feed: { data: undefined, connection: 'connecting' },
  synced: false,
};

/**
 * Folds one stream event into the feed. `apply` builds the next value from this connection's value so far
 * (`undefined` at the start of each connection, so nothing is merged across connections) and returns `undefined` for
 * a message that cannot start a connection's value. Until then, the last connection's data stays on show.
 */
export const foldFeed = <A, M>(
  state: FeedState<A>,
  event: FeedEvent<M>,
  apply: (current: A | undefined, message: M) => A | undefined,
): FeedState<A> => {
  switch (event._tag) {
    case 'message': {
      const next = apply(state.synced ? state.feed.data : undefined, event.message);
      return next === undefined
        ? state
        : { feed: { data: next, connection: 'live' }, synced: true };
    }
    case 'dropped':
      return { feed: { data: state.feed.data, connection: 'reconnecting' }, synced: false };
    case 'notFound':
      return { feed: { data: state.feed.data, connection: 'notFound' }, synced: false };
  }
};

/** Each worker list replaces the last. */
export const applyWorkerList = (
  _current: ReadonlyArray<WorkerSummary> | undefined,
  workers: ReadonlyArray<WorkerSummary>,
): ReadonlyArray<WorkerSummary> => workers;

/** A snapshot replaces the transcript; appended entries extend it, but only after this connection's snapshot. */
export const applyTranscript = (
  current: ReadonlyArray<TranscriptEntry> | undefined,
  message: TranscriptMessage,
): ReadonlyArray<TranscriptEntry> | undefined => {
  switch (message._tag) {
    case 'TranscriptSnapshot':
      return message.entries;
    case 'TranscriptAppended':
      return current === undefined ? undefined : [...current, ...message.entries];
  }
};

/** How long to wait before connecting again after a connection dropped. */
export const retryDelay = Duration.seconds(2);

const dropped = { _tag: 'dropped' } as const;
const notFound = { _tag: 'notFound' } as const;

/**
 * A stream's events across connections: its messages, then `dropped` and a fresh connection after `retryDelay`
 * whenever it fails or ends, until the backend says the worker is not found.
 */
export const connections = <M>(
  connect: () => Stream.Stream<M, TransportError | WorkerNotFound>,
): Stream.Stream<FeedEvent<M>> => {
  const again: Stream.Stream<FeedEvent<M>> = Stream.succeed<FeedEvent<M>>(dropped).pipe(
    Stream.concat(Stream.fromEffectDrain(Effect.sleep(retryDelay))),
    Stream.concat(Stream.suspend(() => connections(connect))),
  );
  return connect().pipe(
    Stream.map((message): FeedEvent<M> => ({ _tag: 'message', message })),
    // The backend ends a stream only when it shuts down: connect again.
    Stream.concat(Stream.suspend(() => again)),
    Stream.catchTags({
      TransportError: () => again,
      WorkerNotFound: () => Stream.succeed<FeedEvent<M>>(notFound),
    }),
  );
};

/** A feed's atom. It connects only while something reads it, and disconnects when nothing does. */
const feedAtom = <A, M>(
  connect: () => Stream.Stream<M, TransportError | WorkerNotFound>,
  apply: (current: A | undefined, message: M) => A | undefined,
) => {
  const states = Atom.make(
    connections(connect).pipe(
      Stream.scan(
        (): FeedState<A> => initialFeed,
        (state, event: FeedEvent<M>) => foldFeed(state, event, apply),
      ),
    ),
    { initialValue: initialFeed as FeedState<A> },
  );
  return Atom.make((get): WorkersFeed<A> =>
    get(states).pipe(
      AsyncResult.value,
      Option.map((state) => state.feed),
      Option.getOrElse(() => initialFeed.feed),
    ),
  );
};

/** The backend's workers, in creation order. */
export const workerListAtom = feedAtom(watchWorkers, applyWorkerList);

/** One worker's transcript entries. */
export const workerTranscriptAtom = Atom.family((agent: string) =>
  feedAtom(() => watchTranscript(agent), applyTranscript),
);

/**
 * The worker the Workers layer shows. `null` resolves to the most recently created worker. Written by the layer's
 * menu and by `app` when the layer opens.
 */
export const selectedWorkerAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);

/** The worker a selection shows: the selected one if it is listed, else (for `null`) the most recently created one. */
export const selectedWorker = (
  workers: ReadonlyArray<WorkerSummary>,
  selected: string | null,
): WorkerSummary | undefined =>
  selected === null ? workers.at(-1) : workers.find((worker) => worker.agent === selected);
