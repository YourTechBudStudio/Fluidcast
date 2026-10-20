/**
 * The geometry of a diagram viewport, kept pure so the viewer's DOM code only applies it. A view maps a diagram point
 * `p` to the viewport point `p * scale + (x, y)`.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface View {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** The farthest a diagram zooms in: four times Mermaid's own size. */
export const MAX_SCALE = 4;

/** Room kept between the diagram and the viewport's edge when it fits. */
export const PAD = 16;

/**
 * The scale at which the whole diagram fits inside the padding, never above its own size. It is also the farthest a
 * diagram zooms out: past Fit all there is nothing more to see.
 */
export const fitScale = (content: Size, box: Size): number =>
  Math.min(
    1,
    Math.max(1, box.width - 2 * PAD) / content.width,
    Math.max(1, box.height - 2 * PAD) / content.height,
  );

/**
 * Keeps the diagram in view: on an axis where it fits it is centred, and on an axis where it overflows its edges stop
 * at the padding, so panning never leaves empty space beside it.
 */
export function clampView(view: View, content: Size, box: Size): View {
  const scale = Math.min(MAX_SCALE, Math.max(fitScale(content, box), view.scale));
  const axis = (offset: number, length: number, room: number) => {
    const scaled = length * scale;
    if (scaled <= room - 2 * PAD) return (room - scaled) / 2;
    return Math.min(PAD, Math.max(room - PAD - scaled, offset));
  };
  return {
    scale,
    x: axis(view.x, content.width, box.width),
    y: axis(view.y, content.height, box.height),
  };
}

/** The whole diagram, centred. */
export const fitView = (content: Size, box: Size): View =>
  clampView({ scale: fitScale(content, box), x: 0, y: 0 }, content, box);

/** Scales by `factor` about the viewport point `at`, which stays over the same diagram point (before clamping). */
export function zoomAt(view: View, factor: number, at: Point, content: Size, box: Size): View {
  const scale = Math.min(MAX_SCALE, Math.max(fitScale(content, box), view.scale * factor));
  const ratio = scale / view.scale;
  return clampView(
    { scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio },
    content,
    box,
  );
}

/** The diagram point at the viewport's centre. */
export const centreOf = (view: View, box: Size): Point => ({
  x: (box.width / 2 - view.x) / view.scale,
  y: (box.height / 2 - view.y) / view.scale,
});

/** A view at `scale` with the diagram point `point` at the viewport's centre. */
export const centredOn = (point: Point, scale: number, content: Size, box: Size): View =>
  clampView(
    { scale, x: box.width / 2 - point.x * scale, y: box.height / 2 - point.y * scale },
    content,
    box,
  );

/** Whether the diagram, at this view, is larger than the viewport on either axis. */
export const overflows = (view: View, content: Size, box: Size): boolean =>
  content.width * view.scale > box.width - 2 * PAD + 0.5 ||
  content.height * view.scale > box.height - 2 * PAD + 0.5;

/** The part of the diagram the viewport shows, in diagram units, cut to the diagram. */
export function visibleRegion(view: View, content: Size, box: Size) {
  const left = Math.max(0, -view.x / view.scale);
  const top = Math.max(0, -view.y / view.scale);
  const right = Math.min(content.width, (box.width - view.x) / view.scale);
  const bottom = Math.min(content.height, (box.height - view.y) / view.scale);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * The view `progress` (0..1, already eased) of the way from `from` to `to`. Scale moves geometrically, so a zoom feels
 * even; with an `anchor`, that viewport point stays over the same diagram point throughout.
 */
export function between(from: View, to: View, progress: number, anchor?: Point): View {
  const scale = from.scale * (to.scale / from.scale) ** progress;
  if (anchor === undefined) {
    return {
      scale,
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
  }
  // The anchor's diagram point drifts from where it starts to where `to` puts it, so clamping corrections land smoothly.
  const start = { x: (anchor.x - from.x) / from.scale, y: (anchor.y - from.y) / from.scale };
  const end = { x: (anchor.x - to.x) / to.scale, y: (anchor.y - to.y) / to.scale };
  const point = {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
  return { scale, x: anchor.x - point.x * scale, y: anchor.y - point.y * scale };
}

/** A Mermaid SVG's own size, from its `viewBox`. */
export function intrinsicSizeOf(svg: string): Size {
  const viewBox = /<svg\b[^>]*?\sviewBox="([^"]+)"/.exec(svg)?.[1];
  const [, , width = 0, height = 0] = (viewBox ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return width > 0 && height > 0 ? { width, height } : { width: 400, height: 300 };
}
