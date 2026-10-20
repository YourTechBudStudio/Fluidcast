/**
 * The reference app's two modes, hard-coded: it has no profiles. New brainstorm starts a fresh
 * worker on the brainstorming skill; Continue resumes a stored session of the chosen agent (Claude
 * Code or Codex) and walks the listener through its last answer.
 */
import type { SessionConfig } from '@yourtechbudstudio/fluidcast-harness';
import type { Handoff, HandoffPrompt } from '@yourtechbudstudio/fluidcast-tool-agent';
import {
  forwardToolName,
  type ForwardResult,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

/** The skill a new brainstorm's worker starts with. Hard-coded: the reference app has no profiles. */
export const brainstormSkill = 'brainstorming';
export const brainstormOpening = "Let's brainstorm this in phases.";

/**
 * New brainstorm's hook: the first hand-off starts the brainstorming skill with the opening line,
 * which each worker type writes in its own syntax: Claude Code receives `/brainstorming Let's
 * brainstorm this in phases.\n\n<hand-off>`, Codex the same with `$brainstorming`. Later hand-offs
 * are unchanged.
 */
export const brainstormHook = (handoff: Handoff): HandoffPrompt =>
  handoff.isFirstMessage
    ? {
        prompt: `${brainstormOpening}\n\n${handoff.rendered}`,
        modifiers: [{ name: brainstormSkill }],
      }
    : { prompt: handoff.rendered };

/** Continue's preloaded first message, sent when the listener taps Tap to start. */
export const continueMessage = 'Walk me through your last answer.';
/** The label of Continue's answered call: the stored session's last answer. */
export const continueCallLabel = 'Your last answer in this session';

/**
 * Continue's preloaded start: the message, then the stored session's last answer as an answered
 * `forward_agent` call, so the voice reads it as its own work exactly as it reads any forward
 * result, and the preset's own reminders apply. Read as a labelled context instead, the voice put
 * the answer's questions on a screen and moved on (measured in October 2026).
 */
export const continueStart = (answer: string): NonNullable<SessionConfig['start']> => ({
  message: continueMessage,
  call: {
    label: continueCallLabel,
    tool: forwardToolName,
    input: {},
    result: { messages: [answer] } satisfies ForwardResult,
  },
});
