import type { TransportError } from '@yourtechbudstudio/fluidcast-client';
import type {
  CommandRejected,
  Execution,
  ExecutionId,
  ToolCommandRejected,
} from '@yourtechbudstudio/fluidcast-harness/protocol';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

/** The Show driver's decisions, kept pure so they can be pinned by tests. The driver itself is `shows.ts`. */

/** How one attempt to report a Show ended. */
export type ReportOutcome =
  | { readonly _tag: 'Accepted' }
  | CommandRejected
  | ToolCommandRejected
  | TransportError;

/**
 * What the Show driver does next:
 * - `reported`: nothing is left to report. The Harness accepted the report (`accepted`), or the execution had already
 *   closed (`stale`), or the session no longer takes commands (halted);
 * - `unresolved`: sending it again cannot help. The Harness would not accept this report (`invalid`), or the backend
 *   could not accept the request or replied outside the protocol (`BadRequest`, `Malformed`): a well-typed report is
 *   only refused when the page and the backend disagree. The execution stays open;
 * - `retry`: the backend could not be reached, or failed while handling the report. Show the failure and try again
 *   after a backoff.
 */
export type ReportAction =
  | { readonly kind: 'reported'; readonly accepted: boolean }
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'retry'; readonly failure: TransportError };

export function reportActionOf(outcome: ReportOutcome): ReportAction {
  switch (outcome._tag) {
    case 'Accepted':
      return { kind: 'reported', accepted: true };
    case 'CommandRejected':
      return { kind: 'reported', accepted: false };
    case 'ToolCommandRejected':
      return outcome.reason === 'stale'
        ? { kind: 'reported', accepted: false }
        : { kind: 'unresolved' };
    case 'TransportError':
      switch (outcome.reason) {
        case 'BadRequest':
        case 'Malformed':
          return { kind: 'unresolved' };
        case 'Unreachable':
        case 'Closed':
        case 'ServerError':
          return { kind: 'retry', failure: outcome };
      }
  }
}

/** Milliseconds before retry `attempt` (from 0): exponential from 250 ms, capped at 4 s. */
export const retryDelay = (attempt: number): number => Math.min(250 * 2 ** attempt, 4000);

/**
 * The Show executions that open the panel: every one not seen before on this page. A replay after Back runs the call
 * again under a new execution id, so it opens the panel again; a Show only reopened from the transcript never runs.
 */
export const unseenShows = (
  executions: ReadonlyArray<Execution>,
  seen: ReadonlySet<ExecutionId>,
): ReadonlyArray<Execution> =>
  executions.filter(
    (execution) => execution.tool === showToolName && !seen.has(execution.executionId),
  );
