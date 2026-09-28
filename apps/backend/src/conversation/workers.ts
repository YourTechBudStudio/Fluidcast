import { Context } from 'effect';

import type { Workers } from '@yourtechbudstudio/fluidcast-tool-agent';

/** The session's Agent tool pool, read-only, for the Workers routes. */
export class AgentWorkers extends Context.Service<AgentWorkers, Workers>()(
  '@fluidcast/backend/AgentWorkers',
) {}
