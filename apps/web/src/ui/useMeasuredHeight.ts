import { useLayoutEffect, useRef, useState } from 'react';

/** Follows an element's rendered height, so a parent can animate towards it as real layout. */
export function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry?.borderBoxSize[0]?.blockSize ?? el.offsetHeight),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}
