import { palette } from '../../ui';

/**
 * Base styles for HTML Shows: the player's palette as `--fc-*` variables, so a Show can match the player without
 * copying its values. No CSP (A2, an accepted risk).
 */
const FRAME_BASE = `<!doctype html><meta charset="utf-8"><style>
:root{color-scheme:dark;--fc-fg:${palette.fg};--fc-muted:${palette['fg-muted']};--fc-subtle:${palette['fg-subtle']};--fc-canvas:${palette.canvas};--fc-surface:${palette.elevated};--fc-line:${palette.line};--fc-blue:${palette.blue};--fc-violet:${palette.violet};--fc-cyan:${palette.cyan};--fc-green:${palette.green};--fc-amber:${palette.amber};--fc-red:${palette.red};--fc-sans:'Source Sans 3 Variable','Source Sans 3',ui-sans-serif,system-ui,sans-serif;--fc-mono:'Fira Code Variable',ui-monospace,SFMono-Regular,monospace}
html,body{margin:0;background:transparent;color:var(--fc-fg);font:15px/1.55 var(--fc-sans);-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
</style>`;

/**
 * The `srcdoc` of an HTML Show's frame. The frame has no `sandbox` attribute: scripts, same-origin access,
 * navigation, forms, popups and network loads are all allowed (A2).
 */
export const srcdocOf = (content: string): string => FRAME_BASE + content;
