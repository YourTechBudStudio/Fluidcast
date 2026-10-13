import { createMarkdown } from '../../ui';
import { type RenderedDiagram, renderIdOf, renderMermaid } from './mermaid';

/** One renderer for every Markdown Show. Raw HTML and remote images are allowed (A2, an accepted risk). */
const render = createMarkdown({ html: true });

/** A rendered Markdown Show: its markup, and the render id of each diagram in it, in order. */
export interface RenderedMarkup {
  readonly html: string;
  readonly renderIds: ReadonlyArray<string>;
}

/**
 * Renders the Markdown Show `handle`, with each `mermaid` fence drawn as a diagram in its place. A diagram Mermaid cannot render
 * stays as its source, marked invalid, so the rest of the page still shows; the model is not told.
 */
export async function renderMarkdown(source: string, handle: string): Promise<RenderedMarkup> {
  const sources: Array<string> = [];
  const html = render(source, (language, content) => {
    if (language === 'mermaid') sources.push(content);
    return undefined;
  });
  if (sources.length === 0) return { html, renderIds: [] };
  // Mermaid renders into the page, so diagrams render one at a time.
  const diagrams: Array<RenderedDiagram | undefined> = [];
  for (const [position, diagram] of sources.entries()) {
    diagrams.push(
      await renderMermaid(diagram, renderIdOf(handle, position)).catch(() => undefined),
    );
  }
  let next = 0;
  return {
    html: render(source, (language, _content, code) => {
      if (language !== 'mermaid') return undefined;
      const diagram = diagrams[next++];
      return diagram === undefined
        ? `<div class="show-invalid-diagram"><span>Invalid diagram</span>${code()}</div>`
        : `<div class="show-inline-diagram">${diagram.svg}</div>`;
    }),
    renderIds: diagrams.flatMap((diagram) => (diagram === undefined ? [] : [diagram.renderId])),
  };
}
