// @vitest-environment happy-dom
import { RegistryProvider } from '@effect/atom-react';
import { MotionGlobalConfig } from 'motion/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { type RenderedShow, ShowBodyView } from '../src/tools';
import { PlayerInstanceContext, ROOT_CLASS, typingTarget } from '../src/ui';
import { interact, key, mount, press, unmountAll } from './support/render';

/**
 * The diagram viewer inside a Show body, in a DOM: its control bar, Fit all, full view over the player root, and the
 * keys it marks handled. happy-dom lays nothing out, so every element measures as a 600 × 400 box.
 */

const svg = (id: string) =>
  `<svg id="${id}" width="100%" viewBox="0 0 3000 400" style="max-width: 3000px;"><g class="node"></g></svg>`;
const diagram = {
  svg: svg('fcshowmmd-s-h-000'),
  renderId: 'fcshowmmd-s-h-000',
  size: { width: 3000, height: 400 },
};
const mermaidInput: ShowInput = { format: 'mermaid', title: 'Pipeline', content: 'flowchart LR' };
const markdownInput: ShowInput = { format: 'markdown', title: 'Notes', content: '# Notes' };

const sizes = ['clientWidth', 'clientHeight'] as const;
const originals = sizes.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
beforeAll(() => {
  // happy-dom rejects a cancelled Web Animation's `finished` promise, which motion leaves unhandled.
  MotionGlobalConfig.skipAnimations = true;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 400,
  });
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
  sizes.forEach((name, index) => {
    const original = originals[index];
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
  });
});
afterEach(unmountAll);

async function show(input: ShowInput, rendered: RenderedShow, still = false) {
  const root = document.createElement('div');
  root.className = ROOT_CLASS;
  document.body.append(root);
  const mounted = await mount(
    <RegistryProvider>
      <PlayerInstanceContext value={{ root, width: 900 }}>
        <ShowBodyView input={input} body={{ state: 'rendered', rendered }} still={still} />
      </PlayerInstanceContext>
    </RegistryProvider>,
  );
  return { root, container: mounted.container };
}

const button = (scope: ParentNode, name: string) => {
  const found = scope.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const percent = (scope: ParentNode) =>
  scope.querySelector('[role="toolbar"] span.font-mono')?.textContent;

describe('a Mermaid Show', () => {
  it('opens fitted, zooms from the bar, and Fit all returns without staying pressed', async () => {
    const { container } = await show(mermaidInput, { kind: 'diagram', diagram });
    expect(percent(container)).toBe('19%');
    expect(button(container, 'Zoom out').getAttribute('aria-disabled')).toBe('true');

    await press(button(container, 'Zoom in'));
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(percent(container)).toBe('24%');
    expect(button(container, 'Zoom out').hasAttribute('aria-disabled')).toBe(false);

    await press(button(container, 'Fit all'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(percent(container)).toBe('19%');
    expect(button(container, 'Fit all').hasAttribute('aria-pressed')).toBe(false);
  });

  it('marks the keys it uses as handled, and leaves the rest to the player', async () => {
    const { container } = await show(mermaidInput, { kind: 'diagram', diagram });
    const viewport = container.querySelector<HTMLElement>('[aria-roledescription="diagram"]');
    if (!viewport) throw new Error('No diagram viewport');
    viewport.focus();
    expect((await key('+', viewport)).defaultPrevented).toBe(true);
    expect((await key('ArrowLeft', viewport)).defaultPrevented).toBe(true);
    expect((await key('e', viewport)).defaultPrevented).toBe(false);
  });

  it('opens full view over the player root and closes it on Escape, returning focus', async () => {
    const { root, container } = await show(mermaidInput, { kind: 'diagram', diagram });
    const open = button(container, 'Full view');
    open.focus();
    await press(open);
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Pipeline, full view');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    // Its own copy of the diagram, under ids of its own.
    const ids = [...root.querySelectorAll('svg[id]'), ...container.querySelectorAll('svg[id]')].map(
      (el) => el.id,
    );
    expect(new Set(ids).size).toBe(ids.length);

    // Player and question shortcuts stand aside while it is open: nothing hidden behind it can act on a key.
    expect(typingTarget(document.activeElement)).toBe(true);

    const escape = await key('Escape');
    expect(escape.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
  });
});

describe('a resize during a zoom', () => {
  const observed: Array<(entries: ReadonlyArray<ResizeObserverEntry>) => void> = [];
  const Original = globalThis.ResizeObserver;
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      readonly #callback: (entries: ReadonlyArray<ResizeObserverEntry>) => void;
      constructor(callback: (entries: ReadonlyArray<ResizeObserverEntry>) => void) {
        this.#callback = callback;
      }
      observe() {
        observed.push(this.#callback);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterAll(() => {
    globalThis.ResizeObserver = Original;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 600,
    });
  });

  it('stops the glide aimed at the old size, so the view fits the new one', async () => {
    const { container } = await show(mermaidInput, { kind: 'diagram', diagram });
    await press(button(container, 'Zoom in'));
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1200,
    });
    await interact(() => observed.forEach((callback) => callback([])));
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Fit all at 1200 × 400 is 39%; the glide would have ended at 24%, below it.
    expect(percent(container)).toBe('39%');
  });
});

describe('a Markdown Show', () => {
  const rendered: RenderedShow = {
    kind: 'markup',
    html: '<p>Before</p><div class="show-inline-diagram" data-diagram="0"></div><p>After</p>',
    diagrams: [diagram],
  };

  it('puts a viewer in each diagram place', async () => {
    const { container } = await show(markdownInput, rendered);
    const place = container.querySelector('[data-diagram="0"]');
    expect(place?.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(place?.querySelector('svg')).not.toBeNull();
  });

  it('stays a still picture in the miniature', async () => {
    const { container } = await show(markdownInput, rendered, true);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.querySelector('[data-diagram="0"] svg')).not.toBeNull();
  });
});
