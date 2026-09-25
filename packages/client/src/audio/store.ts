import { Effect } from 'effect';

/**
 * Where fully downloaded audio is kept, keyed by action ID. Pluggable so a persistent adapter can
 * replace the in-memory default.
 */
export interface AudioStore {
  readonly get: (actionId: string) => Effect.Effect<Uint8Array | undefined>;
  readonly set: (actionId: string, bytes: Uint8Array) => Effect.Effect<void>;
  readonly remove: (actionId: string) => Effect.Effect<void>;
  readonly keys: Effect.Effect<ReadonlyArray<string>>;
}

/** An `AudioStore` held in memory. */
export const memoryStore = (): AudioStore => {
  const entries = new Map<string, Uint8Array>();
  return {
    get: (actionId) => Effect.sync(() => entries.get(actionId)),
    set: (actionId, bytes) => Effect.sync(() => void entries.set(actionId, bytes)),
    remove: (actionId) => Effect.sync(() => void entries.delete(actionId)),
    keys: Effect.sync(() => [...entries.keys()]),
  };
};
