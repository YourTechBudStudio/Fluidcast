import { Schema } from 'effect';

import { Agent } from '@fluidcast/app-contract';

import { persistedAtom } from './persisted';

const isAgent = Schema.is(Agent);

/** The agent the mode screen starts sessions with, for New and Continue alike: the last one chosen, else Claude Code. */
export const agentAtom = persistedAtom<Agent>(
  'fluidcast.agent',
  (raw) => (isAgent(raw) ? raw : undefined),
  String,
  'claude',
);
