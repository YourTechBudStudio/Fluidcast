import { DEFAULT_VISUAL, isVisualId, type VisualId } from '../visuals';
import { persistedAtom } from './persisted';

export const visualAtom = persistedAtom<VisualId>(
  'fluidcast.visual',
  (raw) => (isVisualId(raw) ? raw : undefined),
  String,
  DEFAULT_VISUAL,
);

/** Whether the back layer (transcript) is showing instead of the front layer (visual and subtitle). */
export const transcriptOpenAtom = persistedAtom<boolean>(
  'fluidcast.transcript',
  (raw) => (raw === '1' ? true : raw === '0' ? false : undefined),
  (open) => (open ? '1' : '0'),
  false,
);
