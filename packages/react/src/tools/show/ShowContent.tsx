import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import type { ShowCorrection } from './model';
import { type ShowBody, ShowBodyView } from './ShowBody';

/** A Show's scrolling body. A diagram's viewer and an HTML frame fill it instead of scrolling. */
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
        ? 'flex flex-col overflow-hidden'
        : `overflow-y-auto ${pad}`;
  return (
    <div className={`min-h-0 flex-1 ${layout}`}>
      <ShowBodyView input={input} body={body} correction={correction} />
    </div>
  );
}
