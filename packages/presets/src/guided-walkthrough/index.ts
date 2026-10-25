import type { SessionConfig, SessionSpeaker } from '@yourtechbudstudio/fluidcast-harness';

import { examples } from './examples.ts';
import { forwarding, role, speaking, walkingThrough } from './instructions.ts';
import { reminders } from './reminders.ts';

/**
 * - `detailed` (default, tuned on Qwen): the protocol, the speaking style and worked examples.
 *   After each screen, speech walks the listener through its highlights, so they skim the screen
 *   instead of reading it all.
 * - `compact` (untested): the protocol only (role, walking through, forwarding), for models that
 *   need less tuning.
 */
export type GuidedWalkthroughProfile = 'compact' | 'detailed';

export interface GuidedWalkthroughOptions {
  readonly profile?: GuidedWalkthroughProfile;
  /** How the host sounds. Voice names are provider-specific, so the application supplies it. */
  readonly voice: SessionSpeaker['voice'];
}

/** The parts of a session's configuration a preset supplies. */
export type Preset = Required<
  Pick<SessionConfig, 'instructions' | 'examples' | 'speakers' | 'reminders'>
>;

/**
 * The Guided Walkthrough: the agent behind `forward_agent` does the thinking, the voice walks the
 * listener through its work one segment at a time, and the listener drives the pace. Spread it
 * into the Harness session config with the Show, Ask and Forward Agent tools, and override any key.
 */
export const guidedWalkthrough = (options: GuidedWalkthroughOptions): Preset => {
  const detailed = (options.profile ?? 'detailed') === 'detailed';
  return {
    instructions: [role, walkingThrough, forwarding, ...(detailed ? [speaking] : [])].join('\n\n'),
    examples: detailed ? examples : [],
    speakers: [
      {
        id: 'host',
        name: 'Host',
        personality:
          'Warm, curious and engaging. Explains things plainly, like a good storyteller.',
        voice: options.voice,
      },
    ],
    reminders,
  };
};

/**
 * The progress writer's system prompt for the Forward Agent tool's `progress.prompt`: what the
 * agent is doing, in the voice's first person.
 */
export const guidedWalkthroughProgressPrompt =
  "You say what an agent is doing right now, in its own words, for someone listening. Reply with one standalone first-person sentence in the present tense, under 20 words, with no preamble, quotes or markdown. Describe the activity, not the tools. Example: I'm comparing the two retry designs against the reconnect flow.";

/**
 * The history summarizer's system prompt for the Harness's `history.compaction.prompt`: one rolling
 * prose summary that keeps the listener's words and describes, never reproduces, what was shown.
 */
export const guidedWalkthroughSummaryPrompt = `You keep the running memory of a voice conversation. A voice presents an agent's work to a listener in short spoken pieces (\`speak\`), with material on screen (\`show\`), checkpoint questions (\`ask\`), and messages passed to the agent (\`forward_agent\`). You receive the previous summary, if any, and the conversation since it, and you write the new summary that replaces both.

Write plain prose and short bullet lists. Never write JSON, XML, or anything shaped like a \`speak\`, \`show\` or \`ask\` action.

Keep, in order of importance:
- Every listener input word for word, in quotes: their messages and any note they added to a question answer. Bare "Continue" answers can be counted rather than quoted.
- What the listener decided, agreed, rejected or corrected, and any question still open.
- What the voice explained, briefly, and every correction the voice made to itself.
- What each \`show\` displayed: its title and what it contained in one line (for a table, its key numbers). Describe it; do not reproduce it.

Drop filler, repetition and pleasantries. Write in the third person ("the listener", "the voice"). Aim for about 4,000 characters; this is a soft target, not a limit. When the previous summary and the conversation do not fit, compress the oldest material first, never the listener's own words.`;
