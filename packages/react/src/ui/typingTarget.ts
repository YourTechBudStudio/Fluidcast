/**
 * Whether a key event lands where typing, menu navigation or a modal (a diagram's full view) owns the keys, so
 * single-key shortcuts stay out of the way: nothing behind a modal can act on a key pressed inside it.
 */
export const typingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(
    'textarea, input, select, [contenteditable="true"], [role="menu"], [aria-modal="true"]',
  ) !== null;
