// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Skill } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { FluidcastPlayer } from '../src/index';
import { type Browser, installBrowser } from './support/browser';
import { interact, key, mount, press, settle, type, unmountAll, waitFor } from './support/render';
import { type ScriptedSession, scriptedSession, speak, TransportError } from './support/session';

/**
 * The composer's skill menu in the public player: it opens only with a list and a leading `/name` being typed, its keys
 * are marked as handled (never stopped) so the player and Enter-to-send skip them, and without a list the composer is
 * exactly as before.
 */

const SKILLS: ReadonlyArray<Skill> = [
  { name: 'shaping-issues', description: 'Shape the work into issues.' },
  { name: 'ui-design', description: 'Review a design.' },
  { name: 'designing-ui', description: 'Explore distinct UI variants you can see.' },
  { name: 'design-architecture', description: 'Boundaries, responsibilities, tradeoffs.' },
];

let browser: Browser;
const sessions: Array<ScriptedSession> = [];

beforeEach(() => {
  browser = installBrowser();
});
afterEach(async () => {
  await unmountAll();
  for (const created of sessions.splice(0)) await created.close();
  browser.restore();
});

const mountWith = async (skills: ReadonlyArray<Skill> | TransportError) => {
  const s = await scriptedSession([[speak('Sure.')]], { skills });
  sessions.push(s);
  const { container } = await mount(<FluidcastPlayer connection={s.connection()} visible />);
  const root = container.querySelector<HTMLDivElement>('.fluidcast-player')!;
  const field = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
  await waitFor(() => !field.disabled, 'composer ready');
  await settle();
  await interact(() => field.focus());
  const listbox = () => root.querySelector('[role="listbox"]');
  const options = () => [...root.querySelectorAll('[role="option"]')];
  const optionNames = () => options().map((o) => o.querySelector('.font-mono')?.textContent);
  return { s, root, field, listbox, options, optionNames };
};

const sent = (s: ScriptedSession) =>
  s.commands.flatMap((command) => (command._tag === 'SendMessage' ? [command.text] : []));

describe('the skill menu', () => {
  it('suggests matching skills above the dock while a leading /name is typed', async () => {
    const { s, root, field, listbox, options, optionNames } = await mountWith(SKILLS);
    expect(s.skillReads()).toBe(1);

    await type(field, '/');
    expect(optionNames()).toEqual(SKILLS.map((skill) => `/${skill.name}`));

    await type(field, '/des');
    expect(optionNames()).toEqual(['/designing-ui', '/design-architecture', '/ui-design']);
    expect(root.textContent).toContain('3 of 4');
    // Combobox semantics: the text box controls the listbox and names the active option.
    expect(field.getAttribute('role')).toBe('combobox');
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-controls')).toBe(listbox()!.id);
    expect(field.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
    // Matched characters are marked.
    expect([...options()[0]!.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'd',
      'e',
      's',
    ]);

    const down = await key('ArrowDown', field);
    expect(down.defaultPrevented).toBe(true);
    expect(field.getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    await key('ArrowUp', field);
    await key('ArrowUp', field);
    expect(field.getAttribute('aria-activedescendant')).toBe(options()[2]!.id);
  });

  it('opens on upper case and completes to the real name', async () => {
    const { field, listbox } = await mountWith(SKILLS);
    await type(field, '/Des');
    expect(listbox()).not.toBeNull();
    const tab = await key('Tab', field);
    expect(tab.defaultPrevented).toBe(true);
    expect(field.value).toBe('/designing-ui ');
    expect(field.selectionStart).toBe('/designing-ui '.length);
    expect(listbox()).toBeNull();
  });

  it('completes with Enter without sending, and sends with Enter once the menu is shut', async () => {
    const { s, field, listbox } = await mountWith(SKILLS);
    await type(field, '/des');
    const complete = await key('Enter', field);
    expect(complete.defaultPrevented).toBe(true);
    expect(field.value).toBe('/designing-ui ');
    await settle();
    expect(sent(s)).toEqual([]);

    await type(field, '/designing-ui three mockups');
    expect(listbox()).toBeNull();
    await key('Enter', field);
    await waitFor(() => sent(s).length === 1, 'message sent');
    expect(sent(s)).toEqual(['/designing-ui three mockups']);
  });

  it('picks with the pointer, keeping focus in the text box', async () => {
    const { field, options } = await mountWith(SKILLS);
    await type(field, '/arch');
    const pick = options()[0]!;
    const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    await interact(() => void pick.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    expect(field.value).toBe('/design-architecture ');
    expect(document.activeElement).toBe(field);
  });

  it('closes on Escape, marked as handled so the player does not act on it, until the word changes', async () => {
    const { s, field, listbox } = await mountWith(SKILLS);
    await type(field, '/des');
    const escape = await key('Escape', field);
    expect(escape.defaultPrevented).toBe(true);
    expect(listbox()).toBeNull();
    expect(field.value).toBe('/des');
    await type(field, '/desi');
    expect(listbox()).not.toBeNull();

    // With the menu shut, Escape is left alone.
    await type(field, 'plain words');
    const free = await key('Escape', field);
    expect(free.defaultPrevented).toBe(false);
    expect(s.tags()).not.toContain('Interrupt');
  });

  it('never opens for a path, a later word or no match', async () => {
    const { field, listbox } = await mountWith(SKILLS);
    await type(field, '/tmp/notes.md');
    expect(listbox()).toBeNull();
    await type(field, '/des more');
    expect(listbox()).toBeNull();
    await type(field, '/zzz');
    expect(listbox()).toBeNull();
    expect(field.getAttribute('aria-expanded')).toBe('false');
  });

  it('is never taller than the room above the dock', async () => {
    const { root, field, listbox } = await mountWith(SKILLS);
    const slot = root.querySelector<HTMLElement>('div.pointer-events-none.h-0')!;
    // The root's top is 0 (the fake ResizeObserver owns its box); the slot sits 150 px below it.
    Object.defineProperty(slot, 'getBoundingClientRect', {
      configurable: true,
      value: () => DOMRect.fromRect({ x: 0, y: 150, width: 600, height: 0 }),
    });
    await type(field, '/');
    const menu = listbox()!.parentElement!;
    expect(menu.style.maxHeight).toBe('142px');
    expect(listbox()!.className).toContain('overflow-y-auto');
  });

  it('keeps the active option in view when a resize makes the menu shorter', async () => {
    const { root, field, listbox, options } = await mountWith(SKILLS);
    let slotTop = 400;
    const slot = root.querySelector<HTMLElement>('div.pointer-events-none.h-0')!;
    Object.defineProperty(slot, 'getBoundingClientRect', {
      configurable: true,
      value: () => DOMRect.fromRect({ x: 0, y: slotTop, width: 600, height: 0 }),
    });
    await type(field, '/');
    // happy-dom lays nothing out: 44 px rows, and a list as tall as the menu's cap less a 40 px header.
    const list = listbox() as HTMLElement;
    const menu = list.parentElement!;
    options().forEach((option, index) => {
      Object.defineProperty(option, 'offsetTop', { configurable: true, value: index * 44 });
      Object.defineProperty(option, 'offsetHeight', { configurable: true, value: 44 });
    });
    Object.defineProperty(list, 'clientHeight', {
      configurable: true,
      get: () => parseFloat(menu.style.maxHeight) - 40,
    });
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 });

    await key('ArrowUp', field);
    expect(field.getAttribute('aria-activedescendant')).toBe(options()[3]!.id);
    expect(list.scrollTop).toBe(0);

    // Only the height changes: the room shrinks to 112 px, the list to 72 px, and the last row must stay in view.
    slotTop = 120;
    await interact(() => browser.resize(root, 1280));
    expect(menu.style.maxHeight).toBe('112px');
    expect(list.scrollTop).toBe(3 * 44 + 44 - 72);
  });

  it('keeps a trailing blank line in the coloured mirror, so it scrolls with the text box', async () => {
    const { root, field } = await mountWith(SKILLS);
    await type(field, '/designing-ui three\n');
    const mirror = root.querySelector<HTMLElement>('[aria-hidden]:has(> .text-violet)')!;
    expect(mirror.textContent).toBe('/designing-ui three\n\u200b');
  });

  it('colours only a leading /name the Agent tool reads as a skill', async () => {
    const { root, field } = await mountWith(SKILLS);
    const coloured = () => root.querySelector('[aria-hidden] > .text-violet')?.textContent ?? null;
    await type(field, '/designing-ui three mockups');
    expect(coloured()).toBe('/designing-ui');
    await type(field, '/Des');
    expect(coloured()).toBeNull();
    await type(field, '/tmp/notes.md has the draft');
    expect(coloured()).toBeNull();
  });
});

describe('without a skill list', () => {
  it('behaves as before when the list cannot be read: no menu, no error, Enter sends', async () => {
    const { s, root, field, listbox } = await mountWith(
      new TransportError({ reason: 'ServerError' }),
    );
    await type(field, '/des');
    expect(listbox()).toBeNull();
    expect(field.getAttribute('aria-expanded')).toBe('false');
    expect(root.textContent).not.toMatch(/skill/i);
    const enter = await key('Enter', field);
    expect(enter.defaultPrevented).toBe(true);
    await waitFor(() => sent(s).length === 1, 'message sent');
    expect(sent(s)).toEqual(['/des']);
  });

  it('shows no menu for an empty list', async () => {
    const { field, listbox } = await mountWith([]);
    await type(field, '/');
    expect(listbox()).toBeNull();
    await press(field);
    expect(listbox()).toBeNull();
  });
});
