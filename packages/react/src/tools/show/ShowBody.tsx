import { CircleAlert } from 'lucide-react';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ShowFormat, ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { DiagramViewer } from './diagram/DiagramViewer';
import { titleOf } from './format';
import { mountIdOf, type RenderedDiagram, withMountId } from './mermaid';
import type { ShowCorrection } from './model';
import type { RenderedShow } from './render';

/** Where one Show's render stands. Each Show renders once per player instance; every place that shows it reads the same result. */
export type ShowBody =
  | { readonly state: 'rendering' }
  | { readonly state: 'rendered'; readonly rendered: RenderedShow }
  | { readonly state: 'failed'; readonly reason: string };

/**
 * The body of a Show: rendered Markdown (with any diagrams in it), a Mermaid diagram, the HTML frame (no sandbox, A2), the rendering skeleton,
 * or the failure. `correction` says where its error stands on the way back to the model, when a replacement will come.
 * Diagrams can be explored (pan, zoom, minimap, full view) unless `still`, as in the transcript's inert miniature.
 */
export function ShowBodyView({
  input,
  body,
  correction = null,
  still = false,
}: {
  readonly input: ShowInput;
  readonly body: ShowBody;
  readonly correction?: ShowCorrection;
  readonly still?: boolean;
}) {
  switch (body.state) {
    case 'rendering':
      return <Skeleton format={input.format} />;
    case 'failed':
      return <Failure format={input.format} reason={body.reason} correction={correction} />;
    case 'rendered':
      return still ? (
        <Still input={input} rendered={body.rendered} />
      ) : (
        <Rendered input={input} rendered={body.rendered} />
      );
  }
}

function Rendered({
  input,
  rendered,
}: {
  readonly input: ShowInput;
  readonly rendered: RenderedShow;
}) {
  switch (rendered.kind) {
    case 'markup':
      return <Markup html={rendered.html} diagrams={rendered.diagrams} title={titleOf(input)} />;
    case 'diagram':
      return <DiagramViewer diagram={rendered.diagram} title={titleOf(input)} place="show" />;
    case 'frame':
      return <Frame input={input} srcdoc={rendered.srcdoc} />;
  }
}

/**
 * Markdown with a viewer in each diagram's place. The markup is set once; the viewers render into its placeholders
 * through portals, found as soon as it is in the DOM (before paint).
 */
function Markup({
  html,
  diagrams,
  title,
}: {
  readonly html: string;
  readonly diagrams: ReadonlyArray<RenderedDiagram>;
  readonly title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<ReadonlyArray<HTMLElement>>([]);
  useLayoutEffect(() => {
    setPlaces([...(ref.current?.querySelectorAll<HTMLElement>('[data-diagram]') ?? [])]);
  }, [html]);
  return (
    <>
      <div ref={ref} className="markdown-prose" dangerouslySetInnerHTML={{ __html: html }} />
      {places.map((place) => {
        const diagram = diagrams[Number(place.dataset.diagram)];
        return (
          diagram &&
          createPortal(
            <DiagramViewer diagram={diagram} title={title} place="inline" />,
            place,
            diagram.renderId,
          )
        );
      })}
    </>
  );
}

/** The Show as a picture: diagrams fitted and inert. */
function Still({
  input,
  rendered,
}: {
  readonly input: ShowInput;
  readonly rendered: RenderedShow;
}) {
  const mountId = mountIdOf(useId());
  const markup = useMemo(() => {
    switch (rendered.kind) {
      case 'diagram':
        return withMountId(rendered.diagram.svg, rendered.diagram.renderId, mountId);
      case 'markup':
        return rendered.diagrams.reduce(
          (html, diagram, index) =>
            html.replace(
              `data-diagram="${index}"></div>`,
              `data-diagram="${index}">${withMountId(diagram.svg, diagram.renderId, `${mountId}-${index}`)}</div>`,
            ),
          rendered.html,
        );
      case 'frame':
        return '';
    }
  }, [rendered, mountId]);
  switch (rendered.kind) {
    case 'markup':
      return <div className="markdown-prose" dangerouslySetInnerHTML={{ __html: markup }} />;
    case 'diagram':
      return <div className="show-diagram" dangerouslySetInnerHTML={{ __html: markup }} />;
    case 'frame':
      return <Frame input={input} srcdoc={rendered.srcdoc} />;
  }
}

function Frame({ input, srcdoc }: { readonly input: ShowInput; readonly srcdoc: string }) {
  return (
    <iframe
      title={input.title ?? 'Show'}
      srcDoc={srcdoc}
      className="block h-full min-h-0 w-full flex-1 border-0 bg-transparent"
    />
  );
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
        <div aria-hidden className="flex flex-col gap-3">
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
