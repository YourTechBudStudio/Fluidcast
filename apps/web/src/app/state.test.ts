import { AtomRegistry } from 'effect/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentAtom } from './state';

// Node has no `localStorage`: a minimal one stands in for the browser's.
const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
};

describe('agentAtom', () => {
  beforeEach(() => {
    stored.clear();
    Object.assign(globalThis, { window: { localStorage: storage } });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  /** The agent a fresh page load (a new registry) starts with. */
  const loaded = () => {
    const registry = AtomRegistry.make();
    const agent = registry.get(agentAtom);
    registry.dispose();
    return agent;
  };

  it('defaults to Claude Code when nothing, or something unknown, is stored', () => {
    expect(loaded()).toBe('claude');
    stored.set('fluidcast.agent', 'gemini');
    expect(loaded()).toBe('claude');
  });

  it('remembers the chosen agent across page loads', () => {
    const registry = AtomRegistry.make();
    registry.mount(agentAtom);
    registry.set(agentAtom, 'codex');
    registry.dispose();
    expect(stored.get('fluidcast.agent')).toBe('codex');
    expect(loaded()).toBe('codex');
  });
});
