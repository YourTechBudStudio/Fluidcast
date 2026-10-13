import { Atom } from 'effect/reactivity';

// Per-viewer conveniences only. Storage can be missing or throw (private windows, blocked site data), so every access is guarded
// and the page works the same without it.
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
 * A writable atom whose value is remembered in `localStorage` under `key`, falling back when absent or invalid. It lives
 * in the page's root registry: it reads storage once when first used and writes on every set.
 */
export const persistedAtom = <A>(
  key: string,
  decode: (raw: string) => A | undefined,
  encode: (value: A) => string,
  fallback: A,
) =>
  Atom.writable<A, A>(
    () => {
      const raw = read(key);
      return (raw === null ? undefined : decode(raw)) ?? fallback;
    },
    (ctx, value) => {
      write(key, encode(value));
      ctx.setSelf(value);
    },
  ).pipe(Atom.keepAlive);
