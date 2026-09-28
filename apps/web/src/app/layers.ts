/**
 * The player column's layers and the pure decisions about switching them. `App` applies them to the DOM; the real
 * focus and visibility behaviour is checked by hand.
 */
export type Layer = 'stage' | 'transcript' | 'workers';

export const LAYERS: readonly Layer[] = ['stage', 'transcript', 'workers'];

/** `W` toggles the Workers layer with the stage, and `E` the transcript. */
export const nextLayer = (current: Layer, key: 'w' | 'e'): Layer => {
  const target: Layer = key === 'w' ? 'workers' : 'transcript';
  return current === target ? 'stage' : target;
};

/**
 * Where focus goes after a layer switch:
 * - `workersButton`: the Workers layer closed from its own close button, which disappears;
 * - `heading`: the focused element was inside the layer being hidden, so focus moves to the shown layer's heading (the
 *   stage's section for the stage);
 * - `null`: focus stays where it is, for example on a top-bar button.
 */
export const focusTargetOnSwitch = (
  from: Layer,
  to: Layer,
  focusInsideHidden: boolean,
  viaWorkersClose = false,
): 'heading' | 'workersButton' | null => {
  if (from === to) return null;
  if (viaWorkersClose) return 'workersButton';
  return focusInsideHidden ? 'heading' : null;
};

/**
 * The worker to select on a layer switch: when the switch opens the Workers layer, the requested worker (from an agent
 * row's link), else the latest agent call's (`null` resolves to the most recently created worker). `undefined` leaves
 * the selection alone, so while the layer stays open a newer call never changes it.
 */
export const selectionOnOpen = (
  from: Layer,
  to: Layer,
  requested: string | null,
  latestAgent: string | null,
): string | null | undefined =>
  to === 'workers' && from !== 'workers' ? (requested ?? latestAgent) : undefined;

/**
 * The worker to select when the page restores the Workers layer (no switch opens it): once the conversation's first
 * snapshot has arrived, the latest agent call's worker, unless the reader already chose one. `undefined` leaves the
 * selection alone.
 */
export const selectionOnRestore = (
  restoring: boolean,
  connected: boolean,
  layer: Layer,
  selected: string | null,
  latestAgent: string | null,
): string | null | undefined =>
  restoring && connected && layer === 'workers' && selected === null ? latestAgent : undefined;
