import { ChevronRight, PanelRight, TriangleAlert } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { Chip, useNearViewport } from '../../ui';
import { FORMAT_LABEL, FORMAT_TONE, titleOf } from './format';

/** A Show's heading in the transcript: "Showed", its title and chips. */
export function ShowCardTitle({
  input,
  failure,
  corrects,
}: {
  readonly input: ShowInput;
  readonly failure: string | null;
  readonly corrects: boolean;
}) {
  return (
    <>
      <span className="text-fg-subtle">Showed</span>
      <span className="font-semibold text-fg">{titleOf(input)}</span>
      <Chip tone={FORMAT_TONE[input.format]}>{FORMAT_LABEL[input.format]}</Chip>
      {failure !== null && <Chip tone="red">Didn’t render</Chip>}
      {corrects && <Chip tone="subtle">Corrected</Chip>}
    </>
  );
}

/**
 * A Show's transcript card: a live miniature that reopens this Show in the panel, then its source behind a
 * disclosure, and the reason it failed, if it did. `miniature` mounts only while `active` and near the viewport.
 */
export function ShowCard({
  input,
  failure,
  active,
  miniature,
  onOpen,
}: {
  readonly input: ShowInput;
  readonly failure: string | null;
  readonly active: boolean;
  readonly miniature: ReactNode;
  readonly onOpen: () => void;
}) {
  return (
    <>
      <div className="mt-0.5 overflow-hidden rounded-lg border border-line/35 bg-elevated/40">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${titleOf(input)}`}
          className="group relative block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
        >
          <Miniature active={active}>{miniature}</Miniature>
          <span className="absolute inset-0 grid place-items-center bg-scrim/0 opacity-0 transition-[opacity,background-color] duration-(--duration-ui) ease-expo group-hover:bg-scrim/35 group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="inline-flex items-center gap-2 rounded-full border border-line/50 bg-subtle/90 px-3.5 py-2 text-[13.5px] text-fg shadow-soft">
              <PanelRight size={14} strokeWidth={1.8} aria-hidden /> Open in panel
            </span>
          </span>
        </button>
        <details className="group border-t border-line/25">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-[13px] text-fg-subtle marker:hidden hover:text-fg">
            <ChevronRight
              size={13}
              strokeWidth={2}
              aria-hidden
              className="transition-transform duration-(--duration-ui) ease-expo group-open:rotate-90 motion-reduce:transition-none"
            />
            Source
          </summary>
          <pre className="max-h-64 overflow-auto bg-scrim/40 px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-fg-muted">
            {input.content}
          </pre>
        </details>
      </div>
      {failure !== null && (
        <p className="mt-2 flex items-start gap-2 font-mono text-[12px] leading-relaxed text-red/85">
          <TriangleAlert size={13} strokeWidth={1.9} className="mt-0.5 shrink-0" aria-hidden />
          <span>{failure}</span>
        </p>
      )}
    </>
  );
}

/** The miniature renders at this size, then scales down to the card. */
const VIRTUAL = { width: 760, height: 430 };
/** Never enlarged: past this scale the miniature stops growing and centres, so wide transcripts keep a small preview. */
const MAX_SCALE = 0.6;

/** A scaled-down, inert copy of the Show. Not interactive: the card's button owns the pointer and the keyboard. */
function Miniature({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const near = useNearViewport(box, active);
  const [fit, setFit] = useState({ scale: 0.5, left: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const scale = Math.min(el.clientWidth / VIRTUAL.width, MAX_SCALE);
      setFit({ scale, left: (el.clientWidth - VIRTUAL.width * scale) / 2 });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={box}
      aria-hidden
      inert
      className="pointer-events-none relative overflow-hidden bg-canvas/40"
      style={{ height: VIRTUAL.height * fit.scale * 0.72 }}
    >
      {active && near && (
        <div
          className="absolute top-0 flex origin-top-left flex-col px-10 py-8"
          style={{
            left: fit.left,
            width: VIRTUAL.width,
            height: VIRTUAL.height,
            transform: `scale(${fit.scale})`,
          }}
        >
          {children}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-[rgb(46_50_68)] to-transparent" />
    </div>
  );
}
