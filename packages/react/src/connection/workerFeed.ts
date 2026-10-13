import { Context, type Stream } from 'effect';

import type { TransportError } from '@yourtechbudstudio/fluidcast-client';
import type {
  TranscriptMessage,
  WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

/**
 * Worker status and transcript for one backend session. Each call opens one connection: failing with
 * `TransportError`, or ending, means that connection dropped, and the player calls again after 2 s.
 */
export class WorkerFeed extends Context.Service<
  WorkerFeed,
  {
    /** The worker's summary now, then again on each change. */
    readonly status: () => Stream.Stream<WorkerSummary, TransportError>;
    /** A `TranscriptSnapshot`, then `TranscriptAppended` entries. */
    readonly transcript: () => Stream.Stream<TranscriptMessage, TransportError>;
  }
>()('@yourtechbudstudio/fluidcast-react/WorkerFeed') {}
