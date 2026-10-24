import { Layer } from 'effect';

import type { Transport } from '@yourtechbudstudio/fluidcast-client';
import { WorkerFeed } from '@yourtechbudstudio/fluidcast-react';

import { httpTransport } from './transport';
import { readSkills, watchTranscript, watchWorker } from './workers';

/**
 * The player's connection to one reference-backend session: its HTTP transport, Worker streams and the worker's
 * skills. Build it once per session (the player keys its instance on this object's identity).
 */
export const referenceConnection = (sessionId: string): Layer.Layer<Transport | WorkerFeed> =>
  Layer.merge(
    httpTransport(sessionId),
    Layer.succeed(
      WorkerFeed,
      WorkerFeed.of({
        status: () => watchWorker(sessionId),
        transcript: () => watchTranscript(sessionId),
        skills: () => readSkills(sessionId),
      }),
    ),
  );
