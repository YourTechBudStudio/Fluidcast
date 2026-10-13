/** Below this root width the player is compact: tighter spacing, the controls strip under the dock. = CSS `compact:`. */
export const COMPACT_BELOW_PX = 640;
/** The share of the root's width the open Show panel takes (its `aside`'s flex-basis). */
export const SHOW_PANEL_SHARE = 0.6;
/** The narrowest the Show panel's content may be, including its trailing padding. */
export const SHOW_PANEL_MIN_PX = 440;

/** How one player instance lays out at its root's width. */
export interface PlayerLayout {
  readonly compact: boolean;
  /** Where an open Show appears: the side panel where it fits, otherwise the sheet over the player. */
  readonly show: 'panel' | 'sheet';
}

/**
 * The layout for a root `width` px wide. The panel appears only where its share of the width holds its minimum (734 px
 * and up), so the rendered panel, sized from the same constants, always fits inside the root.
 */
export const layoutFor = (width: number): PlayerLayout => ({
  compact: width < COMPACT_BELOW_PX,
  show: SHOW_PANEL_SHARE * width >= SHOW_PANEL_MIN_PX ? 'panel' : 'sheet',
});
