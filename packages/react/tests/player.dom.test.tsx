// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FluidcastPlayer } from '../src/index';
import { type Browser, installBrowser } from './support/browser';
import {
  afterDisposal,
  interact,
  key,
  mount,
  press,
  type,
  unmountAll,
  waitFor,
} from './support/render';
import {
  askChoice,
  type ScriptedSession,
  scriptedSession,
  showMarkdown,
  speak,
} from './support/session';

/**
 * The public `FluidcastPlayer` in a DOM, over real Harness sessions: what one instance does never reaches another, keys
 * reach only the focused player, layout follows each root's own width, and unmounting releases the instance without
 * ending its session. Playback always starts from an explicit intent (sending a message), never at mount.
 */

/** A Show, then a line, then a question: the Show is available at once, the question once the line has played. */
const SCRIPT = [[showMarkdown('# Layers'), speak('A.'), askChoice('Which one?', ['Red', 'Blue'])]];

let browser: Browser;
const sessions: Array<ScriptedSession> = [];
const session = async () => {
  const created = await scriptedSession(SCRIPT);
  sessions.push(created);
  return created;
};

beforeEach(() => {
  browser = installBrowser();
});
afterEach(async () => {
  await unmountAll();
  for (const created of sessions.splice(0)) await created.close();
  browser.restore();
});

/** One mounted player, found through its root. */
const player = (scope: ParentNode) => {
  const root = scope.querySelector<HTMLDivElement>('.fluidcast-player');
  if (root === null) throw new Error('no player root');
  const button = (label: string) => {
    const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) =>
        candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no "${label}" button`);
    return found;
  };
  return {
    root,
    button,
    pressed: (label: string) => button(label).getAttribute('aria-pressed') === 'true',
    /** The side panel, when the layout has one. */
    panel: () => root.querySelector('aside[aria-label="Show"]'),
    /** The open sheet, when the layout uses it. */
    sheet: () => root.querySelector('section[aria-label="Show"]'),
    /** Whether the transport sits in a strip under the composer (compact) rather than at its leading edge. */
    controlsUnderComposer: () => {
      const controls = root.querySelector('[role="group"][aria-label="Player"]');
      const composer = root.querySelector('textarea[aria-label="Message"]');
      if (!controls || !composer) throw new Error('no dock');
      return Boolean(composer.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    question: () => root.querySelector('section[aria-label="Question"]'),
    send: async (text: string) => {
      const field = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
      if (!field) throw new Error('no composer');
      await type(field, text);
      await press(button('Send'));
    },
  };
};
type Player = ReturnType<typeof player>;

/** Two players side by side, each over its own session. */
const mountPair = async () => {
  const a = await session();
  const b = await session();
  const { container } = await mount(
    <>
      <div data-player="a">
        <FluidcastPlayer connection={a.connection()} />
      </div>
      <div data-player="b">
        <FluidcastPlayer connection={b.connection()} />
      </div>
    </>,
  );
  const scope = (name: string) => container.querySelector(`[data-player="${name}"]`)!;
  await waitFor(
    () => a.openSubscriptions() === 1 && b.openSubscriptions() === 1,
    'both subscribed',
  );
  return { a, b, playerA: player(scope('a')), playerB: player(scope('b')) };
};

/** Sends a message in `p` and waits until its line plays on its own element. */
const startPlayback = async (p: Player, s: ScriptedSession) => {
  const before = browser.contexts.length;
  await p.send('Walk me through it.');
  await waitFor(() => s.tags().includes('SendMessage'), 'message sent');
  await waitFor(() => browser.contexts.length > before, 'audio graph built');
  const context = browser.contexts.at(-1)!;
  await waitFor(
    () => context.element !== null && (browser.media.get(context.element)?.plays ?? 0) > 0,
    'line playing',
  );
  return { context, element: context.element! };
};

/** The Ask answers a session received (the Show driver's reports are tool commands too). */
const answers = (s: ScriptedSession) =>
  s.commands.flatMap((command) =>
    command._tag === 'ToolCommand' &&
    typeof command.payload === 'object' &&
    command.payload !== null &&
    'kind' in command.payload
      ? [command.payload]
      : [],
  );

/** Ends the clip playing on `element`, as the browser would. */
const end = (element: HTMLMediaElement) =>
  interact(() => void element.dispatchEvent(new Event('ended')));

describe('two players on one page', () => {
  it('keep commands, Show, layer, visual and playback to themselves', async () => {
    const { a, b, playerA, playerB } = await mountPair();

    // Playback in A: its own context and element; B has neither yet, and sent nothing.
    const audioA = await startPlayback(playerA, a);
    expect(browser.contexts).toHaveLength(1);
    expect(b.commands).toEqual([]);

    // A gesture in A neither creates nor resumes a context for B.
    const resumesA = audioA.context.resumes;
    await press(playerA.root);
    expect(audioA.context.resumes).toBe(resumesA + 1);
    expect(browser.contexts).toHaveLength(1);

    // B plays on a second context and a second element.
    const audioB = await startPlayback(playerB, b);
    expect(browser.contexts).toHaveLength(2);
    expect(audioB.element).not.toBe(audioA.element);
    expect(browser.media.size).toBe(2);

    // A pointerdown in A unlocks only A's context.
    const resumesB = audioB.context.resumes;
    await interact(
      () => void playerA.root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    );
    expect(audioA.context.resumes).toBe(resumesA + 2);
    expect(audioB.context.resumes).toBe(resumesB);

    // The Show panel (each opened its own Show as it ran) and the layer.
    await waitFor(() => playerA.pressed('Show') && playerB.pressed('Show'), 'both Shows open');
    await press(playerA.button('Show'));
    await press(playerA.button('Transcript'));
    expect(playerA.pressed('Show')).toBe(false);
    expect(playerA.pressed('Transcript')).toBe(true);
    expect(playerB.pressed('Show')).toBe(true);
    expect(playerB.panel()?.hasAttribute('inert')).toBe(false);
    expect(playerB.pressed('Transcript')).toBe(false);

    // The visual choice.
    const visualB = playerB.button('Visual').textContent;
    await press(playerA.button('Visual'));
    const orbGlass = await findMenuItem(playerA.root, 'Orb glass');
    await press(orbGlass);
    await waitFor(
      () => playerA.button('Visual').textContent?.includes('Orb glass') === true,
      'A switched',
    );
    expect(playerB.button('Visual').textContent).toBe(visualB);

    // Pausing A pauses only A.
    const pausesB = browser.media.get(audioB.element)!.pauses;
    const sentB = b.commands.length;
    await press(playerA.button('Pause'));
    await waitFor(() => a.tags().includes('Pause'), 'A paused');
    expect(b.commands).toHaveLength(sentB);
    expect(browser.media.get(audioB.element)!.pauses).toBe(pausesB);
  });
});

/** A menu item Base UI renders into the player root once the menu opens. */
const findMenuItem = async (root: HTMLElement, label: string) => {
  let item: Element | undefined;
  await waitFor(() => {
    item = [...root.querySelectorAll('[role="menuitemradio"]')].find((el) =>
      el.textContent?.includes(label),
    );
    return item !== undefined;
  }, `menu item ${label}`);
  return item!;
};

describe('shortcuts', () => {
  it('act only on the focused player, and are consumed', async () => {
    const { a, b, playerA, playerB } = await mountPair();
    const audioA = await startPlayback(playerA, a);
    const audioB = await startPlayback(playerB, b);

    await interact(() => playerA.root.focus());
    const e = await key('e');
    expect(e.defaultPrevented).toBe(true);
    expect(playerA.pressed('Transcript')).toBe(true);
    expect(playerB.pressed('Transcript')).toBe(false);

    await waitFor(() => playerA.pressed('Show') && playerB.pressed('Show'), 'both Shows open');
    const s = await key('s');
    expect(s.defaultPrevented).toBe(true);
    expect(playerA.pressed('Show')).toBe(false);
    expect(playerB.pressed('Show')).toBe(true);

    // Focus outside every player: no player reacts.
    await interact(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).toBe(document.body);
    const outside = await key('e', document.body);
    expect(outside.defaultPrevented).toBe(false);
    expect(playerA.pressed('Transcript')).toBe(true);
    expect(playerB.pressed('Transcript')).toBe(false);

    // With a question open in both, a digit answers only the focused player's.
    await end(audioA.element);
    await end(audioB.element);
    await waitFor(
      () => playerA.question() !== null && playerB.question() !== null,
      'questions open',
    );
    await interact(() => playerA.root.focus());
    const one = await key('1');
    expect(one.defaultPrevented).toBe(true);
    await waitFor(() => answers(a).length === 1, 'A answered');
    expect(answers(a)[0]).toMatchObject({ kind: 'choice', choice: 'Red' });
    expect(answers(b)).toEqual([]);
  });

  it('interrupt with Escape in the focused player only', async () => {
    const { a, b, playerA, playerB } = await mountPair();
    await startPlayback(playerA, a);
    await startPlayback(playerB, b);
    await interact(() => playerA.root.focus());
    const escape = await key('Escape');
    expect(escape.defaultPrevented).toBe(true);
    await waitFor(() => a.tags().includes('Interrupt'), 'A interrupted');
    expect(b.tags()).not.toContain('Interrupt');
  });
});

describe('container layout', () => {
  it('follows each root’s own width', async () => {
    const { a, playerA, playerB } = await mountPair();
    await startPlayback(playerA, a);
    // The Show opens as it runs; at the default width it is the side panel.
    await waitFor(() => playerA.pressed('Show'), 'Show open');
    expect(playerA.panel()?.hasAttribute('inert')).toBe(false);
    expect(playerA.controlsUnderComposer()).toBe(false);

    // Below 640 px only A becomes compact: the Show moves to the sheet and the controls to a strip.
    await interact(() => browser.resize(playerA.root, 600));
    expect(playerA.panel()).toBeNull();
    await waitFor(() => playerA.sheet() !== null, 'sheet when compact');
    expect(playerA.controlsUnderComposer()).toBe(true);
    expect(playerB.panel()).not.toBeNull();
    expect(playerB.controlsUnderComposer()).toBe(false);

    // At 700 px the dock is wide again, but the panel does not fit: the Show stays a sheet.
    await interact(() => browser.resize(playerA.root, 700));
    expect(playerA.controlsUnderComposer()).toBe(false);
    expect(playerA.panel()).toBeNull();
    expect(playerA.sheet()).not.toBeNull();

    // From 734 px the panel fits.
    await interact(() => browser.resize(playerA.root, 734));
    expect(playerA.panel()).not.toBeNull();
  });
});

/** Commands a player sends in normal use; nothing here ends or deletes a session. */
const ORDINARY = new Set([
  'SendMessage',
  'PlaybackFinished',
  'ToolCommand',
  'Pause',
  'Play',
  'Back',
  'Next',
]);

describe('releasing an instance', () => {
  it('cleans up without ending the session, which a new player picks up', async () => {
    const s = await session();
    const view = await mount(<FluidcastPlayer connection={s.connection()} />);
    const first = player(view.container);
    const audio = await startPlayback(first, s);
    await press(first.button('Worker'));
    await waitFor(() => s.openWorkerFeeds() > 0, 'Worker feed open');

    await view.unmount();
    await afterDisposal();
    expect(s.openSubscriptions()).toBe(0);
    expect(s.openWorkerFeeds()).toBe(0);
    expect(audio.element.getAttribute('src')).toBeNull();
    expect(audio.context.closed).toBe(true);
    expect(s.tags().filter((tag) => !ORDINARY.has(tag))).toEqual([]);

    // The session lives on: a new player receives a snapshot holding the conversation so far.
    await mount(<FluidcastPlayer connection={s.connection()} />);
    await waitFor(() => s.openSubscriptions() === 1, 'resubscribed');
    const latest = Math.max(...s.relayed.map((entry) => entry.subscription));
    const opening = s.relayed.find((entry) => entry.subscription === latest)?.message;
    expect(opening?._tag).toBe('Snapshot');
    expect(opening?._tag === 'Snapshot' && opening.state.actions.length).toBeGreaterThan(0);
  });

  it('releases the old instance the same way when the connection changes', async () => {
    const s = await session();
    const view = await mount(<FluidcastPlayer connection={s.connection()} />);
    const audio = await startPlayback(player(view.container), s);

    await view.rerender(<FluidcastPlayer connection={s.connection()} />);
    await afterDisposal();
    expect(s.openSubscriptions()).toBe(1);
    expect(audio.element.getAttribute('src')).toBeNull();
    expect(audio.context.closed).toBe(true);
    const latest = Math.max(...s.relayed.map((entry) => entry.subscription));
    expect(latest).toBe(2);
    expect(s.relayed.find((entry) => entry.subscription === 2)?.message._tag).toBe('Snapshot');
    expect(s.tags().filter((tag) => !ORDINARY.has(tag))).toEqual([]);
  });
});

describe('Reset', () => {
  it('is not part of the player', async () => {
    const s = await session();
    const view = await mount(<FluidcastPlayer connection={s.connection()} />);
    await waitFor(() => s.openSubscriptions() === 1, 'subscribed');
    const labels = [...view.container.querySelectorAll('button')].map(
      (button) => `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`,
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((label) => /reset/i.test(label))).toEqual([]);
  });
});
