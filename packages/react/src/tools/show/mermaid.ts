import { type Palette, toneHex } from '../../ui';
import { intrinsicSizeOf, type Size } from './diagram/view';

/**
 * Every render id starts with this, so rewriting it in a rendered diagram (`withMountId`) cannot match text a model
 * would plausibly write.
 */
const RENDER_ID_PREFIX = 'fcshowmmd-';

/**
 * The render id of a Show's diagram: the player instance's render scope, its call handle, then its position among the
 * Show's diagrams. Each Show renders once per instance, and handles are model-written so two sessions can repeat one;
 * the scope keeps ids unique across players on one page. The position has three digits, so no id is the start of
 * another (`…-001` is not in `…-012`).
 */
export const renderIdOf = (scope: string, handle: string, position: number): string =>
  `${RENDER_ID_PREFIX}${scope}-${handle.replace(/[^a-zA-Z0-9_-]/g, '')}-${String(position).padStart(3, '0')}`;

/** Mermaid's theme for one palette: the player's surfaces and accents, so a diagram matches the player it sits in. */
const themeOf = (palette: Palette) => {
  const hex = palette.hex;
  return {
    darkMode: palette.scheme === 'dark',
    background: 'transparent',
    fontSize: '15px',
    primaryColor: hex.elevated,
    primaryTextColor: hex.fg,
    primaryBorderColor: hex.blue,
    secondaryColor: hex.subtle,
    tertiaryColor: hex.canvas,
    lineColor: hex['fg-muted'],
    textColor: hex.fg,
    actorBkg: hex.elevated,
    actorBorder: hex.blue,
    actorTextColor: hex.fg,
    actorLineColor: hex.line,
    signalColor: hex['fg-muted'],
    signalTextColor: hex.fg,
    labelBoxBkgColor: hex.subtle,
    labelBoxBorderColor: hex.line,
    labelTextColor: hex.fg,
    // Edge labels ("yes", "no") sit on the canvas, not on Mermaid's computed near-black.
    edgeLabelBackground: hex.canvas,
    loopTextColor: hex['fg-muted'],
    noteBkgColor: toneHex(palette, ['canvas', 'violet', 0.14]),
    noteTextColor: hex.fg,
    noteBorderColor: hex.violet,
    activationBkgColor: hex.overlay,
    activationBorderColor: hex.violet,
    sequenceNumberColor: hex.scrim,
  };
};

/** Mermaid is large, so it loads on the first diagram and never before. */
const load = () => import('mermaid').then(({ default: mermaid }) => mermaid);

let mermaid: ReturnType<typeof load> | undefined;

/**
 * Mermaid's theme is global, so every render sets it and then renders in turn, and two players in different themes
 * on one page never draw in each other's colours.
 */
let queue: Promise<unknown> = Promise.resolve();

/** A rendered diagram: SVG markup whose element ids all derive from `renderId`, and its own size. */
export interface RenderedDiagram {
  readonly svg: string;
  readonly renderId: string;
  readonly size: Size;
}

/**
 * Renders Mermaid source to SVG under `renderId`, in `palette`'s colours. Rejects with Mermaid's own error when the
 * source is invalid.
 */
export function renderMermaid(
  source: string,
  renderId: string,
  palette: Palette,
): Promise<RenderedDiagram> {
  mermaid ??= load();
  const loaded = mermaid;
  const rendered = queue.then(async () => {
    const api = await loaded;
    api.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      sequence: { mirrorActors: false },
      theme: 'base',
      fontFamily: "'Source Sans 3 Variable', ui-sans-serif, system-ui, sans-serif",
      themeVariables: themeOf(palette),
    });
    try {
      const { svg } = await api.render(renderId, source);
      return { svg, renderId, size: intrinsicSizeOf(svg) };
    } finally {
      // A failed render can leave its scratch elements in the page.
      document.getElementById(renderId)?.remove();
      document.getElementById(`d${renderId}`)?.remove();
    }
  });
  queue = rendered.catch(() => undefined);
  return rendered;
}

/**
 * The same diagram under an id unique to one place it is mounted. Mermaid scopes its styles (`#id …`) and its
 * markers (`url(#id_…)`) by the render id, so two copies of one render in the page would share ids, and a copy's
 * arrowheads could resolve to the other, possibly hidden, copy.
 */
export const withMountId = (svg: string, renderId: string, mountId: string): string =>
  svg.replaceAll(renderId, mountId);

/** A mount id from React's `useId`, reduced to characters that are safe in ids and CSS selectors. */
export const mountIdOf = (reactId: string): string =>
  `fcshow-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
