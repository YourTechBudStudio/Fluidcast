import { useCallback, useSyncExternalStore } from 'react';

/** Follows a media query live, such as Tailwind's `max-sm` breakpoint (`PHONE`). */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `max-sm`: narrower than 640 px. */
export const PHONE = '(width < 40rem)';
