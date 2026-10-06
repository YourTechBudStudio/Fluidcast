/**
 * The reference app's two modes, hard-coded: it has no profiles. New brainstorm starts a fresh
 * worker on the brainstorming skill; Continue resumes a stored Claude Code session and walks the
 * listener through its last answer.
 */
import type { Reminders } from '@yourtechbudstudio/fluidcast-core/generation';
import type { Handoff, HandoffPrompt } from '@yourtechbudstudio/fluidcast-tool-agent';

/** The skill a new brainstorm's worker starts with. Hard-coded: the reference app has no profiles. */
export const brainstormSkill = 'brainstorming';
export const brainstormOpening = "Let's brainstorm this in phases.";

/**
 * New brainstorm's hook: the first hand-off starts the brainstorming skill with the opening line,
 * so Claude Code receives `/brainstorming Let's brainstorm this in phases.\n\n<hand-off>`. Later
 * hand-offs are unchanged.
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
/** The label of Continue's context: the stored session's last answer. */
export const continueContextLabel = 'Your last answer in this session';
/**
 * Continue's reminder for the preloaded message: one framing sentence, then the Guided
 * Walkthrough's evaluated `reply` reminder verbatim (`reminderTexts.reply` in
 * `packages/presets/src/guided-walkthrough/reminders.ts`, copied because the preset does not export
 * it). Untested in this position: the hand trials are its evidence.
 */
export const continueReminder =
  'The <context> above is your own last answer in this session; treat it as a `forward_agent` result. Present only the first segment of this result now, then stop with an `ask`.';

/**
 * Continue's reminders: the reminder above for a message read with context (only the preloaded
 * start has any), and the preset's own for everything else. An application override (ADR 0005),
 * so the preset stays as evaluated.
 */
export const continueReminders =
  (preset: Reminders): Reminders =>
  (event) =>
    event._tag === 'UserMessage' && event.context.length > 0 ? continueReminder : preset(event);
