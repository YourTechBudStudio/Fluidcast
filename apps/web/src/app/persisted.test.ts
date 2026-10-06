import { AtomRegistry } from 'effect/unstable/reactivity';
import { describe, expect, it } from 'vitest';

import { persistedAtom } from './persisted';

// Node has no `localStorage`: these run as in a browser where storage is unavailable.
const colour = persistedAtom<string>('test.colour', (raw) => raw, String, 'blue');

describe('persistedAtom', () => {
  it("gives every registry's copy the latest write, even without storage", () => {
    const root = AtomRegistry.make();
    const session = AtomRegistry.make();
    root.mount(colour);
    session.mount(colour);
    expect(root.get(colour)).toBe('blue');

    session.set(colour, 'violet');
    expect(session.get(colour)).toBe('violet');
    expect(root.get(colour)).toBe('violet');

    // A disposed registry's copy stops following; the others still do.
    session.dispose();
    root.set(colour, 'cyan');
    expect(root.get(colour)).toBe('cyan');
  });
});
