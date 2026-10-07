import { Schema } from 'effect';

import { Agent } from '@fluidcast/app-contract';

import { DEFAULT_VISUAL, isVisualId, type VisualId } from '../visuals';
import { type Layer, LAYERS } from './layers';
import { persistedAtom } from './persisted';

export const visualAtom = persistedAtom<VisualId>(
  'fluidcast.visual',
  (raw) => (isVisualId(raw) ? raw : undefined),
  String,
  DEFAULT_VISUAL,
);

/** Which layer the player column shows: the stage (visual and subtitle), the transcript or the Worker layer. */
export const layerAtom = persistedAtom<Layer>(
  'fluidcast.layer',
  (raw) => LAYERS.find((layer) => layer === raw),
  String,
  'stage',
);

const isAgent = Schema.is(Agent);

/** The agent the mode screen starts sessions with, for New and Continue alike: the last one chosen, else Claude Code. */
export const agentAtom = persistedAtom<Agent>(
  'fluidcast.agent',
  (raw) => (isAgent(raw) ? raw : undefined),
  String,
  'claude',
);
