import { Effect } from 'effect';

import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { srcdocOf } from './frame';
import { renderMarkdown } from './markdown';
import { renderIdOf, renderMermaid } from './mermaid';

/**
 * A Show ready to mount: markup for the app's DOM (with the render ids of the diagrams in it), a diagram, or the
 * `srcdoc` of an HTML frame.
 */
export type RenderedShow =
  | { readonly kind: 'markup'; readonly html: string; readonly renderIds: ReadonlyArray<string> }
  | { readonly kind: 'diagram'; readonly svg: string; readonly renderId: string }
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
 * Renders the Show called by `handle`. Markdown and Mermaid output is injected into the app's DOM; HTML runs in its own frame. An HTML
 * frame's own errors happen inside it and are not reported.
 */
export const renderShow = (
  input: ShowInput,
  handle: string,
): Effect.Effect<RenderedShow, RenderFailure> => {
  switch (input.format) {
    case 'markdown':
      return Effect.tryPromise({
        try: () => renderMarkdown(input.content, handle),
        catch: failure,
      }).pipe(Effect.map((markup) => ({ kind: 'markup', ...markup }) as const));
    case 'mermaid':
      return Effect.tryPromise({
        try: () => renderMermaid(input.content, renderIdOf(handle, 0)),
        catch: failure,
      }).pipe(Effect.map((diagram) => ({ kind: 'diagram', ...diagram }) as const));
    case 'html':
      return Effect.succeed({ kind: 'frame', srcdoc: srcdocOf(input.content) });
  }
};
