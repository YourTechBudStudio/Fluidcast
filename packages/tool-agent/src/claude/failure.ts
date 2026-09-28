/**
 * Failure classification for Claude Code frames: which frames are faults (the conversation halts)
 * and what outcome a turn's result records.
 *
 * Usage limits: how Claude Code behaves when a subscription usage limit is hit is to be
 * established by AC10. Either the SDK waits for the reset and resumes the turn by itself, in which
 * case nothing special happens (the busy period stays open and the worker shows `working`), or it
 * ends the turn with an error result after a rejected `rate_limit_event`, in which case the turn
 * ends as `usage_limit` with the reset time when the event carried one, and the Agent tool's error
 * names that time.
 */
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

import { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

/** Assistant errors that no retry fixes: the account or its credentials need attention. */
const authErrors: ReadonlySet<string> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'cloud_credential_error',
]);

/**
 * The fault a frame reports, if any. A known startup failure (`startup_failure_reason`, written on
 * an `error_during_execution` result) is a fault, never a turn error; so is an account or
 * credential error. Every other assistant error (`rate_limit`, `overloaded`, …) is left to the
 * turn's result.
 */
export const faultOf = (frame: SDKMessage): ToolFault | undefined => {
  if (frame.type === 'result' && frame.subtype !== 'success') {
    return frame.startup_failure_reason === undefined
      ? undefined
      : new ToolFault({ reason: 'ClaudeStartup' });
  }
  if (frame.type === 'assistant' && frame.error !== undefined && authErrors.has(frame.error)) {
    return new ToolFault({ reason: 'ClaudeAuth' });
  }
  return undefined;
};

/** A rejected rate-limit event seen in the current turn, with its reset time when known. */
export interface RateLimit {
  readonly resetsAt: number | undefined;
}

/** How a turn ended, as its `turnEnd` entry records it. */
export interface TurnOutcome {
  readonly outcome: string;
  readonly resetsAt?: number;
}

/**
 * `success`; `usage_limit` for a failed turn that saw a rejected rate-limit event; `api_error` for
 * a `success` result flagged `is_error`; else the error subtype.
 */
export const turnOutcome = (
  result: SDKResultMessage,
  rateLimit: RateLimit | undefined,
): TurnOutcome => {
  if (result.subtype === 'success' && !result.is_error) return { outcome: 'success' };
  if (rateLimit !== undefined) {
    return rateLimit.resetsAt === undefined
      ? { outcome: 'usage_limit' }
      : { outcome: 'usage_limit', resetsAt: rateLimit.resetsAt };
  }
  return { outcome: result.subtype === 'success' ? 'api_error' : result.subtype };
};
