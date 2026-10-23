import { createMarkdown, type Palette } from '../../ui';
import { type RenderedDiagram, renderIdOf, renderMermaid } from './mermaid';

/** One renderer for every Markdown Show. Raw HTML and remote images are allowed (A2, an accepted risk). */
const render = createMarkdown({ html: true });

/**
 * A rendered Markdown Show: its markup, and the diagrams in it, in order. Each diagram's place in the markup is an
 * empty `[data-diagram="<index>"]` element, so whoever mounts the markup decides how a diagram is presented.
 */
export interface RenderedMarkup {
  readonly html: string;
  readonly diagrams: ReadonlyArray<RenderedDiagram>;
}

/**
 * Renders the Markdown Show `handle` for the player instance's render `scope`, with each `mermaid` fence drawn as a diagram in its place, in `palette`'s colours. A diagram Mermaid cannot render
 * stays as its source, marked invalid, so the rest of the page still shows; the model is not told.
 */
export async function renderMarkdown(
  source: string,
  handle: string,
  scope: string,
  palette: Palette,
): Promise<RenderedMarkup> {
  const sources: Array<string> = [];
  const html = render(source, (language, content) => {
    if (language === 'mermaid') sources.push(content);
    return undefined;
  });
  if (sources.length === 0) return { html, diagrams: [] };
  // Mermaid renders into the page, so diagrams render one at a time.
  const diagrams: Array<RenderedDiagram | undefined> = [];
  for (const [position, diagram] of sources.entries()) {
    diagrams.push(
      await renderMermaid(diagram, renderIdOf(scope, handle, position), palette).catch(
        () => undefined,
      ),
    );
  }
  let next = 0;
  let placed = 0;
  return {
    html: render(source, (language, _content, code) => {
      if (language !== 'mermaid') return undefined;
      const diagram = diagrams[next++];
      return diagram === undefined
        ? `<div class="show-invalid-diagram"><span>Invalid diagram</span>${code()}</div>`
        : `<div class="show-inline-diagram" data-diagram="${placed++}"></div>`;
    }),
    diagrams: diagrams.filter((diagram) => diagram !== undefined),
  };
}
