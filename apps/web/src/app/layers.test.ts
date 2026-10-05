import { describe, expect, it } from 'vitest';

import { focusTargetOnSwitch, nextLayer } from './layers';

describe('nextLayer', () => {
  it('toggles each layer with the stage, and switches straight between the two', () => {
    expect(nextLayer('stage', 'w')).toBe('workers');
    expect(nextLayer('workers', 'w')).toBe('stage');
    expect(nextLayer('stage', 'e')).toBe('transcript');
    expect(nextLayer('transcript', 'e')).toBe('stage');
    expect(nextLayer('transcript', 'w')).toBe('workers');
    expect(nextLayer('workers', 'e')).toBe('transcript');
  });
});

describe('focusTargetOnSwitch', () => {
  it('moves focus to the shown layer only when the layer being hidden holds it', () => {
    expect(focusTargetOnSwitch('transcript', 'workers', true)).toBe('heading');
    expect(focusTargetOnSwitch('workers', 'stage', true)).toBe('heading');
  });

  it('leaves focus elsewhere, such as on a top-bar button, where it is', () => {
    expect(focusTargetOnSwitch('stage', 'workers', false)).toBeNull();
    expect(focusTargetOnSwitch('workers', 'transcript', false)).toBeNull();
  });

  it('returns focus to the Worker button when the layer closes from its own close button', () => {
    expect(focusTargetOnSwitch('workers', 'stage', true, true)).toBe('workersButton');
  });

  it('does nothing when the layer does not change', () => {
    expect(focusTargetOnSwitch('workers', 'workers', true)).toBeNull();
  });
});
