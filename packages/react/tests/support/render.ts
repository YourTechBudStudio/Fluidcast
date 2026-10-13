import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Rendering through `react-dom/client` under `act`, with real timers: Effect's clock and atom-react's disposal delay
 * are real, so tests wait in real time and poll for outcomes.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  readonly container: HTMLElement;
  readonly rerender: (element: ReactNode) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

const mounted = new Set<{ readonly root: Root; readonly container: HTMLElement }>();
/** Whether anything was rendered since the last `unmountAll`: some instance may still be awaiting disposal. */
let rendered = false;

export async function mount(element: ReactNode): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const entry = { root, container };
  mounted.add(entry);
  rendered = true;
  await act(async () => root.render(element));
  return {
    container,
    rerender: (next) => act(async () => root.render(next)),
    unmount: async () => {
      if (!mounted.delete(entry)) return;
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/**
 * Unmounts everything still mounted, then waits out the registries' delayed disposal, so no instance's cleanup (its
 * element's `pause`, revoked URLs, closed streams) lands in the next test's records: for `afterEach`, before sessions
 * close and browser stubs are restored. Instances released earlier in the test (an `unmount`, or a `rerender` with a
 * new connection) are covered too.
 */
export async function unmountAll(): Promise<void> {
  for (const entry of [...mounted]) {
    mounted.delete(entry);
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  if (!rendered) return;
  rendered = false;
  await afterDisposal();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits in real time, letting React flush whatever the runtime did meanwhile. */
export const settle = (ms = 20): Promise<void> => act(() => sleep(ms));

/** Waits out atom-react's registry disposal, 500 ms after a `RegistryProvider` unmounts. */
export const afterDisposal = (): Promise<void> => settle(600);

/** Polls `check` (flushing React between polls) until it holds, failing after `timeout` ms with `what`. */
export async function waitFor(check: () => boolean, what: string, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
    await settle(10);
  }
}

/** Runs a DOM interaction under `act`. */
export const interact = (run: () => void): Promise<void> => act(async () => run());

/** Clicks `element` as a pointer would: the press, then the click. */
export const press = (element: Element): Promise<void> =>
  interact(() => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

/** Dispatches a `keydown` for the key `name` at `target` (default: the focused element) and returns the event. */
export async function key(name: string, target?: Element): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  await interact(
    () => void (target ?? document.activeElement ?? document.body).dispatchEvent(event),
  );
  return event;
}

/** Types `text` into a React-controlled text field. */
export const type = (field: HTMLTextAreaElement | HTMLInputElement, text: string): Promise<void> =>
  interact(() => {
    const prototype = Object.getPrototypeOf(field) as object;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
