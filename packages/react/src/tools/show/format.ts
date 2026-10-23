import type { ShowFormat, ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import type { ChipTone } from '../../ui';

export const FORMAT_LABEL: Record<ShowFormat, string> = {
  markdown: 'Markdown',
  mermaid: 'Mermaid',
  html: 'HTML',
};

export const FORMAT_TONE: Record<ShowFormat, ChipTone> = {
  markdown: 'blue',
  mermaid: 'violet',
  html: 'amber',
};

/** The format's icon tile in a title bar. */
export const FORMAT_TILE: Record<ShowFormat, string> = {
  markdown: 'bg-blue/12 text-blue',
  mermaid: 'bg-violet/12 text-violet',
  html: 'bg-amber/12 text-amber',
};

/** The format's transcript node. */
export const FORMAT_NODE: Record<ShowFormat, string> = {
  markdown:
    'bg-blue/14 text-blue shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-blue)_45%,transparent)]',
  mermaid:
    'bg-violet/14 text-violet shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-violet)_45%,transparent)]',
  html: 'bg-amber/14 text-amber shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-amber)_45%,transparent)]',
};

/** A Show's heading: its title, or a plain name for its format when the model gave none. */
export const titleOf = (input: ShowInput): string =>
  input.title?.trim() ||
  { markdown: 'Untitled page', mermaid: 'Untitled diagram', html: 'Untitled page' }[input.format];
