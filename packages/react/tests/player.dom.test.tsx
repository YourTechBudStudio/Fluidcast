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
  settle,
  type,
  unmountAll,
  waitFor,
} from './support/render';
import {
  askChoice,
  forward,
  type ScriptedSession,
  scriptedSession,
  showMarkdown,
  speak,
  TransportError,
} from './support/session';

/**
 * The public `FluidcastPlayer` in a DOM, over real Harness sessions: what one instance does never reaches another, keys
 * reach only the focused player, layout follows each root's own width, and unmounting releases the instance without
 * ending its session. Playback starts only from the listener's intent, and only while the host shows the player.
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
    /** Whether a button with this label is rendered. */
    has: (label: string) =>
      [...root.querySelectorAll('button')].some(
        (candidate) =>
          candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label,
      ),
    /** Whether a button with this label is rendered and can be pressed. */
    available: (label: string) =>
      [...root.querySelectorAll('button')].some(
        (candidate) =>
          (candidate.getAttribute('aria-label') === label ||
            candidate.textContent?.trim() === label) &&
          candidate.getAttribute('aria-disabled') !== 'true',
      ),
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

/** Two players side by side, each over its own session. `show` changes what the host shows. */
const mountPair = async () => {
  const a = await session();
  const b = await session();
  const connectionA = a.connection();
  const connectionB = b.connection();
  const pair = (visibleA: boolean, visibleB: boolean) => (
    <>
      <div data-player="a">
        <FluidcastPlayer connection={connectionA} visible={visibleA} />
      </div>
      <div data-player="b">
        <FluidcastPlayer connection={connectionB} visible={visibleB} />
      </div>
    </>
  );
  const { container, rerender } = await mount(pair(true, true));
  const scope = (name: string) => container.querySelector(`[data-player="${name}"]`)!;
  await waitFor(
    () => a.openSubscriptions() === 1 && b.openSubscriptions() === 1,
    'both subscribed',
  );
  return {
    a,
    b,
    playerA: player(scope('a')),
    playerB: player(scope('b')),
    show: (visibleA: boolean, visibleB: boolean) => rerender(pair(visibleA, visibleB)),
  };
};

/** One player over `s`, whose visibility the test changes on the same connection. */
const mountOne = async (s: ScriptedSession, visible = true) => {
  const connection = s.connection();
  const view = await mount(<FluidcastPlayer connection={connection} visible={visible} />);
  return {
    ...view,
    p: player(view.container),
    show: (next: boolean) =>
      view.rerender(<FluidcastPlayer connection={connection} visible={next} />),
  };
};

/** `play()` calls on every element so far. */
const plays = () => [...browser.media.values()].reduce((sum, record) => sum + record.plays, 0);
const pausesOf = (element: HTMLMediaElement) => browser.media.get(element)?.pauses ?? 0;

/** Silence lands on the player's next turn, well before disposal (500 ms). */
const SILENCE_MS = 100;

/** Waits until `element` is paused again after `before` pauses, within the silence bound. */
const silenced = (element: HTMLMediaElement, before: number) =>
  waitFor(() => pausesOf(element) > before, 'element paused', SILENCE_MS);

const relayedPause = (s: ScriptedSession, paused: boolean) =>
  s.relayed.some(({ message }) => message._tag === 'PauseChanged' && message.paused === paused);

/** The Pause commands a session received. */
const pauseCount = (s: ScriptedSession) => s.tags().filter((tag) => tag === 'Pause').length;

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

describe('the worker strip', () => {
  const working = { status: 'working', sessionId: 'w1', backgroundTasks: 0 } as const;
  const prompt = {
    _tag: 'prompt',
    parentToolUseId: null,
    source: 'fluidcast',
    text: 'Go',
  } as const;
  const bash = {
    _tag: 'toolCall',
    parentToolUseId: null,
    toolUseId: 't1',
    name: 'Bash',
    input: JSON.stringify({ command: 'pnpm test' }),
    truncated: false,
  } as const;
  const strip = (p: Player) => p.has('Open the worker');
  /** The status line's slot is given to the strip: the status line is still there, but inert. */
  const statusLineShown = (p: Player) =>
    p.root.querySelector('[role="status"]')?.closest('[inert]') === null;

  it('keeps the worker feeds open for the instance, without the Worker layer', async () => {
    const s = await session();
    await mount(<FluidcastPlayer connection={s.connection()} visible />);
    await waitFor(() => s.openWorkerFeeds() === 2, 'both Worker feeds open');
  });

  it('takes the status line’s slot while the worker works, and opens the Worker layer', async () => {
    const s = await session();
    const view = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    const p = player(view.container);
    await s.pushWorkerStatus(working);
    await s.pushTranscript(prompt);
    await settle();
    // Nothing is invented before the turn's first event.
    expect(strip(p)).toBe(false);
    expect(statusLineShown(p)).toBe(true);

    await s.pushTranscript(bash);
    await waitFor(() => strip(p), 'strip shown');
    expect(p.button('Open the worker').textContent).toContain('Bash');
    expect(p.button('Open the worker').textContent).toContain('pnpm test');
    expect(statusLineShown(p)).toBe(false);

    await press(p.button('Open the worker'));
    expect(p.pressed('Worker')).toBe(true);

    await s.pushWorkerStatus({ ...working, status: 'idle' });
    await waitFor(() => !strip(p), 'strip gone');
    expect(statusLineShown(p)).toBe(true);
  });

  it('gives way to a status line reporting an error', async () => {
    const s = await session();
    const view = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    const p = player(view.container);
    await s.pushWorkerStatus(working);
    await s.pushTranscript(prompt, bash);
    await waitFor(() => strip(p), 'strip shown');

    s.failSend('SendMessage', new TransportError({ reason: 'Unreachable' }));
    await p.send('Are you there?');
    await waitFor(() => !strip(p), 'strip gone');
    expect(statusLineShown(p)).toBe(true);
    expect(p.root.querySelector('[role="status"]')?.textContent).not.toBe('');
  });

  it('lights the dock’s border from outside its clipping wrapper', async () => {
    const s = await session();
    const view = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    const glow = view.container.querySelector('[data-worker-glow]');
    expect(glow?.parentElement?.hasAttribute('data-dock')).toBe(true);
    expect(glow?.closest('[data-dock-clip]')).toBeNull();
    expect(view.container.querySelector('[data-dock-clip] textarea')).not.toBeNull();
  });
});

describe('a forward', () => {
  it('closes an open Show panel', async () => {
    const s = await scriptedSession([
      [showMarkdown('# Before'), speak('A.')],
      [forward, speak('On it.')],
    ]);
    sessions.push(s);
    const view = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    const p = player(view.container);
    const audio = await startPlayback(p, s);
    await waitFor(() => p.pressed('Show'), 'Show open');
    await end(audio.element);
    await waitFor(() => p.has('Send'), 'composer open');

    await p.send('Hand it over.');
    await waitFor(() => !p.pressed('Show'), 'Show closed by the forward');
  });

  it('lights the glow before the worker reports anything, without inventing a strip line', async () => {
    const s = await scriptedSession([[forward, speak('On it.')]]);
    sessions.push(s);
    const view = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    const p = player(view.container);
    const glow = () => p.root.querySelector('[data-worker-glow]');
    expect(glow()?.classList.contains('opacity-0')).toBe(true);

    await p.send('Hand it over.');
    await waitFor(() => glow()?.querySelector('.worker-glow-drift') != null, 'glow lit');
    expect(glow()?.classList.contains('opacity-100')).toBe(true);
    expect(p.has('Open the worker')).toBe(false);
  });
});

describe('releasing an instance', () => {
  it('cleans up without ending the session, which a new player picks up', async () => {
    const s = await session();
    const view = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    const first = player(view.container);
    const audio = await startPlayback(first, s);
    await press(first.button('Worker'));
    await waitFor(() => s.openWorkerFeeds() > 0, 'Worker feed open');

    // Silent at once: the element pauses before disposal, while its source and context still exist, with no Pause.
    const pauses = pausesOf(audio.element);
    await view.unmount();
    await silenced(audio.element, pauses);
    expect(audio.element.getAttribute('src')).not.toBeNull();
    expect(audio.context.closed).toBe(false);
    expect(s.tags()).not.toContain('Pause');

    await afterDisposal();
    expect(s.openSubscriptions()).toBe(0);
    expect(s.openWorkerFeeds()).toBe(0);
    expect(audio.element.getAttribute('src')).toBeNull();
    expect(audio.context.closed).toBe(true);
    expect(s.tags().filter((tag) => !ORDINARY.has(tag))).toEqual([]);

    // The session lives on: a new player receives a snapshot holding the conversation so far, and waits for a tap.
    const before = plays();
    const next = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    await waitFor(() => s.openSubscriptions() === 1, 'resubscribed');
    const latest = Math.max(...s.relayed.map((entry) => entry.subscription));
    const opening = s.relayed.find((entry) => entry.subscription === latest)?.message;
    expect(opening?._tag).toBe('Snapshot');
    expect(opening?._tag === 'Snapshot' && opening.state.actions.length).toBeGreaterThan(0);
    await waitFor(() => player(next.container).has('Tap to resume'), 'held');
    expect(plays()).toBe(before);
  });

  it('releases the old instance the same way when the connection changes', async () => {
    const s = await session();
    const view = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    const audio = await startPlayback(player(view.container), s);

    await view.rerender(<FluidcastPlayer connection={s.connection()} visible />);
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
    const view = await mount(<FluidcastPlayer connection={s.connection()} visible />);
    await waitFor(() => s.openSubscriptions() === 1, 'subscribed');
    const labels = [...view.container.querySelectorAll('button')].map(
      (button) => `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`,
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((label) => /reset/i.test(label))).toEqual([]);
  });
});

describe('entering a session', () => {
  it('waits for a tap on a session that was already speaking, whatever else the listener does', async () => {
    const s = await session();
    await s.drive({ _tag: 'SendMessage', text: 'Walk me through it.' });
    const { p } = await mountOne(s);
    await waitFor(() => p.has('Tap to resume'), 'held');

    // Unlocking gestures that are not asking for audio.
    await press(p.button('Transcript'));
    await press(p.button('Transcript'));
    await press(p.button('Show'));
    const field = p.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
    await press(field);
    await type(field, 'Hold on');
    await settle(50);
    expect(browser.contexts.length).toBe(1);
    expect(plays()).toBe(0);
    expect(p.has('Tap to resume')).toBe(true);

    await press(p.button('Tap to resume'));
    await waitFor(() => plays() === 1, 'line playing');
  });

  it('plays a preloaded start only on Tap to start', async () => {
    const s = await scriptedSession(SCRIPT, {
      start: { message: 'Begin.', context: { label: 'Brief', text: 'Notes.' } },
    });
    sessions.push(s);
    const { p } = await mountOne(s);
    await waitFor(() => p.has('Tap to start'), 'ready');
    await press(p.button('Transcript'));
    await settle(50);
    expect(s.tags()).toEqual([]);

    await press(p.button('Tap to start'));
    await waitFor(() => plays() === 1, 'first line playing');
    expect(s.tags().filter((tag) => tag !== 'ToolCommand')).toEqual(['Play']);
  });

  it('holds a line that arrives after mount when the listener only looked around', async () => {
    const s = await session();
    const generating = s.holdModel();
    await s.drive({ _tag: 'SendMessage', text: 'Walk me through it.' });
    const { p } = await mountOne(s);
    await waitFor(() => s.openSubscriptions() === 1, 'subscribed');
    await press(p.button('Transcript'));
    generating.release();
    await waitFor(() => p.has('Tap to resume'), 'held');
    expect(plays()).toBe(0);
  });
});

describe('visibility', () => {
  it('pauses the session on hide, silencing at once, and resumes nothing on show', async () => {
    const s = await session();
    const { p, show } = await mountOne(s);
    const audio = await startPlayback(p, s);
    const source = audio.element.getAttribute('src');

    const pausing = s.holdSend('Pause');
    const pauses = pausesOf(audio.element);
    await show(false);
    // Silence does not wait for the Pause round trip.
    await silenced(audio.element, pauses);
    expect(s.tags()).toContain('Pause');
    expect(relayedPause(s, true)).toBe(false);
    pausing.release();
    await waitFor(() => relayedPause(s, true), 'pause relayed');

    const played = plays();
    await show(true);
    await settle(50);
    expect(plays()).toBe(played);
    expect(s.tags()).not.toContain('Play');

    await press(p.button('Play'));
    await waitFor(() => plays() === played + 1, 'resumed');
    expect(audio.element.getAttribute('src')).toBe(source);
  });

  it('stays silent and holds the line on show when the hide’s Pause fails', async () => {
    const s = await session();
    const { p, show } = await mountOne(s);
    const audio = await startPlayback(p, s);
    s.failSend('Pause', new TransportError({ reason: 'Unreachable' }));
    const pauses = pausesOf(audio.element);
    await show(false);
    await silenced(audio.element, pauses);
    await waitFor(() => s.tags().includes('Pause'), 'Pause sent');

    const played = plays();
    await show(true);
    await waitFor(() => p.has('Tap to resume'), 'held');
    expect(plays()).toBe(played);
  });

  it('never sounds when mounted hidden, and pauses once however often it re-renders', async () => {
    const s = await session();
    await s.drive({ _tag: 'SendMessage', text: 'Walk me through it.' });
    const { show } = await mountOne(s, false);
    await waitFor(() => relayedPause(s, true), 'session paused');
    await show(false);
    await show(false);
    await settle(50);
    expect(pauseCount(s)).toBe(1);
    expect(plays()).toBe(0);
  });

  it('pauses only the player that was hidden', async () => {
    const { a, b, playerA, playerB, show } = await mountPair();
    const audioA = await startPlayback(playerA, a);
    const audioB = await startPlayback(playerB, b);
    const pausesA = pausesOf(audioA.element);
    const pausesB = pausesOf(audioB.element);
    await show(false, true);
    await silenced(audioA.element, pausesA);
    await waitFor(() => relayedPause(a, true), 'A paused');
    expect(pausesOf(audioB.element)).toBe(pausesB);
    expect(b.tags()).not.toContain('Pause');
    expect(relayedPause(b, true)).toBe(false);
  });
});

describe('gate writes follow the UI order', () => {
  it('leaves nothing silenced locally when the hide’s Pause lands after the player is shown again', async () => {
    const s = await session();
    await s.drive({ _tag: 'SendMessage', text: 'Walk me through it.' });
    const building = s.holdConstruction();
    const { p, show } = await mountOne(s);
    await show(false);
    await show(true);
    building.release();
    // The late Pause runs once the runtime is built; the session is paused (in its snapshot or a later event).
    await waitFor(() => pauseCount(s) === 1, 'late Pause sent');
    await waitFor(() => p.available('Play'), 'paused, Play offered');
    expect(plays()).toBe(0);
    await press(p.button('Play'));
    await waitFor(() => plays() === 1, 'line playing');
  });

  it('does not let a Play that lands after a hide sound on show', async () => {
    const s = await session();
    const { p, show } = await mountOne(s);
    await startPlayback(p, s);
    await press(p.button('Pause'));
    await waitFor(() => relayedPause(s, true), 'paused');
    const played = plays();

    const playing = s.holdSend('Play');
    await press(p.button('Play'));
    await show(false);
    await waitFor(() => pauseCount(s) === 2, 'hide paused');
    playing.release();
    await waitFor(() => relayedPause(s, false), 'Play applied');
    await show(true);
    await waitFor(() => p.has('Tap to resume'), 'held');
    expect(plays()).toBe(played);
  });
});
