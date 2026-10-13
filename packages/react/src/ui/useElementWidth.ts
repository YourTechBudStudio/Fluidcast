import { useLayoutEffect, useState } from 'react';

/**
 * The element's content-box width in CSS px: measured synchronously on attach (before paint), then followed by
 * `ResizeObserver`. `null` until there is an element. The player root has no padding or border, so its bounding width
 * is its content box: what its container queries see.
 */
export function useElementWidth(element: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [element]);
  return element === null ? null : width;
}
