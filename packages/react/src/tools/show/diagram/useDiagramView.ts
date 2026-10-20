import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { Atom } from 'effect/reactivity';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { DURATION, easeOutExpo } from '../../../ui';
import {
  between,
  centredOn,
  centreOf,
  clampView,
  fitScale,
  fitView,
  MAX_SCALE,
  overflows,
  type Point,
  type Size,
  type View,
  zoomAt,
} from './view';

/** What the control bar shows. It changes only when a value it shows does, never per frame. */
export interface Readout {
  readonly percent: number;
  readonly atFit: boolean;
  readonly atMax: boolean;
  readonly overflow: boolean;
}

/** Where a viewer starts: the whole diagram, or a scale with a diagram point at its centre. */
export type Start = { readonly scale: number; readonly centre: Point } | null;

export interface DiagramViewOptions {
  readonly viewport: RefObject<HTMLDivElement | null>;
  readonly stage: RefObject<HTMLDivElement | null>;
  readonly content: Size;
  readonly start: Start;
  readonly reducedMotion: boolean;
  /** `page`: a plain wheel scrolls the page (a diagram inside Markdown) and calls `onPageWheel`; `zoom` zooms. */
  readonly wheel: 'page' | 'zoom';
  readonly onPageWheel?: () => void;
  /** Every applied frame, for what follows the view directly (the minimap's rectangle, the dot grid). */
  readonly onFrame?: (view: View, box: Size) => void;
}

export interface DiagramView {
  readonly readout: Readout;
  readonly zoomBy: (factor: number) => void;
  readonly fit: () => void;
  /** Animates to `point` (diagram units) at the viewport's centre, or moves there at once while dragging. */
  readonly centreOn: (point: Point, animate: boolean) => void;
  /** Where to start another viewer of this diagram so it shows what this one shows. */
  readonly startHere: () => Start;
}

const STEP = 1.25;
const PAN_STEP = 64;
const PAN_STEP_LARGE = 240;
/** A press moves less than this before it counts as a drag (a double-click must not pan). */
const DRAG_SLOP = 3;

const sameReadout = (a: Readout, b: Readout) =>
  a.percent === b.percent &&
  a.atFit === b.atFit &&
  a.atMax === b.atMax &&
  a.overflow === b.overflow;

/**
 * Pan and zoom for one diagram viewport. The view lives in refs and reaches the DOM directly, frame by frame; React
 * sees only the readout. Gestures: drag pans, the wheel zooms at the pointer (⌘/Ctrl, or a trackpad pinch, always
 * does), two fingers pinch, a double-click zooms in. Keys on the focused viewport: + and − zoom, 0 fits, arrows pan;
 * each is marked handled, so player shortcuts skip it.
 */
export function useDiagramView({
  viewport,
  stage,
  content,
  start,
  reducedMotion,
  wheel,
  onPageWheel,
  onFrame,
}: DiagramViewOptions): DiagramView {
  // The readout is this viewer's own atom in the instance's registry.
  const readoutAtom = useMemo(
    () => Atom.make<Readout>({ percent: 100, atFit: true, atMax: false, overflow: false }),
    [],
  );
  const readout = useAtomValue(readoutAtom);
  const setReadout = useAtomSet(readoutAtom);
  const shownReadout = useRef(readout);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const box = useRef<Size>({ width: 0, height: 0 });
  // Until the listener moves the diagram, it keeps fitting as the viewport resizes.
  const moved = useRef(start !== null);
  const frame = useRef(0);
  const latest = useRef({ reducedMotion, onPageWheel, onFrame });
  useLayoutEffect(() => {
    latest.current = { reducedMotion, onPageWheel, onFrame };
  });

  const apply = useCallback(
    (next: View) => {
      view.current = next;
      const el = stage.current;
      if (el) el.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
      latest.current.onFrame?.(next, box.current);
      const fit = fitScale(content, box.current);
      const shown: Readout = {
        percent: Math.round(next.scale * 100),
        atFit: next.scale <= fit + 1e-3,
        atMax: next.scale >= MAX_SCALE - 1e-3,
        overflow: overflows(next, content, box.current),
      };
      if (sameReadout(shownReadout.current, shown)) return;
      shownReadout.current = shown;
      setReadout(shown);
    },
    [stage, content, setReadout],
  );

  const stop = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  /** Moves to `target`, gliding over `duration` ms unless motion is reduced. */
  const go = useCallback(
    (target: View, duration: number, anchor?: Point) => {
      stop();
      const from = view.current;
      if (duration === 0 || latest.current.reducedMotion) {
        apply(target);
        return;
      }
      const began = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - began) / duration);
        apply(between(from, target, easeOutExpo(progress), anchor));
        frame.current = progress < 1 ? requestAnimationFrame(step) : 0;
      };
      frame.current = requestAnimationFrame(step);
    },
    [apply],
  );

  const centre = (): Point => ({ x: box.current.width / 2, y: box.current.height / 2 });
  const ms = (seconds: number) => seconds * 1000;

  const zoomBy = useCallback(
    (factor: number, at?: Point, duration = ms(DURATION.ui)) => {
      moved.current = true;
      const anchor = at ?? centre();
      go(zoomAt(view.current, factor, anchor, content, box.current), duration, anchor);
    },
    [content, go],
  );

  const panBy = useCallback(
    (dx: number, dy: number, duration = 0) => {
      moved.current = true;
      const current = view.current;
      go(
        clampView({ ...current, x: current.x + dx, y: current.y + dy }, content, box.current),
        duration,
      );
    },
    [content, go],
  );

  const fit = useCallback(() => {
    moved.current = false;
    go(fitView(content, box.current), ms(DURATION.surface));
  }, [content, go]);

  const centreOn = useCallback(
    (point: Point, animate: boolean) => {
      moved.current = true;
      go(
        centredOn(point, view.current.scale, content, box.current),
        animate ? ms(DURATION.surface) : 0,
      );
    },
    [content, go],
  );

  const startHere = useCallback(
    (): Start =>
      moved.current
        ? { scale: view.current.scale, centre: centreOf(view.current, box.current) }
        : null,
    [],
  );

  // Measure before paint, then follow the viewport's size: still fitting, or kept in bounds. A glide in progress was
  // aimed for the old size, so it stops where it is.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = (initial: boolean) => {
      stop();
      box.current = { width: el.clientWidth, height: el.clientHeight };
      if (box.current.width === 0 || box.current.height === 0) return;
      if (initial && start !== null)
        apply(centredOn(start.centre, start.scale, content, box.current));
      else if (!moved.current) apply(fitView(content, box.current));
      else apply(clampView(view.current, content, box.current));
    };
    measure(true);
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(el);
    return () => {
      observer.disconnect();
      stop();
    };
    // `start` applies once, when the viewer mounts, so it is not a dependency.
  }, [viewport, content, apply]);

  // Native listeners: the wheel must be able to cancel scrolling, and handled keys must be marked before they reach
  // the player root's shortcuts.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const local = (event: { clientX: number; clientY: number }): Point => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const pointers = new Map<number, Point>();
    let gesture:
      | { kind: 'pan'; last: Point; travelled: number }
      | { kind: 'pinch'; distance: number; scale: number; point: Point }
      | null = null;
    const begin = () => {
      const [a, b] = [...pointers.values()];
      if (a && b) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const current = view.current;
        gesture = {
          kind: 'pinch',
          distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          scale: current.scale,
          point: { x: (mid.x - current.x) / current.scale, y: (mid.y - current.y) / current.scale },
        };
      } else gesture = a ? { kind: 'pan', last: a, travelled: 0 } : null;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // Inside Markdown one finger scrolls the page; two fingers move the diagram.
      if (wheel === 'page' && event.pointerType === 'touch' && pointers.size === 0) {
        pointers.set(event.pointerId, local(event));
        gesture = null;
        return;
      }
      stop();
      el.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, local(event));
      begin();
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, local(event));
      if (gesture?.kind === 'pan') {
        const point = local(event);
        const dx = point.x - gesture.last.x;
        const dy = point.y - gesture.last.y;
        gesture.last = point;
        gesture.travelled += Math.abs(dx) + Math.abs(dy);
        if (gesture.travelled < DRAG_SLOP) return;
        el.dataset.dragging = '';
        panBy(dx, dy);
      } else if (gesture?.kind === 'pinch') {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        moved.current = true;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const scale = gesture.scale * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance);
        const bounded = Math.min(MAX_SCALE, Math.max(fitScale(content, box.current), scale));
        apply(
          clampView(
            {
              scale: bounded,
              x: mid.x - gesture.point.x * bounded,
              y: mid.y - gesture.point.y * bounded,
            },
            content,
            box.current,
          ),
        );
      }
    };
    const up = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (pointers.size === 1 && wheel === 'page') gesture = null;
      else begin();
      if (pointers.size === 0) delete el.dataset.dragging;
    };

    const onWheel = (event: WheelEvent) => {
      const zoomKey = event.ctrlKey || event.metaKey;
      if (wheel === 'page' && !zoomKey) {
        latest.current.onPageWheel?.();
        return;
      }
      event.preventDefault();
      stop();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.current.height : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      // A trackpad pinch arrives as a ctrl-wheel with small deltas; a mouse wheel's notches are larger.
      if (zoomKey) zoomBy(Math.exp(-dy * 0.01), local(event), 0);
      else if (Math.abs(dx) > Math.abs(dy)) panBy(-dx, 0);
      else zoomBy(Math.exp(-dy * 0.0022), local(event), 0);
    };

    const onDoubleClick = (event: MouseEvent) => zoomBy(2, local(event), ms(DURATION.ui));

    const onKey = (event: KeyboardEvent) => {
      if (event.target !== el || event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.shiftKey ? PAN_STEP_LARGE : PAN_STEP;
      const glide = ms(DURATION.micro);
      switch (event.key) {
        case '+':
        case '=':
          zoomBy(STEP);
          break;
        case '-':
        case '_':
          zoomBy(1 / STEP);
          break;
        case '0':
          fit();
          break;
        case 'ArrowLeft':
          panBy(step, 0, glide);
          break;
        case 'ArrowRight':
          panBy(-step, 0, glide);
          break;
        case 'ArrowUp':
          panBy(0, step, glide);
          break;
        case 'ArrowDown':
          panBy(0, -step, glide);
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDoubleClick);
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDoubleClick);
      el.removeEventListener('keydown', onKey);
    };
  }, [viewport, wheel, content, apply, zoomBy, panBy, fit]);

  return {
    readout,
    zoomBy: useCallback((factor: number) => zoomBy(factor), [zoomBy]),
    fit,
    centreOn,
    startHere,
  };
}
