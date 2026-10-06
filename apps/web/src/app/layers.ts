/**
 * The player column's layers and the pure decisions about switching them. `App` applies them to the DOM; the real
 * focus and visibility behaviour is checked by hand.
 */
export type Layer = 'stage' | 'transcript' | 'workers';

export const LAYERS: readonly Layer[] = ['stage', 'transcript', 'workers'];

/** `W` toggles the Worker layer with the stage, and `E` the transcript. */
export const nextLayer = (current: Layer, key: 'w' | 'e'): Layer => {
  const target: Layer = key === 'w' ? 'workers' : 'transcript';
  return current === target ? 'stage' : target;
};

/**
 * Where focus goes after a layer switch:
 * - `workersButton`: the Worker layer closed from its own close button, which disappears;
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
