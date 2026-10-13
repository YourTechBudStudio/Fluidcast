import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import type { ShowCorrection } from './model';
import { type ShowBody, ShowBodyView } from './ShowBody';

/** A Show's scrolling body. Diagrams fit the space instead of scrolling; HTML frames fill it. */
export function ShowContent({
  input,
  body,
  correction,
  compact = false,
}: {
  readonly input: ShowInput;
  readonly body: ShowBody;
  readonly correction: ShowCorrection;
  readonly compact?: boolean;
}) {
  const rendered = body.state === 'rendered' ? body.rendered.kind : null;
  const pad = compact ? 'px-5 py-4' : 'px-8 py-7';
  const layout =
    rendered === 'frame'
      ? 'flex flex-col'
      : rendered === 'diagram'
        ? compact
          ? 'show-fit px-3 py-3'
          : 'px-8 py-6'
        : `overflow-y-auto ${pad}`;
  return (
    <div className={`min-h-0 flex-1 ${layout}`}>
      <ShowBodyView input={input} body={body} correction={correction} />
    </div>
  );
}
