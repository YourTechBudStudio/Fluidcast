import { Atom } from 'effect/reactivity';

// Per-viewer conveniences only. Storage can be missing or throw (private windows, blocked site data), so every access is guarded
// and the player works the same without it.
const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not persisted; the in-memory value still applies.
  }
};

/**
 * The live copies of each persisted atom, by key. The page's root registry and each session's registry hold their own
 * copy; a write hands the value to every copy, so the mode screen shows what was chosen in a session. The decoded value
 * itself travels, so copies stay right even when storage is unavailable.
 */
const copies = new Map<string, Set<(value: unknown) => void>>();

/**
 * A writable atom whose value is remembered in `localStorage` under `key`, falling back when absent or invalid. Every
 * registry's copy on this page follows the latest write.
 */
export const persistedAtom = <A>(
  key: string,
  decode: (raw: string) => A | undefined,
  encode: (value: A) => string,
  fallback: A,
) =>
  Atom.writable<A, A>(
    (get) => {
      const listeners = copies.get(key) ?? new Set();
      copies.set(key, listeners);
      const follow = (value: unknown) => get.setSelf(value as A);
      listeners.add(follow);
      get.addFinalizer(() => listeners.delete(follow));
      const raw = read(key);
      return (raw === null ? undefined : decode(raw)) ?? fallback;
    },
    (ctx, value) => {
      write(key, encode(value));
      ctx.setSelf(value);
      for (const follow of copies.get(key) ?? []) follow(value);
    },
  ).pipe(Atom.keepAlive);
