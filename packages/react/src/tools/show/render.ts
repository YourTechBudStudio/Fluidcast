import { Effect } from 'effect';

import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import type { Palette } from '../../ui';
import { srcdocOf } from './frame';
import { renderMarkdown } from './markdown';
import { type RenderedDiagram, renderIdOf, renderMermaid } from './mermaid';

/**
 * A Show ready to mount: markup for the app's DOM (with the diagrams placed in it), a diagram, or the `srcdoc` of an
 * HTML frame.
 */
export type RenderedShow =
  | {
      readonly kind: 'markup';
      readonly html: string;
      readonly diagrams: ReadonlyArray<RenderedDiagram>;
    }
  | { readonly kind: 'diagram'; readonly diagram: RenderedDiagram }
  | { readonly kind: 'frame'; readonly srcdoc: string };

/** Why a Show could not be rendered, as the renderer said it; this is what the model reads. */
export interface RenderFailure {
  readonly reason: string;
}

/** How much of a renderer's error is kept. The tool caps what the model reads to the same length. */
const REASON_LIMIT = 300;

const failure = (error: unknown): RenderFailure => {
  const message = error instanceof Error ? error.message : String(error);
  return { reason: (message.trim() || 'The renderer gave no reason.').slice(0, REASON_LIMIT) };
};

/**
 * Renders the Show called by `handle`, with diagram ids in the player instance's render `scope` and colours from its
 * `palette`. Markdown and Mermaid output is injected into the app's DOM; HTML runs in its own frame. An HTML
 * frame's own errors happen inside it and are not reported.
 */
export const renderShow = (
  input: ShowInput,
  handle: string,
  scope: string,
  palette: Palette,
): Effect.Effect<RenderedShow, RenderFailure> => {
  switch (input.format) {
    case 'markdown':
      return Effect.tryPromise({
        try: () => renderMarkdown(input.content, handle, scope, palette),
        catch: failure,
      }).pipe(Effect.map((markup) => ({ kind: 'markup', ...markup }) as const));
    case 'mermaid':
      return Effect.tryPromise({
        try: () => renderMermaid(input.content, renderIdOf(scope, handle, 0), palette),
        catch: failure,
      }).pipe(Effect.map((diagram) => ({ kind: 'diagram', diagram }) as const));
    case 'html':
      return Effect.succeed({ kind: 'frame', srcdoc: srcdocOf(input.content, palette) });
  }
};
