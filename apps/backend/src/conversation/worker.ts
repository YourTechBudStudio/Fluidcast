import { Context } from 'effect';

import type { WorkerHandle } from '@yourtechbudstudio/fluidcast-tool-agent';

/** The session's one worker, read-only, for the Worker routes. */
export class ConversationWorker extends Context.Service<ConversationWorker, WorkerHandle>()(
  '@fluidcast/backend/ConversationWorker',
) {}
