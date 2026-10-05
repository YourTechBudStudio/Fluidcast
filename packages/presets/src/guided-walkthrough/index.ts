import type { SessionConfig, SessionSpeaker } from '@yourtechbudstudio/fluidcast-harness';

import { examples } from './examples.ts';
import { forwarding, role, speaking, walkingThrough } from './instructions.ts';
import { reminders } from './reminders.ts';

/**
 * - `detailed` (default, the measured one): the protocol, the speaking style and worked examples.
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
