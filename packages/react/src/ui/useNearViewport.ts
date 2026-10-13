import { type RefObject, useEffect, useState } from 'react';

/**
 * Whether the element is within `margin` of its scrolling viewport, while `enabled`. Once near, it stays near until
 * disabled, so content mounted on the way past is not torn down and rebuilt on every scroll.
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  enabled: boolean,
  margin = '400px',
): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) {
      setNear(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled, margin]);
  return near;
}
