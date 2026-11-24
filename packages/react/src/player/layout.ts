/*
 * The player's width tiers, measured on its root. These constants own them: the CSS `compact:` and `narrow:` variants in
 * `styles/player.css` mirror them, and `layout.test.ts` holds the two in step.
 */

/** Below this root width the player is compact: tighter spacing, the controls strip under the dock. = CSS `compact:`. */
export const COMPACT_BELOW_PX = 640;
/** Below this root width the player is narrow: an icon-only top bar, and an open Show as the sheet. = CSS `narrow:`. */
export const NARROW_BELOW_PX = 1024;
/** The share of the root's width the open Show panel takes (its `aside`'s flex-basis). */
export const SHOW_PANEL_SHARE = 0.6;
/** The narrowest the Show panel's content may be, including its trailing padding. Its share fits it from `narrow` up. */
export const SHOW_PANEL_MIN_PX = 440;

/** How one player instance lays out at its root's width. */
export interface PlayerLayout {
  readonly compact: boolean;
  /** Where an open Show appears: the side panel when wide, otherwise the full-width sheet over the player. */
  readonly show: 'panel' | 'sheet';
}

/** The layout for a root `width` px wide. */
export const layoutFor = (width: number): PlayerLayout => ({
  compact: width < COMPACT_BELOW_PX,
  show: width < NARROW_BELOW_PX ? 'sheet' : 'panel',
});
