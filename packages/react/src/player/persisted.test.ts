import { AtomRegistry } from 'effect/reactivity';
import { describe, expect, it } from 'vitest';

import { persistedAtom } from './persisted';

// Node has no `localStorage`: these run as in a browser where storage is unavailable.
const colour = persistedAtom<string>('test.colour', (raw) => raw, String, 'blue');

describe('persistedAtom', () => {
  it("keeps each registry's value its own, even without storage", () => {
    const first = AtomRegistry.make();
    const second = AtomRegistry.make();
    first.mount(colour);
    second.mount(colour);
    expect(first.get(colour)).toBe('blue');

    first.set(colour, 'violet');
    expect(first.get(colour)).toBe('violet');
    expect(second.get(colour)).toBe('blue');
  });
});
