import { AtomRegistry } from 'effect/reactivity';
import { describe, expect, it } from 'vitest';

import { persistedAtom } from './persisted';

// Node has no `localStorage`: these run as in a browser where storage is unavailable.
const colour = persistedAtom<string>('test.colour', (raw) => raw, String, 'blue');

describe('persistedAtom', () => {
  it('falls back without storage, and keeps the latest write in memory', () => {
    const registry = AtomRegistry.make();
    registry.mount(colour);
    expect(registry.get(colour)).toBe('blue');
    registry.set(colour, 'violet');
    expect(registry.get(colour)).toBe('violet');
    registry.dispose();
  });
});
