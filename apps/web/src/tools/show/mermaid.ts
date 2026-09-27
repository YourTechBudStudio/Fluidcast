import { palette } from '../../ui';

/**
 * Every render id starts with this, so rewriting it in a rendered diagram (`withMountId`) cannot match text a model
 * would plausibly write.
 */
const RENDER_ID_PREFIX = 'fcshowmmd-';

let renders = 0;

/** Mermaid is large, so it loads on the first diagram and never before. */
const load = () =>
  import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      sequence: { mirrorActors: false },
      theme: 'base',
      fontFamily: "'Source Sans 3 Variable', ui-sans-serif, system-ui, sans-serif",
      themeVariables: {
        darkMode: true,
        background: 'transparent',
        fontSize: '15px',
        primaryColor: palette.elevated,
        primaryTextColor: palette.fg,
        primaryBorderColor: palette.blue,
        secondaryColor: palette.subtle,
        tertiaryColor: palette.canvas,
        lineColor: palette['fg-muted'],
        textColor: palette.fg,
        actorBkg: palette.elevated,
        actorBorder: palette.blue,
        actorTextColor: palette.fg,
        actorLineColor: palette.line,
        signalColor: palette['fg-muted'],
        signalTextColor: palette.fg,
        labelBoxBkgColor: palette.subtle,
        labelBoxBorderColor: palette.line,
        labelTextColor: palette.fg,
        loopTextColor: palette['fg-muted'],
        noteBkgColor: '#3b3551',
        noteTextColor: palette.fg,
        noteBorderColor: palette.violet,
        activationBkgColor: palette.overlay,
        activationBorderColor: palette.violet,
        sequenceNumberColor: palette.scrim,
      },
    });
    return mermaid;
  });

let mermaid: ReturnType<typeof load> | undefined;

/** A rendered diagram: SVG markup whose element ids all derive from `renderId`. */
export interface RenderedDiagram {
  readonly svg: string;
  readonly renderId: string;
}

/** Renders Mermaid source to SVG under a fresh render id. Rejects with Mermaid's own error when the source is invalid. */
export async function renderMermaid(source: string): Promise<RenderedDiagram> {
  mermaid ??= load();
  const api = await mermaid;
  const renderId = `${RENDER_ID_PREFIX}${++renders}`;
  try {
    const { svg } = await api.render(renderId, source);
    return { svg, renderId };
  } finally {
    // A failed render can leave its scratch elements in the page.
    document.getElementById(renderId)?.remove();
    document.getElementById(`d${renderId}`)?.remove();
  }
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
