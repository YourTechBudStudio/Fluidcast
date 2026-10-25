import type { WorkerActivity } from './activity';

/** The palette tokens a tool call can take. The same tool name always gets the same one. */
export const TOOL_TONES = ['blue', 'cyan', 'amber', 'pink', 'yellow', 'teal', 'sapphire'] as const;

export type ToolTone = (typeof TOOL_TONES)[number];

/** An activity's colour: `violet` for thinking, a tool's own tone, `fg-muted` for writing, status and background. */
export type ActivityTone = 'violet' | 'fg-muted' | ToolTone;

/** The glow's colours: an activity's, or how the worker finished. */
export type GlowTone = ActivityTone | 'green' | 'red';

/** 32-bit FNV-1a over the string's UTF-16 code units. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const toolTone = (name: string): ToolTone => TOOL_TONES[fnv1a(name) % TOOL_TONES.length]!;

export const activityTone = (activity: WorkerActivity): ActivityTone => {
  if (activity.kind === 'background') return 'fg-muted';
  switch (activity.entry._tag) {
    case 'thinking':
      return 'violet';
    case 'toolCall':
      return toolTone(activity.entry.name);
    case 'text':
    case 'status':
      return 'fg-muted';
  }
};

/**
 * Sets `--fc-activity`, the colour the strip's dot and the dock's glow read, to a palette token. Literal classes, so
 * the stylesheet keeps every token they name and theme switches re-point them like any other utility.
 */
export const TONE_CLASS: Record<GlowTone, string> = {
  violet: '[--fc-activity:var(--color-violet)]',
  'fg-muted': '[--fc-activity:var(--color-fg-muted)]',
  blue: '[--fc-activity:var(--color-blue)]',
  cyan: '[--fc-activity:var(--color-cyan)]',
  amber: '[--fc-activity:var(--color-amber)]',
  pink: '[--fc-activity:var(--color-pink)]',
  yellow: '[--fc-activity:var(--color-yellow)]',
  teal: '[--fc-activity:var(--color-teal)]',
  sapphire: '[--fc-activity:var(--color-sapphire)]',
  green: '[--fc-activity:var(--color-green)]',
  red: '[--fc-activity:var(--color-red)]',
};
