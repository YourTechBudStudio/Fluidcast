import type { AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import type { ComposerMode, TimelineRow } from '../../conversation';
import type { ShowBody } from '../../tools';
import type { VisualState } from '../../visuals';

/**
 * Prepared states for the player-controls mock. Temporary scaffolding: no cursor or queue rules live here, only what
 * each moment looks like, paused or not. Back and Forward step through prepared walks (see `walkFor`).
 */

export type ContentId =
  | 'speechA'
  | 'speechB'
  | 'speechC'
  | 'end'
  | 'thinking'
  | 'workWaiting'
  | 'ask'
  | 'askSilent'
  | 'ready'
  | 'disconnected'
  | 'audioFailed'
  | 'generationFailed';

export type Dot = 'blue' | 'violet' | 'cyan' | 'subtle' | 'red';

export interface StatusText {
  readonly text: string;
  readonly dot: Dot;
  readonly pulse?: boolean;
}

export interface Content {
  readonly line: { readonly text: string; readonly dim?: boolean } | null;
  /** The status line, given whether the player is paused. Empty text hides it, as while speaking. */
  readonly status: (paused: boolean) => StatusText;
  readonly dock:
    | { readonly kind: 'composer'; readonly mode: ComposerMode }
    | { readonly kind: 'ask'; readonly input: AskInput };
  readonly show: boolean;
  readonly visual: VisualState;
  /**
   * Whether something moves on its own when unpaused: then the middle button offers Pause. Otherwise it offers Play,
   * unavailable unless paused (releasing the hold) or `startable`.
   */
  readonly progressing: boolean;
  readonly startable?: boolean;
  readonly connected: boolean;
  /**
   * Still in effect when Back selects an earlier line: an open question, running work or a failed generation keeps its
   * status (and an open question its dock) while the dialogue and the composer follow the selection.
   */
  readonly standing?: boolean;
}

const PAUSED: StatusText = { text: 'Paused', dot: 'subtle' };
const speaking = (paused: boolean): StatusText => (paused ? PAUSED : { text: '', dot: 'blue' });

const SPEECH_A =
  'Let me walk you through what changed in the session store before we look at the cache.';
const SPEECH_B =
  'Here is the shape of the new cache: three layers, each one cheaper to read than the one above it.';
const SPEECH_C =
  'The tricky part is invalidation, so that is where the worker is spending most of its time.';

const ASK_LINE = 'Before I go on, which part should we dig into first?';
const ASK_INPUT: AskInput = {
  kind: 'choice',
  question: 'Which part should we dig into first?',
  options: [{ label: 'Cache layers' }, { label: 'Invalidation' }, { label: 'Session store' }],
};

export const CONTENT: Record<ContentId, Content> = {
  speechA: {
    line: { text: SPEECH_A },
    status: speaking,
    dock: { kind: 'composer', mode: 'busy' },
    show: false,
    visual: 'speaking',
    progressing: true,
    connected: true,
  },
  speechB: {
    line: { text: SPEECH_B },
    status: speaking,
    dock: { kind: 'composer', mode: 'busy' },
    show: true,
    visual: 'speaking',
    progressing: true,
    connected: true,
  },
  speechC: {
    line: { text: SPEECH_C },
    status: speaking,
    dock: { kind: 'composer', mode: 'busy' },
    show: true,
    visual: 'speaking',
    progressing: true,
    connected: true,
  },
  end: {
    line: { text: SPEECH_C, dim: true },
    status: (paused) =>
      paused ? { text: 'Paused · Your turn.', dot: 'subtle' } : { text: 'Your turn.', dot: 'cyan' },
    dock: { kind: 'composer', mode: 'compose' },
    show: true,
    visual: 'idle',
    progressing: false,
    connected: true,
  },
  thinking: {
    line: { text: SPEECH_C, dim: true },
    status: (paused) => ({
      text: paused ? 'Paused · Still thinking · 0:14' : 'Thinking · 0:14',
      dot: 'violet',
      pulse: true,
    }),
    dock: { kind: 'composer', mode: 'busy' },
    show: true,
    visual: 'thinking',
    progressing: true,
    connected: true,
    standing: true,
  },
  workWaiting: {
    line: { text: SPEECH_C, dim: true },
    status: (paused) =>
      paused
        ? { text: 'Paused · The worker finished. Play to hear it.', dot: 'cyan' }
        : { text: 'Thinking · 0:01', dot: 'violet', pulse: true },
    dock: { kind: 'composer', mode: 'compose' },
    show: true,
    visual: 'idle',
    progressing: true,
    connected: true,
    standing: true,
  },
  ask: {
    line: { text: ASK_LINE },
    status: (paused) =>
      paused
        ? { text: 'Paused · Question open', dot: 'cyan' }
        : { text: 'Over to you.', dot: 'cyan' },
    dock: { kind: 'ask', input: ASK_INPUT },
    show: true,
    visual: 'speaking',
    progressing: true,
    connected: true,
    standing: true,
  },
  // Forward past the Ask's narration: silent, with the question still open.
  askSilent: {
    line: { text: ASK_LINE, dim: true },
    status: (paused) =>
      paused
        ? { text: 'Paused · Question open', dot: 'cyan' }
        : { text: 'Over to you.', dot: 'cyan' },
    dock: { kind: 'ask', input: ASK_INPUT },
    show: true,
    visual: 'idle',
    progressing: false,
    connected: true,
    standing: true,
  },
  ready: {
    line: null,
    status: () => ({ text: 'Ready when you are.', dot: 'cyan' }),
    dock: { kind: 'composer', mode: 'busy' },
    show: false,
    visual: 'idle',
    progressing: false,
    startable: true,
    connected: true,
  },
  disconnected: {
    line: { text: SPEECH_B, dim: true },
    status: () => ({ text: 'Lost you for a sec. Reconnecting…', dot: 'subtle', pulse: true }),
    dock: { kind: 'composer', mode: 'offline' },
    show: true,
    visual: 'offline',
    progressing: true,
    connected: false,
  },
  audioFailed: {
    line: { text: SPEECH_B, dim: true },
    status: () => ({
      text: 'The voice service couldn’t read that line. Retry it?',
      dot: 'red',
    }),
    dock: { kind: 'composer', mode: 'retryClip' },
    show: true,
    visual: 'error',
    progressing: false,
    connected: true,
  },
  generationFailed: {
    line: { text: SPEECH_C, dim: true },
    status: () => ({ text: 'Lost my train of thought. Try again?', dot: 'red' }),
    dock: { kind: 'composer', mode: 'retry' },
    show: true,
    visual: 'error',
    progressing: false,
    connected: true,
    standing: true,
  },
};

/** The selector's entries: a content and whether it opens paused. */
export const SCENARIOS = [
  { id: 'playing', label: 'Playing speech', content: 'speechA', paused: false },
  { id: 'pausedMid', label: 'Paused mid-speech', content: 'speechA', paused: true },
  { id: 'pausedThinking', label: 'Paused while thinking', content: 'thinking', paused: true },
  { id: 'pausedWork', label: 'Paused, work waiting', content: 'workWaiting', paused: true },
  { id: 'forwardShow', label: 'Paused Forward past a Show', content: 'speechB', paused: true },
  { id: 'nextPaused', label: 'Next paused dialogue', content: 'speechC', paused: true },
  { id: 'ask', label: 'Ask open', content: 'ask', paused: false },
  { id: 'ready', label: 'Preloaded ready', content: 'ready', paused: false },
  { id: 'end', label: 'End, nothing ahead', content: 'end', paused: false },
  { id: 'disconnected', label: 'Disconnected', content: 'disconnected', paused: true },
  { id: 'audioFailed', label: 'Audio failure', content: 'audioFailed', paused: false },
  {
    id: 'generationFailed',
    label: 'Generation failure',
    content: 'generationFailed',
    paused: false,
  },
] as const satisfies readonly {
  id: string;
  label: string;
  content: ContentId;
  paused: boolean;
}[];

export type ScenarioId = (typeof SCENARIOS)[number]['id'];

export const SHOW_INPUT: ShowInput = {
  title: 'Cache layers',
  format: 'markdown',
  content: '',
};

export const SHOW_BODY: ShowBody = {
  state: 'rendered',
  rendered: {
    kind: 'markup',
    renderIds: [],
    html: `<h2>Three layers</h2>
<ol>
<li><strong>Memory</strong>: per process, cleared on deploy.</li>
<li><strong>Redis</strong>: shared, 10 minute expiry.</li>
<li><strong>Postgres</strong>: the source of truth.</li>
</ol>
<p>Reads fall through from the top; writes go to Postgres and invalidate the two layers above it.</p>`,
  },
};

const REQUEST = 'Walk me through the cache change.';
const GUIDE = { id: 'guide', name: 'Guide' };

/** Where each content leaves the transcript: the lines so far, and the marker on the line at the cursor. */
const TRANSCRIPT: Record<
  Exclude<ContentId, 'ready'>,
  { readonly lines: readonly string[]; readonly marked: 'line' | 'audioFailed' | null }
> = {
  speechA: { lines: [SPEECH_A], marked: 'line' },
  speechB: { lines: [SPEECH_A, SPEECH_B], marked: 'line' },
  speechC: { lines: [SPEECH_A, SPEECH_B, SPEECH_C], marked: 'line' },
  end: { lines: [SPEECH_A, SPEECH_B, SPEECH_C], marked: null },
  thinking: { lines: [SPEECH_A, SPEECH_B, SPEECH_C], marked: null },
  workWaiting: { lines: [SPEECH_A, SPEECH_B, SPEECH_C], marked: null },
  ask: { lines: [SPEECH_A, SPEECH_B, SPEECH_C, ASK_LINE], marked: 'line' },
  askSilent: { lines: [SPEECH_A, SPEECH_B, SPEECH_C, ASK_LINE], marked: null },
  disconnected: { lines: [SPEECH_A, SPEECH_B], marked: null },
  audioFailed: { lines: [SPEECH_A, SPEECH_B], marked: 'audioFailed' },
  generationFailed: { lines: [SPEECH_A, SPEECH_B, SPEECH_C], marked: null },
};

/**
 * The transcript rows: every line up to the furthest point reached, as the live transcript lists every action, with
 * the marker on the selected line. Shows are left out: their cards read the live conversation.
 */
export function transcriptRows(
  content: ContentId,
  frontier: ContentId,
  paused: boolean,
): readonly TimelineRow[] {
  if (content === 'ready' || frontier === 'ready') {
    return [{ kind: 'preloaded', id: 'request', text: REQUEST, contextLabel: null }];
  }
  const { lines } = TRANSCRIPT[frontier];
  const { lines: upToSelected, marked } = TRANSCRIPT[content];
  const selected = marked === null ? -1 : upToSelected.length - 1;
  return [
    { kind: 'user', id: 'request', text: REQUEST },
    ...lines.map((text, index): TimelineRow => ({
      kind: 'speak',
      id: `line-${index}`,
      speaker: GUIDE,
      tone: 0,
      text,
      continued: index > 0,
      interrupted: false,
      now:
        index !== selected
          ? null
          : marked === 'audioFailed'
            ? 'audioFailed'
            : paused
              ? 'paused'
              : 'playing',
    })),
  ];
}

const SPEECHES = ['speechA', 'speechB', 'speechC'] as const satisfies readonly ContentId[];

/**
 * The prepared walk Back and Forward move along, given the furthest point reached: the three speeches, then where
 * that conversation stands. Back never changes the furthest point; only Forward past it does. A failed clip sits in
 * Speech B's place, and Forward skips it. Contents outside any walk (ready, disconnected) offer no navigation.
 */
export function walkFor(frontier: ContentId): readonly ContentId[] | null {
  switch (frontier) {
    case 'speechA':
    case 'speechB':
    case 'speechC':
    case 'end':
      return [...SPEECHES, 'end'];
    case 'ask':
    case 'askSilent':
      return [...SPEECHES, 'ask', 'askSilent'];
    case 'thinking':
    case 'workWaiting':
    case 'generationFailed':
      return [...SPEECHES, frontier];
    case 'audioFailed':
      return ['speechA', 'audioFailed', 'speechC', 'end'];
    case 'ready':
    case 'disconnected':
      return null;
  }
}
