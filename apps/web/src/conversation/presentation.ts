import type { PlaybackStatus, SubtitleLine } from '../playback';
import type { VisualState } from '../visuals';
import type { Action, Connection, ConversationView, Speaker } from './model';

/**
 * The moment the player is in. One value decides the status copy, the composer, the visual and part of the subtitle, so
 * those can never disagree.
 */
export type Moment =
  | 'connecting'
  | 'reconnecting'
  | 'superseded'
  | 'held'
  | 'audioFailed'
  | 'generationFailed'
  | 'speaking'
  | 'thinking'
  | 'waiting'
  | 'fresh'
  | 'complete'
  | 'interrupted';

/** Which controls the composer offers. */
export type ComposerMode = 'compose' | 'busy' | 'retry' | 'retryClip' | 'offline';

export type TimelineRow =
  | { readonly kind: 'user'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'speak';
      readonly id: string;
      readonly speaker: Speaker;
      readonly tone: number;
      readonly text: string;
      /** Same speaker as the previous row: drawn as a continuation. */
      readonly continued: boolean;
      /** The next action is `interrupted`: this line was cut. */
      readonly interrupted: boolean;
      /** Set on the line at the cursor. */
      readonly now: 'playing' | 'audioFailed' | 'held' | 'queued' | null;
    }
  | { readonly kind: 'interrupted'; readonly id: string }
  | { readonly kind: 'failed'; readonly id: string; readonly tag: string; readonly message: string }
  | { readonly kind: 'pending'; readonly label: string };

export interface Presentation {
  readonly moment: Moment;
  readonly composer: ComposerMode;
  readonly visual: VisualState;
  /** Playback waits for a gesture; the visual dims. */
  readonly held: boolean;
  readonly subtitle: SubtitleLine | null;
  readonly timeline: readonly TimelineRow[];
}

const lastIndexWhere = <A>(items: readonly A[], f: (a: A) => boolean) => {
  for (let i = items.length - 1; i >= 0; i--) if (f(items[i]!)) return i;
  return -1;
};

/**
 * Playback status only counts for the speak at the cursor. A status for any other action, such as a late failure for a line that
 * was interrupted, is stale and ignored by identity (ADR 0007).
 */
function playbackAtCursor(
  view: ConversationView,
  playback: PlaybackStatus,
): PlaybackStatus['kind'] {
  if (playback.kind === 'idle' || view.phase !== 'speaking') return 'idle';
  const current = view.actions.at(-1);
  return current?.type === 'speak' && current.id === playback.actionId ? playback.kind : 'idle';
}

export function momentOf(
  view: ConversationView,
  connection: Connection,
  playback: PlaybackStatus,
): Moment {
  if (connection !== 'connected') return connection;
  const atCursor = playbackAtCursor(view, playback);
  if (atCursor === 'held') return 'held';
  if (atCursor === 'failed') return 'audioFailed';
  switch (view.phase) {
    case 'generationFailed':
      return 'generationFailed';
    case 'speaking':
      return 'speaking';
    case 'waiting': {
      const lastUser = lastIndexWhere(view.actions, (a) => a.type === 'user_message');
      return view.actions.slice(lastUser + 1).some((a) => a.type === 'speak')
        ? 'waiting'
        : 'thinking';
    }
    case 'idle': {
      const last = view.actions.at(-1);
      if (!last) return 'fresh';
      return last.type === 'interrupted' ? 'interrupted' : 'complete';
    }
  }
}

const COMPOSER: Record<Moment, ComposerMode> = {
  connecting: 'offline',
  reconnecting: 'offline',
  superseded: 'offline',
  held: 'busy',
  audioFailed: 'retryClip',
  generationFailed: 'retry',
  speaking: 'busy',
  thinking: 'busy',
  waiting: 'busy',
  fresh: 'compose',
  complete: 'compose',
  interrupted: 'compose',
};

const VISUAL: Record<Moment, VisualState> = {
  connecting: 'offline',
  reconnecting: 'offline',
  superseded: 'offline',
  held: 'speaking',
  audioFailed: 'error',
  generationFailed: 'error',
  speaking: 'speaking',
  thinking: 'thinking',
  waiting: 'thinking',
  fresh: 'idle',
  complete: 'idle',
  interrupted: 'idle',
};

/** Speaker accent tones, in configuration order. */
export const SPEAKER_TONES = ['blue', 'green', 'amber', 'violet'] as const;

function speakerOf(view: ConversationView, id: string): { speaker: Speaker; tone: number } {
  const index = view.speakers.findIndex((s) => s.id === id);
  return {
    speaker: view.speakers[index] ?? { id, name: id },
    tone: Math.max(0, index) % SPEAKER_TONES.length,
  };
}

function yourLine(view: ConversationView): SubtitleLine | null {
  const lastUser = view.actions.findLast((a) => a.type === 'user_message');
  return lastUser ? { key: lastUser.id, text: lastUser.text, tone: 'you', label: 'You' } : null;
}

function subtitleOf(
  view: ConversationView,
  moment: Moment,
  playback: PlaybackStatus,
): SubtitleLine | null {
  const multi = view.speakers.length > 1;
  const line = (
    action: Extract<Action, { type: 'speak' }>,
    tone: SubtitleLine['tone'],
    interrupted = false,
  ): SubtitleLine => ({
    key: action.id,
    text: action.text,
    tone,
    interrupted,
    ...(multi ? { label: speakerOf(view, action.speaker).speaker.name } : {}),
  });
  const lastSpeakIndex = lastIndexWhere(view.actions, (a) => a.type === 'speak');
  const lastSpeak = view.actions[lastSpeakIndex] as Extract<Action, { type: 'speak' }> | undefined;

  switch (moment) {
    case 'connecting':
    case 'superseded':
    case 'held':
    case 'fresh':
      return null;
    case 'speaking': {
      // A line appears when its audio starts. Until then the previous line of this turn stays, or your own message if none has played yet.
      if (lastSpeak && playback.kind === 'playing' && playback.actionId === lastSpeak.id)
        return line(lastSpeak, 'current');
      const turnStart = lastIndexWhere(view.actions, (a) => a.type === 'user_message');
      const earlier = view.actions
        .slice(turnStart + 1, lastSpeakIndex)
        .findLast((a) => a.type === 'speak');
      return earlier ? line(earlier, 'current') : yourLine(view);
    }
    case 'thinking':
      return yourLine(view);
    case 'waiting':
      return lastSpeak ? line(lastSpeak, 'current') : null;
    case 'interrupted':
      return lastSpeak
        ? line(lastSpeak, 'dim', view.actions[lastSpeakIndex + 1]?.type === 'interrupted')
        : null;
    default:
      return lastSpeak ? line(lastSpeak, 'dim') : null;
  }
}

function timelineOf(
  view: ConversationView,
  moment: Moment,
  playback: PlaybackStatus,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const cursorSpeak = view.phase === 'speaking' ? view.actions.at(-1) : undefined;
  view.actions.forEach((action, i) => {
    switch (action.type) {
      case 'user_message':
        rows.push({ kind: 'user', id: action.id, text: action.text });
        break;
      case 'speak': {
        const previous = view.actions[i - 1];
        const { speaker, tone } = speakerOf(view, action.speaker);
        let now: Extract<TimelineRow, { kind: 'speak' }>['now'] = null;
        if (action === cursorSpeak) {
          const atCursor = playbackAtCursor(view, playback);
          now = atCursor === 'idle' ? 'queued' : atCursor === 'failed' ? 'audioFailed' : atCursor;
        }
        rows.push({
          kind: 'speak',
          id: action.id,
          speaker,
          tone,
          text: action.text,
          continued: previous?.type === 'speak' && previous.speaker === action.speaker,
          interrupted: view.actions[i + 1]?.type === 'interrupted',
          now,
        });
        break;
      }
      case 'interrupted':
        rows.push({ kind: 'interrupted', id: action.id });
        break;
      case 'generation_failed':
        rows.push({
          kind: 'failed',
          id: action.id,
          tag: action.error.tag,
          message: action.error.message,
        });
        break;
    }
  });
  if (moment === 'thinking') rows.push({ kind: 'pending', label: 'Thinking…' });
  if (moment === 'waiting') rows.push({ kind: 'pending', label: 'More on the way…' });
  return rows;
}

export function present(
  view: ConversationView,
  connection: Connection,
  playback: PlaybackStatus,
): Presentation {
  const moment = momentOf(view, connection, playback);
  return {
    moment,
    composer: COMPOSER[moment],
    visual: VISUAL[moment],
    held: moment === 'held',
    subtitle: subtitleOf(view, moment, playback),
    timeline: timelineOf(view, moment, playback),
  };
}
