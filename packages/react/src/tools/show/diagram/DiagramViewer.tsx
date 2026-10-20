import { useAtom } from '@effect/atom-react';
import { Atom } from 'effect/reactivity';
import { Expand, Scan, Shrink, ZoomIn, ZoomOut } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Button, useElementWidth, useReducedMotion } from '../../../ui';
import { mountIdOf, type RenderedDiagram, withMountId } from '../mermaid';
import { DiagramFullView } from './DiagramFullView';
import { type Start, useDiagramView } from './useDiagramView';
import { PAD, type Size, type View, visibleRegion } from './view';

/**
 * Where a viewer sits: a Mermaid Show's whole body, a diagram inside a Markdown Show (the page scrolls past it), or the
 * full view over the player.
 */
export type DiagramPlace = 'show' | 'inline' | 'full';

/** A diagram inside Markdown is as tall as it is fitted to the column, up to this. */
const INLINE_MAX_HEIGHT = 420;
const INLINE_MAX_HEIGHT_NARROW = 340;
/** Below this width, the viewer uses its narrow sizes: a shorter inline box, a smaller minimap, an icon-only bar. */
const NARROW_PX = 480;
const MAP_BOX: Size = { width: 160, height: 112 };
const MAP_BOX_NARROW: Size = { width: 112, height: 80 };
const STEP = 1.25;
/** How long the "⌘ + scroll to zoom" hint stays after a plain wheel over a diagram inside Markdown. */
const HINT_MS = 1300;

const zoomModifier = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/**
 * One Mermaid diagram the listener can explore: a pan and zoom viewport, a minimap that appears whenever the diagram
 * is larger than the view, and one control bar: zoom out, the zoom level, zoom in and Fit all, then full view (exit,
 * in the full view). Full view opens the same diagram over the whole player, where it was.
 */
export function DiagramViewer({
  diagram,
  title,
  place,
  start = null,
  onExit,
}: {
  readonly diagram: RenderedDiagram;
  readonly title: string;
  readonly place: DiagramPlace;
  /** Where the full view starts: what the viewer that opened it showed. */
  readonly start?: Start;
  /** The full view's exit. */
  readonly onExit?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const mountId = mountIdOf(useId());
  const svg = useMemo(
    () => withMountId(diagram.svg, diagram.renderId, mountId),
    [diagram, mountId],
  );
  const mapSvg = useMemo(
    () => withMountId(diagram.svg, diagram.renderId, `${mountId}-map`),
    [diagram, mountId],
  );
  const content = diagram.size;

  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const width = useElementWidth(frame) ?? 0;
  const narrow = width > 0 && width < NARROW_PX;

  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const mapRect = useRef<HTMLDivElement>(null);
  const mapBox = narrow ? MAP_BOX_NARROW : MAP_BOX;
  const mapScale = Math.min(mapBox.width / content.width, mapBox.height / content.height);
  const mapScaleRef = useRef(mapScale);
  mapScaleRef.current = mapScale;

  // This viewer's presentation state, in atoms of its own in the instance's registry: the scroll hint, and the full
  // view with where it starts.
  const atoms = useMemo(
    () => ({
      hint: Atom.make(false),
      full: Atom.make<{ readonly start: Start } | null>(null),
    }),
    [],
  );
  const [hint, setHint] = useAtom(atoms.hint);
  const hintTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const view = useDiagramView({
    viewport,
    stage,
    content,
    start,
    reducedMotion,
    wheel: place === 'inline' ? 'page' : 'zoom',
    onPageWheel: () => {
      setHint(true);
      window.clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setHint(false), HINT_MS);
    },
    onFrame: (current: View, box: Size) => {
      const rect = mapRect.current;
      if (rect) {
        const k = mapScaleRef.current;
        const region = visibleRegion(current, content, box);
        rect.style.transform = `translate(${region.x * k}px, ${region.y * k}px)`;
        rect.style.width = `${Math.max(4, region.width * k)}px`;
        rect.style.height = `${Math.max(4, region.height * k)}px`;
      }
      // The dot grid behind a Show's diagram moves and scales with it, so a pan reads as movement.
      const el = viewport.current;
      if (el && place !== 'inline') {
        el.style.setProperty('--grid-size', `${Math.max(8, 22 * current.scale * 2)}px`);
        el.style.setProperty('--grid-x', `${current.x}px`);
        el.style.setProperty('--grid-y', `${current.y}px`);
      }
    },
  });
  const { readout } = view;

  // Mermaid sizes its SVG to its container; here it keeps its own size and the stage scales it.
  useLayoutEffect(() => {
    const el = stage.current?.querySelector('svg');
    if (!el) return;
    el.setAttribute('width', String(content.width));
    el.setAttribute('height', String(content.height));
    el.style.maxWidth = 'none';
  }, [svg, content]);
  const mapCanvas = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = mapCanvas.current?.querySelector('svg');
    if (!el) return;
    el.setAttribute('width', String(content.width * mapScale));
    el.setAttribute('height', String(content.height * mapScale));
    el.style.maxWidth = 'none';
  }, [mapSvg, content, mapScale]);

  // The minimap: a press jumps there, a drag follows the pointer.
  const mapDrag = useRef(false);
  const mapPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / mapScale,
      y: (event.clientY - rect.top) / mapScale,
    };
  };

  // Full view, opened from this viewer; focus returns to whatever opened it.
  const [full, setFull] = useAtom(atoms.full);
  const opener = useRef<HTMLElement | null>(null);
  const openFull = () => {
    if (place === 'full') return onExit?.();
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFull({ start: view.startHere() });
  };
  const closeFull = () => {
    setFull(null);
    opener.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target !== el || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== 'f' && event.key !== 'F') return;
      event.preventDefault();
      openFull();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  const inlineHeight = Math.round(
    Math.min(
      narrow ? INLINE_MAX_HEIGHT_NARROW : INLINE_MAX_HEIGHT,
      content.height * Math.min(1, Math.max(1, width - 2 * PAD) / content.width) + 2 * PAD,
    ),
  );
  const icon = { size: 17, strokeWidth: 1.8, 'aria-hidden': true } as const;
  const modifier = zoomModifier();

  return (
    <div
      ref={setFrame}
      className={`diagram-viewer relative flex min-h-0 flex-col ${place === 'inline' ? 'diagram-inline' : 'flex-1'}`}
    >
      <div
        className="relative min-h-0 flex-1"
        style={place === 'inline' ? { height: inlineHeight, flex: 'none' } : undefined}
      >
        <div
          ref={viewport}
          tabIndex={0}
          role="group"
          aria-roledescription="diagram"
          aria-label={`${title}. Drag or use the arrow keys to pan, plus and minus to zoom, 0 to fit, F for ${place === 'full' ? 'the Show' : 'full view'}.`}
          className={`diagram-viewport absolute inset-0 overflow-hidden outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-blue)] ${place === 'inline' ? 'touch-pan-y' : 'diagram-grid touch-none'}`}
        >
          <div ref={stage} className="diagram-stage" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
        <div
          aria-hidden
          data-shown={readout.overflow || undefined}
          className="diagram-map absolute right-2.5 bottom-2.5 rounded-sm p-1.5"
        >
          <div
            ref={mapCanvas}
            className="relative cursor-pointer touch-none overflow-hidden rounded-[6px]"
            style={{ width: content.width * mapScale, height: content.height * mapScale }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              mapDrag.current = true;
              view.centreOn(mapPoint(event), true);
            }}
            onPointerMove={(event) => {
              if (mapDrag.current) view.centreOn(mapPoint(event), false);
            }}
            onPointerUp={() => {
              mapDrag.current = false;
            }}
            onPointerCancel={() => {
              mapDrag.current = false;
            }}
          >
            <div className="pointer-events-none" dangerouslySetInnerHTML={{ __html: mapSvg }} />
            <div ref={mapRect} className="diagram-map-rect absolute top-0 left-0" />
          </div>
        </div>
        {place === 'inline' && (
          <span
            aria-hidden
            data-shown={hint || undefined}
            className="diagram-hint pointer-events-none absolute top-3 left-1/2 rounded-full bg-elevated/95 px-3 py-1.5 text-[13px] whitespace-nowrap text-fg shadow-[inset_0_0_0_1px_rgb(91_96_120/0.7)]"
          >
            {modifier} + scroll to zoom
          </span>
        )}
      </div>
      <div
        role="toolbar"
        aria-label="Diagram"
        className={`flex h-12 shrink-0 items-center gap-0.5 border-t border-line/25 px-2 ${place === 'full' ? 'bg-canvas/90' : 'bg-canvas/45'}`}
      >
        <Button
          tone="ghost"
          aria-label="Zoom out"
          unavailable={readout.atFit}
          icon={<ZoomOut {...icon} />}
          onClick={() => view.zoomBy(1 / STEP)}
          className="px-0"
        />
        <span className="min-w-13 text-center font-mono text-[12.5px] text-fg tabular-nums">
          {readout.percent}%
        </span>
        <Button
          tone="ghost"
          aria-label="Zoom in"
          unavailable={readout.atMax}
          icon={<ZoomIn {...icon} />}
          onClick={() => view.zoomBy(STEP)}
          className="px-0"
        />
        <span aria-hidden className="mx-1 h-4.5 w-px bg-line/45" />
        <Button
          tone="ghost"
          aria-label="Fit all"
          icon={<Scan {...icon} />}
          onClick={view.fit}
          className="px-2.5 text-[13.5px]"
        >
          {!narrow && <span aria-hidden>Fit all</span>}
        </Button>
        <span className="min-w-0 flex-1" />
        {!narrow && (
          <span className="truncate px-1.5 text-[12.5px] text-fg-subtle">
            {place === 'inline'
              ? `Drag to pan · ${modifier} + scroll to zoom`
              : 'Drag to pan · scroll to zoom'}
          </span>
        )}
        <Button
          tone="ghost"
          aria-label={place === 'full' ? 'Exit full view' : 'Full view'}
          icon={place === 'full' ? <Shrink {...icon} /> : <Expand {...icon} />}
          onClick={openFull}
          className="px-0"
        />
      </div>
      {place !== 'full' && (
        <AnimatePresence>
          {full && (
            <DiagramFullView key="full" title={title} onClose={closeFull}>
              <DiagramViewer
                diagram={diagram}
                title={title}
                place="full"
                start={full.start}
                onExit={closeFull}
              />
            </DiagramFullView>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
