import { MotionGlobalConfig } from 'motion/react';
import { vi } from 'vitest';

/**
 * The browser pieces happy-dom lacks or cannot drive: Web Audio, media playback, `ResizeObserver` with controllable
 * sizes, and object URLs. `installBrowser()` replaces them for one test and returns the records and controls;
 * `restore()` puts the originals back. It also starts each test with empty storage, so remembered preferences (the
 * layer, the visual) never leak between tests, and skips motion's animations: happy-dom rejects a cancelled Web
 * Animation's `finished` promise, which motion leaves unhandled.
 */

/** The default width an observed element gets until a test resizes it: wide enough for the Show panel. */
export const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

const rect = (width: number, height: number): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

/** An `AudioContext` that starts suspended and resumes on request; created contexts are recorded. */
export class FakeAudioContext {
  static readonly created: Array<FakeAudioContext> = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  resumes = 0;
  closed = false;
  readonly sampleRate = 48_000;
  readonly destination = {};
  /** The element routed through this context: which player instance it belongs to. */
  element: HTMLMediaElement | null = null;

  constructor() {
    FakeAudioContext.created.push(this);
  }

  resume(): Promise<void> {
    this.resumes++;
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }

  createAnalyser() {
    return {
      context: { sampleRate: this.sampleRate },
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      get frequencyBinCount() {
        return this.fftSize / 2;
      },
      connect: () => undefined,
      disconnect: () => undefined,
      getFloatFrequencyData: () => undefined,
      getFloatTimeDomainData: () => undefined,
      getByteFrequencyData: () => undefined,
      getByteTimeDomainData: () => undefined,
    };
  }

  createMediaElementSource(element: HTMLMediaElement) {
    this.element = element;
    return { connect: () => undefined, disconnect: () => undefined };
  }
}

/** A `ResizeObserver` whose sizes the test sets. It owns each observed element's width, bounding box included. */
class FakeResizeObserver {
  static readonly observers = new Set<FakeResizeObserver>();
  readonly targets = new Set<Element>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.observers.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
    own(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    FakeResizeObserver.observers.delete(this);
  }

  deliver(target: Element) {
    if (!this.targets.has(target)) return;
    const { width, height } = target.getBoundingClientRect();
    const entry = {
      target,
      contentRect: rect(width, height),
      borderBoxSize: [{ inlineSize: width, blockSize: height }],
      contentBoxSize: [{ inlineSize: width, blockSize: height }],
      devicePixelContentBoxSize: [],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

const widths = new WeakMap<Element, number>();

/** Makes the fake the one source of `target`'s width: its bounding box reports what the fake holds. */
const own = (target: Element) => {
  if (widths.has(target)) return;
  widths.set(target, DEFAULT_WIDTH);
  Object.defineProperty(target, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(widths.get(target) ?? DEFAULT_WIDTH, DEFAULT_HEIGHT),
  });
};

/** What each media element was asked to do. */
export interface MediaRecord {
  plays: number;
  pauses: number;
}

export interface Browser {
  readonly contexts: ReadonlyArray<FakeAudioContext>;
  /** The context whose graph routes `element`, if one was created. */
  readonly contextOf: (element: HTMLMediaElement) => FakeAudioContext | undefined;
  /** Every element `play()` or `pause()` was called on, with its counts. */
  readonly media: ReadonlyMap<HTMLMediaElement, MediaRecord>;
  /** Sets `target`'s width and delivers it to its observers, as a layout change would. */
  readonly resize: (target: Element, width: number) => void;
  readonly restore: () => void;
}

export function installBrowser(): Browser {
  FakeAudioContext.created.length = 0;
  window.localStorage.clear();
  MotionGlobalConfig.skipAnimations = true;
  FakeResizeObserver.observers.clear();
  const media = new Map<HTMLMediaElement, MediaRecord>();
  const record = (element: HTMLMediaElement) => {
    const known = media.get(element);
    if (known) return known;
    const fresh = { plays: 0, pauses: 0 };
    media.set(element, fresh);
    return fresh;
  };

  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(function (this: HTMLMediaElement) {
      record(this).plays++;
      return Promise.resolve();
    });
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(function (this: HTMLMediaElement) {
      record(this).pauses++;
    });
  let urls = 0;
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(() => `blob:fake-${++urls}`);
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  return {
    contexts: FakeAudioContext.created,
    contextOf: (element) => FakeAudioContext.created.find((context) => context.element === element),
    media,
    resize: (target, width) => {
      own(target);
      widths.set(target, width);
      for (const observer of FakeResizeObserver.observers) observer.deliver(target);
    },
    restore: () => {
      play.mockRestore();
      pause.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      vi.unstubAllGlobals();
      MotionGlobalConfig.skipAnimations = false;
    },
  };
}
