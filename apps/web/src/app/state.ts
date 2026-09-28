import { DEFAULT_VISUAL, isVisualId, type VisualId } from '../visuals';
import { type Layer, LAYERS } from './layers';
import { persistedAtom } from './persisted';

export const visualAtom = persistedAtom<VisualId>(
  'fluidcast.visual',
  (raw) => (isVisualId(raw) ? raw : undefined),
  String,
  DEFAULT_VISUAL,
);

/** Which layer the player column shows: the stage (visual and subtitle), the transcript or the Workers layer. */
export const layerAtom = persistedAtom<Layer>(
  'fluidcast.layer',
  (raw) => LAYERS.find((layer) => layer === raw),
  String,
  'stage',
);
