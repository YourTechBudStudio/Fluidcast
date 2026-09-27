import { CircleAlert } from 'lucide-react';
import { useId, useMemo } from 'react';

import type { ShowFormat, ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { mountIdOf, withMountId } from './mermaid';
import type { ShowCorrection } from './model';
import type { RenderedShow } from './render';

/** Where one Show's render stands. Each Show renders once per page load; every place that shows it reads the same result. */
export type ShowBody =
  | { readonly state: 'rendering' }
  | { readonly state: 'rendered'; readonly rendered: RenderedShow }
  | { readonly state: 'failed'; readonly reason: string };

/**
 * The body of a Show: rendered Markdown, a Mermaid diagram, the HTML frame (no sandbox, A2), the rendering skeleton,
 * or the failure. `correction` says where its error stands on the way back to the model, when a replacement will come.
 */
export function ShowBodyView({
  input,
  body,
  correction = null,
}: {
  readonly input: ShowInput;
  readonly body: ShowBody;
  readonly correction?: ShowCorrection;
}) {
  switch (body.state) {
    case 'rendering':
      return <Skeleton format={input.format} />;
    case 'failed':
      return <Failure format={input.format} reason={body.reason} correction={correction} />;
    case 'rendered':
      return <Rendered input={input} rendered={body.rendered} />;
  }
}

function Rendered({
  input,
  rendered,
}: {
  readonly input: ShowInput;
  readonly rendered: RenderedShow;
}) {
  const mountId = mountIdOf(useId());
  const diagram = useMemo(
    () =>
      rendered.kind === 'diagram' ? withMountId(rendered.svg, rendered.renderId, mountId) : '',
    [rendered, mountId],
  );
  switch (rendered.kind) {
    case 'markup':
      return <div className="show-prose" dangerouslySetInnerHTML={{ __html: rendered.html }} />;
    case 'diagram':
      return <div className="show-diagram" dangerouslySetInnerHTML={{ __html: diagram }} />;
    case 'frame':
      return (
        <iframe
          title={input.title ?? 'Show'}
          srcDoc={rendered.srcdoc}
          className="block h-full min-h-0 w-full flex-1 border-0 bg-transparent"
        />
      );
  }
}

const SKELETON_LABEL: Record<ShowFormat, string> = {
  markdown: 'Setting the page…',
  mermaid: 'Drawing the diagram…',
  html: 'Building the page…',
};

function Skeleton({ format }: { readonly format: ShowFormat }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="inline-flex items-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle">
        <i className="size-1.5 rounded-full bg-violet shadow-[0_0_10px_var(--color-violet)] motion-safe:animate-breathe" />
        {SKELETON_LABEL[format]}
      </span>
      {format === 'mermaid' ? (
        <div aria-hidden className="relative mx-auto h-72 w-full max-w-xl">
          {[8, 50, 92].map((left) => (
            <div key={left} className="absolute top-0 bottom-0" style={{ left: `${left}%` }}>
              <div className="skeleton absolute top-0 h-11 w-28 -translate-x-1/2 rounded-md" />
              <div className="absolute top-12 bottom-2 left-0 border-l border-dashed border-line/40" />
            </div>
          ))}
          {(
            [
              [8, 50, 80],
              [50, 92, 132],
              [50, 92, 176],
              [8, 50, 220],
            ] as const
          ).map(([from, to, top]) => (
            <div
              key={top}
              className="skeleton absolute h-2 rounded-full"
              style={{ left: `${from}%`, width: `${to - from}%`, top }}
            />
          ))}
        </div>
      ) : (
        <div aria-hidden className="flex max-w-[68ch] flex-col gap-3">
          <div className="skeleton h-6 w-2/5 rounded-md" />
          <div className="skeleton mt-2 h-3.5 w-full rounded-full" />
          <div className="skeleton h-3.5 w-11/12 rounded-full" />
          <div className="skeleton h-3.5 w-3/4 rounded-full" />
          <div className="skeleton mt-3 h-24 w-full rounded-md" />
        </div>
      )}
    </div>
  );
}

const FAILED_WHAT: Record<ShowFormat, string> = {
  markdown: 'this page',
  mermaid: 'this diagram',
  html: 'this page',
};

function Failure({
  format,
  reason,
  correction,
}: {
  readonly format: ShowFormat;
  readonly reason: string;
  readonly correction: ShowCorrection;
}) {
  return (
    <div role="alert" className="mx-auto mt-4 w-full max-w-xl">
      <div className="rounded-lg border border-red/28 bg-red/6 p-5">
        <div className="flex items-center gap-2.5 font-semibold text-red">
          <CircleAlert size={18} strokeWidth={1.9} aria-hidden />
          Couldn’t render {FAILED_WHAT[format]}
        </div>
        <pre className="mt-3.5 overflow-x-auto rounded-md border border-line/25 bg-scrim/55 px-3.5 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
          {reason}
        </pre>
      </div>
      {correction !== null && (
        <p className="mt-3.5 flex items-center justify-center gap-2 text-center text-sm text-fg-subtle">
          <i
            className={`size-1.5 rounded-full ${correction.awaited ? 'bg-violet shadow-[0_0_10px_var(--color-violet)] motion-safe:animate-breathe' : 'bg-fg-subtle'}`}
          />
          {correctionCopy(correction)}
        </p>
      )}
    </div>
  );
}

/** Says only what is true: a replacement is promised while the model's turn is still going, never after. */
function correctionCopy({ error, awaited }: NonNullable<ShowCorrection>): string {
  if (awaited) {
    return error === 'sent'
      ? 'Sent the error back. A corrected version will replace this.'
      : 'Sending the error back. A corrected version will replace this.';
  }
  return error === 'sent'
    ? 'Sent the error back.'
    : 'The error goes back when the conversation continues.';
}
