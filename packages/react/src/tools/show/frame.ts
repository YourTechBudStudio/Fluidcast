import type { Palette } from '../../ui';

/**
 * Base styles for HTML Shows: the player's palette as `--fc-*` variables, so a Show can match the player without
 * copying its values, and the player's `color-scheme`, so the frame stays transparent over it. No CSP (A2, an accepted
 * risk).
 */
const frameBaseOf = ({ scheme, hex }: Palette) => `<!doctype html><meta charset="utf-8"><style>
:root{color-scheme:${scheme};--fc-fg:${hex.fg};--fc-muted:${hex['fg-muted']};--fc-subtle:${hex['fg-subtle']};--fc-canvas:${hex.canvas};--fc-surface:${hex.elevated};--fc-line:${hex.line};--fc-blue:${hex.blue};--fc-violet:${hex.violet};--fc-cyan:${hex.cyan};--fc-green:${hex.green};--fc-amber:${hex.amber};--fc-red:${hex.red};--fc-sans:'Source Sans 3 Variable','Source Sans 3',ui-sans-serif,system-ui,sans-serif;--fc-mono:'Fira Code Variable',ui-monospace,SFMono-Regular,monospace}
html,body{margin:0;background:transparent;color:var(--fc-fg);font:15px/1.55 var(--fc-sans);-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
</style>`;

/**
 * The `srcdoc` of an HTML Show's frame, in `palette`'s theme. The frame has no `sandbox` attribute: scripts,
 * same-origin access, navigation, forms, popups and network loads are all allowed (A2).
 */
export const srcdocOf = (content: string, palette: Palette): string =>
  frameBaseOf(palette) + content;
