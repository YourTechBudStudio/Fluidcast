import { useMemo } from 'react';

import { createMarkdown } from './markdown';

/** Markdown from a source the page does not control: raw HTML stays text. */
const renderSafe = createMarkdown({ html: false });

/**
 * Markdown as a reading column, with raw HTML off. `compact` is a step smaller, for text that sits among other output.
 */
export function Prose({
  source,
  compact = false,
  className = '',
}: {
  readonly source: string;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const html = useMemo(() => renderSafe(source), [source]);
  return (
    <div
      className={`markdown-prose ${compact ? 'markdown-prose-compact' : ''} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
