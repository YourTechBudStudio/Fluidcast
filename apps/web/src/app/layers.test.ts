import { describe, expect, it } from 'vitest';

import { focusTargetOnSwitch, nextLayer, selectionOnOpen, selectionOnRestore } from './layers';

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

  it('returns focus to the Workers button when the layer closes from its own close button', () => {
    expect(focusTargetOnSwitch('workers', 'stage', true, true)).toBe('workersButton');
  });

  it('does nothing when the layer does not change', () => {
    expect(focusTargetOnSwitch('workers', 'workers', true)).toBeNull();
  });
});

describe('selectionOnOpen', () => {
  it('selects the requested worker when opened from a link, else the latest', () => {
    expect(selectionOnOpen('transcript', 'workers', 'review', 'brainstorm')).toBe('review');
    expect(selectionOnOpen('stage', 'workers', null, 'brainstorm')).toBe('brainstorm');
    // No agent call yet: `null` resolves to the most recently created worker.
    expect(selectionOnOpen('stage', 'workers', null, null)).toBeNull();
  });

  it('leaves the selection alone unless the switch opens the Workers layer', () => {
    // A newer call while the layer is open changes `latestAgent`, but nothing opens, so nothing is written.
    expect(selectionOnOpen('workers', 'workers', null, 'newer')).toBeUndefined();
    expect(selectionOnOpen('workers', 'stage', null, 'newer')).toBeUndefined();
    expect(selectionOnOpen('stage', 'transcript', null, 'newer')).toBeUndefined();
  });
});

describe('selectionOnRestore', () => {
  it('selects the latest agent call’s worker once the restored layer’s conversation arrives', () => {
    expect(selectionOnRestore(true, true, 'workers', null, 'brainstorm')).toBe('brainstorm');
  });

  it('waits for the conversation, and leaves a finished restore, another layer or a chosen worker alone', () => {
    expect(selectionOnRestore(true, false, 'workers', null, null)).toBeUndefined();
    expect(selectionOnRestore(false, true, 'workers', null, 'brainstorm')).toBeUndefined();
    expect(selectionOnRestore(true, true, 'stage', null, 'brainstorm')).toBeUndefined();
    expect(selectionOnRestore(true, true, 'workers', 'review', 'brainstorm')).toBeUndefined();
  });
});
