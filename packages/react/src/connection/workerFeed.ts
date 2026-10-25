import { Context, type Effect, type Stream } from 'effect';

import type { TransportError } from '@yourtechbudstudio/fluidcast-client';
import type {
  Skill,
  TranscriptMessage,
  WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

/**
 * Worker status, transcript and skills for one backend session. Each stream call opens one connection: failing with
 * `TransportError`, or ending, means that connection dropped, and the player calls again after 2 s.
 */
export class WorkerFeed extends Context.Service<
  WorkerFeed,
  {
    /** The worker's summary now, then again on each change. */
    readonly status: () => Stream.Stream<WorkerSummary, TransportError>;
    /** A `TranscriptSnapshot`, then `TranscriptAppended` entries. */
    readonly transcript: () => Stream.Stream<TranscriptMessage, TransportError>;
    /**
     * The skills the worker can be sent as `/name`, for the composer's suggestions. Read once per player; a failure
     * only leaves the suggestions out, and is not retried.
     */
    readonly skills: () => Effect.Effect<ReadonlyArray<Skill>, TransportError>;
  }
>()('@yourtechbudstudio/fluidcast-react/WorkerFeed') {}
