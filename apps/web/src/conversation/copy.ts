import type { StatusMoment } from './presentation';

/**
 * Status copy: playful and warm, separate from the speaker persona, and always explicit about what failed.
 * The status line shows the next line from a moment's pool each time the player enters it.
 */
export const COPY: Record<StatusMoment, readonly string[]> = {
  fresh: ['What’s on your mind?', 'Ask me anything.', 'Where should we start?'],
  thinking: [
    'Mulling that over…',
    'Ooh, good one. Thinking…',
    'Gathering my thoughts…',
    'Give me a sec…',
  ],
  waiting: ['Hang on, more coming…', 'Still going, one moment…', 'Lining up the next bit…'],
  speaking: [],
  complete: ['Your turn.', 'Over to you.', 'What next?'],
  interrupted: [
    'Stopped. Where to next?',
    'Okay, I’m listening.',
    'Cut. What would you rather hear?',
  ],
  generationFailed: [
    'Lost my train of thought. Try again?',
    'That answer broke off. Retry to continue?',
    'I dropped the thread there. Retry?',
  ],
  audioFailed: [
    'My voice cut out there. Retry that bit?',
    'Couldn’t play that line. Retry it?',
    'That line didn’t come through. Retry?',
  ],
  connecting: ['Connecting…', 'Tuning in…'],
  reconnecting: [
    'Lost you for a sec. Reconnecting…',
    'Connection dropped. Reconnecting…',
    'Hold on, getting you back…',
  ],
  held: ['Tap to pick up where we left off'],
  sendFailed: [
    'Couldn’t send that. Try again?',
    'That didn’t reach me. Try again?',
    'Couldn’t get that through. One more try?',
  ],
  superseded: [
    'Looks like you picked me up in another tab.',
    'You’re talking to me in another tab now.',
  ],
};

/** The line at `index` in a moment's pool, wrapping around; empty when the moment has no status copy. */
export function copyFor(moment: StatusMoment, index: number): string {
  const pool = COPY[moment];
  return pool.length === 0 ? '' : pool[index % pool.length]!;
}
