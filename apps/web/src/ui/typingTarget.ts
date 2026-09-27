/** Whether a key event lands where typing or menu navigation owns the keys, so single-key shortcuts stay out of the way. */
export const typingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('textarea, input, select, [contenteditable="true"], [role="menu"]') !== null;
